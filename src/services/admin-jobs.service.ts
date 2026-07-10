// import
import { Prisma } from "@prisma/client";
import { withTransaction } from "../db/prisma";
import { enqueueLineMessage } from "../queues/notification-queue";
import { enqueueWorker, markWorkerBusy, markWorkerWaiting, removeAssignmentTimeout, scheduleAssignmentTimeout } from "../queues/worker-queue";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as adminJobsRepository from "../repositories/admin-jobs.repository";
import { accountRepository } from "../repositories/admin-jobs.repository";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./realtime.service";
import { getRuntimeSettings } from "./admin-settings.service";
// import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { GateTicketDto, MarketJobDto, VehicleJobAssignmentDto, VehicleJobDetailResponse, VehicleJobDto } from "../types/worker.type";
// import Validation
import { parseId, parseWithSchema } from "../validation/parser";
import { adminAssignWorkersBodySchema, adminCancelBodySchema, adminExtendScanDeadlineBodySchema, adminVehicleJobListQuerySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างเวลา deadline จากเวลาปัจจุบัน
function buildDeadline(durationMs: number): Date {
  return new Date(Date.now() + durationMs);
}

// Function สุ่มลำดับ worker ก่อนนำกลับเข้าคิวท้ายสุดเป็นกลุ่ม
function shuffleWorkerIds(workerIds: number[]): number[] {
  const items = [...workerIds];

  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }

  return items;
}

// Function คำนวณ scan deadline ใหม่ โดยต่อจาก deadline เดิมถ้ายังไม่หมดเวลา
function extendDeadline(currentDeadline: string | null, minutes: number): Date {
  const now = Date.now();
  const currentTime = currentDeadline ? new Date(currentDeadline).getTime() : now;
  const baseTime = Math.max(now, currentTime);

  return new Date(baseTime + minutes * 60 * 1000);
}

// Function สร้างช่วงเวลาของวันที่ไทยเพื่อใช้ query งานรถรายวัน
function buildBangkokDateRange(date: string): { startAt: Date; endAt: Date } {
  const startAt = new Date(`${date}T00:00:00.000+07:00`);
  const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);

  return {
    startAt,
    endAt,
  };
}

// Function รวม receiver ของ SSE สำหรับงานแผงที่เกี่ยวข้อง
async function buildStallJobAudience(
  ticketId: number,
  connection?: Parameters<typeof adminJobsRepository.listTicketWorkers>[1]
): Promise<number[]> {
  const [ticketWorkers, admins] = await Promise.all([
    adminJobsRepository.listTicketWorkers(ticketId, connection),
    accountRepository.listAdmins(connection),
  ]);
  const receiverIds = [
    ...ticketWorkers.map((worker) => worker.worker_account_id),
    ...admins.map((admin) => admin.id),
  ];

  return [...new Set(receiverIds)];
}

// Function หา worker ที่เกี่ยวข้องกับงานรถ เพื่อส่ง WebSocket event ให้ Mobile
async function listVehicleJobWorkerIds(vehicleJobId: number): Promise<number[]> {
  const assignments = await adminJobsRepository.listActiveAssignmentsByVehicleJob(
    vehicleJobId
  );

  return [
    ...new Set(assignments.map((assignment) => assignment.worker_account_id)),
  ];
}

// Function หา worker ที่เกี่ยวข้องกับงานแผง ถ้ายังไม่มี ticket workers ให้ fallback เป็น worker ของรถ
async function listStallJobWorkerIds(ticket: GateTicketDto): Promise<number[]> {
  const ticketWorkers = await adminJobsRepository.listTicketWorkers(ticket.id);

  if (ticketWorkers.length > 0) {
    return [
      ...new Set(ticketWorkers.map((worker) => worker.worker_account_id)),
    ];
  }

  return listVehicleJobWorkerIds(ticket.vehicle_job_id);
}

// Function สร้างข้อความ LINE แจ้ง vendor ว่างานแผงถูกเปิดให้ส่งยอดใหม่
function buildVendorReopenMessage(ticket: GateTicketDto): string {
  const ticketLabel = ticket.ticket_no ?? ticket.stall_job_ref;

  return [
    `Ticket ${ticketLabel} has been reopened for quantity resubmission.`,
    "Please wait for the worker to submit the corrected quantities again.",
  ].join("\n");
}

// Function ดึงรายการงานรถสำหรับ Admin
export async function listVehicleJobs(query: unknown): Promise<{
  data: VehicleJobDto[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}> {
  const filters = parseWithSchema(adminVehicleJobListQuerySchema, query);
  const dateRange = filters.date ? buildBangkokDateRange(filters.date) : {};
  const result = await adminJobsRepository.listVehicleJobs({
    search: filters.search,
    status: filters.status,
    page: filters.page,
    limit: filters.limit,
    ...dateRange,
  });

  if (filters.page === undefined) {
    return {
      data: result.data,
    };
  }

  const limit = filters.limit ?? 20;
  const total = result.total ?? result.data.length;

  return {
    data: result.data,
    pagination: {
      page: filters.page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
}

// Function ดึงรายละเอียดงานรถสำหรับ Admin
export async function getVehicleJob(idParam: unknown): Promise<VehicleJobDetailResponse> {
  const vehicleJobId = parseId(idParam);
  const detail = await adminJobsRepository.getVehicleJobDetail(vehicleJobId);

  if (!detail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return detail;
}

// Function ยกเลิกงานรถทั้งหมด และพา worker ที่ถือ assignment กลับไปสถานะ waiting
export async function cancelVehicleJob(
  idParam: unknown,
  body: unknown
): Promise<{ message: string; vehicle_job: VehicleJobDto }> {
  const vehicleJobId = parseId(idParam);
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const activeAssignments = await adminJobsRepository.listActiveAssignmentsByVehicleJob(
    vehicleJobId
  );

  const vehicleJob = await withTransaction(async (transaction) => {
    const existingVehicleJob = await adminJobsRepository.findVehicleJobById(
      vehicleJobId,
      transaction
    );

    if (!existingVehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    return adminJobsRepository.cancelVehicleJob(vehicleJobId, transaction);
  });

  await Promise.all(
    activeAssignments.map((assignment) =>
      markWorkerWaiting(assignment.worker_account_id)
    )
  );
  activeAssignments.forEach((assignment) => {
    sendWorkerSocketEvent(assignment.worker_account_id, "ASSIGNMENT_CANCELLED", {
      assignment_id: assignment.id,
      vehicle_job_id: assignment.vehicle_job_id,
      reason: "vehicle_job_cancelled",
    });
  });
  publishRealtimeEvent({
    type: "VEHICLE_JOB_CANCELLED",
    title: "Vehicle job cancelled",
    message: `Vehicle job ${vehicleJob.vehicle_job_ref} was cancelled.`,
    payload: {
      vehicle_job_id: vehicleJob.id,
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      status: vehicleJob.status,
      affected_assignment_ids: activeAssignments.map((assignment) => assignment.id),
      affected_worker_account_ids: activeAssignments.map(
        (assignment) => assignment.worker_account_id
      ),
    },
    admin: true,
    worker_account_ids: activeAssignments.map(
      (assignment) => assignment.worker_account_id
    ),
  });

  return {
    message: "Vehicle job cancelled successfully.",
    vehicle_job: vehicleJob,
  };
}

// Function ยกเลิกงานตลาดพร้อมแผงใต้ตลาด
// Function ยกเลิกงานรถทั้งคัน และนำ worker ที่ถือ assignment กลับเข้าท้ายคิวแบบสุ่มลำดับ
export async function cancelVehicleJobAndRequeue(
  idParam: unknown,
  body: unknown
): Promise<{
  message: string;
  vehicle_job: VehicleJobDto;
  requeued_worker_account_ids: number[];
}> {
  const vehicleJobId = parseId(idParam);
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const activeAssignments = await adminJobsRepository.listActiveAssignmentsByVehicleJob(
    vehicleJobId
  );

  const vehicleJob = await withTransaction(async (transaction) => {
    const existingVehicleJob = await adminJobsRepository.findVehicleJobById(
      vehicleJobId,
      transaction
    );

    if (!existingVehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    return adminJobsRepository.cancelVehicleJob(vehicleJobId, transaction);
  });

  await Promise.all(
    activeAssignments.map((assignment) => removeAssignmentTimeout(assignment.id))
  );

  const requeuedWorkerIds = shuffleWorkerIds(
    activeAssignments.map((assignment) => assignment.worker_account_id)
  );

  for (const workerId of requeuedWorkerIds) {
    await enqueueWorker(workerId);
    sendWorkerSocketEvent(workerId, "WORKER_STATUS_CHANGED", {
      status: "ready",
      reason: "vehicle_job_cancelled_requeue",
    });
  }
  publishRealtimeEvent({
    type: "VEHICLE_JOB_CANCELLED",
    title: "Vehicle job cancelled",
    message: `Vehicle job ${vehicleJob.vehicle_job_ref} was cancelled and workers were requeued.`,
    payload: {
      vehicle_job_id: vehicleJob.id,
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      status: vehicleJob.status,
      requeued: true,
      requeued_worker_account_ids: requeuedWorkerIds,
    },
    worker_account_ids: requeuedWorkerIds,
  });
  publishNotification({
    type: "VEHICLE_JOB_CANCELLED_AND_REQUEUED",
    title: "Vehicle job cancelled and workers requeued",
    message: `Vehicle job ${vehicleJob.vehicle_job_ref} was cancelled and workers were requeued.`,
    payload: {
      vehicle_job_id: vehicleJob.id,
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      status: vehicleJob.status,
      requeued_worker_account_ids: requeuedWorkerIds,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Vehicle job cancelled and workers requeued successfully.",
    vehicle_job: vehicleJob,
    requeued_worker_account_ids: requeuedWorkerIds,
  };
}

// Function ให้ Admin assign งานรถให้ worker แบบระบุรายคนเอง
export async function assignVehicleJobWorkers(
  idParam: unknown,
  body: unknown
): Promise<{ message: string; assignments: VehicleJobAssignmentDto[] }> {
  const vehicleJobId = parseId(idParam);
  const input = parseWithSchema(adminAssignWorkersBodySchema, body);
  const workerIds = [...new Set(input.worker_account_ids)];
  const settings = await getRuntimeSettings();
  const acceptDeadlineMs = settings.worker_accept_deadline_seconds * 1000;

  const assignments = await withTransaction(async (transaction) => {
    const vehicleJob = await adminJobsRepository.findVehicleJobById(
      vehicleJobId,
      transaction
    );

    if (!vehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    if (vehicleJob.status === "COMPLETED" || vehicleJob.status === "CANCELLED") {
      throw new ApiError(409, "VEHICLE_JOB_CLOSED", "Vehicle job is already closed.");
    }

    const createdAssignments: VehicleJobAssignmentDto[] = [];

    for (const workerId of workerIds) {
      const [worker, currentAssignment] = await Promise.all([
        accountRepository.findUserById(workerId, transaction),
        adminJobsRepository.findCurrentAssignmentByWorker(workerId, transaction),
      ]);

      if (!worker) {
        throw new ApiError(404, "WORKER_NOT_FOUND", `Worker ${workerId} not found.`);
      }

      if (worker.status !== "active") {
        throw new ApiError(403, "WORKER_NOT_ACTIVE", `Worker ${workerId} is not active.`);
      }

      if (currentAssignment) {
        throw new ApiError(
          409,
          "WORKER_HAS_ACTIVE_ASSIGNMENT",
          `Worker ${workerId} already has an active assignment.`
        );
      }

      const assignment = await adminJobsRepository.createAssignment(
        vehicleJobId,
        workerId,
        buildDeadline(acceptDeadlineMs),
        transaction
      );

      createdAssignments.push(assignment);
    }

    return createdAssignments;
  });

  for (const assignment of assignments) {
    await markWorkerBusy(assignment.worker_account_id);
    await scheduleAssignmentTimeout(
      assignment.id,
      assignment.worker_account_id,
      acceptDeadlineMs
    );
    sendWorkerSocketEvent(assignment.worker_account_id, "WORKER_ASSIGNED", {
      assignment,
      vehicle_job_id: assignment.vehicle_job_id,
      accept_deadline_at: assignment.accept_deadline_at,
      source: "admin_assign",
    });
  }
  publishNotification({
    type: "ASSIGNMENT_CREATED_BY_ADMIN",
    title: "Workers assigned by admin",
    message: `${assignments.length} worker(s) were assigned to vehicle job ${vehicleJobId}.`,
    payload: {
      vehicle_job_id: vehicleJobId,
      assignments,
      worker_account_ids: assignments.map((assignment) => assignment.worker_account_id),
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Workers assigned successfully.",
    assignments,
  };
}

// Function ยกเลิก assignment รายคน โดยไม่เติม worker คนใหม่จากคิวอัตโนมัติ
export async function cancelAssignment(
  idParam: unknown,
  body: unknown
): Promise<{ message: string; assignment: VehicleJobAssignmentDto }> {
  const assignmentId = parseId(idParam);
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const assignment = await adminJobsRepository.findAssignmentById(assignmentId);

  if (!assignment) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
  }

  if (!["PENDING", "ACCEPTED", "SCANNED", "COUNTING"].includes(assignment.status)) {
    throw new ApiError(409, "ASSIGNMENT_NOT_ACTIVE", "Assignment is not active.");
  }

  const cancelledAssignment = await adminJobsRepository.cancelAssignment(assignment.id);

  await removeAssignmentTimeout(assignment.id);
  await markWorkerWaiting(assignment.worker_account_id);
  sendWorkerSocketEvent(assignment.worker_account_id, "ASSIGNMENT_CANCELLED", {
    assignment_id: cancelledAssignment.id,
    vehicle_job_id: cancelledAssignment.vehicle_job_id,
    reason: "admin_cancel_assignment",
  });
  publishNotification({
    type: "ASSIGNMENT_CANCELLED",
    title: "Assignment cancelled",
    message: `Assignment ${cancelledAssignment.id} was cancelled by admin.`,
    payload: {
      assignment_id: cancelledAssignment.id,
      vehicle_job_id: cancelledAssignment.vehicle_job_id,
      worker_account_id: cancelledAssignment.worker_account_id,
      status: cancelledAssignment.status,
      reason: "admin_cancel_assignment",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Assignment cancelled successfully.",
    assignment: cancelledAssignment,
  };
}


// Function ต่อเวลา scan QR แบบทั้งรถ หรือเลือกเฉพาะ worker ในรถนั้น
export async function extendVehicleJobScanDeadline(
  idParam: unknown,
  body: unknown
): Promise<{ message: string; assignments: VehicleJobAssignmentDto[] }> {
  const vehicleJobId = parseId(idParam);
  const input = parseWithSchema(adminExtendScanDeadlineBodySchema, body);
  const vehicleJob = await adminJobsRepository.findVehicleJobById(vehicleJobId);

  if (!vehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  const assignments = await adminJobsRepository.listAcceptedAssignmentsByVehicleJob(
    vehicleJobId,
    input.worker_account_ids
  );

  if (assignments.length === 0) {
    throw new ApiError(
      404,
      "ACCEPTED_ASSIGNMENTS_NOT_FOUND",
      "No accepted assignments found for scan deadline extension."
    );
  }

  const updatedAssignments: VehicleJobAssignmentDto[] = [];

  for (const assignment of assignments) {
    updatedAssignments.push(
      await adminJobsRepository.extendAssignmentScanDeadline(
        assignment.id,
        extendDeadline(assignment.scan_deadline_at, input.minutes)
      )
    );
  }
  publishRealtimeEvent({
    type: "ASSIGNMENT_SCAN_DEADLINE_EXTENDED",
    title: "Scan deadline extended",
    message: `Scan deadline was extended for ${updatedAssignments.length} assignment(s).`,
    payload: {
      vehicle_job_id: vehicleJobId,
      minutes: input.minutes,
      worker_account_ids: input.worker_account_ids ?? null,
      assignments: updatedAssignments,
    },
    admin: true,
    worker_account_ids: updatedAssignments.map(
      (assignment) => assignment.worker_account_id
    ),
  });

  return {
    message: "Vehicle job scan deadline extended successfully.",
    assignments: updatedAssignments,
  };
}

export async function cancelMarketJob(
  idParam: unknown,
  body: unknown
): Promise<{ message: string; market_job: MarketJobDto }> {
  const marketJobId = parseId(idParam);
  parseWithSchema(adminCancelBodySchema, body ?? {});

  const marketJob = await withTransaction(async (transaction) => {
    const existingMarketJob = await adminJobsRepository.findMarketJobById(
      marketJobId,
      transaction
    );

    if (!existingMarketJob) {
      throw new ApiError(404, "MARKET_JOB_NOT_FOUND", "Market job not found.");
    }

    return adminJobsRepository.cancelMarketJob(marketJobId, transaction);
  });
  publishRealtimeEvent({
    type: "MARKET_JOB_CANCELLED",
    title: "Market job cancelled",
    message: `Market job ${marketJob.market_job_ref} was cancelled.`,
    payload: {
      market_job_id: marketJob.id,
      vehicle_job_id: marketJob.vehicle_job_id,
      market_job_ref: marketJob.market_job_ref,
      status: marketJob.status,
    },
    admin: true,
    worker_account_ids: await listVehicleJobWorkerIds(marketJob.vehicle_job_id),
  });

  return {
    message: "Market job cancelled successfully.",
    market_job: marketJob,
  };
}

// Function ยกเลิกงานแผงเดียว
export async function cancelStallJob(
  idParam: unknown,
  body: unknown
): Promise<{ message: string; stall_job: GateTicketDto }> {
  const ticketId = parseId(idParam);
  parseWithSchema(adminCancelBodySchema, body ?? {});

  const ticket = await withTransaction(async (transaction) => {
    const existingTicket = await adminJobsRepository.findGateTicketById(
      ticketId,
      transaction
    );

    if (!existingTicket) {
      throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
    }

    return adminJobsRepository.cancelGateTicket(ticketId, transaction);
  });
  publishRealtimeEvent({
    type: "STALL_JOB_CANCELLED",
    title: "Stall job cancelled",
    message: `Stall job ${ticket.ticket_no ?? ticket.stall_job_ref} was cancelled.`,
    payload: {
      ticket_id: ticket.id,
      vehicle_job_id: ticket.vehicle_job_id,
      market_job_id: ticket.market_job_id,
      stall_job_ref: ticket.stall_job_ref,
      ticket_no: ticket.ticket_no,
      status: ticket.status,
      confirmation_status: ticket.confirmation_status,
    },
    admin: true,
    worker_account_ids: await listStallJobWorkerIds(ticket),
  });

  return {
    message: "Stall job cancelled successfully.",
    stall_job: ticket,
  };
}

// Function เปิดงานแผงที่ vendor confirm ผิด ให้ worker ส่งยอดใหม่อีกครั้ง
export async function reopenStallJob(
  idParam: unknown,
  auth?: AccessTokenPayload
): Promise<{ message: string; stall_job: GateTicketDto }> {
  const ticketId = parseId(idParam);
  const result = await withTransaction(async (transaction) => {
    const existingTicket = await adminJobsRepository.findGateTicketById(
      ticketId,
      transaction
    );

    if (!existingTicket) {
      throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
    }

    if (existingTicket.status !== "CLOSED") {
      throw new ApiError(
        409,
        "STALL_JOB_NOT_CLOSED",
        "Only closed stall jobs can be reopened."
      );
    }

    const ticket = await adminJobsRepository.reopenGateTicket(ticketId, transaction);

    await adminJobsRepository.createGateTicketStatusHistory(
      {
        ticket_id: ticket.id,
        from_status: existingTicket.status,
        to_status: ticket.status,
        action: "ADMIN_REOPEN_STALL_JOB",
        changed_by_account_id: auth?.account_id ?? null,
      },
      transaction
    );

    const receiverAccountIds = await buildStallJobAudience(ticket.id, transaction);

    return {
      ticket,
      receiverAccountIds,
    };
  });

  if (result.ticket.vendor_line_id) {
    const lineLogId = await adminJobsRepository.createMessageDeliveryLog(
      "LINE",
      "send_vendor_ticket_reopen",
      {
        ticket_id: result.ticket.id,
        vendor_line_id: result.ticket.vendor_line_id,
      } as unknown as Prisma.InputJsonValue,
      result.ticket.vendor_line_id
    );

    await enqueueLineMessage("send-vendor-ticket-reopen", {
      log_id: lineLogId,
      to: result.ticket.vendor_line_id,
      messages: [
        {
          type: "text",
          text: buildVendorReopenMessage(result.ticket),
        },
      ],
    });
  }

  publishRealtimeEvent({
    type: "STALL_JOB_REOPENED",
    title: "Stall job reopened",
    message: `Ticket ${result.ticket.ticket_no ?? result.ticket.stall_job_ref} was reopened for resubmission.`,
    payload: {
      ticket_id: result.ticket.id,
      vehicle_job_id: result.ticket.vehicle_job_id,
      market_job_id: result.ticket.market_job_id,
      status: result.ticket.status,
      confirmation_status: result.ticket.confirmation_status,
    },
    admin: true,
    worker_account_ids: result.receiverAccountIds,
  });

  return {
    message: "Stall job reopened successfully.",
    stall_job: result.ticket,
  };
}
