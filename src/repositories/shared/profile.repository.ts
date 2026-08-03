// Import Library
import { prisma } from "../../db/prisma";

// Import Mappers
import { mapProfile } from "./mappers";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { ProfileDto } from "../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก Prisma client หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง id เป็น account id แบบ number สำหรับ query DB
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function ค้นหา ตาม account ID จาก DB
export async function findByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<ProfileDto | null> {
  const db = client(connection);
  const profile = await db.account.findUnique({
    where: {
      id: toAccountId(accountId),
    },
  });

  return mapProfile(profile);
}

// Function ค้นหา ตาม account IDs จาก DB
export async function findByAccountIds(
  accountIds: Array<number | string>,
  connection?: DbConnection
): Promise<ProfileDto[]> {
  const ids = [...new Set(accountIds.map(toAccountId))].filter((id) =>
    Number.isFinite(id)
  );

  if (ids.length === 0) {
    return [];
  }

  const db = client(connection);
  const profiles = await db.account.findMany({
    where: {
      id: {
        in: ids,
      },
      role: "worker",
    },
  });

  return profiles
    .map((profile) => mapProfile(profile))
    .filter((profile): profile is ProfileDto => profile !== null);
}
