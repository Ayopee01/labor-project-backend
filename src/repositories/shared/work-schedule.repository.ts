// import Library
import { prisma } from "../../db/prisma";

// import Mapper
import { mapSchedule } from "./mappers";

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
  const db = client(connection);
  const schedule = await db.userWorkSchedule.findFirst({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapSchedule(schedule);
}
