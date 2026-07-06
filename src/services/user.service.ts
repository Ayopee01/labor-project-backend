import { withTransaction } from "../db/prisma";
import * as accountRepository from "../repositories/account.repository";
import * as profileRepository from "../repositories/profile.repository";
import * as sessionRepository from "../repositories/session.repository";
import * as workScheduleRepository from "../repositories/work-schedule.repository";
import type { AccessTokenPayload, SessionDto } from "../types/auth.type";
import type { DbConnection } from "../types/common.type";
import type { AccountDto, FormattedSession, PaginationFilters, PaginationMeta, UserDetailResponse, UserListItem, UserListFilters } from "../types/users.type";
import { parseId, parseWithSchema, parseWorkScheduleInput } from "../validation/parser";
import { createUserBodySchema, paginationQuerySchema, resetPasswordBodySchema, updateUserBodySchema } from "../validation/schemas";
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
      const updatedSchedule = await workScheduleRepository.updateCurrentByAccountId(
        account.id,
        {
          ...scheduleInput,
          updated_by: actorId,
        },
        transaction
      );

      if (!updatedSchedule) {
        await workScheduleRepository.create(
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

      await workScheduleRepository.deleteInactiveByAccountId(
        account.id,
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
