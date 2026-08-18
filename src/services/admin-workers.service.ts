import { withTransaction } from "../db/prisma";
import { enqueueWorker, getWorkerBreakCount, getWorkerPresence, getWorkerPresences, getWorkerQueueStatus, getWorkerQueueStatuses, getWorkerReadyQueueRanks, incrementWorkerBreakCount, markWorkerBreak, markWorkerOpenApp, removeWorkerBreakReturn, scheduleWorkerBreakReturn } from "../queues/worker-queue";
import { accountRepository, profileRepository, sessionRepository, workScheduleRepository } from "../repositories/admin-workers.repository";
import * as assignmentRepository from "../repositories/shared/vehicle-job-assignment.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import { getRuntimeSettings } from "./shared/runtime-settings.service";
import { publishAdminWorkerStatusChanged } from "./notifications.service";
import type { AccessTokenPayload } from "../types/auth.type";
import type { DbConnection } from "../types/shared/common.type";
import type { AccountDto, AdminWorkerBoardStatus, AdminWorkerStatusItem, PaginationMeta, ProfileDto, ProfileUpdateInput, UserDetailResponse, UserListItem, UserListFilters, UserListSchedule, WorkScheduleDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import type { VehicleJobAssignmentDto, VehicleWorkReadinessDto, WorkerPresenceDto, WorkerQueueEntryDto } from "../types/worker.type";
import { parseWithSchema } from "../validation/parser";
import { adminForceWorkerStatusBodySchema, createUserBodySchema, paginationQuerySchema, resetPasswordBodySchema, updateUserBodySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";
import { hashPassword } from "../utils/password";
import { buildWorkScheduleShiftInstanceKey, findActiveWorkSchedule, formatScheduleWithShift, isTimeInWorkSchedule, resolveShiftNoFromStartTime, resolveShiftPreset } from "../utils/shift";
import { buildDeadline, formatBangkokDate } from "../utils/time";
import { buildWorkerQueueSocketPayload } from "../utils/worker-payload";
import { buildWorkerCode } from "../utils/worker-code";
import { resolveWorkerWorkStatus } from "../utils/worker-status";
import { ASSIGNMENT_STATUS } from "../constants/job-status";
import { WORKER_WORK_STATUS } from "../types/shared/worker-status.type";

/* -------------------------------------- Functions -------------------------------------- */

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

// Function ตรวจสอบและดึง user account ใน service flow
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

// Function ดึง actor ID ใน service flow
function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
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

// Function จัดรูปแบบ user list item ใน service flow
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
    phone: account.phone,
    work_start_date: profile?.work_start_date ?? null,
    work_schedule: formatUserListSchedule(formatScheduleWithShift(currentWorkSchedule)),
    status: account.status,
    updated_at: account.updated_at,
  };
}

// Function จัดรูปแบบ user detail ใน service flow
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
      work_start_date: profile?.work_start_date ?? null,
      shift_no: schedule?.shift_no ?? null,
      shift_start_time: schedule?.shift_start_time ?? null,
      shift_end_time: schedule?.shift_end_time ?? null,
      shift_name: schedule?.shift_name ?? null,
    },
  };
}

// Function ตรวจสอบเงื่อนไข username available ใน service flow
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

// Function ตรวจสอบเงื่อนไข WorkerCode available ใน service flow
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

// Function ตรวจสอบเงื่อนไข shirt number available ใน service flow
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

// Function เพิกถอน user sessions ใน service flow
async function revokeUserSessions(
  accountId: number,
  connection?: DbConnection
): Promise<void> {
  await sessionRepository.revokeActiveByAccountId(accountId, connection);
}

// Function ตรวจว่า profile updates ใน service flow
function hasProfileUpdates(profile: object): boolean {
  return Object.keys(profile).length > 0;
}

// Function สร้าง user ใน service flow
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
    shift_no: shiftNo,
    status,
  } = parseWithSchema(createUserBodySchema, body);
  const workerCode = buildWorkerCode({
    nationality,
    shirt_type: shirtType,
    shirt_number: shirtNumber,
  });
  const username = requestedUsername ?? workerCode;
  const initialWorkStartDate = workStartDate ?? formatBangkokDate();
  const shiftPreset = resolveShiftPreset(shiftNo);
  const initialScheduleInput = {
    shift_no: shiftPreset.shift_no,
    work_date: initialWorkStartDate,
    shift_start_time: shiftPreset.shift_start_time,
    shift_end_time: shiftPreset.shift_end_time,
  };
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

    await workScheduleRepository.create(
      {
        account_id: account.id,
        ...initialScheduleInput,
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
    accountRepository.listUsers(filters),
    accountRepository.countUsers(filters),
  ]);
  const data = await Promise.all(users.map((user) => formatUserListItem(user)));

  return {
    data,
    pagination: buildPaginationMeta(page, limit, total),
  };
}

// Function ดึง user ใน service flow
export async function getUser(id: number | string, _auth?: AccessTokenPayload) {
  const account = await requireUserAccount(id);

  return formatUserDetail(account);
}

// Function อัปเดต user ใน service flow
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
    shift_start_time: shiftStartTime,
    shift_end_time: shiftEndTime,
    profile: profileInput,
    status,
  } = parseWithSchema(updateUserBodySchema, body);
  const hasScheduleTimeInput =
    shiftStartTime !== undefined || shiftEndTime !== undefined;
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

    if (hasScheduleTimeInput) {
      if (shiftStartTime === undefined || shiftEndTime === undefined) {
        throw new ApiError(
          400,
          "SHIFT_TIME_PAIR_REQUIRED",
          "ShiftStartTime and ShiftEndTime must be sent together."
        );
      }

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
      const resolvedShiftNo = resolveShiftNoFromStartTime(shiftStartTime);

      await workScheduleRepository.deleteCurrentByAccountId(account.id, transaction);

      await workScheduleRepository.create(
        {
          account_id: account.id,
          shift_no: resolvedShiftNo,
          work_date: fallbackWorkDate,
          shift_start_time: shiftStartTime,
          shift_end_time: shiftEndTime,
          is_current: true,
          created_by: actorId,
          updated_by: actorId,
        },
        transaction
      );
    }

    return formatUserDetail(updatedAccount, transaction);
  });
}

// Function รีเซ็ต password ใน service flow
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

  if (status === WORKER_WORK_STATUS.WORKING) {
    return assignment?.scanned_at ?? assignment?.updated_at ?? assignment?.accepted_at ?? queue?.updated_at ?? presence.last_seen_at;
  }

  if (status === WORKER_WORK_STATUS.WAITING_TEAM) {
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
  account: AccountDto,
  profile: ProfileDto | null,
  schedule: WorkScheduleDto | null,
  queue: WorkerQueueEntryDto | null,
  assignment: VehicleJobAssignmentDto | null,
  presence: WorkerPresenceDto,
  queueRank: number | null = null,
  socketConnected = isWorkerSocketConnected(account.id),
  teamScanReadiness: Pick<VehicleWorkReadinessDto, "is_ready"> | null = null,
): AdminWorkerStatusItem {
  const scheduleWithShift = formatScheduleWithShift(schedule);
  const status = resolveWorkerWorkStatus(queue, assignment, teamScanReadiness);

  return {
    full_name: account.full_name,
    worker_code: account.username,
    shirt_number: profile?.shirt_number ?? null,
    image_url: profile?.image_url ?? null,
    shift_name: scheduleWithShift?.shift_name ?? null,
    latest_activity_at: resolveLatestActivityAt(queue, assignment, presence),
    status_entered_at: resolveStatusEnteredAt(status, queue, assignment, presence),
    queue_position: status === WORKER_WORK_STATUS.READY && queueRank !== null ? queueRank + 1 : null,
    socket_connected: socketConnected,
    status,
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
  const account = await requireUserAccount(
    typeof idParam === "number" ? idParam : String(idParam)
  );

  const [profile, currentSchedule, queueEntry, assignment, presence, queueRanks] = await Promise.all([
    profileRepository.findByAccountId(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
    getWorkerQueueStatus(account.id),
    assignmentRepository.findCurrentAssignmentByWorker(account.id),
    getWorkerPresence(account.id),
    getWorkerReadyQueueRanks([account.id]),
  ]);
  const teamScanReadiness = assignment
    ? await assignmentRepository.getVehicleJobTeamScanReadiness(
        assignment.vehicle_job_id,
      )
    : null;

  return formatAdminWorkerStatusItem(
    account,
    profile,
    currentSchedule,
    queueEntry,
    assignment,
    presence,
    queueRanks.get(account.id) ?? null,
    isWorkerSocketConnected(account.id),
    teamScanReadiness,
  );
}

// Function ดึงรายการ admin worker statuses ใน service flow
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
        assignmentRepository.findCurrentAssignmentByWorker(accountId)
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

  const data = accounts
    .map((account) => {
      const schedule = scheduleMap.get(account.id) ?? null;
      const presence =
        presences.get(account.id) ?? {
          is_online: false,
          last_seen_at: null,
          stale_after_seconds: settings.worker_presence_stale_seconds,
        };

      const queue = queueStatuses.get(account.id) ?? null;
      const assignment = assignmentMap.get(account.id) ?? null;
      const socketConnected = isWorkerSocketConnected(account.id);

      return {
        account,
        assignment,
        presence,
        queue,
        schedule,
        item: formatAdminWorkerStatusItem(
          account,
          profileMap.get(account.id) ?? null,
          schedule,
          queue,
          assignment,
          presence,
          queueRanks.get(account.id) ?? null,
          socketConnected,
          assignment
            ? teamScanReadinessMap.get(assignment.vehicle_job_id) ?? null
            : null,
        ),
      };
    })
    .filter(({ account, assignment, presence, queue, schedule }) => {
      const hasVisibleWorkerFlow =
        presence.is_online ||
        assignment !== null ||
        (queue !== null && queue.status !== WORKER_WORK_STATUS.OPEN_APP);

      return (
        account.status === "active" &&
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
  body: unknown
): Promise<{
  message: string;
  full_name: string;
  worker_code: string | null;
  status: AdminWorkerBoardStatus;
}> {
  const input = parseWithSchema(adminForceWorkerStatusBodySchema, body);
  const settings = await getRuntimeSettings();
  const account = await requireUserAccount(
    typeof idParam === "number" ? idParam : String(idParam)
  );

  if (account.status !== "active") {
    throw new ApiError(403, "WORKER_NOT_ACTIVE", "Worker account is not active.");
  }

  if (!isWorkerSocketConnected(account.id)) {
    throw new ApiError(
      409,
      "WORKER_NOT_ONLINE",
      "Worker WebSocket is not connected. Admin can force status only for online workers."
    );
  }

  const [queueEntry, currentAssignment, currentSchedule] = await Promise.all([
    getWorkerQueueStatus(account.id),
    assignmentRepository.findCurrentAssignmentByWorker(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
  ]);

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
    await removeWorkerBreakReturn(account.id, currentSchedule.id);
  }

  if (input.status === WORKER_WORK_STATUS.READY) {
    await enqueueWorker(account.id);
    await dispatchReadyWorkers();
  }

  if (input.status === WORKER_WORK_STATUS.OPEN_APP) {
    await markWorkerOpenApp(account.id);
  }

  if (input.status === WORKER_WORK_STATUS.BREAK) {
    if (!currentSchedule) {
      throw new ApiError(
        403,
        "WORK_SCHEDULE_NOT_FOUND",
        "Worker does not have a current work schedule."
      );
    }

    if (queueEntry?.status !== WORKER_WORK_STATUS.BREAK) {
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
    assignmentRepository.findCurrentAssignmentByWorker(account.id),
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
  publishAdminWorkerStatusChanged({
    title: "Worker status forced",
    message: `Worker ${account.full_name} status was forced by admin.`,
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
