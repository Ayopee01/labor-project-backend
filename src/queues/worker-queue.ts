// import Library
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

// import Config
import { REDIS_CONFIG } from "../config/redis.config";
import { getRuntimeSettings } from "../services/admin-settings.service";
import { getDelayUntil } from "../utils/time";

// import Types
import type { WorkerPresenceDto, WorkerQueueEntryDto } from "../types/worker.type";
import { WORKER_WORK_STATUSES, type WorkerWorkStatus } from "../types/worker-status.type";

export type AssignmentTimeoutJobData = {
  assignmentId?: number;
  workerAccountId?: number;
  ticketId?: number;
  submissionId?: number;
  kind?: "accept" | "scan" | "scan_warning" | "vendor_confirm";
};

export type WorkerScheduleJobData = {
  accountId: number;
  scheduleId: number;
  shiftInstanceKey?: string;
  kind?: "break_return" | "shift_end";
};

/* -------------------------------------- Config -------------------------------------- */

// Config Redis client สำหรับเก็บ worker queue/status/presence
const redis = new IORedis(REDIS_CONFIG.url, {
  maxRetriesPerRequest: null,
});

// Config แปลง REDIS_URL เป็น connection object สำหรับ BullMQ
const redisUrl = new URL(REDIS_CONFIG.url);

// Config connection object สำหรับ BullMQ queue/worker
const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.replace("/", "") || 0) : 0,
  maxRetriesPerRequest: null,
};

// Config queue สำหรับ assignment timeout
const assignmentTimeoutQueue = new Queue(REDIS_CONFIG.assignmentTimeoutQueueName, {
  connection: bullConnection,
});

// Config queue สำหรับคืน worker จาก break เมื่อครบเวลา
const workerBreakReturnQueue = new Queue(REDIS_CONFIG.workerBreakReturnQueueName, {
  connection: bullConnection,
});

// State เก็บ BullMQ worker เพื่อไม่ให้ start ซ้ำ
let timeoutWorker: Worker | null = null;
let breakReturnWorker: Worker | null = null;

// State score ล่าสุดของ Redis FIFO queue เพื่อกัน score ชนกันใน millisecond เดียว
let lastWorkerQueueScore = 0;

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง Redis key สำหรับสถานะ worker รายคน
function buildWorkerStatusKey(accountId: number): string {
  return `${REDIS_CONFIG.workerStatusKeyPrefix}${accountId}`;
}

// Function สร้าง Redis key สำหรับ heartbeat/presence ของ worker รายคน
function buildWorkerPresenceKey(accountId: number): string {
  return `${REDIS_CONFIG.workerPresenceKeyPrefix}${accountId}`;
}

// Function สร้าง Redis key สำหรับนับจำนวนพักของ worker ในแต่ละกะ
function buildWorkerBreakCountKey(accountId: number, shiftInstanceKey: string): string {
  return `${REDIS_CONFIG.workerBreakCountKeyPrefix}${accountId}:${shiftInstanceKey}`;
}

function buildWorkerShiftOnlineKey(accountId: number, shiftInstanceKey: string): string {
  return `worker:shift-online:${accountId}:${shiftInstanceKey}`;
}

function buildWorkerShiftClosedKey(accountId: number, shiftInstanceKey: string): string {
  return `worker:shift-closed:${accountId}:${shiftInstanceKey}`;
}

function buildWorkerAcceptTimeoutCountKey(accountId: number, shiftInstanceKey: string): string {
  return `worker:accept-timeout-count:${accountId}:${shiftInstanceKey}`;
}

// Function แปลงค่า hash จาก Redis เป็น response สถานะคิว
function mapQueueStatus(
  accountId: number,
  status: Record<string, string>
): WorkerQueueEntryDto | null {
  if (!status.status) {
    return null;
  }

  return {
    id: accountId,
    account_id: accountId,
    status: normalizeWorkerQueueStatus(status.status),
    ready_at: status.ready_at || null,
    break_until: status.break_until || null,
    created_at: status.created_at || "",
    updated_at: status.updated_at || "",
  };
}

function normalizeWorkerQueueStatus(value: string): WorkerWorkStatus {
  return (WORKER_WORK_STATUSES as readonly string[]).includes(value)
    ? value as WorkerWorkStatus
    : "open_app";
}

// Function แปลงค่า presence จาก Redis เป็น response
function mapWorkerPresence(
  presence: Record<string, string>,
  staleAfterSeconds: number
): WorkerPresenceDto {
  const lastSeenAt = presence.last_seen_at || null;
  const isOnline = lastSeenAt
    ? Date.now() - new Date(lastSeenAt).getTime() <= staleAfterSeconds * 1000
    : false;

  return {
    is_online: isOnline,
    last_seen_at: lastSeenAt,
    stale_after_seconds: staleAfterSeconds,
  };
}

// Function บันทึกสถานะ worker ลง Redis hash
async function setWorkerStatus(
  accountId: number,
  status: WorkerWorkStatus,
  readyAt: Date | null,
  breakUntil: Date | null
): Promise<WorkerQueueEntryDto> {
  const nowIso = new Date().toISOString();
  const existing = await redis.hgetall(buildWorkerStatusKey(accountId));
  const createdAt = existing.created_at || nowIso;

  await redis.hset(buildWorkerStatusKey(accountId), {
    account_id: String(accountId),
    status,
    ready_at: readyAt ? readyAt.toISOString() : "",
    break_until: breakUntil ? breakUntil.toISOString() : "",
    created_at: createdAt,
    updated_at: nowIso,
  });

  const latest = await redis.hgetall(buildWorkerStatusKey(accountId));

  return mapQueueStatus(accountId, latest) as WorkerQueueEntryDto;
}

// Function สร้าง score คิวให้เรียงตามลำดับที่เรียก แม้เข้า queue ใน millisecond เดียวกัน
function buildWorkerQueueScore(): number {
  const now = Date.now();
  const nextScore = now <= lastWorkerQueueScore ? lastWorkerQueueScore + 1 : now;

  lastWorkerQueueScore = nextScore;

  return nextScore;
}

// Function เพิ่ม worker เข้าท้ายคิว Redis FIFO
export async function enqueueWorker(accountId: number): Promise<WorkerQueueEntryDto> {
  const readyScore = buildWorkerQueueScore();
  const readyAt = new Date(readyScore);
  await redis.zadd(
    REDIS_CONFIG.workerQueueKey,
    readyScore,
    String(accountId)
  );

  return setWorkerStatus(accountId, "ready", readyAt, null);
}

// Function เอา worker ออกจากคิวและตั้ง open_app
// Function เพิ่ม worker กลุ่มหนึ่งไว้หัวคิว โดยรักษาลำดับ accountIds ที่ส่งเข้ามา
export async function enqueueWorkersAtFront(
  accountIds: number[]
): Promise<WorkerQueueEntryDto[]> {
  const uniqueAccountIds = [...new Set(accountIds)];

  if (uniqueAccountIds.length === 0) {
    return [];
  }

  const currentHead = await redis.zrange(
    REDIS_CONFIG.workerQueueKey,
    0,
    0,
    "WITHSCORES"
  );
  const currentHeadScore = currentHead.length >= 2 ? Number(currentHead[1]) : null;
  const firstScore = currentHeadScore === null || Number.isNaN(currentHeadScore)
    ? buildWorkerQueueScore()
    : currentHeadScore - uniqueAccountIds.length;
  lastWorkerQueueScore = Math.max(
    lastWorkerQueueScore,
    firstScore + uniqueAccountIds.length - 1
  );
  const readyAt = new Date();
  const entries: WorkerQueueEntryDto[] = [];

  for (const [index, accountId] of uniqueAccountIds.entries()) {
    await redis.zadd(
      REDIS_CONFIG.workerQueueKey,
      firstScore + index,
      String(accountId)
    );
    entries.push(await setWorkerStatus(accountId, "ready", readyAt, null));
  }

  return entries;
}

export async function markWorkerOpenApp(accountId: number): Promise<WorkerQueueEntryDto> {
  await redis.zrem(REDIS_CONFIG.workerQueueKey, String(accountId));

  return setWorkerStatus(accountId, "open_app", null, null);
}

// Function ตั้ง worker เป็น assigned และเอาออกจากคิว
export async function markWorkerAssigned(accountId: number): Promise<WorkerQueueEntryDto> {
  await redis.zrem(REDIS_CONFIG.workerQueueKey, String(accountId));

  return setWorkerStatus(accountId, "assigned", null, null);
}

// Function ตั้ง worker เป็นพักชั่วคราวและเอาออกจากคิว
export async function markWorkerBreak(
  accountId: number,
  breakUntil: Date
): Promise<WorkerQueueEntryDto> {
  await redis.zrem(REDIS_CONFIG.workerQueueKey, String(accountId));

  return setWorkerStatus(accountId, "break", null, breakUntil);
}

// Function ดึง worker จากหัวคิวตาม FIFO
export async function popReadyWorkers(limit: number): Promise<WorkerQueueEntryDto[]> {
  if (limit <= 0) {
    return [];
  }

  const accountIds = await redis.zrange(
    REDIS_CONFIG.workerQueueKey,
    0,
    limit - 1
  );

  if (accountIds.length === 0) {
    return [];
  }

  await redis.zrem(REDIS_CONFIG.workerQueueKey, ...accountIds);

  const entries: WorkerQueueEntryDto[] = [];

  for (const accountIdValue of accountIds) {
    const accountId = Number(accountIdValue);
    entries.push(await markWorkerAssigned(accountId));
  }

  return entries;
}

// Function ดึงสถานะคิวของ worker จาก Redis
export async function getWorkerQueueStatus(
  accountId: number
): Promise<WorkerQueueEntryDto | null> {
  const status = await redis.hgetall(buildWorkerStatusKey(accountId));

  return mapQueueStatus(accountId, status);
}

// Function ดึงสถานะ queue ของ worker หลายคนจาก Redis
export async function getWorkerQueueStatuses(
  accountIds: number[]
): Promise<Map<number, WorkerQueueEntryDto | null>> {
  const result = new Map<number, WorkerQueueEntryDto | null>();

  if (accountIds.length === 0) {
    return result;
  }

  const pipeline = redis.pipeline();

  for (const accountId of accountIds) {
    pipeline.hgetall(buildWorkerStatusKey(accountId));
  }

  const responses = await pipeline.exec();

  accountIds.forEach((accountId, index) => {
    const [, value] = responses?.[index] ?? [null, {}];
    result.set(
      accountId,
      mapQueueStatus(accountId, (value ?? {}) as Record<string, string>)
    );
  });

  return result;
}

// Function บันทึก heartbeat ของ worker เพื่อให้ Admin เห็น presence ล่าสุด
// Function ดึง rank จริงใน Redis ready queue ของ worker หลายคน เพื่อให้ Admin board เรียงคิวตรงกับ dispatch
export async function getWorkerReadyQueueRanks(
  accountIds: number[]
): Promise<Map<number, number | null>> {
  const result = new Map<number, number | null>();

  if (accountIds.length === 0) {
    return result;
  }

  const pipeline = redis.pipeline();

  for (const accountId of accountIds) {
    pipeline.zrank(REDIS_CONFIG.workerQueueKey, String(accountId));
  }

  const responses = await pipeline.exec();

  accountIds.forEach((accountId, index) => {
    const [, value] = responses?.[index] ?? [null, null];
    const rank = value === null || value === undefined ? null : Number(value);

    result.set(accountId, Number.isFinite(rank) ? rank : null);
  });

  return result;
}

export async function recordWorkerHeartbeat(
  accountId: number
): Promise<WorkerPresenceDto> {
  const lastSeenAt = new Date().toISOString();
  const settings = await getRuntimeSettings();
  const staleAfterSeconds = settings.worker_presence_stale_seconds;

  await redis.hset(buildWorkerPresenceKey(accountId), {
    account_id: String(accountId),
    last_seen_at: lastSeenAt,
  });
  await redis.expire(
    buildWorkerPresenceKey(accountId),
    staleAfterSeconds * 2
  );

  return mapWorkerPresence({
    last_seen_at: lastSeenAt,
  }, staleAfterSeconds);
}

// Function ดึง presence ล่าสุดของ worker รายคน
export async function getWorkerPresence(
  accountId: number
): Promise<WorkerPresenceDto> {
  const presence = await redis.hgetall(buildWorkerPresenceKey(accountId));
  const settings = await getRuntimeSettings();

  return mapWorkerPresence(presence, settings.worker_presence_stale_seconds);
}

// Function ดึง presence ล่าสุดของ worker หลายคนจาก Redis
export async function getWorkerPresences(
  accountIds: number[]
): Promise<Map<number, WorkerPresenceDto>> {
  const result = new Map<number, WorkerPresenceDto>();

  if (accountIds.length === 0) {
    return result;
  }

  const pipeline = redis.pipeline();
  const settings = await getRuntimeSettings();

  for (const accountId of accountIds) {
    pipeline.hgetall(buildWorkerPresenceKey(accountId));
  }

  const responses = await pipeline.exec();

  accountIds.forEach((accountId, index) => {
    const [, value] = responses?.[index] ?? [null, {}];
    result.set(
      accountId,
      mapWorkerPresence(
        (value ?? {}) as Record<string, string>,
        settings.worker_presence_stale_seconds
      )
    );
  });

  return result;
}

// Function ดึงจำนวนครั้งพักของ worker ในกะนั้น
export async function getWorkerBreakCount(
  accountId: number,
  shiftInstanceKey: string
): Promise<number> {
  const value = await redis.get(buildWorkerBreakCountKey(accountId, shiftInstanceKey));

  return value ? Number(value) : 0;
}

// Function เพิ่มจำนวนครั้งพักของ worker ในกะนั้น
export async function incrementWorkerBreakCount(
  accountId: number,
  shiftInstanceKey: string
): Promise<number> {
  const key = buildWorkerBreakCountKey(accountId, shiftInstanceKey);
  const count = await redis.incr(key);
  const settings = await getRuntimeSettings();

  await redis.expire(key, settings.worker_break_count_ttl_hours * 60 * 60);

  return count;
}

export async function hasWorkerShiftOnlineUsed(
  accountId: number,
  shiftInstanceKey: string
): Promise<boolean> {
  return Boolean(await redis.get(buildWorkerShiftOnlineKey(accountId, shiftInstanceKey)));
}

export async function markWorkerShiftOnlineUsed(
  accountId: number,
  shiftInstanceKey: string
): Promise<void> {
  const key = buildWorkerShiftOnlineKey(accountId, shiftInstanceKey);
  const settings = await getRuntimeSettings();

  await redis.incr(key);
  await redis.expire(key, settings.worker_break_count_ttl_hours * 60 * 60);
}

export async function isWorkerShiftClosed(
  accountId: number,
  shiftInstanceKey: string
): Promise<boolean> {
  return Boolean(await redis.get(buildWorkerShiftClosedKey(accountId, shiftInstanceKey)));
}

export async function markWorkerShiftClosed(
  accountId: number,
  shiftInstanceKey: string
): Promise<void> {
  const key = buildWorkerShiftClosedKey(accountId, shiftInstanceKey);
  const settings = await getRuntimeSettings();

  await redis.incr(key);
  await redis.expire(key, settings.worker_break_count_ttl_hours * 60 * 60);
}

export async function getWorkerAcceptTimeoutCount(
  accountId: number,
  shiftInstanceKey: string
): Promise<number> {
  const value = await redis.get(buildWorkerAcceptTimeoutCountKey(accountId, shiftInstanceKey));

  return value ? Number(value) : 0;
}

export async function incrementWorkerAcceptTimeoutCount(
  accountId: number,
  shiftInstanceKey: string
): Promise<number> {
  const key = buildWorkerAcceptTimeoutCountKey(accountId, shiftInstanceKey);
  const settings = await getRuntimeSettings();
  const count = await redis.incr(key);

  await redis.expire(key, settings.worker_break_count_ttl_hours * 60 * 60);

  return count;
}

export async function resetWorkerAcceptTimeoutCount(
  accountId: number,
  shiftInstanceKey: string
): Promise<void> {
  await redis.del(buildWorkerAcceptTimeoutCountKey(accountId, shiftInstanceKey));
}

// Function ตั้ง BullMQ delayed job สำหรับ assignment timeout
export async function scheduleAssignmentTimeout(
  assignmentId: number,
  workerAccountId: number,
  delayMs: number
): Promise<void> {
  await assignmentTimeoutQueue.add(
    "assignment-timeout",
    {
      assignmentId,
      workerAccountId,
      kind: "accept",
    },
    {
      delay: delayMs,
      jobId: `assignment-timeout-${assignmentId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

// Function ยกเลิก BullMQ delayed job เมื่อ worker กดรับงานทันเวลา
export async function removeAssignmentTimeout(assignmentId: number): Promise<void> {
  const job = await assignmentTimeoutQueue.getJob(`assignment-timeout-${assignmentId}`);

  if (job) {
    await job.remove();
  }
}

// Function schedules delayed job for accepted assignment QR scan timeout.
export async function scheduleScanTimeout(
  assignmentId: number,
  workerAccountId: number,
  delayMs: number
): Promise<void> {
  await removeScanTimeout(assignmentId);
  await assignmentTimeoutQueue.add(
    "assignment-scan-timeout",
    {
      assignmentId,
      workerAccountId,
      kind: "scan",
    },
    {
      delay: delayMs,
      jobId: `assignment-scan-timeout-${assignmentId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function removeScanTimeout(assignmentId: number): Promise<void> {
  const job = await assignmentTimeoutQueue.getJob(`assignment-scan-timeout-${assignmentId}`);

  if (job) {
    await job.remove();
  }
}

export async function scheduleScanWarning(
  assignmentId: number,
  workerAccountId: number,
  scanDeadlineAt: string | null
): Promise<void> {
  await removeScanWarning(assignmentId);
  const remainingDelayMs = getDelayUntil(scanDeadlineAt);

  if (remainingDelayMs <= 0) {
    return;
  }

  const settings = await getRuntimeSettings();
  const warningBeforeMs = settings.worker_scan_warning_before_minutes * 60 * 1000;
  const warningDelayMs = Math.max(0, remainingDelayMs - warningBeforeMs);

  await assignmentTimeoutQueue.add(
    "assignment-scan-warning",
    {
      assignmentId,
      workerAccountId,
      kind: "scan_warning",
    },
    {
      delay: warningDelayMs,
      jobId: `assignment-scan-warning-${assignmentId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function removeScanWarning(assignmentId: number): Promise<void> {
  const job = await assignmentTimeoutQueue.getJob(`assignment-scan-warning-${assignmentId}`);

  if (job) {
    await job.remove();
  }
}

export async function scheduleVendorConfirmationTimeout(
  ticketId: number,
  submissionId: number,
  delayMs: number
): Promise<void> {
  await removeVendorConfirmationTimeout(ticketId, submissionId);
  await assignmentTimeoutQueue.add(
    "vendor-confirm-timeout",
    {
      ticketId,
      submissionId,
      kind: "vendor_confirm",
    },
    {
      delay: delayMs,
      jobId: `vendor-confirm-timeout-${ticketId}-${submissionId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function removeVendorConfirmationTimeout(
  ticketId: number,
  submissionId: number
): Promise<void> {
  const job = await assignmentTimeoutQueue.getJob(
    `vendor-confirm-timeout-${ticketId}-${submissionId}`
  );

  if (job) {
    await job.remove();
  }
}

// Function schedules delayed job for returning worker from break.
export async function scheduleWorkerBreakReturn(
  accountId: number,
  scheduleId: number,
  delayMs: number
): Promise<void> {
  await workerBreakReturnQueue.add(
    "worker-break-return",
    {
      accountId,
      scheduleId,
      kind: "break_return",
    },
    {
      delay: delayMs,
      jobId: `worker-break-return-${accountId}-${scheduleId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function scheduleWorkerShiftEnd(
  accountId: number,
  scheduleId: number,
  delayMs: number,
  shiftInstanceKey?: string
): Promise<void> {
  await removeWorkerShiftEnd(accountId, scheduleId);
  await workerBreakReturnQueue.add(
    "worker-shift-end",
    {
      accountId,
      scheduleId,
      shiftInstanceKey,
      kind: "shift_end",
    },
    {
      delay: delayMs,
      jobId: `worker-shift-end-${accountId}-${scheduleId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function removeWorkerShiftEnd(
  accountId: number,
  scheduleId: number
): Promise<void> {
  const job = await workerBreakReturnQueue.getJob(
    `worker-shift-end-${accountId}-${scheduleId}`
  );

  if (job) {
    await job.remove();
  }
}

// Function ยกเลิก BullMQ delayed job คืนคิวหลังพักของ worker
export async function removeWorkerBreakReturn(
  accountId: number,
  scheduleId: number
): Promise<void> {
  const job = await workerBreakReturnQueue.getJob(
    `worker-break-return-${accountId}-${scheduleId}`
  );

  if (job) {
    await job.remove();
  }
}

// Function เริ่ม BullMQ worker สำหรับจัดการ assignment timeout
export function startAssignmentTimeoutWorker(
  handler: (data: AssignmentTimeoutJobData) => Promise<void>
): void {
  if (timeoutWorker) {
    return;
  }

  timeoutWorker = new Worker(
    REDIS_CONFIG.assignmentTimeoutQueueName,
    async (job: Job<AssignmentTimeoutJobData>) => {
      await handler(job.data);
    },
    {
      connection: bullConnection,
    }
  );

  timeoutWorker.on("failed", (_job, error) => {
    console.error("Assignment timeout job failed.", error);
  });
}

// Function เริ่ม BullMQ worker สำหรับพา worker กลับคิวหลังพักครบเวลา
export function startWorkerBreakReturnWorker(
  handler: (data: WorkerScheduleJobData) => Promise<void>
): void {
  if (breakReturnWorker) {
    return;
  }

  breakReturnWorker = new Worker(
    REDIS_CONFIG.workerBreakReturnQueueName,
    async (job: Job<WorkerScheduleJobData>) => {
      await handler(job.data);
    },
    {
      connection: bullConnection,
    }
  );

  breakReturnWorker.on("failed", (_job, error) => {
    console.error("Worker break return job failed.", error);
  });
}
