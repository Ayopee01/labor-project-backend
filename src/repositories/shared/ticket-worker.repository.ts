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

// Function ดึงรายการ ticket workers จาก DB
export async function listTicketWorkers(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const workers = await db.ticketWorker.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return workers
    .map((worker) => mapTicketWorker(worker))
    .filter((worker): worker is TicketWorkerDto => worker !== null);
}

export async function syncTicketWorkersFromVehicleAssignments(
  ticketId: number,
  vehicleJobId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const now = new Date();
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
      ticketId,
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
        ticketId,
        workerAccountId,
        status: TICKET_WORKER_STATUS.WORKING,
        joinedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  if (activeWorkerAccountIds.length > 0) {
    await db.ticketWorker.updateMany({
      where: {
        ticketId,
        workerAccountId: {
          in: activeWorkerAccountIds,
        },
        status: {
          not: TICKET_WORKER_STATUS.COMPLETED,
        },
      },
      data: {
        status: TICKET_WORKER_STATUS.WORKING,
        cancelledAt: null,
        completedAt: null,
        finalEarningAmount: null,
      },
    });
  }

  await db.ticketWorker.updateMany({
    where: {
      ticketId,
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

  const workers = await db.ticketWorker.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return workers
    .map((worker) => mapTicketWorker(worker))
    .filter((worker): worker is TicketWorkerDto => worker !== null);
}
