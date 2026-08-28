// Import Library
// Import Mappers
import { mapSchedule } from "./mappers";
import { findActiveWorkSchedule, findNextWorkSchedule } from "../../utils/shift";
import { client, toId } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { WorkScheduleDto } from "../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา current ตาม account ID จาก DB
export async function findCurrentByAccountId(
  accountId: number | string,
  connection?: DbConnection,
): Promise<WorkScheduleDto | null> {
  const schedules = await listCurrentByAccountId(accountId, connection);

  return findActiveWorkSchedule(schedules) ?? findNextWorkSchedule(schedules);
}

// Function ค้นหา work schedule ของ worker ตาม Account ID จาก DB (schedule เป็น field บน Account
// เอง ไม่ใช่ entity แยก — 1 account มีได้แค่ 1 schedule ปัจจุบันเสมอ)
export async function findById(
  accountId: number,
  connection?: DbConnection,
): Promise<WorkScheduleDto | null> {
  const db = client(connection);
  const schedule = await db.account.findUnique({
    where: {
      id: accountId,
    },
  });

  return mapSchedule(schedule);
}

// Function ดึงรายการ current ตาม account ID จาก DB
export async function listCurrentByAccountId(
  accountId: number | string,
  connection?: DbConnection,
): Promise<WorkScheduleDto[]> {
  const db = client(connection);
  const account = await db.account.findUnique({
    where: {
      id: toId(accountId),
      role: "worker",
    },
  });
  const schedule = mapSchedule(account);

  return schedule ? [schedule] : [];
}
