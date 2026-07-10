// Repository facade สำหรับ Swagger tag: Admin Settings
import * as accountRepository from "./shared/account.repository";
import * as permissionRepository from "./shared/permission.repository";
import * as sessionRepository from "./shared/session.repository";
import { mapAccount } from "./shared/mappers";
import { client, requireMapped, toId } from "./shared/repository-utils";

// import Types
import type { DbConnection } from "../types/common.type";
import type { SystemSettingDto } from "../types/admin-settings.type";
import type { AccountDto } from "../types/admin-workers.type";

export {
  permissionRepository,
  sessionRepository,
};

const ADMIN_ROLE = "admin";

// Function แปลง account id จาก path/string ให้เป็น number สำหรับ Prisma query
function toAccountId(id: number | string): number {
  return toId(id);
}

// Function ค้นหา account role admin สำหรับตรวจสิทธิ์ admin settings
async function findAdminById(
  id: number | string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      id: toAccountId(id),
      role: ADMIN_ROLE,
    },
  });

  return mapAccount(account);
}

// Function อัปเดต permission level ของ admin account
async function updatePermissionLevel(
  id: number | string,
  permissionLevel?: string | null,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(id),
    },
    data: {
      permissionLevel: permissionLevel ?? null,
    },
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "permission level update");
}

const adminSettingsAccountRepository = {
  ...accountRepository,
  findAdminById,
  updatePermissionLevel,
};

export { adminSettingsAccountRepository as accountRepository };

// Function แปลง system setting จาก Prisma เป็น DTO
function mapSystemSetting(record: {
  key: string;
  value: string;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}): SystemSettingDto {
  return {
    key: record.key,
    value: record.value,
    updated_by: record.updatedBy,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

// Function ดึง system settings ทั้งหมด
export async function listSettings(
  connection?: DbConnection
): Promise<SystemSettingDto[]> {
  const db = client(connection);
  const settings = await db.systemSetting.findMany({
    orderBy: {
      key: "asc",
    },
  });

  return settings.map(mapSystemSetting);
}

// Function upsert system settings หลายค่า
export async function upsertSettings(
  settings: Record<string, string>,
  updatedBy?: number | null,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  for (const [key, value] of Object.entries(settings)) {
    await db.systemSetting.upsert({
      where: {
        key,
      },
      update: {
        value,
        updatedBy: updatedBy ?? null,
      },
      create: {
        key,
        value,
        updatedBy: updatedBy ?? null,
      },
    });
  }
}
