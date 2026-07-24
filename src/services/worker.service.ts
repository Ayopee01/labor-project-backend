// import Library
import type { Prisma } from "@prisma/client";
// import
import { withTransaction } from "../db/prisma";
import { enqueueLineMessage } from "../queues/notification-queue";
import { enqueueWorker, getWorkerBreakCount, getWorkerQueueStatus, hasWorkerShiftOnlineUsed, incrementWorkerBreakCount, markWorkerBreak, markWorkerOpenApp, markWorkerShiftClosed, markWorkerShiftOnlineUsed, removeAssignmentTimeout, removeScanTimeout, removeScanWarning, removeWorkerBreakReturn, resetWorkerAcceptTimeoutCount, scheduleScanTimeout, scheduleScanWarning, scheduleVendorConfirmationTimeout, scheduleWorkerBreakReturn, scheduleWorkerShiftEnd, isWorkerShiftClosed } from "../queues/worker-queue";
import { dispatchReadyWorkers, handleAssignmentAcceptTimeout } from "../queues/worker-dispatch";
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
import { buildShiftWaitInfo, buildWorkScheduleShiftInstanceKey, formatScheduleWithShift, getWorkScheduleShiftEndDelayMs, isTimeInWorkSchedule } from "../utils/shift";
import { buildBangkokDateRange, buildDeadline, formatBangkokDate, getDelayUntil } from "../utils/time";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { signVendorTicketActionToken } from "../utils/vendor-action-token";
import { buildWorkerQueueSocketPayload } from "../utils/worker-queue-payload";
import { resolveWorkerWorkStatus } from "../utils/worker-status";

/* -------------------------------------- Functions -------------------------------------- */

// Function เธชเธฃเนเธฒเธเธเนเธญเธกเธนเธฅเน€เธงเธฅเธฒเธเธฑเธเธ—เธตเนเน€เธซเธฅเธทเธญเธชเธณเธซเธฃเธฑเธ response เน€เธกเธทเนเธญ worker เธญเธขเธนเนเธชเธ–เธฒเธเธฐ break
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
    minutes > 0 ? `${minutes} เธเธฒเธ—เธต` : null,
    seconds > 0 || minutes === 0 ? `${seconds} เธงเธดเธเธฒเธ—เธต` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    total_seconds: totalSeconds,
    minutes,
    seconds,
    text: textParts.join(" "),
  };
}

// Function เน€เธ•เธดเธกเธเธณเธเธงเธเธเธฃเธฑเนเธเธเธฑเธเนเธ response เธชเธ–เธฒเธเธฐเธเธดเธง
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

// Function เธชเธฃเนเธฒเธ response เธซเธฅเธฑเธ worker online/open_app เธเธฃเนเธญเธกเธชเธฃเธธเธเธเธฒเธเนเธฅเธฐเธเธณเธเธงเธเธเธฑเธเธเธญเธเธงเธฑเธ/เธเธฐ
async function buildWorkerOnlineResponse(
  account: AccountDto,
  queueEntry: WorkerQueueEntryDto,
  schedule: WorkScheduleDto | null,
  assignment: VehicleJobAssignmentDto | null = null,
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
    status: resolveWorkerWorkStatus(queueEntry, assignment),
    today_job_count: todayJobCount,
    break_count_used: breakCountUsed,
    completed_job_count: completedJobCount,
  };
}

// Function เธชเธฃเนเธฒเธเธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”เธเธฒเธเธซเธฅเธฑเธ worker เธเธ”เธฃเธฑเธ assignment
function buildWorkerAssignmentAcceptResponse(
  detail: VehicleJobDetailResponse,
  team: WorkerAssignmentTeamMemberDto[]
): WorkerAssignmentAcceptResponse {
  return {
    license_plate: detail.vehicle_job.license_plate,
    team,
    markets: detail.markets.map((market) => ({
      marketName: market.marketName,
      stall_count: market.tickets.length,
      stalls: market.tickets.map((ticket) => ({
        boothCode: ticket.boothCode,
        boothName: ticket.boothName,
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

// Function เธชเธฃเนเธฒเธ item เธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธ worker เนเธ”เธขเธเนเธญเธ id เธ เธฒเธขเนเธเนเธฅเธฐเนเธเน reference เธ—เธตเน UI/API เนเธเนเธเธฒเธ
function buildWorkerAssignmentHistoryItemResponse(
  item: WorkerAssignmentHistoryItemDto
): WorkerAssignmentHistoryItemResponse {
  const timeoutReason = item.assignment.status !== "TIMEOUT"
    ? null
    : item.assignment.accepted_at
      ? "scan_timeout"
      : "accept_timeout";

  return {
    ticketNo: item.vehicle_job.ticketNo,
    gate_transaction_ref: item.vehicle_job.gate_transaction_ref,
    license_plate: item.vehicle_job.license_plate,
    status: item.assignment.status,
    accept_deadline_at: item.assignment.accept_deadline_at,
    scan_deadline_at: item.assignment.scan_deadline_at,
    accepted_at: item.assignment.accepted_at,
    scanned_at: item.assignment.scanned_at,
    completed_at: item.assignment.completed_at,
    timeout_reason: timeoutReason,
    created_at: item.assignment.created_at,
    updated_at: item.assignment.updated_at,
  };
}

// Function เธชเธฃเนเธฒเธ payload เนเธเนเธ worker เธงเนเธฒเธฃเธฑเธเธเธฒเธเธชเธณเน€เธฃเนเธเนเธฅเนเธง
function buildAssignmentAcceptedSocketPayload(
  assignment: VehicleJobAssignmentDto,
  detail: VehicleJobDetailResponse,
  workerCode: string | null
) {
  return {
    worker_code: workerCode,
    status: assignment.status,
    ticketNo: detail.vehicle_job.ticketNo,
    gate_transaction_ref: detail.vehicle_job.gate_transaction_ref,
    accepted_at: assignment.accepted_at,
    scan_deadline_at: assignment.scan_deadline_at,
  };
}

// Function เธ•เธฃเธงเธเธงเนเธฒ scan deadline เธซเธกเธ”เธญเธฒเธขเธธเนเธฅเนเธงเธซเธฃเธทเธญเธขเธฑเธ
function isScanDeadlineExpired(scanDeadlineAt: string | null): boolean {
  if (!scanDeadlineAt) {
    return true;
  }

  const deadlineMs = new Date(scanDeadlineAt).getTime();

  return !Number.isFinite(deadlineMs) || deadlineMs <= Date.now();
}

// Function เธ•เธฃเธงเธ auth เธงเนเธฒเน€เธเนเธ worker เธ—เธตเน active เธเนเธญเธเธ—เธณเธเธฒเธเนเธ Worker Mobile flow
async function scheduleWorkerShiftEndIfNeeded(
  accountId: number,
  schedule: WorkScheduleDto
): Promise<void> {
  const delayMs = getWorkScheduleShiftEndDelayMs(schedule);

  if (delayMs > 0) {
    await scheduleWorkerShiftEnd(
      accountId,
      schedule.id,
      delayMs,
      buildWorkScheduleShiftInstanceKey(schedule)
    );
  }
}

function getVendorConfirmationTimeoutMs(
  ticket: GateTicketDto,
  settings: Awaited<ReturnType<typeof getRuntimeSettings>>
): number {
  const timeoutHours =
    ticket.status === "REJECT"
      ? settings.vendor_reconfirm_timeout_hours
      : settings.vendor_confirm_timeout_hours;

  return timeoutHours * 60 * 60 * 1000;
}

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

// Function เธญเนเธฒเธ reference เธเธญเธ assignment เธเธฒเธ path param
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

// Function เธซเธฒ assignment เธเธฑเธเธเธธเธเธฑเธเธเธญเธ worker เธ”เนเธงเธข ticketNo เธ—เธตเนเธชเนเธเธกเธฒเธเธฒเธ API
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

// Function เธซเธฒ ticket เธ—เธตเน worker เธเธฐเธชเนเธเธขเธญเธ”เธเธดเธ”เธเธฒเธเธ”เนเธงเธข boothCode เธซเธฃเธทเธญ ticket reference
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

// Function เธ•เธฃเธงเธ flag เธชเธณเธซเธฃเธฑเธเธชเนเธ LINE postback token เธเธฅเธฑเธเนเธ response เธ•เธญเธ debug
function shouldIncludeDebugLinePostback(): boolean {
  return process.env.LINE_DEBUG_POSTBACK_RESPONSE === "true";
}

// Function เธชเธฃเนเธฒเธ postback data เธ—เธตเนเธกเธต signed token เธชเธณเธซเธฃเธฑเธ vendor confirm/reject เธเนเธฒเธ LINE
function buildVendorCompletionPostbackData(
  ticket: GateTicketDto,
  submission: TicketCompletionSubmissionDto
): { confirm: string; reject: string } {
  const confirmToken = signVendorTicketActionToken({
    action: "vendor_confirm_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    boothCode: ticket.boothCode,
  });
  const rejectToken = signVendorTicketActionToken({
    action: "vendor_reject_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    boothCode: ticket.boothCode,
  });

  return {
    confirm: `action=vendor_confirm_completion&token=${confirmToken}`,
    reject: `action=vendor_reject_completion&token=${rejectToken}`,
  };
}

// Function เธชเธฃเนเธฒเธเธเนเธญเธเธงเธฒเธก LINE เธชเนเธเนเธซเน vendor เธ•เธฃเธงเธเธขเธญเธ”เธเธดเธ”เธเธฒเธเธเธญเธ ticket
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
    const diffText = diff === 0 ? "เธ•เธฃเธ" : diff > 0 ? `เน€เธเธดเธ ${diff}` : `เธเธฒเธ” ${Math.abs(diff)}`;

    return [
      `- ${product.packageCode} / ${product.productName}`,
      `  Gate: ${product.quantity} ${product.packageName}`,
      `  Worker: ${product.confirmed_quantity ?? "-"} ${product.packageName}`,
      `  Diff: ${diffText} ${product.packageName}`,
    ].join("\n");
  });

  return [
    "Worker submitted ticket completion.",
    `License plate: ${detail?.vehicle_job.license_plate ?? "-"}`,
    `Vehicle type: ${detail?.vehicle_job.vehicle_type ?? "-"}`,
    `Ticket: ${detail?.vehicle_job.ticketNo ?? "-"}`,
    `Market: ${market?.marketName ?? "-"}`,
    `Booth code: ${ticket.boothCode}`,
    `Booth: ${ticket.boothName ?? "-"}`,
    "Products:",
    ...productLines,
    `Confirm: ${postbackData.confirm}`,
    `Reject: ${postbackData.reject}`,
  ]
    .join("\n");
}

// Function เธ•เธฃเธงเธเธฃเธฒเธขเธเธฒเธฃเธชเธดเธเธเนเธฒเธ—เธตเน worker เธชเนเธเธงเนเธฒเธเธฃเธ เธ•เธฃเธ ticket เนเธฅเธฐเนเธกเนเธเนเธณ
function validateTicketCompletionItems(
  products: TicketProductDto[],
  items: Array<{ productCode: string; confirmed_quantity: number }>
): void {
  const productCodes = new Set(products.map((product) => product.productCode));
  const itemCodes = new Set<string>();

  for (const item of items) {
    if (!productCodes.has(item.productCode)) {
      throw new ApiError(
        400,
        "INVALID_TICKET_PRODUCT",
        "Ticket product does not belong to this ticket."
      );
    }

    if (itemCodes.has(item.productCode)) {
      throw new ApiError(
        400,
        "DUPLICATE_TICKET_PRODUCT",
        "Ticket product is duplicated in completion items."
      );
    }

    itemCodes.add(item.productCode);
  }

  if (itemCodes.size !== products.length) {
    throw new ApiError(
      400,
      "INCOMPLETE_TICKET_PRODUCTS",
      "All ticket products must be sent with confirmed quantities."
    );
  }
}

// Function เธซเธฒ receiver เธเธญเธ event เธเธดเธ”เธเธฒเธ เน€เธเธทเนเธญเธชเนเธ SSE เนเธซเน worker เนเธ ticket เนเธฅเธฐ admin เธ—เธธเธเธเธ
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

// Function เนเธซเน worker เน€เธเนเธฒ queue เนเธฅเธฐ dispatch เธ–เนเธฒเธกเธตเธเธฒเธเธฃเธญเธญเธขเธนเน
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
  const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);

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
        throw new ApiError(
          409,
          "WORKER_HAS_ACTIVE_ASSIGNMENT",
          "Worker already has an active assignment."
        );
      }
    }

    const currentQueueEntry = await getWorkerQueueStatus(account.id);
    const isReturningFromBreak = currentQueueEntry?.status === "break";

    if (isReturningFromBreak) {
      await removeWorkerBreakReturn(account.id, currentSchedule.id);
    } else {
      if (await isWorkerShiftClosed(account.id, shiftInstanceKey)) {
        throw new ApiError(
          409,
          "WORKER_SHIFT_CLOSED",
          "Worker already ended this shift and cannot go online again."
        );
      }

      const onlineUsed = await hasWorkerShiftOnlineUsed(account.id, shiftInstanceKey);

      if (onlineUsed && currentQueueEntry?.status !== "ready") {
        throw new ApiError(
          409,
          "WORKER_SHIFT_ONLINE_ALREADY_USED",
          "Worker can go online from open_app only once in this shift."
        );
      }

      if (!onlineUsed) {
        await markWorkerShiftOnlineUsed(account.id, shiftInstanceKey);
      }
    }
    await scheduleWorkerShiftEndIfNeeded(account.id, currentSchedule);

    await enqueueWorker(account.id);

    await dispatchReadyWorkers(transaction);

    const latestQueueEntry = await getWorkerQueueStatus(account.id);
    const latestAssignment = await workerApplicationRepository.findCurrentAssignmentByWorker(
      account.id,
      transaction
    );

    if (!latestQueueEntry) {
      throw new ApiError(404, "WORKER_QUEUE_NOT_FOUND", "Worker queue entry not found.");
    }

    const response = await buildWorkerOnlineResponse(
      account,
      latestQueueEntry,
      currentSchedule,
      latestAssignment,
      transaction
    );

    sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
      queue: buildWorkerQueueSocketPayload(
        latestQueueEntry,
        response.worker_code,
        latestAssignment
      ),
    });
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker online",
      message: `Worker ${account.full_name} is ready for work.`,
      payload: {
        worker_code: response.worker_code,
        queue: buildWorkerQueueSocketPayload(
          latestQueueEntry,
          response.worker_code,
          latestAssignment
        ),
        reason: "worker_online",
      },
      audience: {
        roles: ["admin"],
      },
    });

    return response;
  });
}

// Function เนเธซเน worker เธญเธญเธเธเธฒเธ queue
export async function workerOffline(auth?: AccessTokenPayload): Promise<WorkerOnlineResponse> {
  const account = await requireWorker(auth);
  const [currentSchedule, currentQueueEntry, currentAssignment] = await Promise.all([
    workScheduleRepository.findCurrentByAccountId(account.id),
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
  ]);

  if (currentQueueEntry?.status === "break" && currentSchedule) {
    await removeWorkerBreakReturn(account.id, currentSchedule.id);
  }

  if (currentSchedule) {
    await markWorkerShiftClosed(
      account.id,
      buildWorkScheduleShiftInstanceKey(currentSchedule)
    );
  }

  const queueEntry = await markWorkerOpenApp(account.id);
  const response = await buildWorkerOnlineResponse(
    account,
    queueEntry,
    currentSchedule,
    currentAssignment
  );

  sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
    queue: buildWorkerQueueSocketPayload(
      queueEntry,
      response.worker_code,
      currentAssignment
    ),
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker moved to open_app",
    message: `Worker ${account.full_name} moved to open_app.`,
    payload: {
      worker_code: response.worker_code,
      queue: buildWorkerQueueSocketPayload(
        queueEntry,
        response.worker_code,
        currentAssignment
      ),
      reason: "worker_open_app",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return response;
}

// Function เนเธซเน worker เธเธฑเธเธเธฑเนเธงเธเธฃเธฒเธง 15 เธเธฒเธ—เธต เนเธฅเธฐเธเธฅเธฑเธเธ—เนเธฒเธขเธเธดเธงเธญเธฑเธ•เนเธเธกเธฑเธ•เธด
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
    throw new ApiError(
      409,
      "WORKER_HAS_ACTIVE_ASSIGNMENT",
      "Worker already has an active assignment."
    );
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
  await scheduleWorkerShiftEndIfNeeded(account.id, currentSchedule);

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
      queue: buildWorkerQueueSocketPayload(breakQueueEntry, workerCode),
      reason: "worker_break",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    full_name: account.full_name,
    worker_code: workerCode,
    status: resolveWorkerWorkStatus(breakQueueEntry, null),
    break_count_used: breakCountUsed,
    break_count_limit: settings.worker_break_limit,
  };
}

// Function เธ”เธถเธเธชเธ–เธฒเธเธฐ queue เนเธฅเธฐ assignment เธเธฑเธเธเธธเธเธฑเธเธเธญเธ worker
export async function getWorkerStatus(auth?: AccessTokenPayload): Promise<WorkerStatusResponse> {
  const account = await requireWorker(auth);

  const [profile, currentSchedule, queueEntry, currentAssignment] = await Promise.all([
    workerApplicationRepository.profileRepository.findByAccountId(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
    getWorkerQueueStatus(account.id),
    workerApplicationRepository.findCurrentAssignmentByWorker(account.id),
  ]);
  const schedule = formatScheduleWithShift(currentSchedule);
  const status = resolveWorkerWorkStatus(queueEntry, currentAssignment);
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

// Function เธ”เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธเธเธญเธ worker เธ•เธฒเธกเธงเธฑเธเธ—เธตเนเธ—เธตเนเธฃเธฐเธเธธ
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

// Function เนเธซเน worker เธฃเธฑเธเธเธฒเธ
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
    const timeoutResult = await withTransaction(async (transaction) =>
      handleAssignmentAcceptTimeout({
        assignment,
        workerAccountId: account.id,
        connection: transaction,
      })
    );

    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      ticketNo: vehicleJob?.ticketNo ?? null,
      reason: timeoutResult.reason,
      timeout_count: timeoutResult.timeout_count,
      timeout_limit: timeoutResult.timeout_limit,
    });
    publishNotification({
      type: "ASSIGNMENT_TIMEOUT",
      title: "Assignment timed out",
      message: `Worker ${account.full_name} did not accept assignment ${assignment.id} in time.`,
      payload: {
        ticketNo: vehicleJob?.ticketNo ?? null,
        worker_code: workerCode,
        status: "TIMEOUT",
        queue: buildWorkerQueueSocketPayload(timeoutResult.queue, workerCode),
        reason: timeoutResult.reason,
        timeout_count: timeoutResult.timeout_count,
        timeout_limit: timeoutResult.timeout_limit,
      },
      audience: {
        roles: ["admin"],
      },
    });

    throw new ApiError(409, "ASSIGNMENT_TIMEOUT", "Assignment acceptance time expired.");
  }

  await removeAssignmentTimeout(assignment.id);
  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(account.id);

  if (currentSchedule) {
    await resetWorkerAcceptTimeoutCount(
      account.id,
      buildWorkScheduleShiftInstanceKey(currentSchedule)
    );
  }
  const settings = await getRuntimeSettings();

  const acceptedAssignment = await workerApplicationRepository.acceptAssignment(
    assignment.id,
    buildDeadline(settings.worker_scan_deadline_minutes * 60 * 1000)
  );
  await scheduleScanTimeout(
    acceptedAssignment.id,
    acceptedAssignment.worker_account_id,
    getDelayUntil(acceptedAssignment.scan_deadline_at)
  );
  await scheduleScanWarning(
    acceptedAssignment.id,
    acceptedAssignment.worker_account_id,
    acceptedAssignment.scan_deadline_at
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
      ticketNo: vehicleJobDetail.vehicle_job.ticketNo,
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

// Function เนเธซเน worker scan QR เน€เธเธทเนเธญ check-in เน€เธเนเธฒเธเธฒเธ
export async function scanWorkerAssignment(
  assignmentIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<WorkerAssignmentCheckInResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerScanBodySchema, body);
  const settings = await getRuntimeSettings();
  const teamScanRemainingMinutes = settings.worker_scan_team_remaining_minutes;

  const result = await withTransaction(async (transaction) => {
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
      const vehicleJob = await workerApplicationRepository.findVehicleJobById(
        assignment.vehicle_job_id,
        transaction
      );
      const timedOutAssignment = await workerApplicationRepository.timeoutAssignment(
        assignment.id,
        transaction
      );

      return {
        kind: "expired" as const,
        timedOutAssignment,
        vehicleJob,
      };
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

    const shortenedAssignments: VehicleJobAssignmentDto[] = [];

    if (vehicleJob.workers_required > 1 && scannedCount === 1) {
      const remainingAssignments = await workerApplicationRepository.listAcceptedAssignmentsByVehicleJob(
        assignment.vehicle_job_id,
        assignment.id,
        transaction
      );
      const teamScanDeadline = buildDeadline(teamScanRemainingMinutes * 60 * 1000);

      for (const remainingAssignment of remainingAssignments) {
        shortenedAssignments.push(
          await workerApplicationRepository.updateAssignmentScanDeadline(
            remainingAssignment.id,
            teamScanDeadline,
            transaction
          )
        );
      }
    }

    return {
      kind: "scanned" as const,
      scannedAssignment,
      vehicleJob,
      shortenedAssignments,
    };
  });

  if (result.kind === "expired") {
    await removeScanTimeout(result.timedOutAssignment.id);
    await removeScanWarning(result.timedOutAssignment.id);
    const queue = await markWorkerOpenApp(account.id);
    const workerCode = account.username;

    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      ticketNo: result.vehicleJob?.ticketNo ?? null,
      reason: "scan_timeout",
      status: "open_app",
    });
    publishNotification({
      type: "ASSIGNMENT_TIMEOUT",
      title: "Assignment scan timed out",
      message: `Worker ${account.full_name} did not scan QR in time.`,
      payload: {
        ticketNo: result.vehicleJob?.ticketNo ?? null,
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

  const { scannedAssignment, vehicleJob, shortenedAssignments } = result;
  await removeScanTimeout(scannedAssignment.id);
  await removeScanWarning(scannedAssignment.id);
  await Promise.all(
    shortenedAssignments.flatMap((assignment) =>
      [
        scheduleScanTimeout(
          assignment.id,
          assignment.worker_account_id,
          getDelayUntil(assignment.scan_deadline_at)
        ),
        scheduleScanWarning(
          assignment.id,
          assignment.worker_account_id,
          assignment.scan_deadline_at
        ),
      ]
    )
  );
  const workerCode = account.username;

  if (shortenedAssignments.length > 0) {
    const [firstShortenedAssignment] = shortenedAssignments;

    publishRealtimeEvent({
      type: "ASSIGNMENT_SCAN_DEADLINE_SHORTENED",
      title: "Scan deadline shortened",
      message: `Remaining workers must scan QR within ${teamScanRemainingMinutes} minutes for vehicle job ${vehicleJob.ticketNo}.`,
      payload: {
        ticketNo: vehicleJob.ticketNo,
        remaining_minutes: teamScanRemainingMinutes,
        scan_deadline_at: firstShortenedAssignment.scan_deadline_at,
        assignment_count: shortenedAssignments.length,
      },
      worker_payload: {
        ticketNo: vehicleJob.ticketNo,
        remaining_minutes: teamScanRemainingMinutes,
        scan_deadline_at: firstShortenedAssignment.scan_deadline_at,
      },
      admin: true,
      worker_account_ids: shortenedAssignments.map(
        (assignment) => assignment.worker_account_id
      ),
    });
  }

  publishNotification({
    type: "ASSIGNMENT_CHECKED_IN",
    title: "Assignment checked in",
    message: `Worker ${account.full_name} checked in assignment ${scannedAssignment.id}.`,
    payload: {
      ticketNo: vehicleJob.ticketNo,
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
    ticketNo: vehicleJob.ticketNo,
    worker_qr_token: vehicleJob.worker_qr_token,
  };
}

// Function เนเธซเน worker เธชเนเธเธขเธญเธ”เธเธดเธ”เธเธฒเธเธฃเธฐเธ”เธฑเธ ticket เน€เธเธทเนเธญเธฃเธญ vendor เธ•เธฃเธงเธเธเนเธฒเธ LINE
export async function completeWorkerTicket(
  ticketIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<TicketCompletionResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerTicketCompleteBodySchema, body);
  const settings = await getRuntimeSettings();
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

    if (ticket.status === "COMPLETED") {
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

    const canSubmit = await workerApplicationRepository.markTicketDelivered(
      ticket.id,
      transaction
    );

    if (!canSubmit) {
      if (ticket.status === "DELIVERED") {
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
    await workerApplicationRepository.markVehicleAssignmentsDelivered(
      ticket.vehicle_job_id,
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
        status: "DELIVERED",
        confirmation_status: "DELIVERED",
      },
      submission,
      products: confirmedProducts,
      receiverAccountIds,
      vendorTimeoutMs: getVendorConfirmationTimeoutMs(ticket, settings),
    };
  });
  await scheduleVendorConfirmationTimeout(
    result.ticket.id,
    result.submission.id,
    result.vendorTimeoutMs
  );
  const currentScheduleAfterSubmit = await workScheduleRepository.findCurrentByAccountId(
    account.id
  );

  if (
    !currentScheduleAfterSubmit ||
    !isTimeInWorkSchedule(currentScheduleAfterSubmit)
  ) {
    const queue = await markWorkerOpenApp(account.id);

    if (isWorkerSocketConnected(account.id)) {
      sendWorkerSocketEvent(account.id, "WORKER_STATUS_CHANGED", {
        queue: buildWorkerQueueSocketPayload(queue, account.username),
        reason: "ticket_delivered_after_shift_end",
      });
    }
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker moved to open_app",
      message: `Worker ${account.full_name} moved to open_app after submitting ticket completion outside the shift.`,
      payload: {
        worker_code: account.username,
        queue: buildWorkerQueueSocketPayload(queue, account.username),
        reason: "ticket_delivered_after_shift_end",
      },
      audience: {
        roles: ["admin"],
      },
    });
  }
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
    message: `Ticket ${result.ticket.boothCode} is waiting for vendor confirmation.`,
    payload: {
      ...buildWorkerTicketPayload(
        result.ticket,
        detail,
        result.products,
        {
          submission_status: result.submission.status,
          assignment_status: "DELIVERED",
        }
      ),
    },
    worker_payload: {
      ...buildWorkerTicketPayload(
        result.ticket,
        detail,
        result.products,
        {
          submission_status: result.submission.status,
          assignment_status: "DELIVERED",
        }
      ),
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
      assignment_status: "DELIVERED",
    }
  ) as Omit<TicketCompletionResponse, "message">;

  return {
    message: "Ticket completion submitted and waiting for vendor confirmation.",
    ...responsePayload,
    ...(shouldIncludeDebugLinePostback()
      ? { debug_line_postback: linePostbackData }
      : {}),
  };
}

