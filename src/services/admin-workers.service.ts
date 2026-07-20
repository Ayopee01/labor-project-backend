import { withTransaction } from "../db/prisma";
import { enqueueWorker, getWorkerBreakCount, getWorkerPresence, getWorkerPresences, getWorkerQueueStatus, getWorkerQueueStatuses, getWorkerReadyQueueRanks, incrementWorkerBreakCount, markWorkerBreak, markWorkerOpenApp, removeWorkerBreakReturn, scheduleWorkerBreakReturn } from "../queues/worker-queue";
import { accountRepository, profileRepository, sessionRepository, workScheduleRepository } from "../repositories/admin-workers.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import { getRuntimeSettings } from "./admin-settings.service";
import { publishNotification } from "./notifications.service";
import type { AccessTokenPayload } from "../types/auth.type";
import type { DbConnection } from "../types/common.type";
import type { AccountDto, AdminWorkerBoardStatus, AdminWorkerStatusItem, PaginationFilters, PaginationMeta, ProfileDto, ProfileUpdateInput, UserDetailResponse, UserListItem, UserListFilters, UserListSchedule, WorkScheduleDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import type { VehicleJobAssignmentDto, WorkerPresenceDto, WorkerQueueEntryDto } from "../types/worker.type";
import { parseWithSchema, parseWorkScheduleInput, parseWorkScheduleInputs } from "../validation/parser";
import { adminForceWorkerStatusBodySchema, createUserBodySchema, paginationQuerySchema, resetPasswordBodySchema, updateUserBodySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";
import { hashPassword } from "../utils/password";
import { buildWorkScheduleShiftInstanceKey, findActiveWorkSchedule, formatScheduleWithShift, formatSchedulesWithShift, isTimeInWorkSchedule } from "../utils/shift";
import { buildDeadline, formatBangkokDate } from "../utils/time";
import { buildWorkerQueueSocketPayload } from "../utils/worker-queue-payload";
import { buildWorkerCode } from "../utils/worker-code";
import { resolveWorkerWorkStatus } from "../utils/worker-status";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง payload assignment ปัจจุบันสำหรับ Admin worker status
async function buildWorkerAssignmentSocketPayload(
  assignment: VehicleJobAssignmentDto | null
) {
  if (!assignment) {
    return null;
  }

  const vehicleJob = await workerApplicationRepository.findVehicleJobById(
    assignment.vehicle_job_id
  );

  return {
    vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
    status: assignment.status,
    accept_deadline_at: assignment.accept_deadline_at,
    scan_deadline_at: assignment.scan_deadline_at,
    accepted_at: assignment.accepted_at,
    scanned_at: assignment.scanned_at,
    completed_at: assignment.completed_at,
  };
}

// Function ค้นหา account ประเภท user และโยน error หากไม่พบ
async function requireUserAccount(
  id: number | string,
  connection?: DbConnection
): Promise<AccountDto> {
  const account =
    typeof id === "number"
      ? await accountRepository.findUserById(id, connection)
      : await accountRepository.findUserByIdentifier(id, connection);

  if (!account) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  }

  return account;
}

// Function ดึง id ของผู้ใช้งานที่เป็นผู้ทำรายการ
function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
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

// Function จัดรูปแบบตารางงานแบบย่อสำหรับหน้า list ให้ไม่ส่ง field ภายในที่ UI ไม่ต้องใช้
function formatUserListSchedule(
  schedule: WorkScheduleWithShiftDto | null
): UserListSchedule | null {
  if (!schedule) {
    return null;
  }

  return {
    shift_no: schedule.shift_no,
    work_date: schedule.work_date,
    shift_start_time: schedule.shift_start_time,
    shift_end_time: schedule.shift_end_time,
    shift_name: schedule.shift_name,
  };
}

function formatUserListSchedules(
  schedules: WorkScheduleDto[]
): UserListSchedule[] {
  return formatSchedulesWithShift(schedules).map((schedule) => ({
    shift_no: schedule.shift_no,
    work_date: schedule.work_date,
    shift_start_time: schedule.shift_start_time,
    shift_end_time: schedule.shift_end_time,
    shift_name: schedule.shift_name,
  }));
}

// Function จัดรูปแบบข้อมูล user สำหรับหน้า list
async function formatUserListItem(
  account: AccountDto,
  connection?: DbConnection
): Promise<UserListItem> {
  const [profile, currentWorkSchedules] = await Promise.all([
    profileRepository.findByAccountId(account.id, connection),
    workScheduleRepository.listCurrentByAccountId(account.id, connection),
  ]);
  const currentWorkSchedule =
    findActiveWorkSchedule(currentWorkSchedules) ?? currentWorkSchedules[0] ?? null;

  return {
    worker_code: account.username,
    shirt_number: profile?.shirt_number ?? null,
    full_name: account.full_name,
    work_schedule: formatUserListSchedule(formatScheduleWithShift(currentWorkSchedule)),
    work_schedules: formatUserListSchedules(currentWorkSchedules),
    status: account.status,
    updated_at: account.updated_at,
  };
}

// Function จัดรูปแบบข้อมูล user แบบละเอียด
async function formatUserDetail(
  account: AccountDto,
  connection?: DbConnection
): Promise<UserDetailResponse> {
  const [profile, currentWorkSchedules] = await Promise.all([
    profileRepository.findByAccountId(account.id, connection),
    workScheduleRepository.listCurrentByAccountId(account.id, connection),
  ]);
  const currentWorkSchedule =
    findActiveWorkSchedule(currentWorkSchedules) ?? currentWorkSchedules[0] ?? null;
  const schedule = formatScheduleWithShift(currentWorkSchedule);

  return {
    image_url: profile?.image_url ?? null,
    worker_code: account.username,
    full_name: account.full_name,
    status: account.status,
    details: {
      phone: account.phone,
      position: account.position,
      nationality: profile?.nationality ?? null,
      shirt_number: profile?.shirt_number ?? null,
      shirt_type: profile?.shirt_type ?? null,
      work_date: schedule?.work_date ?? null,
      shift_start_time: schedule?.shift_start_time ?? null,
      shift_end_time: schedule?.shift_end_time ?? null,
      shift_name: schedule?.shift_name ?? null,
      work_schedules: formatUserListSchedules(currentWorkSchedules),
    },
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

async function assertShirtNumberAvailable(
  shirtNumber: string,
  exceptAccountId?: number | null,
  connection?: DbConnection
): Promise<void> {
  const exists = await profileRepository.shirtNumberExists(
    shirtNumber,
    exceptAccountId,
    connection
  );

  if (exists) {
    throw new ApiError(
      409,
      "SHIRT_NUMBER_ALREADY_EXISTS",
      "Shirt number already exists."
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
    img,
    image_url: imageUrl,
    full_name: fullName,
    phone,
    nationality,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
    work_start_date: workStartDate,
    status,
    work_schedule: workScheduleInput,
    work_schedules: workSchedulesInput,
  } = parseWithSchema(createUserBodySchema, body);
  const workerCode = buildWorkerCode({
    nationality,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
  });
  const username = requestedUsername ?? workerCode;
  const initialWorkStartDate = workStartDate;
  const initialScheduleInputs = (workSchedulesInput ?? (workScheduleInput ? [workScheduleInput] : []))
    .map((scheduleInput) => ({
      ...scheduleInput,
      work_date: scheduleInput.work_date ?? initialWorkStartDate,
    }));
  const profileInput = {
    image_url: imageUrl ?? img ?? null,
    nationality,
    work_start_date: initialWorkStartDate,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
  };
  const actorId = getActorId(auth);

  return withTransaction(async (transaction) => {
    await assertUsernameAvailable(username, null, transaction);
    await assertShirtNumberAvailable(shirtNumber, null, transaction);

    const account = await accountRepository.create(
      {
        username,
        password_hash: await hashPassword(phone),
        role: "worker",
        status,
        full_name: fullName,
        position: null,
        phone,
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

    for (const [index, initialScheduleInput] of initialScheduleInputs.entries()) {
      await workScheduleRepository.create(
        {
          account_id: account.id,
          shift_no: index + 1,
          ...initialScheduleInput,
          is_current: true,
          created_by: actorId,
          updated_by: actorId,
        },
        transaction
      );
    }

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
    worker_code: requestedWorkerCode,
    image_url: imageUrl,
    img,
    full_name: nextFullName,
    phone,
    nationality,
    position,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
    work_start_date: workStartDate,
    work_date: workDate,
    shift_start_time: shiftStartTime,
    shift_end_time: shiftEndTime,
    profile: profileInput,
    status,
    work_schedule: workScheduleBody,
    work_schedules: workSchedulesBody,
  } = parseWithSchema(updateUserBodySchema, body);
  const hasFlatScheduleInput =
    workDate !== undefined ||
    shiftStartTime !== undefined ||
    shiftEndTime !== undefined;
  const scheduleInputs =
    workSchedulesBody !== undefined
      ? parseWorkScheduleInputs(workSchedulesBody)
      : workScheduleBody !== undefined
        ? [parseWorkScheduleInput(workScheduleBody)]
        : hasFlatScheduleInput
          ? [
              parseWorkScheduleInput({
                work_date: workDate,
                shift_start_time: shiftStartTime,
                shift_end_time: shiftEndTime,
              }),
            ]
          : undefined;
  const actorId = getActorId(auth);

  return withTransaction(async (transaction) => {
    const account = await requireUserAccount(id, transaction);
    const currentProfile = await profileRepository.findByAccountId(
      account.id,
      transaction
    );
    let updatedAccount = account;
    const mergedProfileInput: ProfileUpdateInput = {
      ...(profileInput ?? {}),
    };

    if (imageUrl !== undefined || img !== undefined) {
      mergedProfileInput.image_url = imageUrl ?? img ?? null;
    }

    if (nationality !== undefined) {
      mergedProfileInput.nationality = nationality;
    }

    if (shirtType !== undefined) {
      mergedProfileInput.shirt_type = shirtType;
    }

    if (shirtNumber !== undefined) {
      mergedProfileInput.shirt_number = shirtNumber;
    }

    if (workStartDate !== undefined) {
      mergedProfileInput.work_start_date = workStartDate;
    }

    const shouldRegenerateWorkerCode =
      requestedWorkerCode === undefined &&
      (mergedProfileInput.nationality !== undefined ||
        mergedProfileInput.shirt_type !== undefined ||
        mergedProfileInput.shirt_number !== undefined);
    const nextNationality =
      mergedProfileInput.nationality ?? currentProfile?.nationality;
    const nextShirtType =
      mergedProfileInput.shirt_type ?? currentProfile?.shirt_type;
    const nextShirtNumber =
      mergedProfileInput.shirt_number ?? currentProfile?.shirt_number;
    const nextWorkerCode =
      requestedWorkerCode ??
      (shouldRegenerateWorkerCode
        ? nextNationality && nextShirtType && nextShirtNumber
          ? buildWorkerCode({
              nationality: nextNationality,
              shirt_type: nextShirtType,
              shirt_number: nextShirtNumber,
            })
          : undefined
        : undefined);
    const hasProfileInput = hasProfileUpdates(mergedProfileInput);

    if (shouldRegenerateWorkerCode && nextWorkerCode === undefined) {
      throw new ApiError(
        400,
        "WORKER_CODE_FIELDS_REQUIRED",
        "nationality, shirt_type, and shirt_number are required to generate worker_code."
      );
    }

    if (nextWorkerCode !== undefined) {
      await assertWorkerCodeAvailable(
        nextWorkerCode,
        account.id,
        transaction
      );
    }

    if (
      mergedProfileInput.shirt_number !== undefined &&
      mergedProfileInput.shirt_number !== null
    ) {
      await assertShirtNumberAvailable(
        mergedProfileInput.shirt_number,
        account.id,
        transaction
      );
    }

    if (hasProfileInput) {
      await profileRepository.updateByAccountId(
        account.id,
        mergedProfileInput,
        transaction
      );
    }

    if (
      hasProfileInput ||
      (nextFullName !== undefined && nextFullName !== "") ||
      position !== undefined ||
      nextWorkerCode !== undefined ||
      phone !== undefined
    ) {
      updatedAccount = await accountRepository.updateUserAccount(
        account.id,
        {
          username: nextWorkerCode,
          full_name:
            nextFullName !== undefined && nextFullName !== ""
              ? nextFullName
              : undefined,
          position,
          phone,
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

    if (scheduleInputs !== undefined) {
      const profileForSchedule = hasProfileInput
        ? await profileRepository.findByAccountId(account.id, transaction)
        : currentProfile;
      const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
        account.id,
        transaction
      );
      const fallbackWorkDate =
        currentSchedule?.work_date ??
        profileForSchedule?.work_start_date ??
        formatBangkokDate();

      await workScheduleRepository.deleteCurrentByAccountId(account.id, transaction);

      for (const [index, scheduleInput] of scheduleInputs.entries()) {
        await workScheduleRepository.create(
          {
            account_id: account.id,
            shift_no: index + 1,
            ...scheduleInput,
            work_date: scheduleInput.work_date ?? fallbackWorkDate,
            is_current: true,
            created_by: actorId,
            updated_by: actorId,
          },
          transaction
        );
      }
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
// Function สรุปจำนวน worker ตามสถานะ queue และ heartbeat
// Function เลือกเวลาล่าสุดจาก timestamp ใน flow การทำงานของ worker
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

// Function แปลง queue/assignment status เป็น column สำหรับหน้าเข้าคิวแรงงาน
// Function หาเวลาล่าสุดของขั้นตอนปัจจุบัน เช่น เข้าแอป เข้าคิว รับงาน สแกน QR หรือพัก
const ADMIN_WORKER_STATUS_ORDER = {
  open_app: 0,
  ready: 1,
  assigned: 2,
  working: 3,
  break: 4,
} as const;

function timestampToSortValue(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function resolveStatusEnteredAt(
  status: AdminWorkerBoardStatus,
  queue: WorkerQueueEntryDto | null,
  assignment: VehicleJobAssignmentDto | null,
  presence: WorkerPresenceDto
): string | null {
  if (status === "ready") {
    return queue?.ready_at ?? queue?.updated_at ?? presence.last_seen_at;
  }

  if (status === "assigned") {
    return assignment?.accepted_at ?? assignment?.created_at ?? queue?.updated_at ?? presence.last_seen_at;
  }

  if (status === "working") {
    return assignment?.scanned_at ?? assignment?.updated_at ?? assignment?.accepted_at ?? queue?.updated_at ?? presence.last_seen_at;
  }

  if (status === "break") {
    return queue?.updated_at ?? presence.last_seen_at;
  }

  return queue?.updated_at ?? presence.last_seen_at;
}

function compareAdminWorkerStatusItems(
  left: AdminWorkerStatusItem,
  right: AdminWorkerStatusItem
): number {
  const statusOrderDiff =
    ADMIN_WORKER_STATUS_ORDER[left.status] - ADMIN_WORKER_STATUS_ORDER[right.status];

  if (statusOrderDiff !== 0) {
    return statusOrderDiff;
  }

  if (left.status === "ready" && right.status === "ready") {
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

  if (queue?.status === "ready") {
    return latestTimestamp([queue.ready_at, queue.updated_at, presence.last_seen_at]);
  }

  return latestTimestamp([queue?.updated_at, presence.last_seen_at]);
}

// Function จัดรูปแบบ worker status item สำหรับ board โดยไม่ส่ง account/profile ดิบ
function formatAdminWorkerStatusItem(
  account: AccountDto,
  profile: ProfileDto | null,
  schedule: WorkScheduleDto | null,
  queue: WorkerQueueEntryDto | null,
  assignment: VehicleJobAssignmentDto | null,
  presence: WorkerPresenceDto,
  queueRank: number | null = null
): AdminWorkerStatusItem {
  const scheduleWithShift = formatScheduleWithShift(schedule);
  const status = resolveWorkerWorkStatus(queue, assignment);

  return {
    full_name: account.full_name,
    worker_code: account.username,
    shirt_number: profile?.shirt_number ?? null,
    image_url: profile?.image_url ?? null,
    shift_name: scheduleWithShift?.shift_name ?? null,
    latest_activity_at: resolveLatestActivityAt(queue, assignment, presence),
    status_entered_at: resolveStatusEnteredAt(status, queue, assignment, presence),
    queue_position: status === "ready" && queueRank !== null ? queueRank + 1 : null,
    status,
  };
}

// Function สรุปจำนวน worker ในแต่ละสถานะสำหรับหน้า Admin worker board
function buildAdminWorkerStatusSummary(items: AdminWorkerStatusItem[]): {
  total: number;
  open_app: number;
  ready: number;
  assigned: number;
  working: number;
  break: number;
} {
  return items.reduce(
    (summary, item) => {
      summary.total += 1;
      if (item.status === "open_app") {
        summary.open_app += 1;
      } else if (item.status === "ready") {
        summary.ready += 1;
      } else if (item.status === "assigned") {
        summary.assigned += 1;
      } else if (item.status === "working") {
        summary.working += 1;
      } else if (item.status === "break") {
        summary.break += 1;
      }

      return summary;
    },
    {
      total: 0,
      open_app: 0,
      ready: 0,
      assigned: 0,
      working: 0,
      break: 0,
    }
  );
}

// Function ให้ Admin ดูสถานะ worker รายคน
export async function getAdminWorkerStatus(idParam: unknown): Promise<AdminWorkerStatusItem> {
  const account = await requireUserAccount(
    typeof idParam === "number" ? idParam : String(idParam)
  );

  const [profile, currentSchedule, queueEntry, assignment, presence, queueRanks] = await Promise.all([
    profileRepository.findByAccountId(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
    getWorkerPresence(account.id),
    getWorkerReadyQueueRanks([account.id]),
  ]);

  return formatAdminWorkerStatusItem(
    account,
    profile,
    currentSchedule,
    queueEntry,
    assignment,
    presence,
    queueRanks.get(account.id) ?? null
  );
}

// Function ให้ Admin ดูสถานะ worker ทั้งหมด
export async function listAdminWorkerStatuses(): Promise<{
  summary: ReturnType<typeof buildAdminWorkerStatusSummary>;
  data: AdminWorkerStatusItem[];
}> {
  const accounts = await accountRepository.listAllUsers();
  const accountIds = accounts.map((account) => account.id);
  const [queueStatuses, queueRanks, presences, assignments, profiles, schedules, settings] = await Promise.all([
    getWorkerQueueStatuses(accountIds),
    getWorkerReadyQueueRanks(accountIds),
    getWorkerPresences(accountIds),
    Promise.all(
      accountIds.map((accountId) =>
        workerApplicationRepository.findCurrentAssignmentByWorker(accountId)
      )
    ),
    profileRepository.findByAccountIds(accountIds),
    Promise.all(
      accountIds.map((accountId) =>
        workScheduleRepository.findCurrentByAccountId(accountId)
      )
    ),
    getRuntimeSettings(),
  ]);
  const assignmentMap = new Map<number, VehicleJobAssignmentDto | null>();
  const profileMap = new Map<number, ProfileDto | null>();
  const scheduleMap = new Map<number, WorkScheduleDto | null>();

  accountIds.forEach((accountId, index) => {
    assignmentMap.set(accountId, assignments[index] ?? null);
    scheduleMap.set(accountId, schedules[index] ?? null);
  });
  profiles.forEach((profile) => {
    profileMap.set(profile.account_id, profile);
  });

  const data = accounts
    .map((account) => {
      const schedule = scheduleMap.get(account.id) ?? null;
      const presence =
        presences.get(account.id) ?? {
          is_online: false,
          last_seen_at: null,
          stale_after_seconds: settings.worker_presence_stale_seconds,
        };

      return {
        account,
        presence,
        schedule,
        item: formatAdminWorkerStatusItem(
          account,
          profileMap.get(account.id) ?? null,
          schedule,
          queueStatuses.get(account.id) ?? null,
          assignmentMap.get(account.id) ?? null,
          presence,
          queueRanks.get(account.id) ?? null
        ),
      };
    })
    .filter(({ account, presence, schedule }) =>
      account.status === "active" &&
      presence.is_online &&
      schedule !== null &&
      isTimeInWorkSchedule(schedule)
    )
    .map(({ item }) => item)
    .sort(compareAdminWorkerStatusItems);

  return {
    summary: buildAdminWorkerStatusSummary(data),
    data,
  };
}

// Function ให้ Admin บังคับสถานะ worker เมื่อ worker ติดต่อให้ช่วยจัดการ
export async function forceAdminWorkerStatus(
  idParam: unknown,
  body: unknown
): Promise<AdminWorkerStatusItem & { message: string }> {
  const input = parseWithSchema(adminForceWorkerStatusBodySchema, body);
  const settings = await getRuntimeSettings();
  const account = await requireUserAccount(
    typeof idParam === "number" ? idParam : String(idParam)
  );

  if (account.status !== "active") {
    throw new ApiError(403, "WORKER_NOT_ACTIVE", "Worker account is not active.");
  }

  const [queueEntry, currentAssignment, currentSchedule] = await Promise.all([
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
  ]);

  if (
    currentAssignment &&
    !(input.status === "ready" && currentAssignment.status === "DELIVERED")
  ) {
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

  if (input.status === "open_app") {
    await markWorkerOpenApp(account.id);
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
      const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);
      const currentBreakCount = await getWorkerBreakCount(
        account.id,
        shiftInstanceKey
      );

      if (currentBreakCount >= settings.worker_break_limit) {
        throw new ApiError(
          409,
          "BREAK_LIMIT_REACHED",
          "Worker break limit reached for this shift."
        );
      }

      await incrementWorkerBreakCount(account.id, shiftInstanceKey);
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

  const [latest, latestQueue, latestAssignment] = await Promise.all([
    getAdminWorkerStatus(account.id),
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
  ]);
  const latestAssignmentPayload = await buildWorkerAssignmentSocketPayload(
    latestAssignment
  );
  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: buildWorkerQueueSocketPayload(
      latestQueue,
      latest.worker_code,
      latestAssignment
    ),
    current_assignment: latestAssignmentPayload,
    reason: "admin_force_status",
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker status forced",
    message: `Worker ${account.full_name} status was forced by admin.`,
    payload: {
      worker_account_id: account.id,
      queue: buildWorkerQueueSocketPayload(
        latestQueue,
        latest.worker_code,
        latestAssignment
      ),
      current_assignment: latestAssignment,
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
