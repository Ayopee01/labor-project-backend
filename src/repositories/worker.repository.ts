import { mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";

import type { DbConnection } from "../types/shared/common.type";
import type {
  WorkerAssignmentHistoryItemDto,
  WorkerEarningsSummaryResponse,
} from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

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
                  completionSubmissions: {
                    orderBy: {
                      id: "desc",
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
      ticket_no: market.ticketNo,
      marketCode: market.marketCode,
      marketName: market.marketName,
      booths: market.tickets.map((ticket) => {
        const latestSubmission = ticket.completionSubmissions[0];

        return {
          boothCode: ticket.boothCode,
          boothName: ticket.boothName,
          status: ticket.status,
          confirmation_status: ticket.status,
          completed_at: ticket.completedAt?.toISOString() ?? null,
          confirmed_at: latestSubmission?.confirmedAt?.toISOString() ?? null,
          products: ticket.products.map((product) => ({
            productCode: product.productCode,
            productName: product.productName,
            packageCode: product.packageCode,
            packageName: product.packageName,
            confirmed_quantity: product.confirmedQuantity?.toFixed(2) ?? null,
          })),
          rating: ticket.rating?.score ?? null,
        };
      }),
    })),
  }));
}

// Function ดึงสรุปรายได้ของ Worker ต่อ Business Ticket (ไม่ใช่ต่อ Booth เพราะ TicketWorker
// เป็น Roster ระดับ Business Ticket แล้ว final_earning_amount จึงรวมทุก Booth ของ Ticket นั้น)
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
      marketJob: {
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
        marketJob: {
          completedAt: "desc",
        },
      },
      {
        id: "asc",
      },
    ],
    include: {
      marketJob: {
        include: {
          vehicleJob: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    completed_at: row.marketJob.completedAt?.toISOString() ?? "",
    ticket_number: row.marketJob.vehicleJob.ticketNumber,
    ticket_no: row.marketJob.ticketNo,
    license_plate: row.marketJob.vehicleJob.licensePlate,
    license_plate_province: row.marketJob.vehicleJob.licensePlateProvince,
    booth_count: row.marketJob.boothCount,
    marketCode: row.marketJob.marketCode,
    marketName: row.marketJob.marketName,
    earnings: row.finalEarningAmount?.toFixed(2) ?? "0.00",
  }));
}
