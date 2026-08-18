// Import Dependencies
import {
  SCANNED_ASSIGNMENT_STATUSES,
  TICKET_WORKER_STATUS,
} from "../../constants/job-status";
import { mapTicketWorker } from "./mappers";
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { TicketWorkerDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

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

// Function Sync Worker Roster ของ Business Ticket ให้ตรงกับทีม Worker ปัจจุบันของ TicketNumber
//
// เพิ่มเฉพาะสมาชิกใหม่ที่ยังไม่มี Roster (WORKING) และตัดสมาชิกที่ Assignment หลุดจากทีมแล้ว
// (WORKING -> CANCELLED) เท่านั้น
//
// ห้าม Reactivate แถวที่ CANCELLED อยู่แล้วเด็ดขาด เพราะอาจเป็นการ Cancel เฉพาะ Ticket นี้
// โดย Admin ซึ่งต้องคงอยู่แม้ Worker จะยัง Active อยู่กับ TicketNumber ก็ตาม
//
// ห้ามแตะ Roster ของ Business Ticket ที่ Lock แล้ว (workerRosterLockedAt ไม่เป็น null)
export async function syncTicketWorkersFromVehicleAssignments(
  marketJobId: number,
  vehicleJobId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const now = new Date();

  const marketJob = await db.marketJob.findUnique({
    where: {
      id: marketJobId,
    },
    select: {
      workerRosterLockedAt: true,
    },
  });

  if (!marketJob || marketJob.workerRosterLockedAt !== null) {
    return listTicketWorkers(marketJobId, connection);
  }

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
  const activeWorkerAccountIds = [
    ...new Set(
      assignments.map((assignment) => assignment.workerAccountId)
    ),
  ];
  const existingWorkers = await db.ticketWorker.findMany({
    where: {
      marketJobId,
    },
    orderBy: {
      id: "asc",
    },
  });
  const existingWorkerAccountIds = new Set(
    existingWorkers.map((worker) => worker.workerAccountId)
  );
  const missingWorkerAccountIds = activeWorkerAccountIds.filter(
    (workerAccountId) => !existingWorkerAccountIds.has(workerAccountId)
  );

  if (missingWorkerAccountIds.length > 0) {
    await db.ticketWorker.createMany({
      data: missingWorkerAccountIds.map((workerAccountId) => ({
        marketJobId,
        workerAccountId,
        status: TICKET_WORKER_STATUS.WORKING,
        joinedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  // ตัดเฉพาะสมาชิกที่ยัง WORKING แต่ Assignment หลุดจากทีมแล้ว (worker ออกจากรถ)
  // ไม่แตะแถวที่ถูก Cancel ไว้แล้ว (CANCELLED) หรือ COMPLETED แล้ว
  await db.ticketWorker.updateMany({
    where: {
      marketJobId,
      status: TICKET_WORKER_STATUS.WORKING,
      ...(activeWorkerAccountIds.length > 0
        ? {
          workerAccountId: {
            notIn: activeWorkerAccountIds,
          },
        }
        : {}),
    },
    data: {
      status: TICKET_WORKER_STATUS.CANCELLED,
      cancelledAt: now,
      completedAt: null,
      finalEarningAmount: null,
    },
  });

  return listTicketWorkers(marketJobId, connection);
}
