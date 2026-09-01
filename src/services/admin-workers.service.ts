import { withTransaction } from "../db/prisma";
import { enqueueWorker, getWorkerBreakCount, getWorkerPresence, getWorkerPresences, getWorkerQueueStatus, getWorkerQueueStatuses, getWorkerReadyQueueRanks, incrementWorkerBreakCount, markWorkerBreak, markWorkerOpenApp, removeWorkerBreakReturn, scheduleWorkerBreakReturn } from "../queues/worker-queue";
import { workerRepository, workerSessionRepository } from "../repositories/admin-workers.repository";
import * as accountRepository from "../repositories/shared/account.repository";
import * as adminActionLogRepository from "../repositories/shared/admin-action-log.repository";
import * as assignmentRepository from "../repositories/shared/vehicle-job-assignment.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import { getRuntimeSettings } from "./shared/runtime-settings.service";
import { publishAdminWorkerStatusChanged } from "./notifications.service";
import { writeSecurityAuditLog, diffChangedFields } from "./shared/security-audit-log.service";
import { SECURITY_AUDIT_EVENT_TYPE, SECURITY_AUDIT_OUTCOME } from "../types/shared/security-audit-log.type";
import type { AccessTokenPayload } from "../types/auth.type";
import type { DbConnection } from "../types/shared/common.type";
import type { AdminWorkerBoardStatus, AdminWorkerStatusItem, MasterWorkerDto, PaginationMeta, UserDetailResponse, UserListItem, UserListFilters, UserListSchedule, WorkScheduleDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import type { VehicleJobAssignmentDto, VehicleWorkReadinessDto, WorkerPresenceDto, WorkerQueueEntryDto } from "../types/worker.type";
import type { SecurityAuditRequestContext } from "../types/shared/security-audit-log.type";
import { parseWithSchema } from "../validation/parser";
import { adminForceWorkerStatusBodySchema, createUserBodySchema, paginationQuerySchema, resetPasswordBodySchema, updateUserBodySchema } from "../validation/schemas";
import { getActorId, requireActorId } from "../utils/actor";
import ApiError from "../utils/api-error";
import { hashPassword } from "../utils/password";
import { buildShiftWaitInfo, buildWorkScheduleShiftInstanceKey, findActiveWorkSchedule, formatScheduleWithShift, isTimeInWorkSchedule, resolveShiftNoFromStartTime, resolveShiftPreset } from "../utils/shift";
import { buildDeadline, formatBangkokDate, toUnixMs } from "../utils/time";
import { buildWorkerQueueSocketPayload } from "../utils/worker-payload";
import { buildWorkerCode } from "../utils/worker-code";
import { resolveWorkerWorkStatus } from "../utils/worker-status";
import { ASSIGNMENT_STATUS } from "../constants/job-status";
import { WORKER_WORK_STATUS } from "../types/shared/worker-status.type";
import { ADMIN_ACTION_TYPE } from "../types/shared/admin-action-log.type";

/* -------------------------------------- Functions -------------------------------------- */

const EMPTY_SECURITY_AUDIT_CONTEXT: SecurityAuditRequestContext = {
  ip_address: null,
  user_agent: null,
  request_id: null,
};

// Function สร้าง worker assignment socket payload ใน service flow
async function buildWorkerAssignmentSocketPayload(
  assignment: VehicleJobAssignmentDto | null
) {
  if (!assignment) {
    return null;
  }

  const vehicleJob = await vehicleJobRepository.findVehicleJobById(
    assignment.vehicle_job_id
  );

  return {
    ticketNumber: vehicleJob?.ticket_number ?? null,
    status: assignment.status,
    accept_deadline_at: assignment.accept_deadline_at,
    scan_deadline_at: assignment.scan_deadline_at,
    accepted_at: assignment.accepted_at,
    scanned_at: assignment.scanned_at,
    completed_at: assignment.completed_at,
  };
}

// Function ตรวจสอบและดึง worker ใน service flow
async function requireWorker(
  id: number | string,
  connection?: DbConnection
): Promise<MasterWorkerDto> {
  const worker =
    typeof id === "number"
      ? await workerRepository.findById(id, connection)
      : await workerRepository.findByIdentifier(id, connection);

  if (!worker) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  }

  return worker;
}

// Function สร้าง pagination meta ใน service flow
function buildPaginationMeta(
  page: number,
  limit: number,
  total: number
): PaginationMeta {
  return {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
  };
}

// Function จัดรูปแบบ user list schedule ใน service flow
function formatUserListSchedule(
  schedule: WorkScheduleWithShiftDto | null
): UserListSchedule | null {
  if (!schedule) {
    return null;
  }

  return {
    shift_no: schedule.shift_no,
    shift_start_time: schedule.shift_start_time,
    shift_end_time: schedule.shift_end_time,
    shift_name: schedule.shift_name,
  };
}

// Function แปลง Status ตัวเลขของ MasterWorker เป็น active/inactive string ของ API เดิม — null (ไม่มี
// ค่าจาก Master) ถือเป็น inactive ในชั้นแสดงผลนี้เท่านั้น ค่าจริงใน DB ยังเป็น null ไม่ถูกเขียนทับ
function toAccountStatus(status: number | null): string {
  return status === 1 ? "active" : "inactive";
}

// Function จัดรูปแบบ user list item ใน service flow
function formatUserListItem(worker: MasterWorkerDto): UserListItem {
  const schedule = formatScheduleWithShift(scheduleFromWorker(worker));

  return {
    worker_code: worker.labor_code,
    labor_color: worker.labor_color,
    full_name: worker.full_name,
    phone: worker.telephone,
    work_start_date: worker.work_start_date,
    work_schedule: formatUserListSchedule(schedule),
    status: toAccountStatus(worker.status),
    updated_at: worker.updated_at,
  };
}

// Function สร้าง WorkScheduleDto จาก field shift บน MasterWorker เอง (schedule ไม่ใช่ entity แยก)
function scheduleFromWorker(worker: MasterWorkerDto): WorkScheduleDto | null {
  if (
    worker.shift_no === null ||
    worker.shift_start_time === null ||
    worker.shift_end_time === null
  ) {
    return null;
  }

  return {
    id: worker.id,
    worker_id: worker.id,
    shift_no: worker.shift_no,
    work_date: worker.work_start_date ?? worker.created_at.slice(0, 10),
    shift_start_time: worker.shift_start_time,
    shift_end_time: worker.shift_end_time,
    is_current: true,
    created_by: null,
    updated_by: null,
    created_at: worker.created_at,
    updated_at: worker.updated_at,
  };
}

// Function จัดรูปแบบ user detail ใน service flow
function formatUserDetail(worker: MasterWorkerDto): UserDetailResponse {
  const schedule = formatScheduleWithShift(scheduleFromWorker(worker));

  return {
    picture: worker.picture,
    worker_code: worker.labor_code,
    full_name: worker.full_name,
    status: toAccountStatus(worker.status),
    details: {
      phone: worker.telephone,
      nationality: worker.nationality,
      labor_color: worker.labor_color,
      work_start_date: worker.work_start_date,
      shift_no: schedule?.shift_no ?? null,
      shift_start_time: schedule?.shift_start_time ?? null,
      shift_end_time: schedule?.shift_end_time ?? null,
      shift_name: schedule?.shift_name ?? null,
    },
  };
}

// Function ตรวจสอบเงื่อนไข WorkerCode available ใน service flow
async function assertWorkerCodeAvailable(
  workerCode: string,
  exceptWorkerId?: number | null,
  connection?: DbConnection
): Promise<void> {
  const exists = await workerRepository.laborCodeExists(
    workerCode,
    exceptWorkerId,
    connection
  );

  if (exists) {
    throw new ApiError(
      409,
      "WORKER_CODE_ALREADY_EXISTS",
      "Worker code already exists."
    );
  }
}

// Function เพิกถอน worker sessions ใน service flow
async function revokeWorkerSessions(
  workerId: number,
  connection?: DbConnection
): Promise<void> {
  await workerSessionRepository.revokeActiveByWorkerId(workerId, connection);
}

// Function สร้าง user ใน service flow
export async function createUser(
  body: unknown,
  auth?: AccessTokenPayload,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
) {
  const actorId = requireActorId(auth);
  const {
    username: requestedUsername,
    full_name: fullName,
    phone,
    nationality,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
    work_start_date: workStartDate,
    shift_no: shiftNo,
    status,
  } = parseWithSchema(createUserBodySchema, body);
  const workerCode = buildWorkerCode({
    nationality,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
  });
  const laborCode = requestedUsername ?? workerCode;
  const initialWorkStartDate = workStartDate ?? formatBangkokDate();
  const shiftPreset = resolveShiftPreset(shiftNo);

  return withTransaction(async (transaction) => {
    await assertWorkerCodeAvailable(laborCode, null, transaction);

    await workerRepository.create(
      {
        labor_code: laborCode,
        full_name: fullName,
        telephone: phone,
        nationality,
        labor_color: shirtType,
        work_start_date: initialWorkStartDate,
        shift_no: shiftPreset.shift_no,
        shift_start_time: shiftPreset.shift_start_time,
        shift_end_time: shiftPreset.shift_end_time,
        status: status === "active" ? 1 : 0,
      },
      transaction
    );

    const passwordHash = await hashPassword(phone);
    const created = await workerRepository.findByIdentifier(laborCode, transaction);

    if (created) {
      await workerRepository.updatePasswordHash(created.id, passwordHash, transaction);
    }

    const actor = await accountRepository.findById(actorId, transaction);

    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.WORKER_ACCOUNT_CREATED,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "admin",
        actor_account_id: actorId,
        actor_username: actor?.username ?? null,
        actor_full_name: actor?.full_name ?? null,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
        metadata: {
          targetType: "worker",
          targetWorkerId: created?.id ?? null,
          targetWorkerCode: laborCode,
          after: {
            full_name: fullName,
            status,
            shift_no: shiftPreset.shift_no,
          },
        },
      },
      transaction
    );

    return {
      message: "Worker created successfully.",
    };
  });
}

// Function ดึงรายการ users ใน service flow
export async function listUsers(
  query: Record<string, unknown> = {},
  _auth?: AccessTokenPayload
) {
  const { page, limit, search, status } = parseWithSchema(
    paginationQuerySchema,
    query
  );
  const filters: UserListFilters = {
    status,
    search,
    offset: (page - 1) * limit,
    limit,
  };
  const [users, total] = await Promise.all([
    workerRepository.listUsers(filters),
    workerRepository.countUsers(filters),
  ]);
  const data = users.map((user) => formatUserListItem(user));

  return {
    data,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

// Function ดึง user ใน service flow
export async function getUser(id: number | string, _auth?: AccessTokenPayload) {
  const worker = await requireWorker(id);

  return formatUserDetail(worker);
}

// Function อัปเดต user ใน service flow — worker_code จะถูก regenerate ใหม่เฉพาะตอนที่ส่ง
// nationality+shirt_type+shirt_number มาครบทั้งสามค่าพร้อมกัน (หรือส่ง worker_code ตรงๆ) เพราะ
// MasterWorker ไม่ได้เก็บ shirt_number แยกไว้ให้ derive ย้อนหลังแบบ Account เดิมอีกต่อไป
export async function updateUser(
  id: number | string,
  body: unknown,
  auth?: AccessTokenPayload,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
) {
  const actorId = requireActorId(auth);
  const {
    worker_code: requestedWorkerCode,
    full_name: nextFullName,
    phone,
    nationality,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
    work_start_date: workStartDate,
    shift_start_time: shiftStartTime,
    shift_end_time: shiftEndTime,
    status,
  } = parseWithSchema(updateUserBodySchema, body);
  const hasScheduleTimeInput =
    shiftStartTime !== undefined || shiftEndTime !== undefined;

  return withTransaction(async (transaction) => {
    const worker = await requireWorker(id, transaction);
    // Snapshot ก่อนแก้ไขจริง — ห้ามใช้ worker ตรงๆ ไปเทียบกับ updatedWorker ตอนท้าย เพราะ repository
    // บาง implementation คืน object เดิม (mutate in place) ไม่ใช่ fresh copy ทุกครั้งที่ query
    const workerBeforeUpdate = { ...worker };
    const nextWorkerCode =
      requestedWorkerCode ??
      (nationality !== undefined && shirtType !== undefined && shirtNumber !== undefined
        ? buildWorkerCode({ nationality, shirt_type: shirtType, shirt_number: shirtNumber })
        : undefined);

    if (nextWorkerCode !== undefined) {
      await assertWorkerCodeAvailable(nextWorkerCode, worker.id, transaction);
    }

    const hasFieldUpdates =
      nextWorkerCode !== undefined ||
      (nextFullName !== undefined && nextFullName !== "") ||
      phone !== undefined ||
      nationality !== undefined ||
      shirtType !== undefined;

    if (hasFieldUpdates) {
      await workerRepository.update(
        worker.id,
        {
          labor_code: nextWorkerCode,
          full_name: nextFullName !== undefined && nextFullName !== "" ? nextFullName : undefined,
          telephone: phone,
          nationality,
          labor_color: shirtType,
        },
        transaction
      );

      if (phone !== undefined) {
        await workerRepository.updatePasswordHash(
          worker.id,
          await hashPassword(phone),
          transaction
        );
      }
    }

    if (workStartDate !== undefined) {
      await workerRepository.update(worker.id, { work_start_date: workStartDate }, transaction);
    }

    if (status !== undefined) {
      await workerRepository.update(
        worker.id,
        { status: status === "active" ? 1 : 0 },
        transaction
      );

      if (status === "inactive") {
        await revokeWorkerSessions(worker.id, transaction);
      }
    }

    if (hasScheduleTimeInput) {
      if (shiftStartTime === undefined || shiftEndTime === undefined) {
        throw new ApiError(
          400,
          "SHIFT_TIME_PAIR_REQUIRED",
          "ShiftStartTime and ShiftEndTime must be sent together."
        );
      }

      const resolvedShiftNo = resolveShiftNoFromStartTime(shiftStartTime);

      await workerRepository.updateShift(
        worker.id,
        {
          shift_no: resolvedShiftNo,
          shift_start_time: shiftStartTime,
          shift_end_time: shiftEndTime,
          work_start_date: workStartDate,
        },
        transaction
      );
    }

    const updatedWorker = await requireWorker(worker.id, transaction);
    const diff = diffChangedFields(workerBeforeUpdate, updatedWorker, [
      "labor_code",
      "full_name",
      "telephone",
      "nationality",
      "labor_color",
      "work_start_date",
      "status",
      "shift_no",
      "shift_start_time",
      "shift_end_time",
    ]);

    if (diff) {
      const actor = await accountRepository.findById(actorId, transaction);

      await writeSecurityAuditLog(
        {
          event_type: SECURITY_AUDIT_EVENT_TYPE.WORKER_ACCOUNT_UPDATED,
          outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
          actor_type: "admin",
          actor_account_id: actorId,
          actor_username: actor?.username ?? null,
          actor_full_name: actor?.full_name ?? null,
          ip_address: context.ip_address,
          user_agent: context.user_agent,
          request_id: context.request_id,
          metadata: {
            targetType: "worker",
            targetWorkerId: worker.id,
            targetWorkerCode: updatedWorker.labor_code,
            before: diff.before,
            after: diff.after,
          },
        },
        transaction
      );
    }

    return formatUserDetail(updatedWorker);
  });
}

// Function รีเซ็ต password ใน service flow — Admin ยังตั้ง password แยกอิสระให้ worker ได้ตามเดิม
// (จะถูกเขียนทับอีกครั้งถ้า telephone ของ worker คนนี้เปลี่ยนในภายหลัง ไม่ว่าจะจาก Admin แก้เอง หรือ
// จาก Master sync — เป็นพฤติกรรมที่ตั้งใจ)
export async function resetPassword(
  id: number | string,
  body: unknown,
  auth?: AccessTokenPayload,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
) {
  const actorId = requireActorId(auth);
  const { new_password: newPassword } = parseWithSchema(
    resetPasswordBodySchema,
    body
  );

  return withTransaction(async (transaction) => {
    const worker = await requireWorker(id, transaction);
    const actor = await accountRepository.findById(actorId, transaction);

    await workerRepository.updatePasswordHash(
      worker.id,
      await hashPassword(newPassword),
      transaction
    );
    await revokeWorkerSessions(worker.id, transaction);

    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.ACCOUNT_PASSWORD_RESET,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "admin",
        actor_account_id: actorId,
        actor_username: actor?.username ?? null,
        actor_full_name: actor?.full_name ?? null,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
        metadata: {
          targetType: "worker",
          targetWorkerId: worker.id,
          targetWorkerCode: worker.labor_code,
        },
      },
      transaction
    );

    return {
      message: "Password reset successfully.",
    };
  });
}

// Function จัดการ latest timestamp ใน service flow
function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

const ADMIN_WORKER_STATUS_ORDER: Record<AdminWorkerBoardStatus, number> = {
  [WORKER_WORK_STATUS.OPEN_APP]: 0,
  [WORKER_WORK_STATUS.READY]: 1,
  [WORKER_WORK_STATUS.ASSIGNED]: 2,
  [WORKER_WORK_STATUS.WAITING_TEAM]: 3,
  [WORKER_WORK_STATUS.WORKING]: 4,
  [WORKER_WORK_STATUS.BREAK]: 5,
};

// Function จัดการ timestamp เป็น sort value ใน service flow
function timestampToSortValue(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

// Function ค้นหาหรือตัดสิน status entered at ใน service flow
function resolveStatusEnteredAt(
  status: AdminWorkerBoardStatus,
  queue: WorkerQueueEntryDto | null,
  assignment: VehicleJobAssignmentDto | null,
  presence: WorkerPresenceDto
): string | null {
  if (status === WORKER_WORK_STATUS.READY) {
    return queue?.ready_at ?? queue?.updated_at ?? presence.last_seen_at;
  }

  if (status === WORKER_WORK_STATUS.ASSIGNED) {
    return assignment?.accepted_at ?? assignment?.created_at ?? queue?.updated_at ?? presence.last_seen_at;
  }

  if (status === WORKER_WORK_STATUS.WORKING || status === WORKER_WORK_STATUS.WAITING_TEAM) {
    return assignment?.scanned_at ?? assignment?.updated_at ?? assignment?.accepted_at ?? queue?.updated_at ?? presence.last_seen_at;
  }

  if (status === WORKER_WORK_STATUS.BREAK) {
    return queue?.updated_at ?? presence.last_seen_at;
  }

  return queue?.updated_at ?? presence.last_seen_at;
}

// Function จัดการ compare admin worker status items ใน service flow
function compareAdminWorkerStatusItems(
  left: AdminWorkerStatusItem,
  right: AdminWorkerStatusItem
): number {
  const statusOrderDiff =
    ADMIN_WORKER_STATUS_ORDER[left.status] - ADMIN_WORKER_STATUS_ORDER[right.status];

  if (statusOrderDiff !== 0) {
    return statusOrderDiff;
  }

  if (left.status === WORKER_WORK_STATUS.READY && right.status === WORKER_WORK_STATUS.READY) {
    const leftQueuePosition = left.queue_position ?? Number.POSITIVE_INFINITY;
    const rightQueuePosition = right.queue_position ?? Number.POSITIVE_INFINITY;

    if (leftQueuePosition !== rightQueuePosition) {
      return leftQueuePosition - rightQueuePosition;
    }
  }

  const timestampDiff =
    timestampToSortValue(left.status_entered_at) -
    timestampToSortValue(right.status_entered_at);

  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return String(left.worker_code ?? "").localeCompare(String(right.worker_code ?? ""));
}

// Function ค้นหาหรือตัดสิน latest activity at ใน service flow
function resolveLatestActivityAt(
  queue: WorkerQueueEntryDto | null,
  assignment: VehicleJobAssignmentDto | null,
  presence: WorkerPresenceDto
): string | null {
  if (assignment) {
    return latestTimestamp([
      assignment.completed_at,
      assignment.scanned_at,
      assignment.accepted_at,
      assignment.updated_at,
      assignment.created_at,
      queue?.updated_at,
      presence.last_seen_at,
    ]);
  }

  if (queue?.status === WORKER_WORK_STATUS.READY) {
    return latestTimestamp([queue.ready_at, queue.updated_at, presence.last_seen_at]);
  }

  return latestTimestamp([queue?.updated_at, presence.last_seen_at]);
}

// Function จัดรูปแบบ admin worker status item ใน service flow
function formatAdminWorkerStatusItem(
  worker: MasterWorkerDto,
  schedule: WorkScheduleDto | null,
  queue: WorkerQueueEntryDto | null,
  assignment: VehicleJobAssignmentDto | null,
  presence: WorkerPresenceDto,
  queueRank: number | null = null,
  socketConnected = isWorkerSocketConnected(worker.id),
  teamScanReadiness: Pick<VehicleWorkReadinessDto, "is_ready"> | null = null,
  ticketNumber: string | null = null,
): AdminWorkerStatusItem {
  const scheduleWithShift = formatScheduleWithShift(schedule);
  const status = resolveWorkerWorkStatus(queue, assignment, teamScanReadiness);

  return {
    full_name: worker.full_name,
    worker_code: worker.labor_code,
    labor_color: worker.labor_color,
    coat_no: worker.coat_no,
    picture: worker.picture,
    shift_name: scheduleWithShift?.shift_name ?? null,
    latest_activity_at: resolveLatestActivityAt(queue, assignment, presence),
    status_entered_at: resolveStatusEnteredAt(status, queue, assignment, presence),
    queue_position: status === WORKER_WORK_STATUS.READY && queueRank !== null ? queueRank + 1 : null,
    socket_connected: socketConnected,
    status,
    assignment: assignment
      ? {
          ticket_number: ticketNumber,
          status: assignment.status,
          created_at: assignment.created_at,
          accepted_at: assignment.accepted_at,
          accept_deadline_at: assignment.accept_deadline_at,
          accept_deadline_unix_ms: toUnixMs(assignment.accept_deadline_at),
          scan_deadline_at: assignment.scan_deadline_at,
        }
      : null,
  };
}

// Function สร้าง admin worker status summary ใน service flow
function buildAdminWorkerStatusSummary(items: AdminWorkerStatusItem[]): {
  total: number;
  open_app: number;
  ready: number;
  assigned: number;
  waiting_team: number;
  working: number;
  break: number;
} {
  return items.reduce(
    (summary, item) => {
      summary.total += 1;
      if (item.status === WORKER_WORK_STATUS.OPEN_APP) {
        summary.open_app += 1;
      } else if (item.status === WORKER_WORK_STATUS.READY) {
        summary.ready += 1;
      } else if (item.status === WORKER_WORK_STATUS.ASSIGNED) {
        summary.assigned += 1;
      } else if (item.status === WORKER_WORK_STATUS.WAITING_TEAM) {
        summary.waiting_team += 1;
      } else if (item.status === WORKER_WORK_STATUS.WORKING) {
        summary.working += 1;
      } else if (item.status === WORKER_WORK_STATUS.BREAK) {
        summary.break += 1;
      }

      return summary;
    },
    {
      total: 0,
      open_app: 0,
      ready: 0,
      assigned: 0,
      waiting_team: 0,
      working: 0,
      break: 0,
    }
  );
}

// Function ดึง admin worker status ใน service flow
async function getAdminWorkerStatus(idParam: unknown): Promise<AdminWorkerStatusItem> {
  const worker = await requireWorker(
    typeof idParam === "number" ? idParam : String(idParam)
  );

  const [currentSchedule, queueEntry, assignment, presence, queueRanks] = await Promise.all([
    Promise.resolve(scheduleFromWorker(worker)),
    getWorkerQueueStatus(worker.id),
    assignmentRepository.findCurrentAssignmentByWorker(worker.id),
    getWorkerPresence(worker.id),
    getWorkerReadyQueueRanks([worker.id]),
  ]);
  const [teamScanReadiness, vehicleJob] = assignment
    ? await Promise.all([
        assignmentRepository.getVehicleJobTeamScanReadiness(
          assignment.vehicle_job_id,
        ),
        vehicleJobRepository.findVehicleJobById(assignment.vehicle_job_id),
      ])
    : [null, null];

  return formatAdminWorkerStatusItem(
    worker,
    currentSchedule,
    queueEntry,
    assignment,
    presence,
    queueRanks.get(worker.id) ?? null,
    isWorkerSocketConnected(worker.id),
    teamScanReadiness,
    vehicleJob?.ticket_number ?? null,
  );
}

// Function ดึงรายการ admin worker statuses ใน service flow
export async function listAdminWorkerStatuses(): Promise<{
  summary: ReturnType<typeof buildAdminWorkerStatusSummary>;
  data: AdminWorkerStatusItem[];
}> {
  const workers = await workerRepository.listUsers({ offset: 0, limit: Number.MAX_SAFE_INTEGER });
  const workerIds = workers.map((worker) => worker.id);
  const [queueStatuses, queueRanks, presences, assignments, settings] = await Promise.all([
    getWorkerQueueStatuses(workerIds),
    getWorkerReadyQueueRanks(workerIds),
    getWorkerPresences(workerIds),
    Promise.all(
      workerIds.map((workerId) =>
        assignmentRepository.findCurrentAssignmentByWorker(workerId)
      )
    ),
    getRuntimeSettings(),
  ]);
  const assignmentMap = new Map<number, VehicleJobAssignmentDto | null>();

  workerIds.forEach((workerId, index) => {
    assignmentMap.set(workerId, assignments[index] ?? null);
  });
  const vehicleJobIds = Array.from(
    new Set(
      assignments
        .filter(
          (assignment): assignment is VehicleJobAssignmentDto =>
            assignment !== null,
        )
        .map((assignment) => assignment.vehicle_job_id),
    ),
  );
  const teamScanReadinessEntries = await Promise.all(
    vehicleJobIds.map(async (vehicleJobId) => [
      vehicleJobId,
      await assignmentRepository.getVehicleJobTeamScanReadiness(vehicleJobId),
    ] as const),
  );
  const teamScanReadinessMap = new Map(teamScanReadinessEntries);
  const vehicleJobEntries = await Promise.all(
    vehicleJobIds.map(async (vehicleJobId) => [
      vehicleJobId,
      await vehicleJobRepository.findVehicleJobById(vehicleJobId),
    ] as const),
  );
  const vehicleJobTicketNumberMap = new Map(
    vehicleJobEntries.map(([vehicleJobId, vehicleJob]) => [
      vehicleJobId,
      vehicleJob?.ticket_number ?? null,
    ]),
  );

  const data = workers
    .map((worker) => {
      const schedule = scheduleFromWorker(worker);
      const presence =
        presences.get(worker.id) ?? {
          is_online: false,
          last_seen_at: null,
          stale_after_seconds: settings.worker_presence_stale_seconds,
        };

      const queue = queueStatuses.get(worker.id) ?? null;
      const assignment = assignmentMap.get(worker.id) ?? null;
      const socketConnected = isWorkerSocketConnected(worker.id);

      return {
        worker,
        assignment,
        presence,
        queue,
        schedule,
        item: formatAdminWorkerStatusItem(
          worker,
          schedule,
          queue,
          assignment,
          presence,
          queueRanks.get(worker.id) ?? null,
          socketConnected,
          assignment
            ? teamScanReadinessMap.get(assignment.vehicle_job_id) ?? null
            : null,
          assignment
            ? vehicleJobTicketNumberMap.get(assignment.vehicle_job_id) ?? null
            : null,
        ),
      };
    })
    .filter(({ worker, assignment, presence, queue, schedule }) => {
      const hasVisibleWorkerFlow =
        presence.is_online ||
        assignment !== null ||
        (queue !== null && queue.status !== WORKER_WORK_STATUS.OPEN_APP);

      return (
        worker.status === 1 &&
        hasVisibleWorkerFlow &&
        schedule !== null &&
        isTimeInWorkSchedule(schedule)
      );
    })
    .map(({ item }) => item)
    .sort(compareAdminWorkerStatusItems);

  return {
    summary: buildAdminWorkerStatusSummary(data),
    data,
  };
}

// Function จัดการ force admin worker status ใน service flow
export async function forceAdminWorkerStatus(
  idParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<{
  message: string;
  full_name: string | null;
  worker_code: string;
  status: AdminWorkerBoardStatus;
}> {
  const input = parseWithSchema(adminForceWorkerStatusBodySchema, body);
  const actorId = requireActorId(auth);
  const settings = await getRuntimeSettings();
  const worker = await requireWorker(
    typeof idParam === "number" ? idParam : String(idParam)
  );

  if (worker.status !== 1) {
    throw new ApiError(403, "WORKER_NOT_ACTIVE", "Worker account is not active.");
  }

  if (!isWorkerSocketConnected(worker.id)) {
    throw new ApiError(
      409,
      "WORKER_NOT_ONLINE",
      "Worker WebSocket is not connected. Admin can force status only for online workers."
    );
  }

  const [queueEntry, currentAssignment] = await Promise.all([
    getWorkerQueueStatus(worker.id),
    assignmentRepository.findCurrentAssignmentByWorker(worker.id),
  ]);
  const currentSchedule = scheduleFromWorker(worker);

  // Admin ห้าม Force สถานะใดๆ (ready/open_app/break) ให้ worker ที่อยู่นอกเวลากะเด็ดขาด — ต้องแก้เวลา
  // กะใน DB ให้ครอบคลุมเวลาปัจจุบันก่อน ถึงจะ Force ได้ กันไม่ให้เกิดคนอยู่ในคิว/ทำงานได้นอกเวลากะโดยไม่มี
  // shift-end job มาดีดออก
  if (!currentSchedule || !isTimeInWorkSchedule(currentSchedule)) {
    throw new ApiError(
      403,
      "WORKER_OUTSIDE_WORK_SHIFT",
      "Cannot force worker status while the worker is outside their work shift. Fix the worker's shift time first.",
      currentSchedule ? buildShiftWaitInfo(currentSchedule) : undefined
    );
  }

  if (
    currentAssignment &&
    !(input.status === WORKER_WORK_STATUS.READY && currentAssignment.status === ASSIGNMENT_STATUS.DELIVERED)
  ) {
    throw new ApiError(
      409,
      "WORKER_HAS_ACTIVE_ASSIGNMENT",
      "Worker has an active assignment. Cancel or finish the assignment before forcing worker status."
    );
  }

  if (queueEntry?.status === WORKER_WORK_STATUS.BREAK && currentSchedule) {
    await removeWorkerBreakReturn(worker.id, currentSchedule.id);
  }

  if (input.status === WORKER_WORK_STATUS.READY) {
    await enqueueWorker(worker.id);
    await dispatchReadyWorkers();
  }

  if (input.status === WORKER_WORK_STATUS.OPEN_APP) {
    await markWorkerOpenApp(worker.id);
  }

  if (input.status === WORKER_WORK_STATUS.BREAK) {
    if (queueEntry?.status !== WORKER_WORK_STATUS.BREAK) {
      const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);
      const currentBreakCount = await getWorkerBreakCount(
        worker.id,
        shiftInstanceKey
      );

      if (currentBreakCount >= settings.worker_break_limit) {
        throw new ApiError(
          409,
          "BREAK_LIMIT_REACHED",
          "Worker break limit reached for this shift."
        );
      }

      await incrementWorkerBreakCount(worker.id, shiftInstanceKey);
    }

    const breakDurationMs = settings.worker_break_duration_minutes * 60 * 1000;
    const breakUntil = buildDeadline(breakDurationMs);
    await markWorkerBreak(worker.id, breakUntil);
    await scheduleWorkerBreakReturn(
      worker.id,
      currentSchedule.id,
      breakDurationMs
    );
  }

  // vehicle_job_id เป็น null ได้ปกติ — ส่วนใหญ่ Admin Force สถานะ Worker ที่ว่างงานอยู่ ไม่มี
  // VehicleJob ให้ผูกเลย (currentAssignment มีค่าเฉพาะกรณี Force READY บน assignment DELIVERED)
  await adminActionLogRepository.create({
    vehicle_job_id: currentAssignment?.vehicle_job_id ?? null,
    action_type: ADMIN_ACTION_TYPE.WORKER_STATUS_FORCED,
    reason_code: input.reason_code ?? null,
    reason_text: input.reason_text ?? null,
    actor_account_id: actorId,
    metadata: {
      worker_id: worker.id,
      worker_code: worker.labor_code,
      status: input.status,
      previous_status: queueEntry?.status ?? null,
    },
  });

  const [latest, latestQueue, latestAssignment] = await Promise.all([
    getAdminWorkerStatus(worker.id),
    getWorkerQueueStatus(worker.id),
    assignmentRepository.findCurrentAssignmentByWorker(worker.id),
  ]);
  const latestAssignmentPayload = await buildWorkerAssignmentSocketPayload(
    latestAssignment
  );
  sendWorkerSocketEvent(worker.id, "WORKER_STATUS_CHANGED", {
    queue: buildWorkerQueueSocketPayload(
      latestQueue,
      latest.worker_code,
      latestAssignment
    ),
    current_assignment: latestAssignmentPayload,
    reason: "admin_force_status",
  });
  publishAdminWorkerStatusChanged({
    title: "Worker status forced",
    message: `Worker ${latest.full_name ?? latest.worker_code} status was forced by admin.`,
    workerCode: latest.worker_code,
    queue: latestQueue,
    assignment: latestAssignment,
    reason: "admin_force_status",
    extraPayload: {
      current_assignment: latestAssignmentPayload,
    },
  });

  return {
    message: "Worker status forced successfully.",
    full_name: latest.full_name,
    worker_code: latest.worker_code,
    status: latest.status,
  };
}
