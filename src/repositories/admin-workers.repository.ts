import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import * as sessionRepository from "./shared/session.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { prisma } from "../db/prisma";
import { mapAccount, mapProfile, mapSchedule } from "./shared/mappers";
import { requireMapped, toId } from "./shared/repository-utils";

import type { Prisma } from "@prisma/client";
import type { DbConnection } from "../types/shared/common.type";
import type { AccountCreateInput, AccountDto, ProfileCreateInput, ProfileCreateData, ProfileData, ProfileDataInput, ProfileDto, ProfileUpdateInput, UserAccountUpdateInput, UserListFilters, WorkScheduleCreateInput, WorkScheduleDto, WorkScheduleUpdateInput } from "../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

const WORKER_ROLE = "worker";

const DEFAULT_ACCOUNT_STATUS = "active";

const SEARCH_MODE = "insensitive" as const;

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก Prisma client หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง id เป็น account id แบบ number สำหรับ query DB
function toAccountId(id: number | string): number {
  return toId(id);
}

// Function ตรวจว่า account DTO จาก DB
function isAccountDto(account: AccountDto | null): account is AccountDto {
  return account !== null;
}

// Function สร้าง user search where จาก DB
function buildUserSearchWhere(search: string): Prisma.AccountWhereInput[] {
  return [
    {
      username: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      fullName: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      nationality: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      phone: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      shirtNumber: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
  ];
}

// Function สร้าง user where จาก DB
function buildUserWhere(filters: Partial<UserListFilters> = {}): Prisma.AccountWhereInput {
  const where: Prisma.AccountWhereInput = {
    role: WORKER_ROLE,
  };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.search) {
    where.OR = buildUserSearchWhere(filters.search);
  }

  return where;
}

// Function สร้าง user identifier where จาก DB
function buildUserIdentifierWhere(identifier: string): Prisma.AccountWhereInput {
  return {
    role: WORKER_ROLE,
    username: identifier,
  };
}

// Function สร้าง username exists where จาก DB
function buildUsernameExistsWhere(
  username: string,
  exceptAccountId?: number | string | null
): Prisma.AccountWhereInput {
  return {
    username,
    ...(exceptAccountId !== undefined &&
      exceptAccountId !== null && {
        id: {
          not: toAccountId(exceptAccountId),
        },
      }),
  };
}

// Function สร้าง account create data จาก DB
function buildAccountCreateData(account: AccountCreateInput): Prisma.AccountUncheckedCreateInput {
  return {
    username: account.username,
    passwordHash: account.password_hash,
    role: account.role,
    status: account.status ?? DEFAULT_ACCOUNT_STATUS,
    fullName: account.full_name,
    position: account.position ?? null,
    email: account.email ?? null,
    phone: account.phone ?? null,
    imageUrl: account.image_url ?? null,
    nationality: account.nationality ?? null,
    workStartDate: account.work_start_date ?? null,
    shirtType: account.shirt_type ?? null,
    shirtNumber: account.shirt_number ?? null,
    shiftNo: account.shift_no ?? null,
    shiftStartTime: account.shift_start_time ?? null,
    shiftEndTime: account.shift_end_time ?? null,
    source: account.source ?? "internal",
    masterWorkerId: account.master_worker_id ?? null,
    masterUpdatedAt: account.master_updated_at ?? null,
    syncedAt: account.synced_at ?? null,
    permissionLevel: account.permission_level ?? null,
    createdBy: account.created_by ?? null,
  };
}

// Function สร้าง user account update data จาก DB
function buildUserAccountUpdateData(fields: UserAccountUpdateInput): Prisma.AccountUpdateInput {
  const data: Prisma.AccountUpdateInput = {};

  if (fields.username !== undefined) {
    data.username = fields.username;
  }

  if (fields.full_name !== undefined) {
    data.fullName = fields.full_name;
  }

  if (fields.position !== undefined) {
    data.position = fields.position;
  }

  if (fields.email !== undefined) {
    data.email = fields.email;
  }

  if (fields.phone !== undefined) {
    data.phone = fields.phone;
  }

  return data;
}

// Function สร้าง profile data จาก DB
function buildProfileData(profile: ProfileDataInput): ProfileData {
  const data: ProfileData = {};

  if (profile.image_url !== undefined) {
    data.imageUrl = profile.image_url;
  }

  if (profile.nationality !== undefined) {
    data.nationality = profile.nationality;
  }

  if (profile.work_start_date !== undefined) {
    data.workStartDate = profile.work_start_date;
  }

  if (profile.shirt_type !== undefined) {
    data.shirtType = profile.shirt_type;
  }

  if (profile.shirt_number !== undefined) {
    data.shirtNumber = profile.shirt_number;
  }

  return data;
}

// Function สร้าง profile create data จาก DB
function buildProfileCreateData(profile: ProfileCreateInput): ProfileCreateData {
  return {
    imageUrl: profile.image_url,
    nationality: profile.nationality,
    workStartDate: profile.work_start_date,
    shirtType: profile.shirt_type,
    shirtNumber: profile.shirt_number,
  };
}

// Function สร้าง schedule create data จาก DB
function buildScheduleCreateData(
  schedule: WorkScheduleCreateInput
): Prisma.AccountUncheckedUpdateInput {
  return {
    shiftNo: schedule.shift_no ?? 1,
    workStartDate: schedule.work_date,
    shiftStartTime: schedule.shift_start_time,
    shiftEndTime: schedule.shift_end_time,
  };
}

// Function สร้าง schedule update data จาก DB
function buildScheduleUpdateData(
  schedule: WorkScheduleUpdateInput
): Prisma.AccountUncheckedUpdateInput {
  return {
    ...(schedule.shift_no !== undefined && { shiftNo: schedule.shift_no }),
    workStartDate: schedule.work_date,
    shiftStartTime: schedule.shift_start_time,
    shiftEndTime: schedule.shift_end_time,
  };
}

// Function จัดการ username exists จาก DB
async function usernameExists(
  username: string,
  exceptAccountId?: number | string | null,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: buildUsernameExistsWhere(username, exceptAccountId),
    select: {
      id: true,
    },
  });

  return Boolean(account);
}

// Function สร้าง create จาก DB
async function create(
  account: AccountCreateInput,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);
  const createdAccount = await db.account.create({
    data: buildAccountCreateData(account),
  });

  return requireMapped(mapAccount(createdAccount), "Account", "create");
}

// Function ดึงรายการ users จาก DB
async function listUsers(
  filters: UserListFilters,
  connection?: DbConnection
): Promise<AccountDto[]> {
  const db = client(connection);
  const accounts = await db.account.findMany({
    where: buildUserWhere(filters),
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    skip: filters.offset,
    take: filters.limit,
  });

  return accounts.map((account) => mapAccount(account)).filter(isAccountDto);
}

// Function นับ users จาก DB
async function countUsers(
  filters: UserListFilters,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);

  return db.account.count({
    where: buildUserWhere(filters),
  });
}

// Function ค้นหา user ตาม identifier จาก DB
async function findUserByIdentifier(
  identifier: string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: buildUserIdentifierWhere(identifier),
  });

  return mapAccount(account);
}

// Function อัปเดต user account จาก DB
async function updateUserAccount(
  id: number | string,
  fields: UserAccountUpdateInput,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(id),
    },
    data: buildUserAccountUpdateData(fields),
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "update");
}

// Function อัปเดต password จาก DB
async function updatePassword(
  id: number | string,
  passwordHash: string,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(id),
    },
    data: {
      passwordHash,
    },
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "password update");
}

// Function อัปเดต status จาก DB
async function updateStatus(
  id: number | string,
  status: string,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(id),
    },
    data: {
      status,
    },
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "status update");
}

// Function จัดการ WorkerCode exists จาก DB
async function workerCodeExists(
  workerCode: string,
  exceptAccountId?: number | string | null,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      username: workerCode,
      role: WORKER_ROLE,
      ...(exceptAccountId !== undefined &&
        exceptAccountId !== null && {
          id: {
            not: toAccountId(exceptAccountId),
          },
        }),
    },
    select: {
      id: true,
    },
  });

  return Boolean(account);
}

// Function จัดการ shirt number exists จาก DB
async function shirtNumberExists(
  shirtNumber: string,
  exceptAccountId?: number | string | null,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      shirtNumber,
      role: WORKER_ROLE,
      ...(exceptAccountId !== undefined &&
        exceptAccountId !== null && {
          id: {
            not: toAccountId(exceptAccountId),
          },
        }),
    },
    select: {
      id: true,
    },
  });

  return Boolean(account);
}

// Function สร้าง profile จาก DB
async function createProfile(
  profile: ProfileCreateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(profile.account_id),
    },
    data: {
      ...buildProfileCreateData(profile),
    },
  });

  return requireMapped(mapProfile(updatedAccount), "Profile", "create");
}

// Function อัปเดต profile ตาม account ID จาก DB
async function updateProfileByAccountId(
  accountId: number | string,
  profile: ProfileUpdateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(accountId),
    },
    data: buildProfileData(profile),
  });

  return requireMapped(mapProfile(updatedAccount), "Profile", "update");
}

// Function สร้าง work schedule จาก DB
async function createWorkSchedule(
  schedule: WorkScheduleCreateInput,
  connection?: DbConnection
): Promise<WorkScheduleDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(schedule.account_id),
    },
    data: buildScheduleCreateData(schedule),
  });

  return requireMapped(mapSchedule(updatedAccount), "Schedule", "create");
}

// Function อัปเดต current work schedule ตาม account ID จาก DB
async function updateCurrentWorkScheduleByAccountId(
  accountId: number | string,
  schedule: WorkScheduleUpdateInput,
  connection?: DbConnection
): Promise<WorkScheduleDto | null> {
  const db = client(connection);
  const currentSchedule = await db.account.findFirst({
    where: {
      id: toAccountId(accountId),
      role: WORKER_ROLE,
      shiftNo: {
        not: null,
      },
      shiftStartTime: {
        not: null,
      },
      shiftEndTime: {
        not: null,
      },
    },
  });

  if (!currentSchedule) {
    return null;
  }

  const updatedAccount = await db.account.update({
    where: {
      id: currentSchedule.id,
    },
    data: buildScheduleUpdateData(schedule),
  });

  return requireMapped(mapSchedule(updatedAccount), "Schedule", "update");
}

// Function ลบ other work schedules ตาม account ID จาก DB
async function deleteOtherWorkSchedulesByAccountId(
  accountId: number | string,
  keepScheduleId: number | string,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  if (toAccountId(accountId) === Number(keepScheduleId)) {
    return;
  }

  await db.account.updateMany({
    where: {
      id: toAccountId(accountId),
    },
    data: {
      shiftNo: null,
      shiftStartTime: null,
      shiftEndTime: null,
    },
  });
}

// Function ลบ current work schedules ตาม account ID จาก DB
async function deleteCurrentWorkSchedulesByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.account.updateMany({
    where: {
      id: toAccountId(accountId),
    },
    data: {
      shiftNo: null,
      shiftStartTime: null,
      shiftEndTime: null,
    },
  });
}

const adminWorkersAccountRepository = {
  ...accountRepository,
  usernameExists,
  create,
  listUsers,
  countUsers,
  findUserByIdentifier,
  updateUserAccount,
  updatePassword,
  updateStatus,
};

const adminWorkersProfileRepository = {
  ...profileRepository,
  workerCodeExists,
  shirtNumberExists,
  create: createProfile,
  updateByAccountId: updateProfileByAccountId,
};

const adminWorkersWorkScheduleRepository = {
  ...workScheduleRepository,
  create: createWorkSchedule,
  updateCurrentByAccountId: updateCurrentWorkScheduleByAccountId,
  deleteOtherByAccountId: deleteOtherWorkSchedulesByAccountId,
  deleteCurrentByAccountId: deleteCurrentWorkSchedulesByAccountId,
};

export {
  adminWorkersAccountRepository as accountRepository,
  adminWorkersProfileRepository as profileRepository,
  sessionRepository,
  adminWorkersWorkScheduleRepository as workScheduleRepository,
};
