// Import Library
import { prisma } from "../../db/prisma";

// Import Mappers
import { mapAccount, sanitizeAccount } from "./mappers";
import { requireMapped } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { AccountDto } from "../../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

const WORKER_ROLE = "worker";

const ADMIN_ROLE = "admin";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก Prisma client หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง id เป็น account id แบบ number สำหรับ query DB
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function ตรวจว่า account DTO จาก DB
function isAccountDto(account: AccountDto | null): account is AccountDto {
  return account !== null;
}

// Function ค้นหา ตาม ID จาก DB
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

// Function ค้นหา user ตาม ID จาก DB
export async function findUserById(
  id: number | string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      id: toAccountId(id),
      role: WORKER_ROLE,
    },
  });

  return mapAccount(account);
}

// Function ดึงรายการ admins จาก DB
export async function listAdmins(connection?: DbConnection): Promise<AccountDto[]> {
  const db = client(connection);
  const accounts = await db.account.findMany({
    where: {
      role: ADMIN_ROLE,
    },
    orderBy: {
      id: "asc",
    },
  });

  return accounts.map((account) => mapAccount(account)).filter(isAccountDto);
}

// Function อัปเดต password จาก DB
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

  return requireMapped(mapAccount(updatedAccount), "Account", "password update");
}

// Function อัปเดต status จาก DB
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

  return requireMapped(mapAccount(updatedAccount), "Account", "status update");
}

// Function ดึงรายการ all users จาก DB
export async function listAllUsers(connection?: DbConnection): Promise<AccountDto[]> {
  const db = client(connection);
  const accounts = await db.account.findMany({
    where: {
      role: WORKER_ROLE,
    },
    orderBy: {
      id: "desc",
    },
  });

  return accounts.map((account) => mapAccount(account)).filter(isAccountDto);
}

export { sanitizeAccount };
