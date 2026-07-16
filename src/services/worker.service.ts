// import Library
import type { Prisma } from "@prisma/client";
// import
import { withTransaction } from "../db/prisma";
import { enqueueLineMessage } from "../queues/notification-queue";
import { enqueueWorker, getWorkerBreakCount, getWorkerQueueStatus, incrementWorkerBreakCount, markWorkerBreak, markWorkerOffline, removeAssignmentTimeout, removeWorkerBreakReturn, scheduleWorkerBreakReturn } from "../queues/worker-queue";
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
import type { GateTicketDto, TicketCompletionResponse, TicketCompletionSubmissionDto, TicketProductDto, VehicleJobAssignmentDto, VehicleJobDetailResponse, WorkerAssignmentAcceptResponse, WorkerAssignmentCheckInResponse, WorkerAssignmentHistoryItemDto, WorkerAssignmentHistoryItemResponse, WorkerAssignmentTeamMemberDto, WorkerBreakResponse, WorkerOnlineResponse, WorkerQueueEntryDto, WorkerStatusResponse } from "../types/worker.type";
import type { AccountDto, WorkScheduleDto } from "../types/admin-workers.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { workerAssignmentHistoryQuerySchema, workerScanBodySchema, workerTicketCompleteBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";
import { buildShiftWaitInfo, buildWorkScheduleShiftInstanceKey, formatScheduleWithShift, isTimeInWorkSchedule } from "../utils/shift";
import { buildBangkokDateRange, buildDeadline, formatBangkokDate } from "../utils/time";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { signVendorTicketActionToken } from "../utils/vendor-action-token";
import { buildWorkerQueueSocketPayload } from "../utils/worker-queue-payload";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างข้อมูลเวลาพักที่เหลือสำหรับ response เมื่อ worker อยู่สถานะ break
function buildRemainingBreakTime(
  breakUntil: string | null | undefined
): WorkerStatusResponse["remaining_break_time"] | null {
  if (!breakUntil) {
    return null;
  }

  const breakUntilMs = new Date(breakUntil).getTime();

  if (Number.isNaN(breakUntilMs)) {
    return null;
  }

  const totalSeconds = Math.max(
    0,
    Math.ceil((breakUntilMs - Date.now()) / 1000)
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const textParts = [
    minutes > 0 ? `${minutes} นาที` : null,
    seconds > 0 || minutes === 0 ? `${seconds} วินาที` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    total_seconds: totalSeconds,
    minutes,
    seconds,
    text: textParts.join(" "),
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

// Function สร้าง response หลัง worker online/offline พร้อมสรุปงานและจำนวนพักของวัน/กะ
async function buildWorkerOnlineResponse(
  account: AccountDto,
  queueEntry: WorkerQueueEntryDto,
  schedule: WorkScheduleDto | null,
  connection?: Parameters<typeof workerApplicationRepository.listWorkerAssignmentHistoryByDate>[3]
): Promise<WorkerOnlineResponse> {
  const today = formatBangkokDate();
  const { startAt, endAt } = buildBangkokDateRange(today);
  const shiftInstanceKey = schedule ? buildWorkScheduleShiftInstanceKey(schedule) : null;
  const [assignmentHistory, breakCountUsed] = await Promise.all([
    workerApplicationRepository.listWorkerAssignmentHistoryByDate(
      account.id,
      startAt,
      endAt,
      connection
    ),
    shiftInstanceKey ? getWorkerBreakCount(account.id, shiftInstanceKey) : 0,
  ]);
  const completedJobCount = assignmentHistory.filter(({ assignment }) =>
    assignment.status === "COMPLETED" || Boolean(assignment.completed_at)
  ).length;
  const todayJobCount = assignmentHistory.filter(
    ({ assignment }) => assignment.status !== "TIMEOUT"
  ).length;

  return {
    full_name: account.full_name,
    worker_code: account.username,
    status: queueEntry.status,
    today_job_count: todayJobCount,
    break_count_used: breakCountUsed,
    completed_job_count: completedJobCount,
  };
}

// Function สร้างรายละเอียดงานหลัง worker กดรับ assignment
function buildWorkerAssignmentAcceptResponse(
  detail: VehicleJobDetailResponse,
  team: WorkerAssignmentTeamMemberDto[]
): WorkerAssignmentAcceptResponse {
  return {
    license_plate: detail.vehicle_job.license_plate,
    team,
    markets: detail.markets.map((market) => ({
      market_name: market.market_name,
      stall_count: market.tickets.length,
      stalls: market.tickets.map((ticket) => ({
        stall_job_ref: ticket.stall_job_ref,
        stall_code: ticket.stall_no,
        stall_name: ticket.vendor_name,
        product_count: ticket.products.length,
        products: ticket.products.map((product) => ({
          product_ref: product.product_ref,
          name: product.name,
          quantity: product.quantity,
          unit: product.unit,
        })),
      })),
    })),
  };
}

// Function สร้าง item ประวัติงาน worker โดยซ่อน id ภายในและใช้ reference ที่ UI/API ใช้งาน
function buildWorkerAssignmentHistoryItemResponse(
  item: WorkerAssignmentHistoryItemDto
): WorkerAssignmentHistoryItemResponse {
  return {
    vehicle_job_ref: item.vehicle_job.vehicle_job_ref,
    gate_transaction_ref: item.vehicle_job.gate_transaction_ref,
    license_plate: item.vehicle_job.license_plate,
    status: item.assignment.status,
    accepted_at: item.assignment.accepted_at,
    completed_at: item.assignment.completed_at,
    created_at: item.assignment.created_at,
  };
}

// Function สร้าง payload แจ้ง worker ว่ารับงานสำเร็จแล้ว
function buildAssignmentAcceptedSocketPayload(
  assignment: VehicleJobAssignmentDto,
  detail: VehicleJobDetailResponse,
  workerCode: string | null
) {
  return {
    worker_code: workerCode,
    status: assignment.status,
    vehicle_job_ref: detail.vehicle_job.vehicle_job_ref,
    gate_transaction_ref: detail.vehicle_job.gate_transaction_ref,
    accepted_at: assignment.accepted_at,
    scan_deadline_at: assignment.scan_deadline_at,
  };
}

// Function ตรวจว่า scan deadline หมดอายุแล้วหรือยัง
function isScanDeadlineExpired(scanDeadlineAt: string | null): boolean {
  if (!scanDeadlineAt) {
    return true;
  }

  const deadlineMs = new Date(scanDeadlineAt).getTime();

  return !Number.isFinite(deadlineMs) || deadlineMs <= Date.now();
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

// Function อ่าน reference ของ assignment จาก path param
function parseAssignmentReference(value: unknown): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(
      400,
      "INVALID_ASSIGNMENT_REF",
      "Vehicle job ref is invalid."
    );
  }

  return reference;
}

// Function หา assignment ปัจจุบันของ worker ด้วย vehicle_job_ref ที่ส่งมาจาก API
async function findWorkerAssignmentByReference(
  value: unknown,
  workerAccountId: number,
  connection?: Parameters<typeof workerApplicationRepository.findAssignmentByIdAndWorker>[2]
): Promise<VehicleJobAssignmentDto | null> {
  const reference = parseAssignmentReference(value);

  return workerApplicationRepository.findCurrentAssignmentByVehicleJobRefAndWorker(
    reference,
    workerAccountId,
    connection
  );
}

// Function หา ticket ที่ worker จะส่งยอดปิดงานด้วย stall_job_ref หรือ ticket reference
async function findGateTicketForCompletionByReference(
  value: unknown,
  connection?: Parameters<typeof workerApplicationRepository.findGateTicketForCompletion>[1]
): Promise<GateTicketDto | null> {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(400, "INVALID_TICKET_REF", "Ticket ref is invalid.");
  }

  return workerApplicationRepository.findGateTicketForCompletionByReference(
    reference,
    connection
  );
}

// Function ตรวจ flag สำหรับส่ง LINE postback token กลับใน response ตอน debug
function shouldIncludeDebugLinePostback(): boolean {
  return process.env.LINE_DEBUG_POSTBACK_RESPONSE === "true";
}

// Function สร้าง postback data ที่มี signed token สำหรับ vendor confirm/reject ผ่าน LINE
function buildVendorCompletionPostbackData(
  ticket: GateTicketDto,
  submission: TicketCompletionSubmissionDto
): { confirm: string; reject: string } {
  const confirmToken = signVendorTicketActionToken({
    action: "vendor_confirm_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    stall_job_ref: ticket.stall_job_ref,
  });
  const rejectToken = signVendorTicketActionToken({
    action: "vendor_reject_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    stall_job_ref: ticket.stall_job_ref,
  });

  return {
    confirm: `action=vendor_confirm_completion&token=${confirmToken}`,
    reject: `action=vendor_reject_completion&token=${rejectToken}`,
  };
}

// Function สร้างข้อความ LINE ส่งให้ vendor ตรวจยอดปิดงานของ ticket
function buildVendorCompletionMessage(
  ticket: GateTicketDto,
  postbackData: { confirm: string; reject: string },
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
    `Stall job: ${ticket.stall_job_ref}`,
    `Stall: ${ticket.stall_no ?? "-"}`,
    "Products:",
    ...productLines,
    `Confirm: ${postbackData.confirm}`,
    `Reject: ${postbackData.reject}`,
  ]
    .join("\n");
}

// Function ตรวจรายการสินค้าที่ worker ส่งว่าครบ ตรง ticket และไม่ซ้ำ
function validateTicketCompletionItems(
  products: TicketProductDto[],
  items: Array<{ product_ref: string; confirmed_quantity: number }>
): void {
  const productRefs = new Set(products.map((product) => product.product_ref));
  const itemRefs = new Set<string>();

  for (const item of items) {
    if (!productRefs.has(item.product_ref)) {
      throw new ApiError(
        400,
        "INVALID_TICKET_PRODUCT",
        "Ticket product does not belong to this ticket."
      );
    }

    if (itemRefs.has(item.product_ref)) {
      throw new ApiError(
        400,
        "DUPLICATE_TICKET_PRODUCT",
        "Ticket product is duplicated in completion items."
      );
    }

    itemRefs.add(item.product_ref);
  }

  if (itemRefs.size !== products.length) {
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
export async function workerOnline(auth?: AccessTokenPayload): Promise<WorkerOnlineResponse> {
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

  if (!isTimeInWorkSchedule(currentSchedule)) {
    throw new ApiError(
      403,
      "OUTSIDE_WORK_SHIFT",
      "Worker can go online only during the assigned work shift.",
      buildShiftWaitInfo(currentSchedule)
    );
  }

  return withTransaction(async (transaction) => {
    const currentAssignment = await workerApplicationRepository.findCurrentAssignmentByWorker(
      account.id,
      transaction
    );

    if (currentAssignment) {
      await workerApplicationRepository.closeCompletedVehicleJobIfReady(
        currentAssignment.vehicle_job_id,
        transaction
      );
      const refreshedAssignment = await workerApplicationRepository.findCurrentAssignmentByWorker(
        account.id,
        transaction
      );

      if (refreshedAssignment) {
        throw new ApiError(409, "WORKER_BUSY", "Worker already has an active assignment.");
      }
    }

    const currentQueueEntry = await getWorkerQueueStatus(account.id);

    if (currentQueueEntry?.status === "break") {
      await removeWorkerBreakReturn(account.id, currentSchedule.id);
    }

    await enqueueWorker(account.id);

    await dispatchReadyWorkers(transaction);

    const latestQueueEntry = await getWorkerQueueStatus(account.id);

    if (!latestQueueEntry) {
      throw new ApiError(404, "WORKER_QUEUE_NOT_FOUND", "Worker queue entry not found.");
    }

    const response = await buildWorkerOnlineResponse(
      account,
      latestQueueEntry,
      currentSchedule,
      transaction
    );

    sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
      queue: buildWorkerQueueSocketPayload(
        latestQueueEntry,
        response.worker_code
      ),
    });
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker online",
      message: `Worker ${account.full_name} is ready for work.`,
      payload: {
        worker_code: response.worker_code,
        queue: latestQueueEntry,
        reason: "worker_online",
      },
      audience: {
        roles: ["admin"],
      },
    });

    return response;
  });
}

// Function ให้ worker ออกจาก queue
export async function workerOffline(auth?: AccessTokenPayload): Promise<WorkerOnlineResponse> {
  const account = await requireWorker(auth);
  const [currentSchedule, currentQueueEntry] = await Promise.all([
    workScheduleRepository.findCurrentByAccountId(account.id),
    getWorkerQueueStatus(account.id),
  ]);

  if (currentQueueEntry?.status === "break" && currentSchedule) {
    await removeWorkerBreakReturn(account.id, currentSchedule.id);
  }

  const queueEntry = await markWorkerOffline(account.id);
  const response = await buildWorkerOnlineResponse(
    account,
    queueEntry,
    currentSchedule
  );

  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: buildWorkerQueueSocketPayload(
      queueEntry,
      response.worker_code
    ),
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker offline",
    message: `Worker ${account.full_name} went offline.`,
    payload: {
      worker_code: response.worker_code,
      queue: queueEntry,
      reason: "worker_offline",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return response;
}

// Function ให้ worker พักชั่วคราว 15 นาที และกลับท้ายคิวอัตโนมัติ
export async function workerBreak(auth?: AccessTokenPayload): Promise<WorkerBreakResponse> {
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

  if (!isTimeInWorkSchedule(currentSchedule)) {
    throw new ApiError(
      403,
      "OUTSIDE_WORK_SHIFT",
      "Worker can take a break only during the assigned work shift.",
      buildShiftWaitInfo(currentSchedule)
    );
  }

  const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);
  const [queueEntry, currentAssignment, currentBreakCount] = await Promise.all([
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
    getWorkerBreakCount(account.id, shiftInstanceKey),
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
    shiftInstanceKey
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
  const workerCode = account.username;
  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: buildWorkerQueueSocketPayload(
      breakQueueEntry,
      workerCode
    ),
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker on break",
    message: `Worker ${account.full_name} is on break.`,
    payload: {
      worker_code: workerCode,
      queue: breakQueueEntry,
      reason: "worker_break",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    full_name: account.full_name,
    worker_code: workerCode,
    status: breakQueueEntry.status,
    break_count_used: breakCountUsed,
    break_count_limit: settings.worker_break_limit,
  };
}

// Function ดึงสถานะ queue และ assignment ปัจจุบันของ worker
export async function getWorkerStatus(auth?: AccessTokenPayload): Promise<WorkerStatusResponse> {
  const account = await requireWorker(auth);

  const [profile, currentSchedule, queueEntry] = await Promise.all([
    workerApplicationRepository.profileRepository.findByAccountId(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
    getWorkerQueueStatus(account.id),
  ]);
  const schedule = formatScheduleWithShift(currentSchedule);
  const status = queueEntry?.status ?? "offline";
  const response: WorkerStatusResponse = {
    full_name: account.full_name,
    worker_code: account.username,
    image_url: profile?.image_url ?? null,
    status,
    nationality: profile?.nationality ?? null,
    work_start_date: profile?.work_start_date ?? null,
    phone: account.phone,
    shift: schedule
      ? {
          name: schedule.shift_name,
          start_time: schedule.shift_start_time,
          end_time: schedule.shift_end_time,
        }
      : null,
  };
  const remainingBreakTime = status === "break"
    ? buildRemainingBreakTime(queueEntry?.break_until)
    : null;

  if (status === "break" && queueEntry?.break_until && remainingBreakTime) {
    response.break_until = queueEntry.break_until;
    response.remaining_break_time = remainingBreakTime;
  }

  return response;
}

// Function ดึงประวัติงานของ worker ตามวันที่ที่ระบุ
export async function listWorkerAssignmentHistory(
  query: unknown,
  auth?: AccessTokenPayload
): Promise<{
  date: string;
  data: WorkerAssignmentHistoryItemResponse[];
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
    data: history.map(buildWorkerAssignmentHistoryItemResponse),
  };
}

// Function ให้ worker รับงาน
export async function acceptWorkerAssignment(
  assignmentIdParam: unknown,
  auth?: AccessTokenPayload
): Promise<WorkerAssignmentAcceptResponse> {
  const account = await requireWorker(auth);
  const assignment = await findWorkerAssignmentByReference(assignmentIdParam, account.id);

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
    const vehicleJob = await workerApplicationRepository.findVehicleJobById(
      assignment.vehicle_job_id
    );
    const workerCode = account.username;

    await withTransaction(async (transaction) => {
      await workerApplicationRepository.timeoutAssignment(assignment.id, transaction);
      await enqueueWorker(account.id);
      await dispatchReadyWorkers(transaction);
    });
    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
    });
    publishNotification({
      type: "ASSIGNMENT_TIMEOUT",
      title: "Assignment timed out",
      message: `Worker ${account.full_name} did not accept assignment ${assignment.id} in time.`,
      payload: {
        vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
        worker_code: workerCode,
        status: "TIMEOUT",
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
  const [vehicleJobDetail, team] = await Promise.all([
    workerApplicationRepository.getVehicleJobDetail(acceptedAssignment.vehicle_job_id),
    workerApplicationRepository.listVehicleJobAssignmentTeam(acceptedAssignment.vehicle_job_id),
  ]);

  if (!vehicleJobDetail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  const response = buildWorkerAssignmentAcceptResponse(
    vehicleJobDetail,
    team
  );
  const workerCode = account.username;

  sendWorkerSocketEvent(
    account.id,
    "ASSIGNMENT_ACCEPTED",
    buildAssignmentAcceptedSocketPayload(
      acceptedAssignment,
      vehicleJobDetail,
      workerCode
    )
  );
  publishNotification({
    type: "ASSIGNMENT_ACCEPTED",
    title: "Assignment accepted",
    message: `Worker ${account.full_name} accepted assignment ${acceptedAssignment.id}.`,
    payload: {
      vehicle_job_ref: vehicleJobDetail.vehicle_job.vehicle_job_ref,
      worker_code: workerCode,
      status: acceptedAssignment.status,
      scan_deadline_at: acceptedAssignment.scan_deadline_at,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return response;
}

// Function ให้ worker scan QR เพื่อ check-in เข้างาน
export async function scanWorkerAssignment(
  assignmentIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<WorkerAssignmentCheckInResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerScanBodySchema, body);

  const { scannedAssignment, vehicleJob } = await withTransaction(async (transaction) => {
    const assignment = await findWorkerAssignmentByReference(
      assignmentIdParam,
      account.id,
      transaction
    );

    if (!assignment) {
      throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
    }

    if (assignment.status !== "ACCEPTED") {
      throw new ApiError(409, "ASSIGNMENT_NOT_ACCEPTED", "Assignment is not accepted.");
    }

    if (isScanDeadlineExpired(assignment.scan_deadline_at)) {
      throw new ApiError(409, "QR_EXPIRED", "Worker QR scan time expired.");
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

    return {
      scannedAssignment,
      vehicleJob,
    };
  });
  const workerCode = account.username;

  publishNotification({
    type: "ASSIGNMENT_CHECKED_IN",
    title: "Assignment checked in",
    message: `Worker ${account.full_name} checked in assignment ${scannedAssignment.id}.`,
    payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      worker_code: workerCode,
      status: scannedAssignment.status,
      scanned_at: scannedAssignment.scanned_at,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    status: scannedAssignment.status,
    worker_code: workerCode,
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    worker_qr_token: vehicleJob.worker_qr_token,
  };
}

// Function ให้ worker ส่งยอดปิดงานระดับ ticket เพื่อรอ vendor ตรวจผ่าน LINE
export async function completeWorkerTicket(
  ticketIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<TicketCompletionResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerTicketCompleteBodySchema, body);
  const result = await withTransaction(async (transaction) => {
    const ticket = await findGateTicketForCompletionByReference(
      ticketIdParam,
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

    if (ticket.status === "CLOSED") {
      throw new ApiError(409, "TICKET_ALREADY_CLOSED", "Ticket is already closed.");
    }

    const readiness = await workerApplicationRepository.getVehicleWorkReadiness(
      ticket.vehicle_job_id,
      transaction
    );

    if (!readiness.is_ready) {
      throw new ApiError(
        409,
        "WORKERS_NOT_CHECKED_IN",
        "All assigned workers must check in before this stall job can be completed.",
        readiness
      );
    }

    const currentTicket = await workerApplicationRepository.findCurrentOpenTicketByVehicleJob(
      ticket.vehicle_job_id,
      transaction
    );

    if (!currentTicket || currentTicket.ticket.stall_job_ref !== ticket.stall_job_ref) {
      throw new ApiError(
        409,
        "CURRENT_STALL_NOT_COMPLETED",
        "Current stall job must be completed before moving to the next stall.",
        {
          current_market_job_ref: currentTicket?.market_job_ref ?? null,
          current_stall_job_ref: currentTicket?.ticket.stall_job_ref ?? null,
          requested_stall_job_ref: ticket.stall_job_ref,
        }
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
  const linePostbackData = buildVendorCompletionPostbackData(
    result.ticket,
    result.submission
  );
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
          linePostbackData,
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
      ...buildWorkerTicketPayload(
        result.ticket,
        detail,
        result.products,
        { submission_status: result.submission.status }
      ),
    },
    worker_payload: {
      ...buildWorkerTicketPayload(
        result.ticket,
        detail,
        result.products,
        { submission_status: result.submission.status }
      ),
    },
    admin: true,
    worker_account_ids: result.receiverAccountIds,
  });

  const responsePayload = buildWorkerTicketPayload(
    result.ticket,
    detail,
    result.products,
    { submission_status: result.submission.status }
  ) as Omit<TicketCompletionResponse, "message">;

  return {
    message: "Ticket completion submitted and waiting for vendor confirmation.",
    ...responsePayload,
    ...(shouldIncludeDebugLinePostback()
      ? { debug_line_postback: linePostbackData }
      : {}),
  };
}
