// Import Library
import { Prisma } from "@prisma/client";
// Import Dependencies
import { withTransaction } from "../db/prisma";
import { decrementWorkerBreakCount, enqueueWorker, getWorkerQueueStatus, incrementWorkerBreakCount, markWorkerBreak, markWorkerOpenApp, removeAssignmentTimeout, removeScanTimeout, removeScanWarning, removeWorkerBreakReturn, scheduleScanTimeout, scheduleScanWarning, scheduleWorkerBreakReturn } from "../queues/worker-queue";
import { dispatchReadyWorkers, handleAssignmentAcceptTimeout } from "../queues/worker-dispatch";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as workerApplicationRepository from "../repositories/worker.repository";
import * as masterWorkerRepository from "../repositories/shared/master-worker.repository";
import * as workScheduleRepository from "../repositories/shared/work-schedule.repository";
import * as profileRepository from "../repositories/shared/profile.repository";
import * as assignmentRepository from "../repositories/shared/vehicle-job-assignment.repository";
import * as workerAssignmentEventRepository from "../repositories/shared/worker-assignment-event.repository";
import * as gateTicketRepository from "../repositories/shared/gate-ticket.repository";
import * as marketJobRepository from "../repositories/shared/market-job.repository";
import * as masterDataRepository from "../repositories/shared/master-data.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import * as workerShiftAttendanceRepository from "../repositories/shared/worker-shift-attendance.repository";
import * as vehicleJobLifecycleService from "./shared/vehicle-job-lifecycle.service";
import * as ticketCompletionService from "./shared/ticket-completion.service";
import { checkMobileAppVersionForClient } from "./shared/mobile-app-version.service";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./shared/realtime-notification.service";
import { getRuntimeSettings } from "./shared/runtime-settings.service";
import { publishAdminWorkerStatusChanged } from "./notifications.service";
import { buildWorkerDailySummary, closeWorkerAttendanceShift, markWorkerAttendanceOnline, scheduleWorkerShiftEndIfNeeded } from "./shared/worker-attendance.service";
// Import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { GateTicketDto, TicketCompletionResponse, VehicleJobAssignmentDto, VehicleJobDetailResponse, VehicleWorkReadinessDto, WorkerAssignmentAcceptResponse, WorkerAssignmentCheckInResponse, WorkerAssignmentHistoryItemDto, WorkerAssignmentHistoryItemResponse, WorkerAssignmentHistoryResponse, WorkerAssignmentTeamMemberDto, WorkerBreakResponse, WorkerCurrentJobResponse, WorkerEarningsSummaryResponse, WorkerOnlineResponse, WorkerProductPackageOptionsResponse, WorkerQueueEntryDto, WorkerStatusResponse } from "../types/worker.type";
import { WORKER_WORK_STATUS, type WorkerWorkStatus } from "../types/shared/worker-status.type";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";
import type { DbConnection } from "../types/shared/common.type";
import { ASSIGNMENT_STATUS, TICKET_SUBMITTER_ROLE } from "../constants/job-status";
// Import Validation
import { parseWithSchema } from "../validation/parser";
import { workerAssignmentHistoryQuerySchema, workerCheckInBarcodeBodySchema, workerEarningsSummaryQuerySchema, workerTicketCompleteBodySchema } from "../validation/schemas";
// Import Utils
import ApiError from "../utils/api-error";
import { buildShiftWaitInfo, buildWorkScheduleShiftInstanceKey, formatScheduleWithShift, isTimeInWorkSchedule } from "../utils/shift";
import { buildBangkokDateRange, buildBangkokDateSpanRange, buildDeadline, buildLatestCompletedBangkokDateRange, buildRemainingBreakTime, formatBangkokDate, formatBangkokDisplayDate, formatBangkokDisplayDateTime, getDelayUntil, toUnixMs } from "../utils/time";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { buildWorkerQueueSocketPayload } from "../utils/worker-payload";
import { resolveWorkerWorkStatus } from "../utils/worker-status";

/* -------------------------------------- Config -------------------------------------- */

// จำนวนวันย้อนหลังที่แสดงใน "สรุปรายได้ Worker" (getWorkerEarningsSummary)
const EARNINGS_SUMMARY_DAY_COUNT = 15;

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจ Mobile App Version ตอนเปิด App ใน service flow — Public ไม่ต้อง Login, แค่ pass
// through ไปยัง shared service ที่เป็น Single Source of Truth ของ Effective Version
export async function checkMobileAppVersion(query: unknown) {
  return checkMobileAppVersionForClient(query);
}

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
  coatNo: string | null,
): WorkerAssignmentAcceptResponse {
  return {
    ticket_number: detail.vehicle_job.ticket_number,
    worker_code: workerCode,
    shirt_number: coatNo,
    accepted_at: assignment.accepted_at,
    license_plate: detail.vehicle_job.license_plate,
    license_plate_province: detail.vehicle_job.license_plate_province,
    scan_deadline_at: assignment.scan_deadline_at,
    scan_deadline_unix_ms: toUnixMs(assignment.scan_deadline_at),
    team: team.map((member) => ({
      full_name: member.full_name,
      worker_code: member.worker_code,
      shirt_number: member.coat_no ?? null,
      image_url: member.image_url,
      scan_status: member.scan_status,
    })),
    markets: detail.markets.map((market) => ({
      ticket_no: market.ticket_no,
      marketName: market.marketName,
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
  teamScan: VehicleWorkReadinessDto,
  scannedTicketNo: string | null,
): WorkerCurrentJobResponse {
  return {
    scanned_ticket_no: scannedTicketNo,
    ticket_number: detail.vehicle_job.ticket_number,
    license_plate: detail.vehicle_job.license_plate,
    license_plate_province: detail.vehicle_job.license_plate_province,
    accept_deadline_at:
      assignment.status === ASSIGNMENT_STATUS.PENDING
        ? assignment.accept_deadline_at
        : null,
    accept_deadline_unix_ms:
      assignment.status === ASSIGNMENT_STATUS.PENDING
        ? toUnixMs(assignment.accept_deadline_at)
        : null,
    scan_deadline_at:
      assignment.status === ASSIGNMENT_STATUS.ACCEPTED
        ? assignment.scan_deadline_at
        : null,
    scan_deadline_unix_ms:
      assignment.status === ASSIGNMENT_STATUS.ACCEPTED
        ? toUnixMs(assignment.scan_deadline_at)
        : null,
    work_started_at:
      detail.vehicle_job.work_started_at,
    work_started_at_unix_ms:
      toUnixMs(detail.vehicle_job.work_started_at),
    vehicle_type: detail.vehicle_job.vehicle_type,
    team_scan: buildWorkerTeamScanResponse(teamScan),
    markets: detail.markets.map((market) => ({
      ticket_no: market.ticket_no,
      marketCode: market.marketCode,
      marketName: market.marketName,
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
      shirt_number: member.coat_no ?? null,
      image_url: member.image_url,
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
      shirt_number: member.coat_no ?? null,
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

  for (const workerId of new Set(
    team
      .map((member) => member.worker_id)
      .filter((value): value is number => typeof value === "number"),
  )) {
    sendWorkerSocketEvent(
      workerId,
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


// Function ตรวจสอบว่า auth payload ปัจจุบันเป็นบัญชี worker ที่ active
async function requireWorker(auth?: AccessTokenPayload) {
  if (!auth) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }

  if (auth.role !== "worker") {
    throw new ApiError(403, "FORBIDDEN", "Worker account is required.");
  }

  const worker = await masterWorkerRepository.findById(auth.account_id);

  if (!worker || worker.status !== 1) {
    throw new ApiError(
      403,
      "WORKER_NOT_ACTIVE",
      "Worker account is not active.",
    );
  }

  return worker;
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
  workerId: number,
  connection?: Parameters<
    typeof assignmentRepository.findCurrentAssignmentByVehicleJobRefAndWorker
  >[2],
): Promise<VehicleJobAssignmentDto | null> {
  const reference = parseAssignmentReference(value);

  return assignmentRepository.findCurrentAssignmentByVehicleJobRefAndWorker(
    reference,
    workerId,
    connection,
  );
}

// Function ค้นหา Gate ticket สำหรับ completion จาก assignment ปัจจุบันของ worker + booth ใน
// service flow — scope ด้วย vehicle_job_id ของ assignment ที่ worker กำลัง active อยู่ แทนที่จะรับ
// TicketNumber จาก client (worker ส่งยอดได้แค่ของรถที่ตัวเองกำลังทำงานอยู่เท่านั้นอยู่แล้ว)
async function findGateTicketForCompletionByCurrentAssignment(
  workerId: number,
  ticketNoParam: unknown,
  boothCodeParam: unknown,
  connection?: Parameters<
    typeof gateTicketRepository.findGateTicketForCompletion
  >[1],
): Promise<GateTicketDto | null> {
  const ticketNo = String(ticketNoParam ?? "").trim();
  const boothCode = String(boothCodeParam ?? "").trim();

  if (!ticketNo) {
    throw new ApiError(400, "INVALID_TICKET_NO", "ticket_no is invalid.");
  }

  if (!boothCode) {
    throw new ApiError(400, "INVALID_BOOTH_CODE", "BoothCode is invalid.");
  }

  const assignment = await assignmentRepository.findCurrentAssignmentByWorker(
    workerId,
    connection,
  );

  if (assignment) {
    const ticketOnCurrentAssignment =
      await gateTicketRepository.findGateTicketForCompletionByVehicleJobIdAndTicketNoAndBoothCode(
        assignment.vehicle_job_id,
        ticketNo,
        boothCode,
        connection,
      );

    if (ticketOnCurrentAssignment) {
      return ticketOnCurrentAssignment;
    }
  }

  // Fallback: ไม่พบภายใต้ assignment "current/active" ของ worker (ไม่มีเลย หรือมีแต่เป็นคันอื่น) —
  // อาจเป็นเพราะ Admin release-workers ไปแล้ว (worker อาจถูก dispatch ไปคันอื่นต่อ) แล้ว Vendor reject
  // ยอดที่ส่งไว้ก่อนหน้า worker/Admin ต้องยังส่งยอดใหม่ให้ TicketNumber เดิมได้อยู่ ไม่ผูกกับ assignment
  // ที่ active อยู่ตอนนี้ — ยึดจากประวัติ scan เข้างานจริงแทน (SCANNED_ASSIGNMENT_STATUSES รวม RELEASED)
  const ticketViaHistory =
    await gateTicketRepository.findGateTicketForCompletionByWorkerHistoryAndTicketNoAndBoothCode(
      workerId,
      ticketNo,
      boothCode,
      connection,
    );

  if (!ticketViaHistory) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
  }

  return ticketViaHistory;
}

// Function ดึงรายการ PackageCode ที่ยังใช้งานอยู่ของ ProductCode เดียว ให้ Worker เลือกตอนแก้ไข
// ยอดส่ง — ProductCode ต้องเป็นตัวเดียวกับสินค้าที่ปรากฏอยู่แล้วในแผงที่กำลังจะส่งยอด (ดูได้จาก
// current job detail) PackageName ไว้แสดงบน UI เท่านั้น ต้องส่ง PackageCode กลับตอน submit จริง
export async function getWorkerProductPackageOptions(
  productCodeParam: unknown,
  auth?: AccessTokenPayload,
): Promise<WorkerProductPackageOptionsResponse> {
  await requireWorker(auth);

  const productCode = String(productCodeParam ?? "").trim();

  if (!productCode) {
    throw new ApiError(400, "INVALID_PRODUCT_CODE", "ProductCode is invalid.");
  }

  const rows =
    await masterDataRepository.findActiveMasterProductPackagesByProductCode(
      productCode,
    );

  if (rows.length === 0) {
    throw new ApiError(
      404,
      "PRODUCT_NOT_FOUND",
      "Active product was not found.",
    );
  }

  // ตัด ProductCode+PackageCode ที่ ambiguous จริงออก (ตรงกับ master_product มากกว่า 1 แถว และ
  // PackageWeight ไม่ตรงกัน) เพราะถ้า Worker เลือกมา submit จะไม่ผ่านแน่นอน (จะชน
  // AMBIGUOUS_PRODUCT_PACKAGE) — คู่ที่ซ้ำแต่ PackageWeight เท่ากันทุกแถวถือว่า resolve ได้ (ไม่
  // ambiguous จริง ดู resolveDeterministicCandidate ใน rate-resolution.service.ts) ให้เหลือแค่ 1
  // รายการต่อคู่ ไม่ตัดออกทั้งคู่เหมือนเดิม
  const weightsByPairKey = new Map<string, Set<number>>();

  for (const row of rows) {
    const key = `${row.productCode}:${row.packageCode}`;
    const weights = weightsByPairKey.get(key) ?? new Set<number>();

    weights.add(row.packageWeight);
    weightsByPairKey.set(key, weights);
  }

  const seenPairKeys = new Set<string>();
  const packages = rows.flatMap((row) => {
    const key = `${row.productCode}:${row.packageCode}`;

    if ((weightsByPairKey.get(key)?.size ?? 0) > 1) {
      return [];
    }

    if (seenPairKeys.has(key)) {
      return [];
    }

    seenPairKeys.add(key);

    return [
      {
        PackageCode: row.packageCode,
        PackageName: row.packageName,
        PackageWeight: row.packageWeight,
      },
    ];
  });

  return {
    ProductCode: productCode,
    ProductName: rows[0].productName,
    Packages: packages,
  };
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
          worker_id: account.id,
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

    const workerCode = account.labor_code;
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
  const workerCode = account.labor_code;
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
  const [queueEntry, currentAssignment] = await Promise.all([
    getWorkerQueueStatus(account.id),
    assignmentRepository.findCurrentAssignmentByWorker(account.id),
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

  // Increment ก่อนเช็ค limit เสมอ (ไม่ใช่เช็คค่าเก่าก่อนแล้วค่อย increment) — Redis INCR atomic ในตัวเอง
  // จึงกันสอง request "กดพักเบรก" พร้อมกัน (double-tap/retry) อ่านค่าเดิมเดียวกันแล้วผ่าน limit
  // ทั้งคู่จนเกิน worker_break_limit จริงได้ ถ้า increment แล้วเกิน limit ต้อง decrement คืนทันที
  // (compensating action) ก่อน throw
  const breakCountUsed = await incrementWorkerBreakCount(
    account.id,
    shiftInstanceKey,
  );

  if (breakCountUsed > settings.worker_break_limit) {
    await decrementWorkerBreakCount(account.id, shiftInstanceKey);

    throw new ApiError(
      409,
      "BREAK_LIMIT_REACHED",
      "Worker break limit reached for this shift.",
    );
  }

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
  const workerCode = account.labor_code;
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
    full_name: account.full_name ?? account.labor_code,
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

  const [currentSchedule, queueEntry, currentAssignment] =
    await Promise.all([
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
  // shift_active ต้องผ่านทั้ง 2 เงื่อนไข ไม่ใช่แค่ข้อใดข้อหนึ่ง:
  // 1) เวลาปัจจุบันต้องอยู่ในช่วงกะจริงตาม DB (เงื่อนไขเดียวกับที่ workerOnline ใช้ตรวจก่อน throw
  //    OUTSIDE_WORK_SHIFT ห้าม duplicate logic นี้แยกที่อื่น)
  // 2) ต้องยังมีสิทธิ์เข้าคิวของกะนี้ตาม WorkerShiftAttendance ด้วย (ยังไม่ถูกปิดกะไป — closedAt ต้อง
  //    เป็น null) เพราะแค่ "อยู่ในกะ" อย่างเดียวไม่พอ ถ้าออกกะไปแล้วก่อนหน้านี้ต้องเป็น false ทันที
  //    ไม่ต้องรอให้พ้นเวลากะก่อน
  const isWithinShiftTime = Boolean(
    currentSchedule && isTimeInWorkSchedule(currentSchedule),
  );
  const attendance = currentSchedule
    ? await workerShiftAttendanceRepository.findByWorkerAndShift({
        worker_id: account.id,
        shift_instance_key: buildWorkScheduleShiftInstanceKey(currentSchedule),
      })
    : null;
  const hasShiftAttendanceEligibility = attendance?.closedAt == null;
  const response: WorkerStatusResponse = {
    full_name: account.full_name ?? account.labor_code,
    worker_code: account.labor_code,
    image_url: account.image_url,
    status,
    ...dailySummary,
    nationality: account.nationality,
    work_start_date: account.work_start_date,
    phone: account.telephone,
    shift: schedule
      ? {
          name: schedule.shift_name,
          start_time: schedule.shift_start_time,
          end_time: schedule.shift_end_time,
        }
      : null,
    shift_active: isWithinShiftTime && hasShiftAttendanceEligibility,
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
    const [detail, team, teamScan, scannedEventMetadata] = await Promise.all([
      vehicleJobRepository.getVehicleJobDetail(
        currentAssignment.vehicle_job_id,
      ),
      assignmentRepository.listVehicleJobAssignmentTeam(
        currentAssignment.vehicle_job_id,
      ),
      assignmentRepository.getVehicleJobTeamScanReadiness(
        currentAssignment.vehicle_job_id,
      ),
      // ดึง TicketNo ที่ worker คนนี้ Scan ไว้กลับมา (บันทึกไว้ตอน scanWorkerAssignment) เพื่อให้
      // UI แสดงกลับได้ถูกต้องแม้ปิดเปิดแอพใหม่ — คืน null ถ้ายังไม่เคย Scan
      workerAssignmentEventRepository.findMetadataByAssignmentAndType(
        currentAssignment.id,
        WORKER_ASSIGNMENT_EVENT_TYPE.SCANNED,
      ),
    ]);
    status = resolveWorkerWorkStatus(queueEntry, currentAssignment, teamScan);
    response.status = status;

    if (detail) {
      response.current_job = buildWorkerCurrentJobResponse(
        detail,
        team,
        currentAssignment,
        teamScan,
        typeof scannedEventMetadata?.ticket_no === "string"
          ? scannedEventMetadata.ticket_no
          : null,
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

  const dayCount = EARNINGS_SUMMARY_DAY_COUNT;
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
    const workerCode = account.labor_code;
    const timeoutResult = await withTransaction(async (transaction) =>
      handleAssignmentAcceptTimeout({
        assignment,
        workerId: account.id,
        connection: transaction,
      }),
    );

    if (!timeoutResult) {
      // แพ้ race ให้อีกฝ่าย (accept-timeout job ของ BullMQ หรือ Admin cancel) เปลี่ยนสถานะ
      // assignment นี้ไปก่อนแล้ว — ไม่ได้เป็น PENDING อีกต่อไปไม่ว่าจะด้วยเหตุผลใด จึงตอบ error
      // เดียวกับกรณี pending check ปกติด้านบน โดยไม่ต้องส่ง notification ที่จริงๆ ไม่ได้เกิดขึ้น
      throw new ApiError(
        409,
        "ASSIGNMENT_NOT_PENDING",
        "Assignment is not pending.",
      );
    }

    const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
      assignment.vehicle_job_id,
    );

    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      ticketNumber: vehicleJob?.ticket_number ?? null,
      ticketNos,
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
      worker_id: account.id,
      worker_code: account.labor_code,
      schedule: currentSchedule,
      shift_instance_key: shiftInstanceKey,
    });
  }
  const settings = await getRuntimeSettings();

  const acceptedAssignment = await assignmentRepository.acceptAssignment(
    assignment.id,
    buildDeadline(settings.worker_scan_deadline_minutes * 60 * 1000),
  );

  if (!acceptedAssignment) {
    // แพ้ race ให้ accept-timeout job หรือ Admin cancel เปลี่ยนสถานะไปก่อนแล้วในช่วงเวลาสั้นๆ
    // ระหว่างที่เช็ค pending ด้านบนกับตอนเขียนจริง
    throw new ApiError(
      409,
      "ASSIGNMENT_NOT_PENDING",
      "Assignment is not pending.",
    );
  }

  await scheduleScanTimeout(
    acceptedAssignment.id,
    acceptedAssignment.worker_id,
    getDelayUntil(acceptedAssignment.scan_deadline_at),
  );
  await scheduleScanWarning(
    acceptedAssignment.id,
    acceptedAssignment.worker_id,
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
    account.labor_code,
    account.coat_no,
  );
  const workerCode = account.labor_code;

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
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<WorkerAssignmentCheckInResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerCheckInBarcodeBodySchema, body);
  const settings = await getRuntimeSettings();
  const teamScanRemainingMinutes = settings.worker_scan_team_remaining_minutes;

  const result = await withTransaction(async (transaction) => {
    // ไม่ต้องรับ TicketNumber จาก client แล้ว — Worker สแกนได้แค่ Ticket ของ assignment ที่ตัวเองกำลัง
    // active อยู่เท่านั้นอยู่แล้ว (ระบบไม่ให้มี assignment active มากกว่า 1 คันพร้อมกัน) จึง resolve
    // จาก assignment ปัจจุบันของ worker เองได้เลย ไม่ต้องให้ client ระบุ
    const assignment = await assignmentRepository.findCurrentAssignmentByWorker(
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

      if (!timedOutAssignment) {
        // แพ้ race ให้ scan-timeout job ของ BullMQ หรือ Admin cancel เปลี่ยนสถานะไปก่อนแล้วใน
        // ช่วงเวลาสั้นๆ ระหว่างที่เช็ค accepted ด้านบนกับตอนเขียนจริง
        throw new ApiError(
          409,
          "ASSIGNMENT_NOT_ACCEPTED",
          "Assignment is not accepted.",
        );
      }

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

    // หา Business Ticket (MarketJob) จาก barcode ticket_no ที่สแกน โดย scope ด้วย vehicle_job_id
    // ของ assignment ปัจจุบันของ worker เอง ปลอดภัยแม้ ticket_no จะไม่ unique ทั้งระบบ เพราะ unique
    // แค่ภายในคันเดียว (worker scan Ticket ใบไหนในรถของตัวเองก็ได้ ไม่ต้อง scan ครบทุกใบ)
    const scannedMarketJob = await marketJobRepository.findMarketJobByVehicleAndTicketNo(
      assignment.vehicle_job_id,
      input.ticket_no,
      transaction,
    );

    if (!scannedMarketJob) {
      throw new ApiError(
        404,
        "MARKET_JOB_NOT_FOUND",
        "Business Ticket not found for this worker's vehicle job.",
      );
    }

    const vehicleJob = await vehicleJobRepository.findVehicleJobById(
      assignment.vehicle_job_id,
      transaction,
    );

    if (!vehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    // บันทึกไว้ใน WorkerAssignmentEvent.metadata ว่า Worker คนนี้ Scan TicketNo ใบไหนของ TicketNumber
    // นี้ — เก็บเป็นประวัติเช็คย้อนหลังได้ แยกจาก assignment.scanned_at ที่บอกแค่ "Scan เข้ารถคันนี้
    // เมื่อไหร่" แต่ไม่บอกว่าเลือก TicketNo ไหน (ดู scanAssignment ใน
    // vehicle-job-assignment.repository.ts)
    const scannedAssignment = await assignmentRepository.scanAssignment(
      assignment.id,
      {
        ticket_no: scannedMarketJob.ticket_no,
        marketCode: scannedMarketJob.marketCode,
        marketName: scannedMarketJob.marketName,
      },
      transaction,
    );

    if (!scannedAssignment) {
      // แพ้ race ให้ scan-timeout job หรือ Admin cancel เปลี่ยนสถานะไปก่อนแล้วในช่วงเวลาสั้นๆ
      // ระหว่างที่เช็ค accepted ด้านบนกับตอนเขียนจริง
      throw new ApiError(
        409,
        "ASSIGNMENT_NOT_ACCEPTED",
        "Assignment is not accepted.",
      );
    }

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
      scannedMarketJob,
      shortenedAssignments,
      teamScan,
    };
  });

  if (result.kind === "expired") {
    await removeScanTimeout(result.timedOutAssignment.id);
    await removeScanWarning(result.timedOutAssignment.id);
    const queue = await markWorkerOpenApp(account.id);
    await dispatchReadyWorkers();
    const workerCode = account.labor_code;
    const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
      result.timedOutAssignment.vehicle_job_id,
    );

    sendWorkerSocketEvent(account.id, "ASSIGNMENT_TIMEOUT", {
      ticketNumber: result.vehicleJob?.ticket_number ?? null,
      ticketNos,
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

  const { scannedAssignment, vehicleJob, scannedMarketJob, shortenedAssignments, teamScan } =
    result;
  await removeScanTimeout(scannedAssignment.id);
  await removeScanWarning(scannedAssignment.id);
  await Promise.all(
    shortenedAssignments.flatMap((assignment) => [
      scheduleScanTimeout(
        assignment.id,
        assignment.worker_id,
        getDelayUntil(assignment.scan_deadline_at),
      ),
      scheduleScanWarning(
        assignment.id,
        assignment.worker_id,
        assignment.scan_deadline_at,
      ),
    ]),
  );
  const workerCode = account.labor_code;

  if (shortenedAssignments.length > 0) {
    const [firstShortenedAssignment] = shortenedAssignments;
    const shortenedTicketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
      vehicleJob.id,
    );

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
        ticketNos: shortenedTicketNos,
        remaining_minutes: teamScanRemainingMinutes,
        scan_deadline_at: firstShortenedAssignment.scan_deadline_at,
        scan_deadline_unix_ms: toUnixMs(firstShortenedAssignment.scan_deadline_at),
      },
      admin: true,
      worker_ids: shortenedAssignments.map(
        (assignment) => assignment.worker_id,
      ),
    });
  }
  const team = await assignmentRepository.listVehicleJobAssignmentTeam(
    scannedAssignment.vehicle_job_id,
  );

  sendAssignmentTeamUpdatedSocketEvents(vehicleJob.ticket_number, team, teamScan);

  // แจ้งเตือนทั้งทีมตอนคนสุดท้าย scan ครบพอดี (waiting_team -> working) — แยกจาก
  // ASSIGNMENT_TEAM_UPDATED เดิม (push: false, ไว้ sync ระหว่างที่ยังรอทีมอยู่) เพราะจุดนี้คือจังหวะ
  // สำคัญที่ worker ที่ปิดแอพ/ไม่ได้ต่อ socket อยู่ก็ต้องรู้ว่าเริ่มงานได้แล้ว
  if (teamScan.is_ready) {
    const teamWorkerAccountIds = team
      .map((member) => member.worker_id)
      .filter((value): value is number => typeof value === "number");
    const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
      vehicleJob.id,
    );

    publishRealtimeEvent({
      type: "TEAM_READY",
      title: "Team ready",
      message: `The whole team has checked in for vehicle job ${vehicleJob.ticket_number}. Work can start now.`,
      payload: {
        ticketNumber: vehicleJob.ticket_number,
        ticketNos,
      },
      worker_payload: {
        ticketNumber: vehicleJob.ticket_number,
        ticketNos,
      },
      worker_ids: teamWorkerAccountIds,
    });
  }

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
    ticket_no: scannedMarketJob.ticket_no,
    team_scan: buildWorkerTeamScanResponse(teamScan),
  };
}

// Function จบงาน worker assignment ticket ใน service flow
//
// ไม่รับ TicketNumber จาก client แล้ว — Worker ส่งยอดได้แค่ของ assignment ที่ตัวเองกำลัง active
// อยู่เท่านั้น (คนละหลักการเดียวกับ scanWorkerAssignment) จึง resolve TicketNumber จาก assignment
// ปัจจุบันของ worker เอง แทนที่จะให้ client ระบุมา — TicketNo (Business Ticket) ยังต้องส่งมาอยู่
// เพราะไม่ unique ข้าม Business Ticket ภายในรถคันเดียวกัน (ตลาดคนละใบ)
async function completeWorkerAssignmentTicket(
  ticketNoParam: unknown,
  boothCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<TicketCompletionResponse> {
  return completeResolvedWorkerTicket(
    (connection, workerId) =>
      findGateTicketForCompletionByCurrentAssignment(
        workerId,
        ticketNoParam,
        boothCodeParam,
        connection,
      ),
    body,
    auth,
  );
}

export async function completeWorkerAssignmentTicketFromBody(
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<TicketCompletionResponse> {
  const parsedBody = body as { ticket_no?: unknown; boothCode?: unknown } | null;

  return completeWorkerAssignmentTicket(
    parsedBody?.ticket_no,
    parsedBody?.boothCode,
    body,
    auth,
  );
}

// Function จบงาน resolved worker ticket ใน service flow
async function completeResolvedWorkerTicket(
  findTicket: (
    connection: DbConnection,
    workerId: number,
  ) => Promise<GateTicketDto | null>,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<TicketCompletionResponse> {
  const account = await requireWorker(auth);
  const input = parseWithSchema(workerTicketCompleteBodySchema, body);
  const result = await withTransaction((transaction) =>
    ticketCompletionService.submitTicketCompletion({
      findTicket: (connection) => findTicket(connection, account.id),
      items: input.items,
      submittedByAccountId: account.id,
      submittedByRole: TICKET_SUBMITTER_ROLE.WORKER,
      requireRosterMembership: true,
      connection: transaction,
    }),
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
        queue: buildWorkerQueueSocketPayload(queue, account.labor_code),
        reason: "ticket_delivered_after_shift_end",
      });
    }
    publishAdminWorkerStatusChanged({
      title: "Worker moved to open_app",
      message: `Worker ${account.full_name} moved to open_app after submitting ticket completion outside the shift.`,
      workerCode: account.labor_code,
      queue,
      reason: "ticket_delivered_after_shift_end",
    });
  }
  const { detail } = await ticketCompletionService.notifyTicketCompletionSubmitted(result);

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
