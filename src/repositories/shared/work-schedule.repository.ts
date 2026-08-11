// Import Library
// Import Mappers
import { mapSchedule } from "./mappers";
import {
  findActiveWorkSchedule,
  findNextWorkSchedule,
} from "../../utils/shift";
import { client, toId } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { WorkScheduleDto } from "../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก Prisma client หรือ transaction client ที่ส่งเข้ามา
// Function แปลง id เป็น account id แบบ number สำหรับ query DB
// Function ค้นหา current ตาม account ID จาก DB
export async function findCurrentByAccountId(
  accountId: number | string,
  connection?: DbConnection,
): Promise<WorkScheduleDto | null> {
  const schedules = await listCurrentByAccountId(accountId, connection);

  return findActiveWorkSchedule(schedules) ?? findNextWorkSchedule(schedules);
}

// Function ค้นหา ตาม ID จาก DB
export async function findById(
  scheduleId: number,
  connection?: DbConnection,
): Promise<WorkScheduleDto | null> {
  const db = client(connection);
  const schedule = await db.account.findUnique({
    where: {
      id: scheduleId,
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
