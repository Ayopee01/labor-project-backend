// Import Dependencies
import { SCANNED_ASSIGNMENT_STATUSES, TICKET_WORKER_STATUS } from "../../constants/job-status";
import { mapTicketWorker } from "./mappers";
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { TicketWorkerDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา TicketWorker หนึ่งแถวของ worker คนหนึ่งใน Business Ticket ใบหนึ่งจาก DB — ใช้หา id
// ก่อนสร้าง GateTicketWorkerExclusion (ต้องใช้ ticketWorkerId เป็น FK ไม่ใช่ workerId ตรงๆ)
export async function findTicketWorkerByMarketJobAndWorkerAccountId(
  marketJobId: number,
  workerId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto | null> {
  const db = client(connection);
  const worker = await db.ticketWorker.findUnique({
    where: {
      marketJobId_workerId: {
        marketJobId,
        workerId,
      },
    },
  });

  return mapTicketWorker(worker);
}

// Function ดึงรายการ worker roster ของ Business Ticket (market job) จาก DB
export async function listTicketWorkers(
  marketJobId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const workers = await db.ticketWorker.findMany({
    where: {
      marketJobId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return workers
    .map((worker) => mapTicketWorker(worker))
    .filter((worker): worker is TicketWorkerDto => worker !== null);
}

// Function ดึงสถานะ lock ของ Worker Roster ของ Business Ticket จาก DB — found: false เมื่อไม่มี
// MarketJob แถวนี้อยู่จริง (ต่างจาก found: true + workerRosterLockedAt: null ที่แปลว่ายัง unlock)
export async function findMarketJobRosterLockState(
  marketJobId: number,
  connection?: DbConnection
): Promise<{ found: boolean; workerRosterLockedAt: Date | null }> {
  const db = client(connection);
  const marketJob = await db.marketJob.findUnique({
    where: {
      id: marketJobId,
    },
    select: {
      workerRosterLockedAt: true,
    },
  });

  return marketJob
    ? { found: true, workerRosterLockedAt: marketJob.workerRosterLockedAt }
    : { found: false, workerRosterLockedAt: null };
}

// Function ดึงรายชื่อ worker (ไม่ซ้ำ) ที่ assignment ยัง active อยู่ (SCANNED_ASSIGNMENT_STATUSES)
// ของ VehicleJob คันนี้จาก DB — ใช้เป็น "ทีมปัจจุบัน" สำหรับ decide roster diff ฝั่ง Service
export async function listActiveScannedAssignmentWorkerIds(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: SCANNED_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return [...new Set(assignments.map((assignment) => assignment.workerId))];
}

// Function สร้างแถว TicketWorker ให้ worker ที่ระบุ (workerIds ตัดสินใจโดย caller แล้วว่าใครขาดจาก
// roster ปัจจุบัน) — skipDuplicates กันชนกรณี concurrent sync ของแผงอื่นในตลาดเดียวกัน
export async function createTicketWorkersIfMissing(
  marketJobId: number,
  workerIds: number[],
  connection?: DbConnection
): Promise<void> {
  if (workerIds.length === 0) {
    return;
  }

  const db = client(connection);

  await db.ticketWorker.createMany({
    data: workerIds.map((workerId) => ({
      marketJobId,
      workerId,
      status: TICKET_WORKER_STATUS.WORKING,
      joinedAt: new Date(),
    })),
    skipDuplicates: true,
  });
}

// Function ตัดสมาชิก TicketWorker ที่ยัง WORKING แต่ไม่อยู่ใน activeWorkerAccountIds ที่ caller ระบุ
// (worker ออกจากทีมแล้ว) — ไม่แตะแถวที่ถูก Cancel ไว้แล้ว (CANCELLED) หรือ COMPLETED แล้ว
export async function cancelDroppedTicketWorkers(
  marketJobId: number,
  activeWorkerAccountIds: number[],
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.ticketWorker.updateMany({
    where: {
      marketJobId,
      status: TICKET_WORKER_STATUS.WORKING,
      ...(activeWorkerAccountIds.length > 0
        ? {
          workerId: {
            notIn: activeWorkerAccountIds,
          },
        }
        : {}),
    },
    data: {
      status: TICKET_WORKER_STATUS.CANCELLED,
      cancelledAt: new Date(),
      completedAt: null,
      finalEarningAmount: null,
    },
  });
}
