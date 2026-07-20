import { withTransaction } from "../db/prisma";
import { enqueueWorkersAtFront, getWorkerQueueStatus, markWorkerAssigned, markWorkerOpenApp, removeAssignmentTimeout, removeScanTimeout, removeScanWarning, scheduleAssignmentTimeout, scheduleScanTimeout, scheduleScanWarning } from "../queues/worker-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as adminJobsRepository from "../repositories/admin-jobs.repository";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./realtime.service";
import { getRuntimeSettings } from "./admin-settings.service";
// import Types
import type { AdminAssignmentResponse, AdminAssignWorkersResponse, AdminCancelAssignmentResponse, AdminCancelVehicleJobAndRequeueResponse, AdminExtendScanDeadlineResponse, AdminJobCancelResponse, AdminMarketJobActionResponse, AdminScanDeadlineAssignmentResponse, AdminStallJobActionResponse, AdminVehicleJobActionResponse, AdminVehicleJobHistoryItemResponse, AdminVehicleJobListItemResponse } from "../types/admin-jobs.type";
import type { GateTicketDto, MarketJobDto, TicketProductDto, VehicleJobAssignmentDto, VehicleJobDetailResponse, VehicleJobDto } from "../types/worker.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { adminAssignWorkersBodySchema, adminCancelBodySchema, adminExtendScanDeadlineBodySchema, adminJobCancelBodySchema, adminVehicleJobListQuerySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";
import { ACTIVE_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES } from "../constants/job-status";
import { buildBangkokDateSpanRange, buildDeadline, getDelayUntil } from "../utils/time";
import { buildWorkerAssignedPayload } from "../utils/worker-assignment-event";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลง path/query param ที่เป็น reference และโยน error ถ้าค่าว่าง
function parseReference(value: unknown, code: string, message: string): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(400, code, message);
  }

  return reference;
}

// Function จัดรูป vehicle job สำหรับ response ฝั่ง Admin โดยใช้ reference แทน id ภายใน
function formatPublicVehicleJobListItem(vehicleJob: VehicleJobDto): AdminVehicleJobListItemResponse {
  return {
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    gate_transaction_ref: vehicleJob.gate_transaction_ref,
    license_plate: vehicleJob.license_plate,
    vehicle_type: vehicleJob.vehicle_type,
    workers_required: vehicleJob.workers_required,
    status: vehicleJob.status,
  };
}

function formatVehicleJobActionResponse(
  message: string,
  vehicleJob: VehicleJobDto
): AdminVehicleJobActionResponse {
  return {
    message,
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    status: vehicleJob.status,
  };
}

// Function จัดรูปสินค้าใน ticket สำหรับ response ฝั่ง Admin
function formatPublicProduct(product: TicketProductDto) {
  return {
    product_ref: product.product_ref,
    product_type: product.product_type,
    name: product.name,
    quantity: product.quantity,
    confirmed_quantity: product.confirmed_quantity,
    unit: product.unit,
  };
}

// Function จัดรูป ticket/แผงสำหรับ response ฝั่ง Admin
function formatPublicTicket(ticket: GateTicketDto & { products?: TicketProductDto[] }) {
  return {
    stall_job_ref: ticket.stall_job_ref,
    ticket_no: ticket.ticket_no,
    stall_no: ticket.stall_no,
    vendor_name: ticket.vendor_name,
    vendor_line_id: ticket.vendor_line_id,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    ...(ticket.products && {
      products: ticket.products.map(formatPublicProduct),
    }),
  };
}

// Function จัดรูป market job สำหรับ response ฝั่ง Admin
function formatPublicMarket(market: MarketJobDto) {
  return {
    market_job_ref: market.market_job_ref,
    market_name: market.market_name,
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
    vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
    market_job_ref: market.market_job_ref,
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
    vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
    market_job_ref: marketJob?.market_job_ref ?? null,
    stall_job_ref: ticket.stall_job_ref,
    ticket_no: ticket.ticket_no,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
  };
}

// Function จัดรูปงานรถพร้อมตลาดและแผงสำหรับ response ฝั่ง Admin
// Function หา vehicle job ด้วย vehicle_job_ref และโยน error ถ้าไม่พบ
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

async function requireVehicleJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findVehicleJobByRef>[1]
): Promise<VehicleJobDto> {
  const vehicleJobRef = parseReference(
    idParam,
    "INVALID_VEHICLE_JOB_REF",
    "Vehicle job ref is invalid."
  );
  const vehicleJob = await adminJobsRepository.findVehicleJobByRef(vehicleJobRef, connection);

  if (!vehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return vehicleJob;
}

// Function หา market job ด้วย market_job_ref และโยน error ถ้าไม่พบ
async function requireMarketJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findMarketJobByRef>[1]
): Promise<MarketJobDto> {
  const marketJobRef = parseReference(
    idParam,
    "INVALID_MARKET_JOB_REF",
    "Market job ref is invalid."
  );
  const marketJob = await adminJobsRepository.findMarketJobByRef(marketJobRef, connection);

  if (!marketJob) {
    throw new ApiError(404, "MARKET_JOB_NOT_FOUND", "Market job not found.");
  }

  return marketJob;
}

// Function หา stall/ticket ด้วย stall_job_ref และโยน error ถ้าไม่พบ
async function requireStallJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findGateTicketByRef>[1]
): Promise<GateTicketDto> {
  const stallJobRef = parseReference(
    idParam,
    "INVALID_STALL_JOB_REF",
    "Stall job ref is invalid."
  );
  const ticket = await adminJobsRepository.findGateTicketByRef(stallJobRef, connection);

  if (!ticket) {
    throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
  }

  return ticket;
}

// Function สร้างเวลา deadline จากเวลาปัจจุบัน
// Function เรียง worker ที่ถูก Admin ยกเลิกงานให้กลับเข้าหัวคิวตามเวลารับงาน
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

// Function คำนวณ scan deadline ใหม่ โดยต่อจาก deadline เดิมถ้ายังไม่หมดเวลา
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

// Function สร้าง response assignment หลังต่อเวลา scan deadline พร้อม worker_code
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

// Function สร้าง response assignment ของ Admin โดยใช้ vehicle_job_ref และ worker_code
async function buildAdminAssignmentResponses(
  vehicleJobRef: string,
  assignments: VehicleJobAssignmentDto[]
): Promise<AdminAssignmentResponse[]> {
  const workerCodeMap = await getWorkerCodeMapByAccountIds(
    assignments.map((assignment) => assignment.worker_account_id)
  );

  return assignments.map((assignment) => ({
    vehicle_job_ref: vehicleJobRef,
    worker_code: workerCodeMap.get(assignment.worker_account_id) ?? null,
    status: assignment.status,
    accept_deadline_at: assignment.accept_deadline_at,
    scan_deadline_at: assignment.scan_deadline_at,
    created_at: assignment.created_at,
    updated_at: assignment.updated_at,
  }));
}

// Function แปลง account id ของ worker เป็นรหัสพนักงานสำหรับ response/event
async function getWorkerCodesByAccountIds(workerIds: number[]): Promise<Array<string | null>> {
  const workerCodeMap = await getWorkerCodeMapByAccountIds(workerIds);

  return workerIds.map((workerId) => workerCodeMap.get(workerId) ?? null);
}

// Function สร้างช่วงเวลาของวันที่ไทยเพื่อใช้ query งานรถรายวัน
// Function รวม receiver ของ SSE สำหรับงานแผงที่เกี่ยวข้อง
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
// Function ดึงรายการงานรถสำหรับ Admin
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

// Function ดึงรายละเอียดงานรถสำหรับ Admin
// Function ยกเลิกงานรถทั้งหมด และพา worker ที่ถือ assignment กลับไปสถานะ open_app
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
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      reason: "vehicle_job_cancelled",
    });
  });
  publishRealtimeEvent({
    type: "VEHICLE_JOB_CANCELLED",
    title: "Vehicle job cancelled",
    message: `Vehicle job ${vehicleJob.vehicle_job_ref} was cancelled.`,
    payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      status: vehicleJob.status,
    },
    worker_payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
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

// Function ยกเลิกงานรถทั้งคัน และนำ worker ที่ถือ assignment กลับเข้าหัวคิวตามเวลารับงาน
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
    message: `Vehicle job ${vehicleJob.vehicle_job_ref} was cancelled and workers were requeued.`,
    payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      status: vehicleJob.status,
      requeued: true,
    },
    worker_payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
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
    message: `Vehicle job ${vehicleJob.vehicle_job_ref} was cancelled and workers were requeued.`,
    payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      status: vehicleJob.status,
      requeued_worker_codes: await getWorkerCodesByAccountIds(requeuedWorkerIds),
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Vehicle job cancelled and workers requeued successfully.",
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    status: vehicleJob.status,
    requeued_worker_codes: await getWorkerCodesByAccountIds(requeuedWorkerIds),
  };
}

// Function ยกเลิกงานระดับรถ/ตลาด/แผงผ่าน endpoint เดียว
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

// Function ให้ Admin assign งานรถให้ worker แบบระบุรายคนเอง
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
    message: `${assignments.length} worker(s) were assigned to vehicle job ${vehicleJob.vehicle_job_ref}.`,
    payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      worker_codes: workerCodes,
      assignments: await buildAdminAssignmentResponses(vehicleJob.vehicle_job_ref, assignments),
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Workers assigned successfully.",
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    assignments: await buildAdminAssignmentResponses(vehicleJob.vehicle_job_ref, assignments),
  };
}

// Function ยกเลิก assignment รายคน โดยไม่เติม worker คนใหม่จากคิวอัตโนมัติ
export async function cancelAssignment(
  idParam: unknown,
  workerCodeParam: unknown,
  body: unknown
): Promise<AdminCancelAssignmentResponse> {
  const vehicleJobRef = parseReference(
    idParam,
    "INVALID_VEHICLE_JOB_REF",
    "Vehicle job ref is invalid."
  );
  const workerCode = parseReference(
    workerCodeParam,
    "INVALID_WORKER_CODE",
    "Worker code is invalid."
  );
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const assignment = await adminJobsRepository.findActiveAssignmentByVehicleJobRefAndWorkerCode(
    vehicleJobRef,
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
    vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
    reason: "admin_cancel_assignment",
  });
  publishNotification({
    type: "ASSIGNMENT_CANCELLED",
    title: "Assignment cancelled",
    message: `Assignment for ${workerCode} on ${vehicleJob?.vehicle_job_ref ?? vehicleJobRef} was cancelled by admin.`,
    payload: {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? vehicleJobRef,
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
    vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? vehicleJobRef,
    worker_code: workerCode,
    status: cancelledAssignment.status,
  };
}


// Function ต่อเวลา scan QR แบบทั้งรถ หรือเลือกเฉพาะ worker ในรถนั้น
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
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
      minutes: input.minutes,
      worker_codes: input.worker_codes ?? null,
      assignments: assignmentResponses,
    },
    worker_payload: {
      vehicle_job_ref: vehicleJob.vehicle_job_ref,
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
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    worker_qr_token: vehicleJob.worker_qr_token,
    assignments: assignmentResponses,
  };
}

// Function ยกเลิกงานตลาดพร้อมแจ้ง realtime ไปยัง Admin และ worker ที่เกี่ยวข้อง
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
    message: `Market job ${marketJob.market_job_ref} was cancelled.`,
    payload: {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
      market_job_ref: marketJob.market_job_ref,
      status: marketJob.status,
    },
    worker_payload: {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
      market_job_ref: marketJob.market_job_ref,
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

// Function ยกเลิกงานแผงเดียว
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
    message: `Stall job ${ticket.ticket_no ?? ticket.stall_job_ref} was cancelled.`,
    payload: {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
      market_job_ref: marketJob?.market_job_ref ?? null,
      stall_job_ref: ticket.stall_job_ref,
      ticket_no: ticket.ticket_no,
      status: ticket.status,
      confirmation_status: ticket.confirmation_status,
    },
    worker_payload: {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
      market_job_ref: marketJob?.market_job_ref ?? null,
      stall_job_ref: ticket.stall_job_ref,
      ticket_no: ticket.ticket_no,
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

// Function เปิดงานแผงที่ vendor confirm ผิด ให้ worker ส่งยอดใหม่อีกครั้ง
