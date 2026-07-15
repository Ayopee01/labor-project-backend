// import Library
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

// import Config
import { REDIS_CONFIG } from "../config/redis.config";
import { getRuntimeSettings } from "../services/admin-settings.service";

// import Types
import type { WorkerPresenceDto, WorkerQueueEntryDto } from "../types/worker.type";

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
    status: status.status,
    ready_at: status.ready_at || null,
    break_until: status.break_until || null,
    created_at: status.created_at || "",
    updated_at: status.updated_at || "",
  };
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
  status: string,
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

// Function เอา worker ออกจากคิวและตั้ง offline
export async function markWorkerOffline(accountId: number): Promise<WorkerQueueEntryDto> {
  await redis.zrem(REDIS_CONFIG.workerQueueKey, String(accountId));

  return setWorkerStatus(accountId, "offline", null, null);
}

// Function ตั้ง worker เป็น waiting เพื่อรอเข้าคิว แต่ยังไม่ถูก dispatch งาน
export async function markWorkerWaiting(accountId: number): Promise<WorkerQueueEntryDto> {
  await redis.zrem(REDIS_CONFIG.workerQueueKey, String(accountId));

  return setWorkerStatus(accountId, "waiting", null, null);
}

// Function ตั้ง worker เป็น busy และเอาออกจากคิว
export async function markWorkerBusy(accountId: number): Promise<WorkerQueueEntryDto> {
  await redis.zrem(REDIS_CONFIG.workerQueueKey, String(accountId));

  return setWorkerStatus(accountId, "busy", null, null);
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
    entries.push(await markWorkerBusy(accountId));
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

// Function ตั้ง BullMQ delayed job สำหรับให้ worker กลับจากพัก
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
    },
    {
      delay: delayMs,
      jobId: `worker-break-return-${accountId}-${scheduleId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
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
  handler: (data: { assignmentId: number; workerAccountId: number }) => Promise<void>
): void {
  if (timeoutWorker) {
    return;
  }

  timeoutWorker = new Worker(
    REDIS_CONFIG.assignmentTimeoutQueueName,
    async (job: Job<{ assignmentId: number; workerAccountId: number }>) => {
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
  handler: (data: { accountId: number; scheduleId: number }) => Promise<void>
): void {
  if (breakReturnWorker) {
    return;
  }

  breakReturnWorker = new Worker(
    REDIS_CONFIG.workerBreakReturnQueueName,
    async (job: Job<{ accountId: number; scheduleId: number }>) => {
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
