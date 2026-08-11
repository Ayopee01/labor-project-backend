// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS,
  TERMINAL_JOB_STATUSES,
  TERMINAL_TICKET_STATUSES,
  TICKET_STATUS,
  VEHICLE_JOB_STATUS,
} from "../../constants/job-status";
import { withTransaction } from "../../db/prisma";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../../types/shared/worker-assignment-event.type";
import { countScannedAssignments } from "./vehicle-job-assignment.repository";
import { syncTicketWorkersFromVehicleAssignments } from "./ticket-worker.repository";
import * as workerAssignmentEventRepository from "./worker-assignment-event.repository";
import { mapGateTicket, mapMarketJob, mapTicketProduct, mapVehicleJob } from "./mappers";
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

export async function markVehicleJobInProgress(
  vehicleJobId: number,
  connection?: DbConnection
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

  await activateNextTicketIfReady(vehicleJobId, connection);

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job progress");
}

export async function findCurrentOpenTicketByVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection
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
      (candidate) => !TERMINAL_TICKET_STATUSES.includes(candidate.status)
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
  connection?: DbConnection
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
  const checkedInCount = await countScannedAssignments(vehicleJobId, connection);
  const remainingCount = Math.max(0, workersRequired - checkedInCount);

  return {
    workers_required: workersRequired,
    checked_in_count: checkedInCount,
    remaining_count: remainingCount,
    is_ready: workersRequired > 0 && checkedInCount >= workersRequired,
  };
}

export async function activateNextTicketIfReady(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<CurrentTicketProgressDto | null> {
  const db = client(connection);
  const current = await findCurrentOpenTicketByVehicleJob(vehicleJobId, connection);

  if (!current) {
    return null;
  }

  await db.marketJob.update({
    where: {
      id: current.ticket.market_job_id,
    },
    data: {
      status: VEHICLE_JOB_STATUS.WORKING,
    },
  });

  const activatableTicketStatuses: string[] = [TICKET_STATUS.WAIT];

  if (!activatableTicketStatuses.includes(current.ticket.status)) {
    await syncTicketWorkersFromVehicleAssignments(
      current.ticket.id,
      vehicleJobId,
      connection
    );

    return current;
  }

  const ticket = await db.gateTicket.update({
    where: {
      id: current.ticket.id,
    },
    data: {
      status: TICKET_STATUS.WORKING,
    },
  });

  await syncTicketWorkersFromVehicleAssignments(
    ticket.id,
    vehicleJobId,
    connection
  );

  return {
    ...current,
    ticket: requireDto(mapGateTicket(ticket), "activated gate ticket"),
  };
}

export async function listDispatchableVehicleJobs(
  connection?: DbConnection
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

export async function closeCompletedVehicleJobIfReady(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<CompletedVehicleJobResult | null> {
  if (!connection) {
    return withTransaction((transaction) =>
      closeCompletedVehicleJobIfReady(vehicleJobId, transaction)
    );
  }

  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
    },
    include: {
      marketJobs: {
        include: {
          tickets: true,
        },
      },
    },
  });

  if (!vehicleJob) {
    return null;
  }

  for (const market of vehicleJob.marketJobs) {
    const allTicketsTerminal =
      market.tickets.length > 0 &&
      market.tickets.every((ticket) =>
        TERMINAL_TICKET_STATUSES.includes(ticket.status)
      );

    if (allTicketsTerminal && !TERMINAL_JOB_STATUSES.includes(market.status)) {
      const marketStatus = market.tickets.every(
        (ticket) => ticket.status === TICKET_STATUS.CANCELLED
      )
        ? VEHICLE_JOB_STATUS.CANCELLED
        : VEHICLE_JOB_STATUS.COMPLETED;

      await db.marketJob.update({
        where: {
          id: market.id,
        },
        data: {
          status: marketStatus,
        },
      });
    }
  }

  const refreshedVehicleJob = await db.vehicleJob.findUnique({
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

  if (!refreshedVehicleJob) {
    return null;
  }

  const isVehicleComplete =
    refreshedVehicleJob.marketJobs.length > 0 &&
    refreshedVehicleJob.marketJobs.every(
      (market) =>
        TERMINAL_JOB_STATUSES.includes(market.status) &&
        market.tickets.length > 0 &&
        market.tickets.every((ticket) =>
          TERMINAL_TICKET_STATUSES.includes(ticket.status)
        )
    );

  if (!isVehicleComplete) {
    return null;
  }

  const vehicleStatus = refreshedVehicleJob.marketJobs.every(
    (market) => market.status === VEHICLE_JOB_STATUS.CANCELLED
  )
    ? VEHICLE_JOB_STATUS.CANCELLED
    : VEHICLE_JOB_STATUS.COMPLETED;
  const updatedVehicleJob = TERMINAL_JOB_STATUSES.includes(refreshedVehicleJob.status)
    ? refreshedVehicleJob
    : await db.vehicleJob.update({
      where: {
        id: vehicleJobId,
      },
      data: {
        status: vehicleStatus,
      },
    });
  const activeAssignments = refreshedVehicleJob.assignments.filter((assignment) =>
    ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
  );
  const completedAssignmentIds = activeAssignments.map((assignment) => assignment.id);
  const completedWorkerAccountIds = activeAssignments.map(
    (assignment) => assignment.workerAccountId
  );

  if (completedAssignmentIds.length > 0) {
    const completedAt = new Date();

    await db.vehicleJobAssignment.updateMany({
      where: {
        id: {
          in: completedAssignmentIds,
        },
      },
      data: {
        status: ASSIGNMENT_STATUS.COMPLETED,
        completedAt,
      },
    });
    await workerAssignmentEventRepository.createManyOnce(
      activeAssignments.map((assignment) => ({
        assignment_id: assignment.id,
        worker_account_id: assignment.workerAccountId,
        vehicle_job_id: assignment.vehicleJobId,
        event_type: WORKER_ASSIGNMENT_EVENT_TYPE.COMPLETED,
        occurred_at: completedAt,
      })),
      connection
    );
  }

  return {
    vehicle_job: requireDto(mapVehicleJob(updatedVehicleJob), "vehicle job close"),
    completed_assignment_ids: completedAssignmentIds,
    completed_worker_account_ids: completedWorkerAccountIds,
  };
}
