// Import Library
import { Prisma } from "@prisma/client";

import { withTransaction } from "../db/prisma";
import { enqueueWorkersAtFront, getWorkerQueueStatus, markWorkerAssigned, markWorkerOpenApp, removeAssignmentTimeout, removeScanTimeout, removeScanWarning, scheduleAssignmentTimeout, scheduleScanTimeout, scheduleScanWarning } from "../queues/worker-queue";
import { dispatchReadyWorkers, returnCompletedWorkersToQueue } from "../queues/worker-dispatch";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as adminActionLogRepository from "../repositories/shared/admin-action-log.repository";
import * as adminJobsRepository from "../repositories/admin-jobs.repository";
import * as assignmentRepository from "../repositories/shared/vehicle-job-assignment.repository";
import * as driverRepository from "../repositories/driver.repository";
import * as gateTicketRepository from "../repositories/shared/gate-ticket.repository";
import * as marketJobRepository from "../repositories/shared/market-job.repository";
import * as masterDataRepository from "../repositories/shared/master-data.repository";
import * as profileRepository from "../repositories/shared/profile.repository";
import * as ticketWorkerRepository from "../repositories/shared/ticket-worker.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import * as workScheduleRepository from "../repositories/shared/work-schedule.repository";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./shared/realtime-notification.service";
import { getRuntimeSettings } from "./shared/runtime-settings.service";
import * as vehicleJobLifecycleService from "./shared/vehicle-job-lifecycle.service";
import * as ticketCompletionService from "./shared/ticket-completion.service";
import { buildVehicleOperationSummary, formatVehicleOperationItem } from "../utils/admin-job-operations.formatter";
import { isTimeInWorkSchedule } from "../utils/shift";
import { logger } from "../utils/logger";
// Import Types
import type { AdminVehicleJobFinancialResponse, AdminVehicleJobFinancialRecord, AdminAssignmentResponse, AdminAssignWorkersResponse, AdminCancelAssignmentResponse, AdminCancelTicketWorkerFromBoothResponse, AdminCancelTicketWorkerResponse, AdminCancelVehicleJobAndRequeueResponse, AdminExtendScanDeadlineResponse, AdminHistoryCancellationResponse, AdminHistoryRejectionResponse, AdminHistoryBoothResponse, AdminHistoryProductResponse, AdminHistoryTimelineItemResponse, AdminHistoryWorkerResponse, AdminVehicleJobAssignmentCancelResponse, HistoryStatusValue, HistoryFlagValue, DailyWorkerIncomeItemResponse, DailyWorkerIncomePaymentStatus, DailyWorkerIncomeRecord, AdminMarketJobActionResponse, AdminOverrideCountResponse, AdminReleaseWorkersResponse, AdminScanDeadlineAssignmentResponse, AdminStallJobActionResponse, AdminVehicleJobHistoryItemResponse, AdminVehicleJobHistoryRecord, AdminVehicleJobOperationListResponse, AdminVehicleWaitResponse } from "../types/admin-jobs.type";
import { HISTORY_FLAG_VALUES } from "../types/admin-jobs.type";
import type { AccessTokenPayload } from "../types/auth.type";
import type { CompletedVehicleJobResult, GateTicketDto, MarketJobDto, VehicleJobAssignmentDto, VehicleJobDto } from "../types/worker.type";
// Import Validation
import { parseWithSchema } from "../validation/parser";
import { adminAssignWorkersBodySchema, adminCancelAssignmentBodySchema, adminCancelBodySchema, adminDailyWorkerIncomeQuerySchema, adminExtendScanDeadlineBodySchema, adminOverrideCountBodySchema, adminReleaseWorkersBodySchema, adminVehicleJobAssignmentCancelBodySchema, adminVehicleJobListQuerySchema, adminVehicleJobOperationsQuerySchema, adminVehicleWaitBodySchema } from "../validation/schemas";
// Import Utils
import { requireActorId } from "../utils/actor";
import ApiError from "../utils/api-error";
import { ACTIVE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS, DAILY_WORKER_INCOME_PAYMENT_STATUS, SUBMITTED_TICKET_STATUSES, TERMINAL_JOB_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_STATUS, TICKET_SUBMITTER_ROLE, TICKET_WORKER_STATUS, VEHICLE_JOB_STATUS } from "../constants/job-status";
import { ADMIN_ACTION_TYPE } from "../types/shared/admin-action-log.type";
import type { AdminActionLogDto } from "../types/shared/admin-action-log.type";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";
import { buildBangkokDateSpanRange, buildDeadline, getDelayUntil, toUnixMs } from "../utils/time";
import { buildWorkerAssignedPayload } from "../utils/worker-payload";
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

// Function ระบุ Timeline type จาก WorkerAssignmentEvent ใน service flow
function mapAssignmentEventToTimelineType(eventType: string): string {
  switch (eventType) {
    case WORKER_ASSIGNMENT_EVENT_TYPE.ASSIGNED:
      return "WORKER_ASSIGNED";
    case WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPTED:
      return "WORKER_ACCEPTED";
    case WORKER_ASSIGNMENT_EVENT_TYPE.SCANNED:
      return "WORKER_SCANNED";
    case WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPT_TIMEOUT:
      return "WORKER_ACCEPT_TIMEOUT";
    case WORKER_ASSIGNMENT_EVENT_TYPE.SCAN_TIMEOUT:
      return "WORKER_SCAN_TIMEOUT";
    case WORKER_ASSIGNMENT_EVENT_TYPE.COMPLETED:
      return "WORKER_COMPLETED";
    case WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED:
      return "ADMIN_ACTION";
    default:
      return eventType;
  }
}

// Function บรรยาย Admin action หนึ่งรายการสำหรับ Timeline ใน service flow
function describeAdminAction(log: AdminActionLogDto): string {
  const actor = log.actor_worker_code ?? "Admin";

  switch (log.action_type) {
    case ADMIN_ACTION_TYPE.OVERRIDE_COUNT:
      return `${actor} overrode booth counts.`;
    case ADMIN_ACTION_TYPE.VEHICLE_WAIT:
      return log.metadata?.dispatch === true
        ? `${actor} dispatched the vehicle job again.`
        : `${actor} set the vehicle job back to wait.`;
    case ADMIN_ACTION_TYPE.WORKERS_RELEASED:
      return `${actor} released workers back to the queue.`;
    case ADMIN_ACTION_TYPE.ASSIGNMENT_CANCELLED:
      return `${actor} cancelled a worker assignment.`;
    case ADMIN_ACTION_TYPE.SCAN_DEADLINE_EXTENDED:
      return `${actor} extended the scan deadline.`;
    case ADMIN_ACTION_TYPE.MANUAL_ASSIGNMENT:
      return `${actor} manually assigned worker(s).`;
    default:
      return `${actor} performed ${log.action_type}.`;
  }
}

// Function ค้นหา AdminActionLog ของการ Cancel Assignment ที่ตรงกับ assignment นี้เจาะจง ใช้ร่วมกัน
// ทั้ง Worker Cancellation object และ Timeline Cancel actor เพื่อไม่ให้คืนค่าจาก Log ของ action อื่น
// — ถ้าไม่มี Log เจาะจงระดับ assignment (เช่น assignment นี้ถูกยกเลิกทางอ้อมจากการยกเลิกทั้ง
// TicketNumber ไม่ใช่ยกเลิกทีละ Worker) fallback ไป Log VEHICLE_JOB_CANCELLED ล่าสุดของรถคันนี้แทน
// เพราะเป็นสาเหตุเดียวที่เป็นไปได้อีกทางที่ทำให้ assignment กลายเป็น CANCELLED
function findAssignmentCancelLog(
  adminActionLogs: AdminActionLogDto[],
  assignmentId: number,
): AdminActionLogDto | null {
  const assignmentLog = adminActionLogs.find(
    (log) =>
      log.action_type === ADMIN_ACTION_TYPE.ASSIGNMENT_CANCELLED &&
      (log.metadata as { assignment_id?: number } | null)?.assignment_id ===
        assignmentId,
  );

  if (assignmentLog) {
    return assignmentLog;
  }

  const vehicleCancelLogs = adminActionLogs
    .filter((log) => log.action_type === ADMIN_ACTION_TYPE.VEHICLE_JOB_CANCELLED)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return vehicleCancelLogs[0] ?? null;
}

// Function ค้นหา AdminActionLog ของการยกเลิกทั้งคัน (VehicleJob) — เป็นระดับบนสุด ไม่มี fallback
function findVehicleCancelLog(
  adminActionLogs: AdminActionLogDto[],
): AdminActionLogDto | null {
  const vehicleCancelLogs = adminActionLogs
    .filter((log) => log.action_type === ADMIN_ACTION_TYPE.VEHICLE_JOB_CANCELLED)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return vehicleCancelLogs[0] ?? null;
}

// Function ค้นหา AdminActionLog ของการยกเลิกตลาด (MarketJob/ticket_no) นี้เจาะจง — ถ้าไม่มี Log
// ระดับตลาดเอง (ถูกยกเลิกทางอ้อมจากการยกเลิกทั้งคัน) fallback ไป Log VEHICLE_JOB_CANCELLED แทน
// เพราะเป็นสาเหตุเดียวที่เป็นไปได้อีกทางที่ทำให้ตลาดนี้กลายเป็น CANCELLED
function findMarketCancelLog(
  adminActionLogs: AdminActionLogDto[],
  marketJobId: number,
): AdminActionLogDto | null {
  const marketLogs = adminActionLogs
    .filter(
      (log) =>
        log.action_type === ADMIN_ACTION_TYPE.MARKET_JOB_CANCELLED &&
        log.market_job_id === marketJobId,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (marketLogs[0]) {
    return marketLogs[0];
  }

  return findVehicleCancelLog(adminActionLogs);
}

// Function ค้นหา AdminActionLog ของการยกเลิกแผง (GateTicket/Booth) นี้เจาะจง — ถ้าไม่มี Log ระดับ
// แผงเอง (ถูกยกเลิกทางอ้อมจากการยกเลิกทั้งตลาดหรือทั้งคัน) fallback ไล่ขึ้นไปที่ระดับตลาดแล้วรถตามลำดับ
// (ดู findMarketCancelLog)
function findBoothCancelLog(
  adminActionLogs: AdminActionLogDto[],
  gateTicketId: number,
  marketJobId: number,
): AdminActionLogDto | null {
  const boothLogs = adminActionLogs
    .filter(
      (log) =>
        log.action_type === ADMIN_ACTION_TYPE.STALL_JOB_CANCELLED &&
        log.gate_ticket_id === gateTicketId,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (boothLogs[0]) {
    return boothLogs[0];
  }

  return findMarketCancelLog(adminActionLogs, marketJobId);
}

// Function ประกอบ AdminHistoryCancellationResponse จาก Log ที่หาเจอ — ใช้ร่วมกันทุกระดับ (VehicleJob/
// MarketJob/GateTicket) คืน null ทั้งก้อนเมื่อ status ไม่ใช่ CANCELLED เท่านั้น ถ้า status เป็น
// CANCELLED แต่หา Log ไม่เจอเลย sub-field จะเป็น null แทนการเดา — เกิดขึ้นได้จริงที่ VehicleJob เมื่อ
// closeCompletedVehicleJobIfReady auto-rollup ทั้งคันเป็น CANCELLED เพราะทุก MarketJob cancelled หมด
// (ไม่มี VEHICLE_JOB_CANCELLED log ของตัวเอง เพราะไม่มี Admin กด Cancel ระดับรถโดยตรง) ซึ่ง
// vehicle_job.cancellation เป็นระดับบนสุดจึงไม่ fallback ไปที่ Log ของ MarketJob ที่เป็นสาเหตุแทน
function formatCancellationResponse(
  isCancelled: boolean,
  cancelLog: AdminActionLogDto | null,
): AdminHistoryCancellationResponse | null {
  if (!isCancelled) {
    return null;
  }

  return {
    cancelled_at: cancelLog?.created_at ?? null,
    reason_code: cancelLog?.reason_code ?? null,
    reason_text: cancelLog?.reason_text ?? null,
    cancelled_by_type: cancelLog?.actor_role ?? null,
    cancelled_by_name: cancelLog?.actor_full_name ?? null,
  };
}

// Function ค้นหา AdminActionLog ของการ Release Workers ที่ครอบคลุม worker คนนี้ ใช้สำหรับ Timeline
// Release actor — ถ้ามีมากกว่าหนึ่ง Log ที่ครอบคลุม worker คนเดียวกัน (ปล่อยคนละรอบ) ให้เลือก Log
// ที่ created_at ใกล้ releasedAt ที่สุด
function findWorkersReleasedLog(
  adminActionLogs: AdminActionLogDto[],
  workerId: number,
  releasedAt: Date,
): AdminActionLogDto | null {
  const candidates = adminActionLogs.filter((log) => {
    if (log.action_type !== ADMIN_ACTION_TYPE.WORKERS_RELEASED) {
      return false;
    }

    const workerIds = (
      log.metadata as { worker_ids?: number[] } | null
    )?.worker_ids;

    return (
      Array.isArray(workerIds) &&
      workerIds.includes(workerId)
    );
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((closest, log) => {
    const closestDiff = Math.abs(
      new Date(closest.created_at).getTime() - releasedAt.getTime(),
    );
    const logDiff = Math.abs(
      new Date(log.created_at).getTime() - releasedAt.getTime(),
    );

    return logDiff < closestDiff ? log : closest;
  });
}

// Function เลือก accepted assignment ล่าสุดต่อ worker หนึ่งคน (stable identity = workerId)
// จาก assignments ทั้งหมดของ VehicleJob นี้ — คนที่ถูก dispatch เข้ามาแต่ไม่เคยกด Accept
// (acceptedAt เป็น null) ต้องไม่ถูกเลือกเลย ส่วนคนที่ถูก dispatch/กดรับมากกว่าหนึ่งครั้งให้เหลือ
// เพียงแถวเดียวจาก transaction ที่ acceptedAt ล่าสุด (tie-break ด้วย id ล่าสุด)
function selectLatestAcceptedAssignmentPerWorker(
  assignments: AdminVehicleJobHistoryRecord["assignments"],
): AdminVehicleJobHistoryRecord["assignments"] {
  const latestByWorkerId = new Map<number, AdminVehicleJobHistoryRecord["assignments"][number]>();

  for (const assignment of assignments) {
    if (!assignment.acceptedAt) {
      continue;
    }

    const existing = latestByWorkerId.get(assignment.workerId);

    if (
      !existing ||
      !existing.acceptedAt ||
      assignment.acceptedAt.getTime() > existing.acceptedAt.getTime() ||
      (assignment.acceptedAt.getTime() === existing.acceptedAt.getTime() &&
        assignment.id > existing.id)
    ) {
      latestByWorkerId.set(assignment.workerId, assignment);
    }
  }

  return Array.from(latestByWorkerId.values());
}

// Function สร้างรายการ Worker ของ VehicleJob สำหรับ Work History ใน service flow — เฉพาะคนที่กดรับ
// งานจริงและไม่ซ้ำต่อคน (ดู selectLatestAcceptedAssignmentPerWorker) Timeline ยังคง event ครบทุก
// assignment ตามเดิม ฟังก์ชันนี้กระทบแค่รายการสรุปในแท็บประวัติแรงงาน
function formatAdminHistoryWorkers(
  record: AdminVehicleJobHistoryRecord,
  adminActionLogs: AdminActionLogDto[],
): AdminHistoryWorkerResponse[] {
  // submitted_at ต้องผูกกับ assignment (work-cycle) ที่เลือกจริงเท่านั้น ผ่าน
  // TicketCompletionSubmission.assignmentId ที่ stamp ไว้ตอน Submit — submission ที่ไม่มี
  // assignmentId (Admin submit แทน หรือ row เก่าก่อน Feature นี้) ต้องไม่ถูกนำมาปนกัน
  const submittedAtByAssignmentId = new Map<number, string>();

  for (const market of record.marketJobs) {
    for (const ticket of market.tickets) {
      for (const submission of ticket.completionSubmissions) {
        if (submission.assignmentId === null) {
          continue;
        }

        const createdAtIso = submission.createdAt.toISOString();
        const existing = submittedAtByAssignmentId.get(submission.assignmentId);

        if (!existing || createdAtIso > existing) {
          submittedAtByAssignmentId.set(submission.assignmentId, createdAtIso);
        }
      }
    }
  }

  const selectedAssignments = selectLatestAcceptedAssignmentPerWorker(record.assignments);

  return selectedAssignments.map((assignment) => {
    const adminCancelledEvent = assignment.events.find(
      (event) => event.eventType === WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED,
    );

    return {
      worker_id: assignment.workerId,
      assignment_id: assignment.id,
      worker_code: assignment.worker.laborCode,
      full_name: assignment.worker.fullName ?? assignment.worker.laborCode,
      labor_color: assignment.worker.laborColor ?? null,
      accepted_at: assignment.acceptedAt?.toISOString() ?? null,
      scanned_at: assignment.scannedAt?.toISOString() ?? null,
      // Business Definition: Worker ถือว่าเริ่มงานตั้งแต่กด Accept Assignment ไม่ใช่ตอน Scan
      started_at: assignment.acceptedAt?.toISOString() ?? null,
      submitted_at: submittedAtByAssignmentId.get(assignment.id) ?? null,
      released_at: assignment.releasedAt?.toISOString() ?? null,
      final_status: assignment.status,
      cancellation:
        assignment.status === ASSIGNMENT_STATUS.CANCELLED
          ? (() => {
            const cancelLog = findAssignmentCancelLog(adminActionLogs, assignment.id);

            return {
              // ห้าม fallback ไปใช้ assignment.updatedAt — ถ้าไม่มี ADMIN_CANCELLED event จริง
              // ให้เป็น null แทนการเดา
              cancelled_at: adminCancelledEvent?.occurredAt.toISOString() ?? null,
              reason_code: cancelLog?.reason_code ?? null,
              reason_text: cancelLog?.reason_text ?? null,
              cancelled_by_type: cancelLog?.actor_role ?? null,
              cancelled_by_name: cancelLog?.actor_full_name ?? null,
            };
          })()
          : null,
    };
  });
}

// Function สร้าง Timeline ของ VehicleJob สำหรับ Work History ใน service flow โดยรวมเหตุการณ์จาก
// WorkerAssignmentEvent, TicketCompletionSubmission และ admin_action_logs แล้วเรียงตามเวลา
function formatAdminHistoryTimeline(
  record: AdminVehicleJobHistoryRecord,
  adminActionLogs: AdminActionLogDto[],
  jobTimestamps: { ticket_created_at: string | null; completed_at: string | null },
): AdminHistoryTimelineItemResponse[] {
  const items: AdminHistoryTimelineItemResponse[] = [];

  // Gate Arrival ต้องมาจาก TicketCreatedAt แรกสุด (source เดียวกับ ticket_created_at) ไม่ใช่
  // VehicleJob.createdAt — ถ้าไม่มี MarketJob เลย (ไม่มี source จริง) ก็ไม่ต้องเดาแล้วใส่ item ลอยๆ
  if (jobTimestamps.ticket_created_at) {
    items.push({
      type: "GATE_ARRIVAL",
      occurred_at: jobTimestamps.ticket_created_at,
      actor_type: "system",
      actor_name: null,
      description: `Vehicle ${record.ticketNumber} arrived at Gate.`,
    });
  }

  for (const assignment of record.assignments) {
    for (const event of assignment.events) {
      const isAdminCancelled = event.eventType === WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED;
      const cancelLog = isAdminCancelled
        ? findAssignmentCancelLog(adminActionLogs, assignment.id)
        : null;

      items.push({
        type: mapAssignmentEventToTimelineType(event.eventType),
        occurred_at: event.occurredAt.toISOString(),
        actor_type: isAdminCancelled ? "admin" : "worker",
        // Cancel Actor ต้องเป็นแอดมินที่กด Cancel (จาก AdminActionLog) ไม่ใช่ชื่อ Worker ที่ถูก Cancel
        actor_name: isAdminCancelled
          ? cancelLog?.actor_full_name ?? null
          : assignment.worker.fullName,
        description: `${assignment.worker.laborCode}: ${event.eventType.toLowerCase()}.`,
      });
    }

    if (assignment.releasedAt) {
      const releaseLog = findWorkersReleasedLog(
        adminActionLogs,
        assignment.workerId,
        assignment.releasedAt,
      );

      items.push({
        type: "WORKER_RELEASED",
        occurred_at: assignment.releasedAt.toISOString(),
        actor_type: "admin",
        // Release Actor ต้องเป็นแอดมินที่กดปล่อย (จาก AdminActionLog) ไม่ใช่ชื่อ Worker ที่ถูกปล่อย
        actor_name: releaseLog?.actor_full_name ?? null,
        description: `${assignment.worker.laborCode} released back to queue.`,
      });
    }
  }

  for (const market of record.marketJobs) {
    for (const ticket of market.tickets) {
      for (const submission of ticket.completionSubmissions) {
        const isAdminSubmitted = submission.submittedByRole === TICKET_SUBMITTER_ROLE.ADMIN;
        const submitterName = resolveSubmitterName(submission);
        const submitterCode = resolveSubmitterCode(submission);

        items.push({
          type: "COUNT_SUBMITTED",
          occurred_at: submission.createdAt.toISOString(),
          actor_type: isAdminSubmitted ? "admin" : "worker",
          actor_name: submitterName,
          description: isAdminSubmitted
            ? `${submitterCode} submitted counts for booth ${ticket.boothCode} on behalf of the worker.`
            : `${submitterCode} submitted counts for booth ${ticket.boothCode}.`,
        });

        if (submission.rejectedAt) {
          items.push({
            type: "TICKET_REJECTED",
            occurred_at: submission.rejectedAt.toISOString(),
            actor_type: "system",
            actor_name: null,
            description: `Vendor rejected booth ${ticket.boothCode}.`,
          });
        }

        if (submission.confirmedAt) {
          items.push({
            type: "TICKET_CONFIRMED",
            occurred_at: submission.confirmedAt.toISOString(),
            actor_type: "system",
            actor_name: null,
            description: `Vendor confirmed booth ${ticket.boothCode}.`,
          });
        }
      }
    }
  }

  for (const log of adminActionLogs) {
    items.push({
      type: "ADMIN_ACTION",
      occurred_at: log.created_at,
      actor_type: "admin",
      actor_name: log.actor_full_name,
      description: describeAdminAction(log),
    });
  }

  if (record.status === VEHICLE_JOB_STATUS.COMPLETED && jobTimestamps.completed_at) {
    items.push({
      type: "JOB_COMPLETED",
      occurred_at: jobTimestamps.completed_at,
      actor_type: "system",
      actor_name: null,
      description: `Vehicle job ${record.ticketNumber} completed.`,
    });
  }

  return items.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

// Function derive job-level timestamp/duration ของ VehicleJob สำหรับ Work History ใน service flow
// ห้าม derive จาก field ที่ไม่มีจริง หา TicketCreatedAt/WorkStartedAt/SubmittedCompleteAt/CompletedAt ไม่ได้ก็คืน null
// แทนการเดา
function deriveAdminHistoryJobTimestamps(record: AdminVehicleJobHistoryRecord): {
  ticket_created_at: string | null;
  work_started_at: string | null;
  submitted_complete_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
} {
  // ticket_created_at = TicketCreatedAt ที่เร็วที่สุดของ Business Tickets (MarketJobs) ภายใน VehicleJob
  // นี้ — คือเวลาที่ Ticket ถูกสร้างจาก Gate ห้ามใช้ assignments.scannedAt
  const ticketCreatedTimestamps = record.marketJobs.map((market) => market.ticketCreatedAt);
  const ticketCreatedAt =
    ticketCreatedTimestamps.length > 0
      ? new Date(Math.min(...ticketCreatedTimestamps.map((value) => value.getTime())))
      : null;
  const workStartedAt = record.workStartedAt;

  const allTickets = record.marketJobs.flatMap((market) => market.tickets);
  // submitted_complete_at ต้องไม่รอ Ticket ที่ถูก CANCELLED (ไม่ใช่งานที่ต้องรอ completion) —
  // ใช้ requiredTickets เดียวกับที่ vendor confirm เคยใช้
  const requiredTickets = allTickets.filter(
    (ticket) => ticket.status !== TICKET_STATUS.CANCELLED,
  );
  const latestSubmissionPerRequiredTicket = requiredTickets.map((ticket) =>
    ticket.completionSubmissions.length > 0
      ? ticket.completionSubmissions[ticket.completionSubmissions.length - 1]
      : null,
  );
  const everyRequiredTicketSubmitted =
    requiredTickets.length > 0 &&
    latestSubmissionPerRequiredTicket.every((value) => value !== null);
  const submittedCompleteAt = everyRequiredTicketSubmitted
    ? new Date(
      Math.max(
        ...latestSubmissionPerRequiredTicket.map((submission) => submission!.createdAt.getTime()),
      ),
    )
    : null;

  // completed_at ต้องใช้ VehicleJob.completedAt จริงที่ persist ไว้ที่จุดเปลี่ยนสถานะเดียว
  // (updateVehicleJobStatus) ห้าม derive จาก MarketJob.completedAt อีกต่อไป
  const completedAt = record.completedAt;

  // duration_seconds = completedAt - workStartedAt เพื่อวัดเวลาทำงานจริงหลังทีม scan ครบ
  const durationSeconds =
    completedAt && workStartedAt
      ? Math.round((completedAt.getTime() - workStartedAt.getTime()) / 1000)
      : null;

  return {
    ticket_created_at: ticketCreatedAt?.toISOString() ?? null,
    work_started_at: workStartedAt?.toISOString() ?? null,
    submitted_complete_at: submittedCompleteAt?.toISOString() ?? null,
    completed_at: completedAt?.toISOString() ?? null,
    duration_seconds: durationSeconds,
  };
}

// Type ข้อมูล MasterOwnerStall ที่ Batch-fetch มาแล้ว ใช้ประกอบ correction_owner และเป็นจุดเริ่มต้น
// resolve ผู้กด Reject ผ่าน LINE (ดู buildHistoryRejectionActorContext)
type HistoryOwnerStallInfo = {
  full_name: string | null;
  card_id: string;
  line_user_id: string | null;
};

// Function ประกอบ key สำหรับ owner map ตาม marketCode + boothCode
function buildOwnerStallKey(marketCode: string, boothCode: string): string {
  return `${marketCode}::${boothCode}`;
}

// Function ประกอบ key สำหรับ member map ตาม marketCode + ownerCardId + ownerLineUserId + memberLineUserId
function buildMemberStallKey(
  marketCode: string,
  ownerCardId: string,
  ownerLineUserId: string,
  memberLineUserId: string,
): string {
  return `${marketCode}::${ownerCardId}::${ownerLineUserId}::${memberLineUserId}`;
}

// Function resolve ผู้กด Reject ผ่าน LINE ของ Submission หนึ่งรายการ ใช้ Owner map ที่ fetch มาแล้ว
// เป็นจุดเริ่มต้นก่อนเสมอ (ไม่ query ซ้ำ) แล้วค่อย fallback ไปหา Member map ถ้า lineUserId ไม่ตรง Owner
function resolveRejectionActor(
  owner: HistoryOwnerStallInfo | null,
  marketCode: string,
  resolvedByLineUserId: string | null,
  memberNameByKey: Map<string, string | null>,
): { rejected_by_type: "owner" | "member" | null; rejected_by_name: string | null } {
  if (!resolvedByLineUserId) {
    // ไม่มี LINE user id แปลว่าเป็น Auto Timeout Confirm ไม่ใช่ Manual Reject ห้ามเดา Vendor
    return { rejected_by_type: null, rejected_by_name: null };
  }

  if (owner?.line_user_id === resolvedByLineUserId) {
    return { rejected_by_type: "owner", rejected_by_name: owner.full_name };
  }

  if (owner?.line_user_id) {
    const memberKey = buildMemberStallKey(
      marketCode,
      owner.card_id,
      owner.line_user_id,
      resolvedByLineUserId,
    );
    const memberName = memberNameByKey.get(memberKey);

    if (memberName !== undefined) {
      return { rejected_by_type: "member", rejected_by_name: memberName };
    }
  }

  return { rejected_by_type: null, rejected_by_name: null };
}

// Function คำนวณ company_share_rate ของ Booth หนึ่งใบจาก Finalized Financial Snapshot เดิม
// (fund_amount / labor_fee_raw) * 100 — ไม่ persist ค่าใหม่ ไม่แตะ formatAdminFinancialBooth เดิม
function calculateCompanyShareRate(laborFeeRaw: string, fundAmount: string): string {
  const laborFeeRawDecimal = new Prisma.Decimal(laborFeeRaw);

  if (laborFeeRawDecimal.isZero()) {
    return "0.00";
  }

  return new Prisma.Decimal(fundAmount)
    .dividedBy(laborFeeRawDecimal)
    .times(100)
    .toFixed(2);
}

// Function ระบุประเภทของการ Confirm ล่าสุดของ Submission — "vendor" เมื่อ resolved_by_line_user_id
// มีค่าจริง (Vendor กดยืนยันเองผ่าน LINE), "timeout" เมื่อไม่มี (Auto-confirm จาก BullMQ Timeout แต่
// confirmedAt ยังถูกบันทึกจริงเสมอทั้งสองกรณี), null เมื่อยังไม่เคย Confirm เลย
function resolveConfirmedByType(
  submission: AdminVehicleJobHistoryRecord["marketJobs"][number]["tickets"][number]["completionSubmissions"][number] | null,
): "vendor" | "timeout" | null {
  if (!submission?.confirmedAt) {
    return null;
  }

  return submission.resolvedByLineUserId ? "vendor" : "timeout";
}

// Function จัดรูปแบบ SubmissionWorkerSnapshot[] ของ submission หนึ่งรายการ — roster ที่ยัง WORKING
// ณ เวลา Submit จริง (คนละอันกับ GateTicketWorkerSnapshot ที่ snapshot ทีหลังตอน Confirm)
function formatSubmissionWorkerSnapshot(
  submission: AdminVehicleJobHistoryRecord["marketJobs"][number]["tickets"][number]["completionSubmissions"][number],
): AdminHistoryBoothResponse["submission_worker_snapshot"] {
  return submission.workerSnapshots.map((snapshot) => ({
    worker_code: snapshot.ticketWorker.worker.laborCode,
    full_name: snapshot.ticketWorker.worker.fullName ?? snapshot.ticketWorker.worker.laborCode,
  }));
}

// Function ดึง WorkerCode ของผู้ส่งยอด (Admin หรือ Worker แล้วแต่ submittedByRole) ใน service flow
function resolveSubmitterCode(
  submission: AdminVehicleJobHistoryRecord["marketJobs"][number]["tickets"][number]["completionSubmissions"][number],
): string | null {
  return submission.submittedByRole === TICKET_SUBMITTER_ROLE.ADMIN
    ? submission.submittedByAccount?.username ?? null
    : submission.submittedByWorker?.laborCode ?? null;
}

// Function ดึงชื่อเต็มของผู้ส่งยอด (Admin หรือ Worker แล้วแต่ submittedByRole) ใน service flow
function resolveSubmitterName(
  submission: AdminVehicleJobHistoryRecord["marketJobs"][number]["tickets"][number]["completionSubmissions"][number],
): string | null {
  return submission.submittedByRole === TICKET_SUBMITTER_ROLE.ADMIN
    ? submission.submittedByAccount?.fullName ?? null
    : submission.submittedByWorker?.fullName ?? null;
}

// Function จัดรูปแบบ Booth หนึ่งใบสำหรับ Work History ใน service flow
// Reuse formatAdminFinancialBooth (คำนวณเงินจาก Snapshot ที่ Finalize แล้วเหมือนหน้า /financials
// ทุกประการ ห้ามคำนวณสูตรใหม่) แล้วเติมข้อมูลการส่งยอด/Reject ที่หน้า Financial เดิมไม่ต้องใช้
function formatAdminHistoryBooth(
  ticket: AdminVehicleJobHistoryRecord["marketJobs"][number]["tickets"][number],
  market: AdminVehicleJobHistoryRecord["marketJobs"][number],
  ownerByBoothKey: Map<string, HistoryOwnerStallInfo>,
  memberNameByKey: Map<string, string | null>,
  adminActionLogs: AdminActionLogDto[],
  isVehicleReleased: boolean,
): AdminHistoryBoothResponse {
  // ticket_id/ticket_no/marketCode/marketName ของ formatAdminFinancialBooth ไม่ใช้ที่นี่ เพราะ
  // Work History มีข้อมูลชุดนี้อยู่แล้วระดับ Markets[] หนึ่งชั้นเหนือขึ้นไป — ไม่ต้องซ้ำในทุก Booth
  const { ticket_id: _ticketId, ticket_no: _ticketNo, marketCode: _marketCode, marketName: _marketName, products: financialProducts, ...base } =
    formatAdminFinancialBooth(ticket, market);
  const products: AdminHistoryProductResponse[] = financialProducts.map(
    ({ ticket_product_id: _ticketProductId, ...product }) => product,
  );
  const submissions = ticket.completionSubmissions;
  const latestSubmission =
    submissions.length > 0 ? submissions[submissions.length - 1] : null;
  const submittedByCodes = [
    ...new Set(
      submissions
        .map((submission) => resolveSubmitterCode(submission))
        .filter((code): code is string => code !== null),
    ),
  ];
  const owner = ownerByBoothKey.get(buildOwnerStallKey(market.marketCode, ticket.boothCode)) ?? null;
  const rejectionHistory: AdminHistoryRejectionResponse[] = [];

  submissions.forEach((submission) => {
    if (!submission.rejectedAt) {
      return;
    }

    const rejectionActor = resolveRejectionActor(
      owner,
      market.marketCode,
      submission.resolvedByLineUserId,
      memberNameByKey,
    );

    rejectionHistory.push({
      rejectedAt: submission.rejectedAt.toISOString(),
      // Current Master Owner ของ Booth นี้ ไม่ใช่ Historical Snapshot
      correction_owner: owner?.full_name ?? null,
      // Current state เหมือน correction_owner ข้างบน — ทีมยังไม่ Release แก้เองได้ (worker) ทีม
      // Release ไปแล้วต้อง Admin จัดการแทน (admin)
      correction_owner_type: isVehicleReleased ? "admin" : "worker",
      rejected_by_type: rejectionActor.rejected_by_type,
      rejected_by_name: rejectionActor.rejected_by_name,
    });
  });

  return {
    ...base,
    products,
    vendor_line_id: ticket.vendorLineId,
    submitted_by_codes: submittedByCodes,
    submitted_by_role:
      (latestSubmission?.submittedByRole as "worker" | "admin" | undefined) ?? null,
    latest_submitted_by_code: latestSubmission ? resolveSubmitterCode(latestSubmission) : null,
    latest_submitted_by_name: latestSubmission ? resolveSubmitterName(latestSubmission) : null,
    submission_worker_snapshot: latestSubmission
      ? formatSubmissionWorkerSnapshot(latestSubmission)
      : [],
    submitted_at: latestSubmission?.createdAt.toISOString() ?? null,
    confirmedAt: latestSubmission?.confirmedAt?.toISOString() ?? null,
    confirmed_by_type: resolveConfirmedByType(latestSubmission),
    rejection_history: rejectionHistory,
    company_share_rate: calculateCompanyShareRate(
      base.summary.labor_fee_raw,
      base.summary.fund_amount,
    ),
    // จำนวน Worker WORKING ณ ตอน Submission ล่าสุดจริง (Historical Snapshot) ไม่ใช่ Roster
    // ปัจจุบันหรือ GateTicketWorkerSnapshot ตอน Confirm — null ถ้าไม่มี Submission หรือเป็น
    // Submission เก่าก่อน Feature นี้ (ห้าม fallback ไปนับ Worker ปัจจุบัน)
    worker_count: latestSubmission?.workerCountSnapshot ?? null,
    cancellation: formatCancellationResponse(
      ticket.status === TICKET_STATUS.CANCELLED,
      findBoothCancelLog(adminActionLogs, ticket.id, market.id),
    ),
  };
}

// Function สร้าง Job-level Worker Earnings ของ Work History ใน service flow — เงินจริงต่อ Worker
// ไม่ใช่ค่าเฉลี่ย: GROUP BY workerId แล้ว SUM(TicketWorker.finalEarningAmount) ที่ finalize
// ไว้แล้วในทุก MarketJob (Business Ticket) ของ VehicleJob นี้
function buildAdminHistoryJobWorkerEarnings(
  record: AdminVehicleJobHistoryRecord,
): Array<{
  worker_id: number;
  worker_code: string | null;
  full_name: string;
  total_amount: string;
}> {
  const totalByWorkerId = new Map<number, Prisma.Decimal>();

  for (const market of record.marketJobs) {
    for (const ticketWorker of market.ticketWorkers) {
      const amount = ticketWorker.finalEarningAmount ?? new Prisma.Decimal(0);
      const existing = totalByWorkerId.get(ticketWorker.workerId) ?? new Prisma.Decimal(0);

      totalByWorkerId.set(ticketWorker.workerId, existing.plus(amount));
    }
  }

  // ชุด Worker ต้องตรงกับ Workers[] เป๊ะ (คนที่กดรับงานจริงและไม่ซ้ำต่อคน) ไม่ใช่ทุกคนที่เคยมีแถวใน
  // ticket_workers — คนที่กดรับแล้วถูกยกเลิกก่อน Scan (ไม่มีแถว ticket_workers เลย) ต้องยังมีหนึ่ง
  // แถวที่นี่ TotalAmount = "0.00" แทนที่จะหายไปเงียบๆ
  const acceptedWorkers = selectLatestAcceptedAssignmentPerWorker(record.assignments);

  return acceptedWorkers.map((assignment) => ({
    worker_id: assignment.workerId,
    worker_code: assignment.worker.laborCode,
    full_name: assignment.worker.fullName ?? assignment.worker.laborCode,
    total_amount: (
      totalByWorkerId.get(assignment.workerId) ?? new Prisma.Decimal(0)
    ).toFixed(2),
  }));
}

// Function derive HistoryStatus ต่อ record เดียวกับ business group ที่ history_status query กรอง
// (buildHistoryStatusFilter ใน admin-jobs.repository.ts) ห้ามให้ตรรกะสองจุดนี้เพี้ยนไปจากกัน —
// ลำดับความสำคัญ CANCELLED → COMPLETED → REJECT_PENDING เหมือนกัน null เมื่อไม่เข้ากลุ่มใดเลย (เช่น
// WAIT/WORKING ที่ไม่มี Booth REJECT ค้าง — เกิดได้เมื่อไม่ได้กรองด้วย history_status)
function deriveHistoryStatus(record: AdminVehicleJobHistoryRecord): HistoryStatusValue | null {
  if (record.status === VEHICLE_JOB_STATUS.CANCELLED) {
    return "CANCELLED";
  }

  if (record.status === VEHICLE_JOB_STATUS.COMPLETED) {
    return "COMPLETED";
  }

  const hasPendingReject = record.marketJobs.some((market) =>
    market.tickets.some((ticket) => ticket.status === TICKET_STATUS.REJECT),
  );

  if (!TERMINAL_JOB_STATUSES.includes(record.status) && hasPendingReject) {
    return "REJECT_PENDING";
  }

  return null;
}

// Function รวม TicketCompletionSubmission ทุกใบของทุก Booth ในทุก Business Ticket ของ VehicleJob
// นี้เป็นชุดเดียว — ใช้ร่วมกันใน deriveHistoryFlags แทนการวน loop ซ้อนกันหลายรอบต่อ flag
function collectAllCompletionSubmissions(
  record: AdminVehicleJobHistoryRecord,
): AdminVehicleJobHistoryRecord["marketJobs"][number]["tickets"][number]["completionSubmissions"] {
  return record.marketJobs.flatMap((market) =>
    market.tickets.flatMap((ticket) => ticket.completionSubmissions),
  );
}

// Function derive HistoryFlags ต่อ record — เหตุการณ์สำคัญย้อนหลังที่เคยเกิดขึ้นกับ VehicleJob นี้
// คนละความหมายกับ deriveHistoryStatus (สถานะหลักปัจจุบัน) งานหนึ่งงานมีได้หลาย flag พร้อมกัน ใช้แค่
// ข้อมูล transactional ที่มีอยู่แล้วใน record ห้าม derive จากข้อความ Timeline/Description เด็ดขาด —
// ลำดับการคืนค่าตรงกับ HISTORY_FLAG_VALUES เสมอ (ไม่ใช่ลำดับที่เจอเหตุการณ์จริง) และไม่มีค่าซ้ำโดย
// ธรรมชาติ (แต่ละ flag ถูกประเมินเป็น boolean เดียวครั้งเดียว ไม่ใช่ push ซ้ำจากหลาย submission)
function deriveHistoryFlags(record: AdminVehicleJobHistoryRecord): HistoryFlagValue[] {
  const submissions = collectAllCompletionSubmissions(record);
  const allTickets = record.marketJobs.flatMap((market) => market.tickets);

  const isFlagActive: Record<HistoryFlagValue, boolean> = {
    FINANCE_CALCULATED: allTickets.some(
      (ticket) => ticket.financializedAt !== null,
    ),
    WORKERS_RELEASED: record.assignments.some(
      (assignment) => assignment.releasedAt !== null,
    ),
    // ต้องตรวจทุก submission ไม่ใช่แค่ GateTicket.status ปัจจุบัน — งานที่เคย Reject แล้วแก้สำเร็จ
    // (status ปัจจุบันไม่ใช่ REJECT แล้ว) ยังต้องติด flag นี้อยู่
    BOOTH_REJECTED: submissions.some(
      (submission) => submission.rejectedAt !== null,
    ),
    // เงื่อนไขเดียวกับ resolveConfirmedByType ที่คืน "timeout" (ไม่มี resolvedByLineUserId แปลว่า
    // Vendor ไม่ได้กดยืนยันเอง เป็น BullMQ Timeout auto-confirm แทน)
    AUTO_CONFIRMED: submissions.some(
      (submission) =>
        submission.confirmedAt !== null && submission.resolvedByLineUserId === null,
    ),
    // นับเฉพาะ assignment ที่เคยกดรับงานจริง (acceptedAt ไม่ null) แล้วถูก ADMIN_CANCELLED — dispatch
    // ที่ถูกยกเลิกก่อนกดรับไม่นับเป็น "เปลี่ยนแรงงานระหว่างงาน"
    WORKER_CHANGED_DURING_JOB: record.assignments.some(
      (assignment) =>
        assignment.acceptedAt !== null &&
        assignment.events.some(
          (event) => event.eventType === WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED,
        ),
    ),
    // ใช้ workerCountSnapshot ณ เวลา Submit เท่านั้น — submission เก่าก่อนมี feature นี้ที่
    // workerCountSnapshot เป็น null ต้องข้ามไป ห้าม fallback จาก roster ปัจจุบันหรือแหล่งอื่น
    SUBMISSION_ROSTER_INCOMPLETE: submissions.some(
      (submission) =>
        submission.workerCountSnapshot !== null &&
        submission.workerCountSnapshot < record.workersRequired,
    ),
    ADMIN_SUBMITTED_ON_BEHALF: submissions.some(
      (submission) => submission.submittedByRole === TICKET_SUBMITTER_ROLE.ADMIN,
    ),
    // สอง flag นี้ mutually exclusive กันเองโดยธรรมชาติ (workStartedAt เป็น null หรือไม่เป็น null
    // อย่างใดอย่างหนึ่งเท่านั้น) ไม่ต้องเช็คแยกป้องกันซ้ำ
    VEHICLE_CANCELLED_AFTER_START:
      record.status === VEHICLE_JOB_STATUS.CANCELLED && record.workStartedAt !== null,
    VEHICLE_CANCELLED_BEFORE_START:
      record.status === VEHICLE_JOB_STATUS.CANCELLED && record.workStartedAt === null,
  };

  return HISTORY_FLAG_VALUES.filter((flag) => isFlagActive[flag]);
}

// Function จัดรูปแบบ Work History แบบละเอียดของ VehicleJob หนึ่งคัน ใน service flow
function formatAdminVehicleJobHistoryDetail(
  record: AdminVehicleJobHistoryRecord,
  adminActionLogs: AdminActionLogDto[],
  ownerByBoothKey: Map<string, HistoryOwnerStallInfo>,
  memberNameByKey: Map<string, string | null>,
): AdminVehicleJobHistoryItemResponse {
  const historyStatus = deriveHistoryStatus(record);
  const historyFlags = deriveHistoryFlags(record);
  const isVehicleReleased = record.status === VEHICLE_JOB_STATUS.RELEASED;
  const markets = record.marketJobs.map((market) => ({
    ticket_no: market.ticketNo,
    marketCode: market.marketCode,
    marketName: market.marketName,
    dropoff_point: market.dropoffPoint,
    status: market.status,
    cancellation: formatCancellationResponse(
      market.status === VEHICLE_JOB_STATUS.CANCELLED,
      findMarketCancelLog(adminActionLogs, market.id),
    ),
    booths: market.tickets.map((ticket) =>
      formatAdminHistoryBooth(
        ticket,
        market,
        ownerByBoothKey,
        memberNameByKey,
        adminActionLogs,
        isVehicleReleased,
      ),
    ),
  }));
  const booths = markets.flatMap((market) => market.booths);
  const jobTimestamps = deriveAdminHistoryJobTimestamps(record);

  let stallFeeTotal = new Prisma.Decimal(0);
  let laborFeeTotal = new Prisma.Decimal(0);
  let totalWorkerShare = new Prisma.Decimal(0);
  let fundAmount = new Prisma.Decimal(0);

  for (const booth of booths) {
    if (booth.final_stall_amount !== null) {
      stallFeeTotal = stallFeeTotal.plus(booth.final_stall_amount);
    }

    laborFeeTotal = laborFeeTotal.plus(booth.summary.labor_fee_raw);
    totalWorkerShare = totalWorkerShare.plus(booth.summary.worker_payout_total);
    fundAmount = fundAmount.plus(booth.summary.fund_amount);
  }

  // ชุดเดียวกับ Workers[] (formatAdminHistoryWorkers) เสมอ — คนที่กดรับงานจริงและไม่ซ้ำต่อคน
  const financeWorkers = buildAdminHistoryJobWorkerEarnings(record);

  return {
    vehicle_job: {
      ticket_number: record.ticketNumber,
      plate_no: record.licensePlate,
      plate_province: record.licensePlateProvince,
      vehicle_type: record.vehicleType,
      workers_required: record.workersRequired,
      dispatch_now: record.dispatchNow,
      status: record.status,
      history_status: historyStatus,
      history_flags: historyFlags,
      cancellation: formatCancellationResponse(
        record.status === VEHICLE_JOB_STATUS.CANCELLED,
        findVehicleCancelLog(adminActionLogs),
      ),
      ...jobTimestamps,
    },
    markets,
    workers: formatAdminHistoryWorkers(record, adminActionLogs),
    timeline: formatAdminHistoryTimeline(record, adminActionLogs, jobTimestamps),
    finance: {
      stall_fee_total: stallFeeTotal.toFixed(2),
      labor_fee_total: laborFeeTotal.toFixed(4),
      total_worker_share: totalWorkerShare.toFixed(2),
      fund_amount: fundAmount.toFixed(4),
      worker_count: financeWorkers.length,
      workers: financeWorkers,
    },
  };
}


// Function จัดรูปแบบ market job action response ใน service flow
function formatMarketJobActionResponse(
  message: string,
  market: MarketJobDto,
  vehicleJob: VehicleJobDto | null,
): AdminMarketJobActionResponse {
  return {
    message,
    ticket_number: vehicleJob?.ticket_number ?? null,
    ticket_no: market.ticket_no,
    marketCode: market.marketCode,
    status: market.status,
  };
}

// Function จัดรูปแบบ stall job action response ใน service flow
function formatStallJobActionResponse(
  message: string,
  ticket: GateTicketDto,
  vehicleJob: VehicleJobDto | null,
  marketJob: MarketJobDto | null,
): AdminStallJobActionResponse {
  return {
    message,
    ticket_number: vehicleJob?.ticket_number ?? null,
    ticket_no: marketJob?.ticket_no ?? null,
    marketCode: marketJob?.marketCode ?? null,
    boothCode: ticket.boothCode,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
  };
}

// Function จัดสถานะ Financial ระดับ VehicleJob
function resolveVehicleJobFinancialStatus(
  boothCount: number,
  financializedBoothCount: number,
): AdminVehicleJobFinancialResponse["financial_status"] {
  if (financializedBoothCount === 0) {
    return "PENDING";
  }

  if (financializedBoothCount < boothCount) {
    return "PARTIAL";
  }

  return "FINALIZED";
}

// Function จัดรูปแบบ Product Financial สำหรับ Admin
function formatAdminFinancialProduct(
  product: AdminVehicleJobFinancialRecord["marketJobs"][number]["tickets"][number]["products"][number],
): AdminVehicleJobFinancialResponse["booths"][number]["products"][number] {
  const financial = product.financial;

  return {
    ticket_product_id: product.id,
    productCode: product.productCode,
    productFullCode: product.productFullCode,
    productName: product.productName,
    packageCode: product.packageCode,
    packageName: product.packageName,
    quantity: product.quantity.toFixed(2),
    confirmed_quantity: product.confirmedQuantity?.toFixed(2) ?? null,
    rate_snapshot: {
      package_weight_snapshot:
        product.packageWeightSnapshot?.toFixed(2) ?? null,
      rate_id_snapshot: product.rateIdSnapshot,
      source_rate_id_snapshot: product.sourceRateIdSnapshot,
      rate_market_code: product.rateMarketCode,
      rate_source: product.rateSource,
      weight_range_name: product.weightRangeName,
      weight_min_snapshot: product.weightMinSnapshot?.toFixed(2) ?? null,
      weight_max_snapshot: product.weightMaxSnapshot?.toFixed(2) ?? null,
      stall_rate_snapshot: product.stallRateSnapshot?.toFixed(2) ?? null,
      labor_rate_snapshot: product.laborRateSnapshot?.toFixed(2) ?? null,
      rate_snapshot_at: product.rateSnapshotAt?.toISOString() ?? null,
    },
    financial: financial
      ? {
          stall_fee_raw: financial.stallFeeRaw.toFixed(4),
          stall_fee_rounded: financial.stallFeeRounded.toFixed(2),
          labor_fee_raw: financial.laborFeeRaw.toFixed(4),
          product_charge: financial.productCharge.toFixed(2),
          worker_count: financial.workerCount,
          worker_payout_total: financial.workerPayoutTotal.toFixed(2),
          fund_amount: financial.fundAmount.toFixed(4),
          finalized_at: financial.finalizedAt.toISOString(),
        }
      : null,
    workers:
      financial?.workerPayments.map((payment) => ({
        ticket_worker_id: payment.ticketWorker.id,
        worker_code: payment.ticketWorker.worker.laborCode,
        full_name: payment.ticketWorker.worker.fullName ?? payment.ticketWorker.worker.laborCode,
        membership_status: payment.ticketWorker.status,
        raw_amount: payment.rawAmount.toFixed(8),
        remainder_amount: payment.remainderAmount.toFixed(8),
        final_amount: payment.finalAmount.toFixed(2),
      })) ?? [],
  };
}

// Function จัดรูปแบบ Booth Financial สำหรับ Admin
//
// Worker Roster (ticketWorkers) อยู่ระดับ Business Ticket (marketJob) ไม่ใช่ระดับ Booth แล้ว
// ดังนั้น "ยอดรวมต่อ Worker ของ Booth นี้" ต้องรวมจาก TicketWorkerPayment ของ Product ที่อยู่
// ใน Booth นี้เท่านั้น (ผ่าน product.financial.workerPayments) ห้ามใช้ ticketWorker.payments
// ตรงๆ เพราะจะรวมยอดข้าม Booth อื่นของ Business Ticket เดียวกันมาด้วย
function formatAdminFinancialBooth(
  ticket: AdminVehicleJobFinancialRecord["marketJobs"][number]["tickets"][number],
  marketJob: AdminVehicleJobFinancialRecord["marketJobs"][number],
): AdminVehicleJobFinancialResponse["booths"][number] {
  let laborFeeRaw = new Prisma.Decimal(0);
  let workerPayoutTotal = new Prisma.Decimal(0);
  let fundAmount = new Prisma.Decimal(0);

  const boothWorkerTotals = new Map<
    number,
    {
      worker_code: string;
      full_name: string;
      membership_status: string;
      total: Prisma.Decimal;
    }
  >();

  for (const product of ticket.products) {
    if (!product.financial) {
      continue;
    }

    laborFeeRaw = laborFeeRaw.plus(product.financial.laborFeeRaw);
    workerPayoutTotal = workerPayoutTotal.plus(
      product.financial.workerPayoutTotal,
    );
    fundAmount = fundAmount.plus(product.financial.fundAmount);

    for (const payment of product.financial.workerPayments) {
      const existing = boothWorkerTotals.get(payment.ticketWorker.id);
      const total = (existing?.total ?? new Prisma.Decimal(0)).plus(
        payment.finalAmount,
      );

      boothWorkerTotals.set(payment.ticketWorker.id, {
        worker_code: payment.ticketWorker.worker.laborCode,
        full_name: payment.ticketWorker.worker.fullName ?? payment.ticketWorker.worker.laborCode,
        membership_status: payment.ticketWorker.status,
        total,
      });
    }
  }

  // Roster ทั้งหมดของ Business Ticket (รวม Worker ที่ถูก Cancel/ไม่มี Payment ใน Booth นี้)
  // ต้องยังคงแสดงในรายการเพื่อการตรวจสอบ แม้ total_amount ของ Booth นี้จะเป็น 0
  for (const ticketWorker of marketJob.ticketWorkers) {
    if (boothWorkerTotals.has(ticketWorker.id)) {
      continue;
    }

    boothWorkerTotals.set(ticketWorker.id, {
      worker_code: ticketWorker.worker.laborCode,
      full_name: ticketWorker.worker.fullName ?? ticketWorker.worker.laborCode,
      membership_status: ticketWorker.status,
      total: new Prisma.Decimal(0),
    });
  }

  const workers = Array.from(boothWorkerTotals.entries()).map(
    ([ticketWorkerId, { worker_code, full_name, membership_status, total }]) => ({
      ticket_worker_id: ticketWorkerId,
      worker_code,
      full_name,
      membership_status,
      total_amount: total.toFixed(2),
    }),
  );

  return {
    ticket_id: ticket.id,
    ticket_no: marketJob.ticketNo,
    marketCode: marketJob.marketCode,
    marketName: marketJob.marketName,
    boothCode: ticket.boothCode,
    boothName: ticket.boothName,
    status: ticket.status,
    financialized: ticket.financializedAt !== null,
    final_stall_amount: ticket.finalStallAmount?.toFixed(2) ?? null,
    completed_at: ticket.completedAt?.toISOString() ?? null,
    summary: {
      labor_fee_raw: laborFeeRaw.toFixed(4),
      worker_payout_total: workerPayoutTotal.toFixed(2),
      fund_amount: fundAmount.toFixed(4),
    },
    workers,
    products: ticket.products.map(formatAdminFinancialProduct),
  };
}

// Function ตรวจสอบและดึง vehicle job ตาม ref ใน service flow
async function requireVehicleJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof vehicleJobRepository.findVehicleJobByRef>[1],
): Promise<VehicleJobDto> {
  const ticketNumber = parseReference(
    idParam,
    "INVALID_VEHICLE_JOB_REF",
    "TicketNumber is invalid.",
  );
  const vehicleJob = await vehicleJobRepository.findVehicleJobByRef(
    ticketNumber,
    connection,
  );

  if (!vehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return vehicleJob;
}

// Function จัดการ assignment queue priority at ใน service flow
function assignmentQueuePriorityAt(
  assignment: VehicleJobAssignmentDto,
): number {
  const value = assignment.accepted_at ?? assignment.created_at;
  const timestamp = value
    ? new Date(value).getTime()
    : Number.POSITIVE_INFINITY;

  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

// Function เรียง assignments ตาม accepted_at (fallback created_at) ให้เป็นลำดับเดียวกับตอนเข้าคิว
// ครั้งแรก — ใช้ร่วมกันทุกจุดที่ต้อง requeue Worker กลับเข้าคิว ไม่ว่าจะเข้าหน้าคิว (cancel+requeue,
// Admin สั่ง Dispatch:false) หรือต่อท้ายคิว (release-workers หลังส่งยอดครบ) ลำดับสัมพัทธ์ระหว่างกันต้อง
// อิงเวลากดรับงานเสมอ ไม่ใช่ลำดับที่ assignment ถูกสร้าง/dispatch
function sortAssignmentsByAcceptedAt(
  assignments: VehicleJobAssignmentDto[],
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
  const currentTime = currentDeadline
    ? new Date(currentDeadline).getTime()
    : now;
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
  assignments: VehicleJobAssignmentDto[],
): Promise<AdminScanDeadlineAssignmentResponse[]> {
  const workerCodeMap = await profileRepository.findWorkerCodeMapByAccountIds(
    assignments.map((assignment) => assignment.worker_id),
  );

  return assignments.map((assignment) => ({
    worker_code: workerCodeMap.get(assignment.worker_id) ?? null,
    status: assignment.status,
    scan_deadline_at: assignment.scan_deadline_at,
    scan_deadline_unix_ms: toUnixMs(assignment.scan_deadline_at),
  }));
}

// Function สร้าง admin assignment responses ใน service flow
async function buildAdminAssignmentResponses(
  ticketNumber: string,
  assignments: VehicleJobAssignmentDto[],
): Promise<AdminAssignmentResponse[]> {
  const workerCodeMap = await profileRepository.findWorkerCodeMapByAccountIds(
    assignments.map((assignment) => assignment.worker_id),
  );

  return assignments.map((assignment) => ({
    ticket_number: ticketNumber,
    worker_code: workerCodeMap.get(assignment.worker_id) ?? null,
    status: assignment.status,
    accept_deadline_at: assignment.accept_deadline_at,
    accept_deadline_unix_ms: toUnixMs(assignment.accept_deadline_at),
    scan_deadline_at: assignment.scan_deadline_at,
    scan_deadline_unix_ms: toUnixMs(assignment.scan_deadline_at),
    created_at: assignment.created_at,
    updated_at: assignment.updated_at,
  }));
}

// Function ดึงรายการ vehicle job worker IDs ใน service flow
async function listVehicleJobWorkerIds(
  vehicleJobId: number,
): Promise<number[]> {
  const assignments =
    await adminJobsRepository.listActiveAssignmentsByVehicleJob(vehicleJobId);

  return [
    ...new Set(assignments.map((assignment) => assignment.worker_id)),
  ];
}

// Function ดึงรายการ stall job worker IDs ใน service flow
async function listStallJobWorkerIds(ticket: GateTicketDto): Promise<number[]> {
  const ticketWorkers = await ticketWorkerRepository.listTicketWorkers(
    ticket.market_job_id,
  );

  if (ticketWorkers.length > 0) {
    return [
      ...new Set(ticketWorkers.map((worker) => worker.worker_id)),
    ];
  }

  return listVehicleJobWorkerIds(ticket.vehicle_job_id);
}

// Function ดึง Financial breakdown ของ VehicleJob สำหรับ Admin
export async function getVehicleJobFinancials(
  ticketNumberParam: unknown,
): Promise<AdminVehicleJobFinancialResponse> {
  const ticketNumber = parseReference(
    ticketNumberParam,
    "INVALID_VEHICLE_JOB_REF",
    "TicketNumber is invalid.",
  );

  const vehicleJob =
    await adminJobsRepository.findVehicleJobFinancialByRef(ticketNumber);

  if (!vehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  const booths = vehicleJob.marketJobs.flatMap((market) =>
    market.tickets.map((ticket) => formatAdminFinancialBooth(ticket, market)),
  );
  const financializedBoothCount = booths.filter(
    (booth) => booth.financialized,
  ).length;

  let finalStallAmount = new Prisma.Decimal(0);
  let laborFeeRaw = new Prisma.Decimal(0);
  let workerPayoutTotal = new Prisma.Decimal(0);
  let fundAmount = new Prisma.Decimal(0);

  for (const booth of booths) {
    if (booth.final_stall_amount !== null) {
      finalStallAmount = finalStallAmount.plus(booth.final_stall_amount);
    }

    laborFeeRaw = laborFeeRaw.plus(booth.summary.labor_fee_raw);
    workerPayoutTotal = workerPayoutTotal.plus(
      booth.summary.worker_payout_total,
    );
    fundAmount = fundAmount.plus(booth.summary.fund_amount);
  }

  return {
    vehicle_job: {
      ticket_number: vehicleJob.ticketNumber,
      license_plate: vehicleJob.licensePlate,
      license_plate_province: vehicleJob.licensePlateProvince,
      vehicle_type: vehicleJob.vehicleType,
      status: vehicleJob.status,
    },
    financial_status: resolveVehicleJobFinancialStatus(
      booths.length,
      financializedBoothCount,
    ),
    summary: {
      booth_count: booths.length,
      financialized_booth_count: financializedBoothCount,
      final_stall_amount: finalStallAmount.toFixed(2),
      labor_fee_raw: laborFeeRaw.toFixed(4),
      worker_payout_total: workerPayoutTotal.toFixed(2),
      fund_amount: fundAmount.toFixed(4),
    },
    booths,
  };
}

// Function ดึงรายการ vehicle jobs ใน service flow
// Function Batch-fetch ผู้ที่กด Reject ผ่าน LINE (Owner/Member) และ Current Master Owner ของทุก
// Booth ที่มี Rejection History ใน Vehicle Job list หน้านี้ ใน service flow — query ครั้งเดียวต่อหน้า
// ไม่ query ต่อแถว/ต่อ Booth
async function buildHistoryRejectionActorContext(
  records: AdminVehicleJobHistoryRecord[],
): Promise<{
  ownerByBoothKey: Map<string, HistoryOwnerStallInfo>;
  memberNameByKey: Map<string, string | null>;
}> {
  const boothPairs = new Map<string, { marketCode: string; boothCode: string }>();

  for (const record of records) {
    for (const market of record.marketJobs) {
      for (const ticket of market.tickets) {
        if (ticket.completionSubmissions.some((submission) => submission.rejectedAt)) {
          boothPairs.set(buildOwnerStallKey(market.marketCode, ticket.boothCode), {
            marketCode: market.marketCode,
            boothCode: ticket.boothCode,
          });
        }
      }
    }
  }

  const ownerByBoothKey = await masterDataRepository.findOwnerStallsByMarketAndBooth(
    Array.from(boothPairs.values()),
  );

  const memberRequests: Array<{
    marketCode: string;
    ownerCardId: string;
    ownerLineUserId: string;
    memberLineUserId: string;
  }> = [];
  const seenMemberKeys = new Set<string>();

  for (const record of records) {
    for (const market of record.marketJobs) {
      for (const ticket of market.tickets) {
        for (const submission of ticket.completionSubmissions) {
          if (!submission.rejectedAt || !submission.resolvedByLineUserId) {
            continue;
          }

          const owner = ownerByBoothKey.get(
            buildOwnerStallKey(market.marketCode, ticket.boothCode),
          );

          if (!owner?.line_user_id || owner.line_user_id === submission.resolvedByLineUserId) {
            continue;
          }

          const key = buildMemberStallKey(
            market.marketCode,
            owner.card_id,
            owner.line_user_id,
            submission.resolvedByLineUserId,
          );

          if (seenMemberKeys.has(key)) {
            continue;
          }

          seenMemberKeys.add(key);
          memberRequests.push({
            marketCode: market.marketCode,
            ownerCardId: owner.card_id,
            ownerLineUserId: owner.line_user_id,
            memberLineUserId: submission.resolvedByLineUserId,
          });
        }
      }
    }
  }

  const memberNameByKey =
    await masterDataRepository.findMemberStallFullNamesByOwnerAndLineUserId(memberRequests);

  return { ownerByBoothKey, memberNameByKey };
}

export async function listVehicleJobs(query: unknown): Promise<{
  data: AdminVehicleJobHistoryItemResponse[];
  available_dropoff_points: string[];
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
    history_status: filters.history_status,
    dropoff_point: filters.dropoff_point,
    page: filters.page,
    limit: filters.limit,
    ...dateRange,
  });
  const adminActionLogsByVehicleJobId = new Map<number, AdminActionLogDto[]>(
    await Promise.all(
      result.data.map(async (vehicleJob) => {
        const logs = await adminActionLogRepository.listByVehicleJobId(vehicleJob.id);

        return [vehicleJob.id, logs] as const;
      }),
    ),
  );
  const { ownerByBoothKey, memberNameByKey } = await buildHistoryRejectionActorContext(
    result.data,
  );
  const formatItem = (vehicleJob: (typeof result.data)[number]) =>
    formatAdminVehicleJobHistoryDetail(
      vehicleJob,
      adminActionLogsByVehicleJobId.get(vehicleJob.id) ?? [],
      ownerByBoothKey,
      memberNameByKey,
    );

  if (filters.page === undefined) {
    return {
      data: result.data.map(formatItem),
      available_dropoff_points: result.available_dropoff_points,
    };
  }

  const limit = filters.limit ?? 20;
  const total = result.total ?? result.data.length;

  return {
    data: result.data.map(formatItem),
    available_dropoff_points: result.available_dropoff_points,
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
  query: unknown,
): Promise<AdminVehicleJobOperationListResponse> {
  const filters = parseWithSchema(adminVehicleJobOperationsQuerySchema, query);
  const dateFrom = filters.date ?? filters.date_from;
  const dateTo = filters.date ?? filters.date_to;
  const dateRange = buildBangkokDateSpanRange(
    dateFrom,
    dateTo,
    filters.time_from,
    filters.time_to
  );
  const { records, available_dropoff_points } = await adminJobsRepository.listVehicleJobOperations({
    search: filters.search,
    operation_status: filters.operation_status,
    dropoff_point: filters.dropoff_point,
    page: filters.page,
    limit: filters.limit,
    ...dateRange,
  });
  const items = records.map(formatVehicleOperationItem);
  const summary = buildVehicleOperationSummary(items);
  const filteredItems = items
    .filter((item) =>
      filters.operation_status
        ? item.operation_status === filters.operation_status
        : true,
    )
    .filter((item) =>
      filters.status ? item.vehicle_job.status === filters.status : true,
    )
    .filter((item) =>
      filters.has_issue ? item.market_summary.rejected > 0 : true,
    );

  if (filters.page === undefined) {
    return {
      server_time: new Date().toISOString(),
      summary,
      data: filteredItems,
      available_dropoff_points,
    };
  }

  const limit = filters.limit ?? 20;
  const start = (filters.page - 1) * limit;
  const pagedItems = filteredItems.slice(start, start + limit);

  return {
    server_time: new Date().toISOString(),
    summary,
    data: pagedItems,
    available_dropoff_points,
    pagination: {
      page: filters.page,
      limit,
      total: filteredItems.length,
      total_pages: Math.ceil(filteredItems.length / limit),
    },
  };
}

// Function ยกเลิก vehicle job ใน service flow
// Function ทำขั้นตอนร่วมของการยกเลิก vehicle job ทั้งคัน (ใช้ทั้งใน cancelVehicleJob และ
// cancelVehicleJobAndRequeue ก่อนที่แต่ละฝั่งจะแยกไปทำ open_app หรือ requeue ของตัวเอง)
async function performVehicleJobCancellation(
  idParam: unknown,
  body: unknown,
  actorId: number,
) {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  const input = parseWithSchema(adminCancelBodySchema, body ?? {});

  const { vehicleJob, activeAssignments, ticketNos } = await withTransaction(
    async (transaction) => {
      // Lock แถวรถก่อนอ่านสถานะล่าสุดและยกเลิก — กัน race กับ vendor confirm/auto-confirm
      // (closeCompletedVehicleJobIfReady) ที่อาจปิดรถคันนี้เป็น COMPLETED/CANCELLED พร้อมกันอยู่คนละ
      // Transaction ใช้ Lock เดียวกัน (FOR UPDATE บน vehicle_jobs) จึง serialize กันเองโดยอัตโนมัติ
      await transaction.$queryRaw`SELECT id FROM vehicle_jobs WHERE id = ${vehicleJobId} FOR UPDATE`;

      const current = await vehicleJobRepository.findVehicleJobById(
        vehicleJobId,
        transaction,
      );

      if (!current) {
        throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
      }

      if (TERMINAL_JOB_STATUSES.includes(current.status)) {
        throw new ApiError(
          409,
          "VEHICLE_JOB_CLOSED",
          "Vehicle job is already completed or cancelled.",
        );
      }

      // ต้องดึงก่อน cancelVehicleJob เท่านั้น เพราะ cancel ทำให้ MarketJob ทุกใบของรถคันนี้กลายเป็น
      // CANCELLED ไปด้วย — ดึงหลังจากนั้นจะได้ array ว่างเปล่าเสมอ
      const activeAssignments =
        await adminJobsRepository.listActiveAssignmentsByVehicleJob(
          vehicleJobId,
          transaction,
        );
      const ticketNos =
        await marketJobRepository.listActiveTicketNosByVehicleJobId(
          vehicleJobId,
          transaction,
        );

      const cancelled = await adminJobsRepository.cancelVehicleJob(
        vehicleJobId,
        transaction,
      );

      // เพิกถอน driver session ที่ยัง active ทั้งหมดของรถคันนี้ทันทีที่ถูกยกเลิกทั้งคัน — เหตุผลเดียวกับ
      // ใน closeCompletedVehicleJobIfReady
      await driverRepository.revokeDriverSessionsByVehicleJobId(
        vehicleJobId,
        transaction,
      );

      await adminActionLogRepository.create(
        {
          vehicle_job_id: vehicleJobId,
          action_type: ADMIN_ACTION_TYPE.VEHICLE_JOB_CANCELLED,
          reason_code: input.reason_code ?? null,
          reason_text: input.reason_text ?? null,
          actor_account_id: actorId,
        },
        transaction,
      );

      return { vehicleJob: cancelled, activeAssignments, ticketNos };
    },
  );

  await Promise.all(
    activeAssignments.flatMap((assignment) => [
      removeAssignmentTimeout(assignment.id),
      removeScanTimeout(assignment.id),
      removeScanWarning(assignment.id),
    ]),
  );

  return { vehicleJob, activeAssignments, ticketNos };
}

// Function ยกเลิก vehicle job และ requeue ใน service flow
async function cancelVehicleJobAndRequeue(
  idParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminCancelVehicleJobAndRequeueResponse> {
  const actorId = requireActorId(auth);
  const { vehicleJob, activeAssignments, ticketNos } =
    await performVehicleJobCancellation(idParam, body, actorId);

  const sortedAssignments =
    sortAssignmentsByAcceptedAt(activeAssignments);
  const requeuedWorkerIds = sortedAssignments.map(
    (assignment) => assignment.worker_id,
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
    message: `Vehicle job ${vehicleJob.ticket_number} was cancelled and workers were requeued.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      status: vehicleJob.status,
      requeued: true,
    },
    worker_payload: {
      ticketNumber: vehicleJob.ticket_number,
      ticketNos,
      status: vehicleJob.status,
      requeued: true,
      reason: "vehicle_job_cancelled_requeue",
    },
    worker_ids: requeuedWorkerIds,
  });
  await dispatchReadyWorkers();
  const requeuedWorkerCodes =
    await profileRepository.findWorkerCodesByAccountIds(requeuedWorkerIds);

  publishNotification({
    type: "VEHICLE_JOB_CANCELLED_AND_REQUEUED",
    title: "Vehicle job cancelled and workers requeued",
    message: `Vehicle job ${vehicleJob.ticket_number} was cancelled and workers were requeued.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      status: vehicleJob.status,
      requeued_worker_codes: requeuedWorkerCodes,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Vehicle job cancelled and workers requeued successfully.",
    ticket_number: vehicleJob.ticket_number,
    status: vehicleJob.status,
    requeued_worker_codes: requeuedWorkerCodes,
  };
}

// Function ยกเลิกรวม (vehicle/ticket_no/booth/worker) ใน service flow — scope ตัดสินจากว่า ticket_no/
// boothCode/worker_code ตัวไหนถูกระบุมาบ้าง ดู comment ที่ adminVehicleJobAssignmentCancelBodySchema
// สำหรับตาราง mapping เต็ม แทนที่ /jobs/cancel, tickets/:ticketNo/cancel, stalls/:stallCode/cancel,
// workers/:workerCode/assignment/cancel, tickets/:ticketNo/workers/:workerCode/cancel เดิมทั้งหมด
export async function cancelVehicleJobAssignment(
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminVehicleJobAssignmentCancelResponse> {
  const input = parseWithSchema(adminVehicleJobAssignmentCancelBodySchema, body);
  const cancelBody = { reason_code: input.reason_code, reason_text: input.reason_text };

  if (input.boothCode && !input.ticket_no) {
    throw new ApiError(
      400,
      "INVALID_CANCEL_SCOPE",
      "boothCode requires ticket_no to also be specified.",
    );
  }

  if (!input.ticket_no && !input.worker_code) {
    return cancelVehicleJobAndRequeue(input.ticket_number, cancelBody, auth);
  }

  if (!input.ticket_no && input.worker_code) {
    return cancelAssignment(
      input.ticket_number,
      input.worker_code,
      cancelBody,
      auth,
    );
  }

  // จากตรงนี้ ticket_no มีค่าแน่นอนแล้ว (ผ่าน guard ด้านบนมาแล้ว)
  if (input.boothCode && input.worker_code) {
    return cancelTicketWorkerFromBooth(
      input.ticket_number,
      input.ticket_no,
      input.boothCode,
      input.worker_code,
      cancelBody,
      auth,
    );
  }

  if (input.boothCode) {
    return cancelStallJobByTicketContext(
      input.ticket_number,
      input.ticket_no,
      input.boothCode,
      cancelBody,
      auth,
    );
  }

  if (input.worker_code) {
    return cancelTicketWorker(
      input.ticket_number,
      input.ticket_no,
      input.worker_code,
      cancelBody,
      auth,
    );
  }

  return cancelMarketJobByTicketContext(
    input.ticket_number,
    input.ticket_no,
    cancelBody,
    auth,
  );
}

// Function จัดการ vehicle job workers ใน service flow
export async function assignVehicleJobWorkers(
  idParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminAssignWorkersResponse> {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  const input = parseWithSchema(adminAssignWorkersBodySchema, body);
  const actorId = requireActorId(auth);
  const workerCodes = [...new Set(input.worker_codes)];
  const settings = await getRuntimeSettings();
  const acceptDeadlineMs = settings.worker_accept_deadline_seconds * 1000;

  const { assignments, vehicleJob } = await withTransaction(
    async (transaction) => {
      const vehicleJob = await requireVehicleJobByRef(idParam, transaction);

      if (TERMINAL_JOB_STATUSES.includes(vehicleJob.status)) {
        throw new ApiError(
          409,
          "VEHICLE_JOB_CLOSED",
          "Vehicle job is already closed.",
        );
      }

      const createdAssignments: VehicleJobAssignmentDto[] = [];

      for (const workerCode of workerCodes) {
        const worker = await adminJobsRepository.findWorkerByCode(
          workerCode,
          transaction,
        );

        if (!worker) {
          throw new ApiError(
            404,
            "WORKER_NOT_FOUND",
            `Worker ${workerCode} not found.`,
          );
        }

        const currentAssignment =
          await assignmentRepository.findCurrentAssignmentByWorker(
            worker.id,
            transaction,
          );

        if (worker.status !== 1) {
          throw new ApiError(
            403,
            "WORKER_NOT_ACTIVE",
            `Worker ${workerCode} is not active.`,
          );
        }

        if (currentAssignment) {
          throw new ApiError(
            409,
            "WORKER_HAS_ACTIVE_ASSIGNMENT",
            `Worker ${workerCode} already has an active assignment.`,
          );
        }

        const queueEntry = await getWorkerQueueStatus(worker.id);

        if (queueEntry?.status !== WORKER_WORK_STATUS.READY) {
          throw new ApiError(
            409,
            "WORKER_NOT_READY",
            `Worker ${workerCode} must be ready in queue before admin can assign a job.`,
          );
        }

        // ห้ามมอบหมายงานให้ worker ที่อยู่นอกเวลากะเด็ดขาด แม้สถานะคิวจะเป็น READY อยู่ก็ตาม (เผื่อ
        // หลุดมาจากช่องทางอื่น) เช็คเวลาสดจาก DB อีกชั้นก่อน assign จริงเสมอ
        const workerSchedule = await workScheduleRepository.findCurrentByAccountId(
          worker.id,
          transaction,
        );

        if (!workerSchedule || !isTimeInWorkSchedule(workerSchedule)) {
          throw new ApiError(
            403,
            "WORKER_OUTSIDE_WORK_SHIFT",
            `Worker ${workerCode} is outside their work shift and cannot be assigned a job.`,
          );
        }

        const assignment = await assignmentRepository.createAssignment(
          vehicleJobId,
          worker.id,
          buildDeadline(acceptDeadlineMs),
          transaction,
        );

        createdAssignments.push(assignment);
      }

      await adminActionLogRepository.create(
        {
          vehicle_job_id: vehicleJobId,
          action_type: ADMIN_ACTION_TYPE.MANUAL_ASSIGNMENT,
          reason_code: input.reason_code,
          reason_text: input.reason_text ?? null,
          actor_account_id: actorId,
          metadata: {
            source: "manual_assign",
            assignment_ids: createdAssignments.map(
              (assignment) => assignment.id,
            ),
            worker_ids: createdAssignments.map(
              (assignment) => assignment.worker_id,
            ),
            worker_codes: workerCodes,
          },
        },
        transaction,
      );

      return {
        assignments: createdAssignments,
        vehicleJob,
      };
    },
  );

  const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
    vehicleJob.id,
  );

  for (const assignment of assignments) {
    await markWorkerAssigned(assignment.worker_id);
    await scheduleAssignmentTimeout(
      assignment.id,
      assignment.worker_id,
      acceptDeadlineMs,
    );
    sendWorkerSocketEvent(
      assignment.worker_id,
      "WORKER_ASSIGNED",
      buildWorkerAssignedPayload(assignment, vehicleJob, ticketNos),
    );
  }
  const assignmentResponses = await buildAdminAssignmentResponses(
    vehicleJob.ticket_number,
    assignments,
  );

  publishNotification({
    type: "ASSIGNMENT_CREATED_BY_ADMIN",
    title: "Workers assigned by admin",
    message: `${assignments.length} worker(s) were assigned to vehicle job ${vehicleJob.ticket_number}.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      worker_codes: workerCodes,
      assignments: assignmentResponses,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Workers assigned successfully.",
    ticket_number: vehicleJob.ticket_number,
    assignments: assignmentResponses,
  };
}

// Function ยกเลิก assignment ใน service flow
async function cancelAssignment(
  idParam: unknown,
  workerCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminCancelAssignmentResponse> {
  const ticketNumber = parseReference(
    idParam,
    "INVALID_VEHICLE_JOB_REF",
    "TicketNumber is invalid.",
  );
  const workerCode = parseReference(
    workerCodeParam,
    "INVALID_WORKER_CODE",
    "Worker code is invalid.",
  );
  const input = parseWithSchema(adminCancelAssignmentBodySchema, body ?? {});
  const actorId = requireActorId(auth);
  const assignment =
    await adminJobsRepository.findActiveAssignmentByVehicleJobRefAndWorkerCode(
      ticketNumber,
      workerCode,
    );

  if (!assignment) {
    throw new ApiError(404, "ASSIGNMENT_NOT_FOUND", "Assignment not found.");
  }

  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
    throw new ApiError(
      409,
      "ASSIGNMENT_NOT_ACTIVE",
      "Assignment is not active.",
    );
  }

  const vehicleJob = await vehicleJobRepository.findVehicleJobById(
    assignment.vehicle_job_id,
  );
  const cancelledAssignment = await withTransaction(async (transaction) =>
    {
      const result = await adminJobsRepository.cancelAssignment(
        assignment.id,
        transaction,
      );

      if (!result) {
        // แพ้ race ให้ worker accept/scan/timeout เปลี่ยนสถานะไปก่อนแล้วในช่วงเวลาสั้นๆ ระหว่างที่
        // เช็ค active ด้านบนกับตอนเขียนจริง — throw ที่นี่ (ยัง rollback transaction ได้) แทนการ
        // เขียน AdminActionLog/แตะ roster ต่อไปทั้งที่การยกเลิกจริงไม่ได้เกิดขึ้น
        throw new ApiError(
          409,
          "ASSIGNMENT_NOT_ACTIVE",
          "Assignment is not active.",
        );
      }

      const teamScan =
        await assignmentRepository.getVehicleJobTeamScanReadiness(
          assignment.vehicle_job_id,
          transaction,
        );

      if (teamScan.is_ready) {
        await vehicleJobLifecycleService.markVehicleJobInProgress(
          assignment.vehicle_job_id,
          transaction,
        );
      }

      await adminActionLogRepository.create(
        {
          vehicle_job_id: assignment.vehicle_job_id,
          action_type: ADMIN_ACTION_TYPE.ASSIGNMENT_CANCELLED,
          reason_code: input.reason_code ?? null,
          reason_text: input.reason_text ?? null,
          actor_account_id: actorId,
          metadata: {
            assignment_id: assignment.id,
            worker_id: assignment.worker_id,
            worker_code: workerCode,
          },
        },
        transaction,
      );

      return result;
    },
  );

  await removeAssignmentTimeout(assignment.id);
  await removeScanTimeout(assignment.id);
  await removeScanWarning(assignment.id);
  await markWorkerOpenApp(assignment.worker_id);
  const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
    assignment.vehicle_job_id,
  );

  sendWorkerSocketEvent(assignment.worker_id, "ASSIGNMENT_CANCELLED", {
    ticketNumber: vehicleJob?.ticket_number ?? null,
    ticketNos,
    reason: "admin_cancel_assignment",
  });
  publishNotification({
    type: "ASSIGNMENT_CANCELLED",
    title: "Assignment cancelled",
    message: `Assignment for ${workerCode} on ${vehicleJob?.ticket_number ?? ticketNumber} was cancelled by admin.`,
    payload: {
      ticketNumber: vehicleJob?.ticket_number ?? ticketNumber,
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
    ticket_number: vehicleJob?.ticket_number ?? ticketNumber,
    worker_code: workerCode,
    status: cancelledAssignment.status,
  };
}

// Function ต่อเวลา vehicle job scan deadline ใน service flow
export async function extendVehicleJobScanDeadline(
  idParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminExtendScanDeadlineResponse> {
  const vehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = vehicleJob.id;
  const input = parseWithSchema(adminExtendScanDeadlineBodySchema, body);
  const actorId = requireActorId(auth);

  const assignments = (
    await adminJobsRepository.listAcceptedAssignmentsByVehicleJob(
      vehicleJobId,
      input.worker_codes,
    )
  ).filter((assignment) => isScanDeadlineActive(assignment.scan_deadline_at));

  if (assignments.length === 0) {
    throw new ApiError(
      404,
      "ACCEPTED_ASSIGNMENTS_NOT_FOUND",
      "No active accepted assignments found for scan deadline extension.",
    );
  }

  const updatedAssignments = await withTransaction(async (transaction) => {
    const results: VehicleJobAssignmentDto[] = [];

    for (const assignment of assignments) {
      const extended = await adminJobsRepository.extendAssignmentScanDeadline(
        assignment.id,
        extendDeadline(assignment.scan_deadline_at, input.minutes),
        transaction,
      );

      // แพ้ race ให้ scan-timeout job หรือ worker scan สำเร็จไปพร้อมกัน — assignment คนนี้ไม่ใช่
      // ACCEPTED อีกต่อไป ข้ามไปเฉยๆ ไม่ทำให้ทั้ง batch ล้มเหลว ให้ worker คนอื่นที่ยังต่อเวลาได้
      // ทำต่อไปตามปกติ
      if (extended) {
        results.push(extended);
      }
    }

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJobId,
        action_type: ADMIN_ACTION_TYPE.SCAN_DEADLINE_EXTENDED,
        reason_code: input.reason_code ?? null,
        reason_text: input.reason_text ?? null,
        actor_account_id: actorId,
        metadata: {
          minutes: input.minutes,
          assignment_ids: results.map((assignment) => assignment.id),
          worker_ids: results.map(
            (assignment) => assignment.worker_id,
          ),
        },
      },
      transaction,
    );

    return results;
  });
  await Promise.all(
    updatedAssignments.flatMap((assignment) => [
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
  const assignmentResponses =
    await buildScanDeadlineAssignmentResponses(updatedAssignments);
  const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
    vehicleJobId,
  );

  publishRealtimeEvent({
    type: "ASSIGNMENT_SCAN_DEADLINE_EXTENDED",
    title: "Scan deadline extended",
    message: `Scan deadline was extended for ${updatedAssignments.length} assignment(s).`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      minutes: input.minutes,
      worker_codes: input.worker_codes ?? null,
      assignments: assignmentResponses,
    },
    worker_payload: {
      ticketNumber: vehicleJob.ticket_number,
      ticketNos,
      minutes: input.minutes,
      assignments: assignmentResponses,
    },
    admin: true,
    worker_ids: updatedAssignments.map(
      (assignment) => assignment.worker_id,
    ),
  });

  return {
    message: "Vehicle job scan deadline extended successfully.",
    ticket_number: vehicleJob.ticket_number,
    assignments: assignmentResponses,
  };
}

// Function จัดการ side effect เมื่อ VehicleJob ปิดเป็น terminal จากผลพวงของการยกเลิกตลาด/booth
// (ไม่ใช่การกดยกเลิกทั้งรถโดยตรง) — reuse แพทเทิร์นเดียวกับตอน vendor confirm/auto-confirm timeout
// ปิดรถ: เคลียร์ timer ของทุก assignment ที่เพิ่งถูกปิด แล้วส่งกลับเข้าคิวผ่าน
// returnCompletedWorkersToQueue เรียกได้ปลอดภัยแม้ result เป็น null (แปลว่ารถยังไม่ terminal หรือ
// ปิดไปแล้วก่อนหน้านี้ — closeCompletedVehicleJobIfReady การันตีคืนค่า non-null แค่ครั้งเดียวตอนที่
// มันเป็นคนเปลี่ยนสถานะรถเองเท่านั้น ไม่มีทางถูกเรียกซ้ำกับ Worker ที่ release ไปก่อนแล้ว)
async function handleVehicleJobClosedByCascadeCancellation(
  result: CompletedVehicleJobResult | null,
): Promise<void> {
  if (!result) {
    return;
  }

  await Promise.all(
    result.completed_assignment_ids.flatMap((assignmentId) => [
      removeAssignmentTimeout(assignmentId),
      removeScanTimeout(assignmentId),
      removeScanWarning(assignmentId),
    ]),
  );

  await returnCompletedWorkersToQueue(result);

  publishRealtimeEvent({
    type: "VEHICLE_JOB_CLOSED",
    title: "Vehicle job closed",
    message: `Vehicle job ${result.vehicle_job.ticket_number} closed as ${result.vehicle_job.status} after a market/booth cancellation.`,
    payload: {
      ticketNumber: result.vehicle_job.ticket_number,
      status: result.vehicle_job.status,
    },
    worker_payload: {
      ticketNumber: result.vehicle_job.ticket_number,
      status: result.vehicle_job.status,
    },
    admin: true,
    worker_ids: result.completed_worker_ids,
  });
}

// Function ยกเลิก market job ระบุบริบทผ่าน TicketNumber (VehicleJob) + TicketNo (Business Ticket)
// ตรงๆ ไม่กำกวมข้ามรถ/ข้าม Business Ticket เหมือน target_ref=marketCode เดี่ยวๆ
async function cancelMarketJobByTicketContext(
  ticketNumberParam: unknown,
  ticketNoParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminMarketJobActionResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const ticketNo = parseReference(
    ticketNoParam,
    "INVALID_TICKET_NO",
    "TicketNo is invalid.",
  );
  const input = parseWithSchema(adminCancelBodySchema, body ?? {});
  const actorId = requireActorId(auth);

  const marketJob = await marketJobRepository.findMarketJobByVehicleAndTicketNo(
    vehicleJob.id,
    ticketNo,
  );

  if (!marketJob) {
    throw new ApiError(
      404,
      "MARKET_JOB_NOT_FOUND",
      "Business ticket not found.",
    );
  }

  return cancelMarketJobById(
    marketJob.id,
    input.reason_code ?? null,
    input.reason_text ?? null,
    actorId,
  );
}

// Function หลักที่ยกเลิก market job จริง — ล็อกแถวและเช็คว่ายังไม่ terminal ก่อนเขียนทับเสมอ กัน
// race ที่อีก request ยกเลิก/ปิดงานใบเดียวกันพร้อมกัน
async function cancelMarketJobById(
  marketJobId: number,
  reasonCode: string | null,
  reasonText: string | null,
  actorId: number,
): Promise<AdminMarketJobActionResponse> {
  const { marketJob, completedVehicleJob } = await withTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM market_jobs WHERE id = ${marketJobId} FOR UPDATE`;

    const current = await marketJobRepository.findMarketJobById(
      marketJobId,
      transaction,
    );

    if (!current) {
      throw new ApiError(
        404,
        "MARKET_JOB_NOT_FOUND",
        "Business ticket not found.",
      );
    }

    if (TERMINAL_JOB_STATUSES.includes(current.status)) {
      throw new ApiError(
        409,
        "MARKET_JOB_ALREADY_CLOSED",
        "Business ticket is already completed or cancelled.",
      );
    }

    // ห้ามยกเลิกทั้ง Business Ticket ถ้ามี Booth ไหนเคยถูกส่งยอดมาแล้ว ไม่ว่าผลจะเป็น DELIVERED
    // (รอ Vendor) หรือ REJECT (โดนปฏิเสธ) ก็ตาม — ต้องให้ส่งยอดใหม่จน Vendor ยืนยัน/timeout แทน
    const hasSubmittedTickets =
      await gateTicketRepository.hasSubmittedActiveTicketsForMarketJob(
        marketJobId,
        transaction,
      );

    if (hasSubmittedTickets) {
      throw new ApiError(
        409,
        "MARKET_JOB_ALREADY_SUBMITTED",
        "Business ticket cannot be cancelled after a booth has already been submitted.",
      );
    }

    const cancelled = await adminJobsRepository.cancelMarketJob(marketJobId, transaction);

    // Audit log สำหรับ actor/reason ของการยกเลิก TicketNo นี้ — ใช้เป็น source ของ
    // Daily Worker Income Cancellation.CancelledByType/CancelledByName และ riskText
    await adminActionLogRepository.create(
      {
        vehicle_job_id: cancelled.vehicle_job_id,
        market_job_id: cancelled.id,
        action_type: ADMIN_ACTION_TYPE.MARKET_JOB_CANCELLED,
        reason_code: reasonCode,
        reason_text: reasonText,
        actor_account_id: actorId,
      },
      transaction,
    );

    // Roll up สถานะ MarketJob อื่น/VehicleJob ทันทีในทรานแซกชันเดียวกัน — ใช้ centralized lifecycle
    // ตัวเดียวกับ vendor confirm/auto-confirm (Rule B.3 ในสเปกยกเลิกระดับรถ/Business Ticket/Booth)
    // แทนการมีกฎ roll up แยกชุดของตัวเอง
    const completedVehicleJob =
      await vehicleJobLifecycleService.closeCompletedVehicleJobIfReady(
        cancelled.vehicle_job_id,
        transaction,
      );

    return { marketJob: cancelled, completedVehicleJob };
  });
  const vehicleJob = await vehicleJobRepository.findVehicleJobById(
    marketJob.vehicle_job_id,
  );
  publishRealtimeEvent({
    type: "MARKET_JOB_CANCELLED",
    title: "Market job cancelled",
    message: `Market job ${marketJob.marketCode} was cancelled.`,
    payload: {
      ticketNumber: vehicleJob?.ticket_number ?? null,
      marketCode: marketJob.marketCode,
      status: marketJob.status,
    },
    worker_payload: {
      ticketNumber: vehicleJob?.ticket_number ?? null,
      ticketNos: [marketJob.ticket_no],
      marketCode: marketJob.marketCode,
      status: marketJob.status,
    },
    admin: true,
    worker_ids: await listVehicleJobWorkerIds(marketJob.vehicle_job_id),
  });

  await handleVehicleJobClosedByCascadeCancellation(completedVehicleJob);

  return formatMarketJobActionResponse(
    "Market job cancelled successfully.",
    marketJob,
    vehicleJob,
  );
}

// Function ยกเลิก stall job ระบุบริบทผ่าน TicketNumber + TicketNo (Business Ticket) + StallCode
// ตรงๆ ไม่กำกวมข้าม Business Ticket เหมือน target_ref=boothCode เดี่ยวๆ
async function cancelStallJobByTicketContext(
  ticketNumberParam: unknown,
  ticketNoParam: unknown,
  stallCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminStallJobActionResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const ticketNo = parseReference(
    ticketNoParam,
    "INVALID_TICKET_NO",
    "TicketNo is invalid.",
  );
  const stallCode = parseReference(
    stallCodeParam,
    "INVALID_BOOTH_CODE",
    "BoothCode is invalid.",
  );
  const input = parseWithSchema(adminCancelBodySchema, body ?? {});
  const actorId = requireActorId(auth);

  const ticket =
    await gateTicketRepository.findGateTicketForCompletionByTicketNumberAndTicketNoAndBoothCode(
      vehicleJob.ticket_number,
      ticketNo,
      stallCode,
    );

  if (!ticket) {
    throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
  }

  return cancelStallJobById(
    ticket.id,
    input.reason_code ?? null,
    input.reason_text ?? null,
    actorId,
  );
}

// Function ตรวจว่า Booth นี้ยังไม่เคยถูกส่งยอด (DELIVERED/REJECT) — ใช้ร่วมกันโดย flow ที่ห้ามแตะ
// Booth หลังส่งยอดไปแล้ว ไม่ว่าจะยกเลิกทั้ง Booth หรือถอด worker ออกจาก Booth นั้น
function assertTicketNotSubmitted(status: string, message: string): void {
  if (status === TICKET_STATUS.DELIVERED || status === TICKET_STATUS.REJECT) {
    throw new ApiError(409, "STALL_JOB_ALREADY_SUBMITTED", message);
  }
}

// Function หลักที่ยกเลิก stall job จริง — ล็อกแถวและเช็คว่ายังไม่ terminal ก่อนเขียนทับเสมอ กัน
// race ที่อีก request ยกเลิก/ปิด booth เดียวกันพร้อมกัน
async function cancelStallJobById(
  ticketId: number,
  reasonCode: string | null,
  reasonText: string | null,
  actorId: number,
): Promise<AdminStallJobActionResponse> {
  const { ticket, completedVehicleJob } = await withTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM gate_tickets WHERE id = ${ticketId} FOR UPDATE`;

    const current = await gateTicketRepository.findGateTicketForCompletion(
      ticketId,
      transaction,
    );

    if (!current) {
      throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
    }

    if (TERMINAL_TICKET_STATUSES.includes(current.status)) {
      throw new ApiError(
        409,
        "STALL_JOB_ALREADY_CLOSED",
        "Stall job is already completed or cancelled.",
      );
    }

    // ห้ามยกเลิก Booth ที่เคยถูกส่งยอดมาแล้ว ไม่ว่าผลจะเป็น DELIVERED (รอ Vendor) หรือ REJECT
    // (โดนปฏิเสธ) ก็ตาม — ต้องให้ส่งยอดใหม่จน Vendor ยืนยัน/timeout แทน
    assertTicketNotSubmitted(
      current.status,
      "Stall job cannot be cancelled after it has already been submitted.",
    );

    const cancelled = await adminJobsRepository.cancelGateTicket(ticketId, transaction);

    await adminActionLogRepository.create(
      {
        vehicle_job_id: cancelled.vehicle_job_id,
        gate_ticket_id: cancelled.id,
        market_job_id: cancelled.market_job_id,
        action_type: ADMIN_ACTION_TYPE.STALL_JOB_CANCELLED,
        reason_code: reasonCode,
        reason_text: reasonText,
        actor_account_id: actorId,
      },
      transaction,
    );

    // Roll up สถานะ MarketJob/VehicleJob ทันทีในทรานแซกชันเดียวกัน — ใช้ centralized lifecycle
    // ตัวเดียวกับ vendor confirm/auto-confirm (Rule C.4/C.5 ในสเปกยกเลิกระดับรถ/Business Ticket/
    // Booth) แทนการมีกฎ roll up แยกชุดของตัวเอง — ครอบคลุมทั้งกรณี Booth สุดท้ายของตลาดเป็น CANCELLED
    // (ตลาด/รถอาจกลายเป็น CANCELLED) และกรณีตลาดมี Booth อื่น COMPLETED อยู่แล้ว (ตลาด/รถอาจกลายเป็น
    // COMPLETED พร้อม finalize financial snapshot)
    const completedVehicleJob =
      await vehicleJobLifecycleService.closeCompletedVehicleJobIfReady(
        cancelled.vehicle_job_id,
        transaction,
      );

    return { ticket: cancelled, completedVehicleJob };
  });
  const vehicleJob = await vehicleJobRepository.findVehicleJobById(
    ticket.vehicle_job_id,
  );
  const marketJob = await marketJobRepository.findMarketJobById(
    ticket.market_job_id,
  );
  publishRealtimeEvent({
    type: "STALL_JOB_CANCELLED",
    title: "Stall job cancelled",
    message: `Stall job ${ticket.boothCode} was cancelled.`,
    payload: {
      ticketNumber: vehicleJob?.ticket_number ?? null,
      marketCode: marketJob?.marketCode ?? null,
      boothCode: ticket.boothCode,
      status: ticket.status,
      confirmation_status: ticket.confirmation_status,
    },
    worker_payload: {
      ticketNumber: vehicleJob?.ticket_number ?? null,
      ticketNos: marketJob ? [marketJob.ticket_no] : [],
      marketCode: marketJob?.marketCode ?? null,
      boothCode: ticket.boothCode,
      status: ticket.status,
      confirmation_status: ticket.confirmation_status,
    },
    admin: true,
    worker_ids: await listStallJobWorkerIds(ticket),
  });

  await handleVehicleJobClosedByCascadeCancellation(completedVehicleJob);

  return formatStallJobActionResponse(
    "Stall job cancelled successfully.",
    ticket,
    vehicleJob,
    marketJob,
  );
}

// Function ยกเลิก Worker หนึ่งคนออกจาก Business Ticket (market job) ใบเดียวใน service flow
//
// ต่างจาก cancelAssignment (ที่ยกเลิกทั้ง TicketNumber และ cascade ไปทุก Business Ticket ที่ยัง
// ไม่ Terminal): ฟังก์ชันนี้ไม่แตะ VehicleJobAssignment เลย worker ยังอยู่กับรถและยังทำ Business
// Ticket อื่นได้ กระทบเฉพาะ Roster ของ Business Ticket ใบนี้ใบเดียว ตั้งใจแยก action ให้ชัดเจน
// ไม่ให้ caller เดา scope เอง
async function cancelTicketWorker(
  ticketNumberParam: unknown,
  ticketNoParam: unknown,
  workerCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminCancelTicketWorkerResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const ticketNo = parseReference(
    ticketNoParam,
    "INVALID_TICKET_NO",
    "TicketNo is invalid.",
  );
  const workerCode = parseReference(
    workerCodeParam,
    "INVALID_WORKER_CODE",
    "Worker code is invalid.",
  );
  const input = parseWithSchema(adminCancelBodySchema, body ?? {});
  const actorId = requireActorId(auth);

  const marketJob = await marketJobRepository.findMarketJobByVehicleAndTicketNo(
    vehicleJob.id,
    ticketNo,
  );

  if (!marketJob) {
    throw new ApiError(
      404,
      "MARKET_JOB_NOT_FOUND",
      "Business ticket not found.",
    );
  }

  const worker = await adminJobsRepository.findWorkerByCode(workerCode);

  if (!worker) {
    throw new ApiError(404, "WORKER_NOT_FOUND", `Worker ${workerCode} not found.`);
  }

  const cancelled = await withTransaction(async (transaction) => {
    const result = await adminJobsRepository.cancelTicketWorkerForMarketJob(
      marketJob.id,
      worker.id,
      transaction,
    );

    if (!result) {
      return result;
    }

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        market_job_id: marketJob.id,
        action_type: ADMIN_ACTION_TYPE.TICKET_WORKER_CANCELLED,
        reason_code: input.reason_code ?? null,
        reason_text: input.reason_text ?? null,
        actor_account_id: actorId,
        metadata: {
          worker_id: worker.id,
          worker_code: workerCode,
        },
      },
      transaction,
    );

    return result;
  });

  if (!cancelled) {
    throw new ApiError(
      404,
      "TICKET_WORKER_NOT_FOUND",
      "Worker is not an active member of this business ticket.",
    );
  }

  publishNotification({
    type: "TICKET_WORKER_CANCELLED",
    title: "Worker removed from business ticket",
    message: `Worker ${workerCode} was removed from ticket ${ticketNo} by admin.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      ticketNo,
      worker_code: workerCode,
      status: TICKET_WORKER_STATUS.CANCELLED,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Worker removed from business ticket successfully.",
    ticket_number: vehicleJob.ticket_number,
    ticket_no: ticketNo,
    worker_code: workerCode,
    status: TICKET_WORKER_STATUS.CANCELLED,
  };
}

// Function ถอด Worker หนึ่งคนออกจากแค่ Booth เดียว (ไม่แตะ TicketWorker.status เลย worker ยังเป็น
// สมาชิก WORKING ของ Business Ticket ปกติ ยังทำ Booth อื่นในใบเดียวกันต่อได้) — ล็อกแถว Booth และ
// เช็คว่ายังไม่เคยถูกส่งยอด (เหมือน guard ของการยกเลิกทั้ง Booth) ก่อนสร้าง GateTicketWorkerExclusion
// ทุกครั้ง เพื่อกัน race กับอีก request ที่กำลังยกเลิก/ส่งยอด Booth เดียวกันพร้อมกัน
async function cancelTicketWorkerFromBooth(
  ticketNumberParam: unknown,
  ticketNoParam: unknown,
  boothCodeParam: unknown,
  workerCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminCancelTicketWorkerFromBoothResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const ticketNo = parseReference(
    ticketNoParam,
    "INVALID_TICKET_NO",
    "TicketNo is invalid.",
  );
  const boothCode = parseReference(
    boothCodeParam,
    "INVALID_BOOTH_CODE",
    "BoothCode is invalid.",
  );
  const workerCode = parseReference(
    workerCodeParam,
    "INVALID_WORKER_CODE",
    "Worker code is invalid.",
  );
  const input = parseWithSchema(adminCancelBodySchema, body ?? {});
  const actorId = requireActorId(auth);

  const ticket =
    await gateTicketRepository.findGateTicketForCompletionByTicketNumberAndTicketNoAndBoothCode(
      vehicleJob.ticket_number,
      ticketNo,
      boothCode,
    );

  if (!ticket) {
    throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
  }

  const worker = await adminJobsRepository.findWorkerByCode(workerCode);

  if (!worker) {
    throw new ApiError(404, "WORKER_NOT_FOUND", `Worker ${workerCode} not found.`);
  }

  const ticketWorker =
    await ticketWorkerRepository.findTicketWorkerByMarketJobAndWorkerAccountId(
      ticket.market_job_id,
      worker.id,
    );

  if (!ticketWorker || ticketWorker.status !== TICKET_WORKER_STATUS.WORKING) {
    throw new ApiError(
      404,
      "TICKET_WORKER_NOT_FOUND",
      "Worker is not an active member of this business ticket.",
    );
  }

  await withTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM gate_tickets WHERE id = ${ticket.id} FOR UPDATE`;

    const current = await gateTicketRepository.findGateTicketForCompletion(
      ticket.id,
      transaction,
    );

    if (!current) {
      throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
    }

    if (TERMINAL_TICKET_STATUSES.includes(current.status)) {
      throw new ApiError(
        409,
        "STALL_JOB_ALREADY_CLOSED",
        "Stall job is already completed or cancelled.",
      );
    }

    // ห้ามถอด worker ออกจาก Booth ที่เคยถูกส่งยอดมาแล้ว ไม่ว่าผลจะเป็น DELIVERED (รอ Vendor) หรือ
    // REJECT (โดนปฏิเสธ) ก็ตาม — เหมือน guard ของการยกเลิกทั้ง Booth ทุกประการ
    assertTicketNotSubmitted(
      current.status,
      "Worker cannot be removed from this booth after it has already been submitted.",
    );

    const alreadyExcluded = await gateTicketRepository.findGateTicketWorkerExclusion(
      ticket.id,
      ticketWorker.id,
      transaction,
    );

    if (alreadyExcluded) {
      throw new ApiError(
        409,
        "WORKER_ALREADY_EXCLUDED_FROM_BOOTH",
        "Worker is already excluded from this booth.",
      );
    }

    await gateTicketRepository.createGateTicketWorkerExclusion(
      ticket.id,
      ticketWorker.id,
      transaction,
    );

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        gate_ticket_id: ticket.id,
        market_job_id: ticket.market_job_id,
        action_type: ADMIN_ACTION_TYPE.TICKET_WORKER_CANCELLED_FROM_BOOTH,
        reason_code: input.reason_code ?? null,
        reason_text: input.reason_text ?? null,
        actor_account_id: actorId,
        metadata: {
          worker_id: worker.id,
          worker_code: workerCode,
        },
      },
      transaction,
    );
  });

  publishNotification({
    type: "TICKET_WORKER_CANCELLED_FROM_BOOTH",
    title: "Worker removed from booth",
    message: `Worker ${workerCode} was removed from booth ${boothCode} (ticket ${ticketNo}) by admin.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      ticketNo,
      boothCode,
      worker_code: workerCode,
      status: TICKET_WORKER_STATUS.CANCELLED,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Worker removed from booth successfully.",
    ticket_number: vehicleJob.ticket_number,
    ticket_no: ticketNo,
    boothCode,
    worker_code: workerCode,
    status: TICKET_WORKER_STATUS.CANCELLED,
  };
}

// Function Admin ส่ง/แก้ยอดสินค้าของ Booth หนึ่งใบแทน Worker ใน service flow
//
// ใช้ business key (productCode + packageCode) เหมือน Worker submit flow ไม่ใช่ ticketProductId
// เพราะเป็น convention ของ Project นี้อยู่แล้ว (ดู updateTicketProductConfirmations)
// Function Admin ส่ง/แก้ยอดสินค้าของ Booth หนึ่งใบแทน Worker (กรณี Worker กดส่งยอดเองไม่ได้) ใน
// service flow — ใช้ pipeline เดียวกับที่ Worker ส่งยอดเอง (submitTicketCompletion) ทุกขั้นตอน:
// ต้องมี Vendor LINE target ตั้งไว้, ทีมต้อง check-in ครบก่อน, เปลี่ยนสถานะ Booth เป็น DELIVERED,
// รอ Vendor กดยืนยัน/ปฏิเสธผ่าน LINE เหมือน Worker ส่งเอง — ต่างแค่ requireRosterMembership: false
// (Admin ไม่ใช่สมาชิก TicketWorker ของ Booth นี้) และเพิ่มบันทึก AdminActionLog เก็บเหตุผลที่ Admin
// เข้ามาส่งแทน ซึ่ง TicketCompletionSubmission เองไม่มีช่องเก็บเหตุผล
export async function overrideTicketProductCounts(
  ticketNumberParam: unknown,
  ticketNoParam: unknown,
  boothCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminOverrideCountResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const ticketNo = parseReference(
    ticketNoParam,
    "INVALID_TICKET_NO",
    "TicketNo is invalid.",
  );
  const boothCode = parseReference(
    boothCodeParam,
    "INVALID_BOOTH_CODE",
    "BoothCode is invalid.",
  );
  const input = parseWithSchema(adminOverrideCountBodySchema, body);
  const actorId = requireActorId(auth);

  const result = await withTransaction(async (transaction) => {
    const submission = await ticketCompletionService.submitTicketCompletion({
      findTicket: (connection) =>
        gateTicketRepository.findGateTicketForCompletionByTicketNumberAndTicketNoAndBoothCode(
          vehicleJob.ticket_number,
          ticketNo,
          boothCode,
          connection,
        ),
      items: input.counts.map((item) => ({
        productCode: item.productCode,
        packageCode: item.packageCode,
        confirmed_quantity: item.actual_quantity,
      })),
      submittedByAccountId: actorId,
      submittedByRole: TICKET_SUBMITTER_ROLE.ADMIN,
      requireRosterMembership: false,
      connection: transaction,
    });
    const previousQuantityByKeyForLog = new Map(
      submission.originalProducts.map((product) => [
        `${product.productCode}::${product.packageCode}`,
        product.confirmed_quantity,
      ]),
    );

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        gate_ticket_id: submission.ticket.id,
        action_type: ADMIN_ACTION_TYPE.OVERRIDE_COUNT,
        reason_code: input.reason_code,
        reason_text: input.reason_text,
        actor_account_id: actorId,
        metadata: {
          boothCode: submission.ticket.boothCode,
          counts: input.counts.map((item) => ({
            productCode: item.productCode,
            packageCode: item.packageCode,
            previous_quantity:
              previousQuantityByKeyForLog.get(`${item.productCode}::${item.packageCode}`) ?? null,
            actual_quantity: item.actual_quantity,
          })),
        },
      },
      transaction,
    );

    return submission;
  });

  const previousQuantityByKey = new Map(
    result.originalProducts.map((product) => [
      `${product.productCode}::${product.packageCode}`,
      product.confirmed_quantity,
    ]),
  );
  const confirmedQuantityByKey = new Map(
    result.products.map((product) => [
      `${product.productCode}::${product.packageCode}`,
      product.confirmed_quantity,
    ]),
  );

  await ticketCompletionService.notifyTicketCompletionSubmitted(result);

  return {
    message: "Booth counts submitted and waiting for vendor confirmation.",
    ticket_number: vehicleJob.ticket_number,
    boothCode: result.ticket.boothCode,
    status: result.ticket.status,
    reason_code: input.reason_code,
    reason_text: input.reason_text ?? null,
    products: input.counts.map((item) => {
      const key = `${item.productCode}::${item.packageCode}`;

      return {
        productCode: item.productCode,
        packageCode: item.packageCode,
        previous_quantity: previousQuantityByKey.get(key) ?? null,
        confirmed_quantity: confirmedQuantityByKey.get(key) ?? null,
      };
    }),
  };
}

// Function Admin สลับ Dispatch ของ VehicleJob (Dispatch: false = สั่งกลับไปรอลง คืน Worker ทั้งชุด
// เข้าคิวหน้าสุด, Dispatch: true = สั่ง Dispatch ใหม่ เรียก Worker จากคิว ณ ตอนนั้น) ใน service flow
//
// อนุญาตเฉพาะก่อนทีมจะ Scan ครบทุกคน (ยังเป็นแค่ PENDING/ACCEPTED/SCANNED บางส่วน — "wait_team")
// เท่านั้น เพราะจุดที่ทีมทั้งชุด Scan ครบ (VehicleWorkReadiness.is_ready) คือจุดเดียวกับที่ Worker
// เริ่มทำงานจริงและ Booth แรกเริ่มเปลี่ยนสถานะได้ — ก่อนจุดนั้นไม่มี Booth ไหนถูกส่งยอดได้เลย
// (submitTicketCompletion เองก็ require is_ready เหมือนกัน) จึงไม่มี TicketWorker roster ให้ต้อง
// ป้องกันความเสียหายจากการคืน Worker เข้าคิว — ต่างจาก cancelVehicleJobAndRequeue ตรงที่ตัว
// VehicleJob/MarketJob/GateTicket เองไม่ถูกยกเลิก ยังใช้งานต่อได้ปกติ
export async function changeVehicleJobToWait(
  ticketNumberParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminVehicleWaitResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const input = parseWithSchema(adminVehicleWaitBodySchema, body);
  const actorId = requireActorId(auth);

  const { updated, cancelledAssignments } = await withTransaction(async (transaction) => {
    // Lock แถว VehicleJob นี้ไว้ก่อน re-check invariant ("ทีมยัง Scan ไม่ครบ") แล้วเขียนจริง กัน
    // Race กับ Worker คนสุดท้ายที่อาจ Scan เข้ามาพร้อมกัน (ดูรายละเอียดเดียวกับ Lock ใน
    // closeCompletedVehicleJobIfReady)
    await transaction.$queryRaw`SELECT id FROM vehicle_jobs WHERE id = ${vehicleJob.id} FOR UPDATE`;

    if (TERMINAL_JOB_STATUSES.includes(vehicleJob.status)) {
      throw new ApiError(
        409,
        "VEHICLE_JOB_CLOSED",
        "Vehicle job is already closed and cannot change dispatch.",
      );
    }

    const readiness = await vehicleJobRepository.getVehicleWorkReadiness(
      vehicleJob.id,
      transaction,
    );

    if (readiness.is_ready) {
      throw new ApiError(
        409,
        "VEHICLE_JOB_ALREADY_STARTED",
        "The whole team has already checked in and started working; dispatch can no longer be changed.",
      );
    }

    const cancelled = input.dispatch
      ? []
      : await adminJobsRepository.cancelActiveAssignmentsForVehicleJob(
          vehicleJob.id,
          transaction,
        );
    const result = await vehicleJobRepository.setVehicleJobDispatch(
      vehicleJob.id,
      input.dispatch,
      input.dispatch ? VEHICLE_JOB_STATUS.WORKING : VEHICLE_JOB_STATUS.WAIT,
      transaction,
    );

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        action_type: ADMIN_ACTION_TYPE.VEHICLE_WAIT,
        reason_code: input.reason_code,
        reason_text: input.reason_text,
        actor_account_id: actorId,
        metadata: {
          dispatch: input.dispatch,
          worker_ids: cancelled.map((assignment) => assignment.worker_id),
        },
      },
      transaction,
    );

    return { updated: result, cancelledAssignments: cancelled };
  });

  let requeuedWorkerCodes: Array<string | null> = [];

  if (!input.dispatch && cancelledAssignments.length > 0) {
    const sortedAssignments = sortAssignmentsByAcceptedAt(cancelledAssignments);
    const requeuedWorkerIds = sortedAssignments.map(
      (assignment) => assignment.worker_id,
    );

    await enqueueWorkersAtFront(requeuedWorkerIds);
    for (const workerId of requeuedWorkerIds) {
      sendWorkerSocketEvent(workerId, "WORKER_STATUS_CHANGED", {
        status: WORKER_WORK_STATUS.READY,
        reason: "vehicle_job_wait_requeue",
      });
    }
    requeuedWorkerCodes = await profileRepository.findWorkerCodesByAccountIds(
      requeuedWorkerIds,
    );
    // ปล่อยให้ Worker ที่เพิ่งกลับเข้าคิวไหลไปรับงานคันอื่นที่ Dispatch อยู่ก่อนแล้วได้ทันที ไม่ต้อง
    // รอรอบ dispatch ถัดไป
    await dispatchReadyWorkers();
  }

  if (input.dispatch) {
    try {
      await dispatchReadyWorkers(undefined, {
        vehicle_job_ids: [vehicleJob.id],
      });
    } catch (error) {
      logger.error("Vehicle job dispatch was re-enabled but worker dispatch failed.", {
        error,
      });
    }
  }

  publishRealtimeEvent({
    type: "VEHICLE_JOB_WAIT",
    title: input.dispatch ? "Vehicle job dispatch re-enabled" : "Vehicle job set to wait",
    message: input.dispatch
      ? `Vehicle job ${vehicleJob.ticket_number} was dispatched again by admin.`
      : `Vehicle job ${vehicleJob.ticket_number} was set back to wait by admin.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      dispatch_now: updated.dispatch_now,
      status: updated.status,
      reason_code: input.reason_code,
      requeued_worker_codes: requeuedWorkerCodes,
    },
    admin: true,
  });

  return {
    message: input.dispatch
      ? "Vehicle job dispatched again successfully."
      : "Vehicle job set to wait successfully.",
    ticket_number: updated.ticket_number,
    status: updated.status,
    dispatch_now: updated.dispatch_now,
    requeued_worker_codes: requeuedWorkerCodes,
    reason_code: input.reason_code,
    reason_text: input.reason_text ?? null,
  };
}

// Function Admin ปล่อย Worker ทั้งทีมของ VehicleJob กลับคิวก่อนเวลา ใน service flow
//
// ใช้เมื่อ Worker ส่งยอดครบทุก Booth แล้วและไม่มี Booth ไหนค้าง Reject ที่ต้องแก้ โดยไม่ต้องรอให้
// Gate ปิดรับ Ticket เพิ่ม (ticketsClosedAt) และไม่ต้องรอ Financial Finalize ของแต่ละ Business
// Ticket เพราะ Worker หมดหน้าที่ทางกายภาพแล้ว การคำนวณเงินเกิดทีหลังได้โดยไม่ต้องมี Worker อยู่
export async function releaseVehicleJobWorkers(
  ticketNumberParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminReleaseWorkersResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const input = parseWithSchema(adminReleaseWorkersBodySchema, body);
  const actorId = requireActorId(auth);

  if (TERMINAL_JOB_STATUSES.includes(vehicleJob.status)) {
    throw new ApiError(
      409,
      "VEHICLE_JOB_CLOSED",
      "Vehicle job is already closed; workers already returned to queue.",
    );
  }

  const releasableAssignments = await withTransaction(async (transaction) => {
    const lifecycleState = await vehicleJobRepository.findVehicleJobLifecycleState(
      vehicleJob.id,
      transaction,
    );
    const tickets = (lifecycleState?.marketJobs ?? []).flatMap(
      (market) => market.tickets,
    );

    if (tickets.length === 0) {
      throw new ApiError(
        409,
        "NO_SUBMITTED_BOOTHS",
        "Vehicle job has no booths to release workers from yet.",
      );
    }

    // Worker ทางกายทำงานเสร็จตั้งแต่ "ส่งยอดครบ" (DELIVERED) แล้ว ไม่ต้องรอ Vendor ยืนยัน
    // (COMPLETED) หรือรอ TicketNumber ปิดทั้งคัน — REJECT ยังนับเป็น unresolved เพราะ Worker
    // ต้องแก้ไขและส่งยอดใหม่ก่อน
    const hasUnresolvedBooth = tickets.some(
      (ticket) => !SUBMITTED_TICKET_STATUSES.includes(ticket.status),
    );

    if (hasUnresolvedBooth) {
      throw new ApiError(
        409,
        "BOOTHS_NOT_SUBMITTED",
        "Every booth must be submitted, confirmed, or cancelled (no pending submission or unresolved reject) before releasing workers.",
      );
    }

    // เรียงตาม accepted_at ก่อนคืนเข้าคิว (ท้ายคิว) — ให้ลำดับสัมพัทธ์ระหว่าง Worker ในทีมเดียวกัน
    // ตรงกับตอนเข้าคิวครั้งแรกเสมอ ไม่ใช่ลำดับที่ assignment ถูกสร้าง/dispatch
    const releasable = sortAssignmentsByAcceptedAt(
      await assignmentRepository.listReleasableAssignmentsByVehicleJob(
        vehicleJob.id,
        transaction,
      ),
    );

    if (releasable.length === 0) {
      throw new ApiError(
        409,
        "NO_RELEASABLE_WORKERS",
        "No workers are currently eligible to be released.",
      );
    }

    await assignmentRepository.releaseAssignments(
      releasable.map((assignment) => assignment.id),
      new Date(),
      transaction,
    );

    // เปลี่ยน status เป็น RELEASED (ไม่แตะ dispatchNow เลย ปล่อยตามค่าเดิม) กัน dispatchReadyWorkers
    // ดึง worker กลับเข้างานคันนี้ซ้ำอีกไม่ว่าจะเกิดจากการ release เอง หรือ event อื่นในภายหลัง (เช่น
    // Vendor Reject ทำให้ booth กลับไม่ submitted) — Gate เพิ่ม booth ใหม่ให้ TicketNumber นี้ทีหลังจะ
    // เปิด dispatch คืนให้เอง หรือ Admin เปิดกลับเองผ่าน /wait ถ้าต้องการ worker ชุดใหม่จริงๆ
    await vehicleJobRepository.updateVehicleJobStatus(
      vehicleJob.id,
      VEHICLE_JOB_STATUS.RELEASED,
      transaction,
    );

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        action_type: ADMIN_ACTION_TYPE.WORKERS_RELEASED,
        reason_code: input.reason_code,
        reason_text: input.reason_text ?? null,
        actor_account_id: actorId,
        metadata: {
          worker_ids: releasable.map(
            (assignment) => assignment.worker_id,
          ),
        },
      },
      transaction,
    );

    return releasable;
  });

  const releasedWorkerAccountIds = releasableAssignments.map(
    (assignment) => assignment.worker_id,
  );
  const releasedWorkerCodes = await returnCompletedWorkersToQueue({
    vehicle_job: {
      ticket_number: vehicleJob.ticket_number,
    },
    completed_worker_ids: releasedWorkerAccountIds,
  });

  publishRealtimeEvent({
    type: "VEHICLE_JOB_WORKERS_RELEASED",
    title: "Workers released early",
    message: `${releasedWorkerAccountIds.length} worker(s) were released from vehicle job ${vehicleJob.ticket_number} by admin.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      reason_code: input.reason_code,
      released_worker_codes: releasedWorkerCodes,
    },
    admin: true,
  });

  return {
    message: "Workers released back to the queue successfully.",
    ticket_number: vehicleJob.ticket_number,
    released_worker_codes: releasedWorkerCodes,
    reason_code: input.reason_code,
    reason_text: input.reason_text ?? null,
  };
}

// Function ตัดสิน payment_status ของแถวรายได้ Worker รายวันหนึ่งแถว ตามลำดับความสำคัญ: cancel (ticket_no
// ถูกยกเลิกทั้งใบ) > success/partially_paid (ticket_no จบงานแล้ว) > admin_reject/worker_reject (มี
// booth REJECT ค้างอยู่) > null (ไม่เข้าเงื่อนไขไหนเลย ไม่ต้องนับมาแสดง)
function resolveDailyWorkerIncomePaymentStatus(
  record: DailyWorkerIncomeRecord,
  hasUnresolvedReject: boolean,
  isReleased: boolean,
): DailyWorkerIncomePaymentStatus | null {
  const { marketJob } = record;

  if (marketJob.status === VEHICLE_JOB_STATUS.CANCELLED) {
    return DAILY_WORKER_INCOME_PAYMENT_STATUS.CANCEL;
  }

  if (marketJob.status === VEHICLE_JOB_STATUS.COMPLETED) {
    if (record.status === TICKET_WORKER_STATUS.COMPLETED) {
      return DAILY_WORKER_INCOME_PAYMENT_STATUS.SUCCESS;
    }

    if (
      record.status === TICKET_WORKER_STATUS.CANCELLED &&
      record.finalEarningAmount &&
      record.finalEarningAmount.greaterThan(0)
    ) {
      return DAILY_WORKER_INCOME_PAYMENT_STATUS.PARTIALLY_PAID;
    }

    return null;
  }

  // ticket_no ยังไม่จบงาน (WAIT/WORKING) — ห้าม release ถ้ายังมี reject ค้างอยู่ (ดู
  // BOOTHS_NOT_SUBMITTED ใน releaseVehicleJobWorkers) ดังนั้น reject ที่เจอตอน isReleased=true
  // ต้องเกิดขึ้นหลัง release เสมอ ไม่มีทางสลับลำดับกันได้
  if (hasUnresolvedReject) {
    return isReleased
      ? DAILY_WORKER_INCOME_PAYMENT_STATUS.ADMIN_REJECT
      : DAILY_WORKER_INCOME_PAYMENT_STATUS.WORKER_REJECT;
  }

  return null;
}

const DAILY_WORKER_INCOME_RISK_TEXT = {
  WORKER_CANCELLED_BY_ADMIN: "Admin เตะคนงานกลางคัน",
  PARTIAL_PAY_CONFIRMED_STALLS_ONLY: "จ่ายเฉพาะแผงที่ยืนยันแล้ว",
  REJECTED_REQUIRES_ADMIN_CORRECTION: "แผงปฏิเสธหลังปล่อยคิว/ต้องให้ Admin แก้",
  REJECTION_CORRECTED_BY_ADMIN: "เคยปฏิเสธและ Admin แก้ยอดแล้ว",
  REJECTED_REQUIRES_WORKER_CORRECTION: "แผงปฏิเสธ รอชุดแรงงานแก้ยอด",
  COUNT_SUBMITTED_BY_ADMIN: "Admin ส่งยอดแทน",
  AUTO_CONFIRMED_BY_SYSTEM: "ระบบตัดยืนยัน",
  MARKET_CANCELLED: "ตลาดนี้ถูกยกเลิก",
  VEHICLE_JOB_CANCELLED: "งานถูกยกเลิก",
} as const;

function addDailyRiskText(messages: string[], message: string): void {
  if (!messages.includes(message)) {
    messages.push(message);
  }
}

function getDailyAdminActionType(log: unknown): string | null {
  if (!log) {
    return null;
  }

  const record = log as { actionType?: string | null; action_type?: string | null };

  return record.actionType ?? record.action_type ?? null;
}

function buildDailyWorkerIncomeRiskText(
  record: DailyWorkerIncomeRecord,
  paymentStatus: DailyWorkerIncomePaymentStatus,
  cancelLog: DailyWorkerIncomeRecord["marketJob"]["adminActionLogs"][number] | null,
): string {
  const { marketJob } = record;
  const { vehicleJob } = marketJob;
  const messages: string[] = [];
  const tickets = marketJob.tickets;
  const submissions = tickets.flatMap((ticket) => ticket.completionSubmissions);
  const hasAdminSubmittedCount =
    submissions.some(
      (submission) =>
        String(submission.submittedByRole ?? "").toLowerCase() === TICKET_SUBMITTER_ROLE.ADMIN,
    ) ||
    tickets.some((ticket) =>
      (ticket.adminActionLogs ?? []).some(
        (log) => getDailyAdminActionType(log) === ADMIN_ACTION_TYPE.OVERRIDE_COUNT,
      ),
    ) ||
    marketJob.adminActionLogs.some(
      (log) => getDailyAdminActionType(log) === ADMIN_ACTION_TYPE.OVERRIDE_COUNT,
    );
  const hasAutoConfirmedBySystem = submissions.some(
    (submission) => submission.confirmedAt && !submission.resolvedByLineUserId,
  );
  const hasRejectedSubmission = submissions.some(
    (submission) => submission.rejectedAt,
  );

  if (
    record.status === TICKET_WORKER_STATUS.CANCELLED &&
    paymentStatus !== DAILY_WORKER_INCOME_PAYMENT_STATUS.CANCEL
  ) {
    addDailyRiskText(
      messages,
      DAILY_WORKER_INCOME_RISK_TEXT.WORKER_CANCELLED_BY_ADMIN,
    );
  }

  if (paymentStatus === DAILY_WORKER_INCOME_PAYMENT_STATUS.PARTIALLY_PAID) {
    addDailyRiskText(
      messages,
      DAILY_WORKER_INCOME_RISK_TEXT.PARTIAL_PAY_CONFIRMED_STALLS_ONLY,
    );
  }

  if (paymentStatus === DAILY_WORKER_INCOME_PAYMENT_STATUS.ADMIN_REJECT) {
    addDailyRiskText(
      messages,
      DAILY_WORKER_INCOME_RISK_TEXT.REJECTED_REQUIRES_ADMIN_CORRECTION,
    );
  }

  if (hasRejectedSubmission && hasAdminSubmittedCount) {
    addDailyRiskText(
      messages,
      DAILY_WORKER_INCOME_RISK_TEXT.REJECTION_CORRECTED_BY_ADMIN,
    );
  }

  if (paymentStatus === DAILY_WORKER_INCOME_PAYMENT_STATUS.WORKER_REJECT) {
    addDailyRiskText(
      messages,
      DAILY_WORKER_INCOME_RISK_TEXT.REJECTED_REQUIRES_WORKER_CORRECTION,
    );
  }

  if (hasAdminSubmittedCount) {
    addDailyRiskText(
      messages,
      DAILY_WORKER_INCOME_RISK_TEXT.COUNT_SUBMITTED_BY_ADMIN,
    );
  }

  if (hasAutoConfirmedBySystem) {
    addDailyRiskText(
      messages,
      DAILY_WORKER_INCOME_RISK_TEXT.AUTO_CONFIRMED_BY_SYSTEM,
    );
  }

  if (paymentStatus === DAILY_WORKER_INCOME_PAYMENT_STATUS.CANCEL) {
    const cancelActionType = getDailyAdminActionType(cancelLog);
    const isVehicleCancelLog = vehicleJob.adminActionLogs.some((log) => log === cancelLog);
    const isMarketCancelLog = marketJob.adminActionLogs.some((log) => log === cancelLog);

    if (cancelActionType === ADMIN_ACTION_TYPE.VEHICLE_JOB_CANCELLED || isVehicleCancelLog) {
      addDailyRiskText(
        messages,
        DAILY_WORKER_INCOME_RISK_TEXT.VEHICLE_JOB_CANCELLED,
      );
    } else if (
      cancelActionType === ADMIN_ACTION_TYPE.MARKET_JOB_CANCELLED ||
      cancelActionType === ADMIN_ACTION_TYPE.STALL_JOB_CANCELLED ||
      isMarketCancelLog
    ) {
      addDailyRiskText(
        messages,
        DAILY_WORKER_INCOME_RISK_TEXT.MARKET_CANCELLED,
      );
    } else if (vehicleJob.status === VEHICLE_JOB_STATUS.CANCELLED) {
      addDailyRiskText(
        messages,
        DAILY_WORKER_INCOME_RISK_TEXT.VEHICLE_JOB_CANCELLED,
      );
    } else if (marketJob.status === VEHICLE_JOB_STATUS.CANCELLED) {
      addDailyRiskText(
        messages,
        DAILY_WORKER_INCOME_RISK_TEXT.MARKET_CANCELLED,
      );
    }
  }

  return messages.length > 0 ? messages.join(", ") : "-";
}

// Function จัดรูปแบบแถวรายได้ Worker รายวันหนึ่งแถว ใน service flow — คืน null เมื่อแถวนี้ไม่เข้า
// payment_status ไหนเลย (ผู้เรียกต้องกรองออกก่อนแบ่งหน้า)
// Reuse ticketWorker.final_earning_amount ที่ Finalize แล้วตรงๆเป็น payable ห้ามคำนวณสูตรใหม่
function formatDailyWorkerIncomeItem(
  record: DailyWorkerIncomeRecord,
): DailyWorkerIncomeItemResponse | null {
  const { marketJob } = record;
  const { vehicleJob } = marketJob;
  const matchingAssignments = vehicleJob.assignments
    .filter((assignment) => assignment.workerId === record.workerId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const assignment = matchingAssignments[0] ?? null;
  // เวลาส่งยอดล่าสุดของ booth ล่าสุดใน ticket_no นี้ ไม่ว่า worker คนไหนในทีมเป็นคนกดส่ง (ตรงข้ามกับ
  // ก่อนหน้านี้ที่ filter เอาเฉพาะที่ worker แถวนี้ส่งเอง) — ให้ค่าเดียวกันทุกแถวของ ticket_no เดียวกัน
  // เหมือน confirmedAt
  const submittedAtMs = Math.max(
    0,
    ...marketJob.tickets.flatMap((ticket) =>
      ticket.completionSubmissions.map((submission) => submission.createdAt.getTime()),
    ),
  );
  const hasUnresolvedReject = marketJob.tickets.some(
    (ticket) => ticket.status === TICKET_STATUS.REJECT,
  );
  const isReleased = assignment?.releasedAt != null;
  const paymentStatus = resolveDailyWorkerIncomePaymentStatus(
    record,
    hasUnresolvedReject,
    isReleased,
  );

  if (!paymentStatus) {
    return null;
  }

  // marketJob.adminActionLogs ครอบทั้งยกเลิก ticket_no ตรงๆ (MARKET_JOB_CANCELLED) และ cascade
  // จาก Booth สุดท้ายที่ถูกยกเลิกจนตลาดว่าง (STALL_JOB_CANCELLED) — ถ้าไม่มีทั้งคู่ แปลว่า ticket_no
  // นี้ถูกยกเลิกทางอ้อมจากการยกเลิกทั้ง TicketNumber แทน จึง fallback ไปที่ Log ระดับรถ
  const cancelLog =
    paymentStatus === DAILY_WORKER_INCOME_PAYMENT_STATUS.CANCEL
      ? vehicleJob.adminActionLogs.find(
        (log) => getDailyAdminActionType(log) === ADMIN_ACTION_TYPE.VEHICLE_JOB_CANCELLED,
      ) ?? vehicleJob.adminActionLogs[0] ?? marketJob.adminActionLogs.find(
        (log) =>
          getDailyAdminActionType(log) === ADMIN_ACTION_TYPE.MARKET_JOB_CANCELLED ||
          getDailyAdminActionType(log) === ADMIN_ACTION_TYPE.STALL_JOB_CANCELLED,
      ) ?? marketJob.adminActionLogs[0] ?? null
      : null;
  const riskText = buildDailyWorkerIncomeRiskText(record, paymentStatus, cancelLog);

  return {
    worker: {
      code: record.worker.laborCode,
      name: record.worker.fullName ?? record.worker.laborCode,
      shirt: record.worker.laborColor ?? null,
    },
    accepted_at: assignment?.acceptedAt?.toISOString() ?? null,
    shift: record.worker.shiftNo ?? null,
    ticket_no: marketJob.ticketNo,
    plate: vehicleJob.licensePlate,
    payable: record.finalEarningAmount?.toFixed(2) ?? "0.00",
    scanned_at: assignment?.scannedAt?.toISOString() ?? null,
    started_at: vehicleJob.workStartedAt?.toISOString() ?? null,
    submitted_at: submittedAtMs > 0 ? new Date(submittedAtMs).toISOString() : null,
    confirmedAt: marketJob.completedAt?.toISOString() ?? null,
    released_at: assignment?.releasedAt?.toISOString() ?? null,
    payment_status: paymentStatus,
    cancellation:
      paymentStatus === DAILY_WORKER_INCOME_PAYMENT_STATUS.CANCEL
        ? {
          cancelled_at: record.cancelledAt?.toISOString() ?? null,
          cancelled_by_type: cancelLog?.actor.role ?? null,
          cancelled_by_name: cancelLog?.actor.fullName ?? null,
        }
        : null,
    riskText,
  };
}

// Function ดึงรายได้ Worker รายวันสำหรับ Admin ใน service flow
export async function listDailyWorkerIncome(query: unknown): Promise<{
  data: DailyWorkerIncomeItemResponse[];
  available_worker_codes: string[];
  available_shifts: number[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}> {
  const filters = parseWithSchema(adminDailyWorkerIncomeQuerySchema, query);
  const dateFrom = filters.date ?? filters.date_from;
  const dateTo = filters.date ?? filters.date_to;
  const dateRange = buildBangkokDateSpanRange(dateFrom, dateTo);
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const result = await adminJobsRepository.listDailyWorkerIncome({
    workerCode: filters.worker_code,
    status: filters.status,
    shift: filters.shift,
    search: filters.search,
    ...dateRange,
  });

  // payment_status derive จากหลายตาราง ไม่ใช่ column เดียวใน DB ให้ WHERE/paginate ตรงๆ ได้ จึงต้อง
  // format+กรองแถวที่ไม่เข้าเงื่อนไขไหนเลยออกก่อน แล้วค่อยแบ่งหน้าใน service layer (แบบเดียวกับที่
  // listVehicleJobOperations ทำกับ operation_status)
  const items = result.data
    .map(formatDailyWorkerIncomeItem)
    .filter((item): item is DailyWorkerIncomeItemResponse => item !== null);
  const start = (page - 1) * limit;
  const pagedItems = items.slice(start, start + limit);

  return {
    data: pagedItems,
    available_worker_codes: result.available_worker_codes,
    available_shifts: result.available_shifts,
    pagination: {
      page,
      limit,
      total: items.length,
      total_pages: Math.ceil(items.length / limit),
    },
  };
}
