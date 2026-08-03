// Import Library
import { prisma } from "../../db/prisma";

// Import Config
import { isAdminPermission } from "../../config/permission.config";

// Import Types
import type { AdminPermission } from "../../config/permission.config";
import type { DbConnection } from "../../types/shared/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก Prisma client หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function จัดการ เป็น admin permission จาก DB
function toAdminPermission(permission: string): AdminPermission | null {
  return isAdminPermission(permission) ? permission : null;
}

// Function ดึงรายการ ตาม account ID จาก DB
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

// Function จัดการ replace account permissions จาก DB
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
