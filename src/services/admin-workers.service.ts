import { withTransaction } from "../db/prisma";
import { enqueueWorker, getWorkerBreakCount, getWorkerPresence, getWorkerPresences, getWorkerQueueStatus, getWorkerQueueStatuses, incrementWorkerBreakCount, markWorkerBreak, markWorkerOffline, markWorkerWaiting, removeWorkerBreakReturn, scheduleWorkerBreakReturn } from "../queues/worker-queue";
import { accountRepository, profileRepository, sessionRepository, workScheduleRepository } from "../repositories/admin-workers.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import { getRuntimeSettings } from "./admin-settings.service";
import { publishNotification } from "./notifications.service";
import type { AccessTokenPayload, SessionDto } from "../types/auth.type";
import type { DbConnection } from "../types/common.type";
import type { AccountDto, AdminWorkerStatusItem, FormattedSession, PaginationFilters, PaginationMeta, SafeAccountDto, UserDetailResponse, UserListItem, UserListFilters } from "../types/admin-workers.type";
import type { VehicleJobAssignmentDto, WorkerPresenceDto, WorkerQueueEntryDto } from "../types/worker.type";
import { parseId, parseWithSchema, parseWorkScheduleInput } from "../validation/parser";
import { adminForceWorkerStatusBodySchema, createUserBodySchema, paginationQuerySchema, resetPasswordBodySchema, updateUserBodySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";
import { hashPassword } from "../utils/password";
import { formatScheduleWithShift } from "../utils/shift";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา account ประเภท user และโยน error หากไม่พบ
async function requireUserAccount(
  id: number | string,
  connection?: DbConnection
): Promise<AccountDto> {
  const accountId = parseId(id);
  const account = await accountRepository.findUserById(accountId, connection);

  if (!account) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  }

  return account;
}

// Function ดึง id ของผู้ใช้งานที่เป็นผู้ทำรายการ
function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
}

// Function จัดรูปแบบ session ให้ส่งเฉพาะข้อมูลที่ต้องใช้ใน response
function formatSession(session: SessionDto | null): FormattedSession | null {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    device_id: session.device_id,
    device_name: session.device_name,
    last_active_at: session.last_active_at,
  };
}

// Function สร้างข้อมูล pagination สำหรับ response แบบ list
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

// Function จัดรูปแบบข้อมูล user สำหรับหน้า list
async function formatUserListItem(
  account: AccountDto,
  connection?: DbConnection
): Promise<UserListItem> {
  const [profile, currentWorkSchedule] = await Promise.all([
    profileRepository.findByAccountId(account.id, connection),
    workScheduleRepository.findCurrentByAccountId(account.id, connection),
  ]);

  return {
    id: account.id,
    username: account.username,
    role: account.role,
    status: account.status,
    full_name: account.full_name,
    profile,
    current_work_schedule: formatScheduleWithShift(currentWorkSchedule),
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

// Function จัดรูปแบบข้อมูล user แบบละเอียด
async function formatUserDetail(
  account: AccountDto,
  connection?: DbConnection
): Promise<UserDetailResponse> {
  const [profile, currentWorkSchedule, activeSession] = await Promise.all([
    profileRepository.findByAccountId(account.id, connection),
    workScheduleRepository.findCurrentByAccountId(account.id, connection),
    sessionRepository.findActiveByAccountId(account.id, connection),
  ]);

  return {
    account: accountRepository.sanitizeAccount(account),
    profile,
    current_work_schedule: formatScheduleWithShift(currentWorkSchedule),
    active_session: formatSession(activeSession),
  };
}

// Function ตรวจสอบ username ว่ายังไม่ถูกใช้งาน
async function assertUsernameAvailable(
  username: string,
  exceptAccountId?: number | null,
  connection?: DbConnection
): Promise<void> {
  const exists = await accountRepository.usernameExists(
    username,
    exceptAccountId,
    connection
  );

  if (exists) {
    throw new ApiError(
      409,
      "USERNAME_ALREADY_EXISTS",
      "Username already exists."
    );
  }
}

// Function ตรวจสอบ worker code ว่ายังไม่ถูกใช้งาน
async function assertWorkerCodeAvailable(
  workerCode: string,
  exceptAccountId?: number | null,
  connection?: DbConnection
): Promise<void> {
  const exists = await profileRepository.workerCodeExists(
    workerCode,
    exceptAccountId,
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

// Function ยกเลิก session ที่ยัง active ของ user
async function revokeUserSessions(
  accountId: number,
  connection?: DbConnection
): Promise<void> {
  await sessionRepository.revokeActiveByAccountId(accountId, connection);
}

// Function ตรวจสอบว่า profile body มี field ที่ต้อง update หรือไม่
function hasProfileUpdates(profile: object): boolean {
  return Object.keys(profile).length > 0;
}

// Function สร้าง user พร้อม profile และ schedule เริ่มต้น
export async function createUser(body: unknown, auth?: AccessTokenPayload) {
  const {
    username: requestedUsername,
    password,
    img,
    image_url: imageUrl,
    full_name: fullName,
    phone,
    nationality,
    nationality_code: requestedNationalityCode,
    nationality_name: requestedNationalityName,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
    work_start_date: workStartDate,
    status,
    work_schedule: workScheduleInput,
  } = parseWithSchema(createUserBodySchema, body);
  const username = requestedUsername ?? phone;
  const initialPassword = password ?? phone;
  const initialWorkStartDate = workStartDate ?? workScheduleInput.work_date;
  const nationalityCode = requestedNationalityCode ?? "UNKNOWN";
  const nationalityName = requestedNationalityName ?? nationality;
  const profileInput = {
    worker_code: shirtNumber,
    image_url: imageUrl ?? img ?? null,
    nationality,
    nationality_code: nationalityCode,
    nationality_name: nationalityName,
    work_start_date: initialWorkStartDate,
    phone,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
  };
  const actorId = getActorId(auth);

  return withTransaction(async (transaction) => {
    await assertUsernameAvailable(username, null, transaction);
    await assertWorkerCodeAvailable(profileInput.worker_code, null, transaction);

    const account = await accountRepository.create(
      {
        username,
        password_hash: await hashPassword(initialPassword),
        role: "user",
        status,
        full_name: fullName,
        position: null,
        permission_level: null,
        created_by: actorId,
      },
      transaction
    );

    await profileRepository.create(
      {
        account_id: account.id,
        ...profileInput,
      },
      transaction
    );

    await workScheduleRepository.create(
      {
        account_id: account.id,
        ...workScheduleInput,
        is_current: true,
        created_by: actorId,
        updated_by: actorId,
      },
      transaction
    );

    return {
      message: "Worker created successfully.",
    };
  });
}

// Function ดึงรายการ user พร้อม pagination และ filter
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
    accountRepository.listUsers(filters),
    accountRepository.countUsers(filters),
  ]);
  const data = await Promise.all(users.map((user) => formatUserListItem(user)));

  return {
    data,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

// Function ดึงข้อมูล user รายคน
export async function getUser(id: number | string, _auth?: AccessTokenPayload) {
  const account = await requireUserAccount(id);

  return formatUserDetail(account);
}

// Function update ข้อมูล user รวมถึง profile และ schedule
export async function updateUser(
  id: number | string,
  body: unknown,
  auth?: AccessTokenPayload
) {
  const {
    full_name: nextFullName,
    profile: profileInput,
    status,
    work_schedule: workScheduleBody,
  } = parseWithSchema(updateUserBodySchema, body);
  const scheduleInput =
    workScheduleBody === undefined
      ? undefined
      : parseWorkScheduleInput(workScheduleBody);
  const actorId = getActorId(auth);

  return withTransaction(async (transaction) => {
    const account = await requireUserAccount(id, transaction);
    let updatedAccount = account;
    const hasProfileInput = profileInput !== undefined && hasProfileUpdates(profileInput);

    if (hasProfileInput) {
      if (profileInput.worker_code !== undefined) {
        await assertWorkerCodeAvailable(
          profileInput.worker_code,
          account.id,
          transaction
        );
      }

      await profileRepository.updateByAccountId(
        account.id,
        profileInput,
        transaction
      );
    }

    if (
      hasProfileInput ||
      (nextFullName !== undefined && nextFullName !== "")
    ) {
      updatedAccount = await accountRepository.updateUserAccount(
        account.id,
        {
          full_name:
            nextFullName !== undefined && nextFullName !== ""
              ? nextFullName
              : undefined,
        },
        transaction
      );
    }

    if (status !== undefined) {
      updatedAccount = await accountRepository.updateStatus(
        account.id,
        status,
        transaction
      );

      if (status === "inactive") {
        await revokeUserSessions(account.id, transaction);
      }
    }

    if (scheduleInput !== undefined) {
      let currentSchedule = await workScheduleRepository.updateCurrentByAccountId(
        account.id,
        {
          ...scheduleInput,
          updated_by: actorId,
        },
        transaction
      );

      if (!currentSchedule) {
        currentSchedule = await workScheduleRepository.create(
          {
            account_id: account.id,
            ...scheduleInput,
            is_current: true,
            created_by: actorId,
            updated_by: actorId,
          },
          transaction
        );
      }

      await workScheduleRepository.deleteOtherByAccountId(
        account.id,
        currentSchedule.id,
        transaction
      );
    }

    return formatUserDetail(updatedAccount, transaction);
  });
}

// Function reset password และบังคับ logout session เดิม
export async function resetPassword(
  id: number | string,
  body: unknown,
  _auth?: AccessTokenPayload
) {
  const { new_password: newPassword } = parseWithSchema(
    resetPasswordBodySchema,
    body
  );

  return withTransaction(async (transaction) => {
    const account = await requireUserAccount(id, transaction);

    await accountRepository.updatePassword(
      account.id,
      await hashPassword(newPassword),
      transaction
    );
    await revokeUserSessions(account.id, transaction);

    return {
      message: "Password reset successfully.",
    };
  });
}

// Function ดึงรายการตารางงานของ user พร้อม pagination
export async function listWorkSchedules(
  id: number | string,
  query: Record<string, unknown> = {},
  _auth?: AccessTokenPayload
) {
  const account = await requireUserAccount(id);
  const { page, limit } = parseWithSchema(paginationQuerySchema, query);
  const filters: PaginationFilters = {
    offset: (page - 1) * limit,
    limit,
  };
  const [schedules, total] = await Promise.all([
    workScheduleRepository.listByAccountId(account.id, filters),
    workScheduleRepository.countByAccountId(account.id),
  ]);

  return {
    data: schedules.map(formatScheduleWithShift),
    pagination: buildPaginationMeta(page, limit, total),
  };
}

// Function สร้างเวลา deadline จากเวลาปัจจุบัน
function buildDeadline(durationMs: number): Date {
  return new Date(Date.now() + durationMs);
}

// Function สรุปจำนวน worker ตามสถานะ queue และ heartbeat
function buildAdminWorkerStatusSummary(items: AdminWorkerStatusItem[]): {
  total: number;
  ready: number;
  waiting: number;
  break: number;
  busy: number;
  offline: number;
  alive: number;
  stale: number;
} {
  return items.reduce(
    (summary, item) => {
      const status = item.queue?.status ?? "offline";

      summary.total += 1;

      if (status === "ready") {
        summary.ready += 1;
      } else if (status === "waiting") {
        summary.waiting += 1;
      } else if (status === "break") {
        summary.break += 1;
      } else if (status === "busy") {
        summary.busy += 1;
      } else {
        summary.offline += 1;
      }

      if (item.presence.is_online) {
        summary.alive += 1;
      } else {
        summary.stale += 1;
      }

      return summary;
    },
    {
      total: 0,
      ready: 0,
      waiting: 0,
      break: 0,
      busy: 0,
      offline: 0,
      alive: 0,
      stale: 0,
    }
  );
}

// Function ให้ Admin ดูสถานะ worker รายคน
export async function getAdminWorkerStatus(idParam: unknown): Promise<AdminWorkerStatusItem> {
  const accountId = parseId(idParam);
  const account = await accountRepository.findUserById(accountId);

  if (!account) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  }

  const [queueEntry, assignment, presence] = await Promise.all([
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
    getWorkerPresence(account.id),
  ]);

  return {
    worker: accountRepository.sanitizeAccount(account),
    queue: queueEntry,
    current_assignment: assignment,
    presence,
  };
}

// Function ให้ Admin ดูสถานะ worker ทั้งหมด
export async function listAdminWorkerStatuses(): Promise<{
  summary: ReturnType<typeof buildAdminWorkerStatusSummary>;
  data: AdminWorkerStatusItem[];
}> {
  const accounts = await accountRepository.listAllUsers();
  const accountIds = accounts.map((account) => account.id);
  const [queueStatuses, presences, assignments, settings] = await Promise.all([
    getWorkerQueueStatuses(accountIds),
    getWorkerPresences(accountIds),
    Promise.all(
      accountIds.map((accountId) =>
        workerApplicationRepository.findCurrentAssignmentByWorker(accountId)
      )
    ),
    getRuntimeSettings(),
  ]);
  const assignmentMap = new Map<number, VehicleJobAssignmentDto | null>();

  accountIds.forEach((accountId, index) => {
    assignmentMap.set(accountId, assignments[index] ?? null);
  });

  const data = accounts.map((account) => ({
    worker: accountRepository.sanitizeAccount(account),
    queue: queueStatuses.get(account.id) ?? null,
    current_assignment: assignmentMap.get(account.id) ?? null,
    presence:
      presences.get(account.id) ?? {
        is_online: false,
        last_seen_at: null,
        stale_after_seconds: settings.worker_presence_stale_seconds,
      },
  }));

  return {
    summary: buildAdminWorkerStatusSummary(data),
    data,
  };
}

// Function ให้ Admin บังคับสถานะ worker เมื่อ worker ติดต่อให้ช่วยจัดการ
export async function forceAdminWorkerStatus(
  idParam: unknown,
  body: unknown
): Promise<{
  message: string;
  worker: SafeAccountDto;
  queue: WorkerQueueEntryDto | null;
  current_assignment: VehicleJobAssignmentDto | null;
  presence: WorkerPresenceDto;
}> {
  const accountId = parseId(idParam);
  const input = parseWithSchema(adminForceWorkerStatusBodySchema, body);
  const settings = await getRuntimeSettings();
  const account = await accountRepository.findUserById(accountId);

  if (!account) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  }

  if (account.status !== "active") {
    throw new ApiError(403, "WORKER_NOT_ACTIVE", "Worker account is not active.");
  }

  const [queueEntry, currentAssignment, currentSchedule] = await Promise.all([
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
  ]);

  if (currentAssignment) {
    throw new ApiError(
      409,
      "WORKER_HAS_ACTIVE_ASSIGNMENT",
      "Worker has an active assignment. Cancel or finish the assignment before forcing worker status."
    );
  }

  if (queueEntry?.status === "break" && currentSchedule) {
    await removeWorkerBreakReturn(account.id, currentSchedule.id);
  }

  if (input.status === "ready") {
    await enqueueWorker(account.id);
    await dispatchReadyWorkers();
  }

  if (input.status === "waiting") {
    await markWorkerWaiting(account.id);
  }

  if (input.status === "offline") {
    await markWorkerOffline(account.id);
  }

  if (input.status === "break") {
    if (!currentSchedule) {
      throw new ApiError(
        403,
        "WORK_SCHEDULE_NOT_FOUND",
        "Worker does not have a current work schedule."
      );
    }

    if (queueEntry?.status !== "break") {
      const currentBreakCount = await getWorkerBreakCount(
        account.id,
        currentSchedule.id
      );

      if (currentBreakCount >= settings.worker_break_limit) {
        throw new ApiError(
          409,
          "BREAK_LIMIT_REACHED",
          "Worker break limit reached for this shift."
        );
      }

      await incrementWorkerBreakCount(account.id, currentSchedule.id);
    }

    const breakDurationMs = settings.worker_break_duration_minutes * 60 * 1000;
    const breakUntil = buildDeadline(breakDurationMs);
    await markWorkerBreak(account.id, breakUntil);
    await scheduleWorkerBreakReturn(
      account.id,
      currentSchedule.id,
      breakDurationMs
    );
  }

  const latest = await getAdminWorkerStatus(account.id);
  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: latest.queue,
    current_assignment: latest.current_assignment,
    reason: "admin_force_status",
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker status forced",
    message: `Worker ${account.full_name} status was forced by admin.`,
    payload: {
      worker_account_id: account.id,
      queue: latest.queue,
      current_assignment: latest.current_assignment,
      reason: "admin_force_status",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Worker status forced successfully.",
    ...latest,
  };
}
