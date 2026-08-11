// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import * as adminAuditRepository from "./admin-audit.repository";
import { ACTIVE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS, TICKET_STATUS, TICKET_WORKER_STATUS, VEHICLE_JOB_STATUS } from "../constants/job-status";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/admin-audit.type";
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import { mapAccount, mapGateTicket, mapMarketJob, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";
import { mapVehicleJobDetail } from "./shared/vehicle-job.repository";
export { findVehicleJobById, findVehicleJobByRef, getVehicleJobDetail } from "./shared/vehicle-job.repository";
export { countActiveAssignments, createAssignment, findAssignmentById, findCurrentAssignmentByWorker } from "./shared/vehicle-job-assignment.repository";
export { listTicketWorkers } from "./shared/ticket-worker.repository";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { AccountDto } from "../types/admin-workers.type";
import type { GateTicketDto, MarketJobDto, VehicleJobAssignmentDto, VehicleJobDto } from "../types/worker.type";
import type { AdminVehicleJobFinancialRecord, VehicleJobListFilters, VehicleJobListResult, VehicleJobOperationFilters, VehicleJobOperationRecord } from "../types/admin-jobs.type";

export { accountRepository, profileRepository };

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึงรายการ vehicle jobs จาก DB
export async function listVehicleJobs(
  filters: VehicleJobListFilters = {},
  connection?: DbConnection
): Promise<VehicleJobListResult> {
  const db = client(connection);
  const andFilters: Prisma.VehicleJobWhereInput[] = [];

  if (filters.status) {
    const statusFilter: Prisma.StringFilter = {
      equals: filters.status,
      mode: "insensitive",
    };

    andFilters.push({
      OR: [
        {
          status: statusFilter,
        },
        {
          marketJobs: {
            some: {
              status: statusFilter,
            },
          },
        },
        {
          tickets: {
            some: {
              status: statusFilter,
            },
          },
        },
        {
          assignments: {
            some: {
              status: statusFilter,
            },
          },
        },
      ],
    });
  }

  if (filters.search) {
    andFilters.push({
      OR: [
        {
          ticketNo: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        {
          licensePlate: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        {
          gateTransactionRef: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        {
          marketJobs: {
            some: {
              OR: [
                {
                  marketCode: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  marketName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
        },
        {
          tickets: {
            some: {
              OR: [
                {
                  boothCode: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  boothName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  products: {
                    some: {
                      OR: [
                        {
                          productCode: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                        {
                          productName: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                        {
                          packageCode: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                        {
                          packageName: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    });
  }

  const where: Prisma.VehicleJobWhereInput = {
    ...((filters.startAt || filters.endAt) && {
      createdAt: {
        ...(filters.startAt && {
          gte: filters.startAt,
        }),
        ...(filters.endAt && {
          lt: filters.endAt,
        }),
      },
    }),
    ...(andFilters.length > 0 && {
      AND: andFilters,
    }),
  };
  const shouldPaginate = filters.page !== undefined;
  const limit = filters.limit ?? 20;
  const vehicleJobs = await db.vehicleJob.findMany({
    where,
    orderBy: {
      createdAt: "desc",
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
    ...(shouldPaginate && {
      skip: ((filters.page as number) - 1) * limit,
      take: limit,
    }),
  });
  const data = vehicleJobs
    .map((vehicleJob) => mapVehicleJobDetail(vehicleJob));

  if (!shouldPaginate) {
    return {
      data,
    };
  }

  const total = await db.vehicleJob.count({
    where,
  });

  return {
    data,
    total,
  };
}

// Function ดึงรายการ vehicle job operations จาก DB
export async function listVehicleJobOperations(
  filters: VehicleJobOperationFilters = {},
  connection?: DbConnection
): Promise<VehicleJobOperationRecord[]> {
  const db = client(connection);
  const andFilters: Prisma.VehicleJobWhereInput[] = [];

  if (filters.search) {
    andFilters.push({
      OR: [
        {
          ticketNo: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        {
          licensePlate: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        {
          gateTransactionRef: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        {
          marketJobs: {
            some: {
              OR: [
                {
                  marketCode: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  marketName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
        },
        {
          tickets: {
            some: {
              OR: [
                {
                  boothCode: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  boothName: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  products: {
                    some: {
                      OR: [
                        {
                          productCode: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                        {
                          productName: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                        {
                          packageCode: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                        {
                          packageName: {
                            contains: filters.search,
                            mode: "insensitive",
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    });
  }

  const where: Prisma.VehicleJobWhereInput = {
    ...((filters.startAt || filters.endAt) && {
      createdAt: {
        ...(filters.startAt && {
          gte: filters.startAt,
        }),
        ...(filters.endAt && {
          lt: filters.endAt,
        }),
      },
    }),
    ...(andFilters.length > 0 && {
      AND: andFilters,
    }),
  };

  return db.vehicleJob.findMany({
    where,
    orderBy: {
      createdAt: "desc",
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
      assignments: {
        orderBy: [
          {
            createdAt: "asc",
          },
          {
            id: "asc",
          },
        ],
        include: {
          worker: true,
        },
      },
    },
  });
}

// Function ดึง Financial breakdown ของ VehicleJob ตาม TicketNo จาก DB
export async function findVehicleJobFinancialByRef(
  ticketNo: string,
  connection?: DbConnection
): Promise<AdminVehicleJobFinancialRecord | null> {
  const db = client(connection);

  return db.vehicleJob.findUnique({
    where: {
      ticketNo,
    },
    include: {
      tickets: {
        orderBy: {
          id: "asc",
        },
        include: {
          marketJob: true,
          workers: {
            orderBy: {
              id: "asc",
            },
            include: {
              worker: true,
              payments: {
                orderBy: {
                  id: "asc",
                },
              },
            },
          },
          products: {
            orderBy: {
              id: "asc",
            },
            include: {
              financial: {
                include: {
                  workerPayments: {
                    orderBy: {
                      id: "asc",
                    },
                    include: {
                      ticketWorker: {
                        include: {
                          worker: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

// Function ค้นหา market job ตาม ID จาก DB
export async function findMarketJobById(
  id: number,
  connection?: DbConnection
): Promise<MarketJobDto | null> {
  const db = client(connection);
  const marketJob = await db.marketJob.findUnique({
    where: {
      id,
    },
  });

  return mapMarketJob(marketJob);
}

// Function ค้นหา market job ตาม ref จาก DB
export async function findMarketJobByRef(
  marketCode: string,
  connection?: DbConnection
): Promise<MarketJobDto | null> {
  const db = client(connection);
  const marketJob = await db.marketJob.findFirst({
    where: {
      marketCode,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapMarketJob(marketJob);
}

// Function ค้นหา Gate ticket ตาม ref จาก DB
export async function findGateTicketByRef(
  boothCode: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      boothCode,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapGateTicket(ticket);
}

// Function ค้นหา worker ตาม code จาก DB
export async function findWorkerByCode(
  workerCode: string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      role: "worker",
      username: workerCode,
    },
  });

  return mapAccount(account);
}

// Function ค้นหา active assignment ตาม vehicle job ref และ WorkerCode จาก DB
export async function findActiveAssignmentByVehicleJobRefAndWorkerCode(
  ticketNo: string,
  workerCode: string,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      vehicleJob: {
        ticketNo,
      },
      worker: {
        username: workerCode,
      },
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapVehicleJobAssignment(assignment);
}

// Function ยกเลิก vehicle job จาก DB
export async function cancelVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<VehicleJobDto> {
  const db = client(connection);
  const now = new Date();
  const activeAssignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  await db.ticketWorker.updateMany({
    where: {
      status: TICKET_WORKER_STATUS.WORKING,

      ticket: { vehicleJobId },
    },
    data: {
      status: TICKET_WORKER_STATUS.CANCELLED,
      cancelledAt: now,
      completedAt: null,
    },
  });

  await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: ASSIGNMENT_STATUS.CANCELLED,
    },
  });
  await adminAuditRepository.createWorkerAssignmentEventsOnce(
    activeAssignments.map((assignment) => ({
      assignment_id: assignment.id,
      worker_account_id: assignment.workerAccountId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED,
      occurred_at: now,
      metadata: {
        source: "admin_vehicle_job_cancel",
      },
    })),
    connection
  );

  const vehicleJob = await db.vehicleJob.update({
    where: {
      id: vehicleJobId,
    },
    data: {
      status: VEHICLE_JOB_STATUS.CANCELLED,
      marketJobs: {
        updateMany: {
          where: {},
          data: {
            status: VEHICLE_JOB_STATUS.CANCELLED,
          },
        },
      },
      tickets: {
        updateMany: {
          where: {},
          data: {
            status: TICKET_STATUS.CANCELLED,
          },
        },
      },
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job cancel");
}

// Function ยกเลิก market job จาก DB
export async function cancelMarketJob(
  marketJobId: number,
  connection?: DbConnection
): Promise<MarketJobDto> {
  const db = client(connection);
  const now = new Date();

  await db.ticketWorker.updateMany({
    where: {
      status: TICKET_WORKER_STATUS.WORKING,
      ticket: { marketJobId },
    },
    data: {
      status: TICKET_WORKER_STATUS.CANCELLED,
      cancelledAt: now,
      completedAt: null,
    },
  });

  const marketJob = await db.marketJob.update({
    where: {
      id: marketJobId,
    },
    data: {
      status: VEHICLE_JOB_STATUS.CANCELLED,
      tickets: {
        updateMany: {
          where: {},
          data: {
            status: TICKET_STATUS.CANCELLED,
          },
        },
      },
    },
  });

  return requireDto(mapMarketJob(marketJob), "market job cancel");
}

// Function ยกเลิก Gate ticket จาก DB
export async function cancelGateTicket(
  ticketId: number,
  connection?: DbConnection
): Promise<GateTicketDto> {
  const db = client(connection);
  const now = new Date();

  await db.ticketWorker.updateMany(
    {
      where: {
        ticketId,
        status: TICKET_WORKER_STATUS.WORKING,
      },
      data: {
        status: TICKET_WORKER_STATUS.CANCELLED,
        cancelledAt: now,
        completedAt: null,
      },
    });

  const ticket = await db.gateTicket.update({
    where: {
      id: ticketId,
    },
    data: {
      status: TICKET_STATUS.CANCELLED,
    },
  });

  return requireDto(mapGateTicket(ticket), "gate ticket cancel");
}


// Function ดึงรายการ active assignments ตาม vehicle job จาก DB
export async function listActiveAssignmentsByVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return assignments
    .map((assignment) => mapVehicleJobAssignment(assignment))
    .filter((assignment): assignment is VehicleJobAssignmentDto => assignment !== null);
}

// Function ดึงรายการ accepted assignments ตาม vehicle job จาก DB
export async function listAcceptedAssignmentsByVehicleJob(
  vehicleJobId: number,
  workerCodes?: string[],
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const workerAccountIds = workerCodes && workerCodes.length > 0
    ? (
      await db.account.findMany({
        where: {
          role: "worker",
          username: {
            in: workerCodes,
          },
        },
        select: {
          id: true,
        },
      })
    ).map((account) => account.id)
    : undefined;

  if (workerCodes && workerCodes.length > 0 && workerAccountIds?.length === 0) {
    return [];
  }

  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: ASSIGNMENT_STATUS.ACCEPTED,
      ...(workerAccountIds &&
        workerAccountIds.length > 0 && {
        workerAccountId: {
          in: workerAccountIds,
        },
      }),
    },
    orderBy: {
      id: "asc",
    },
  });

  return assignments
    .map((assignment) => mapVehicleJobAssignment(assignment))
    .filter((assignment): assignment is VehicleJobAssignmentDto => assignment !== null);
}

// Function ยกเลิก assignment จาก DB พร้อมถอด Worker ออกจาก Booth ที่ยังไม่ Complete
export async function cancelAssignment(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const now = new Date();

  const assignment =
    await db.vehicleJobAssignment.update({
      where: {
        id: assignmentId,
      },

      data: {
        status:
          ASSIGNMENT_STATUS.CANCELLED,
      },
    });
  await adminAuditRepository.createWorkerAssignmentEventOnce(
    {
      assignment_id: assignment.id,
      worker_account_id: assignment.workerAccountId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED,
      occurred_at: now,
      metadata: {
        source: "admin_assignment_cancel",
      },
    },
    connection
  );

  await db.ticketWorker.updateMany({
    where: {
      workerAccountId:
        assignment.workerAccountId,

      status:
        TICKET_WORKER_STATUS.WORKING,

      ticket: {
        vehicleJobId:
          assignment.vehicleJobId,

        status: {
          notIn: [
            TICKET_STATUS.COMPLETED,
            TICKET_STATUS.CANCELLED,
          ],
        },
      },
    },

    data: {
      status:
        TICKET_WORKER_STATUS.CANCELLED,

      cancelledAt:
        now,

      completedAt:
        null,
    },
  });

  return requireDto(
    mapVehicleJobAssignment(
      assignment
    ),
    "assignment cancel"
  );
}

// Function ต่อเวลา assignment scan deadline จาก DB
export async function extendAssignmentScanDeadline(
  assignmentId: number,
  scanDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      scanDeadlineAt,
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment extend scan");
}
