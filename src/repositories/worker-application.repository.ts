// import Library
import { Prisma } from "@prisma/client";

// import
import * as accountRepository from "./shared/account.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { mapGateTicket, mapTicketCompletionSubmission, mapTicketProduct, mapTicketWorker, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";
export { findVehicleJobById, getVehicleJobDetail } from "./shared/vehicle-job.repository";
export { countActiveAssignments, createAssignment, findAssignmentById, findCurrentAssignmentByWorker } from "./shared/vehicle-job-assignment.repository";
export { listTicketWorkers } from "./shared/ticket-worker.repository";

// import Types
import type { DbConnection } from "../types/common.type";
import type { GateTicketDto, TicketCompletionSubmissionDto, TicketProductConfirmationInput, TicketProductDto, TicketWorkerDto, VehicleJobAssignmentDto, VehicleJobDto, WorkerAssignmentHistoryItemDto } from "../types/worker.type";

export { accountRepository, workScheduleRepository };

/* -------------------------------------- Functions -------------------------------------- */

// Function เปลี่ยนงานรถเป็นเริ่มทำงานหลังคนงาน scan ครบ
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
      status: "IN_PROGRESS",
      marketJobs: {
        updateMany: {
          where: {
            status: {
              in: ["WAIT", "DISPATCH_NOW"],
            },
          },
          data: {
            status: "IN_PROGRESS",
          },
        },
      },
      tickets: {
        updateMany: {
          where: {
            status: {
              in: ["WAIT", "READY"],
            },
          },
          data: {
            status: "IN_PROGRESS",
          },
        },
      },
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job progress");
}

// Function ดึง assignment ที่หมดเวลารับงานแล้ว
export async function listExpiredPendingAssignments(
  now = new Date(),
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      status: "PENDING",
      acceptDeadlineAt: {
        lte: now,
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

// Function ดึงงานรถที่พร้อม dispatch ตามลำดับการสร้าง
export async function listDispatchableVehicleJobs(
  connection?: DbConnection
): Promise<VehicleJobDto[]> {
  const db = client(connection);
  const vehicleJobs = await db.vehicleJob.findMany({
    where: {
      status: "DISPATCH_NOW",
    },
    orderBy: {
      id: "asc",
    },
  });

  return vehicleJobs
    .map((vehicleJob) => mapVehicleJob(vehicleJob))
    .filter((vehicleJob): vehicleJob is VehicleJobDto => vehicleJob !== null);
}

// Function นับ assignment ที่ scan แล้วของงานรถ
export async function countScannedAssignments(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  return db.vehicleJobAssignment.count({
    where: {
      vehicleJobId,
      status: {
        in: ["SCANNED", "COUNTING", "COMPLETED"],
      },
    },
  });
}

// Function ดึงประวัติงานของ worker ตามช่วงวันที่ที่ระบุ
export async function listWorkerAssignmentHistoryByDate(
  workerAccountId: number,
  startAt: Date,
  endAt: Date,
  connection?: DbConnection
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
      vehicleJob: true,
    },
  });

  return assignments.map((assignment) => ({
    assignment: requireDto(mapVehicleJobAssignment(assignment), "assignment"),
    vehicle_job: requireDto(mapVehicleJob(assignment.vehicleJob), "vehicle job"),
  }));
}

// Function หา assignment จาก id และ worker
export async function findAssignmentByIdAndWorker(
  assignmentId: number,
  workerAccountId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      id: assignmentId,
      workerAccountId,
    },
  });

  return mapVehicleJobAssignment(assignment);
}

export async function acceptAssignment(
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
      status: "ACCEPTED",
      acceptedAt: new Date(),
      scanDeadlineAt,
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment accept");
}

export async function timeoutAssignment(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: "TIMEOUT",
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment timeout");
}

// Function เปลี่ยน assignment เป็น scan สำเร็จ
export async function scanAssignment(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: "SCANNED",
      scannedAt: new Date(),
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment scan");
}

// Function ดึง gate ticket พร้อมข้อมูล vendor สำหรับ flow ปิดงาน
export async function findGateTicketForCompletion(
  ticketId: number,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findUnique({
    where: {
      id: ticketId,
    },
  });

  return mapGateTicket(ticket);
}

export async function listTicketProducts(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketProductDto[]> {
  const db = client(connection);
  const products = await db.ticketProduct.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return products
    .map((product) => mapTicketProduct(product))
    .filter((product): product is TicketProductDto => product !== null);
}

// Function สร้าง ticket workers จาก assignment ของรถ ถ้ายังไม่มี mapping ระดับ ticket
export async function updateTicketProductConfirmations(
  ticketId: number,
  items: TicketProductConfirmationInput[],
  connection?: DbConnection
): Promise<TicketProductDto[]> {
  const db = client(connection);

  for (const item of items) {
    const result = await db.ticketProduct.updateMany({
      where: {
        id: item.ticket_product_id,
        ticketId,
      },
      data: {
        confirmedQuantity: item.confirmed_quantity,
      },
    });

    if (result.count !== 1) {
      throw new Error("Ticket product confirmation did not update a product.");
    }
  }

  return listTicketProducts(ticketId, connection);
}

export async function ensureTicketWorkersFromVehicleAssignments(
  ticketId: number,
  vehicleJobId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const existingWorkers = await db.ticketWorker.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  if (existingWorkers.length > 0) {
    return existingWorkers
      .map((worker) => mapTicketWorker(worker))
      .filter((worker): worker is TicketWorkerDto => worker !== null);
  }

  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: ["SCANNED", "COUNTING", "COMPLETED"],
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  if (assignments.length === 0) {
    return [];
  }

  await db.ticketWorker.createMany({
    data: assignments.map((assignment) => ({
      ticketId,
      workerAccountId: assignment.workerAccountId,
      status: "IN_PROGRESS",
    })),
    skipDuplicates: true,
  });

  const workers = await db.ticketWorker.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return workers
    .map((worker) => mapTicketWorker(worker))
    .filter((worker): worker is TicketWorkerDto => worker !== null);
}

// Function เปลี่ยน ticket เป็นรอ vendor ตรวจ โดยกันการส่งยอดซ้ำจากหลาย worker
export async function markTicketWaitingVendorConfirm(
  ticketId: number,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const result = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: {
        in: ["IN_PROGRESS", "COMPLETION_REJECTED", "REOPEN"],
      },
    },
    data: {
      status: "WAITING_VENDOR_CONFIRM",
      confirmationStatus: "WAITING_VENDOR_CONFIRM",
    },
  });

  return result.count === 1;
}

// Function สร้าง submission การส่งยอดปิดงานของ ticket
export async function createTicketCompletionSubmission(
  ticketId: number,
  workerAccountId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.create({
    data: {
      ticketId,
      submittedByWorkerAccountId: workerAccountId,
      status: "WAITING_VENDOR_CONFIRM",
    },
  });

  return requireDto(
    mapTicketCompletionSubmission(submission),
    "ticket completion submission create"
  );
}

// Function ดึง submission ล่าสุดที่รอ vendor confirm/reject
export async function findWaitingTicketCompletionSubmission(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto | null> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.findFirst({
    where: {
      ticketId,
      status: "WAITING_VENDOR_CONFIRM",
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapTicketCompletionSubmission(submission);
}

// Function ยืนยันการปิด ticket จาก vendor
export async function confirmTicketCompletion(
  ticketId: number,
  submissionId: number,
  connection?: DbConnection
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: "WAITING_VENDOR_CONFIRM",
    },
    data: {
      status: "CLOSED",
      confirmationStatus: "CONFIRMED",
    },
  });

  if (updateResult.count !== 1) {
    throw new Error("Ticket confirm did not update a waiting ticket.");
  }

  await db.ticketWorker.updateMany({
    where: {
      ticketId,
    },
    data: {
      status: "COMPLETED",
    },
  });

  const [ticket, submission] = await Promise.all([
    db.gateTicket.findUnique({
      where: {
        id: ticketId,
      },
    }),
    db.ticketCompletionSubmission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    }),
  ]);

  return {
    ticket: requireDto(mapGateTicket(ticket), "ticket confirm"),
    submission: requireDto(
      mapTicketCompletionSubmission(submission),
      "ticket submission confirm"
    ),
  };
}

// Function reject การปิด ticket จาก vendor เพื่อให้ worker ส่งยอดใหม่ได้
export async function rejectTicketCompletion(
  ticketId: number,
  submissionId: number,
  connection?: DbConnection
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: "WAITING_VENDOR_CONFIRM",
    },
    data: {
      status: "COMPLETION_REJECTED",
      confirmationStatus: "REJECTED",
    },
  });

  if (updateResult.count !== 1) {
    throw new Error("Ticket reject did not update a waiting ticket.");
  }

  await db.ticketWorker.updateMany({
    where: {
      ticketId,
    },
    data: {
      status: "COMPLETION_REJECTED",
    },
  });

  const [ticket, submission] = await Promise.all([
    db.gateTicket.findUnique({
      where: {
        id: ticketId,
      },
    }),
    db.ticketCompletionSubmission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
      },
    }),
  ]);

  return {
    ticket: requireDto(mapGateTicket(ticket), "ticket reject"),
    submission: requireDto(
      mapTicketCompletionSubmission(submission),
      "ticket submission reject"
    ),
  };
}
