// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import { mapGateTicket, mapMarketJob, mapTicketProduct, mapVehicleJob } from "./mappers";
import { client, requireDto } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { VehicleJobDetailResponse, VehicleJobDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลง vehicle job detail จาก DB
export function mapVehicleJobDetail(record: Prisma.VehicleJobGetPayload<{
  include: {
    marketJobs: {
      include: {
        tickets: {
          include: {
            products: true;
          };
        };
      };
    };
  };
}>): VehicleJobDetailResponse {
  return {
    vehicle_job: requireDto(mapVehicleJob(record), "vehicle job"),
    markets: record.marketJobs.map((market) => ({
      ...requireDto(mapMarketJob(market), "market job"),
      tickets: market.tickets.map((ticket) => ({
        ...requireDto(mapGateTicket(ticket), "gate ticket"),
        products: ticket.products.map((product) =>
          requireDto(mapTicketProduct(product), "ticket product")
        ),
      })),
    })),
  };
}

// Function ค้นหา vehicle job ตาม ID จาก DB
export async function findVehicleJobById(
  id: number,
  connection?: DbConnection
): Promise<VehicleJobDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id,
    },
  });

  return mapVehicleJob(vehicleJob);
}

// Function ค้นหา vehicle job ตาม ref จาก DB
export async function findVehicleJobByRef(
  ticketNo: string,
  connection?: DbConnection
): Promise<VehicleJobDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      ticketNo,
    },
  });

  return mapVehicleJob(vehicleJob);
}

// Function ดึง vehicle job detail จาก DB
export async function getVehicleJobDetail(
  id: number,
  connection?: DbConnection
): Promise<VehicleJobDetailResponse | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id,
    },
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
            },
          },
        },
      },
    },
  });

  return vehicleJob ? mapVehicleJobDetail(vehicleJob) : null;
}
