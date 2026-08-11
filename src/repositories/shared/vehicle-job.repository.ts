// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  TERMINAL_JOB_STATUSES,
  TERMINAL_TICKET_STATUSES,
  TICKET_STATUS,
  VEHICLE_JOB_STATUS,
} from "../../constants/job-status";
import { countScannedAssignments } from "./vehicle-job-assignment.repository";
import {
  mapGateTicket,
  mapMarketJob,
  mapTicketProduct,
  mapVehicleJob,
} from "./mappers";
import { client, requireDto } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type {
  CompletedVehicleJobResult,
  CurrentTicketProgressDto,
  VehicleJobDetailResponse,
  VehicleJobDto,
  VehicleWorkReadinessDto,
} from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลง vehicle job detail จาก DB
export function mapVehicleJobDetail(
  record: Prisma.VehicleJobGetPayload<{
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
  }>,
): VehicleJobDetailResponse {
  return {
    vehicle_job: requireDto(mapVehicleJob(record), "vehicle job"),
    markets: record.marketJobs.map((market) => ({
      ...requireDto(mapMarketJob(market), "market job"),
      tickets: market.tickets.map((ticket) => ({
        ...requireDto(mapGateTicket(ticket), "gate ticket"),
        products: ticket.products.map((product) =>
          requireDto(mapTicketProduct(product), "ticket product"),
        ),
      })),
    })),
  };
}

// Function ค้นหา vehicle job ตาม ID จาก DB
export async function findVehicleJobById(
  id: number,
  connection?: DbConnection,
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
  connection?: DbConnection,
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
  connection?: DbConnection,
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

export async function markVehicleJobInProgress(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleJobDto> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.update({
    where: {
      id: vehicleJobId,
    },
    data: {
      status: VEHICLE_JOB_STATUS.WORKING,
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job progress");
}

export async function updateMarketJobStatus(
  marketJobId: number,
  status: string,
  connection?: DbConnection,
): Promise<void> {
  const db = client(connection);

  await db.marketJob.update({
    where: {
      id: marketJobId,
    },
    data: {
      status,
    },
  });
}

export async function updateGateTicketStatus(
  ticketId: number,
  status: string,
  connection?: DbConnection,
): Promise<CurrentTicketProgressDto["ticket"]> {
  const db = client(connection);
  const ticket = await db.gateTicket.update({
    where: {
      id: ticketId,
    },
    data: {
      status,
    },
  });

  return requireDto(mapGateTicket(ticket), "gate ticket status update");
}

export async function findCurrentOpenTicketByVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<CurrentTicketProgressDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
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
          },
        },
      },
    },
  });

  if (!vehicleJob) {
    return null;
  }

  for (const market of vehicleJob.marketJobs) {
    const ticket = market.tickets.find(
      (candidate) => !TERMINAL_TICKET_STATUSES.includes(candidate.status),
    );

    if (!ticket) {
      continue;
    }

    return {
      ticket: requireDto(mapGateTicket(ticket), "current gate ticket"),
      marketCode: market.marketCode,
      marketName: market.marketName,
    };
  }

  return null;
}

export async function getVehicleWorkReadiness(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleWorkReadinessDto> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
    },
    select: {
      workersRequired: true,
    },
  });
  const workersRequired = vehicleJob?.workersRequired ?? 0;
  const checkedInCount = await countScannedAssignments(
    vehicleJobId,
    connection,
  );
  const remainingCount = Math.max(0, workersRequired - checkedInCount);

  return {
    workers_required: workersRequired,
    checked_in_count: checkedInCount,
    remaining_count: remainingCount,
    is_ready: workersRequired > 0 && checkedInCount >= workersRequired,
  };
}

export async function listDispatchableVehicleJobs(
  connection?: DbConnection,
): Promise<VehicleJobDto[]> {
  const db = client(connection);
  const vehicleJobs = await db.vehicleJob.findMany({
    where: {
      status: VEHICLE_JOB_STATUS.WORKING,
    },
    orderBy: {
      id: "asc",
    },
  });

  return vehicleJobs
    .map((vehicleJob) => mapVehicleJob(vehicleJob))
    .filter((vehicleJob): vehicleJob is VehicleJobDto => vehicleJob !== null);
}

export async function findVehicleJobLifecycleState(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<Prisma.VehicleJobGetPayload<{
  include: {
    marketJobs: {
      include: {
        tickets: true;
      };
    };
    assignments: true;
  };
}> | null> {
  const db = client(connection);

  return db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
    },
    include: {
      marketJobs: {
        include: {
          tickets: true,
        },
      },
      assignments: true,
    },
  });
}

export async function updateVehicleJobStatus(
  vehicleJobId: number,
  status: string,
  connection?: DbConnection,
): Promise<VehicleJobDto> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.update({
    where: {
      id: vehicleJobId,
    },
    data: {
      status,
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job status update");
}

export async function completeAssignments(
  assignmentIds: number[],
  completedAt: Date,
  connection?: DbConnection,
): Promise<number> {
  if (assignmentIds.length === 0) {
    return 0;
  }

  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      id: {
        in: assignmentIds,
      },
    },
    data: {
      status: "COMPLETED",
      completedAt,
    },
  });

  return result.count;
}
