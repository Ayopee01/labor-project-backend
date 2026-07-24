// import Library
import { Prisma } from "@prisma/client";

// import
import { ACTIVE_ASSIGNMENT_STATUSES } from "../constants/job-status";
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import { mapAccount, mapGateTicket, mapMarketJob, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";
import { mapVehicleJobDetail } from "./shared/vehicle-job.repository";
export { findVehicleJobById, findVehicleJobByRef, getVehicleJobDetail } from "./shared/vehicle-job.repository";
export { countActiveAssignments, createAssignment, findAssignmentById, findCurrentAssignmentByWorker } from "./shared/vehicle-job-assignment.repository";
export { listTicketWorkers } from "./shared/ticket-worker.repository";

// import Types
import type { DbConnection } from "../types/common.type";
import type { AccountDto } from "../types/admin-workers.type";
import type { GateTicketDto, MarketJobDto, VehicleJobAssignmentDto, VehicleJobDto } from "../types/worker.type";
import type { VehicleJobListFilters, VehicleJobListResult, VehicleJobOperationFilters } from "../types/admin-jobs.type";

export { accountRepository, profileRepository };

export type VehicleJobOperationRecord = Prisma.VehicleJobGetPayload<{
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
    assignments: {
      include: {
        worker: {
          include: {
            profile: true;
            workSchedules: {
              where: {
                isCurrent: true,
              },
              orderBy: {
                shiftNo: "asc",
              },
            },
          };
        };
      };
    };
  };
}>;

/* -------------------------------------- Functions -------------------------------------- */

// Function เธ”เธถเธเธฃเธฒเธขเธเธฒเธฃเธเธฒเธเธฃเธ–เธชเธณเธซเธฃเธฑเธ Admin เธเธฃเนเธญเธก filter เน€เธเธทเนเธญเธเธ•เนเธ
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
              OR: [
                {
                  status: statusFilter,
                },
                {
                  confirmationStatus: statusFilter,
                },
              ],
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
          worker: {
            include: {
              profile: true,
              workSchedules: {
                where: {
                  isCurrent: true,
                },
                orderBy: {
                  shiftNo: "asc",
                },
              },
            },
          },
        },
      },
    },
  });
}

// Function เธซเธฒ market job เธเธฒเธ id
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

// Function เธซเธฒ market job เธเธฒเธเน€เธฅเธเธญเนเธฒเธเธญเธดเธเธ•เธฅเธฒเธ”
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

// Function เธซเธฒ gate ticket เธซเธฃเธทเธญ stall job เธเธฒเธ id
// Function เธซเธฒ gate ticket/stall job เธเธฒเธเน€เธฅเธเธญเนเธฒเธเธญเธดเธเนเธเธ
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

// Function เธซเธฒ worker เธเธฒเธเธฃเธซเธฑเธชเธเธเธฑเธเธเธฒเธเธชเธณเธซเธฃเธฑเธ Admin Jobs flow
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

// Function เธซเธฒ assignment เธเธฑเธเธเธธเธเธฑเธเธเธญเธ worker เนเธเธเธฒเธเธฃเธ–เธเธฒเธ ticketNo + worker_code
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

// Function เธขเธเน€เธฅเธดเธเธเธฒเธเธฃเธ– เธเธฃเนเธญเธกเธเธฒเธเธ•เธฅเธฒเธ” เนเธเธ เนเธฅเธฐ active assignment เนเธ•เนเธฃเธ–
export async function cancelVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<VehicleJobDto> {
  const db = client(connection);

  await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: "CANCELLED",
    },
  });

  const vehicleJob = await db.vehicleJob.update({
    where: {
      id: vehicleJobId,
    },
    data: {
      status: "CANCELLED",
      marketJobs: {
        updateMany: {
          where: {},
          data: {
            status: "CANCELLED",
          },
        },
      },
      tickets: {
        updateMany: {
          where: {},
          data: {
            status: "CANCELLED",
            confirmationStatus: "CANCELLED",
          },
        },
      },
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job cancel");
}

// Function เธขเธเน€เธฅเธดเธเธเธฒเธเธ•เธฅเธฒเธ” เธเธฃเนเธญเธกเนเธเธเนเธ•เนเธ•เธฅเธฒเธ”
export async function cancelMarketJob(
  marketJobId: number,
  connection?: DbConnection
): Promise<MarketJobDto> {
  const db = client(connection);
  const marketJob = await db.marketJob.update({
    where: {
      id: marketJobId,
    },
    data: {
      status: "CANCELLED",
      tickets: {
        updateMany: {
          where: {},
          data: {
            status: "CANCELLED",
            confirmationStatus: "CANCELLED",
          },
        },
      },
    },
  });

  return requireDto(mapMarketJob(marketJob), "market job cancel");
}

// Function เธขเธเน€เธฅเธดเธเธเธฒเธเนเธเธเน€เธ”เธตเธขเธง
export async function cancelGateTicket(
  ticketId: number,
  connection?: DbConnection
): Promise<GateTicketDto> {
  const db = client(connection);
  const ticket = await db.gateTicket.update({
    where: {
      id: ticketId,
    },
    data: {
      status: "CANCELLED",
      confirmationStatus: "CANCELLED",
    },
  });

  return requireDto(mapGateTicket(ticket), "gate ticket cancel");
}

// Function เธชเธฃเนเธฒเธเธเธฒเธเธฃเธ–เธเธฃเนเธญเธกเธ•เธฅเธฒเธ” เธ•เธฑเนเธง เธชเธดเธเธเนเธฒ เนเธฅเธฐเธเธฑเธเธ—เธถเธ Gate request log

// Function เน€เธเธดเธ”เธเธฒเธเนเธเธเธเธฅเธฑเธเธกเธฒเนเธซเน worker เธชเนเธเธขเธญเธ”เนเธซเธกเน เธซเธฅเธฑเธ vendor confirm เธเธดเธ”
// Function เธเธฑเธเธ—เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเธเธญเธเธเธฒเธเนเธเธ
// Function เธ”เธถเธ active assignment เธเธญเธเธเธฒเธเธฃเธ–
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

// Function เน€เธเธฅเธตเนเธขเธ assignment เน€เธเนเธเธฃเธฑเธเธเธฒเธเนเธฅเนเธง
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
      status: "ACCEPTED",
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

// Function เน€เธเธฅเธตเนเธขเธ assignment เน€เธเนเธเธซเธกเธ”เน€เธงเธฅเธฒเธฃเธฑเธเธเธฒเธ
export async function cancelAssignment(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: "CANCELLED",
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment cancel");
}

// Function เธ•เนเธญเน€เธงเธฅเธฒ scan deadline เธเธญเธ assignment
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

