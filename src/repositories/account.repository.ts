// import Library
import { prisma } from "../db/prisma";
import type { Prisma } from "@prisma/client";

// import Mapper
import { mapAccount } from "./mapper";

// import Types
import type { AccountCreateInput, AccountDto, UserAccountUpdateInput, UserListFilters } from "../types/users.type";
import type { DbConnection } from "../types/common.type";

/* -------------------------------------- Config -------------------------------------- */

// Config role ของ account ที่เป็น worker/user
const USER_ROLE = "user";

// Config status เริ่มต้นของ account
const DEFAULT_ACCOUNT_STATUS = "active";

// Config โหมดค้นหาแบบไม่สนตัวพิมพ์เล็ก/ใหญ่
const SEARCH_MODE = "insensitive" as const;

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id ให้เป็น number ก่อนส่งเข้า Prisma
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function ใช้กรองผลลัพธ์ null จาก mapper
function isAccountDto(account: AccountDto | null): account is AccountDto {
  return account !== null;
}

// Function ตรวจสอบว่า Prisma คืน account กลับมาหลัง create/update
function requireMappedAccount(
  account: AccountDto | null,
  action: string
): AccountDto {
  if (!account) {
    throw new Error(`Account ${action} did not return a record.`);
  }

  return account;
}

// Function สร้างเงื่อนไขค้นหา user จาก username, full name หรือ worker code
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
  ];
}

// Function สร้าง where condition สำหรับ list/count เฉพาะ account ที่เป็น user
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

// Function สร้าง where condition สำหรับตรวจสอบ username ซ้ำ
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

// Function สร้างข้อมูลสำหรับ create account
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

// Function สร้างข้อมูลสำหรับ update account ของ user
function buildUserAccountUpdateData(fields: UserAccountUpdateInput): Prisma.AccountUpdateInput {
  const data: Prisma.AccountUpdateInput = {};

  if (fields.full_name !== undefined) {
    data.fullName = fields.full_name;
  }

  return data;
}

// Function ค้นหา account จาก username สำหรับ login
export async function findByUsername(
  username: string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);

  const account = await db.account.findUnique({
    where: {
      username,
    },
  });

  return mapAccount(account);
}

// Function ค้นหา account จาก id โดยไม่จำกัด role
export async function findById(
  id: number | string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);

  const account = await db.account.findUnique({
    where: {
      id: toAccountId(id),
    },
  });

  return mapAccount(account);
}

// Function ค้นหา account จาก id เฉพาะ role user
export async function findUserById(
  id: number | string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);

  const account = await db.account.findFirst({
    where: {
      id: toAccountId(id),
      role: USER_ROLE,
    },
  });

  return mapAccount(account);
}

// Function ตรวจสอบว่า username ถูกใช้แล้วหรือยัง
export async function usernameExists(
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

// Function สร้าง account ใหม่ใน table accounts
export async function create(
  account: AccountCreateInput,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);

  const createdAccount = await db.account.create({
    data: buildAccountCreateData(account),
  });

  return requireMappedAccount(mapAccount(createdAccount), "create");
}

// Function ดึงรายการ account role user ตาม filter และ pagination
export async function listUsers(
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

// Function นับจำนวน account role user ตาม filter
export async function countUsers(
  filters: UserListFilters,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);

  return db.account.count({
    where: buildUserWhere(filters),
  });
}

// Function แก้ไขข้อมูล account ของ user
export async function updateUserAccount(
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

  return requireMappedAccount(mapAccount(updatedAccount), "update");
}

// Function แก้ไข password hash ของ account
export async function updatePassword(
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

  return requireMappedAccount(mapAccount(updatedAccount), "password update");
}

// Function แก้ไขสถานะ active/inactive ของ account
export async function updateStatus(
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

  return requireMappedAccount(mapAccount(updatedAccount), "status update");
}

// Export function
export { sanitizeAccount } from "./mapper";
