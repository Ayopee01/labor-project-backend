// import Library
import type { Prisma } from "@prisma/client";
// import
import { withTransaction } from "../db/prisma";
import { enqueueLineMessage } from "../queues/notification-queue";
import { enqueueWorker, getWorkerBreakCount, getWorkerPresence, getWorkerQueueStatus, incrementWorkerBreakCount, markWorkerBreak, markWorkerOffline, removeAssignmentTimeout, scheduleWorkerBreakReturn } from "../queues/worker-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as lineRepository from "../repositories/line.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { accountRepository, workScheduleRepository } from "../repositories/worker-application.repository";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./realtime.service";
import { getRuntimeSettings } from "./admin-settings.service";
// import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { GateTicketDto, TicketCompletionResponse, TicketCompletionSubmissionDto, TicketProductDto, VehicleJobAssignmentDto, VehicleJobDetailResponse, WorkerAssignmentHistoryItemDto, WorkerPresenceDto, WorkerQueueEntryDto } from "../types/worker.type";
// import Validation
import { parseId, parseWithSchema } from "../validation/parser";
import { workerAssignmentHistoryQuerySchema, workerScanBodySchema, workerTicketCompleteBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";
import { isDateInWorkSchedule } from "../utils/shift";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างเวลา deadline จากเวลาปัจจุบัน
function buildDeadline(durationMs: number): Date {
  return new Date(Date.now() + durationMs);
}

// Function สร้างช่วงเวลาของวันที่ไทยเพื่อใช้ query ประวัติงานรายวัน
function buildBangkokDateRange(date: string): { startAt: Date; endAt: Date } {
  const startAt = new Date(`${date}T00:00:00.000+07:00`);
  const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);

  return {
    startAt,
    endAt,
  };
}

// Function เติมจำนวนครั้งพักใน response สถานะคิว
function withBreakUsage(
  queueEntry: WorkerQueueEntryDto,
  breakCountUsed: number,
  breakLimit: number
): WorkerQueueEntryDto {
  return {
    ...queueEntry,
    break_count_used: breakCountUsed,
    break_count_limit: breakLimit,
  };
}

// Function ตรวจ auth ว่าเป็น worker ที่ active ก่อนทำงานใน Worker Mobile flow
async function requireWorker(auth?: AccessTokenPayload) {
  if (!auth) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }

  if (auth.role !== "worker") {
    throw new ApiError(403, "FORBIDDEN", "Worker account is required.");
  }

  const account = await accountRepository.findUserById(auth.account_id);

  if (!account || account.status !== "active") {
    throw new ApiError(403, "WORKER_NOT_ACTIVE", "Worker account is not active.");
  }

  return account;
}

// Function สร้างข้อความส่งให้ vendor ตรวจยอดปิดงานของ ticket
function buildVendorCompletionMessage(
  ticket: GateTicketDto,
  submission: TicketCompletionSubmissionDto,
  detail: VehicleJobDetailResponse | null,
  products: TicketProductDto[]
): string {
  const market = detail?.markets.find((item) =>
    item.tickets.some((marketTicket) => marketTicket.id === ticket.id)
  );
  const productLines = products.map((product) => {
    const expectedQuantity = Number(product.quantity);
    const confirmedQuantity = Number(product.confirmed_quantity ?? 0);
    const diff = confirmedQuantity - expectedQuantity;
    const diffText = diff === 0 ? "ตรง" : diff > 0 ? `เกิน ${diff}` : `ขาด ${Math.abs(diff)}`;

    return [
      `- ${product.product_type ?? "-"} / ${product.name}`,
      `  Gate: ${product.quantity} ${product.unit}`,
      `  Worker: ${product.confirmed_quantity ?? "-"} ${product.unit}`,
      `  Diff: ${diffText} ${product.unit}`,
    ].join("\n");
  });

  return [
    "Worker submitted ticket completion.",
    `License plate: ${detail?.vehicle_job.license_plate ?? "-"}`,
    `Vehicle type: ${detail?.vehicle_job.vehicle_type ?? "-"}`,
    `Market: ${market?.market_name ?? "-"}`,
    `Ticket: ${ticket.ticket_no ?? ticket.stall_job_ref}`,
    `Stall: ${ticket.stall_no ?? "-"}`,
    `Submission: ${submission.id}`,
    "Products:",
    ...productLines,
    `Confirm: action=vendor_confirm_completion&ticketId=${ticket.id}`,
    `Reject: action=vendor_reject_completion&ticketId=${ticket.id}`,
  ]
    .join("\n");
}

// Function ตรวจรายการสินค้าที่ worker ส่งว่าครบ ตรง ticket และไม่ซ้ำ
function validateTicketCompletionItems(
  products: TicketProductDto[],
  items: Array<{ ticket_product_id: number; confirmed_quantity: number }>
): void {
  const productIds = new Set(products.map((product) => product.id));
  const itemIds = new Set<number>();

  for (const item of items) {
    if (!productIds.has(item.ticket_product_id)) {
      throw new ApiError(
        400,
        "INVALID_TICKET_PRODUCT",
        "Ticket product does not belong to this ticket."
      );
    }

    if (itemIds.has(item.ticket_product_id)) {
      throw new ApiError(
        400,
        "DUPLICATE_TICKET_PRODUCT",
        "Ticket product is duplicated in completion items."
      );
    }

    itemIds.add(item.ticket_product_id);
  }

  if (itemIds.size !== products.length) {
    throw new ApiError(
      400,
      "INCOMPLETE_TICKET_PRODUCTS",
      "All ticket products must be sent with confirmed quantities."
    );
  }
}

// Function หา receiver ของ event ปิดงาน เพื่อส่ง SSE ให้ worker ใน ticket และ admin ทุกคน
async function buildTicketResultAudience(
  ticket: GateTicketDto,
  connection?: Parameters<typeof workerApplicationRepository.listTicketWorkers>[1]
): Promise<number[]> {
  const [ticketWorkers, admins] = await Promise.all([
    workerApplicationRepository.listTicketWorkers(ticket.id, connection),
    accountRepository.listAdmins(connection),
  ]);
  const receiverIds = new Set<number>();

  ticketWorkers.forEach((worker) => receiverIds.add(worker.worker_account_id));
  admins.forEach((admin) => receiverIds.add(admin.id));

  return Array.from(receiverIds);
}

// Function ให้ worker เข้า queue และ dispatch ถ้ามีงานรออยู่
export async function workerOnline(auth?: AccessTokenPayload): Promise<WorkerQueueEntryDto> {
  const account = await requireWorker(auth);

  if (!isWorkerSocketConnected(account.id)) {
    throw new ApiError(
      409,
      "WORKER_SOCKET_NOT_CONNECTED",
      "Worker WebSocket must be connected before going online."
    );
  }

  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
    account.id
  );

  if (!currentSchedule) {
    throw new ApiError(
      403,
      "WORK_SCHEDULE_NOT_FOUND",
      "Worker does not have a current work schedule."
    );
  }

  if (!isDateInWorkSchedule(currentSchedule)) {
    throw new ApiError(
      403,
      "OUTSIDE_WORK_SHIFT",
      "Worker can go online only during the assigned work shift."
    );
  }

  return withTransaction(async (transaction) => {
    const currentAssignment = await workerApplicationRepository.findCurrentAssignmentByWorker(
      account.id,
      transaction
    );

    if (currentAssignment) {
      throw new ApiError(409, "WORKER_BUSY", "Worker already has an active assignment.");
    }

    await enqueueWorker(account.id);

    await dispatchReadyWorkers(transaction);

    const latestQueueEntry = await getWorkerQueueStatus(account.id);

    if (!latestQueueEntry) {
      throw new ApiError(404, "WORKER_QUEUE_NOT_FOUND", "Worker queue entry not found.");
    }

    sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
      queue: latestQueueEntry,
    });
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker online",
      message: `Worker ${account.full_name} is ready for work.`,
      payload: {
        worker_account_id: account.id,
        queue: latestQueueEntry,
        reason: "worker_online",
      },
      audience: {
        roles: ["admin"],
      },
    });

    return latestQueueEntry;
  });
}

// Function ให้ worker ออกจาก queue
export async function workerOffline(auth?: AccessTokenPayload): Promise<WorkerQueueEntryDto> {
  const account = await requireWorker(auth);

  const queueEntry = await markWorkerOffline(account.id);
  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: queueEntry,
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker offline",
    message: `Worker ${account.full_name} went offline.`,
    payload: {
      worker_account_id: account.id,
      queue: queueEntry,
      reason: "worker_offline",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return queueEntry;
}

// Function ให้ worker พักชั่วคราว 15 นาที และกลับท้ายคิวอัตโนมัติ
export async function workerBreak(auth?: AccessTokenPayload): Promise<WorkerQueueEntryDto> {
  const account = await requireWorker(auth);
  const settings = await getRuntimeSettings();
  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
    account.id
  );

  if (!currentSchedule) {
    throw new ApiError(
      403,
      "WORK_SCHEDULE_NOT_FOUND",
      "Worker does not have a current work schedule."
    );
  }

  if (!isDateInWorkSchedule(currentSchedule)) {
    throw new ApiError(
      403,
      "OUTSIDE_WORK_SHIFT",
      "Worker can take a break only during the assigned work shift."
    );
  }

  const [queueEntry, currentAssignment, currentBreakCount] = await Promise.all([
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
    getWorkerBreakCount(account.id, currentSchedule.id),
  ]);

  if (currentAssignment) {
    throw new ApiError(409, "WORKER_BUSY", "Worker already has an active assignment.");
  }

  if (!queueEntry || queueEntry.status !== "ready") {
    throw new ApiError(
      409,
      "WORKER_NOT_READY",
      "Worker can take a break only while ready in queue."
    );
  }

  if (currentBreakCount >= settings.worker_break_limit) {
    throw new ApiError(
      409,
      "BREAK_LIMIT_REACHED",
      "Worker break limit reached for this shift."
    );
  }

  const breakCountUsed = await incrementWorkerBreakCount(
    account.id,
    currentSchedule.id
  );
  const breakDurationMs = settings.worker_break_duration_minutes * 60 * 1000;
  const breakUntil = buildDeadline(breakDurationMs);
  const breakEntry = await markWorkerBreak(account.id, breakUntil);

  await scheduleWorkerBreakReturn(
    account.id,
    currentSchedule.id,
    breakDurationMs
  );

  const breakQueueEntry = withBreakUsage(
    breakEntry,
    breakCountUsed,
    settings.worker_break_limit
  );
  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: breakQueueEntry,
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker on break",
    message: `Worker ${account.full_name} is on break.`,
    payload: {
      worker_account_id: account.id,
      queue: breakQueueEntry,
      reason: "worker_break",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return breakQueueEntry;
}

// Function ดึงสถานะ queue และ assignment ปัจจุบันของ worker
export async function getWorkerStatus(auth?: AccessTokenPayload): Promise<{
  queue: WorkerQueueEntryDto | null;
  current_assignment: VehicleJobAssignmentDto | null;
  presence: WorkerPresenceDto;
}> {
  const account = await requireWorker(auth);

  const [queueEntry, assignment, presence] = await Promise.all([
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
    getWorkerPresence(account.id),
  ]);

  return {
    queue: queueEntry,
    current_assignment: assignment,
    presence,
  };
}

// Function ดึงประวัติงานของ worker ตามวันที่ที่ระบุ
export async function listWorkerAssignmentHistory(
  query: unknown,
  auth?: AccessTokenPayload
): Promise<{
  date: string;
  data: WorkerAssignmentHistoryItemDto[];
}> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerAssignmentHistoryQuerySchema, query);
  const { startAt, endAt } = buildBangkokDateRange(input.date);
  const history = await workerApplicationRepository.listWorkerAssignmentHistoryByDate(
    account.id,
    startAt,
    endAt
  );

  return {
    date: input.date,
    data: history,
  };
}

// Function ให้ worker รับงาน
export async function acceptWorkerAssignment(
  assignmentIdParam: unknown,
  auth?: AccessTokenPayload
): Promise<VehicleJobAssignmentDto> {
  const account = await requireWorker(auth);
  const assignmentId = parseId(assignmentIdParam);
  const assignment = await workerApplicationRepository.findAssignmentByIdAndWorker(
    assignmentId,
    account.id
  );

  if (!assignment) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
  }

  if (assignment.status !== "PENDING") {
    throw new ApiError(409, "ASSIGNMENT_NOT_PENDING", "Assignment is not pending.");
  }

  if (
    assignment.accept_deadline_at &&
    new Date(assignment.accept_deadline_at).getTime() <= Date.now()
  ) {
    await withTransaction(async (transaction) => {
      await workerApplicationRepository.timeoutAssignment(assignment.id, transaction);
      await enqueueWorker(account.id);
      await dispatchReadyWorkers(transaction);
    });
    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      assignment_id: assignment.id,
      vehicle_job_id: assignment.vehicle_job_id,
    });
    publishNotification({
      type: "ASSIGNMENT_TIMEOUT",
      title: "Assignment timed out",
      message: `Worker ${account.full_name} did not accept assignment ${assignment.id} in time.`,
      payload: {
        assignment_id: assignment.id,
        vehicle_job_id: assignment.vehicle_job_id,
        worker_account_id: account.id,
      },
      audience: {
        roles: ["admin"],
      },
    });

    throw new ApiError(409, "ASSIGNMENT_TIMEOUT", "Assignment acceptance time expired.");
  }

  await removeAssignmentTimeout(assignment.id);
  const settings = await getRuntimeSettings();

  const acceptedAssignment = await workerApplicationRepository.acceptAssignment(
    assignment.id,
    buildDeadline(settings.worker_scan_deadline_minutes * 60 * 1000)
  );

  sendWorkerSocketEvent(account.id, "ASSIGNMENT_ACCEPTED", {
    assignment: acceptedAssignment,
  });
  publishNotification({
    type: "ASSIGNMENT_ACCEPTED",
    title: "Assignment accepted",
    message: `Worker ${account.full_name} accepted assignment ${acceptedAssignment.id}.`,
    payload: {
      assignment_id: acceptedAssignment.id,
      vehicle_job_id: acceptedAssignment.vehicle_job_id,
      worker_account_id: account.id,
      status: acceptedAssignment.status,
      scan_deadline_at: acceptedAssignment.scan_deadline_at,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return acceptedAssignment;
}

// Function ให้ worker scan QR เพื่อ check-in เข้างาน
export async function scanWorkerAssignment(
  assignmentIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<VehicleJobAssignmentDto> {
  const account = await requireWorker(auth);
  const assignmentId = parseId(assignmentIdParam);
  const input = parseWithSchema(workerScanBodySchema, body);

  const scannedAssignment = await withTransaction(async (transaction) => {
    const assignment = await workerApplicationRepository.findAssignmentByIdAndWorker(
      assignmentId,
      account.id,
      transaction
    );

    if (!assignment) {
      throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
    }

    if (assignment.status !== "ACCEPTED") {
      throw new ApiError(409, "ASSIGNMENT_NOT_ACCEPTED", "Assignment is not accepted.");
    }

    const vehicleJob = await workerApplicationRepository.findVehicleJobById(
      assignment.vehicle_job_id,
      transaction
    );

    if (!vehicleJob || vehicleJob.worker_qr_token !== input.qr_token) {
      throw new ApiError(400, "INVALID_WORKER_QR", "Worker QR token is invalid.");
    }

    const scannedAssignment = await workerApplicationRepository.scanAssignment(
      assignment.id,
      transaction
    );
    const scannedCount = await workerApplicationRepository.countScannedAssignments(
      assignment.vehicle_job_id,
      transaction
    );

    if (scannedCount >= vehicleJob.workers_required) {
      await workerApplicationRepository.markVehicleJobInProgress(
        assignment.vehicle_job_id,
        transaction
      );
    }

    return scannedAssignment;
  });

  publishNotification({
    type: "ASSIGNMENT_CHECKED_IN",
    title: "Assignment checked in",
    message: `Worker ${account.full_name} checked in assignment ${scannedAssignment.id}.`,
    payload: {
      assignment_id: scannedAssignment.id,
      vehicle_job_id: scannedAssignment.vehicle_job_id,
      worker_account_id: account.id,
      status: scannedAssignment.status,
      scanned_at: scannedAssignment.scanned_at,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return scannedAssignment;
}

// Function ให้ worker ส่งยอดปิดงานระดับ ticket เพื่อรอ vendor ตรวจผ่าน LINE
export async function completeWorkerTicket(
  ticketIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<TicketCompletionResponse> {
  const account = await requireWorker(auth);
  const ticketId = parseId(ticketIdParam);
  const input = parseWithSchema(workerTicketCompleteBodySchema, body);
  const result = await withTransaction(async (transaction) => {
    const ticket = await workerApplicationRepository.findGateTicketForCompletion(
      ticketId,
      transaction
    );

    if (!ticket) {
      throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
    }

    if (!ticket.vendor_line_id) {
      throw new ApiError(
        409,
        "TICKET_VENDOR_LINE_NOT_CONFIGURED",
        "Ticket vendor LINE id is not configured."
      );
    }

    const ticketWorkers = await workerApplicationRepository.ensureTicketWorkersFromVehicleAssignments(
      ticket.id,
      ticket.vehicle_job_id,
      transaction
    );
    const isTicketWorker = ticketWorkers.some(
      (worker) => worker.worker_account_id === account.id
    );

    if (!isTicketWorker) {
      throw new ApiError(403, "WORKER_NOT_IN_TICKET", "Worker is not assigned to this ticket.");
    }

    const products = await workerApplicationRepository.listTicketProducts(
      ticket.id,
      transaction
    );

    validateTicketCompletionItems(products, input.items);

    const canSubmit = await workerApplicationRepository.markTicketWaitingVendorConfirm(
      ticket.id,
      transaction
    );

    if (!canSubmit) {
      if (ticket.status === "WAITING_VENDOR_CONFIRM") {
        throw new ApiError(
          409,
          "TICKET_ALREADY_SUBMITTED",
          "Ticket completion is already waiting for vendor confirmation."
        );
      }

      if (ticket.status === "CLOSED") {
        throw new ApiError(409, "TICKET_ALREADY_CLOSED", "Ticket is already closed.");
      }

      throw new ApiError(
        409,
        "TICKET_NOT_READY_FOR_COMPLETION",
        "Ticket is not ready for completion submission."
      );
    }

    const submission = await workerApplicationRepository.createTicketCompletionSubmission(
      ticket.id,
      account.id,
      transaction
    );
    const confirmedProducts = await workerApplicationRepository.updateTicketProductConfirmations(
      ticket.id,
      input.items,
      transaction
    );
    const waitingTicket = await workerApplicationRepository.findGateTicketForCompletion(
      ticket.id,
      transaction
    );
    const receiverAccountIds = await buildTicketResultAudience(
      ticket,
      transaction
    );

    return {
      ticket: waitingTicket ?? {
        ...ticket,
        status: "WAITING_VENDOR_CONFIRM",
        confirmation_status: "WAITING_VENDOR_CONFIRM",
      },
      submission,
      products: confirmedProducts,
      receiverAccountIds,
    };
  });
  const detail = await workerApplicationRepository.getVehicleJobDetail(result.ticket.vehicle_job_id);
  const lineLogId = await lineRepository.createMessageDeliveryLog(
    "LINE",
    "send_vendor_ticket_completion",
    {
      ticket_id: result.ticket.id,
      submission_id: result.submission.id,
      vendor_line_id: result.ticket.vendor_line_id,
      items: result.products,
    } as unknown as Prisma.InputJsonValue,
    result.ticket.vendor_line_id
  );

  await enqueueLineMessage("send-vendor-ticket-completion", {
    log_id: lineLogId,
    to: result.ticket.vendor_line_id as string,
    messages: [
      {
        type: "text",
        text: buildVendorCompletionMessage(
          result.ticket,
          result.submission,
          detail,
          result.products
        ),
      },
    ],
  });
  publishRealtimeEvent({
    type: "TICKET_COMPLETION_SUBMITTED",
    title: "Ticket completion submitted",
    message: `Ticket ${result.ticket.ticket_no ?? result.ticket.stall_job_ref} is waiting for vendor confirmation.`,
    payload: {
      ticket_id: result.ticket.id,
      vehicle_job_id: result.ticket.vehicle_job_id,
      status: result.ticket.status,
      confirmation_status: result.ticket.confirmation_status,
      submission_id: result.submission.id,
      submission_status: result.submission.status,
      items: result.products,
    },
    admin: true,
    worker_account_ids: result.receiverAccountIds,
  });

  return {
    message: "Ticket completion submitted and waiting for vendor confirmation.",
    ticket: result.ticket,
    submission: result.submission,
    products: result.products,
  };
}
