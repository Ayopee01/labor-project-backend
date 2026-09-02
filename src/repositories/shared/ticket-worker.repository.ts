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

// Function Sync Worker Roster ของ Business Ticket ตามทีมปัจจุบัน
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
      assignments.map((assignment) => assignment.workerId)
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
    existingWorkers.map((worker) => worker.workerId)
  );
  const missingWorkerAccountIds = activeWorkerAccountIds.filter(
    (workerId) => !existingWorkerAccountIds.has(workerId)
  );

  if (missingWorkerAccountIds.length > 0) {
    await db.ticketWorker.createMany({
      data: missingWorkerAccountIds.map((workerId) => ({
        marketJobId,
        workerId,
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
          workerId: {
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
