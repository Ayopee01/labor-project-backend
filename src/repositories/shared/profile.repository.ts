// import Library
import { prisma } from "../../db/prisma";

// import Mapper
import { mapProfile } from "./mappers";

// import Types
import type { DbConnection } from "../../types/common.type";
import type { ProfileDto } from "../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติหรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id จาก path/string ให้เป็น number สำหรับ Prisma query
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function ค้นหา profile จาก account id ใช้ร่วมกับ Auth/me และ Admin Workers
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

// Function ค้นหา profile หลาย account id ใน query เดียวเพื่อลด N+1 query
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
