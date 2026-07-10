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
import type {
  AccountCreateInput,
  AccountDto,
  ProfileCreateInput,
  ProfileCreateData,
  ProfileData,
  ProfileDataInput,
  ProfileDto,
  ProfileUpdateInput,
  PaginationFilters,
  UserAccountUpdateInput,
  UserListFilters,
  WorkScheduleCreateInput,
  WorkScheduleDto,
  WorkScheduleUpdateInput,
} from "../types/admin-workers.type";

const USER_ROLE = "user";
const DEFAULT_ACCOUNT_STATUS = "active";
const SEARCH_MODE = "insensitive" as const;

function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

function toAccountId(id: number | string): number {
  return toId(id);
}

function isAccountDto(account: AccountDto | null): account is AccountDto {
  return account !== null;
}

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
          workerCode: {
            contains: search,
            mode: SEARCH_MODE,
          },
        },
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
      profile: {
        is: {
          phone: {
            contains: search,
            mode: SEARCH_MODE,
          },
        },
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

function buildUserWhere(filters: Partial<UserListFilters> = {}): Prisma.AccountWhereInput {
  const where: Prisma.AccountWhereInput = {
    role: USER_ROLE,
  };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.search) {
    where.OR = buildUserSearchWhere(filters.search);
  }

  return where;
}

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

function buildAccountCreateData(account: AccountCreateInput): Prisma.AccountUncheckedCreateInput {
  return {
    username: account.username,
    passwordHash: account.password_hash,
    role: account.role,
    status: account.status ?? DEFAULT_ACCOUNT_STATUS,
    fullName: account.full_name,
    position: account.position ?? null,
    permissionLevel: account.permission_level ?? null,
    createdBy: account.created_by ?? null,
  };
}

function buildUserAccountUpdateData(fields: UserAccountUpdateInput): Prisma.AccountUpdateInput {
  const data: Prisma.AccountUpdateInput = {};

  if (fields.full_name !== undefined) {
    data.fullName = fields.full_name;
  }

  return data;
}

function buildProfileData(profile: ProfileDataInput): ProfileData {
  const data: ProfileData = {};

  if (profile.worker_code !== undefined) {
    data.workerCode = profile.worker_code;
  }

  if (profile.image_url !== undefined) {
    data.imageUrl = profile.image_url;
  }

  if (profile.nationality !== undefined) {
    data.nationality = profile.nationality;
  }

  if (profile.nationality_code !== undefined) {
    data.nationalityCode = profile.nationality_code;
  }

  if (profile.nationality_name !== undefined) {
    data.nationalityName = profile.nationality_name;
  }

  if (profile.work_start_date !== undefined) {
    data.workStartDate = profile.work_start_date;
  }

  if (profile.phone !== undefined) {
    data.phone = profile.phone;
  }

  if (profile.shirt_type !== undefined) {
    data.shirtType = profile.shirt_type;
  }

  if (profile.shirt_number !== undefined) {
    data.shirtNumber = profile.shirt_number;
  }

  return data;
}

function buildProfileCreateData(profile: ProfileCreateInput): ProfileCreateData {
  return {
    workerCode: profile.worker_code,
    imageUrl: profile.image_url,
    nationality: profile.nationality,
    nationalityCode: profile.nationality_code,
    nationalityName: profile.nationality_name,
    workStartDate: profile.work_start_date,
    phone: profile.phone,
    shirtType: profile.shirt_type,
    shirtNumber: profile.shirt_number,
  };
}

function isWorkScheduleDto(schedule: WorkScheduleDto | null): schedule is WorkScheduleDto {
  return schedule !== null;
}

function buildScheduleCreateData(
  schedule: WorkScheduleCreateInput
): Prisma.UserWorkScheduleUncheckedCreateInput {
  return {
    accountId: toAccountId(schedule.account_id),
    workDate: schedule.work_date,
    shiftStartTime: schedule.shift_start_time,
    shiftEndTime: schedule.shift_end_time,
    isCurrent: schedule.is_current !== false,
    createdBy: schedule.created_by ?? null,
    updatedBy: schedule.updated_by ?? null,
  };
}

function buildScheduleUpdateData(
  schedule: WorkScheduleUpdateInput
): Prisma.UserWorkScheduleUncheckedUpdateInput {
  return {
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

async function listUsers(
  filters: UserListFilters,
  connection?: DbConnection
): Promise<AccountDto[]> {
  const db = client(connection);
  const accounts = await db.account.findMany({
    where: buildUserWhere(filters),
    orderBy: {
      id: "desc",
    },
    skip: filters.offset,
    take: filters.limit,
  });

  return accounts.map((account) => mapAccount(account)).filter(isAccountDto);
}

async function countUsers(
  filters: UserListFilters,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);

  return db.account.count({
    where: buildUserWhere(filters),
  });
}

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

async function workerCodeExists(
  workerCode: string,
  exceptAccountId?: number | string | null,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const profile = await db.userProfile.findFirst({
    where: {
      workerCode,
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

async function createProfile(
  profile: ProfileCreateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);
  const createdProfile = await db.userProfile.create({
    data: {
      accountId: toAccountId(profile.account_id),
      ...buildProfileCreateData(profile),
    },
  });

  return requireMapped(mapProfile(createdProfile), "Profile", "create");
}

async function updateProfileByAccountId(
  accountId: number | string,
  profile: ProfileUpdateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);
  const updatedProfile = await db.userProfile.update({
    where: {
      accountId: toAccountId(accountId),
    },
    data: buildProfileData(profile),
  });

  return requireMapped(mapProfile(updatedProfile), "Profile", "update");
}

async function createWorkSchedule(
  schedule: WorkScheduleCreateInput,
  connection?: DbConnection
): Promise<WorkScheduleDto> {
  const db = client(connection);
  const createdSchedule = await db.userWorkSchedule.create({
    data: buildScheduleCreateData(schedule),
  });

  return requireMapped(mapSchedule(createdSchedule), "Schedule", "create");
}

async function updateCurrentWorkScheduleByAccountId(
  accountId: number | string,
  schedule: WorkScheduleUpdateInput,
  connection?: DbConnection
): Promise<WorkScheduleDto | null> {
  const db = client(connection);
  const currentSchedule = await db.userWorkSchedule.findFirst({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
    orderBy: {
      id: "desc",
    },
  });

  if (!currentSchedule) {
    return null;
  }

  const updatedSchedule = await db.userWorkSchedule.update({
    where: {
      id: currentSchedule.id,
    },
    data: buildScheduleUpdateData(schedule),
  });

  return requireMapped(mapSchedule(updatedSchedule), "Schedule", "update");
}

async function deleteOtherWorkSchedulesByAccountId(
  accountId: number | string,
  keepScheduleId: number | string,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.userWorkSchedule.deleteMany({
    where: {
      accountId: toAccountId(accountId),
      id: {
        not: Number(keepScheduleId),
      },
    },
  });
}

async function listWorkSchedulesByAccountId(
  accountId: number | string,
  filters: PaginationFilters,
  connection?: DbConnection
): Promise<WorkScheduleDto[]> {
  const db = client(connection);
  const schedules = await db.userWorkSchedule.findMany({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
    orderBy: {
      id: "desc",
    },
    skip: filters.offset,
    take: filters.limit,
  });

  return schedules.map((schedule) => mapSchedule(schedule)).filter(isWorkScheduleDto);
}

async function countWorkSchedulesByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);

  return db.userWorkSchedule.count({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
  });
}

const adminWorkersAccountRepository = {
  ...accountRepository,
  usernameExists,
  create,
  listUsers,
  countUsers,
  updateUserAccount,
  updatePassword,
  updateStatus,
};

const adminWorkersProfileRepository = {
  ...profileRepository,
  workerCodeExists,
  create: createProfile,
  updateByAccountId: updateProfileByAccountId,
};

const adminWorkersWorkScheduleRepository = {
  ...workScheduleRepository,
  create: createWorkSchedule,
  updateCurrentByAccountId: updateCurrentWorkScheduleByAccountId,
  deleteOtherByAccountId: deleteOtherWorkSchedulesByAccountId,
  listByAccountId: listWorkSchedulesByAccountId,
  countByAccountId: countWorkSchedulesByAccountId,
};

export {
  adminWorkersAccountRepository as accountRepository,
  adminWorkersProfileRepository as profileRepository,
  sessionRepository,
  adminWorkersWorkScheduleRepository as workScheduleRepository,
};
