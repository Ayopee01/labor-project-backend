// import Library
import { prisma } from "../../db/prisma";

// import Mapper
import { mapAccount, sanitizeAccount } from "./mappers";

// import Types
import type { DbConnection } from "../../types/common.type";
import type { AccountDto } from "../../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

const USER_ROLE = "user";
const ADMIN_ROLE = "admin";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติหรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id จาก path/string ให้เป็น number สำหรับ Prisma query
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function ตรวจว่า account DTO ไม่ใช่ null เพื่อใช้ filter list response
function isAccountDto(account: AccountDto | null): account is AccountDto {
  return account !== null;
}

// Function ค้นหา account จาก id โดยไม่จำกัด role ใช้ร่วมกับ Auth และ flow ที่ต้องอ่าน account ตรง ๆ
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

// Function ค้นหา account role user ใช้ร่วมกับ Admin Jobs และ Worker Application
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

// Function ดึง admin ทั้งหมด ใช้กับ audience ของ Admin Jobs และ Worker Application
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

// Function ดึง worker ทั้งหมด ใช้กับ Admin/Worker status summary
export async function listAllUsers(connection?: DbConnection): Promise<AccountDto[]> {
  const db = client(connection);
  const accounts = await db.account.findMany({
    where: {
      role: USER_ROLE,
    },
    orderBy: {
      id: "desc",
    },
  });

  return accounts.map((account) => mapAccount(account)).filter(isAccountDto);
}

export { sanitizeAccount };
