import { profileRepository } from "../repositories/worker.repository";

import type { DbConnection } from "../types/shared/common.type";

// Function โหลด WorkerCode จาก account id เพื่อไม่ส่ง id ภายในออกไปกับ event
export async function getWorkerCodeByAccountId(
  accountId: number,
  connection?: DbConnection
): Promise<string | null> {
  const profile = await profileRepository.findByAccountId(accountId, connection);

  return profile?.worker_code ?? null;
}

// Function สร้าง map จาก account id เป็น WorkerCode ด้วย query เดียว
export async function getWorkerCodeMapByAccountIds(
  accountIds: number[],
  connection?: DbConnection
): Promise<Map<number, string | null>> {
  if (accountIds.length === 0) {
    return new Map();
  }

  const profiles = await profileRepository.findByAccountIds(accountIds, connection);

  return new Map(
    profiles.map((profile) => [profile.account_id, profile.worker_code])
  );
}

// Function คืน WorkerCode ตามลำดับเดียวกับ account id ที่ส่งเข้ามา
export async function getWorkerCodesByAccountIds(
  accountIds: number[],
  connection?: DbConnection
): Promise<Array<string | null>> {
  const workerCodeMap = await getWorkerCodeMapByAccountIds(accountIds, connection);

  return accountIds.map((accountId) => workerCodeMap.get(accountId) ?? null);
}
