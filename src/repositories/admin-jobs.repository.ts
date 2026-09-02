// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import * as workerAssignmentEventRepository from "./shared/worker-assignment-event.repository";
import { withTransaction } from "../db/prisma";
import { ACTIVE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS, TERMINAL_JOB_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_STATUS, TICKET_WORKER_STATUS, VEHICLE_JOB_STATUS } from "../constants/job-status";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";
import { ADMIN_ACTION_TYPE } from "../types/shared/admin-action-log.type";
import { mapGateTicket, mapMarketJob, mapMasterWorker, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { MasterWorkerDto } from "../types/admin-workers.type";
import type { GateTicketDto, MarketJobDto, VehicleJobAssignmentDto, VehicleJobDto } from "../types/worker.type";
import type { AdminVehicleJobFinancialRecord, DailyStallFeeFilters, DailyStallFeeQueryResult, DailyWorkerIncomeFilters, DailyWorkerIncomeRecord, HistoryStatusFilter, VehicleJobHistoryListResult, VehicleJobListFilters, VehicleJobOperationFilters, VehicleJobOperationRecord } from "../types/admin-jobs.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง data payload สำหรับยกเลิก TicketWorker — ใช้ร่วมกันทุกจุดที่ยกเลิก Roster
// (cancelVehicleJob, cancelMarketJob, cancelAssignment, cancelTicketWorkerForMarketJob) ต่างกันแค่
// where clause ว่ายกเลิกขอบเขตไหน
function cancelledTicketWorkerData(cancelledAt: Date): Prisma.TicketWorkerUpdateManyMutationInput {
  return {
    status: TICKET_WORKER_STATUS.CANCELLED,
    cancelledAt,
    completedAt: null,
  };
}

// Function ดึงรายการ vehicle jobs จาก DB
// Function สร้าง OR filter ค้นหา VehicleJob จาก search term เดียว ครอบคลุมทุกระดับ (Ticket/Market/
// Booth/Product) — ใช้ร่วมกันระหว่าง listVehicleJobs และ listVehicleJobOperations
function buildVehicleJobSearchFilter(search: string): Prisma.VehicleJobWhereInput {
  return {
    OR: [
      {
        ticketNumber: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        licensePlate: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        marketJobs: {
          some: {
            OR: [
              {
                marketCode: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                marketName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                gateTransactionRef: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                ticketNo: {
                  contains: search,
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
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                boothName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                products: {
                  some: {
                    OR: [
                      {
                        productCode: {
                          contains: search,
                          mode: "insensitive",
                        },
                      },
                      {
                        productName: {
                          contains: search,
                          mode: "insensitive",
                        },
                      },
                      {
                        packageCode: {
                          contains: search,
                          mode: "insensitive",
                        },
                      },
                      {
                        packageName: {
                          contains: search,
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
  };
}

// Function รวม date range filter (createdAt) กับ andFilters ที่สะสมไว้ ให้เป็น where เดียว — ใช้ร่วมกัน
// ระหว่าง listVehicleJobs และ listVehicleJobOperations (เรียกซ้ำ 2 ครั้งต่อฟังก์ชัน: ก่อน/หลังใส่
// dropoff_point filter เข้า andFilters)
// Function ประกอบ where clause ของแต่ละ business group ใน Work History (COMPLETED/CANCELLED/
// REJECT_PENDING) — REJECT_PENDING คือรถที่ยังไม่ terminal และมี GateTicket อย่างน้อยหนึ่งใบสถานะ
// REJECT ค้างอยู่ ณ ปัจจุบัน (ไม่ใช่เคย reject ในอดีตแล้วแก้สำเร็จ) ลำดับความสำคัญ CANCELLED →
// COMPLETED → REJECT_PENDING ให้ formatAdminVehicleJobHistoryDetail ใช้ derive HistoryStatus ต่อ
// record เดียวกันแบบเดียวกับที่นี่ ห้ามให้ตรรกะสองจุดเพี้ยนไปจากกัน
function historyStatusGroupWhere(
  group: "COMPLETED" | "CANCELLED" | "REJECT_PENDING",
): Prisma.VehicleJobWhereInput {
  if (group === "COMPLETED") {
    return { status: VEHICLE_JOB_STATUS.COMPLETED };
  }

  if (group === "CANCELLED") {
    return { status: VEHICLE_JOB_STATUS.CANCELLED };
  }

  return {
    status: { notIn: TERMINAL_JOB_STATUSES },
    tickets: {
      some: {
        status: TICKET_STATUS.REJECT,
      },
    },
  };
}

// Function ประกอบ where clause ของ history_status query — ALL คือ OR ของสามกลุ่มเท่านั้น ไม่ใช่ทุก
// สถานะในฐานข้อมูล (ดู comment ของ historyStatusGroupWhere)
function buildHistoryStatusFilter(
  historyStatus: HistoryStatusFilter,
): Prisma.VehicleJobWhereInput {
  if (historyStatus === "ALL") {
    return {
      OR: [
        historyStatusGroupWhere("COMPLETED"),
        historyStatusGroupWhere("CANCELLED"),
        historyStatusGroupWhere("REJECT_PENDING"),
      ],
    };
  }

  return historyStatusGroupWhere(historyStatus);
}

function buildVehicleJobWhere(
  dateRange: { startAt?: Date; endAt?: Date },
  andFilters: Prisma.VehicleJobWhereInput[],
): Prisma.VehicleJobWhereInput {
  return {
    ...((dateRange.startAt || dateRange.endAt) && {
      createdAt: {
        ...(dateRange.startAt && {
          gte: dateRange.startAt,
        }),
        ...(dateRange.endAt && {
          lt: dateRange.endAt,
        }),
      },
    }),
    ...(andFilters.length > 0 && {
      AND: andFilters,
    }),
  };
}

// Function หา distinct dropoff_point ที่มีจริงภายใต้ where ที่ยังไม่ใส่ dropoff_point filter เอง
// (ให้ dropdown เสนอตัวเลือกอื่นได้แม้กำลังกรองอยู่แล้ว ไม่ใช่เหลือแค่ตัวที่เลือกไปตัวเดียว) — ใช้ร่วมกัน
// ระหว่าง listVehicleJobs และ listVehicleJobOperations
async function resolveAvailableDropoffPoints(
  db: DbConnection,
  whereWithoutDropoffPoint: Prisma.VehicleJobWhereInput,
): Promise<string[]> {
  const dropoffPointRows = await db.marketJob.findMany({
    where: {
      vehicleJob: whereWithoutDropoffPoint,
      dropoffPoint: {
        not: null,
      },
    },
    distinct: ["dropoffPoint"],
    select: {
      dropoffPoint: true,
    },
    orderBy: {
      dropoffPoint: "asc",
    },
  });

  return dropoffPointRows
    .map((row) => row.dropoffPoint)
    .filter((point): point is string => point !== null);
}

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

  if (filters.history_status) {
    andFilters.push(buildHistoryStatusFilter(filters.history_status));
  }

  if (filters.search) {
    andFilters.push(buildVehicleJobSearchFilter(filters.search));
  }

  // ใช้ where ก่อนใส่ dropoff_point เอง (ตัวแปรนี้) หา distinct dropoff_point ที่มีจริงภายใต้ filter
  // อื่นๆ (date range/search/status) — ไม่รวม dropoff_point เอง เพื่อให้ dropdown ยังเสนอตัวเลือกอื่น
  // ให้สลับได้แม้กำลังกรองอยู่แล้ว ไม่ใช่เหลือแค่ตัวที่เลือกไปตัวเดียว
  const whereWithoutDropoffPoint = buildVehicleJobWhere(filters, andFilters);
  const availableDropoffPoints = await resolveAvailableDropoffPoints(
    db,
    whereWithoutDropoffPoint,
  );

  if (filters.dropoff_point) {
    andFilters.push({
      marketJobs: {
        some: {
          dropoffPoint: {
            equals: filters.dropoff_point,
            mode: "insensitive",
          },
        },
      },
    });
  }

  const where = buildVehicleJobWhere(filters, andFilters);
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
                  submittedByAccount: true,
                  submittedByWorker: true,
                  workerSnapshots: {
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
      available_dropoff_points: availableDropoffPoints,
    };
  }

  const total = await db.vehicleJob.count({
    where,
  });

  return {
    data,
    total,
    available_dropoff_points: availableDropoffPoints,
  };
}

// Function ดึงรายการ vehicle job operations จาก DB
export async function listVehicleJobOperations(
  filters: VehicleJobOperationFilters = {},
  connection?: DbConnection,
): Promise<{
  records: VehicleJobOperationRecord[];
  available_dropoff_points: string[];
}> {
  const db = client(connection);
  const andFilters: Prisma.VehicleJobWhereInput[] = [];

  if (filters.search) {
    andFilters.push(buildVehicleJobSearchFilter(filters.search));
  }

  // เหมือนกับ listVehicleJobs — หา distinct dropoff_point จาก where ก่อนใส่ dropoff_point filter เอง
  // เพื่อให้ dropdown เสนอตัวเลือกอื่นได้แม้กำลังกรองอยู่แล้ว
  const whereWithoutDropoffPoint = buildVehicleJobWhere(filters, andFilters);
  const availableDropoffPoints = await resolveAvailableDropoffPoints(
    db,
    whereWithoutDropoffPoint,
  );

  if (filters.dropoff_point) {
    andFilters.push({
      marketJobs: {
        some: {
          dropoffPoint: {
            equals: filters.dropoff_point,
            mode: "insensitive",
          },
        },
      },
    });
  }

  const where = buildVehicleJobWhere(filters, andFilters);

  const records = await db.vehicleJob.findMany({
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

  return {
    records,
    available_dropoff_points: availableDropoffPoints,
  };
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

// Function ค้นหา worker ตาม code จาก DB
export async function findWorkerByCode(
  workerCode: string,
  connection?: DbConnection,
): Promise<MasterWorkerDto | null> {
  const db = client(connection);
  const worker = await db.masterWorker.findUnique({
    where: {
      laborCode: workerCode,
    },
  });

  return mapMasterWorker(worker);
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
        laborCode: workerCode,
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
    data: cancelledTicketWorkerData(now),
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
      worker_id: assignment.workerId,
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
        // ยกเว้น MarketJob ที่ terminal ไปแล้ว (COMPLETED/CANCELLED) ไม่ให้ถูกเขียนทับเป็น CANCELLED —
        // ยกเลิกทั้งรถต้องไม่ไปเปลี่ยนประวัติตลาดที่จบไปแล้วจริงก่อนหน้า
        updateMany: {
          where: {
            status: {
              notIn: TERMINAL_JOB_STATUSES,
            },
          },
          data: {
            status: VEHICLE_JOB_STATUS.CANCELLED,
          },
        },
      },
      tickets: {
        // เหตุผลเดียวกับ marketJobs ด้านบน — booth ที่ terminal แล้วต้องคงเดิม
        updateMany: {
          where: {
            status: {
              notIn: TERMINAL_TICKET_STATUSES,
            },
          },
          data: {
            status: TICKET_STATUS.CANCELLED,
          },
        },
      },
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job cancel");
}

// Function ยกเลิก assignment ที่ยัง active ทั้งหมดของ VehicleJob โดยไม่แตะ TicketWorker/MarketJob/
// GateTicket/VehicleJob เอง (ต่างจาก cancelVehicleJob ด้านบนที่ยกเลิกทั้งคัน) — ใช้กับ Admin สั่งกลับ
// ไป Wait ก่อนทีมเริ่มทำงานจริง (ทีมยัง scan ไม่ครบ) จึงไม่มี TicketWorker roster ให้ต้องยกเลิกอยู่แล้ว
export async function cancelActiveAssignmentsForVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto[]> {
  if (!connection) {
    return withTransaction((transaction) =>
      cancelActiveAssignmentsForVehicleJob(vehicleJobId, transaction),
    );
  }

  const db = client(connection);
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

  if (activeAssignments.length === 0) {
    return [];
  }

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

  const now = new Date();

  await workerAssignmentEventRepository.createManyOnce(
    activeAssignments.map((assignment) => ({
      assignment_id: assignment.id,
      worker_id: assignment.workerId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED,
      occurred_at: now,
      metadata: {
        source: "admin_vehicle_job_wait",
      },
    })),
    connection,
  );

  return activeAssignments
    .map(mapVehicleJobAssignment)
    .filter((assignment): assignment is VehicleJobAssignmentDto => assignment !== null);
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
    data: cancelledTicketWorkerData(now),
  });

  const marketJob = await db.marketJob.update({
    where: {
      id: marketJobId,
    },
    data: {
      status: VEHICLE_JOB_STATUS.CANCELLED,
      tickets: {
        // ยกเว้น ticket ที่ terminal ไปแล้ว (COMPLETED/CANCELLED) ไม่ให้ถูกเขียนทับเป็น CANCELLED —
        // ยกเลิกทั้งตลาดต้องไม่ไปเปลี่ยนประวัติ booth ที่จบไปแล้วจริงก่อนหน้า
        updateMany: {
          where: {
            status: {
              notIn: TERMINAL_TICKET_STATUSES,
            },
          },
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
  const workerIds =
    workerCodes && workerCodes.length > 0
      ? (
          await db.masterWorker.findMany({
            where: {
              laborCode: {
                in: workerCodes,
              },
            },
            select: {
              id: true,
            },
          })
        ).map((worker) => worker.id)
      : undefined;

  if (workerCodes && workerCodes.length > 0 && workerIds?.length === 0) {
    return [];
  }

  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: ASSIGNMENT_STATUS.ACCEPTED,
      ...(workerIds &&
        workerIds.length > 0 && {
          workerId: {
            in: workerIds,
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
// Function ยกเลิก assignment จาก DB — เขียนแบบมีเงื่อนไข (status ต้องยังอยู่ใน
// ACTIVE_ASSIGNMENT_STATUSES ณ ตอนเขียนจริง) เพื่อกัน TOCTOU race กับ worker ที่กำลัง
// accept/scan/timeout พร้อมกัน — คืน null เมื่อแพ้ race (assignment ไม่ active แล้วจริงๆ)
export async function cancelAssignment(
  assignmentId: number,
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto | null> {
  if (!connection) {
    return withTransaction((transaction) =>
      cancelAssignment(assignmentId, transaction),
    );
  }

  const db = client(connection);
  const now = new Date();

  const updateResult = await db.vehicleJobAssignment.updateMany({
    where: {
      id: assignmentId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: ASSIGNMENT_STATUS.CANCELLED,
    },
  });

  if (updateResult.count === 0) {
    return null;
  }

  const assignment = await db.vehicleJobAssignment.findUniqueOrThrow({
    where: {
      id: assignmentId,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_id: assignment.workerId,
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
      workerId: assignment.workerId,

      status: TICKET_WORKER_STATUS.WORKING,

      marketJob: {
        vehicleJobId: assignment.vehicleJobId,

        status: {
          notIn: [TICKET_STATUS.COMPLETED, TICKET_STATUS.CANCELLED],
        },
      },
    },

    data: cancelledTicketWorkerData(now),
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment cancel");
}

// Function ยกเลิก Worker หนึ่งคนออกจาก Business Ticket (market job) ใบเดียว
//
// ต่างจาก cancelAssignment: ไม่แตะ VehicleJobAssignment เลย (worker ยังอยู่กับรถ/TicketNumber
// และยังทำ Business Ticket อื่นได้) กระทบเฉพาะ Roster ของ Business Ticket ใบนี้ใบเดียว
export async function cancelTicketWorkerForMarketJob(
  marketJobId: number,
  workerId: number,
  connection?: DbConnection,
): Promise<boolean> {
  const db = client(connection);
  const result = await db.ticketWorker.updateMany({
    where: {
      marketJobId,
      workerId,
      status: TICKET_WORKER_STATUS.WORKING,
    },
    data: cancelledTicketWorkerData(new Date()),
  });

  return result.count === 1;
}

// Function ต่อเวลา assignment scan deadline จาก DB — เขียนแบบมีเงื่อนไข (status ต้องยังเป็น
// ACCEPTED ณ ตอนเขียนจริง) เพื่อกัน TOCTOU race กับ scan-timeout job หรือ worker ที่ scan สำเร็จ
// ไปพร้อมกัน — คืน null เมื่อแพ้ race
export async function extendAssignmentScanDeadline(
  assignmentId: number,
  scanDeadlineAt: Date,
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const updateResult = await db.vehicleJobAssignment.updateMany({
    where: {
      id: assignmentId,
      status: ASSIGNMENT_STATUS.ACCEPTED,
    },
    data: {
      scanDeadlineAt,
    },
  });

  if (updateResult.count === 0) {
    return null;
  }

  const assignment = await db.vehicleJobAssignment.findUniqueOrThrow({
    where: {
      id: assignmentId,
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
// Function สร้าง where ของ listDailyWorkerIncome — แยก workerCode/shift ออกได้อิสระต่อกัน เพื่อใช้
// คำนวณ available_worker_codes/available_shifts จาก filter อื่นๆ ทั้งหมด ไม่รวม filter ของตัวเอง
// (แบบเดียวกับ dropoff_point) ให้ dropdown ยังเสนอตัวเลือกอื่นได้แม้กำลังกรองอยู่แล้ว
function buildDailyWorkerIncomeWhere(
  filters: DailyWorkerIncomeFilters,
  options: { includeWorkerCode: boolean; includeShift: boolean },
): Prisma.TicketWorkerWhereInput {
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
  const workerFilter: Prisma.MasterWorkerWhereInput = {
    ...(options.includeWorkerCode && filters.workerCode && {
      laborCode: {
        equals: filters.workerCode,
        mode: "insensitive",
      },
    }),
    ...(options.includeShift && filters.shift !== undefined && {
      shiftNo: filters.shift,
    }),
  };

  return {
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
            laborCode: {
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
}

export async function listDailyWorkerIncome(
  filters: DailyWorkerIncomeFilters,
  connection?: DbConnection,
): Promise<{
  data: DailyWorkerIncomeRecord[];
  available_worker_codes: string[];
  available_shifts: number[];
}> {
  const db = client(connection);
  const where = buildDailyWorkerIncomeWhere(filters, {
    includeWorkerCode: true,
    includeShift: true,
  });
  // ไม่ paginate ที่ชั้น DB เพราะ payment_status (Success/Partially Paid/Cancel/Admin Reject/
  // Worker Reject) เป็นค่า derive จากหลายตาราง ไม่ใช่ column ตรงๆ ให้ WHERE ได้ — ต้อง fetch ทุกแถวที่
  // เข้าเงื่อนไข filter อื่นก่อน แล้วค่อย derive/กรอง/แบ่งหน้าใน service layer (รูปแบบเดียวกับที่
  // listVehicleJobOperations ใช้กับ operation_status)
  const [data, workerCodeRows, shiftRows] = await Promise.all([
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
                // Fallback source เมื่อ ticket_no นี้ถูกยกเลิกทางอ้อมจากการยกเลิกทั้ง TicketNumber
                // (marketJob.adminActionLogs ด้านล่างจะว่างเปล่า เพราะ cancelVehicleJob ไม่เขียน
                // Log แยกต่อ MarketJob) — เอาแค่ log ล่าสุดของรถคันนี้
                adminActionLogs: {
                  where: {
                    actionType: ADMIN_ACTION_TYPE.VEHICLE_JOB_CANCELLED,
                  },
                  include: {
                    actor: true,
                  },
                  orderBy: {
                    createdAt: "desc",
                  },
                  take: 1,
                },
              },
            },
            tickets: {
              include: {
                completionSubmissions: true,
                adminActionLogs: {
                  where: {
                    actionType: ADMIN_ACTION_TYPE.OVERRIDE_COUNT,
                  },
                  include: {
                    actor: true,
                  },
                  orderBy: {
                    createdAt: "desc",
                  },
                },
              },
            },
            // ใช้เป็น source ของ Cancellation.CancelledByType/CancelledByName และ riskText
            // เมื่อ payment_status = cancel — เอาแค่ log ล่าสุดของการยกเลิก TicketNo นี้ ไม่ว่าจะยกเลิก
            // ทั้งใบตรงๆ (MARKET_JOB_CANCELLED) หรือ cascade มาจาก Booth สุดท้ายที่ถูกยกเลิกจนตลาดว่าง
            // (STALL_JOB_CANCELLED มี market_job_id ผูกไว้ด้วยเหมือนกัน)
            adminActionLogs: {
              where: {
                actionType: {
                  in: [
                    ADMIN_ACTION_TYPE.MARKET_JOB_CANCELLED,
                    ADMIN_ACTION_TYPE.STALL_JOB_CANCELLED,
                    ADMIN_ACTION_TYPE.OVERRIDE_COUNT,
                  ],
                },
              },
              include: {
                actor: true,
              },
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        },
      },
    }),
    db.ticketWorker.findMany({
      // ไม่รวมทั้ง workerCode และ shift — สอง dropdown นี้เป็นอิสระต่อกัน คำนวณจาก date/search/status
      // เท่านั้น ไม่ narrow ตามกันเอง (ต่างจาก dropoff_point ที่มี dropdown เดียว) เพื่อให้เห็นตัวเลือก
      // ครบทุกตัวเสมอ ไม่ต้องกังวลว่าเลือกสอง filter พร้อมกันแล้วจะไม่มีข้อมูลตรงกัน
      where: buildDailyWorkerIncomeWhere(filters, {
        includeWorkerCode: false,
        includeShift: false,
      }),
      distinct: ["workerId"],
      select: {
        worker: {
          select: {
            laborCode: true,
          },
        },
      },
    }),
    db.ticketWorker.findMany({
      where: buildDailyWorkerIncomeWhere(filters, {
        includeWorkerCode: false,
        includeShift: false,
      }),
      distinct: ["workerId"],
      select: {
        worker: {
          select: {
            shiftNo: true,
          },
        },
      },
    }),
  ]);
  const availableWorkerCodes = Array.from(
    new Set(workerCodeRows.map((row) => row.worker.laborCode)),
  ).sort();
  const availableShifts = Array.from(
    new Set(
      shiftRows
        .map((row) => row.worker.shiftNo)
        .filter((shiftNo): shiftNo is number => shiftNo !== null),
    ),
  ).sort((a, b) => a - b);

  return {
    data,
    available_worker_codes: availableWorkerCodes,
    available_shifts: availableShifts,
  };
}

/* -------------------------------------- Daily Stall Fee -------------------------------------- */

// Function แยก search เป็น token ด้วยช่องว่างหรือ comma ตาม docs/backend-missing-apis-spec V8.md ข้อ
// 28.4.5 — ทุก token ต้อง match อย่างน้อยหนึ่ง field (AND ระหว่าง token, OR ระหว่าง field)
function splitDailyStallFeeSearchTokens(search: string): string[] {
  return search
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

// Function สร้าง OR filter ของหนึ่ง search token ครอบคลุมเลขแผง/ทะเบียนรถ/เลขตั๋ว/รหัส-ชื่อสินค้า/
// รหัส-ชื่อบรรจุภัณฑ์ — anchor ที่ TicketProductFinancial (ใช้กับ query หลัก)
function buildDailyStallFeeTokenFilter(token: string): Prisma.TicketProductFinancialWhereInput {
  const contains = { contains: token, mode: "insensitive" as const };

  return {
    OR: [
      { product: { ticket: { boothCode: contains } } },
      { product: { ticket: { marketJob: { vehicleJob: { licensePlate: contains } } } } },
      { product: { ticket: { marketJob: { ticketNo: contains } } } },
      { product: { productCode: contains } },
      { product: { productName: contains } },
      { product: { packageCode: contains } },
      { product: { packageName: contains } },
    ],
  };
}

// Function เดียวกับด้านบนแต่ anchor ที่ TicketProduct (ใช้กับ query available_products/available_packages
// ที่ query จาก TicketProduct ตรงๆ เพื่อใช้ distinct บน productCode/packageCode ได้)
function buildDailyStallFeeProductTokenFilter(token: string): Prisma.TicketProductWhereInput {
  const contains = { contains: token, mode: "insensitive" as const };

  return {
    OR: [
      { ticket: { boothCode: contains } },
      { ticket: { marketJob: { vehicleJob: { licensePlate: contains } } } },
      { ticket: { marketJob: { ticketNo: contains } } },
      { productCode: contains },
      { productName: contains },
      { packageCode: contains },
      { packageName: contains },
    ],
  };
}

// Function สร้าง where ของ query หลัก (data/summary/stall_count) — includeProductCode/includePackageCode
// แยกได้อิสระเผื่ออนาคตต้องคำนวณ available_products/available_packages จาก where ที่ไม่รวม filter ของ
// ตัวเอง (ตอนนี้ available_* คำนวณจาก buildDailyStallFeeProductWhere แยกต่างหากซึ่งไม่รับ product_code/
// package_code อยู่แล้วตามข้อ 28.6.2 แต่คง flag นี้ไว้ให้ตรง pattern เดียวกับ listDailyWorkerIncome)
function buildDailyStallFeeWhere(
  filters: DailyStallFeeFilters,
  options: { includeProductCode: boolean; includePackageCode: boolean },
): Prisma.TicketProductFinancialWhereInput {
  const searchTokens = filters.search ? splitDailyStallFeeSearchTokens(filters.search) : [];
  const productWhere: Prisma.TicketProductWhereInput = {
    ...(options.includeProductCode && filters.productCode && { productCode: filters.productCode }),
    ...(options.includePackageCode && filters.packageCode && { packageCode: filters.packageCode }),
  };

  return {
    finalizedAt: {
      gte: filters.startAt,
      lt: filters.endAt,
    },
    ...(Object.keys(productWhere).length > 0 && { product: productWhere }),
    ...(searchTokens.length > 0 && { AND: searchTokens.map(buildDailyStallFeeTokenFilter) }),
  };
}

// Function สร้าง where ของ available_products/available_packages — date range + search เท่านั้น ไม่ใช้
// product_code/package_code จำกัด option ตามข้อ 28.6.2 (dropdown ต้องไม่หายหลังผู้ใช้เลือก filter)
function buildDailyStallFeeProductWhere(
  filters: Pick<DailyStallFeeFilters, "startAt" | "endAt" | "search">,
): Prisma.TicketProductWhereInput {
  const searchTokens = filters.search ? splitDailyStallFeeSearchTokens(filters.search) : [];

  return {
    financial: {
      finalizedAt: {
        gte: filters.startAt,
        lt: filters.endAt,
      },
    },
    ...(searchTokens.length > 0 && { AND: searchTokens.map(buildDailyStallFeeProductTokenFilter) }),
  };
}

// Function ดึงรายงานค่าลงสินค้าแผงค้ารายวันสำหรับ Admin ใน repository — หนึ่งแถว = หนึ่ง
// TicketProductFinancial ที่ finalize แล้ว ใช้ join เดียว + filter ที่ฐานข้อมูลทั้งหมด ตาม
// docs/backend-missing-apis-spec V8.md ข้อ 28.7.2 (ห้าม N+1, ห้าม load worker payments เพราะรายงานนี้
// ไม่ใช้รายได้แรงงาน)
export async function listDailyStallFees(
  filters: DailyStallFeeFilters,
  connection?: DbConnection,
): Promise<DailyStallFeeQueryResult> {
  const db = client(connection);
  const where = buildDailyStallFeeWhere(filters, {
    includeProductCode: true,
    includePackageCode: true,
  });
  const optionsWhere = buildDailyStallFeeProductWhere(filters);

  const [data, aggregate, stallIdRows, productRows, packageRows] = await Promise.all([
    db.ticketProductFinancial.findMany({
      where,
      orderBy: [{ finalizedAt: "desc" }, { id: "desc" }],
      include: {
        product: {
          include: {
            ticket: {
              include: {
                marketJob: {
                  include: {
                    vehicleJob: true,
                  },
                },
              },
            },
          },
        },
      },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    db.ticketProductFinancial.aggregate({
      where,
      _count: {
        _all: true,
      },
      _sum: {
        confirmedQuantity: true,
        stallFeeRounded: true,
      },
    }),
    // stall_count = COUNT(DISTINCT GateTicket.id) — Prisma ไม่รองรับ distinct บน field ของ relation
    // ที่ไม่ใช่ query root โดยตรง เลยดึงเฉพาะ id มา dedupe เองแทนที่จะโหลดทั้งแถว
    db.ticketProductFinancial.findMany({
      where,
      select: {
        product: {
          select: {
            ticket: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
    db.ticketProduct.findMany({
      where: optionsWhere,
      distinct: ["productCode"],
      select: {
        productCode: true,
        productName: true,
      },
    }),
    db.ticketProduct.findMany({
      where: optionsWhere,
      distinct: ["packageCode"],
      select: {
        packageCode: true,
        packageName: true,
      },
    }),
  ]);

  const stallCount = new Set(stallIdRows.map((row) => row.product.ticket.id)).size;
  // เรียงด้วยชื่อภาษาไทยแล้วตามด้วย code ในโค้ด (ไม่พึ่ง DB collation ที่อาจไม่รองรับ Thai locale sort)
  const availableProducts = productRows
    .map((row) => ({ product_code: row.productCode, product_name: row.productName }))
    .sort(
      (a, b) =>
        a.product_name.localeCompare(b.product_name, "th") ||
        a.product_code.localeCompare(b.product_code, "th"),
    );
  const availablePackages = packageRows
    .map((row) => ({ package_code: row.packageCode, package_name: row.packageName }))
    .sort(
      (a, b) =>
        a.package_name.localeCompare(b.package_name, "th") ||
        a.package_code.localeCompare(b.package_code, "th"),
    );

  return {
    data,
    total: aggregate._count._all,
    summary: {
      row_count: aggregate._count._all,
      stall_count: stallCount,
      confirmed_quantity_total: aggregate._sum.confirmedQuantity ?? new Prisma.Decimal(0),
      stall_fee_total: aggregate._sum.stallFeeRounded ?? new Prisma.Decimal(0),
    },
    available_products: availableProducts,
    available_packages: availablePackages,
  };
}
