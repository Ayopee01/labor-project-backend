import { withTransaction } from "../db/prisma";
import { enqueueWorkersAtFront, getWorkerQueueStatus, markWorkerAssigned, markWorkerOpenApp, removeAssignmentTimeout, removeScanTimeout, removeScanWarning, scheduleAssignmentTimeout, scheduleScanTimeout, scheduleScanWarning } from "../queues/worker-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as adminJobsRepository from "../repositories/admin-jobs.repository";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "../utils/realtime-event";
import { getRuntimeSettings } from "./admin-settings.service";
import { getWorkerCodeMapByAccountIds, getWorkerCodesByAccountIds } from "../utils/worker-identity";
import {
  buildVehicleOperationSummary,
  formatVehicleOperationItem,
} from "../utils/admin-job-operations.formatter";
// Import Types
import type { AdminAssignmentResponse, AdminAssignWorkersResponse, AdminCancelAssignmentResponse, AdminCancelVehicleJobAndRequeueResponse, AdminExtendScanDeadlineResponse, AdminJobCancelResponse, AdminMarketJobActionResponse, AdminScanDeadlineAssignmentResponse, AdminStallJobActionResponse, AdminVehicleJobActionResponse, AdminVehicleJobHistoryItemResponse, AdminVehicleJobListItemResponse, AdminVehicleJobOperationListResponse } from "../types/admin-jobs.type";
import type { GateTicketDto, MarketJobDto, TicketProductDto, VehicleJobAssignmentDto, VehicleJobDetailResponse, VehicleJobDto } from "../types/worker.type";
// Import Validation
import { parseWithSchema } from "../validation/parser";
import { adminAssignWorkersBodySchema, adminCancelBodySchema, adminExtendScanDeadlineBodySchema, adminJobCancelBodySchema, adminVehicleJobListQuerySchema, adminVehicleJobOperationsQuerySchema } from "../validation/schemas";
// Import Utils
import ApiError from "../utils/api-error";
import { ACTIVE_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES } from "../constants/job-status";
import { buildBangkokDateSpanRange, buildDeadline, getDelayUntil } from "../utils/time";
import { buildWorkerAssignedPayload } from "../utils/worker-assignment-event";
import { WORKER_WORK_STATUS } from "../types/shared/worker-status.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function อ่านค่า reference ใน service flow
function parseReference(value: unknown, code: string, message: string): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(400, code, message);
  }

  return reference;
}

// Function จัดรูปแบบ public vehicle job list item ใน service flow
function formatPublicVehicleJobListItem(vehicleJob: VehicleJobDto): AdminVehicleJobListItemResponse {
  return {
    ticketNo: vehicleJob.ticketNo,
    gate_transaction_ref: vehicleJob.gate_transaction_ref,
    license_plate: vehicleJob.license_plate,
    vehicle_type: vehicleJob.vehicle_type,
    ticket_created_at: vehicleJob.ticket_created_at,
    booth_count: vehicleJob.booth_count,
    workers_required: vehicleJob.workers_required,
    dispatch_now: vehicleJob.dispatch_now,
    status: vehicleJob.status,
  };
}

// Function จัดรูปแบบ vehicle job action response ใน service flow
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

// Function จัดรูปแบบ public product ใน service flow
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

// Function จัดรูปแบบ public ticket ใน service flow
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

// Function จัดรูปแบบ public market ใน service flow
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

// Function จัดรูปแบบ market job action response ใน service flow
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

// Function จัดรูปแบบ stall job action response ใน service flow
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

// Function จัดรูปแบบ public vehicle job history detail ใน service flow
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

// Function ตรวจสอบและดึง vehicle job ตาม ref ใน service flow
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

// Function ตรวจสอบและดึง market job ตาม ref ใน service flow
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

// Function ตรวจสอบและดึง stall job ตาม ref ใน service flow
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

// Function จัดการ assignment queue priority at ใน service flow
function assignmentQueuePriorityAt(assignment: VehicleJobAssignmentDto): number {
  const value = assignment.accepted_at ?? assignment.created_at;
  const timestamp = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;

  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

// Function เรียง assignments สำหรับ admin cancel requeue ใน service flow
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

// Function ต่อเวลา deadline ใน service flow
function extendDeadline(currentDeadline: string | null, minutes: number): Date {
  const now = Date.now();
  const currentTime = currentDeadline ? new Date(currentDeadline).getTime() : now;
  const baseTime = Math.max(now, currentTime);

  return new Date(baseTime + minutes * 60 * 1000);
}

// Function ตรวจว่า scan deadline active ใน service flow
function isScanDeadlineActive(scanDeadlineAt: string | null): boolean {
  if (!scanDeadlineAt) {
    return false;
  }

  const deadlineMs = new Date(scanDeadlineAt).getTime();

  return Number.isFinite(deadlineMs) && deadlineMs > Date.now();
}

// Function สร้าง scan deadline assignment responses ใน service flow
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

// Function สร้าง admin assignment responses ใน service flow
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

// Function ดึงรายการ vehicle job worker IDs ใน service flow
async function listVehicleJobWorkerIds(vehicleJobId: number): Promise<number[]> {
  const assignments = await adminJobsRepository.listActiveAssignmentsByVehicleJob(
    vehicleJobId
  );

  return [
    ...new Set(assignments.map((assignment) => assignment.worker_account_id)),
  ];
}

// Function ดึงรายการ stall job worker IDs ใน service flow
async function listStallJobWorkerIds(ticket: GateTicketDto): Promise<number[]> {
  const ticketWorkers = await adminJobsRepository.listTicketWorkers(ticket.id);

  if (ticketWorkers.length > 0) {
    return [
      ...new Set(ticketWorkers.map((worker) => worker.worker_account_id)),
    ];
  }

  return listVehicleJobWorkerIds(ticket.vehicle_job_id);
}

// Function ดึงรายการ vehicle jobs ใน service flow
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

// Function ดึงรายการ vehicle job operations ใน service flow
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

// Function ยกเลิก vehicle job ใน service flow
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

// Function ยกเลิก vehicle job และ requeue ใน service flow
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
      status: WORKER_WORK_STATUS.READY,
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

// Function ยกเลิก job ใน service flow
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

// Function จัดการ vehicle job workers ใน service flow
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

      if (queueEntry?.status !== WORKER_WORK_STATUS.READY) {
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

// Function ยกเลิก assignment ใน service flow
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
  const cancelledAssignment = await withTransaction(async (transaction) => adminJobsRepository.cancelAssignment(assignment.id, transaction));

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


// Function ต่อเวลา vehicle job scan deadline ใน service flow
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

// Function ยกเลิก market job ใน service flow
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

// Function ยกเลิก stall job ใน service flow
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

