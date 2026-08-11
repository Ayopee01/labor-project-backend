import { ASSIGNMENT_STATUS } from "../constants/job-status";
import { mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";

import type { DbConnection } from "../types/shared/common.type";
import type {
  WorkerAssignmentHistoryItemDto,
  WorkerEarningsSummaryResponse,
} from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

export async function getWorkerDailyAssignmentCounts(
  workerAccountId: number,
  startAt: Date,
  endAt: Date,
  connection?: DbConnection,
): Promise<{
  today_job_count: number;
  completed_job_count: number;
}> {
  const db = client(connection);
  const [todayJobCount, completedJobCount] = await Promise.all([
    db.vehicleJobAssignment.count({
      where: {
        workerAccountId,
        createdAt: {
          gte: startAt,
          lt: endAt,
        },
        status: {
          not: ASSIGNMENT_STATUS.TIMEOUT,
        },
      },
    }),
    db.vehicleJobAssignment.count({
      where: {
        workerAccountId,
        createdAt: {
          gte: startAt,
          lt: endAt,
        },
        OR: [
          {
            status: ASSIGNMENT_STATUS.COMPLETED,
          },
          {
            completedAt: {
              not: null,
            },
          },
        ],
      },
    }),
  ]);

  return {
    today_job_count: todayJobCount,
    completed_job_count: completedJobCount,
  };
}

export async function listWorkerAssignmentHistoryByDate(
  workerAccountId: number,
  startAt: Date,
  endAt: Date,
  connection?: DbConnection,
): Promise<WorkerAssignmentHistoryItemDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      workerAccountId,
      createdAt: {
        gte: startAt,
        lt: endAt,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      vehicleJob: {
        include: {
          marketJobs: {
            orderBy: {
              id: "asc",
            },
            include: {
              tickets: {
                orderBy: {
                  id: "asc",
                },
                include: {
                  products: {
                    orderBy: {
                      id: "asc",
                    },
                  },
                  rating: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return assignments.map((assignment) => ({
    assignment: requireDto(mapVehicleJobAssignment(assignment), "assignment"),
    vehicle_job: requireDto(
      mapVehicleJob(assignment.vehicleJob),
      "vehicle job",
    ),
    markets: assignment.vehicleJob.marketJobs.map((market) => ({
      marketCode: market.marketCode,
      marketName: market.marketName,
      booths: market.tickets.map((ticket) => ({
        boothCode: ticket.boothCode,
        boothName: ticket.boothName,
        products: ticket.products.map((product) => ({
          productCode: product.productCode,
          productName: product.productName,
          packageCode: product.packageCode,
          packageName: product.packageName,
          confirmed_quantity: product.confirmedQuantity?.toFixed(2) ?? null,
        })),
        rating: ticket.rating?.score ?? null,
      })),
    })),
  }));
}

export async function listWorkerEarningsSummaryRows(
  workerAccountId: number,
  startAt: Date,
  endAt: Date,
  connection?: DbConnection,
): Promise<WorkerEarningsSummaryResponse["details"]> {
  const db = client(connection);
  const rows = await db.ticketWorker.findMany({
    where: {
      workerAccountId,
      finalEarningAmount: {
        not: null,
      },
      ticket: {
        completedAt: {
          gte: startAt,
          lt: endAt,
        },
        financializedAt: {
          not: null,
        },
      },
    },
    orderBy: [
      {
        ticket: {
          completedAt: "desc",
        },
      },
      {
        id: "asc",
      },
    ],
    include: {
      ticket: {
        include: {
          vehicleJob: true,
          marketJob: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    completed_at: row.ticket.completedAt?.toISOString() ?? "",
    ticketNo: row.ticket.vehicleJob.ticketNo,
    license_plate: row.ticket.vehicleJob.licensePlate,
    booth_count: row.ticket.vehicleJob.boothCount,
    marketCode: row.ticket.marketJob.marketCode,
    marketName: row.ticket.marketJob.marketName,
    boothCode: row.ticket.boothCode,
    boothName: row.ticket.boothName,
    earnings: row.finalEarningAmount?.toFixed(2) ?? "0.00",
  }));
}
