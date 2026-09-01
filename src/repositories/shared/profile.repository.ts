// Import Library
import * as masterWorkerRepository from "./master-worker.repository";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { MasterWorkerDto } from "../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา worker (เดิมชื่อ "profile") ตาม worker ID จาก DB
export async function findByAccountId(
  workerId: number | string,
  connection?: DbConnection,
): Promise<MasterWorkerDto | null> {
  return masterWorkerRepository.findById(workerId, connection);
}

// Function ค้นหา worker หลาย ID พร้อมกันจาก DB
export async function findByAccountIds(
  workerIds: Array<number | string>,
  connection?: DbConnection,
): Promise<MasterWorkerDto[]> {
  return masterWorkerRepository.findByIds(workerIds, connection);
}

// Function โหลด WorkerCode จาก worker id เพื่อไม่ส่ง id ภายในออกไปกับ event
export async function findWorkerCodeByAccountId(
  workerId: number,
  connection?: DbConnection,
): Promise<string | null> {
  return masterWorkerRepository.findWorkerCodeByWorkerId(workerId, connection);
}

// Function สร้าง map จาก worker id เป็น WorkerCode ด้วย query เดียว
export async function findWorkerCodeMapByAccountIds(
  workerIds: number[],
  connection?: DbConnection,
): Promise<Map<number, string | null>> {
  return masterWorkerRepository.findWorkerCodeMapByWorkerIds(workerIds, connection);
}

// Function คืน WorkerCode ตามลำดับเดียวกับ worker id ที่ส่งเข้ามา
export async function findWorkerCodesByAccountIds(
  workerIds: number[],
  connection?: DbConnection,
): Promise<Array<string | null>> {
  return masterWorkerRepository.findWorkerCodesByWorkerIds(workerIds, connection);
}
