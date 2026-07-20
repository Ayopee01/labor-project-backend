// import Library
import { prisma } from "../../db/prisma";

// import Mapper
import { mapSchedule } from "./mappers";
import { findActiveWorkSchedule, findNextWorkSchedule } from "../../utils/shift";

// import Types
import type { DbConnection } from "../../types/common.type";
import type { WorkScheduleDto } from "../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติหรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id จาก path/string ให้เป็น number สำหรับ Prisma query
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function ค้นหา schedule ปัจจุบันของ account ใช้ร่วมกับ Auth, Admin Workers และ Worker Application
export async function findCurrentByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<WorkScheduleDto | null> {
  const schedules = await listCurrentByAccountId(accountId, connection);

  return findActiveWorkSchedule(schedules) ?? findNextWorkSchedule(schedules);
}

export async function findById(
  scheduleId: number,
  connection?: DbConnection
): Promise<WorkScheduleDto | null> {
  const db = client(connection);
  const schedule = await db.workerWorkSchedule.findUnique({
    where: {
      id: scheduleId,
    },
  });

  return mapSchedule(schedule);
}

export async function listCurrentByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<WorkScheduleDto[]> {
  const db = client(connection);
  const schedules = await db.workerWorkSchedule.findMany({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
    orderBy: [
      {
        shiftNo: "asc",
      },
      {
        id: "asc",
      },
    ],
  });

  return schedules
    .map((schedule) => mapSchedule(schedule))
    .filter((schedule): schedule is WorkScheduleDto => schedule !== null);
}
