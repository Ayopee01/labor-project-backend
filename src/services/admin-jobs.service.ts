import { withTransaction } from "../db/prisma";
import { enqueueWorkersAtFront, getWorkerQueueStatus, markWorkerAssigned, markWorkerOpenApp, removeAssignmentTimeout, removeScanTimeout, removeScanWarning, scheduleAssignmentTimeout, scheduleScanTimeout, scheduleScanWarning } from "../queues/worker-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as adminJobsRepository from "../repositories/admin-jobs.repository";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./realtime.service";
import { getRuntimeSettings } from "./admin-settings.service";
// import Types
import type { VehicleJobOperationRecord } from "../repositories/admin-jobs.repository";
import type { AdminAssignmentResponse, AdminAssignWorkersResponse, AdminCancelAssignmentResponse, AdminCancelVehicleJobAndRequeueResponse, AdminExtendScanDeadlineResponse, AdminJobCancelResponse, AdminMarketJobActionResponse, AdminScanDeadlineAssignmentResponse, AdminStallJobActionResponse, AdminVehicleJobActionResponse, AdminVehicleJobHistoryItemResponse, AdminVehicleJobListItemResponse, AdminVehicleJobOperationItemResponse, AdminVehicleJobOperationListResponse, AdminVehicleJobOperationMarketResponse, AdminVehicleJobOperationMarketSummaryResponse, AdminVehicleJobOperationSummaryResponse, AdminVehicleJobOperationWorkerSummaryResponse, VehicleOperationStatus } from "../types/admin-jobs.type";
import type { GateTicketDto, MarketJobDto, TicketProductDto, VehicleJobAssignmentDto, VehicleJobDetailResponse, VehicleJobDto } from "../types/worker.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { adminAssignWorkersBodySchema, adminCancelBodySchema, adminExtendScanDeadlineBodySchema, adminJobCancelBodySchema, adminVehicleJobListQuerySchema, adminVehicleJobOperationsQuerySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";
import { ACTIVE_ASSIGNMENT_STATUSES, SCANNED_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES, VEHICLE_JOB_STATUS, VEHICLE_OPERATION_STATUS } from "../constants/job-status";
import { buildBangkokDateSpanRange, buildDeadline, getDelayUntil } from "../utils/time";
import { buildWorkerAssignedPayload } from "../utils/worker-assignment-event";
import { findActiveWorkSchedule, formatScheduleWithShift } from "../utils/shift";

/* -------------------------------------- Functions -------------------------------------- */

// Function เนเธเธฅเธ path/query param เธ—เธตเนเน€เธเนเธ reference เนเธฅเธฐเนเธขเธ error เธ–เนเธฒเธเนเธฒเธงเนเธฒเธ
function parseReference(value: unknown, code: string, message: string): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(400, code, message);
  }

  return reference;
}

// Function เธเธฑเธ”เธฃเธนเธ vehicle job เธชเธณเธซเธฃเธฑเธ response เธเธฑเนเธ Admin เนเธ”เธขเนเธเน reference เนเธ—เธ id เธ เธฒเธขเนเธ
function formatPublicVehicleJobListItem(vehicleJob: VehicleJobDto): AdminVehicleJobListItemResponse {
  return {
    ticketNo: vehicleJob.ticketNo,
    gate_transaction_ref: vehicleJob.gate_transaction_ref,
    license_plate: vehicleJob.license_plate,
    vehicle_type: vehicleJob.vehicle_type,
    workers_required: vehicleJob.workers_required,
    dispatch_now: vehicleJob.dispatch_now,
    status: vehicleJob.status,
  };
}

function formatVehicleJobActionResponse(
  message: string,
  vehicleJob: VehicleJobDto
): AdminVehicleJobActionResponse {
  return {
    message,
    ticketNo: vehicleJob.ticketNo,
    status: vehicleJob.status,
  };
}

// Function เธเธฑเธ”เธฃเธนเธเธชเธดเธเธเนเธฒเนเธ ticket เธชเธณเธซเธฃเธฑเธ response เธเธฑเนเธ Admin
function formatPublicProduct(product: TicketProductDto) {
  return {
    productCode: product.productCode,
    productName: product.productName,
    packageCode: product.packageCode,
    packageName: product.packageName,
    quantity: product.quantity,
    confirmed_quantity: product.confirmed_quantity,
  };
}

// Function เธเธฑเธ”เธฃเธนเธ ticket/เนเธเธเธชเธณเธซเธฃเธฑเธ response เธเธฑเนเธ Admin
function formatPublicTicket(ticket: GateTicketDto & { products?: TicketProductDto[] }) {
  return {
    boothCode: ticket.boothCode,
    boothName: ticket.boothName,
    vendor_line_id: ticket.vendor_line_id,
    reject_reason: ticket.reject_reason,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    ...(ticket.products && {
      products: ticket.products.map(formatPublicProduct),
    }),
  };
}

// Function เธเธฑเธ”เธฃเธนเธ market job เธชเธณเธซเธฃเธฑเธ response เธเธฑเนเธ Admin
function formatPublicMarket(market: MarketJobDto) {
  return {
    marketCode: market.marketCode,
    marketName: market.marketName,
    dropoff_point: market.dropoff_point,
    status: market.status,
    created_at: market.created_at,
    updated_at: market.updated_at,
  };
}

function formatMarketJobActionResponse(
  message: string,
  market: MarketJobDto,
  vehicleJob: VehicleJobDto | null
): AdminMarketJobActionResponse {
  return {
    message,
    ticketNo: vehicleJob?.ticketNo ?? null,
    marketCode: market.marketCode,
    status: market.status,
  };
}

function formatStallJobActionResponse(
  message: string,
  ticket: GateTicketDto,
  vehicleJob: VehicleJobDto | null,
  marketJob: MarketJobDto | null
): AdminStallJobActionResponse {
  return {
    message,
    ticketNo: vehicleJob?.ticketNo ?? null,
    marketCode: marketJob?.marketCode ?? null,
    boothCode: ticket.boothCode,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
  };
}

// Function เธเธฑเธ”เธฃเธนเธเธเธฒเธเธฃเธ–เธเธฃเนเธญเธกเธ•เธฅเธฒเธ”เนเธฅเธฐเนเธเธเธชเธณเธซเธฃเธฑเธ response เธเธฑเนเธ Admin
// Function เธซเธฒ vehicle job เธ”เนเธงเธข ticketNo เนเธฅเธฐเนเธขเธ error เธ–เนเธฒเนเธกเนเธเธ
function formatPublicVehicleJobHistoryDetail(
  detail: VehicleJobDetailResponse
): AdminVehicleJobHistoryItemResponse {
  return {
    vehicle_job: {
      ...formatPublicVehicleJobListItem(detail.vehicle_job),
      created_at: detail.vehicle_job.created_at,
      updated_at: detail.vehicle_job.updated_at,
    },
    markets: detail.markets.map((market) => ({
      ...formatPublicMarket(market),
      tickets: market.tickets.map((ticket) => ({
        ...formatPublicTicket(ticket),
        products: ticket.products.map(formatPublicProduct),
      })),
    })),
  };
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toOperationWorkerStatus(assignmentStatus: string): string {
  if (["PENDING", "ACCEPTED"].includes(assignmentStatus)) {
    return "assigned";
  }

  if (["SCANNED", "WORKING", "DELIVERED", "REJECT", "COMPLETED"].includes(assignmentStatus)) {
    return "working";
  }

  return "open_app";
}

function resolveOperationWorkerShiftName(
  schedules: VehicleJobOperationRecord["assignments"][number]["worker"]["workSchedules"]
): string | null {
  const scheduleDtos = schedules.map((schedule) => ({
    id: schedule.id,
    account_id: schedule.accountId,
    shift_no: schedule.shiftNo,
    work_date: schedule.workDate,
    shift_start_time: schedule.shiftStartTime,
    shift_end_time: schedule.shiftEndTime,
    is_current: schedule.isCurrent,
    created_by: schedule.createdBy,
    updated_by: schedule.updatedBy,
    created_at: schedule.createdAt.toISOString(),
    updated_at: schedule.updatedAt.toISOString(),
  }));
  const activeSchedule =
    findActiveWorkSchedule(scheduleDtos) ?? scheduleDtos[0] ?? null;

  return formatScheduleWithShift(activeSchedule)?.shift_name ?? null;
}

function isTicketRejected(ticket: VehicleJobOperationRecord["marketJobs"][number]["tickets"][number]): boolean {
  return ticket.status === "REJECT" || ticket.confirmationStatus === "REJECT";
}

function isTicketDelivered(ticket: VehicleJobOperationRecord["marketJobs"][number]["tickets"][number]): boolean {
  return ticket.status === "DELIVERED" || ticket.confirmationStatus === "DELIVERED";
}

function isTicketCompleted(ticket: VehicleJobOperationRecord["marketJobs"][number]["tickets"][number]): boolean {
  return ticket.status === "COMPLETED" || ticket.confirmationStatus === "COMPLETED";
}

function listOperationTickets(record: VehicleJobOperationRecord): VehicleJobOperationRecord["marketJobs"][number]["tickets"] {
  return record.marketJobs.flatMap((market) => market.tickets);
}

function buildOperationWorkerSummary(
  record: VehicleJobOperationRecord
): AdminVehicleJobOperationWorkerSummaryResponse {
  const summary: AdminVehicleJobOperationWorkerSummaryResponse = {
    required: record.workersRequired,
    assigned: 0,
    active: 0,
    accepted: 0,
    scanned: 0,
    working: 0,
    delivered: 0,
    rejected: 0,
    completed: 0,
    cancelled: 0,
    timeout: 0,
    missing: 0,
  };

  for (const assignment of record.assignments) {
    if (!["CANCELLED", "TIMEOUT"].includes(assignment.status)) {
      summary.assigned += 1;
    }

    if (ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
      summary.active += 1;
    }

    if (assignment.status === "ACCEPTED") {
      summary.accepted += 1;
    }

    if (
      assignment.scannedAt ||
      SCANNED_ASSIGNMENT_STATUSES.includes(assignment.status)
    ) {
      summary.scanned += 1;
    }

    if (assignment.status === "WORKING") {
      summary.working += 1;
    } else if (assignment.status === "DELIVERED") {
      summary.delivered += 1;
    } else if (assignment.status === "REJECT") {
      summary.rejected += 1;
    } else if (assignment.status === "COMPLETED") {
      summary.completed += 1;
    } else if (assignment.status === "CANCELLED") {
      summary.cancelled += 1;
    } else if (assignment.status === "TIMEOUT") {
      summary.timeout += 1;
    }
  }

  summary.missing = Math.max(
    0,
    record.workersRequired - Math.max(summary.active, summary.assigned)
  );

  return summary;
}

function buildOperationMarketSummary(
  record: VehicleJobOperationRecord
): AdminVehicleJobOperationMarketSummaryResponse {
  const tickets = listOperationTickets(record);

  return {
    total: record.marketJobs.length,
    stalls: tickets.length,
    products: tickets.reduce((total, ticket) => total + ticket.products.length, 0),
    delivered: tickets.filter(isTicketDelivered).length,
    confirmed: tickets.filter(isTicketCompleted).length,
    rejected: tickets.filter(isTicketRejected).length,
  };
}

function resolveVehicleOperationStatus(
  record: VehicleJobOperationRecord,
  workerSummary: AdminVehicleJobOperationWorkerSummaryResponse
): VehicleOperationStatus {
  const isTerminalJob = TERMINAL_JOB_STATUSES.includes(record.status);

  if (!record.dispatchNow && record.status === VEHICLE_JOB_STATUS.WAIT) {
    return VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;
  }

  if (
    !isTerminalJob &&
    record.workersRequired > 0 &&
    workerSummary.active < record.workersRequired
  ) {
    if (record.dispatchNow) {
      return VEHICLE_OPERATION_STATUS.WAITING_QUEUE;
    }

    return VEHICLE_OPERATION_STATUS.DRIVER_WAITING_QUEUE;
  }

  return VEHICLE_OPERATION_STATUS.UNLOAD_NOW;
}

function buildOperationTiming(record: VehicleJobOperationRecord): {
  gate_elapsed_seconds: number;
  working_elapsed_seconds: number | null;
} {
  const now = Date.now();
  const endTime =
    record.status === VEHICLE_JOB_STATUS.COMPLETED ||
    record.status === VEHICLE_JOB_STATUS.CANCELLED
      ? record.updatedAt.getTime()
      : now;
  const scannedTimes = record.assignments
    .map((assignment) => assignment.scannedAt?.getTime())
    .filter((value): value is number => typeof value === "number");
  const firstScannedAt = scannedTimes.length > 0 ? Math.min(...scannedTimes) : null;

  return {
    gate_elapsed_seconds: Math.max(0, Math.floor((endTime - record.createdAt.getTime()) / 1000)),
    working_elapsed_seconds:
      firstScannedAt === null
        ? null
        : Math.max(0, Math.floor((endTime - firstScannedAt) / 1000)),
  };
}

function formatOperationMarkets(
  record: VehicleJobOperationRecord
): AdminVehicleJobOperationMarketResponse[] {
  return record.marketJobs.map((market) => {
    const tickets = market.tickets.map((ticket) => ({
      boothCode: ticket.boothCode,
      boothName: ticket.boothName,
      vendor_line_id: ticket.vendorLineId,
      reject_reason: ticket.rejectReason,
      status: ticket.status,
      confirmation_status: ticket.confirmationStatus,
      created_at: ticket.createdAt.toISOString(),
      updated_at: ticket.updatedAt.toISOString(),
      product_count: ticket.products.length,
      products: ticket.products.map((product) => ({
        productCode: product.productCode,
        productName: product.productName,
        packageCode: product.packageCode,
        packageName: product.packageName,
        quantity: product.quantity.toString(),
        confirmed_quantity: product.confirmedQuantity?.toString() ?? null,
      })),
    }));

    return {
      marketCode: market.marketCode,
      marketName: market.marketName,
      dropoff_point: market.dropoffPoint,
      status: market.status,
      created_at: market.createdAt.toISOString(),
      updated_at: market.updatedAt.toISOString(),
      summary: {
        stalls: tickets.length,
        products: tickets.reduce((total, ticket) => total + ticket.product_count, 0),
        delivered: market.tickets.filter(isTicketDelivered).length,
        confirmed: market.tickets.filter(isTicketCompleted).length,
        rejected: market.tickets.filter(isTicketRejected).length,
      },
      tickets,
    };
  });
}

function formatVehicleOperationItem(
  record: VehicleJobOperationRecord
): AdminVehicleJobOperationItemResponse {
  const workerSummary = buildOperationWorkerSummary(record);
  const marketSummary = buildOperationMarketSummary(record);
  const operationStatus = resolveVehicleOperationStatus(record, workerSummary);

  return {
    operation_status: operationStatus,
    vehicle_job: {
      ticketNo: record.ticketNo,
      gate_transaction_ref: record.gateTransactionRef,
      license_plate: record.licensePlate,
      vehicle_type: record.vehicleType,
      workers_required: record.workersRequired,
      dispatch_now: record.dispatchNow,
      status: record.status,
      created_at: record.createdAt.toISOString(),
      updated_at: record.updatedAt.toISOString(),
    },
    worker_summary: workerSummary,
    market_summary: marketSummary,
    scan_summary: {
      required: record.workersRequired,
      scanned: workerSummary.scanned,
      remaining: Math.max(0, record.workersRequired - workerSummary.scanned),
    },
    timing: buildOperationTiming(record),
    workers: record.assignments.map((assignment) => ({
      worker_code: assignment.worker.username,
      full_name: assignment.worker.fullName,
      shirt_number: assignment.worker.profile?.shirtNumber ?? null,
      image_url: assignment.worker.profile?.imageUrl ?? null,
      shift_name: resolveOperationWorkerShiftName(assignment.worker.workSchedules),
      assignment_status: assignment.status,
      worker_status: toOperationWorkerStatus(assignment.status),
      accept_deadline_at: toIsoString(assignment.acceptDeadlineAt),
      scan_deadline_at: toIsoString(assignment.scanDeadlineAt),
      accepted_at: toIsoString(assignment.acceptedAt),
      scanned_at: toIsoString(assignment.scannedAt),
      completed_at: toIsoString(assignment.completedAt),
      created_at: assignment.createdAt.toISOString(),
      updated_at: assignment.updatedAt.toISOString(),
    })),
    markets: formatOperationMarkets(record),
  };
}

function buildVehicleOperationSummary(
  items: AdminVehicleJobOperationItemResponse[]
): AdminVehicleJobOperationSummaryResponse {
  return items.reduce(
    (summary, item) => {
      summary.total += 1;
      summary[item.operation_status] += 1;
      return summary;
    },
    {
      total: 0,
      unload_now: 0,
      waiting_unload: 0,
      waiting_queue: 0,
      driver_waiting_queue: 0,
    }
  );
}

async function requireVehicleJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findVehicleJobByRef>[1]
): Promise<VehicleJobDto> {
  const ticketNo = parseReference(
    idParam,
    "INVALID_VEHICLE_JOB_REF",
    "Ticket no is invalid."
  );
  const vehicleJob = await adminJobsRepository.findVehicleJobByRef(ticketNo, connection);

  if (!vehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return vehicleJob;
}

// Function เธซเธฒ market job เธ”เนเธงเธข marketCode เนเธฅเธฐเนเธขเธ error เธ–เนเธฒเนเธกเนเธเธ
async function requireMarketJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findMarketJobByRef>[1]
): Promise<MarketJobDto> {
  const marketCode = parseReference(
    idParam,
    "INVALID_MARKET_JOB_REF",
    "Market code is invalid."
  );
  const marketJob = await adminJobsRepository.findMarketJobByRef(marketCode, connection);

  if (!marketJob) {
    throw new ApiError(404, "MARKET_JOB_NOT_FOUND", "Market job not found.");
  }

  return marketJob;
}

// Function เธซเธฒ stall/ticket เธ”เนเธงเธข boothCode เนเธฅเธฐเนเธขเธ error เธ–เนเธฒเนเธกเนเธเธ
async function requireStallJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findGateTicketByRef>[1]
): Promise<GateTicketDto> {
  const boothCode = parseReference(
    idParam,
    "INVALID_STALL_JOB_REF",
    "Booth code is invalid."
  );
  const ticket = await adminJobsRepository.findGateTicketByRef(boothCode, connection);

  if (!ticket) {
    throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
  }

  return ticket;
}

// Function เธชเธฃเนเธฒเธเน€เธงเธฅเธฒ deadline เธเธฒเธเน€เธงเธฅเธฒเธเธฑเธเธเธธเธเธฑเธ
// Function เน€เธฃเธตเธขเธ worker เธ—เธตเนเธ–เธนเธ Admin เธขเธเน€เธฅเธดเธเธเธฒเธเนเธซเนเธเธฅเธฑเธเน€เธเนเธฒเธซเธฑเธงเธเธดเธงเธ•เธฒเธกเน€เธงเธฅเธฒเธฃเธฑเธเธเธฒเธ
function assignmentQueuePriorityAt(assignment: VehicleJobAssignmentDto): number {
  const value = assignment.accepted_at ?? assignment.created_at;
  const timestamp = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;

  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function sortAssignmentsForAdminCancelRequeue(
  assignments: VehicleJobAssignmentDto[]
): VehicleJobAssignmentDto[] {
  return [...assignments].sort((left, right) => {
    const leftPriorityAt = assignmentQueuePriorityAt(left);
    const rightPriorityAt = assignmentQueuePriorityAt(right);

    if (leftPriorityAt !== rightPriorityAt) {
      return leftPriorityAt - rightPriorityAt;
    }

    return left.id - right.id;
  });
}

// Function เธเธณเธเธงเธ“ scan deadline เนเธซเธกเน เนเธ”เธขเธ•เนเธญเธเธฒเธ deadline เน€เธ”เธดเธกเธ–เนเธฒเธขเธฑเธเนเธกเนเธซเธกเธ”เน€เธงเธฅเธฒ
function extendDeadline(currentDeadline: string | null, minutes: number): Date {
  const now = Date.now();
  const currentTime = currentDeadline ? new Date(currentDeadline).getTime() : now;
  const baseTime = Math.max(now, currentTime);

  return new Date(baseTime + minutes * 60 * 1000);
}

function isScanDeadlineActive(scanDeadlineAt: string | null): boolean {
  if (!scanDeadlineAt) {
    return false;
  }

  const deadlineMs = new Date(scanDeadlineAt).getTime();

  return Number.isFinite(deadlineMs) && deadlineMs > Date.now();
}

async function getWorkerCodeMapByAccountIds(workerIds: number[]): Promise<Map<number, string | null>> {
  const profiles = await adminJobsRepository.profileRepository.findByAccountIds(workerIds);

  return new Map(
    profiles.map((profile) => [profile.account_id, profile.worker_code])
  );
}

// Function เธชเธฃเนเธฒเธ response assignment เธซเธฅเธฑเธเธ•เนเธญเน€เธงเธฅเธฒ scan deadline เธเธฃเนเธญเธก worker_code
async function buildScanDeadlineAssignmentResponses(
  assignments: VehicleJobAssignmentDto[]
): Promise<AdminScanDeadlineAssignmentResponse[]> {
  const workerCodeMap = await getWorkerCodeMapByAccountIds(
    assignments.map((assignment) => assignment.worker_account_id)
  );

  return assignments.map((assignment) => ({
    worker_code: workerCodeMap.get(assignment.worker_account_id) ?? null,
    status: assignment.status,
    scan_deadline_at: assignment.scan_deadline_at,
  }));
}

// Function เธชเธฃเนเธฒเธ response assignment เธเธญเธ Admin เนเธ”เธขเนเธเน ticketNo เนเธฅเธฐ worker_code
async function buildAdminAssignmentResponses(
  ticketNo: string,
  assignments: VehicleJobAssignmentDto[]
): Promise<AdminAssignmentResponse[]> {
  const workerCodeMap = await getWorkerCodeMapByAccountIds(
    assignments.map((assignment) => assignment.worker_account_id)
  );

  return assignments.map((assignment) => ({
    ticketNo,
    worker_code: workerCodeMap.get(assignment.worker_account_id) ?? null,
    status: assignment.status,
    accept_deadline_at: assignment.accept_deadline_at,
    scan_deadline_at: assignment.scan_deadline_at,
    created_at: assignment.created_at,
    updated_at: assignment.updated_at,
  }));
}

// Function เนเธเธฅเธ account id เธเธญเธ worker เน€เธเนเธเธฃเธซเธฑเธชเธเธเธฑเธเธเธฒเธเธชเธณเธซเธฃเธฑเธ response/event
async function getWorkerCodesByAccountIds(workerIds: number[]): Promise<Array<string | null>> {
  const workerCodeMap = await getWorkerCodeMapByAccountIds(workerIds);

  return workerIds.map((workerId) => workerCodeMap.get(workerId) ?? null);
}

// Function เธชเธฃเนเธฒเธเธเนเธงเธเน€เธงเธฅเธฒเธเธญเธเธงเธฑเธเธ—เธตเนเนเธ—เธขเน€เธเธทเนเธญเนเธเน query เธเธฒเธเธฃเธ–เธฃเธฒเธขเธงเธฑเธ
// Function เธฃเธงเธก receiver เธเธญเธ SSE เธชเธณเธซเธฃเธฑเธเธเธฒเธเนเธเธเธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธ
// Function เธซเธฒ worker เธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธเธเธฑเธเธเธฒเธเธฃเธ– เน€เธเธทเนเธญเธชเนเธ WebSocket event เนเธซเน Mobile
async function listVehicleJobWorkerIds(vehicleJobId: number): Promise<number[]> {
  const assignments = await adminJobsRepository.listActiveAssignmentsByVehicleJob(
    vehicleJobId
  );

  return [
    ...new Set(assignments.map((assignment) => assignment.worker_account_id)),
  ];
}

// Function เธซเธฒ worker เธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธเธเธฑเธเธเธฒเธเนเธเธ เธ–เนเธฒเธขเธฑเธเนเธกเนเธกเธต ticket workers เนเธซเน fallback เน€เธเนเธ worker เธเธญเธเธฃเธ–
async function listStallJobWorkerIds(ticket: GateTicketDto): Promise<number[]> {
  const ticketWorkers = await adminJobsRepository.listTicketWorkers(ticket.id);

  if (ticketWorkers.length > 0) {
    return [
      ...new Set(ticketWorkers.map((worker) => worker.worker_account_id)),
    ];
  }

  return listVehicleJobWorkerIds(ticket.vehicle_job_id);
}

// Function เธชเธฃเนเธฒเธเธเนเธญเธเธงเธฒเธก LINE เนเธเนเธ vendor เธงเนเธฒเธเธฒเธเนเธเธเธ–เธนเธเน€เธเธดเธ”เนเธซเนเธชเนเธเธขเธญเธ”เนเธซเธกเน
// Function เธ”เธถเธเธฃเธฒเธขเธเธฒเธฃเธเธฒเธเธฃเธ–เธชเธณเธซเธฃเธฑเธ Admin
export async function listVehicleJobs(query: unknown): Promise<{
  data: AdminVehicleJobHistoryItemResponse[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}> {
  const filters = parseWithSchema(adminVehicleJobListQuerySchema, query);
  const dateFrom = filters.date ?? filters.date_from;
  const dateTo = filters.date ?? filters.date_to;
  const dateRange = buildBangkokDateSpanRange(dateFrom, dateTo);
  const result = await adminJobsRepository.listVehicleJobs({
    search: filters.search,
    status: filters.status,
    page: filters.page,
    limit: filters.limit,
    ...dateRange,
  });

  if (filters.page === undefined) {
    return {
      data: result.data.map(formatPublicVehicleJobHistoryDetail),
    };
  }

  const limit = filters.limit ?? 20;
  const total = result.total ?? result.data.length;

  return {
    data: result.data.map(formatPublicVehicleJobHistoryDetail),
    pagination: {
      page: filters.page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
}

// Function เธ”เธถเธเธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”เธเธฒเธเธฃเธ–เธชเธณเธซเธฃเธฑเธ Admin
// Function เธขเธเน€เธฅเธดเธเธเธฒเธเธฃเธ–เธ—เธฑเนเธเธซเธกเธ” เนเธฅเธฐเธเธฒ worker เธ—เธตเนเธ–เธทเธญ assignment เธเธฅเธฑเธเนเธเธชเธ–เธฒเธเธฐ open_app
export async function listVehicleJobOperations(
  query: unknown
): Promise<AdminVehicleJobOperationListResponse> {
  const filters = parseWithSchema(adminVehicleJobOperationsQuerySchema, query);
  const dateFrom = filters.date ?? filters.date_from;
  const dateTo = filters.date ?? filters.date_to;
  const dateRange = buildBangkokDateSpanRange(dateFrom, dateTo);
  const records = await adminJobsRepository.listVehicleJobOperations({
    search: filters.search,
    operation_status: filters.operation_status,
    page: filters.page,
    limit: filters.limit,
    ...dateRange,
  });
  const items = records.map(formatVehicleOperationItem);
  const summary = buildVehicleOperationSummary(items);
  const filteredItems = filters.operation_status
    ? items.filter((item) => item.operation_status === filters.operation_status)
    : items;

  if (filters.page === undefined) {
    return {
      server_time: new Date().toISOString(),
      summary,
      data: filteredItems,
    };
  }

  const limit = filters.limit ?? 20;
  const start = (filters.page - 1) * limit;
  const pagedItems = filteredItems.slice(start, start + limit);

  return {
    server_time: new Date().toISOString(),
    summary,
    data: pagedItems,
    pagination: {
      page: filters.page,
      limit,
      total: filteredItems.length,
      total_pages: Math.ceil(filteredItems.length / limit),
    },
  };
}

async function cancelVehicleJob(
  idParam: unknown,
  body: unknown
): Promise<AdminVehicleJobActionResponse> {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const activeAssignments = await adminJobsRepository.listActiveAssignmentsByVehicleJob(
    vehicleJobId
  );

  const vehicleJob = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelVehicleJob(vehicleJobId, transaction);
  });

  await Promise.all(
    activeAssignments.flatMap((assignment) => [
      removeAssignmentTimeout(assignment.id),
      removeScanTimeout(assignment.id),
      removeScanWarning(assignment.id),
    ])
  );
  await Promise.all(
    activeAssignments.map((assignment) =>
      markWorkerOpenApp(assignment.worker_account_id)
    )
  );
  activeAssignments.forEach((assignment) => {
    sendWorkerSocketEvent(assignment.worker_account_id, "ASSIGNMENT_CANCELLED", {
      ticketNo: vehicleJob.ticketNo,
      reason: "vehicle_job_cancelled",
    });
  });
  publishRealtimeEvent({
    type: "VEHICLE_JOB_CANCELLED",
    title: "Vehicle job cancelled",
    message: `Vehicle job ${vehicleJob.ticketNo} was cancelled.`,
    payload: {
      ticketNo: vehicleJob.ticketNo,
      status: vehicleJob.status,
    },
    worker_payload: {
      ticketNo: vehicleJob.ticketNo,
      status: vehicleJob.status,
      reason: "vehicle_job_cancelled",
    },
    admin: true,
    worker_account_ids: activeAssignments.map(
      (assignment) => assignment.worker_account_id
    ),
  });

  return formatVehicleJobActionResponse(
    "Vehicle job cancelled successfully.",
    vehicleJob
  );
}

// Function เธขเธเน€เธฅเธดเธเธเธฒเธเธฃเธ–เธ—เธฑเนเธเธเธฑเธ เนเธฅเธฐเธเธณ worker เธ—เธตเนเธ–เธทเธญ assignment เธเธฅเธฑเธเน€เธเนเธฒเธซเธฑเธงเธเธดเธงเธ•เธฒเธกเน€เธงเธฅเธฒเธฃเธฑเธเธเธฒเธ
async function cancelVehicleJobAndRequeue(
  idParam: unknown,
  body: unknown
): Promise<AdminCancelVehicleJobAndRequeueResponse> {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const activeAssignments = await adminJobsRepository.listActiveAssignmentsByVehicleJob(
    vehicleJobId
  );

  const vehicleJob = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelVehicleJob(vehicleJobId, transaction);
  });

  await Promise.all(
    activeAssignments.flatMap((assignment) => [
      removeAssignmentTimeout(assignment.id),
      removeScanTimeout(assignment.id),
      removeScanWarning(assignment.id),
    ])
  );

  const sortedAssignments = sortAssignmentsForAdminCancelRequeue(activeAssignments);
  const requeuedWorkerIds = sortedAssignments.map(
    (assignment) => assignment.worker_account_id
  );

  await enqueueWorkersAtFront(requeuedWorkerIds);
  for (const workerId of requeuedWorkerIds) {
    sendWorkerSocketEvent(workerId, "WORKER_STATUS_CHANGED", {
      status: "ready",
      reason: "vehicle_job_cancelled_requeue",
    });
  }
  publishRealtimeEvent({
    type: "VEHICLE_JOB_CANCELLED",
    title: "Vehicle job cancelled",
    message: `Vehicle job ${vehicleJob.ticketNo} was cancelled and workers were requeued.`,
    payload: {
      ticketNo: vehicleJob.ticketNo,
      status: vehicleJob.status,
      requeued: true,
    },
    worker_payload: {
      ticketNo: vehicleJob.ticketNo,
      status: vehicleJob.status,
      requeued: true,
      reason: "vehicle_job_cancelled_requeue",
    },
    worker_account_ids: requeuedWorkerIds,
  });
  await dispatchReadyWorkers();
  publishNotification({
    type: "VEHICLE_JOB_CANCELLED_AND_REQUEUED",
    title: "Vehicle job cancelled and workers requeued",
    message: `Vehicle job ${vehicleJob.ticketNo} was cancelled and workers were requeued.`,
    payload: {
      ticketNo: vehicleJob.ticketNo,
      status: vehicleJob.status,
      requeued_worker_codes: await getWorkerCodesByAccountIds(requeuedWorkerIds),
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Vehicle job cancelled and workers requeued successfully.",
    ticketNo: vehicleJob.ticketNo,
    status: vehicleJob.status,
    requeued_worker_codes: await getWorkerCodesByAccountIds(requeuedWorkerIds),
  };
}

// Function เธขเธเน€เธฅเธดเธเธเธฒเธเธฃเธฐเธ”เธฑเธเธฃเธ–/เธ•เธฅเธฒเธ”/เนเธเธเธเนเธฒเธ endpoint เน€เธ”เธตเธขเธง
export async function cancelJob(body: unknown): Promise<AdminJobCancelResponse> {
  const input = parseWithSchema(adminJobCancelBodySchema, body);
  const cancelBody = {
    reason: input.reason,
  };

  if (input.target_type === "vehicle") {
    const workerAction = input.worker_action ?? "requeue";

    if (workerAction === "requeue") {
      return cancelVehicleJobAndRequeue(input.target_ref, cancelBody);
    }

    return cancelVehicleJob(input.target_ref, cancelBody);
  }

  if (input.target_type === "market") {
    return cancelMarketJob(input.target_ref, cancelBody);
  }

  return cancelStallJob(input.target_ref, cancelBody);
}

// Function เนเธซเน Admin assign เธเธฒเธเธฃเธ–เนเธซเน worker เนเธเธเธฃเธฐเธเธธเธฃเธฒเธขเธเธเน€เธญเธ
export async function assignVehicleJobWorkers(
  idParam: unknown,
  body: unknown
): Promise<AdminAssignWorkersResponse> {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  const input = parseWithSchema(adminAssignWorkersBodySchema, body);
  const workerCodes = [...new Set(input.worker_codes)];
  const settings = await getRuntimeSettings();
  const acceptDeadlineMs = settings.worker_accept_deadline_seconds * 1000;

  const { assignments, vehicleJob } = await withTransaction(async (transaction) => {
    const vehicleJob = await requireVehicleJobByRef(idParam, transaction);

    if (TERMINAL_JOB_STATUSES.includes(vehicleJob.status)) {
      throw new ApiError(409, "VEHICLE_JOB_CLOSED", "Vehicle job is already closed.");
    }

    const createdAssignments: VehicleJobAssignmentDto[] = [];

    for (const workerCode of workerCodes) {
      const worker = await adminJobsRepository.findWorkerByCode(workerCode, transaction);

      if (!worker) {
        throw new ApiError(404, "WORKER_NOT_FOUND", `Worker ${workerCode} not found.`);
      }

      const currentAssignment = await adminJobsRepository.findCurrentAssignmentByWorker(
        worker.id,
        transaction
      );

      if (worker.status !== "active") {
        throw new ApiError(403, "WORKER_NOT_ACTIVE", `Worker ${workerCode} is not active.`);
      }

      if (currentAssignment) {
        throw new ApiError(
          409,
          "WORKER_HAS_ACTIVE_ASSIGNMENT",
          `Worker ${workerCode} already has an active assignment.`
        );
      }

      const queueEntry = await getWorkerQueueStatus(worker.id);

      if (queueEntry?.status !== "ready") {
        throw new ApiError(
          409,
          "WORKER_NOT_READY",
          `Worker ${workerCode} must be ready in queue before admin can assign a job.`
        );
      }

      const assignment = await adminJobsRepository.createAssignment(
        vehicleJobId,
        worker.id,
        buildDeadline(acceptDeadlineMs),
        transaction
      );

      createdAssignments.push(assignment);
    }

    return {
      assignments: createdAssignments,
      vehicleJob,
    };
  });

  for (const assignment of assignments) {
    await markWorkerAssigned(assignment.worker_account_id);
    await scheduleAssignmentTimeout(
      assignment.id,
      assignment.worker_account_id,
      acceptDeadlineMs
    );
    sendWorkerSocketEvent(
      assignment.worker_account_id,
      "WORKER_ASSIGNED",
      buildWorkerAssignedPayload(assignment, vehicleJob)
    );
  }
  publishNotification({
    type: "ASSIGNMENT_CREATED_BY_ADMIN",
    title: "Workers assigned by admin",
    message: `${assignments.length} worker(s) were assigned to vehicle job ${vehicleJob.ticketNo}.`,
    payload: {
      ticketNo: vehicleJob.ticketNo,
      worker_codes: workerCodes,
      assignments: await buildAdminAssignmentResponses(vehicleJob.ticketNo, assignments),
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Workers assigned successfully.",
    ticketNo: vehicleJob.ticketNo,
    assignments: await buildAdminAssignmentResponses(vehicleJob.ticketNo, assignments),
  };
}

// Function เธขเธเน€เธฅเธดเธ assignment เธฃเธฒเธขเธเธ เนเธ”เธขเนเธกเนเน€เธ•เธดเธก worker เธเธเนเธซเธกเนเธเธฒเธเธเธดเธงเธญเธฑเธ•เนเธเธกเธฑเธ•เธด
export async function cancelAssignment(
  idParam: unknown,
  workerCodeParam: unknown,
  body: unknown
): Promise<AdminCancelAssignmentResponse> {
  const ticketNo = parseReference(
    idParam,
    "INVALID_VEHICLE_JOB_REF",
    "Ticket no is invalid."
  );
  const workerCode = parseReference(
    workerCodeParam,
    "INVALID_WORKER_CODE",
    "Worker code is invalid."
  );
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const assignment = await adminJobsRepository.findActiveAssignmentByVehicleJobRefAndWorkerCode(
    ticketNo,
    workerCode
  );

  if (!assignment) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
  }

  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
    throw new ApiError(409, "ASSIGNMENT_NOT_ACTIVE", "Assignment is not active.");
  }

  const vehicleJob = await adminJobsRepository.findVehicleJobById(assignment.vehicle_job_id);
  const cancelledAssignment = await adminJobsRepository.cancelAssignment(assignment.id);

  await removeAssignmentTimeout(assignment.id);
  await removeScanTimeout(assignment.id);
  await removeScanWarning(assignment.id);
  await markWorkerOpenApp(assignment.worker_account_id);
  sendWorkerSocketEvent(assignment.worker_account_id, "ASSIGNMENT_CANCELLED", {
    ticketNo: vehicleJob?.ticketNo ?? null,
    reason: "admin_cancel_assignment",
  });
  publishNotification({
    type: "ASSIGNMENT_CANCELLED",
    title: "Assignment cancelled",
    message: `Assignment for ${workerCode} on ${vehicleJob?.ticketNo ?? ticketNo} was cancelled by admin.`,
    payload: {
      ticketNo: vehicleJob?.ticketNo ?? ticketNo,
      worker_code: workerCode,
      status: cancelledAssignment.status,
      reason: "admin_cancel_assignment",
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Assignment cancelled successfully.",
    ticketNo: vehicleJob?.ticketNo ?? ticketNo,
    worker_code: workerCode,
    status: cancelledAssignment.status,
  };
}


// Function เธ•เนเธญเน€เธงเธฅเธฒ scan QR เนเธเธเธ—เธฑเนเธเธฃเธ– เธซเธฃเธทเธญเน€เธฅเธทเธญเธเน€เธเธเธฒเธฐ worker เนเธเธฃเธ–เธเธฑเนเธ
export async function extendVehicleJobScanDeadline(
  idParam: unknown,
  body: unknown
): Promise<AdminExtendScanDeadlineResponse> {
  const vehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = vehicleJob.id;
  const input = parseWithSchema(adminExtendScanDeadlineBodySchema, body);

  const assignments = (
    await adminJobsRepository.listAcceptedAssignmentsByVehicleJob(
      vehicleJobId,
      input.worker_codes
    )
  ).filter((assignment) => isScanDeadlineActive(assignment.scan_deadline_at));

  if (assignments.length === 0) {
    throw new ApiError(
      404,
      "ACCEPTED_ASSIGNMENTS_NOT_FOUND",
      "No active accepted assignments found for scan deadline extension."
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
  await Promise.all(
    updatedAssignments.flatMap((assignment) =>
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
  const assignmentResponses = await buildScanDeadlineAssignmentResponses(
    updatedAssignments
  );
  publishRealtimeEvent({
    type: "ASSIGNMENT_SCAN_DEADLINE_EXTENDED",
    title: "Scan deadline extended",
    message: `Scan deadline was extended for ${updatedAssignments.length} assignment(s).`,
    payload: {
      ticketNo: vehicleJob.ticketNo,
      minutes: input.minutes,
      worker_codes: input.worker_codes ?? null,
      assignments: assignmentResponses,
    },
    worker_payload: {
      ticketNo: vehicleJob.ticketNo,
      worker_qr_token: vehicleJob.worker_qr_token,
      minutes: input.minutes,
      assignments: assignmentResponses,
    },
    admin: true,
    worker_account_ids: updatedAssignments.map(
      (assignment) => assignment.worker_account_id
    ),
  });

  return {
    message: "Vehicle job scan deadline extended successfully.",
    ticketNo: vehicleJob.ticketNo,
    worker_qr_token: vehicleJob.worker_qr_token,
    assignments: assignmentResponses,
  };
}

// Function เธขเธเน€เธฅเธดเธเธเธฒเธเธ•เธฅเธฒเธ”เธเธฃเนเธญเธกเนเธเนเธ realtime เนเธเธขเธฑเธ Admin เนเธฅเธฐ worker เธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธ
async function cancelMarketJob(
  idParam: unknown,
  body: unknown
): Promise<AdminMarketJobActionResponse> {
  const existingMarketJob = await requireMarketJobByRef(idParam);
  const marketJobId = existingMarketJob.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});

  const marketJob = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelMarketJob(marketJobId, transaction);
  });
  const vehicleJob = await adminJobsRepository.findVehicleJobById(
    marketJob.vehicle_job_id
  );
  publishRealtimeEvent({
    type: "MARKET_JOB_CANCELLED",
    title: "Market job cancelled",
    message: `Market job ${marketJob.marketCode} was cancelled.`,
    payload: {
      ticketNo: vehicleJob?.ticketNo ?? null,
      marketCode: marketJob.marketCode,
      status: marketJob.status,
    },
    worker_payload: {
      ticketNo: vehicleJob?.ticketNo ?? null,
      marketCode: marketJob.marketCode,
      status: marketJob.status,
    },
    admin: true,
    worker_account_ids: await listVehicleJobWorkerIds(marketJob.vehicle_job_id),
  });

  return formatMarketJobActionResponse(
    "Market job cancelled successfully.",
    marketJob,
    vehicleJob
  );
}

// Function เธขเธเน€เธฅเธดเธเธเธฒเธเนเธเธเน€เธ”เธตเธขเธง
async function cancelStallJob(
  idParam: unknown,
  body: unknown
): Promise<AdminStallJobActionResponse> {
  const existingTicket = await requireStallJobByRef(idParam);
  const ticketId = existingTicket.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});

  const ticket = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelGateTicket(ticketId, transaction);
  });
  const vehicleJob = await adminJobsRepository.findVehicleJobById(
    ticket.vehicle_job_id
  );
  const marketJob = await adminJobsRepository.findMarketJobById(
    ticket.market_job_id
  );
  publishRealtimeEvent({
    type: "STALL_JOB_CANCELLED",
    title: "Stall job cancelled",
    message: `Stall job ${ticket.boothCode} was cancelled.`,
    payload: {
      ticketNo: vehicleJob?.ticketNo ?? null,
      marketCode: marketJob?.marketCode ?? null,
      boothCode: ticket.boothCode,
      status: ticket.status,
      confirmation_status: ticket.confirmation_status,
    },
    worker_payload: {
      ticketNo: vehicleJob?.ticketNo ?? null,
      marketCode: marketJob?.marketCode ?? null,
      boothCode: ticket.boothCode,
      status: ticket.status,
      confirmation_status: ticket.confirmation_status,
    },
    admin: true,
    worker_account_ids: await listStallJobWorkerIds(ticket),
  });

  return formatStallJobActionResponse(
    "Stall job cancelled successfully.",
    ticket,
    vehicleJob,
    marketJob
  );
}

// Function เน€เธเธดเธ”เธเธฒเธเนเธเธเธ—เธตเน vendor confirm เธเธดเธ” เนเธซเน worker เธชเนเธเธขเธญเธ”เนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธ

