// Import Library
// Import Mappers
import { mapAccount, sanitizeAccount } from "./mappers";
import { client, requireMapped, toId } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { AccountDto } from "../../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

const ADMIN_ROLE = "admin";

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจว่า account DTO จาก DB
function isAccountDto(account: AccountDto | null): account is AccountDto {
  return account !== null;
}

// Function ค้นหา ตาม ID จาก DB
export async function findById(
  id: number | string,
  connection?: DbConnection,
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findUnique({
    where: {
      id: toId(id),
    },
  });

  return mapAccount(account);
}

// Function ดึงรายการ admins จาก DB
export async function listAdmins(
  connection?: DbConnection,
): Promise<AccountDto[]> {
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

export async function listByIds(
  ids: number[],
  connection?: DbConnection,
): Promise<AccountDto[]> {
  const uniqueIds = [...new Set(ids.map((id) => toId(id)).filter((id) => id > 0))];

  if (uniqueIds.length === 0) {
    return [];
  }

  const accounts = await client(connection).account.findMany({
    where: {
      id: {
        in: uniqueIds,
      },
    },
  });

  return accounts.map((account) => mapAccount(account)).filter(isAccountDto);
}

// Function อัปเดต password จาก DB
export async function updatePassword(
  id: number | string,
  passwordHash: string,
  connection?: DbConnection,
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toId(id),
    },
    data: {
      passwordHash,
    },
  });

  return requireMapped(
    mapAccount(updatedAccount),
    "Account",
    "password update",
  );
}

// Function อัปเดต status จาก DB
export async function updateStatus(
  id: number | string,
  status: string,
  connection?: DbConnection,
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toId(id),
    },
    data: {
      status,
    },
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "status update");
}

// Function อัปเดตภาษาของ account จาก DB
export async function updateLang(
  id: number | string,
  lang: string,
  connection?: DbConnection,
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toId(id),
    },
    data: {
      lang,
    },
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "lang update");
}

// Function อัปเดต full_name/email/phone/image_url ของ account จาก DB — เฉพาะ field ที่ส่งมา
// (ไม่ใช่ undefined) เท่านั้นที่ถูกเขียนทับ ใช้ทั้งกับ self-service profile (Admin) และรูปโปรไฟล์
// email/phone รับ null ได้จริงเพื่อล้างค่าเดิม (ต่างจาก full_name/image_url ที่ต้องไม่ว่างเสมอ)
export async function updateProfile(
  id: number | string,
  fields: {
    full_name?: string;
    email?: string | null;
    phone?: string | null;
    image_url?: string;
  },
  connection?: DbConnection,
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toId(id),
    },
    data: {
      ...(fields.full_name !== undefined ? { fullName: fields.full_name } : {}),
      ...(fields.email !== undefined ? { email: fields.email } : {}),
      ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      ...(fields.image_url !== undefined ? { imageUrl: fields.image_url } : {}),
    },
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "profile update");
}

export { sanitizeAccount };
