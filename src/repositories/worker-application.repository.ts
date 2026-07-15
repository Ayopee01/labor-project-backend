// import
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { ACTIVE_ASSIGNMENT_STATUSES, FINISHED_ASSIGNMENT_STATUSES, SCANNED_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_STATUS, VEHICLE_JOB_STATUS, WORKING_ASSIGNMENT_STATUSES } from "../constants/job-status";
import { mapGateTicket, mapTicketCompletionSubmission, mapTicketProduct, mapTicketWorker, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";
export { findVehicleJobById, findVehicleJobByRef, getVehicleJobDetail } from "./shared/vehicle-job.repository";
export { countActiveAssignments, createAssignment, findAssignmentById, findCurrentAssignmentByWorker } from "./shared/vehicle-job-assignment.repository";
export { listTicketWorkers } from "./shared/ticket-worker.repository";

// import Types
import type { DbConnection } from "../types/common.type";
import type { CurrentTicketProgressDto, GateTicketDto, TicketCompletionSubmissionDto, TicketProductConfirmationInput, TicketProductDto, TicketWorkerDto, VehicleJobAssignmentDto, VehicleJobDto, VehicleWorkReadinessDto, WorkerAssignmentHistoryItemDto, WorkerAssignmentTeamMemberDto } from "../types/worker.type";

export { accountRepository, profileRepository, workScheduleRepository };

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
      status: VEHICLE_JOB_STATUS.IN_PROGRESS,
    },
  });

  await activateNextTicketIfReady(vehicleJobId, connection);

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job progress");
}

// Find the first non-terminal ticket by gate creation order.
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
      market_job_ref: market.marketJobRef,
      market_name: market.marketName,
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
      status: VEHICLE_JOB_STATUS.IN_PROGRESS,
    },
  });

  const activatableTicketStatuses: string[] = [TICKET_STATUS.WAIT, TICKET_STATUS.READY];

  if (!activatableTicketStatuses.includes(current.ticket.status)) {
    return current;
  }

  const ticket = await db.gateTicket.update({
    where: {
      id: current.ticket.id,
    },
    data: {
      status: TICKET_STATUS.IN_PROGRESS,
    },
  });

  return {
    ...current,
    ticket: requireDto(mapGateTicket(ticket), "activated gate ticket"),
  };
}

// Function ดึง assignment ที่หมดเวลารับงานแล้ว
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
        in: SCANNED_ASSIGNMENT_STATUSES,
      },
    },
  });
}

// Function แปลงสถานะ scan ของ assignment เป็นค่าที่ UI ใช้แสดงทีมในงานรถ
function buildAssignmentScanStatus(assignment: VehicleJobAssignmentDto): string {
  if (assignment.status === "COMPLETED" || assignment.completed_at) {
    return "completed";
  }

  if (WORKING_ASSIGNMENT_STATUSES.includes(assignment.status) || assignment.scanned_at) {
    return "scanned";
  }

  if (assignment.status === "ACCEPTED" || assignment.accepted_at) {
    return "accepted";
  }

  return "pending";
}

// Function ดึงรายชื่อทีม worker ในงานรถพร้อมสถานะ scan
export async function listVehicleJobAssignmentTeam(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<WorkerAssignmentTeamMemberDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: FINISHED_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "asc",
    },
    include: {
      worker: {
        include: {
          profile: true,
        },
      },
    },
  });

  return assignments.map((assignment) => {
    const assignmentDto = requireDto(
      mapVehicleJobAssignment(assignment),
      "vehicle job assignment"
    );

    return {
      full_name: assignment.worker.fullName,
      worker_code: assignment.worker.profile?.workerCode ?? null,
      image_url: assignment.worker.profile?.imageUrl ?? null,
      scan_status: buildAssignmentScanStatus(assignmentDto),
    };
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

// Function หา assignment ปัจจุบันของ worker ด้วย vehicle_job_ref
export async function findCurrentAssignmentByVehicleJobRefAndWorker(
  vehicleJobRef: string,
  workerAccountId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      workerAccountId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
      vehicleJob: {
        vehicleJobRef,
      },
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapVehicleJobAssignment(assignment);
}

// Function เปลี่ยน assignment เป็นรับงานแล้วและกำหนดเวลา scan QR
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

// Function เปลี่ยน assignment เป็นหมดเวลารับงาน
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

// Function หา gate ticket ด้วย stall_job_ref หรือ ticket_no สำหรับ worker ปิดงาน
export async function findGateTicketForCompletionByReference(
  reference: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      OR: [
        {
          stallJobRef: reference,
        },
        {
          ticketNo: reference,
        },
      ],
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapGateTicket(ticket);
}

// Function ดึงรายการสินค้าใน ticket ตามลำดับที่สร้าง
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
        ticketId,
        productRef: item.product_ref,
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

// Function สร้าง ticket worker จาก assignment ของงานรถเมื่อยังไม่มี mapping ระดับ ticket
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
        in: SCANNED_ASSIGNMENT_STATUSES,
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
export async function closeCompletedVehicleJobIfReady(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<{
  vehicle_job: VehicleJobDto;
  completed_assignment_ids: number[];
  completed_worker_account_ids: number[];
} | null> {
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
        (ticket) => ticket.status === "CANCELLED"
      )
        ? "CANCELLED"
        : "COMPLETED";

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
    (market) => market.status === "CANCELLED"
  )
    ? "CANCELLED"
    : "COMPLETED";

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
    await db.vehicleJobAssignment.updateMany({
      where: {
        id: {
          in: completedAssignmentIds,
        },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  return {
    vehicle_job: requireDto(mapVehicleJob(updatedVehicleJob), "vehicle job close"),
    completed_assignment_ids: completedAssignmentIds,
    completed_worker_account_ids: completedWorkerAccountIds,
  };
}

// Function reject ยอดปิดงานจาก vendor และเปิด ticket ให้ worker ส่งยอดใหม่
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
