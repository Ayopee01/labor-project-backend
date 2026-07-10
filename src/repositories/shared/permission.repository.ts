// import Library
import { prisma } from "../../db/prisma";

// import Config
import { isAdminPermission } from "../../config/permission.config";

// import Types
import type { AdminPermission } from "../../config/permission.config";
import type { DbConnection } from "../../types/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง permission string จาก DB เป็น permission ที่ระบบรองรับ
function toAdminPermission(permission: string): AdminPermission | null {
  return isAdminPermission(permission) ? permission : null;
}

// Function ดึง permissions ของ account
export async function listByAccountId(
  accountId: number,
  connection?: DbConnection
): Promise<AdminPermission[]> {
  const db = client(connection);
  const records = await db.accountPermission.findMany({
    where: {
      accountId,
    },
    orderBy: {
      permission: "asc",
    },
  });

  return records
    .map((record) => toAdminPermission(record.permission))
    .filter((permission): permission is AdminPermission => permission !== null);
}

// Function แทนที่ permissions ของ account ด้วยชุดใหม่
export async function replaceAccountPermissions(
  accountId: number,
  permissions: AdminPermission[],
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.accountPermission.deleteMany({
    where: {
      accountId,
    },
  });

  if (permissions.length === 0) {
    return;
  }

  await db.accountPermission.createMany({
    data: permissions.map((permission) => ({
      accountId,
      permission,
    })),
    skipDuplicates: true,
  });
}
