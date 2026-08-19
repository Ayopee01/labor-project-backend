// Import Library
import { Prisma } from "@prisma/client";
// Import Dependencies
import { withTransaction } from "../db/prisma";
import { enqueueLoggedLineMessage } from "../queues/notification-queue";
import {
  enqueueWorker,
  getWorkerBreakCount,
  getWorkerQueueStatus,
  incrementWorkerBreakCount,
  markWorkerBreak,
  markWorkerOpenApp,
  removeAssignmentTimeout,
  removeScanTimeout,
  removeScanWarning,
  removeWorkerBreakReturn,
  scheduleScanTimeout,
  scheduleScanWarning,
  scheduleVendorConfirmationTimeout,
  scheduleWorkerBreakReturn,
} from "../queues/worker-queue";
import {
  dispatchReadyWorkers,
  handleAssignmentAcceptTimeout,
} from "../queues/worker-dispatch";
import {
  isWorkerSocketConnected,
  sendWorkerSocketEvent,
} from "../websockets/worker.socket";
import * as lineRepository from "../repositories/line.repository";
import * as workerApplicationRepository from "../repositories/worker.repository";
import * as accountRepository from "../repositories/shared/account.repository";
import * as workScheduleRepository from "../repositories/shared/work-schedule.repository";
import * as profileRepository from "../repositories/shared/profile.repository";
import * as assignmentRepository from "../repositories/shared/vehicle-job-assignment.repository";
import * as gateTicketRepository from "../repositories/shared/gate-ticket.repository";
import * as ticketWorkerRepository from "../repositories/shared/ticket-worker.repository";
import * as marketJobRepository from "../repositories/shared/market-job.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import * as workerShiftAttendanceRepository from "../repositories/shared/worker-shift-attendance.repository";
import * as vehicleJobLifecycleService from "./shared/vehicle-job-lifecycle.service";
import { publishNotification } from "./notifications.service";
import { resolveTicketResultAudience } from "./shared/realtime-notification.service";
import { publishRealtimeEvent } from "./shared/realtime-notification.service";
import { getRuntimeSettings } from "./shared/runtime-settings.service";
import { publishAdminWorkerStatusChanged } from "./notifications.service";
import {
  buildWorkerDailySummary,
  closeWorkerAttendanceShift,
  markWorkerAttendanceOnline,
  scheduleWorkerShiftEndIfNeeded,
} from "./shared/worker-attendance.service";
// Import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { LineMessage } from "../types/line.type";
import type {
  TicketProductConfirmationInput,
  GateTicketDto,
  TicketCompletionResponse,
  TicketCompletionSubmissionDto,
  TicketProductDto,
  VehicleJobAssignmentDto,
  VehicleJobDetailResponse,
  VehicleWorkReadinessDto,
  WorkerAssignmentAcceptResponse,
  WorkerAssignmentCheckInResponse,
  WorkerAssignmentHistoryItemDto,
  WorkerAssignmentHistoryItemResponse,
  WorkerAssignmentHistoryResponse,
  WorkerAssignmentTeamMemberDto,
  WorkerBreakResponse,
  WorkerCurrentJobResponse,
  WorkerEarningsSummaryResponse,
  WorkerOnlineResponse,
  WorkerQueueEntryDto,
  WorkerStatusResponse,
} from "../types/worker.type";
import {
  WORKER_WORK_STATUS,
  type WorkerWorkStatus,
} from "../types/shared/worker-status.type";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";
import type { DbConnection } from "../types/shared/common.type";
import {
  ASSIGNMENT_STATUS,
  TICKET_STATUS,
  TICKET_WORKER_STATUS,
} from "../constants/job-status";
// Import Validation
import { parseWithSchema } from "../validation/parser";
import {
  workerAssignmentHistoryQuerySchema,
  workerCheckInQrBodySchema,
  workerEarningsSummaryQuerySchema,
  workerTicketCompleteBodySchema,
} from "../validation/schemas";
// Import Utils
import ApiError from "../utils/api-error";
import {
  buildShiftWaitInfo,
  buildWorkScheduleShiftInstanceKey,
  formatScheduleWithShift,
  isTimeInWorkSchedule,
} from "../utils/shift";
import {
  buildBangkokDateRange,
  buildBangkokDateSpanRange,
  buildDeadline,
  buildLatestCompletedBangkokDateRange,
  buildRemainingBreakTime,
  formatBangkokDate,
  formatBangkokDisplayDate,
  formatBangkokDisplayDateTime,
  getDelayUntil,
  toUnixMs,
} from "../utils/time";
import { buildVendorCompletionReviewFlexMessage } from "../utils/line-flex-message";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { buildWorkerQueueSocketPayload } from "../utils/worker-payload";
import { resolveWorkerWorkStatus } from "../utils/worker-status";

/* -------------------------------------- Functions -------------------------------------- */

// Function จัดการ พร้อม break usage ใน service flow
function withBreakUsage(
  queueEntry: WorkerQueueEntryDto,
  breakCountUsed: number,
  breakLimit: number,
): WorkerQueueEntryDto {
  return {
    ...queueEntry,
    break_count_used: breakCountUsed,
    break_count_limit: breakLimit,
  };
}

// Function สร้าง worker queue action response ใน service flow
function buildWorkerQueueActionResponse(
  code: string,
  message: string,
): WorkerOnlineResponse {
  return {
    statusCode: 200,
    code,
    message,
  };
}

// Function สร้าง worker assignment accept response ใน service flow
function buildWorkerAssignmentAcceptResponse(
  detail: VehicleJobDetailResponse,
  team: WorkerAssignmentTeamMemberDto[],
  assignment: VehicleJobAssignmentDto,
  workerCode: string | null,
  shirtNumber: string | null,
): WorkerAssignmentAcceptResponse {
  return {
    ticket_number: detail.vehicle_job.ticket_number,
    worker_code: workerCode,
    shirt_number: shirtNumber,
    accepted_at: assignment.accepted_at,
    license_plate: detail.vehicle_job.license_plate,
    license_plate_province: detail.vehicle_job.license_plate_province,
    scan_deadline_at: assignment.scan_deadline_at,
    scan_deadline_unix_ms: toUnixMs(assignment.scan_deadline_at),
    team: team.map((member) => ({
      full_name: member.full_name,
      worker_code: member.worker_code,
      shirt_number: member.shirt_number ?? null,
      image_url: member.image_url,
      scan_status: member.scan_status,
    })),
    markets: detail.markets.map((market) => ({
      ticket_no: market.ticket_no,
      marketName: market.marketName,
      worker_qr_token: market.worker_qr_token,
      stall_count: market.booths.length,
        stalls: market.booths.map((ticket) => ({
          boothCode: ticket.boothCode,
          boothName: ticket.boothName,
          status: ticket.status,
          confirmation_status: ticket.confirmation_status,
          completed_at: ticket.completed_at,
          product_count: ticket.products.length,
          products: ticket.products.map((product) => ({
          productCode: product.productCode,
          productName: product.productName,
          quantity: product.quantity,
          packageName: product.packageName,
        })),
      })),
    })),
  };
}

// Function สร้าง worker assignment history item response ใน service flow
function buildWorkerAssignmentHistoryItemResponse(
  item: WorkerAssignmentHistoryItemDto,
): WorkerAssignmentHistoryItemResponse {
  return {
    ticket_number: item.vehicle_job.ticket_number,
    ticket_completed_at:
      item.assignment.status === ASSIGNMENT_STATUS.COMPLETED
        ? item.assignment.completed_at ?? item.vehicle_job.updated_at
        : null,
    license_plate: item.vehicle_job.license_plate,
    license_plate_province: item.vehicle_job.license_plate_province,
    status: item.assignment.status,
    markets: item.markets,
  };
}

function buildWorkerCurrentJobResponse(
  detail: VehicleJobDetailResponse,
  team: WorkerAssignmentTeamMemberDto[],
  assignment: VehicleJobAssignmentDto,
  status: WorkerWorkStatus,
  teamScan: VehicleWorkReadinessDto,
): WorkerCurrentJobResponse {
  return {
    ticket_number: detail.vehicle_job.ticket_number,
    license_plate: detail.vehicle_job.license_plate,
    license_plate_province: detail.vehicle_job.license_plate_province,
    scan_deadline_at:
      status === WORKER_WORK_STATUS.ASSIGNED
        ? assignment.scan_deadline_at
        : null,
    scan_deadline_unix_ms:
      status === WORKER_WORK_STATUS.ASSIGNED
        ? toUnixMs(assignment.scan_deadline_at)
        : null,
    vehicle_type: detail.vehicle_job.vehicle_type,
    team_scan: buildWorkerTeamScanResponse(teamScan),
    markets: detail.markets.map((market) => ({
      ticket_no: market.ticket_no,
      marketCode: market.marketCode,
      marketName: market.marketName,
      worker_qr_token: market.worker_qr_token,
      booths: market.booths.map((ticket) => ({
        boothCode: ticket.boothCode,
        boothName: ticket.boothName,
        status: ticket.status,
        confirmation_status: ticket.confirmation_status,
        completed_at: ticket.completed_at,
        products: ticket.products.map((product) => ({
          productCode: product.productCode,
          productName: product.productName,
          packageCode: product.packageCode,
          packageName: product.packageName,
          quantity: product.quantity,
        })),
      })),
    })),
    team: team.map((member) => ({
      shirt_number: member.shirt_number ?? null,
      full_name: member.full_name,
      scan_status: member.scanned_at ? "scanned" : "not_scanned",
      scanned_at: member.scanned_at ?? null,
    })),
  };
}

function buildWorkerTeamScanResponse(readiness: VehicleWorkReadinessDto) {
  return {
    workers_required: readiness.workers_required,
    checked_in_count: readiness.checked_in_count,
    remaining_count: readiness.remaining_count,
    is_ready: readiness.is_ready,
  };
}

function resolveTeamUpdatedWorkerStatus(
  teamScan: VehicleWorkReadinessDto,
): WorkerWorkStatus {
  if (teamScan.is_ready) {
    return WORKER_WORK_STATUS.WORKING;
  }

  if (teamScan.checked_in_count > 0) {
    return WORKER_WORK_STATUS.WAITING_TEAM;
  }

  return WORKER_WORK_STATUS.ASSIGNED;
}

function buildAssignmentTeamUpdatedSocketPayload(
  ticketNumber: string,
  team: WorkerAssignmentTeamMemberDto[],
  teamScan: VehicleWorkReadinessDto,
) {
  return {
    ticketNumber,
    worker_status: resolveTeamUpdatedWorkerStatus(teamScan),
    team_scan: buildWorkerTeamScanResponse(teamScan),
    team: team.map((member) => ({
      worker_code: member.worker_code,
      shirt_number: member.shirt_number ?? null,
      full_name: member.full_name,
      image_url: member.image_url,
      scan_status: member.scan_status,
      accepted_at: member.accepted_at ?? null,
      scanned_at: member.scanned_at ?? null,
    })),
  };
}

function sendAssignmentTeamUpdatedSocketEvents(
  ticketNumber: string,
  team: WorkerAssignmentTeamMemberDto[],
  teamScan: VehicleWorkReadinessDto,
): void {
  const payload = buildAssignmentTeamUpdatedSocketPayload(
    ticketNumber,
    team,
    teamScan,
  );

  for (const workerAccountId of new Set(
    team
      .map((member) => member.worker_account_id)
      .filter((value): value is number => typeof value === "number"),
  )) {
    sendWorkerSocketEvent(
      workerAccountId,
      "ASSIGNMENT_TEAM_UPDATED",
      payload,
      {
        push: false,
      },
    );
  }
}

function toBangkokDateKey(value: Date | string): string {
  return formatBangkokDate(value instanceof Date ? value : new Date(value));
}

// Function สร้าง assignment accepted socket payload ใน service flow
function buildAssignmentAcceptedSocketPayload(
  assignment: VehicleJobAssignmentDto,
  detail: VehicleJobDetailResponse,
  workerCode: string | null,
) {
  return {
    worker_code: workerCode,
    status: assignment.status,
    ticketNumber: detail.vehicle_job.ticket_number,
    accepted_at: assignment.accepted_at,
    scan_deadline_at: assignment.scan_deadline_at,
    scan_deadline_unix_ms: toUnixMs(assignment.scan_deadline_at),
  };
}

// Function ตรวจว่า scan deadline expired ใน service flow
function isScanDeadlineExpired(scanDeadlineAt: string | null): boolean {
  if (!scanDeadlineAt) {
    return true;
  }

  const deadlineMs = new Date(scanDeadlineAt).getTime();

  return !Number.isFinite(deadlineMs) || deadlineMs <= Date.now();
}

// Function เลือก timeout การยืนยัน vendor ตาม flow ส่งครั้งแรกหรือส่งใหม่หลัง reject
function getVendorConfirmationTimeoutMs(
  ticket: GateTicketDto,
  settings: Awaited<ReturnType<typeof getRuntimeSettings>>,
): number {
  const timeoutHours =
    ticket.status === TICKET_STATUS.REJECT
      ? settings.vendor_reconfirm_timeout_hours
      : settings.vendor_confirm_timeout_hours;

  return timeoutHours * 60 * 60 * 1000;
}

// Function ตรวจสอบว่า auth payload ปัจจุบันเป็นบัญชี worker ที่ active
async function requireWorker(auth?: AccessTokenPayload) {
  if (!auth) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }

  if (auth.role !== "worker") {
    throw new ApiError(403, "FORBIDDEN", "Worker account is required.");
  }

  const account = await accountRepository.findUserById(auth.account_id);

  if (!account || account.status !== "active") {
    throw new ApiError(
      403,
      "WORKER_NOT_ACTIVE",
      "Worker account is not active.",
    );
  }

  return account;
}

// Function อ่านค่า assignment reference ใน service flow
function parseAssignmentReference(value: unknown): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(
      400,
      "INVALID_ASSIGNMENT_REF",
      "Vehicle job ref is invalid.",
    );
  }

  return reference;
}

// Function ค้นหา worker assignment ตาม reference ใน service flow
async function findWorkerAssignmentByReference(
  value: unknown,
  workerAccountId: number,
  connection?: Parameters<
    typeof assignmentRepository.findAssignmentByIdAndWorker
  >[2],
): Promise<VehicleJobAssignmentDto | null> {
  const reference = parseAssignmentReference(value);

  return assignmentRepository.findCurrentAssignmentByVehicleJobRefAndWorker(
    reference,
    workerAccountId,
    connection,
  );
}

// Function ค้นหา Gate ticket สำหรับ completion ตาม TicketNumber และ booth ใน service flow
async function findGateTicketForCompletionByTicketAndBooth(
  ticketNumberParam: unknown,
  boothCodeParam: unknown,
  connection?: Parameters<
    typeof gateTicketRepository.findGateTicketForCompletion
  >[1],
): Promise<GateTicketDto | null> {
  const ticketNumber = String(ticketNumberParam ?? "").trim();
  const boothCode = String(boothCodeParam ?? "").trim();

  if (!ticketNumber) {
    throw new ApiError(400, "INVALID_TICKET_NUMBER", "TicketNumber is invalid.");
  }

  if (!boothCode) {
    throw new ApiError(400, "INVALID_BOOTH_CODE", "BoothCode is invalid.");
  }

  return gateTicketRepository.findGateTicketForCompletionByTicketNumberAndBoothCode(
    ticketNumber,
    boothCode,
    connection,
  );
}

// Function สร้าง vendor completion postback data ใน service flow
async function buildVendorCompletionPostbackData(
  ticket: GateTicketDto,
  submission: TicketCompletionSubmissionDto,
): Promise<{ confirm: string; reject: string }> {
  const confirmToken = await lineRepository.createLineActionToken({
    action: "vendor_confirm_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    boothCode: ticket.boothCode,
  });
  const rejectToken = await lineRepository.createLineActionToken({
    action: "vendor_reject_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    boothCode: ticket.boothCode,
  });

  return {
    confirm: `token=${confirmToken.token}`,
    reject: `token=${rejectToken.token}`,
  };
}

// Function สร้าง vendor completion messages ใน service flow
function buildVendorCompletionMessages(
  ticket: GateTicketDto,
  postbackData: { confirm: string; reject: string },
  detail: VehicleJobDetailResponse | null,
  products: TicketProductDto[],
): LineMessage[] {
  return [
    buildVendorCompletionReviewFlexMessage({
      ticket,
      postbackData,
      detail,
      products,
    }),
  ];
}

// Function สร้าง key สำหรับระบุสินค้าแต่ละ package ภายใน ticket
function buildTicketProductKey(
  productCode: string,
  packageCode: string,
): string {
  return JSON.stringify([productCode, packageCode]);
}

// Function ตรวจสอบ ticket completion items ใน service flow
function validateTicketCompletionItems(
  products: TicketProductDto[],
  items: TicketProductConfirmationInput[],
): void {
  const productKeys = new Set(
    products.map((product) =>
      buildTicketProductKey(product.productCode, product.packageCode),
    ),
  );

  const itemKeys = new Set<string>();

  for (const item of items) {
    const itemKey = buildTicketProductKey(item.productCode, item.packageCode);

    if (!productKeys.has(itemKey)) {
      throw new ApiError(
        400,
        "INVALID_TICKET_PRODUCT",
        "Ticket product and package do not belong to this ticket.",
      );
    }

    if (itemKeys.has(itemKey)) {
      throw new ApiError(
        400,
        "DUPLICATE_TICKET_PRODUCT",
        "Ticket product and package are duplicated in completion items.",
      );
    }

    itemKeys.add(itemKey);
  }

  if (itemKeys.size !== products.length) {
    throw new ApiError(
      400,
      "INCOMPLETE_TICKET_PRODUCTS",
      "All ticket products must be sent with confirmed quantities.",
    );
  }
}

// Function จัดการ worker online ใน service flow
export async function workerOnline(
  auth?: AccessTokenPayload,
): Promise<WorkerOnlineResponse> {
  const account = await requireWorker(auth);

  if (!isWorkerSocketConnected(account.id)) {
    throw new ApiError(
      409,
      "WORKER_SOCKET_NOT_CONNECTED",
      "Worker WebSocket must be connected before going online.",
    );
  }

  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
    account.id,
  );

  if (!currentSchedule) {
    throw new ApiError(
      403,
      "WORK_SCHEDULE_NOT_FOUND",
      "Worker does not have a current work schedule.",
    );
  }

  if (!isTimeInWorkSchedule(currentSchedule)) {
    throw new ApiError(
      403,
      "OUTSIDE_WORK_SHIFT",
      "Worker can go online only during the assigned work shift.",
      buildShiftWaitInfo(currentSchedule),
    );
  }
  const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);

  return withTransaction(async (transaction) => {
    const currentAssignment =
      await assignmentRepository.findCurrentAssignmentByWorker(
        account.id,
        transaction,
      );

    if (currentAssignment) {
      await vehicleJobLifecycleService.closeCompletedVehicleJobIfReady(
        currentAssignment.vehicle_job_id,
        transaction,
      );
      const refreshedAssignment =
        await assignmentRepository.findCurrentAssignmentByWorker(
          account.id,
          transaction,
        );

      if (refreshedAssignment) {
        throw new ApiError(
          409,
          "WORKER_HAS_ACTIVE_ASSIGNMENT",
          "Worker already has an active assignment.",
        );
      }
    }

    const currentQueueEntry = await getWorkerQueueStatus(account.id);
    const isReturningFromBreak =
      currentQueueEntry?.status === WORKER_WORK_STATUS.BREAK;
    const attendance =
      await workerShiftAttendanceRepository.findByWorkerAndShift(
        {
          account_id: account.id,
          shift_instance_key: shiftInstanceKey,
        },
        transaction,
      );

    if (isReturningFromBreak) {
      await removeWorkerBreakReturn(account.id, currentSchedule.id);
    } else {
      if (attendance?.closedAt) {
        throw new ApiError(
          409,
          "WORKER_SHIFT_CLOSED",
          "Worker already ended this shift and cannot go online again.",
        );
      }

      if (
        attendance?.firstOnlineAt &&
        currentQueueEntry?.status !== WORKER_WORK_STATUS.READY
      ) {
        throw new ApiError(
          409,
          "WORKER_SHIFT_ONLINE_ALREADY_USED",
          "Worker can go online from open_app only once in this shift.",
        );
      }
    }
    await markWorkerAttendanceOnline(
      account,
      currentSchedule,
      shiftInstanceKey,
      transaction,
    );
    await scheduleWorkerShiftEndIfNeeded(account.id, currentSchedule);

    if (currentQueueEntry?.status !== WORKER_WORK_STATUS.READY) {
      await enqueueWorker(account.id);
    }

    await dispatchReadyWorkers(transaction);

    const latestQueueEntry = await getWorkerQueueStatus(account.id);
    const latestAssignment =
      await assignmentRepository.findCurrentAssignmentByWorker(
        account.id,
        transaction,
      );

    if (!latestQueueEntry) {
      throw new ApiError(
        404,
        "WORKER_QUEUE_NOT_FOUND",
        "Worker queue entry not found.",
      );
    }

    const workerCode = account.username;
    const response = buildWorkerQueueActionResponse(
      "WORKER_ONLINE_SUCCESS",
      "Worker entered queue successfully.",
    );

    sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
      queue: buildWorkerQueueSocketPayload(
        latestQueueEntry,
        workerCode,
        latestAssignment,
      ),
    });
    publishAdminWorkerStatusChanged({
      title: "Worker online",
      message: `Worker ${account.full_name} is ready for work.`,
      workerCode,
      queue: latestQueueEntry,
      assignment: latestAssignment,
      reason: "worker_online",
    });

    return response;
  });
}

// Function จัดการ worker offline ใน service flow
export async function workerOffline(
  auth?: AccessTokenPayload,
): Promise<WorkerOnlineResponse> {
  const account = await requireWorker(auth);
  const [currentSchedule, currentQueueEntry, currentAssignment] =
    await Promise.all([
      workScheduleRepository.findCurrentByAccountId(account.id),
      getWorkerQueueStatus(account.id),
      assignmentRepository.findCurrentAssignmentByWorker(account.id),
    ]);

  if (
    currentQueueEntry?.status === WORKER_WORK_STATUS.BREAK &&
    currentSchedule
  ) {
    await removeWorkerBreakReturn(account.id, currentSchedule.id);
  }

  if (currentSchedule) {
    const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);

    await closeWorkerAttendanceShift(
      account,
      currentSchedule,
      shiftInstanceKey,
      "worker_offline",
    );
  }

  const queueEntry = await markWorkerOpenApp(account.id);
  const workerCode = account.username;
  const response = buildWorkerQueueActionResponse(
    "WORKER_OFFLINE_SUCCESS",
    "Worker left queue successfully.",
  );

  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: buildWorkerQueueSocketPayload(
      queueEntry,
      workerCode,
      currentAssignment,
    ),
  });
  publishAdminWorkerStatusChanged({
    title: "Worker moved to open_app",
    message: `Worker ${account.full_name} moved to open_app.`,
    workerCode,
    queue: queueEntry,
    assignment: currentAssignment,
    reason: "worker_open_app",
  });

  return response;
}

// Function จัดการ worker break ใน service flow
export async function workerBreak(
  auth?: AccessTokenPayload,
): Promise<WorkerBreakResponse> {
  const account = await requireWorker(auth);
  const settings = await getRuntimeSettings();
  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
    account.id,
  );

  if (!currentSchedule) {
    throw new ApiError(
      403,
      "WORK_SCHEDULE_NOT_FOUND",
      "Worker does not have a current work schedule.",
    );
  }

  if (!isTimeInWorkSchedule(currentSchedule)) {
    throw new ApiError(
      403,
      "OUTSIDE_WORK_SHIFT",
      "Worker can take a break only during the assigned work shift.",
      buildShiftWaitInfo(currentSchedule),
    );
  }

  const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);
  const [queueEntry, currentAssignment, currentBreakCount] = await Promise.all([
    getWorkerQueueStatus(account.id),
    assignmentRepository.findCurrentAssignmentByWorker(account.id),
    getWorkerBreakCount(account.id, shiftInstanceKey),
  ]);

  if (currentAssignment) {
    throw new ApiError(
      409,
      "WORKER_HAS_ACTIVE_ASSIGNMENT",
      "Worker already has an active assignment.",
    );
  }

  if (!queueEntry || queueEntry.status !== WORKER_WORK_STATUS.READY) {
    throw new ApiError(
      409,
      "WORKER_NOT_READY",
      "Worker can take a break only while ready in queue.",
    );
  }

  if (currentBreakCount >= settings.worker_break_limit) {
    throw new ApiError(
      409,
      "BREAK_LIMIT_REACHED",
      "Worker break limit reached for this shift.",
    );
  }

  const breakCountUsed = await incrementWorkerBreakCount(
    account.id,
    shiftInstanceKey,
  );
  const breakDurationMs = settings.worker_break_duration_minutes * 60 * 1000;
  const breakUntil = buildDeadline(breakDurationMs);
  const breakEntry = await markWorkerBreak(account.id, breakUntil);

  await scheduleWorkerBreakReturn(
    account.id,
    currentSchedule.id,
    breakDurationMs,
  );
  await scheduleWorkerShiftEndIfNeeded(account.id, currentSchedule);

  const breakQueueEntry = withBreakUsage(
    breakEntry,
    breakCountUsed,
    settings.worker_break_limit,
  );
  const workerCode = account.username;
  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: buildWorkerQueueSocketPayload(breakQueueEntry, workerCode),
  });
  publishAdminWorkerStatusChanged({
    title: "Worker on break",
    message: `Worker ${account.full_name} is on break.`,
    workerCode,
    queue: breakQueueEntry,
    reason: "worker_break",
  });

  return {
    full_name: account.full_name,
    worker_code: workerCode,
    status: resolveWorkerWorkStatus(breakQueueEntry, null),
    break_count_used: breakCountUsed,
    break_count_limit: settings.worker_break_limit,
  };
}

// Function ดึง worker status ใน service flow
export async function getWorkerStatus(
  auth?: AccessTokenPayload,
): Promise<WorkerStatusResponse> {
  const account = await requireWorker(auth);

  const [profile, currentSchedule, queueEntry, currentAssignment] =
    await Promise.all([
      profileRepository.findByAccountId(account.id),
      workScheduleRepository.findCurrentByAccountId(account.id),
      getWorkerQueueStatus(account.id),
      assignmentRepository.findCurrentAssignmentByWorker(account.id),
    ]);
  const schedule = formatScheduleWithShift(currentSchedule);
  let status = resolveWorkerWorkStatus(queueEntry, currentAssignment);
  const dailySummary = await buildWorkerDailySummary(
    account.id,
    currentSchedule,
  );
  const response: WorkerStatusResponse = {
    full_name: account.full_name,
    worker_code: account.username,
    image_url: profile?.image_url ?? null,
    status,
    ...dailySummary,
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
  const remainingBreakTime =
    status === WORKER_WORK_STATUS.BREAK
      ? buildRemainingBreakTime(queueEntry?.break_until)
      : null;

  if (
    status === WORKER_WORK_STATUS.BREAK &&
    queueEntry?.break_until &&
    remainingBreakTime
  ) {
    response.break_until = queueEntry.break_until;
    response.break_until_unix_ms = toUnixMs(queueEntry.break_until);
    response.remaining_break_time = remainingBreakTime;
  }

  if (
    currentAssignment &&
    (status === WORKER_WORK_STATUS.ASSIGNED ||
      status === WORKER_WORK_STATUS.WAITING_TEAM ||
      status === WORKER_WORK_STATUS.WORKING)
  ) {
    const [detail, team, teamScan] = await Promise.all([
      vehicleJobRepository.getVehicleJobDetail(
        currentAssignment.vehicle_job_id,
      ),
      assignmentRepository.listVehicleJobAssignmentTeam(
        currentAssignment.vehicle_job_id,
      ),
      assignmentRepository.getVehicleJobTeamScanReadiness(
        currentAssignment.vehicle_job_id,
      ),
    ]);
    status = resolveWorkerWorkStatus(queueEntry, currentAssignment, teamScan);
    response.status = status;

    if (detail) {
      response.current_job = buildWorkerCurrentJobResponse(
        detail,
        team,
        currentAssignment,
        status,
        teamScan,
      );
    }
  }

  return response;
}

// Function ดึงรายการ worker assignment history ใน service flow
export async function listWorkerAssignmentHistory(
  query: unknown,
  auth?: AccessTokenPayload,
): Promise<WorkerAssignmentHistoryResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerAssignmentHistoryQuerySchema, query);
  const selectedDate = input.date ?? (
    !input.date_from && !input.date_to ? formatBangkokDate() : undefined
  );
  const range =
    selectedDate
      ? buildBangkokDateRange(selectedDate)
      : buildBangkokDateSpanRange(input.date_from, input.date_to);

  if (!range.startAt || !range.endAt) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Invalid assignment history date range.",
    );
  }

  const history =
    await workerApplicationRepository.listWorkerAssignmentHistoryByDate(
      account.id,
      range.startAt,
      range.endAt,
    );
  const usesPagination = input.page !== undefined || input.limit !== undefined;
  const page = input.page ?? 1;
  const limit = input.limit ?? 20;
  const offset = (page - 1) * limit;
  const pagedHistory = usesPagination
    ? history.slice(offset, offset + limit)
    : history;

  const response: WorkerAssignmentHistoryResponse = {
    date: selectedDate ?? input.date_from ?? "",
    summary: {
      job_count: history.length,
      accept_timeout_job_count: history.filter(
        (item) =>
          item.assignment.status === ASSIGNMENT_STATUS.TIMEOUT &&
          item.assignment.accepted_at === null,
      ).length,
      completed_job_count: history.filter(
        (item) => item.assignment.status === ASSIGNMENT_STATUS.COMPLETED,
      ).length,
    },
    data: pagedHistory.map(buildWorkerAssignmentHistoryItemResponse),
  };

  if (usesPagination) {
    response.pagination = {
      page,
      limit,
      total: history.length,
      total_pages: Math.ceil(history.length / limit),
    };
  }

  return response;
}

export async function getWorkerEarningsSummary(
  query: unknown,
  auth?: AccessTokenPayload,
): Promise<WorkerEarningsSummaryResponse> {
  const account = await requireWorker(auth);
  parseWithSchema(workerEarningsSummaryQuerySchema, query);

  const dayCount = 15;
  const { startAt, endAt, dates } =
    buildLatestCompletedBangkokDateRange(dayCount);
  const rows = await workerApplicationRepository.listWorkerEarningsSummaryRows(
    account.id,
    startAt,
    endAt,
  );
  const dailyEarnings = new Map(
    dates.map((date) => [date, new Prisma.Decimal(0)]),
  );
  let totalEarnings = new Prisma.Decimal(0);

  const details = rows.map((row) => {
    const earnings = new Prisma.Decimal(row.earnings);
    const dateKey = toBangkokDateKey(row.completed_at);

    totalEarnings = totalEarnings.plus(earnings);
    dailyEarnings.set(
      dateKey,
      (dailyEarnings.get(dateKey) ?? new Prisma.Decimal(0)).plus(earnings),
    );

    return {
      ...row,
      completed_at: formatBangkokDisplayDateTime(row.completed_at),
      earnings: earnings.toFixed(2),
    };
  });

  return {
    period: {
      from_date: formatBangkokDisplayDate(startAt),
      to_date: formatBangkokDisplayDate(new Date(endAt.getTime() - 1)),
      day_count: dayCount,
    },
    total_earnings: totalEarnings.toFixed(2),
    daily: dates.map((date) => ({
      date: formatBangkokDisplayDate(new Date(`${date}T00:00:00.000+07:00`)),
      earnings: (dailyEarnings.get(date) ?? new Prisma.Decimal(0)).toFixed(2),
    })),
    details,
  };
}

// Function รับ worker assignment ใน service flow
export async function acceptWorkerAssignment(
  assignmentIdParam: unknown,
  auth?: AccessTokenPayload,
): Promise<WorkerAssignmentAcceptResponse> {
  const account = await requireWorker(auth);
  const assignment = await findWorkerAssignmentByReference(
    assignmentIdParam,
    account.id,
  );

  if (!assignment) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
  }

  if (assignment.status !== ASSIGNMENT_STATUS.PENDING) {
    throw new ApiError(
      409,
      "ASSIGNMENT_NOT_PENDING",
      "Assignment is not pending.",
    );
  }

  if (
    assignment.accept_deadline_at &&
    new Date(assignment.accept_deadline_at).getTime() <= Date.now()
  ) {
    const vehicleJob = await vehicleJobRepository.findVehicleJobById(
      assignment.vehicle_job_id,
    );
    const workerCode = account.username;
    const timeoutResult = await withTransaction(async (transaction) =>
      handleAssignmentAcceptTimeout({
        assignment,
        workerAccountId: account.id,
        connection: transaction,
      }),
    );

    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      ticketNumber: vehicleJob?.ticket_number ?? null,
      reason: timeoutResult.reason,
      timeout_count: timeoutResult.timeout_count,
      timeout_limit: timeoutResult.timeout_limit,
    });
    publishNotification({
      type: "ASSIGNMENT_TIMEOUT",
      title: "Assignment timed out",
      message: `Worker ${account.full_name} did not accept assignment ${assignment.id} in time.`,
      payload: {
        ticketNumber: vehicleJob?.ticket_number ?? null,
        worker_code: workerCode,
        status: ASSIGNMENT_STATUS.TIMEOUT,
        queue: buildWorkerQueueSocketPayload(timeoutResult.queue, workerCode),
        reason: timeoutResult.reason,
        timeout_count: timeoutResult.timeout_count,
        timeout_limit: timeoutResult.timeout_limit,
      },
      audience: {
        roles: ["admin"],
      },
    });

    throw new ApiError(
      409,
      "ASSIGNMENT_TIMEOUT",
      "Assignment acceptance time expired.",
    );
  }

  await removeAssignmentTimeout(assignment.id);
  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
    account.id,
  );

  if (currentSchedule) {
    const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);

    await workerShiftAttendanceRepository.resetAcceptTimeoutStreak({
      account_id: account.id,
      worker_code: account.username,
      schedule: currentSchedule,
      shift_instance_key: shiftInstanceKey,
    });
  }
  const settings = await getRuntimeSettings();

  const acceptedAssignment = await assignmentRepository.acceptAssignment(
    assignment.id,
    buildDeadline(settings.worker_scan_deadline_minutes * 60 * 1000),
  );
  await scheduleScanTimeout(
    acceptedAssignment.id,
    acceptedAssignment.worker_account_id,
    getDelayUntil(acceptedAssignment.scan_deadline_at),
  );
  await scheduleScanWarning(
    acceptedAssignment.id,
    acceptedAssignment.worker_account_id,
    acceptedAssignment.scan_deadline_at,
  );
  const [vehicleJobDetail, team, teamScan] = await Promise.all([
    vehicleJobRepository.getVehicleJobDetail(acceptedAssignment.vehicle_job_id),
    assignmentRepository.listVehicleJobAssignmentTeam(
      acceptedAssignment.vehicle_job_id,
    ),
    assignmentRepository.getVehicleJobTeamScanReadiness(
      acceptedAssignment.vehicle_job_id,
    ),
  ]);

  if (!vehicleJobDetail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  const response = buildWorkerAssignmentAcceptResponse(
    vehicleJobDetail,
    team,
    acceptedAssignment,
    account.username,
    account.shirt_number,
  );
  const workerCode = account.username;

  sendWorkerSocketEvent(
    account.id,
    "ASSIGNMENT_ACCEPTED",
    buildAssignmentAcceptedSocketPayload(
      acceptedAssignment,
      vehicleJobDetail,
      workerCode,
    ),
  );
  sendAssignmentTeamUpdatedSocketEvents(
    vehicleJobDetail.vehicle_job.ticket_number,
    team,
    teamScan,
  );
  publishNotification({
    type: "ASSIGNMENT_ACCEPTED",
    title: "Assignment accepted",
    message: `Worker ${account.full_name} accepted assignment ${acceptedAssignment.id}.`,
    payload: {
      ticketNumber: vehicleJobDetail.vehicle_job.ticket_number,
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

// Function บันทึกการสแกน worker assignment ใน service flow
export async function scanWorkerAssignment(
  ticketNumberParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<WorkerAssignmentCheckInResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerCheckInQrBodySchema, body);
  const settings = await getRuntimeSettings();
  const teamScanRemainingMinutes = settings.worker_scan_team_remaining_minutes;

  const result = await withTransaction(async (transaction) => {
    const assignment = await findWorkerAssignmentByReference(
      ticketNumberParam,
      account.id,
      transaction,
    );

    if (!assignment) {
      throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
    }

    if (assignment.status !== ASSIGNMENT_STATUS.ACCEPTED) {
      throw new ApiError(
        409,
        "ASSIGNMENT_NOT_ACCEPTED",
        "Assignment is not accepted.",
      );
    }

    if (isScanDeadlineExpired(assignment.scan_deadline_at)) {
      const vehicleJob = await vehicleJobRepository.findVehicleJobById(
        assignment.vehicle_job_id,
        transaction,
      );
      const timedOutAssignment = await assignmentRepository.timeoutAssignment(
        assignment.id,
        WORKER_ASSIGNMENT_EVENT_TYPE.SCAN_TIMEOUT,
        transaction,
      );
      const teamScan = await assignmentRepository.getVehicleJobTeamScanReadiness(
        assignment.vehicle_job_id,
        transaction,
      );

      if (teamScan.is_ready) {
        await vehicleJobLifecycleService.markVehicleJobInProgress(
          assignment.vehicle_job_id,
          transaction,
        );
      }

      return {
        kind: "expired" as const,
        timedOutAssignment,
        vehicleJob,
      };
    }

    // Resolve QR -> Business Ticket (MarketJob) จาก DB จริง ห้ามเชื่อค่าที่ Client อ้างมาตรงๆ
    // แล้วตรวจว่า Ticket ที่สแกนอยู่ภายใต้ TicketNumber เดียวกับ Assignment ของ worker คนนี้
    // (worker scan Ticket ใบไหนในรถของตัวเองก็ได้ ไม่ต้อง scan ครบทุกใบ)
    const scannedMarketJob = await marketJobRepository.findMarketJobByWorkerQrToken(
      input.worker_qr_token,
      transaction,
    );

    if (!scannedMarketJob) {
      throw new ApiError(
        400,
        "INVALID_WORKER_QR",
        "Worker QR token is invalid.",
      );
    }

    if (scannedMarketJob.vehicle_job_id !== assignment.vehicle_job_id) {
      throw new ApiError(
        409,
        "QR_TICKET_NUMBER_MISMATCH",
        "Scanned ticket does not belong to this worker's vehicle job.",
      );
    }

    const vehicleJob = await vehicleJobRepository.findVehicleJobById(
      assignment.vehicle_job_id,
      transaction,
    );

    if (!vehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    const scannedAssignment = await assignmentRepository.scanAssignment(
      assignment.id,
      transaction,
    );
    const scannedCount = await assignmentRepository.countScannedAssignments(
      assignment.vehicle_job_id,
      transaction,
    );

    const teamScan = await assignmentRepository.getVehicleJobTeamScanReadiness(
      assignment.vehicle_job_id,
      transaction,
    );

    if (teamScan.is_ready) {
      await vehicleJobLifecycleService.markVehicleJobInProgress(
        assignment.vehicle_job_id,
        transaction,
      );
    }

    const shortenedAssignments: VehicleJobAssignmentDto[] = [];

    if (vehicleJob.workers_required > 1 && scannedCount === 1) {
      const remainingAssignments =
        await assignmentRepository.listAcceptedAssignmentsByVehicleJob(
          assignment.vehicle_job_id,
          assignment.id,
          transaction,
        );
      const teamScanDeadline = buildDeadline(
        teamScanRemainingMinutes * 60 * 1000,
      );

      for (const remainingAssignment of remainingAssignments) {
        shortenedAssignments.push(
          await assignmentRepository.updateAssignmentScanDeadline(
            remainingAssignment.id,
            teamScanDeadline,
            transaction,
          ),
        );
      }
    }

    return {
      kind: "scanned" as const,
      scannedAssignment,
      vehicleJob,
      shortenedAssignments,
      teamScan,
    };
  });

  if (result.kind === "expired") {
    await removeScanTimeout(result.timedOutAssignment.id);
    await removeScanWarning(result.timedOutAssignment.id);
    const queue = await markWorkerOpenApp(account.id);
    await dispatchReadyWorkers();
    const workerCode = account.username;

    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      ticketNumber: result.vehicleJob?.ticket_number ?? null,
      reason: "scan_timeout",
      status: WORKER_WORK_STATUS.OPEN_APP,
    });
    publishNotification({
      type: "ASSIGNMENT_TIMEOUT",
      title: "Assignment scan timed out",
      message: `Worker ${account.full_name} did not scan QR in time.`,
      payload: {
        ticketNumber: result.vehicleJob?.ticket_number ?? null,
        worker_code: workerCode,
        status: result.timedOutAssignment.status,
        reason: "scan_timeout",
        queue: buildWorkerQueueSocketPayload(queue, workerCode),
      },
      audience: {
        roles: ["admin"],
      },
    });

    throw new ApiError(409, "QR_EXPIRED", "Worker QR scan time expired.");
  }

  const { scannedAssignment, vehicleJob, shortenedAssignments, teamScan } = result;
  await removeScanTimeout(scannedAssignment.id);
  await removeScanWarning(scannedAssignment.id);
  await Promise.all(
    shortenedAssignments.flatMap((assignment) => [
      scheduleScanTimeout(
        assignment.id,
        assignment.worker_account_id,
        getDelayUntil(assignment.scan_deadline_at),
      ),
      scheduleScanWarning(
        assignment.id,
        assignment.worker_account_id,
        assignment.scan_deadline_at,
      ),
    ]),
  );
  const workerCode = account.username;

  if (shortenedAssignments.length > 0) {
    const [firstShortenedAssignment] = shortenedAssignments;

    publishRealtimeEvent({
      type: "ASSIGNMENT_SCAN_DEADLINE_SHORTENED",
      title: "Scan deadline shortened",
      message: `Remaining workers must scan QR within ${teamScanRemainingMinutes} minutes for vehicle job ${vehicleJob.ticket_number}.`,
      payload: {
        ticketNumber: vehicleJob.ticket_number,
        remaining_minutes: teamScanRemainingMinutes,
        scan_deadline_at: firstShortenedAssignment.scan_deadline_at,
        scan_deadline_unix_ms: toUnixMs(firstShortenedAssignment.scan_deadline_at),
        assignment_count: shortenedAssignments.length,
      },
      worker_payload: {
        ticketNumber: vehicleJob.ticket_number,
        remaining_minutes: teamScanRemainingMinutes,
        scan_deadline_at: firstShortenedAssignment.scan_deadline_at,
        scan_deadline_unix_ms: toUnixMs(firstShortenedAssignment.scan_deadline_at),
      },
      admin: true,
      worker_account_ids: shortenedAssignments.map(
        (assignment) => assignment.worker_account_id,
      ),
    });
  }
  const team = await assignmentRepository.listVehicleJobAssignmentTeam(
    scannedAssignment.vehicle_job_id,
  );

  sendAssignmentTeamUpdatedSocketEvents(vehicleJob.ticket_number, team, teamScan);

  publishNotification({
    type: "ASSIGNMENT_CHECKED_IN",
    title: "Assignment checked in",
    message: `Worker ${account.full_name} checked in assignment ${scannedAssignment.id}.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
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
    worker_status: resolveWorkerWorkStatus(null, scannedAssignment, teamScan),
    worker_code: workerCode,
    ticket_number: vehicleJob.ticket_number,
    team_scan: buildWorkerTeamScanResponse(teamScan),
  };
}

// Function จบงาน worker assignment ticket ใน service flow
async function completeWorkerAssignmentTicket(
  ticketNumberParam: unknown,
  boothCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<TicketCompletionResponse> {
  return completeResolvedWorkerTicket(
    (connection) =>
      findGateTicketForCompletionByTicketAndBooth(
        ticketNumberParam,
        boothCodeParam,
        connection,
      ),
    body,
    auth,
  );
}

export async function completeWorkerAssignmentTicketFromBody(
  ticketNumberParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<TicketCompletionResponse> {
  const boothCode = (body as { boothCode?: unknown } | null)?.boothCode;

  return completeWorkerAssignmentTicket(ticketNumberParam, boothCode, body, auth);
}

// Function จบงาน resolved worker ticket ใน service flow
async function completeResolvedWorkerTicket(
  findTicket: (connection: DbConnection) => Promise<GateTicketDto | null>,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<TicketCompletionResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerTicketCompleteBodySchema, body);
  const settings = await getRuntimeSettings();
  const result = await withTransaction(async (transaction) => {
    const ticket = await findTicket(transaction);

    if (!ticket) {
      throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
    }

    const vendorLineTargets =
      await gateTicketRepository.listActiveVendorLineTargetsForTicket(
        ticket.id,
        transaction,
      );

    if (vendorLineTargets.length === 0) {
      throw new ApiError(
        409,
        "TICKET_VENDOR_LINE_NOT_CONFIGURED",
        "Ticket vendor LINE targets are not configured.",
      );
    }

    if (ticket.status === TICKET_STATUS.COMPLETED) {
      throw new ApiError(
        409,
        "TICKET_ALREADY_CLOSED",
        "Ticket is already closed.",
      );
    }

    const readiness = await vehicleJobRepository.getVehicleWorkReadiness(
      ticket.vehicle_job_id,
      transaction,
    );

    if (!readiness.is_ready) {
      throw new ApiError(
        409,
        "WORKERS_NOT_CHECKED_IN",
        "All assigned workers must check in before this stall job can be completed.",
        readiness,
      );
    }

    const ticketWorkers =
      await ticketWorkerRepository.syncTicketWorkersFromVehicleAssignments(
        ticket.market_job_id,
        ticket.vehicle_job_id,
        transaction,
      );

    // ตรวจสอบว่า Worker ที่ส่งยอดยังเป็นสมาชิกที่ทำงานอยู่ใน Business Ticket ของ Booth นี้
    // (Worker อาจถูก Cancel เฉพาะ Business Ticket นี้ แต่ยัง Check-in รถและทำ Ticket อื่นได้)
    const isTicketWorker = ticketWorkers.some(
      (worker) =>
        worker.worker_account_id === account.id &&
        worker.status === TICKET_WORKER_STATUS.WORKING,
    );

    if (!isTicketWorker) {
      throw new ApiError(
        403,
        "WORKER_NOT_IN_TICKET",
        "Worker is not assigned to this ticket.",
      );
    }

    const products = await gateTicketRepository.listTicketProducts(
      ticket.id,
      transaction,
    );

    validateTicketCompletionItems(products, input.items);

    const canSubmit = await gateTicketRepository.markTicketDelivered(
      ticket.id,
      transaction,
    );

    if (!canSubmit) {
      if (ticket.status === TICKET_STATUS.DELIVERED) {
        throw new ApiError(
          409,
          "TICKET_ALREADY_SUBMITTED",
          "Ticket completion is already waiting for vendor confirmation.",
        );
      }

      throw new ApiError(
        409,
        "TICKET_NOT_READY_FOR_COMPLETION",
        "Ticket is not ready for completion submission.",
      );
    }

    const submission =
      await gateTicketRepository.createTicketCompletionSubmission(
        ticket.id,
        account.id,
        transaction,
      );
    await assignmentRepository.markVehicleAssignmentsDelivered(
      ticket.vehicle_job_id,
      transaction,
    );
    const confirmedProducts =
      await gateTicketRepository.updateTicketProductConfirmations(
        ticket.id,
        input.items,
        transaction,
      );
    const waitingTicket =
      await gateTicketRepository.findGateTicketForCompletion(
        ticket.id,
        transaction,
      );
    const receiverAccountIds = await resolveTicketResultAudience(
      ticket,
      transaction,
    );

    return {
      ticket: waitingTicket ?? {
        ...ticket,
        status: TICKET_STATUS.DELIVERED,
        confirmation_status: TICKET_STATUS.DELIVERED,
      },
      submission,
      products: confirmedProducts,
      receiverAccountIds,
      vendorLineTargets,
      vendorTimeoutMs: getVendorConfirmationTimeoutMs(ticket, settings),
    };
  });
  await scheduleVendorConfirmationTimeout(
    result.ticket.id,
    result.submission.id,
    result.vendorTimeoutMs,
  );
  const currentScheduleAfterSubmit =
    await workScheduleRepository.findCurrentByAccountId(account.id);

  if (
    !currentScheduleAfterSubmit ||
    !isTimeInWorkSchedule(currentScheduleAfterSubmit)
  ) {
    if (currentScheduleAfterSubmit) {
      const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(
        currentScheduleAfterSubmit,
      );

      await closeWorkerAttendanceShift(
        account,
        currentScheduleAfterSubmit,
        shiftInstanceKey,
        "ticket_delivered_after_shift_end",
      );
    }
    const queue = await markWorkerOpenApp(account.id);

    if (isWorkerSocketConnected(account.id)) {
      sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
        queue: buildWorkerQueueSocketPayload(queue, account.username),
        reason: "ticket_delivered_after_shift_end",
      });
    }
    publishAdminWorkerStatusChanged({
      title: "Worker moved to open_app",
      message: `Worker ${account.full_name} moved to open_app after submitting ticket completion outside the shift.`,
      workerCode: account.username,
      queue,
      reason: "ticket_delivered_after_shift_end",
    });
  }
  const detail = await vehicleJobRepository.getVehicleJobDetail(
    result.ticket.vehicle_job_id,
  );
  const linePostbackData = await buildVendorCompletionPostbackData(
    result.ticket,
    result.submission,
  );
  const lineMessages = buildVendorCompletionMessages(
    result.ticket,
    linePostbackData,
    detail,
    result.products,
  );

  for (const target of result.vendorLineTargets) {
    await enqueueLoggedLineMessage({
      jobName: "send-vendor-ticket-completion",
      action: "send_vendor_ticket_completion",
      targetLineUserId: target.line_user_id,
      payload: {
        ticket_id: result.ticket.id,
        submission_id: result.submission.id,
        vendor_line_id: target.line_user_id,
        vendor_line_target_type: target.target_type,
        items: result.products,
      },
      messages: lineMessages,
    });
  }
  publishRealtimeEvent({
    type: "TICKET_COMPLETION_SUBMITTED",
    title: "Ticket completion submitted",
    message: `Ticket ${result.ticket.boothCode} is waiting for vendor confirmation.`,
    payload: {
      ...buildWorkerTicketPayload(result.ticket, detail, result.products, {
        submission_status: result.submission.status,
        assignment_status: ASSIGNMENT_STATUS.DELIVERED,
        confirmed_at: result.submission.confirmed_at,
        rejected_at: result.submission.rejected_at,
        ticket_completed_at: null,
      }),
    },
    worker_payload: {
      ...buildWorkerTicketPayload(result.ticket, detail, result.products, {
        submission_status: result.submission.status,
        assignment_status: ASSIGNMENT_STATUS.DELIVERED,
        confirmed_at: result.submission.confirmed_at,
        rejected_at: result.submission.rejected_at,
        ticket_completed_at: null,
      }),
    },
    admin: true,
    worker_account_ids: result.receiverAccountIds,
  });

  const responsePayload = buildWorkerTicketPayload(
    result.ticket,
    detail,
    result.products,
    {
      submission_status: result.submission.status,
      assignment_status: ASSIGNMENT_STATUS.DELIVERED,
      confirmed_at: result.submission.confirmed_at,
      rejected_at: result.submission.rejected_at,
      ticket_completed_at: null,
    },
  ) as Omit<TicketCompletionResponse, "message">;

  return {
    message: "Ticket completion submitted and waiting for vendor confirmation.",
    ...responsePayload,
  };
}
