import * as baseMasterWorkerRepository from "./shared/master-worker.repository";
import * as workerSessionRepository from "./shared/worker-session.repository";
import { mapMasterWorker } from "./shared/mappers";
import { client, requireMapped, toId } from "./shared/repository-utils";

import type { Prisma } from "@prisma/client";
import type { DbConnection } from "../types/shared/common.type";
import type { MasterWorkerCreateInput, MasterWorkerDto, MasterWorkerUpdateInput, UserListFilters } from "../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

const SEARCH_MODE = "insensitive" as const;

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจว่า master worker DTO จาก DB
function isMasterWorkerDto(worker: MasterWorkerDto | null): worker is MasterWorkerDto {
  return worker !== null;
}

// Function สร้าง worker search where จาก DB
function buildWorkerSearchWhere(search: string): Prisma.MasterWorkerWhereInput[] {
  return [
    {
      laborCode: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      fullName: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      nationality: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
    {
      telephone: {
        contains: search,
        mode: SEARCH_MODE,
      },
    },
  ];
}

// Function สร้าง worker where จาก DB
function buildWorkerWhere(filters: Partial<UserListFilters> = {}): Prisma.MasterWorkerWhereInput {
  const where: Prisma.MasterWorkerWhereInput = {};

  if (filters.status !== undefined) {
    where.status = filters.status === "active" ? 1 : { not: 1 };
  }

  if (filters.search) {
    where.OR = buildWorkerSearchWhere(filters.search);
  }

  return where;
}

// Function จัดการ laborCode exists จาก DB — laborCode คือ identifier หลักของ worker เทียบเท่า
// username เดิม ใช้ตรวจก่อนสร้าง/แก้ worker ทั้งคู่ (เดิมแยก usernameExists/workerCodeExists/
// shirtNumberExists เพราะ Account เก็บ username แยกจาก Profile.shirt_number แต่ตอนนี้ laborCode
// เป็น field เดียวบน MasterWorker)
export async function laborCodeExists(
  laborCode: string,
  exceptWorkerId?: number | string | null,
  connection?: DbConnection,
): Promise<boolean> {
  const db = client(connection);
  const worker = await db.masterWorker.findFirst({
    where: {
      laborCode,
      ...(exceptWorkerId !== undefined &&
        exceptWorkerId !== null && {
          id: {
            not: toId(exceptWorkerId),
          },
        }),
    },
    select: {
      id: true,
    },
  });

  return Boolean(worker);
}

// Function สร้าง worker (source = "admin_created") จาก DB
export async function create(
  input: MasterWorkerCreateInput,
  connection?: DbConnection,
): Promise<MasterWorkerDto> {
  const db = client(connection);
  const created = await db.masterWorker.create({
    data: {
      laborCode: input.labor_code,
      fullName: input.full_name,
      telephone: input.telephone ?? null,
      nationality: input.nationality,
      laborColor: input.labor_color,
      workStartDate: input.work_start_date ? new Date(input.work_start_date) : null,
      workCode: input.work_code ?? null,
      shiftNo: input.shift_no ?? null,
      shiftStartTime: input.shift_start_time ?? null,
      shiftEndTime: input.shift_end_time ?? null,
      timeWork: input.time_work ?? null,
      timeIn: input.time_in ?? null,
      timeOut: input.time_out ?? null,
      status: input.status ?? 1,
      source: "admin_created",
      // ให้เป็น "TH" เสมอสำหรับ worker ที่สร้างทาง Admin (ไม่รับค่าจาก body) ต่างจาก worker ที่ sync
      // มาจาก Master ซึ่งค่านี้มาจากข้อมูลจริง
      lang: "TH",
    },
  });

  return requireMapped(mapMasterWorker(created), "MasterWorker", "create");
}

// Function ดึงรายการ workers จาก DB
export async function listUsers(
  filters: UserListFilters,
  connection?: DbConnection,
): Promise<MasterWorkerDto[]> {
  const db = client(connection);
  const workers = await db.masterWorker.findMany({
    where: buildWorkerWhere(filters),
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    skip: filters.offset,
    take: filters.limit,
  });

  return workers.map((worker) => mapMasterWorker(worker)).filter(isMasterWorkerDto);
}

// Function นับ workers จาก DB
export async function countUsers(
  filters: UserListFilters,
  connection?: DbConnection,
): Promise<number> {
  const db = client(connection);

  return db.masterWorker.count({
    where: buildWorkerWhere(filters),
  });
}

// Function ค้นหา worker ตาม identifier (laborCode) จาก DB
export async function findByIdentifier(
  identifier: string,
  connection?: DbConnection,
): Promise<MasterWorkerDto | null> {
  return baseMasterWorkerRepository.findByLaborCode(identifier, connection);
}

// Function อัปเดตข้อมูล worker จาก DB
export async function update(
  id: number | string,
  fields: MasterWorkerUpdateInput,
  connection?: DbConnection,
): Promise<MasterWorkerDto> {
  const db = client(connection);
  const data: Prisma.MasterWorkerUpdateInput = {};

  if (fields.labor_code !== undefined) {
    data.laborCode = fields.labor_code;
  }

  if (fields.full_name !== undefined) {
    data.fullName = fields.full_name;
  }

  if (fields.telephone !== undefined) {
    data.telephone = fields.telephone;
  }

  if (fields.nationality !== undefined) {
    data.nationality = fields.nationality;
  }

  if (fields.labor_color !== undefined) {
    data.laborColor = fields.labor_color;
  }

  if (fields.work_start_date !== undefined) {
    data.workStartDate = fields.work_start_date ? new Date(fields.work_start_date) : null;
  }

  if (fields.status !== undefined) {
    data.status = fields.status;
  }

  const updated = await db.masterWorker.update({
    where: {
      id: toId(id),
    },
    data,
  });

  return requireMapped(mapMasterWorker(updated), "MasterWorker", "update");
}

// Function อัปเดต shift assignment ปัจจุบันของ worker จาก DB (field อยู่บน MasterWorker เอง)
export async function updateShift(
  id: number | string,
  shift: {
    shift_no: number;
    shift_start_time: string;
    shift_end_time: string;
    work_start_date?: string | null;
  },
  connection?: DbConnection,
): Promise<MasterWorkerDto> {
  const db = client(connection);
  const updated = await db.masterWorker.update({
    where: {
      id: toId(id),
    },
    data: {
      shiftNo: shift.shift_no,
      shiftStartTime: shift.shift_start_time,
      shiftEndTime: shift.shift_end_time,
      ...(shift.work_start_date !== undefined
        ? { workStartDate: shift.work_start_date ? new Date(shift.work_start_date) : null }
        : {}),
    },
  });

  return requireMapped(mapMasterWorker(updated), "MasterWorker", "shift update");
}

// Function ล้าง shift assignment ปัจจุบันของ worker จาก DB
export async function clearShift(
  id: number | string,
  connection?: DbConnection,
): Promise<void> {
  const db = client(connection);

  await db.masterWorker.update({
    where: {
      id: toId(id),
    },
    data: {
      shiftNo: null,
      shiftStartTime: null,
      shiftEndTime: null,
    },
  });
}

const workerRepository = {
  ...baseMasterWorkerRepository,
  laborCodeExists,
  create,
  listUsers,
  countUsers,
  findByIdentifier,
  update,
  updateShift,
  clearShift,
};

export { workerRepository, workerSessionRepository };
