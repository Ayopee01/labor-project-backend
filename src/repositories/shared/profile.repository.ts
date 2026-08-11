// Import Library
// Import Mappers
import { mapProfile } from "./mappers";
import { client, toId } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { ProfileDto } from "../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก Prisma client หรือ transaction client ที่ส่งเข้ามา
// Function แปลง id เป็น account id แบบ number สำหรับ query DB
// Function ค้นหา ตาม account ID จาก DB
export async function findByAccountId(
  accountId: number | string,
  connection?: DbConnection,
): Promise<ProfileDto | null> {
  const db = client(connection);
  const profile = await db.account.findUnique({
    where: {
      id: toId(accountId),
    },
  });

  return mapProfile(profile);
}

// Function ค้นหา ตาม account IDs จาก DB
export async function findByAccountIds(
  accountIds: Array<number | string>,
  connection?: DbConnection,
): Promise<ProfileDto[]> {
  const ids = [...new Set(accountIds.map(toId))].filter((id) =>
    Number.isFinite(id),
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

// Function โหลด WorkerCode จาก account id เพื่อไม่ส่ง id ภายในออกไปกับ event
export async function findWorkerCodeByAccountId(
  accountId: number,
  connection?: DbConnection,
): Promise<string | null> {
  const profile = await findByAccountId(accountId, connection);

  return profile?.worker_code ?? null;
}

// Function สร้าง map จาก account id เป็น WorkerCode ด้วย query เดียว
export async function findWorkerCodeMapByAccountIds(
  accountIds: number[],
  connection?: DbConnection,
): Promise<Map<number, string | null>> {
  if (accountIds.length === 0) {
    return new Map();
  }

  const profiles = await findByAccountIds(accountIds, connection);

  return new Map(
    profiles.map((profile) => [profile.account_id, profile.worker_code]),
  );
}

// Function คืน WorkerCode ตามลำดับเดียวกับ account id ที่ส่งเข้ามา
export async function findWorkerCodesByAccountIds(
  accountIds: number[],
  connection?: DbConnection,
): Promise<Array<string | null>> {
  const workerCodeMap = await findWorkerCodeMapByAccountIds(
    accountIds,
    connection,
  );

  return accountIds.map((accountId) => workerCodeMap.get(accountId) ?? null);
}
