// import Library
import { Prisma } from "@prisma/client";

// import
import { ACTIVE_ASSIGNMENT_STATUSES } from "../constants/job-status";
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import { mapAccount, mapGateTicket, mapMarketJob, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";
export { findVehicleJobById, findVehicleJobByRef, getVehicleJobDetail, getVehicleJobDetailByRef } from "./shared/vehicle-job.repository";
export { countActiveAssignments, createAssignment, findAssignmentById, findCurrentAssignmentByWorker } from "./shared/vehicle-job-assignment.repository";
export { listTicketWorkers } from "./shared/ticket-worker.repository";
export { createMessageDeliveryLog } from "./line.repository";

// import Types
import type { DbConnection } from "../types/common.type";
import type { AccountDto } from "../types/admin-workers.type";
import type { GateTicketDto, MarketJobDto, VehicleJobAssignmentDto, VehicleJobDto } from "../types/worker.type";
import type { VehicleJobListFilters, VehicleJobListResult } from "../types/admin-jobs.type";

export { accountRepository, profileRepository };

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึงรายการงานรถสำหรับ Admin พร้อม filter เบื้องต้น
export async function listVehicleJobs(
  filters: VehicleJobListFilters = {},
  connection?: DbConnection
): Promise<VehicleJobListResult> {
  const db = client(connection);
  const where: Prisma.VehicleJobWhereInput = {
    ...(filters.status && {
      status: filters.status,
    }),
    ...(filters.startAt &&
      filters.endAt && {
        createdAt: {
          gte: filters.startAt,
          lt: filters.endAt,
        },
      }),
    ...(filters.search && {
      OR: [
        {
          vehicleJobRef: {
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
                  marketJobRef: {
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
                  stallJobRef: {
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
                {
                  stallNo: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
        },
      ],
    }),
  };
  const shouldPaginate = filters.page !== undefined;
  const limit = filters.limit ?? 20;
  const vehicleJobs = await db.vehicleJob.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    ...(shouldPaginate && {
      skip: ((filters.page as number) - 1) * limit,
      take: limit,
    }),
  });
  const data = vehicleJobs
    .map((vehicleJob) => mapVehicleJob(vehicleJob))
    .filter((vehicleJob): vehicleJob is VehicleJobDto => vehicleJob !== null);

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

// Function หา market job จาก id
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

// Function หา market job จากเลขอ้างอิงตลาด
export async function findMarketJobByRef(
  marketJobRef: string,
  connection?: DbConnection
): Promise<MarketJobDto | null> {
  const db = client(connection);
  const marketJob = await db.marketJob.findFirst({
    where: {
      marketJobRef,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapMarketJob(marketJob);
}

// Function หา gate ticket หรือ stall job จาก id
// Function หา gate ticket/stall job จากเลขอ้างอิงแผง
export async function findGateTicketByRef(
  stallJobRef: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      stallJobRef,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapGateTicket(ticket);
}

// Function หา worker จากรหัสพนักงานสำหรับ Admin Jobs flow
export async function findWorkerByCode(
  workerCode: string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      role: "worker",
      profile: {
        workerCode,
      },
    },
  });

  return mapAccount(account);
}

// Function หา assignment ปัจจุบันของ worker ในงานรถจาก vehicle_job_ref + worker_code
export async function findActiveAssignmentByVehicleJobRefAndWorkerCode(
  vehicleJobRef: string,
  workerCode: string,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      vehicleJob: {
        vehicleJobRef,
      },
      worker: {
        profile: {
          workerCode,
        },
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

// Function ยกเลิกงานรถ พร้อมงานตลาด แผง และ active assignment ใต้รถ
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

// Function ยกเลิกงานตลาด พร้อมแผงใต้ตลาด
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

// Function ยกเลิกงานแผงเดียว
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

// Function สร้างงานรถพร้อมตลาด ตั๋ว สินค้า และบันทึก Gate request log

// Function เปิดงานแผงกลับมาให้ worker ส่งยอดใหม่ หลัง vendor confirm ผิด
export async function reopenGateTicket(
  ticketId: number,
  connection?: DbConnection
): Promise<GateTicketDto> {
  const db = client(connection);
  const ticket = await db.gateTicket.update({
    where: {
      id: ticketId,
    },
    data: {
      status: "REOPEN",
      confirmationStatus: "REOPEN",
    },
  });

  return requireDto(mapGateTicket(ticket), "gate ticket reopen");
}

// Function บันทึกประวัติการเปลี่ยนสถานะของงานแผง
export async function createGateTicketStatusHistory(
  input: {
    ticket_id: number;
    from_status: string;
    to_status: string;
    action: string;
    changed_by_account_id?: number | null;
  },
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.gateTicketStatusHistory.create({
    data: {
      ticketId: input.ticket_id,
      fromStatus: input.from_status,
      toStatus: input.to_status,
      action: input.action,
      changedByAccountId: input.changed_by_account_id ?? null,
    },
  });
}

// Function ดึง active assignment ของงานรถ
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

// Function เปลี่ยน assignment เป็นรับงานแล้ว
export async function listAcceptedAssignmentsByVehicleJob(
  vehicleJobId: number,
  workerCodes?: string[],
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const workerAccountIds = workerCodes && workerCodes.length > 0
    ? (
        await db.userProfile.findMany({
          where: {
            workerCode: {
              in: workerCodes,
            },
          },
          select: {
            accountId: true,
          },
        })
      ).map((profile) => profile.accountId)
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

// Function เปลี่ยน assignment เป็นหมดเวลารับงาน
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

// Function ต่อเวลา scan deadline ของ assignment
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
