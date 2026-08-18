// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import * as workerAssignmentEventRepository from "./shared/worker-assignment-event.repository";
import { withTransaction } from "../db/prisma";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS,
  TICKET_STATUS,
  TICKET_WORKER_STATUS,
  VEHICLE_JOB_STATUS,
} from "../constants/job-status";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";
import {
  mapAccount,
  mapGateTicket,
  mapMarketJob,
  mapVehicleJob,
  mapVehicleJobAssignment,
} from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { AccountDto } from "../types/admin-workers.type";
import type {
  GateTicketDto,
  MarketJobDto,
  VehicleJobAssignmentDto,
  VehicleJobDto,
} from "../types/worker.type";
import type {
  AdminVehicleJobFinancialRecord,
  DailyWorkerIncomeFilters,
  DailyWorkerIncomeRecord,
  VehicleJobHistoryListResult,
  VehicleJobListFilters,
  VehicleJobOperationFilters,
  VehicleJobOperationRecord,
} from "../types/admin-jobs.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึงรายการ vehicle jobs จาก DB
export async function listVehicleJobs(
  filters: VehicleJobListFilters = {},
  connection?: DbConnection,
): Promise<VehicleJobHistoryListResult> {
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
          ticketNumber: {
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
                {
                  gateTransactionRef: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  ticketNo: {
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
  const data = await db.vehicleJob.findMany({
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
          ticketWorkers: {
            include: {
              worker: true,
              payments: true,
            },
          },
          tickets: {
            orderBy: {
              id: "asc",
            },
            include: {
              completionSubmissions: {
                orderBy: {
                  id: "asc",
                },
                include: {
                  submittedByWorker: true,
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
      },
      assignments: {
        orderBy: {
          id: "asc",
        },
        include: {
          worker: true,
          events: true,
        },
      },
    },
    ...(shouldPaginate && {
      skip: ((filters.page as number) - 1) * limit,
      take: limit,
    }),
  });

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
  connection?: DbConnection,
): Promise<VehicleJobOperationRecord[]> {
  const db = client(connection);
  const andFilters: Prisma.VehicleJobWhereInput[] = [];

  if (filters.search) {
    andFilters.push({
      OR: [
        {
          ticketNumber: {
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
                {
                  gateTransactionRef: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
                {
                  ticketNo: {
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

// Function ดึง Financial breakdown ของ VehicleJob ตาม TicketNumber จาก DB
export async function findVehicleJobFinancialByRef(
  ticketNumber: string,
  connection?: DbConnection,
): Promise<AdminVehicleJobFinancialRecord | null> {
  const db = client(connection);

  return db.vehicleJob.findUnique({
    where: {
      ticketNumber,
    },
    include: {
      marketJobs: {
        orderBy: {
          id: "asc",
        },
        include: {
          ticketWorkers: {
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
          tickets: {
            orderBy: {
              id: "asc",
            },
            include: {
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
      },
    },
  });
}

// Function ค้นหา market job ตาม ID จาก DB
export async function findMarketJobById(
  id: number,
  connection?: DbConnection,
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
  connection?: DbConnection,
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
  connection?: DbConnection,
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
  connection?: DbConnection,
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
  ticketNumber: string,
  workerCode: string,
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      vehicleJob: {
        ticketNumber,
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
  connection?: DbConnection,
): Promise<VehicleJobDto> {
  if (!connection) {
    return withTransaction((transaction) =>
      cancelVehicleJob(vehicleJobId, transaction),
    );
  }

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

      marketJob: { vehicleJobId },
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
  await workerAssignmentEventRepository.createManyOnce(
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
    connection,
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
  connection?: DbConnection,
): Promise<MarketJobDto> {
  const db = client(connection);
  const now = new Date();

  await db.ticketWorker.updateMany({
    where: {
      status: TICKET_WORKER_STATUS.WORKING,
      marketJobId,
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

// Function ยกเลิก Gate ticket (booth) จาก DB
//
// ไม่แตะ TicketWorker (Worker Roster) เพราะ Roster เป็นระดับ Business Ticket (market job) แล้ว
// ไม่ใช่ระดับ Booth การยกเลิก Booth เดียวไม่ควรกระทบสมาชิกที่ยังทำ Booth อื่นในใบเดียวกันอยู่
export async function cancelGateTicket(
  ticketId: number,
  connection?: DbConnection,
): Promise<GateTicketDto> {
  const db = client(connection);

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
  connection?: DbConnection,
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
    .filter(
      (assignment): assignment is VehicleJobAssignmentDto =>
        assignment !== null,
    );
}

// Function ดึงรายการ accepted assignments ตาม vehicle job จาก DB
export async function listAcceptedAssignmentsByVehicleJob(
  vehicleJobId: number,
  workerCodes?: string[],
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const workerAccountIds =
    workerCodes && workerCodes.length > 0
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
    .filter(
      (assignment): assignment is VehicleJobAssignmentDto =>
        assignment !== null,
    );
}

// Function ยกเลิก assignment จาก DB พร้อมถอด Worker ออกจาก Booth ที่ยังไม่ Complete
export async function cancelAssignment(
  assignmentId: number,
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto> {
  if (!connection) {
    return withTransaction((transaction) =>
      cancelAssignment(assignmentId, transaction),
    );
  }

  const db = client(connection);
  const now = new Date();

  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },

    data: {
      status: ASSIGNMENT_STATUS.CANCELLED,
    },
  });
  await workerAssignmentEventRepository.createOnce(
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
    connection,
  );

  // ถอด Worker ออกจาก Roster ของทุก Business Ticket ที่ยังไม่ Terminal ภายใต้ TicketNumber
  // เดียวกัน (Ticket ที่ Lock/Terminal แล้วต้องไม่ถูกแก้ Roster ย้อนหลัง)
  await db.ticketWorker.updateMany({
    where: {
      workerAccountId: assignment.workerAccountId,

      status: TICKET_WORKER_STATUS.WORKING,

      marketJob: {
        vehicleJobId: assignment.vehicleJobId,

        status: {
          notIn: [TICKET_STATUS.COMPLETED, TICKET_STATUS.CANCELLED],
        },
      },
    },

    data: {
      status: TICKET_WORKER_STATUS.CANCELLED,

      cancelledAt: now,

      completedAt: null,
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment cancel");
}

// Function ยกเลิก Worker หนึ่งคนออกจาก Business Ticket (market job) ใบเดียว
//
// ต่างจาก cancelAssignment: ไม่แตะ VehicleJobAssignment เลย (worker ยังอยู่กับรถ/TicketNumber
// และยังทำ Business Ticket อื่นได้) กระทบเฉพาะ Roster ของ Business Ticket ใบนี้ใบเดียว
export async function cancelTicketWorkerForMarketJob(
  marketJobId: number,
  workerAccountId: number,
  connection?: DbConnection,
): Promise<boolean> {
  const db = client(connection);
  const result = await db.ticketWorker.updateMany({
    where: {
      marketJobId,
      workerAccountId,
      status: TICKET_WORKER_STATUS.WORKING,
    },
    data: {
      status: TICKET_WORKER_STATUS.CANCELLED,
      cancelledAt: new Date(),
      completedAt: null,
    },
  });

  return result.count === 1;
}

// Function ต่อเวลา assignment scan deadline จาก DB
export async function extendAssignmentScanDeadline(
  assignmentId: number,
  scanDeadlineAt: Date,
  connection?: DbConnection,
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

  return requireDto(
    mapVehicleJobAssignment(assignment),
    "assignment extend scan",
  );
}

// Function ดึงรายได้ Worker รายวันจาก DB — หนึ่งแถว = สมาชิกภาพของ Worker หนึ่งคนใน Business
// Ticket หนึ่งใบ (TicketWorker) กรองตามช่วงวันที่จาก completedAt ถ้ามี ไม่งั้นใช้ joinedAt แทน
// (Business Ticket ที่ยังไม่ Finalize จะยังไม่มี completedAt)
export async function listDailyWorkerIncome(
  filters: DailyWorkerIncomeFilters,
  connection?: DbConnection,
): Promise<{ data: DailyWorkerIncomeRecord[]; total: number }> {
  const db = client(connection);
  const dateRangeFilter: Prisma.TicketWorkerWhereInput[] =
    filters.startAt || filters.endAt
      ? [
        {
          completedAt: {
            ...(filters.startAt && { gte: filters.startAt }),
            ...(filters.endAt && { lt: filters.endAt }),
          },
        },
        {
          AND: [
            { completedAt: null },
            {
              joinedAt: {
                ...(filters.startAt && { gte: filters.startAt }),
                ...(filters.endAt && { lt: filters.endAt }),
              },
            },
          ],
        },
      ]
      : [];
  const workerFilter: Prisma.AccountWhereInput = {
    ...(filters.workerCode && {
      username: {
        equals: filters.workerCode,
        mode: "insensitive",
      },
    }),
    ...(filters.shift !== undefined && {
      shiftNo: filters.shift,
    }),
  };
  const where: Prisma.TicketWorkerWhereInput = {
    ...(Object.keys(workerFilter).length > 0 && {
      worker: workerFilter,
    }),
    ...(filters.status && {
      status: {
        equals: filters.status,
        mode: "insensitive",
      },
    }),
    ...(filters.search && {
      OR: [
        {
          worker: {
            username: {
              contains: filters.search,
              mode: "insensitive",
            },
          },
        },
        {
          worker: {
            fullName: {
              contains: filters.search,
              mode: "insensitive",
            },
          },
        },
        {
          marketJob: {
            ticketNo: {
              contains: filters.search,
              mode: "insensitive",
            },
          },
        },
      ],
    }),
    ...(dateRangeFilter.length > 0 && {
      OR: dateRangeFilter,
    }),
  };
  const limit = filters.limit ?? 20;
  const page = filters.page ?? 1;
  const [data, total] = await Promise.all([
    db.ticketWorker.findMany({
      where,
      orderBy: [
        {
          completedAt: "desc",
        },
        {
          joinedAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        worker: true,
        marketJob: {
          include: {
            vehicleJob: {
              include: {
                assignments: {
                  include: {
                    worker: true,
                  },
                },
              },
            },
            tickets: {
              include: {
                completionSubmissions: true,
              },
            },
          },
        },
      },
    }),
    db.ticketWorker.count({
      where,
    }),
  ]);

  return {
    data,
    total,
  };
}
