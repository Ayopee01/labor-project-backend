// import Library
import { prisma } from "../db/prisma";
import type { Prisma } from "@prisma/client";

// import Mapper
import { mapSchedule } from "./mapper";

// import Types
import type { DbConnection } from "../types/common.type";
import type { PaginationFilters, WorkScheduleCreateInput, WorkScheduleDto } from "../types/users.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id ให้เป็น number ก่อนส่งเข้า Prisma
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function ใช้กรองผลลัพธ์ null จาก mapper
function isWorkScheduleDto(schedule: WorkScheduleDto | null): schedule is WorkScheduleDto {
  return schedule !== null;
}

// Function ตรวจสอบว่า Prisma คืน schedule กลับมาหลัง create/update
function requireMappedSchedule(
  schedule: WorkScheduleDto | null,
  action: string
): WorkScheduleDto {
  if (!schedule) {
    throw new Error(`Schedule ${action} did not return a record.`);
  }

  return schedule;
}

// Function สร้างข้อมูลสำหรับ create work schedule
function buildScheduleCreateData(
  schedule: WorkScheduleCreateInput
): Prisma.UserWorkScheduleUncheckedCreateInput {
  return {
    accountId: toAccountId(schedule.account_id),
    workDate: schedule.work_date,
    shiftStartTime: schedule.shift_start_time,
    shiftEndTime: schedule.shift_end_time,
    isCurrent: schedule.is_current !== false,
    createdBy: schedule.created_by ?? null,
    updatedBy: schedule.updated_by ?? null,
  };
}

// Function สร้างข้อมูลสำหรับปิด schedule ปัจจุบัน
function buildDeactivateCurrentData(
  actorId?: number | string | null
): Prisma.UserWorkScheduleUncheckedUpdateManyInput {
  return {
    isCurrent: false,
    updatedBy: actorId === undefined || actorId === null ? null : toAccountId(actorId),
  };
}

// Function ค้นหา schedule ปัจจุบันของ account
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

// Function ปิด schedule ปัจจุบันของ account
export async function deactivateCurrentByAccountId(
  accountId: number | string,
  actorId?: number | string | null,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.userWorkSchedule.updateMany({
    where: {
      accountId: toAccountId(accountId),
      isCurrent: true,
    },
    data: buildDeactivateCurrentData(actorId),
  });
}

// Function สร้าง schedule ใหม่ใน table user_work_schedules
export async function create(
  schedule: WorkScheduleCreateInput,
  connection?: DbConnection
): Promise<WorkScheduleDto> {
  const db = client(connection);

  const createdSchedule = await db.userWorkSchedule.create({
    data: buildScheduleCreateData(schedule),
  });

  return requireMappedSchedule(mapSchedule(createdSchedule), "create");
}

// Function ดึงรายการ schedule ของ account ตาม pagination
export async function listByAccountId(
  accountId: number | string,
  filters: PaginationFilters,
  connection?: DbConnection
): Promise<WorkScheduleDto[]> {
  const db = client(connection);

  const schedules = await db.userWorkSchedule.findMany({
    where: {
      accountId: toAccountId(accountId),
    },
    orderBy: {
      id: "desc",
    },
    skip: filters.offset,
    take: filters.limit,
  });

  return schedules.map((schedule) => mapSchedule(schedule)).filter(isWorkScheduleDto);
}

// Function นับจำนวน schedule ของ account
export async function countByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);

  return db.userWorkSchedule.count({
    where: {
      accountId: toAccountId(accountId),
    },
  });
}
