// Import Dependencies
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { Prisma } from "@prisma/client";
import { ACTIVE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS, FINISHED_ASSIGNMENT_STATUSES, SCANNED_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_STATUS, VEHICLE_JOB_STATUS, WORKING_ASSIGNMENT_STATUSES, TICKET_WORKER_STATUS } from "../constants/job-status";
import { mapGateTicket, mapTicketCompletionSubmission, mapTicketProduct, mapTicketWorker, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";
export { findVehicleJobById, findVehicleJobByRef, getVehicleJobDetail } from "./shared/vehicle-job.repository";
export { countActiveAssignments, createAssignment, findAssignmentById, findCurrentAssignmentByWorker } from "./shared/vehicle-job-assignment.repository";
export { listTicketWorkers } from "./shared/ticket-worker.repository";

// Import Types
import type { WorkerShiftAttendance } from "@prisma/client";
import type { DbConnection } from "../types/shared/common.type";
import type { CompletedVehicleJobResult, CurrentTicketProgressDto, GateTicketDto, TicketCompletionSubmissionDto, TicketProductConfirmationInput, TicketProductDto, TicketWorkerDto, VendorLineTargetDto, VehicleJobAssignmentDto, VehicleJobDto, VehicleWorkReadinessDto, WorkerAssignmentHistoryItemDto, WorkerAssignmentEarningsDto, WorkerAssignmentTeamMemberDto, WorkerShiftAttendanceKeyInput, WorkerShiftAttendanceWriteInput, WorkerShiftCloseReason } from "../types/worker.type";

// Function สร้าง shift snapshot จาก DB
function buildShiftSnapshot(input: WorkerShiftAttendanceWriteInput) {
  return {
    workerCode: input.worker_code,
    shiftNo: input.schedule.shift_no,
    shiftStartTime: input.schedule.shift_start_time,
    shiftEndTime: input.schedule.shift_end_time,
  };
}

// Function ค้นหา worker shift attendance ตาม worker และ shift จาก DB
async function findWorkerShiftAttendanceByWorkerAndShift(
  input: WorkerShiftAttendanceKeyInput,
  connection?: DbConnection
): Promise<WorkerShiftAttendance | null> {
  const db = client(connection);

  return db.workerShiftAttendance.findUnique({
    where: {
      accountId_shiftInstanceKey: {
        accountId: input.account_id,
        shiftInstanceKey: input.shift_instance_key,
      },
    },
  });
}

// Function อัปเดตสถานะ worker shift online จาก DB
async function markWorkerShiftOnline(
  input: WorkerShiftAttendanceWriteInput,
  connection?: DbConnection
): Promise<WorkerShiftAttendance> {
  const db = client(connection);
  const now = new Date();
  const shiftSnapshot = buildShiftSnapshot(input);

  return db.workerShiftAttendance.upsert({
    where: {
      accountId_shiftInstanceKey: {
        accountId: input.account_id,
        shiftInstanceKey: input.shift_instance_key,
      },
    },
    create: {
      accountId: input.account_id,
      shiftInstanceKey: input.shift_instance_key,
      ...shiftSnapshot,
      firstOnlineAt: now,
      lastOnlineAt: now,
    },
    update: {
      ...shiftSnapshot,
      lastOnlineAt: now,
    },
  });
}

// Function เพิ่มค่า accept timeout streak จาก DB
async function incrementAcceptTimeoutStreak(
  input: WorkerShiftAttendanceWriteInput,
  connection?: DbConnection
): Promise<WorkerShiftAttendance> {
  const db = client(connection);
  const now = new Date();
  const shiftSnapshot = buildShiftSnapshot(input);

  return db.workerShiftAttendance.upsert({
    where: {
      accountId_shiftInstanceKey: {
        accountId: input.account_id,
        shiftInstanceKey: input.shift_instance_key,
      },
    },
    create: {
      accountId: input.account_id,
      shiftInstanceKey: input.shift_instance_key,
      ...shiftSnapshot,
      firstOnlineAt: now,
      lastOnlineAt: now,
      acceptTimeoutStreak: 1,
      lastAcceptTimeoutAt: now,
    },
    update: {
      ...shiftSnapshot,
      acceptTimeoutStreak: {
        increment: 1,
      },
      lastAcceptTimeoutAt: now,
    },
  });
}

// Function รีเซ็ต accept timeout streak จาก DB
async function resetAcceptTimeoutStreak(
  input: WorkerShiftAttendanceWriteInput,
  connection?: DbConnection
): Promise<WorkerShiftAttendance> {
  const db = client(connection);
  const now = new Date();
  const shiftSnapshot = buildShiftSnapshot(input);

  return db.workerShiftAttendance.upsert({
    where: {
      accountId_shiftInstanceKey: {
        accountId: input.account_id,
        shiftInstanceKey: input.shift_instance_key,
      },
    },
    create: {
      accountId: input.account_id,
      shiftInstanceKey: input.shift_instance_key,
      ...shiftSnapshot,
      firstOnlineAt: now,
      lastOnlineAt: now,
      acceptTimeoutStreak: 0,
      lastAcceptTimeoutAt: null,
    },
    update: {
      ...shiftSnapshot,
      acceptTimeoutStreak: 0,
      lastAcceptTimeoutAt: null,
    },
  });
}

// Function ปิด worker shift จาก DB
async function closeWorkerShift(
  input: WorkerShiftAttendanceWriteInput & {
    reason: WorkerShiftCloseReason;
  },
  connection?: DbConnection
): Promise<WorkerShiftAttendance> {
  const db = client(connection);
  const existing = await findWorkerShiftAttendanceByWorkerAndShift(input, connection);
  const now = new Date();
  const shiftSnapshot = buildShiftSnapshot(input);
  const closeData: Prisma.WorkerShiftAttendanceUncheckedUpdateInput = {
    ...shiftSnapshot,
    closedAt: now,
    closeReason: input.reason,
    offlineAt: now,
  };

  if (existing?.closedAt) {
    return existing;
  }

  if (existing) {
    return db.workerShiftAttendance.update({
      where: {
        id: existing.id,
      },
      data: closeData,
    });
  }

  return db.workerShiftAttendance.create({
    data: {
      accountId: input.account_id,
      shiftInstanceKey: input.shift_instance_key,
      ...shiftSnapshot,
      closedAt: now,
      closeReason: input.reason,
      offlineAt: now,
    },
  });
}

const workerShiftAttendanceRepository = {
  findByWorkerAndShift: findWorkerShiftAttendanceByWorkerAndShift,
  markWorkerShiftOnline,
  incrementAcceptTimeoutStreak,
  resetAcceptTimeoutStreak,
  closeWorkerShift,
};

export { accountRepository, profileRepository, workScheduleRepository, workerShiftAttendanceRepository };

/* -------------------------------------- Functions -------------------------------------- */

// Function อัปเดตสถานะ vehicle job ใน progress จาก DB
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

// Function หา ticket แรกที่ยังไม่จบตามลำดับเวลาที่ Gate สร้าง
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

// Function คำนวณว่า worker ที่ต้องใช้กับงานรถ scan QR ครบแล้วหรือยัง
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

// Function ย้าย market/ticket ถัดไปที่ยังไม่จบเป็น WORKING เมื่อรถพร้อมทำงาน
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

  if (!activatableTicketStatuses.includes(current.ticket.status)
  ) {
    // Sync membership ให้ตรงกับ Assignment ปัจจุบัน
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

// Function ดึงงานรถ active ที่ยังรับ worker จากคิว ready ได้
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

// Function นับ scanned assignments จาก DB
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

// Function สร้าง assignment scan status จาก DB
function buildAssignmentScanStatus(assignment: VehicleJobAssignmentDto): string {
  if (assignment.status === ASSIGNMENT_STATUS.COMPLETED || assignment.completed_at) {
    return "completed";
  }

  if (WORKING_ASSIGNMENT_STATUSES.includes(assignment.status) || assignment.scanned_at) {
    return "scanned";
  }

  if (assignment.status === ASSIGNMENT_STATUS.ACCEPTED || assignment.accepted_at) {
    return "accepted";
  }

  return "pending";
}

// Function ดึงรายการ vehicle job assignment team จาก DB
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
      worker: true,
    },
  });

  return assignments.map((assignment) => {
    const assignmentDto = requireDto(
      mapVehicleJobAssignment(assignment),
      "vehicle job assignment"
    );

    return {
      full_name: assignment.worker.fullName,
      worker_code: assignment.worker.username,
      image_url: assignment.worker.imageUrl ?? null,
      scan_status: buildAssignmentScanStatus(assignmentDto),
    };
  });
}

// Function ดึงรายการ worker assignment history พร้อมรายได้จริงตาม date จาก DB
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

  if (assignments.length === 0) {
    return [];
  }

  const vehicleJobIds = [
    ...new Set(assignments.map((assignment) => assignment.vehicleJobId)),
  ];

  const ticketWorkers = await db.ticketWorker.findMany({
    where: {
      workerAccountId,
      ticket: {
        vehicleJobId: {
          in: vehicleJobIds,
        },
      },
    },
    orderBy: {
      id: "asc",
    },
    include: {
      ticket: true,
      payments: {
        orderBy: {
          id: "asc",
        },
        include: {
          productFinancial: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  const earningsByVehicleJobId = new Map<number, WorkerAssignmentEarningsDto>();

  for (const vehicleJobId of vehicleJobIds) {
    const vehicleTicketWorkers = ticketWorkers.filter(
      (ticketWorker) => ticketWorker.ticket.vehicleJobId === vehicleJobId
    );

    let totalAmount = new Prisma.Decimal(0);

    const booths = vehicleTicketWorkers.map((ticketWorker) => {
      let boothAmount = new Prisma.Decimal(0);

      const products = ticketWorker.payments.map((payment) => {
        boothAmount = boothAmount.plus(payment.finalAmount);

        const financial = payment.productFinancial;
        const product = financial.product;

        return {
          productCode: product.productCode,
          packageCode: product.packageCode,
          productName: product.productName,
          packageName: product.packageName,
          confirmed_quantity: financial.confirmedQuantity.toFixed(2),
          final_amount: payment.finalAmount.toFixed(2),
        };
      });

      totalAmount = totalAmount.plus(boothAmount);

      return {
        ticket_id: ticketWorker.ticket.id,
        boothCode: ticketWorker.ticket.boothCode,
        boothName: ticketWorker.ticket.boothName,
        membership_status: ticketWorker.status,
        amount: boothAmount.toFixed(2),
        products,
      };
    });

    earningsByVehicleJobId.set(vehicleJobId, {
      total_amount: totalAmount.toFixed(2),
      booths,
    });
  }

  return assignments.map((assignment) => ({
    assignment: requireDto(
      mapVehicleJobAssignment(assignment),
      "assignment"
    ),
    vehicle_job: requireDto(
      mapVehicleJob(assignment.vehicleJob),
      "vehicle job"
    ),
    earnings: earningsByVehicleJobId.get(assignment.vehicleJobId) ?? {
      total_amount: "0.00",
      booths: [],
    },
  }));
}

// Function ค้นหา assignment ตาม ID และ worker จาก DB
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

// Function ค้นหา current assignment ตาม vehicle job ref และ worker จาก DB
export async function findCurrentAssignmentByVehicleJobRefAndWorker(
  ticketNo: string,
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
        ticketNo,
      },
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapVehicleJobAssignment(assignment);
}

// Function รับ assignment จาก DB
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
      status: ASSIGNMENT_STATUS.ACCEPTED,
      acceptedAt: new Date(),
      scanDeadlineAt,
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment accept");
}

// Function ดึงรายการ accepted assignments ตาม vehicle job จาก DB
export async function listAcceptedAssignmentsByVehicleJob(
  vehicleJobId: number,
  excludedAssignmentId?: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: ASSIGNMENT_STATUS.ACCEPTED,
      ...(excludedAssignmentId
        ? {
          id: {
            not: excludedAssignmentId,
          },
        }
        : {}),
    },
    orderBy: {
      id: "asc",
    },
  });

  return assignments
    .map((assignment) => mapVehicleJobAssignment(assignment))
    .filter((assignment): assignment is VehicleJobAssignmentDto => assignment !== null);
}

// Function อัปเดต assignment scan deadline จาก DB
export async function updateAssignmentScanDeadline(
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

  return requireDto(mapVehicleJobAssignment(assignment), "assignment scan deadline");
}

// Function จัดการ timeout assignment จาก DB
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
      status: ASSIGNMENT_STATUS.TIMEOUT,
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment timeout");
}

// Function บันทึกการสแกน assignment จาก DB
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
      status: ASSIGNMENT_STATUS.SCANNED,
      scannedAt: new Date(),
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment scan");
}

// Function ค้นหา Gate ticket สำหรับ completion จาก DB
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

// Function ดึง LINE target ของเจ้าของแผงและสมาชิกแผงที่ยัง active สำหรับ ticket นี้
export async function listActiveVendorLineTargetsForTicket(
  ticketId: number,
  connection?: DbConnection
): Promise<VendorLineTargetDto[]> {
  const db = client(connection);
  const ticket = await db.gateTicket.findUnique({
    where: {
      id: ticketId,
    },
    include: {
      marketJob: true,
    },
  });

  if (!ticket) {
    return [];
  }

  const ownerStall = await db.masterOwnerStall.findUnique({
    where: {
      marketCode_boothCode: {
        marketCode: ticket.marketJob.marketCode,
        boothCode: ticket.boothCode,
      },
    },
  });

  if (
    !ownerStall ||
    ownerStall.status !== "active" ||
    ownerStall.ownerStatus !== "Normal" ||
    !ownerStall.lineUserId
  ) {
    return [];
  }

  const members = await db.masterMemberStall.findMany({
    where: {
      marketCode: ownerStall.marketCode,
      ownerIdCard: ownerStall.cardId,
      ownerLineUserId: ownerStall.lineUserId,
      status: "active",
      memberStallStatusOnStall: "1",
    },
    orderBy: {
      id: "asc",
    },
  });
  const seen = new Set<string>();
  const targets: VendorLineTargetDto[] = [];
  const addTarget = (lineUserId: string, targetType: VendorLineTargetDto["target_type"]) => {
    if (seen.has(lineUserId)) {
      return;
    }

    seen.add(lineUserId);
    targets.push({
      line_user_id: lineUserId,
      target_type: targetType,
    });
  };

  addTarget(ownerStall.lineUserId, "owner");

  for (const member of members) {
    addTarget(member.memberStallLineUserId, "member");
  }

  return targets;
}

// Function หา ticket ของ booth ภายใต้ TicketNo ที่ระบุ เพื่อไม่ให้เลือก booth จาก ticket อื่น

export async function findGateTicketForCompletionByTicketNoAndBoothCode(
  ticketNo: string,
  boothCode: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      boothCode,
      vehicleJob: {
        ticketNo,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return mapGateTicket(ticket);
}

// Function ดึงรายการ ticket products จาก DB
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

// Function อัปเดตจำนวนยืนยันของทุกสินค้าที่ worker ส่งยอดตอนจบ ticket
export async function updateTicketProductConfirmations(
  ticketId: number,
  items: TicketProductConfirmationInput[],
  connection?: DbConnection
): Promise<TicketProductDto[]> {
  const db = client(connection);

  for (const item of items) {
    const result =
      await db.ticketProduct.updateMany({
        where: {
          ticketId,
          productCode: item.productCode,
          packageCode: item.packageCode,
        },
        data: {
          confirmedQuantity: item.confirmed_quantity,
        },
      });

    if (result.count !== 1) {
      throw new Error(
        "Ticket product confirmation did not update exactly one product."
      );
    }
  }

  return listTicketProducts(
    ticketId,
    connection
  );
}

// Function sync Worker ที่ทำงานจริงของ VehicleJob เข้ากับ TicketWorker ของ Booth ปัจจุบัน
export async function syncTicketWorkersFromVehicleAssignments(
  ticketId: number,
  vehicleJobId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const now = new Date();

  // Worker ที่ยังทำงานจริงกับรถ ณ ตอนนี้
  const assignments =
    await db.vehicleJobAssignment.findMany({
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

  const activeWorkerAccountIds = [
    ...new Set(
      assignments.map(
        (assignment) =>
          assignment.workerAccountId
      )
    ),
  ];

  const existingWorkers =
    await db.ticketWorker.findMany({
      where: {
        ticketId,
      },
      orderBy: {
        id: "asc",
      },
    });

  const existingWorkerAccountIds =
    new Set(
      existingWorkers.map(
        (worker) =>
          worker.workerAccountId
      )
    );

  // Worker ใหม่ที่ยังไม่มี membership
  const missingWorkerAccountIds =
    activeWorkerAccountIds.filter(
      (workerAccountId) =>
        !existingWorkerAccountIds.has(
          workerAccountId
        )
    );

  if (
    missingWorkerAccountIds.length > 0
  ) {
    await db.ticketWorker.createMany({
      data:
        missingWorkerAccountIds.map(
          (workerAccountId) => ({
            ticketId,
            workerAccountId,

            status:
              TICKET_WORKER_STATUS.WORKING,

            joinedAt:
              now,
          })
        ),

      skipDuplicates: true,
    });
  }

  // Worker ที่ยัง active รวมถึงกรณีเคย CANCELLED แล้วถูกนำกลับมาอีกครั้ง
  if (
    activeWorkerAccountIds.length > 0
  ) {
    const completedAt =
      new Date();

    await db.ticketWorker.updateMany({
      where: {
        ticketId,

        status:
          TICKET_WORKER_STATUS.WORKING,
      },

      data: {
        status:
          TICKET_WORKER_STATUS.COMPLETED,

        completedAt,

        cancelledAt:
          null,
      },
    });
  }


  // Worker ที่ถูก Admin cancel Assignment ปัจจุบันไม่อยู่แล้ว
  await db.ticketWorker.updateMany({
    where: {
      ticketId,

      status: {
        notIn: [
          TICKET_WORKER_STATUS.COMPLETED,
          TICKET_WORKER_STATUS.CANCELLED,
        ],
      },

      ...(activeWorkerAccountIds.length > 0
        ? {
          workerAccountId: {
            notIn:
              activeWorkerAccountIds,
          },
        }
        : {}),
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

  const workers =
    await db.ticketWorker.findMany({
      where: {
        ticketId,
      },

      orderBy: {
        id: "asc",
      },
    });

  return workers
    .map(
      (worker) =>
        mapTicketWorker(worker)
    )
    .filter(
      (
        worker
      ): worker is TicketWorkerDto =>
        worker !== null
    );
}

// Function อัปเดตสถานะ ticket delivered จาก DB
export async function markTicketDelivered(
  ticketId: number,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const result = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: {
        in: [TICKET_STATUS.WAIT, TICKET_STATUS.WORKING, TICKET_STATUS.REJECT],
      },
    },
    data: {
      status: TICKET_STATUS.DELIVERED,
      rejectReason: null,
    },
  });

  return result.count === 1;
}

// Function สร้าง ticket completion submission จาก DB
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
      status: TICKET_STATUS.DELIVERED,
    },
  });

  return requireDto(
    mapTicketCompletionSubmission(submission),
    "ticket completion submission create"
  );
}

// Function อัปเดตสถานะ vehicle assignments delivered จาก DB
export async function markVehicleAssignmentsDelivered(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: WORKING_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: ASSIGNMENT_STATUS.DELIVERED,
    },
  });

  return result.count;
}

// Function อัปเดตสถานะ vehicle assignments rejected จาก DB
export async function markVehicleAssignmentsRejected(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: WORKING_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: ASSIGNMENT_STATUS.REJECT,
    },
  });

  return result.count;
}

// Function อัปเดตสถานะ vehicle assignments working จาก DB
export async function markVehicleAssignmentsWorking(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: WORKING_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: ASSIGNMENT_STATUS.WORKING,
    },
  });

  return result.count;
}

// Function ค้นหา waiting ticket completion submission จาก DB
export async function findWaitingTicketCompletionSubmission(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto | null> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.findFirst({
    where: {
      ticketId,
      status: TICKET_STATUS.DELIVERED,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapTicketCompletionSubmission(submission);
}

// Function ค้นหา ticket completion submission ตาม ID จาก DB
export async function findTicketCompletionSubmissionById(
  submissionId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto | null> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.findUnique({
    where: {
      id: submissionId,
    },
  });

  return mapTicketCompletionSubmission(submission);
}

// Function ยืนยัน ticket completion จาก DB
export async function confirmTicketCompletion(
  ticketId: number,
  submissionId: number,
  connection?: DbConnection,
  resolvedByLineUserId?: string | null
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: TICKET_STATUS.DELIVERED,
    },
    data: {
      status: TICKET_STATUS.COMPLETED,
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
      status: TICKET_STATUS.COMPLETED,
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
        status: TICKET_STATUS.COMPLETED,
        confirmedAt: new Date(),
        resolvedByLineUserId: resolvedByLineUserId ?? null,
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

// Function ดึงข้อมูลทั้งหมดที่ใช้สำหรับ Financialize Ticket
export async function findTicketFinancializationContext(
  ticketId: number,
  connection?: DbConnection
) {
  const db = client(connection);

  return db.gateTicket.findUnique({
    where: {
      id: ticketId,
    },

    include: {
      products: {
        orderBy: {
          id: "asc",
        },

        include: {
          financial: true,
        },
      },

      workers: {
        where: {
          status: TICKET_WORKER_STATUS.COMPLETED,
        },

        orderBy: {
          id: "asc",
        },
      },
    },
  });
}

// Function บันทึก Financial ของ Product
export async function createTicketProductFinancial(
  input: {
    ticketProductId: number;
    confirmedQuantity: Prisma.Decimal;
    stallFeeRaw: Prisma.Decimal;
    stallFeeRounded: Prisma.Decimal;
    laborFeeRaw: Prisma.Decimal;
    productCharge: Prisma.Decimal;
    workerCount: number;
    workerPayoutTotal: Prisma.Decimal;
    fundAmount: Prisma.Decimal;
    finalizedAt: Date;

    workerPayments: Array<{
      ticketWorkerId: number;
      rawAmount: Prisma.Decimal;
      remainderAmount: Prisma.Decimal;
      finalAmount: Prisma.Decimal;
    }>;
  },
  connection?: DbConnection
) {
  const db = client(connection);

  return db.ticketProductFinancial.create({
    data: {
      ticketProductId: input.ticketProductId,
      confirmedQuantity: input.confirmedQuantity,
      stallFeeRaw: input.stallFeeRaw,
      stallFeeRounded: input.stallFeeRounded,
      laborFeeRaw: input.laborFeeRaw,
      productCharge: input.productCharge,
      workerCount: input.workerCount,
      workerPayoutTotal: input.workerPayoutTotal,
      fundAmount: input.fundAmount,
      finalizedAt: input.finalizedAt,

      workerPayments: {
        create:
          input.workerPayments.map(
            (payment) => ({
              ticketWorkerId: payment.ticketWorkerId,
              rawAmount: payment.rawAmount,
              remainderAmount: payment.remainderAmount,
              finalAmount: payment.finalAmount,
            })
          ),
      },
    },
  });
}

// Functionปิด Financialization ของ Ticket
export async function markGateTicketFinancialized(
  ticketId: number,
  finalStallAmount: Prisma.Decimal,
  finalizedAt: Date,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  const result =
    await db.gateTicket.updateMany({
      where: {
        id: ticketId,
        status: TICKET_STATUS.COMPLETED,
        financializedAt: null,
      },

      data: {
        finalStallAmount,
        completedAt: finalizedAt,
        financializedAt: finalizedAt,
      },
    });

  if (result.count !== 1) {
    throw new Error(
      "Gate ticket financialization did not update exactly one ticket."
    );
  }
}

// Function ปิด completed vehicle job if ready จาก DB
export async function closeCompletedVehicleJobIfReady(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<CompletedVehicleJobResult | null> {
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
    await db.vehicleJobAssignment.updateMany({
      where: {
        id: {
          in: completedAssignmentIds,
        },
      },
      data: {
        status: ASSIGNMENT_STATUS.COMPLETED,
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

// Function ตีกลับ ticket completion จาก DB
export async function rejectTicketCompletion(
  ticketId: number,
  submissionId: number,
  rejectReason?: string | null,
  connection?: DbConnection,
  resolvedByLineUserId?: string | null
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: TICKET_STATUS.DELIVERED,
    },
    data: {
      status: TICKET_STATUS.REJECT,
      rejectReason: rejectReason ?? null,
    },
  });

  if (updateResult.count !== 1) {
    throw new Error("Ticket reject did not update a waiting ticket.");
  }

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
        status: TICKET_STATUS.REJECT,
        rejectedAt: new Date(),
        resolvedByLineUserId: resolvedByLineUserId ?? null,
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

