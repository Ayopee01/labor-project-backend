// Repository facade สำหรับ Swagger tag: Admin Workers
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import * as sessionRepository from "./shared/session.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { prisma } from "../db/prisma";
import { mapAccount, mapProfile, mapSchedule } from "./shared/mappers";
import { requireMapped, toId } from "./shared/repository-utils";

import type { Prisma } from "@prisma/client";
import type { DbConnection } from "../types/common.type";
import type { AccountCreateInput, AccountDto, ProfileCreateInput, ProfileCreateData, ProfileData, ProfileDataInput, ProfileDto, ProfileUpdateInput, PaginationFilters, UserAccountUpdateInput, UserListFilters, WorkScheduleCreateInput, WorkScheduleDto, WorkScheduleUpdateInput } from "../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

// Config role หลักของ repository นี้
const WORKER_ROLE = "worker";

// Config status default เมื่อสร้าง account worker ใหม่
const DEFAULT_ACCOUNT_STATUS = "active";

// Config search mode สำหรับ Prisma contains filter
const SEARCH_MODE = "insensitive" as const;

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id จาก path/string ให้เป็น number สำหรับ Prisma query
function toAccountId(id: number | string): number {
  return toId(id);
}

// Function ตรวจว่า mapper คืน account DTO ที่ไม่ใช่ null
function isAccountDto(account: AccountDto | null): account is AccountDto {
  return account !== null;
}

// Function สร้าง OR filter สำหรับค้นหา worker จากหลาย field
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
      profile: {
        is: {
          nationality: {
            contains: search,
            mode: SEARCH_MODE,
          },
        },
      },
    },
    {
      phone: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      profile: {
        is: {
          shirtNumber: {
            contains: search,
            mode: SEARCH_MODE,
          },
        },
      },
    },
  ];
}

// Function สร้าง where condition สำหรับ list worker
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

// Function สร้างเงื่อนไขค้นหา worker จาก username หรือ worker_code
function buildUserIdentifierWhere(identifier: string): Prisma.AccountWhereInput {
  return {
    role: WORKER_ROLE,
    username: identifier,
  };
}

// Function สร้างเงื่อนไขตรวจ username ซ้ำโดยยกเว้น account ปัจจุบันได้
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

// Function แปลง input สร้าง account เป็น Prisma create data
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
    permissionLevel: account.permission_level ?? null,
    createdBy: account.created_by ?? null,
  };
}

// Function แปลง field แก้ไข worker account เป็น Prisma update data
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

// Function แปลง input profile เป็น data เฉพาะ field ที่ส่งมา
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

// Function แปลง input สร้าง profile เป็น Prisma create data
function buildProfileCreateData(profile: ProfileCreateInput): ProfileCreateData {
  return {
    imageUrl: profile.image_url,
    nationality: profile.nationality,
    workStartDate: profile.work_start_date,
    shirtType: profile.shirt_type,
    shirtNumber: profile.shirt_number,
  };
}

// Function ตรวจว่า mapper คืน work schedule DTO ที่ไม่ใช่ null
function isWorkScheduleDto(schedule: WorkScheduleDto | null): schedule is WorkScheduleDto {
  return schedule !== null;
}

// Function แปลง input สร้างตารางงานเป็น Prisma create data
function buildScheduleCreateData(
  schedule: WorkScheduleCreateInput
): Prisma.WorkerWorkScheduleUncheckedCreateInput {
  return {
    accountId: toAccountId(schedule.account_id),
    shiftNo: schedule.shift_no ?? 1,
    workDate: schedule.work_date,
    shiftStartTime: schedule.shift_start_time,
    shiftEndTime: schedule.shift_end_time,
    isCurrent: schedule.is_current !== false,
    createdBy: schedule.created_by ?? null,
    updatedBy: schedule.updated_by ?? null,
  };
}

// Function แปลง input แก้ไขตารางงานปัจจุบันเป็น Prisma update data
function buildScheduleUpdateData(
  schedule: WorkScheduleUpdateInput
): Prisma.WorkerWorkScheduleUncheckedUpdateInput {
  return {
    ...(schedule.shift_no !== undefined && { shiftNo: schedule.shift_no }),
    workDate: schedule.work_date,
    shiftStartTime: schedule.shift_start_time,
    shiftEndTime: schedule.shift_end_time,
    isCurrent: true,
    updatedBy:
      schedule.updated_by === undefined || schedule.updated_by === null
        ? null
        : toAccountId(schedule.updated_by),
  };
}

// Function ตรวจว่า username ถูกใช้แล้วหรือไม่
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

// Function สร้าง account worker/admin ผ่าน repository facade
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

// Function ดึงรายการ worker ตาม filter และ pagination
async function listUsers(
  filters: UserListFilters,
  connection?: DbConnection
): Promise<AccountDto[]> {
  const db = client(connection);
  const accounts = await db.account.findMany({
    where: buildUserWhere(filters),
    orderBy: [
      {
        shiftNo: "asc",
      },
      {
        id: "asc",
      },
    ],
    skip: filters.offset,
    take: filters.limit,
  });

  return accounts.map((account) => mapAccount(account)).filter(isAccountDto);
}

// Function นับจำนวน worker ตาม filter
async function countUsers(
  filters: UserListFilters,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);

  return db.account.count({
    where: buildUserWhere(filters),
  });
}

// Function ค้นหา worker จาก username หรือ worker_code
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

// Function อัปเดตข้อมูล account ของ worker
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

// Function อัปเดต password hash ของ account
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

// Function อัปเดตสถานะ account
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

// Function ตรวจว่า worker code ถูกใช้แล้วหรือไม่
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

async function shirtNumberExists(
  shirtNumber: string,
  exceptAccountId?: number | string | null,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const profile = await db.workerProfile.findFirst({
    where: {
      shirtNumber,
      ...(exceptAccountId !== undefined &&
        exceptAccountId !== null && {
          accountId: {
            not: toAccountId(exceptAccountId),
          },
        }),
    },
    select: {
      id: true,
    },
  });

  return Boolean(profile);
}

// Function สร้าง profile ของ worker
async function createProfile(
  profile: ProfileCreateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);
  const createdProfile = await db.workerProfile.create({
    data: {
      accountId: toAccountId(profile.account_id),
      ...buildProfileCreateData(profile),
    },
    include: {
      account: {
        select: {
          username: true,
          phone: true,
        },
      },
    },
  });

  return requireMapped(mapProfile(createdProfile), "Profile", "create");
}

// Function อัปเดต profile จาก account id
async function updateProfileByAccountId(
  accountId: number | string,
  profile: ProfileUpdateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);
  const updatedProfile = await db.workerProfile.update({
    where: {
      accountId: toAccountId(accountId),
    },
    data: buildProfileData(profile),
    include: {
      account: {
        select: {
          username: true,
          phone: true,
        },
      },
    },
  });

  return requireMapped(mapProfile(updatedProfile), "Profile", "update");
}

// Function สร้างตารางงานของ worker
async function createWorkSchedule(
  schedule: WorkScheduleCreateInput,
  connection?: DbConnection
): Promise<WorkScheduleDto> {
  const db = client(connection);
  const createdSchedule = await db.workerWorkSchedule.create({
    data: buildScheduleCreateData(schedule),
  });

  return requireMapped(mapSchedule(createdSchedule), "Schedule", "create");
}

// Function อัปเดตตารางงานปัจจุบันของ worker
async function updateCurrentWorkScheduleByAccountId(
  accountId: number | string,
  schedule: WorkScheduleUpdateInput,
  connection?: DbConnection
): Promise<WorkScheduleDto | null> {
  const db = client(connection);
  const currentSchedule = await db.workerWorkSchedule.findFirst({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
    orderBy: [
      {
        shiftNo: "asc",
      },
      {
        id: "asc",
      },
    ],
  });

  if (!currentSchedule) {
    return null;
  }

  const updatedSchedule = await db.workerWorkSchedule.update({
    where: {
      id: currentSchedule.id,
    },
    data: buildScheduleUpdateData(schedule),
  });

  return requireMapped(mapSchedule(updatedSchedule), "Schedule", "update");
}

// Function ลบตารางงานอื่นของ worker โดยเก็บ schedule ที่ระบุไว้
async function deleteOtherWorkSchedulesByAccountId(
  accountId: number | string,
  keepScheduleId: number | string,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.workerWorkSchedule.deleteMany({
    where: {
      accountId: toAccountId(accountId),
      id: {
        not: Number(keepScheduleId),
      },
    },
  });
}

async function deleteCurrentWorkSchedulesByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.workerWorkSchedule.deleteMany({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
  });
}

// Function ดึงรายการตารางงานปัจจุบันของ worker ตาม pagination
async function listWorkSchedulesByAccountId(
  accountId: number | string,
  filters: PaginationFilters,
  connection?: DbConnection
): Promise<WorkScheduleDto[]> {
  const db = client(connection);
  const schedules = await db.workerWorkSchedule.findMany({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
    orderBy: [
      {
        shiftNo: "asc",
      },
      {
        id: "asc",
      },
    ],
    skip: filters.offset,
    take: filters.limit,
  });

  return schedules.map((schedule) => mapSchedule(schedule)).filter(isWorkScheduleDto);
}

// Function นับจำนวนตารางงานปัจจุบันของ worker
async function countWorkSchedulesByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);

  return db.workerWorkSchedule.count({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
  });
}

// Function รวม account repository ของ Admin Workers พร้อม method เฉพาะ worker
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

// Function รวม profile repository ของ Admin Workers พร้อม method เฉพาะ worker profile
const adminWorkersProfileRepository = {
  ...profileRepository,
  workerCodeExists,
  shirtNumberExists,
  create: createProfile,
  updateByAccountId: updateProfileByAccountId,
};

// Function รวม work schedule repository ของ Admin Workers พร้อม method จัดการ schedule
const adminWorkersWorkScheduleRepository = {
  ...workScheduleRepository,
  create: createWorkSchedule,
  updateCurrentByAccountId: updateCurrentWorkScheduleByAccountId,
  deleteOtherByAccountId: deleteOtherWorkSchedulesByAccountId,
  deleteCurrentByAccountId: deleteCurrentWorkSchedulesByAccountId,
  listByAccountId: listWorkSchedulesByAccountId,
  countByAccountId: countWorkSchedulesByAccountId,
};

export {
  adminWorkersAccountRepository as accountRepository,
  adminWorkersProfileRepository as profileRepository,
  sessionRepository,
  adminWorkersWorkScheduleRepository as workScheduleRepository,
};
