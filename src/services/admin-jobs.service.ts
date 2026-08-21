// Import Library
import { Prisma } from "@prisma/client";

import { withTransaction } from "../db/prisma";
import {
  enqueueWorkersAtFront,
  getWorkerQueueStatus,
  markWorkerAssigned,
  markWorkerOpenApp,
  removeAssignmentTimeout,
  removeScanTimeout,
  removeScanWarning,
  scheduleAssignmentTimeout,
  scheduleScanTimeout,
  scheduleScanWarning,
} from "../queues/worker-queue";
import { dispatchReadyWorkers, returnCompletedWorkersToQueue } from "../queues/worker-dispatch";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import * as adminActionLogRepository from "../repositories/shared/admin-action-log.repository";
import * as adminJobsRepository from "../repositories/admin-jobs.repository";
import * as assignmentRepository from "../repositories/shared/vehicle-job-assignment.repository";
import * as gateTicketRepository from "../repositories/shared/gate-ticket.repository";
import * as marketJobRepository from "../repositories/shared/market-job.repository";
import * as profileRepository from "../repositories/shared/profile.repository";
import * as ticketWorkerRepository from "../repositories/shared/ticket-worker.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import * as workScheduleRepository from "../repositories/shared/work-schedule.repository";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./shared/realtime-notification.service";
import { getRuntimeSettings } from "./shared/runtime-settings.service";
import * as vehicleJobLifecycleService from "./shared/vehicle-job-lifecycle.service";
import {
  buildVehicleOperationSummary,
  formatVehicleOperationItem,
} from "../utils/admin-job-operations.formatter";
import { isTimeInWorkSchedule } from "../utils/shift";
// Import Types
import type {
  AdminVehicleJobFinancialResponse,
  AdminVehicleJobFinancialRecord,
  AdminAssignmentResponse,
  AdminAssignWorkersResponse,
  AdminCancelAssignmentResponse,
  AdminCancelTicketWorkerResponse,
  AdminCancelVehicleJobAndRequeueResponse,
  AdminExtendScanDeadlineResponse,
  AdminHistoryRejectionResponse,
  AdminHistoryBoothResponse,
  AdminHistoryTimelineItemResponse,
  AdminHistoryWorkerResponse,
  AdminJobCancelResponse,
  DailyWorkerIncomeItemResponse,
  DailyWorkerIncomeRecord,
  AdminMarketJobActionResponse,
  AdminOverrideCountResponse,
  AdminReleaseWorkersResponse,
  AdminScanDeadlineAssignmentResponse,
  AdminStallJobActionResponse,
  AdminVehicleJobActionResponse,
  AdminVehicleJobHistoryItemResponse,
  AdminVehicleJobHistoryRecord,
  AdminVehicleJobOperationListResponse,
  AdminVehicleWaitResponse,
} from "../types/admin-jobs.type";
import type { AccessTokenPayload } from "../types/auth.type";
import type {
  GateTicketDto,
  MarketJobDto,
  VehicleJobAssignmentDto,
  VehicleJobDto,
} from "../types/worker.type";
// Import Validation
import { parseWithSchema } from "../validation/parser";
import {
  adminAssignWorkersBodySchema,
  adminCancelBodySchema,
  adminDailyWorkerIncomeQuerySchema,
  adminExtendScanDeadlineBodySchema,
  adminJobCancelBodySchema,
  adminOverrideCountBodySchema,
  adminReleaseWorkersBodySchema,
  adminVehicleJobListQuerySchema,
  adminVehicleJobOperationsQuerySchema,
  adminVehicleWaitBodySchema,
} from "../validation/schemas";
// Import Utils
import ApiError from "../utils/api-error";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS,
  SUBMITTED_TICKET_STATUSES,
  TERMINAL_JOB_STATUSES,
  TERMINAL_TICKET_STATUSES,
  TICKET_STATUS,
  TICKET_WORKER_STATUS,
  VEHICLE_JOB_STATUS,
} from "../constants/job-status";
import { ADMIN_ACTION_TYPE } from "../types/shared/admin-action-log.type";
import type { AdminActionLogDto } from "../types/shared/admin-action-log.type";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";
import {
  buildBangkokDateSpanRange,
  buildDeadline,
  formatBangkokDate,
  getDelayUntil,
  toUnixMs,
} from "../utils/time";
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
      return `${actor} set the vehicle job back to wait.`;
    case ADMIN_ACTION_TYPE.WORKERS_RELEASED:
      return `${actor} released workers back to the queue.`;
    default:
      return `${actor} performed ${log.action_type}.`;
  }
}

// Function สร้างรายการ Worker ของ VehicleJob สำหรับ Work History ใน service flow
function formatAdminHistoryWorkers(
  record: AdminVehicleJobHistoryRecord,
): AdminHistoryWorkerResponse[] {
  const submittedAtByWorkerId = new Map<number, string>();

  for (const market of record.marketJobs) {
    for (const ticket of market.tickets) {
      for (const submission of ticket.completionSubmissions) {
        const createdAtIso = submission.createdAt.toISOString();
        const existing = submittedAtByWorkerId.get(submission.submittedByWorkerAccountId);

        if (!existing || createdAtIso > existing) {
          submittedAtByWorkerId.set(submission.submittedByWorkerAccountId, createdAtIso);
        }
      }
    }
  }

  return record.assignments.map((assignment) => {
    const adminCancelledEvent = assignment.events.find(
      (event) => event.eventType === WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED,
    );

    return {
      worker_code: assignment.worker.username,
      full_name: assignment.worker.fullName,
      shirt_number: assignment.worker.shirtNumber ?? null,
      accepted_at: assignment.acceptedAt?.toISOString() ?? null,
      scanned_at: assignment.scannedAt?.toISOString() ?? null,
      // ไม่มีสัญญาณ "เริ่มงาน" แยกจาก Scan ใน Data Model ปัจจุบัน จึงใช้ scanned_at เป็น started_at
      started_at: assignment.scannedAt?.toISOString() ?? null,
      submitted_at: submittedAtByWorkerId.get(assignment.workerAccountId) ?? null,
      released_at: assignment.releasedAt?.toISOString() ?? null,
      final_status: assignment.status,
      cancellation:
        assignment.status === ASSIGNMENT_STATUS.CANCELLED
          ? {
            cancelled_at:
              adminCancelledEvent?.occurredAt.toISOString() ??
              assignment.updatedAt.toISOString(),
            // Reason/Actor ของ cancel เดิม (POST .../assignment/cancel) ยังไม่ได้บันทึกลง
            // admin_action_logs เพราะ endpoint นั้นไม่ได้แก้ในรอบนี้ (นอกขอบเขต Requirement)
            reason_code: null,
            reason_text: null,
          }
          : null,
    };
  });
}

// Function สร้าง Timeline ของ VehicleJob สำหรับ Work History ใน service flow โดยรวมเหตุการณ์จาก
// WorkerAssignmentEvent, TicketCompletionSubmission และ admin_action_logs แล้วเรียงตามเวลา
function formatAdminHistoryTimeline(
  record: AdminVehicleJobHistoryRecord,
  adminActionLogs: AdminActionLogDto[],
  jobTimestamps: { completed_at: string | null },
): AdminHistoryTimelineItemResponse[] {
  const items: AdminHistoryTimelineItemResponse[] = [
    {
      type: "GATE_ARRIVAL",
      occurred_at: record.createdAt.toISOString(),
      actor_type: "system",
      actor_name: null,
      description: `Vehicle ${record.ticketNumber} arrived at Gate.`,
    },
  ];

  for (const assignment of record.assignments) {
    for (const event of assignment.events) {
      items.push({
        type: mapAssignmentEventToTimelineType(event.eventType),
        occurred_at: event.occurredAt.toISOString(),
        actor_type: event.eventType === WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED
          ? "admin"
          : "worker",
        actor_name: assignment.worker.fullName,
        description: `${assignment.worker.username}: ${event.eventType.toLowerCase()}.`,
      });
    }

    if (assignment.releasedAt) {
      items.push({
        type: "WORKER_RELEASED",
        occurred_at: assignment.releasedAt.toISOString(),
        actor_type: "admin",
        actor_name: assignment.worker.fullName,
        description: `${assignment.worker.username} released back to queue.`,
      });
    }
  }

  for (const market of record.marketJobs) {
    for (const ticket of market.tickets) {
      for (const submission of ticket.completionSubmissions) {
        items.push({
          type: "COUNT_SUBMITTED",
          occurred_at: submission.createdAt.toISOString(),
          actor_type: "worker",
          actor_name: submission.submittedByWorker.fullName,
          description: `${submission.submittedByWorker.username} submitted counts for booth ${ticket.boothCode}.`,
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
// ห้าม derive จาก field ที่ไม่มีจริง หา WorkStart/SubmittedCompleteAt/VendorConfirmedCompleteAt/
// CompletedAt ไม่ได้ก็คืน null แทนการเดา
function deriveAdminHistoryJobTimestamps(record: AdminVehicleJobHistoryRecord): {
  work_start: string | null;
  submitted_complete_at: string | null;
  vendor_confirmed_complete_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
} {
  const scannedTimestamps = record.assignments
    .map((assignment) => assignment.scannedAt)
    .filter((value): value is Date => value !== null);
  const workStart =
    scannedTimestamps.length > 0
      ? new Date(Math.min(...scannedTimestamps.map((value) => value.getTime())))
      : null;

  const allTickets = record.marketJobs.flatMap((market) => market.tickets);
  const latestSubmissionPerTicket = allTickets.map((ticket) =>
    ticket.completionSubmissions.length > 0
      ? ticket.completionSubmissions[ticket.completionSubmissions.length - 1]
      : null,
  );
  const everyTicketSubmitted =
    allTickets.length > 0 && latestSubmissionPerTicket.every((value) => value !== null);
  const submittedCompleteAt = everyTicketSubmitted
    ? new Date(
      Math.max(
        ...latestSubmissionPerTicket.map((submission) => submission!.createdAt.getTime()),
      ),
    )
    : null;

  const requiredTickets = allTickets.filter(
    (ticket) => ticket.status !== TICKET_STATUS.CANCELLED,
  );
  const everyRequiredTicketConfirmed =
    requiredTickets.length > 0 &&
    requiredTickets.every((ticket) =>
      ticket.completionSubmissions.some((submission) => submission.confirmedAt !== null),
    );
  const vendorConfirmedCompleteAt = everyRequiredTicketConfirmed
    ? new Date(
      Math.max(
        ...requiredTickets.flatMap((ticket) =>
          ticket.completionSubmissions
            .filter((submission) => submission.confirmedAt !== null)
            .map((submission) => submission.confirmedAt!.getTime()),
        ),
      ),
    )
    : null;

  const marketCompletedAts = record.marketJobs
    .map((market) => market.completedAt)
    .filter((value): value is Date => value !== null);
  const completedAt =
    record.status === VEHICLE_JOB_STATUS.COMPLETED && marketCompletedAts.length > 0
      ? new Date(Math.max(...marketCompletedAts.map((value) => value.getTime())))
      : null;
  const durationSeconds =
    completedAt && workStart
      ? Math.round((completedAt.getTime() - workStart.getTime()) / 1000)
      : null;

  return {
    work_start: workStart?.toISOString() ?? null,
    submitted_complete_at: submittedCompleteAt?.toISOString() ?? null,
    vendor_confirmed_complete_at: vendorConfirmedCompleteAt?.toISOString() ?? null,
    completed_at: completedAt?.toISOString() ?? null,
    duration_seconds: durationSeconds,
  };
}

// Function จัดรูปแบบ Booth หนึ่งใบสำหรับ Work History ใน service flow
// Reuse formatAdminFinancialBooth (คำนวณเงินจาก Snapshot ที่ Finalize แล้วเหมือนหน้า /financials
// ทุกประการ ห้ามคำนวณสูตรใหม่) แล้วเติมข้อมูลการส่งยอด/Reject ที่หน้า Financial เดิมไม่ต้องใช้
function formatAdminHistoryBooth(
  ticket: AdminVehicleJobHistoryRecord["marketJobs"][number]["tickets"][number],
  market: AdminVehicleJobHistoryRecord["marketJobs"][number],
): AdminHistoryBoothResponse {
  const base = formatAdminFinancialBooth(ticket, market);
  const submissions = ticket.completionSubmissions;
  const latestSubmission =
    submissions.length > 0 ? submissions[submissions.length - 1] : null;
  const submittedWorkerCodes = [
    ...new Set(submissions.map((submission) => submission.submittedByWorker.username)),
  ];
  const rejectionHistory: AdminHistoryRejectionResponse[] = [];

  submissions.forEach((submission, index) => {
    if (!submission.rejectedAt) {
      return;
    }

    const correctingSubmission = submissions[index + 1] ?? null;

    rejectionHistory.push({
      rejectedAt: submission.rejectedAt.toISOString(),
      // GateTicket.reject_reason เก็บแค่ค่าล่าสุดค่าเดียว ไม่ใช่ประวัติทุกครั้ง จึงผูกกับได้แค่
      // รายการ Reject ล่าสุดที่ยังไม่มีการส่งยอดแก้ไขตามมาเท่านั้น
      reject_reason: correctingSubmission ? null : ticket.rejectReason,
      corrected_by_worker_code: correctingSubmission?.submittedByWorker.username ?? null,
    });
  });

  return {
    ...base,
    vendor_line_id: ticket.vendorLineId,
    reject_reason: ticket.rejectReason,
    submitted_worker_codes: submittedWorkerCodes,
    submitted_at: latestSubmission?.createdAt.toISOString() ?? null,
    confirmedAt: latestSubmission?.confirmedAt?.toISOString() ?? null,
    rejection_history: rejectionHistory,
  };
}

// Function จัดรูปแบบ Work History แบบละเอียดของ VehicleJob หนึ่งคัน ใน service flow
function formatAdminVehicleJobHistoryDetail(
  record: AdminVehicleJobHistoryRecord,
  adminActionLogs: AdminActionLogDto[],
): AdminVehicleJobHistoryItemResponse {
  const markets = record.marketJobs.map((market) => ({
    ticket_no: market.ticketNo,
    marketCode: market.marketCode,
    marketName: market.marketName,
    dropoff_point: market.dropoffPoint,
    status: market.status,
    created_at: market.createdAt.toISOString(),
    updated_at: market.updatedAt.toISOString(),
    booths: market.tickets.map((ticket) => formatAdminHistoryBooth(ticket, market)),
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

  const distinctWorkerIds = new Set(
    record.marketJobs.flatMap((market) =>
      market.ticketWorkers.map((ticketWorker) => ticketWorker.workerAccountId),
    ),
  );

  return {
    vehicle_job: {
      ticket_number: record.ticketNumber,
      license_plate: record.licensePlate,
      license_plate_province: record.licensePlateProvince,
      vehicle_type: record.vehicleType,
      workers_required: record.workersRequired,
      dispatch_now: record.dispatchNow,
      status: record.status,
      created_at: record.createdAt.toISOString(),
      updated_at: record.updatedAt.toISOString(),
      ...jobTimestamps,
    },
    markets,
    workers: formatAdminHistoryWorkers(record),
    timeline: formatAdminHistoryTimeline(record, adminActionLogs, jobTimestamps),
    finance: {
      stall_fee_total: stallFeeTotal.toFixed(2),
      labor_fee_total: laborFeeTotal.toFixed(4),
      total_worker_share: totalWorkerShare.toFixed(2),
      fund_amount: fundAmount.toFixed(4),
      worker_count: distinctWorkerIds.size,
    },
  };
}

// Function จัดรูปแบบ vehicle job action response ใน service flow
function formatVehicleJobActionResponse(
  message: string,
  vehicleJob: VehicleJobDto,
): AdminVehicleJobActionResponse {
  return {
    message,
    ticket_number: vehicleJob.ticket_number,
    status: vehicleJob.status,
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
        worker_code: payment.ticketWorker.worker.username,
        full_name: payment.ticketWorker.worker.fullName,
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
        worker_code: payment.ticketWorker.worker.username,
        full_name: payment.ticketWorker.worker.fullName,
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
      worker_code: ticketWorker.worker.username,
      full_name: ticketWorker.worker.fullName,
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
    financialized_at: ticket.financializedAt?.toISOString() ?? null,
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

// Function ตรวจสอบและดึง market job ตาม ref ใน service flow
async function requireMarketJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findMarketJobByRef>[1],
): Promise<MarketJobDto> {
  const marketCode = parseReference(
    idParam,
    "INVALID_MARKET_JOB_REF",
    "Market code is invalid.",
  );
  const marketJob = await adminJobsRepository.findMarketJobByRef(
    marketCode,
    connection,
  );

  if (!marketJob) {
    throw new ApiError(404, "MARKET_JOB_NOT_FOUND", "Market job not found.");
  }

  return marketJob;
}

// Function ตรวจสอบและดึง stall job ตาม ref ใน service flow
async function requireStallJobByRef(
  idParam: unknown,
  connection?: Parameters<typeof adminJobsRepository.findGateTicketByRef>[1],
): Promise<GateTicketDto> {
  const boothCode = parseReference(
    idParam,
    "INVALID_STALL_JOB_REF",
    "Booth code is invalid.",
  );
  const ticket = await adminJobsRepository.findGateTicketByRef(
    boothCode,
    connection,
  );

  if (!ticket) {
    throw new ApiError(404, "STALL_JOB_NOT_FOUND", "Stall job not found.");
  }

  return ticket;
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

// Function เรียง assignments สำหรับ admin cancel requeue ใน service flow
function sortAssignmentsForAdminCancelRequeue(
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
    assignments.map((assignment) => assignment.worker_account_id),
  );

  return assignments.map((assignment) => ({
    worker_code: workerCodeMap.get(assignment.worker_account_id) ?? null,
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
    assignments.map((assignment) => assignment.worker_account_id),
  );

  return assignments.map((assignment) => ({
    ticket_number: ticketNumber,
    worker_code: workerCodeMap.get(assignment.worker_account_id) ?? null,
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
    ...new Set(assignments.map((assignment) => assignment.worker_account_id)),
  ];
}

// Function ดึงรายการ stall job worker IDs ใน service flow
async function listStallJobWorkerIds(ticket: GateTicketDto): Promise<number[]> {
  const ticketWorkers = await ticketWorkerRepository.listTicketWorkers(
    ticket.market_job_id,
  );

  if (ticketWorkers.length > 0) {
    return [
      ...new Set(ticketWorkers.map((worker) => worker.worker_account_id)),
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
  const adminActionLogsByVehicleJobId = new Map<number, AdminActionLogDto[]>(
    await Promise.all(
      result.data.map(async (vehicleJob) => {
        const logs = await adminActionLogRepository.listByVehicleJobId(vehicleJob.id);

        return [vehicleJob.id, logs] as const;
      }),
    ),
  );
  const formatItem = (vehicleJob: (typeof result.data)[number]) =>
    formatAdminVehicleJobHistoryDetail(
      vehicleJob,
      adminActionLogsByVehicleJobId.get(vehicleJob.id) ?? [],
    );

  if (filters.page === undefined) {
    return {
      data: result.data.map(formatItem),
    };
  }

  const limit = filters.limit ?? 20;
  const total = result.total ?? result.data.length;

  return {
    data: result.data.map(formatItem),
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
  body: unknown,
): Promise<AdminVehicleJobActionResponse> {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const activeAssignments =
    await adminJobsRepository.listActiveAssignmentsByVehicleJob(vehicleJobId);
  // ต้องดึงก่อน cancelVehicleJob เท่านั้น เพราะ cancel ทำให้ MarketJob ทุกใบของรถคันนี้กลายเป็น
  // CANCELLED ไปด้วย — listActiveTicketNosByVehicleJobId หลังจากนั้นจะได้ array ว่างเปล่าเสมอ
  const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
    vehicleJobId,
  );

  const vehicleJob = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelVehicleJob(vehicleJobId, transaction);
  });

  await Promise.all(
    activeAssignments.flatMap((assignment) => [
      removeAssignmentTimeout(assignment.id),
      removeScanTimeout(assignment.id),
      removeScanWarning(assignment.id),
    ]),
  );
  await Promise.all(
    activeAssignments.map((assignment) =>
      markWorkerOpenApp(assignment.worker_account_id),
    ),
  );
  // หมายเหตุ: ไม่ยิง ASSIGNMENT_CANCELLED แยกต่อคนตรงนี้อีกต่อไป — เพราะ publishRealtimeEvent ด้านล่าง
  // (VEHICLE_JOB_CANCELLED) ก็ push ให้คนกลุ่มเดียวกันนี้อยู่แล้ว (worker_account_ids ครอบคลุมเหมือนกัน
  // เป๊ะ) เดิมยิงทั้งคู่ทำให้ worker ได้ push ซ้ำ 2 ครั้งติดกันสำหรับเหตุการณ์เดียว ("assignment ถูกยกเลิก"
  // ตามด้วย "vehicle job ถูกยกเลิก") ทั้งที่ในเคสยกเลิกทั้งคันนี้สองอย่างคือเรื่องเดียวกัน
  publishRealtimeEvent({
    type: "VEHICLE_JOB_CANCELLED",
    title: "Vehicle job cancelled",
    message: `Vehicle job ${vehicleJob.ticket_number} was cancelled.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      status: vehicleJob.status,
    },
    worker_payload: {
      ticketNumber: vehicleJob.ticket_number,
      ticketNos,
      status: vehicleJob.status,
      reason: "vehicle_job_cancelled",
    },
    admin: true,
    worker_account_ids: activeAssignments.map(
      (assignment) => assignment.worker_account_id,
    ),
  });

  return formatVehicleJobActionResponse(
    "Vehicle job cancelled successfully.",
    vehicleJob,
  );
}

// Function ยกเลิก vehicle job และ requeue ใน service flow
async function cancelVehicleJobAndRequeue(
  idParam: unknown,
  body: unknown,
): Promise<AdminCancelVehicleJobAndRequeueResponse> {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});
  const activeAssignments =
    await adminJobsRepository.listActiveAssignmentsByVehicleJob(vehicleJobId);
  // ต้องดึงก่อน cancelVehicleJob เท่านั้น เพราะ cancel ทำให้ MarketJob ทุกใบของรถคันนี้กลายเป็น
  // CANCELLED ไปด้วย — listActiveTicketNosByVehicleJobId หลังจากนั้นจะได้ array ว่างเปล่าเสมอ
  const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
    vehicleJobId,
  );

  const vehicleJob = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelVehicleJob(vehicleJobId, transaction);
  });

  await Promise.all(
    activeAssignments.flatMap((assignment) => [
      removeAssignmentTimeout(assignment.id),
      removeScanTimeout(assignment.id),
      removeScanWarning(assignment.id),
    ]),
  );

  const sortedAssignments =
    sortAssignmentsForAdminCancelRequeue(activeAssignments);
  const requeuedWorkerIds = sortedAssignments.map(
    (assignment) => assignment.worker_account_id,
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
    worker_account_ids: requeuedWorkerIds,
  });
  await dispatchReadyWorkers();
  publishNotification({
    type: "VEHICLE_JOB_CANCELLED_AND_REQUEUED",
    title: "Vehicle job cancelled and workers requeued",
    message: `Vehicle job ${vehicleJob.ticket_number} was cancelled and workers were requeued.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      status: vehicleJob.status,
      requeued_worker_codes:
        await profileRepository.findWorkerCodesByAccountIds(requeuedWorkerIds),
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Vehicle job cancelled and workers requeued successfully.",
    ticket_number: vehicleJob.ticket_number,
    status: vehicleJob.status,
    requeued_worker_codes:
      await profileRepository.findWorkerCodesByAccountIds(requeuedWorkerIds),
  };
}

// Function ยกเลิก job ใน service flow
export async function cancelJob(
  body: unknown,
): Promise<AdminJobCancelResponse> {
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
  body: unknown,
): Promise<AdminAssignWorkersResponse> {
  const existingVehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = existingVehicleJob.id;
  const input = parseWithSchema(adminAssignWorkersBodySchema, body);
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

        if (worker.status !== "active") {
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
    await markWorkerAssigned(assignment.worker_account_id);
    await scheduleAssignmentTimeout(
      assignment.id,
      assignment.worker_account_id,
      acceptDeadlineMs,
    );
    sendWorkerSocketEvent(
      assignment.worker_account_id,
      "WORKER_ASSIGNED",
      buildWorkerAssignedPayload(assignment, vehicleJob, ticketNos),
    );
  }
  publishNotification({
    type: "ASSIGNMENT_CREATED_BY_ADMIN",
    title: "Workers assigned by admin",
    message: `${assignments.length} worker(s) were assigned to vehicle job ${vehicleJob.ticket_number}.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      worker_codes: workerCodes,
      assignments: await buildAdminAssignmentResponses(
        vehicleJob.ticket_number,
        assignments,
      ),
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    message: "Workers assigned successfully.",
    ticket_number: vehicleJob.ticket_number,
    assignments: await buildAdminAssignmentResponses(
      vehicleJob.ticket_number,
      assignments,
    ),
  };
}

// Function ยกเลิก assignment ใน service flow
export async function cancelAssignment(
  idParam: unknown,
  workerCodeParam: unknown,
  body: unknown,
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
  parseWithSchema(adminCancelBodySchema, body ?? {});
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

      return result;
    },
  );

  await removeAssignmentTimeout(assignment.id);
  await removeScanTimeout(assignment.id);
  await removeScanWarning(assignment.id);
  await markWorkerOpenApp(assignment.worker_account_id);
  const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
    assignment.vehicle_job_id,
  );

  sendWorkerSocketEvent(assignment.worker_account_id, "ASSIGNMENT_CANCELLED", {
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
): Promise<AdminExtendScanDeadlineResponse> {
  const vehicleJob = await requireVehicleJobByRef(idParam);
  const vehicleJobId = vehicleJob.id;
  const input = parseWithSchema(adminExtendScanDeadlineBodySchema, body);

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

  const updatedAssignments: VehicleJobAssignmentDto[] = [];

  for (const assignment of assignments) {
    updatedAssignments.push(
      await adminJobsRepository.extendAssignmentScanDeadline(
        assignment.id,
        extendDeadline(assignment.scan_deadline_at, input.minutes),
      ),
    );
  }
  await Promise.all(
    updatedAssignments.flatMap((assignment) => [
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
    worker_account_ids: updatedAssignments.map(
      (assignment) => assignment.worker_account_id,
    ),
  });

  return {
    message: "Vehicle job scan deadline extended successfully.",
    ticket_number: vehicleJob.ticket_number,
    assignments: assignmentResponses,
  };
}

// Function ยกเลิก market job ใน service flow
async function cancelMarketJob(
  idParam: unknown,
  body: unknown,
): Promise<AdminMarketJobActionResponse> {
  const existingMarketJob = await requireMarketJobByRef(idParam);
  const marketJobId = existingMarketJob.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});

  const marketJob = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelMarketJob(marketJobId, transaction);
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
    worker_account_ids: await listVehicleJobWorkerIds(marketJob.vehicle_job_id),
  });

  return formatMarketJobActionResponse(
    "Market job cancelled successfully.",
    marketJob,
    vehicleJob,
  );
}

// Function ยกเลิก stall job ใน service flow
async function cancelStallJob(
  idParam: unknown,
  body: unknown,
): Promise<AdminStallJobActionResponse> {
  const existingTicket = await requireStallJobByRef(idParam);
  const ticketId = existingTicket.id;
  parseWithSchema(adminCancelBodySchema, body ?? {});

  const ticket = await withTransaction(async (transaction) => {
    return adminJobsRepository.cancelGateTicket(ticketId, transaction);
  });
  const vehicleJob = await vehicleJobRepository.findVehicleJobById(
    ticket.vehicle_job_id,
  );
  const marketJob = await adminJobsRepository.findMarketJobById(
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
    worker_account_ids: await listStallJobWorkerIds(ticket),
  });

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
export async function cancelTicketWorker(
  ticketNumberParam: unknown,
  ticketNoParam: unknown,
  workerCodeParam: unknown,
  body: unknown,
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
  parseWithSchema(adminCancelBodySchema, body ?? {});

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

  const cancelled = await withTransaction((transaction) =>
    adminJobsRepository.cancelTicketWorkerForMarketJob(
      marketJob.id,
      worker.id,
      transaction,
    ),
  );

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

// Function ดึง actor ID ใน service flow
function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
}

// Function ตรวจสอบและดึง actor ID ที่ต้องมีจริงใน service flow (Admin action ที่ต้อง audit)
function requireActorId(auth?: AccessTokenPayload): number {
  const actorId = getActorId(auth);

  if (actorId === null) {
    throw new ApiError(401, "UNAUTHORIZED", "Admin actor is required.");
  }

  return actorId;
}

// Function Admin ส่ง/แก้ยอดสินค้าของ Booth หนึ่งใบแทน Worker ใน service flow
//
// ใช้ business key (productCode + packageCode) เหมือน Worker submit flow ไม่ใช่ ticketProductId
// เพราะเป็น convention ของ Project นี้อยู่แล้ว (ดู updateTicketProductConfirmations)
export async function overrideTicketProductCounts(
  ticketNumberParam: unknown,
  boothCodeParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminOverrideCountResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const boothCode = parseReference(
    boothCodeParam,
    "INVALID_BOOTH_CODE",
    "BoothCode is invalid.",
  );
  const input = parseWithSchema(adminOverrideCountBodySchema, body);
  const actorId = requireActorId(auth);

  const result = await withTransaction(async (transaction) => {
    const ticket =
      await gateTicketRepository.findGateTicketForCompletionByTicketNumberAndBoothCode(
        vehicleJob.ticket_number,
        boothCode,
        transaction,
      );

    if (!ticket) {
      throw new ApiError(
        404,
        "TICKET_NOT_FOUND",
        "Booth not found for this vehicle job.",
      );
    }

    if (TERMINAL_TICKET_STATUSES.includes(ticket.status)) {
      throw new ApiError(
        409,
        "INVALID_TICKET_STATUS",
        "Booth is already closed and its counts can no longer be overridden.",
      );
    }

    if (ticket.financialized_at) {
      throw new ApiError(
        409,
        "TICKET_ALREADY_FINANCIALIZED",
        "Booth has already been financialized and its counts can no longer be overridden.",
      );
    }

    const existingProducts = await gateTicketRepository.listTicketProducts(
      ticket.id,
      transaction,
    );
    const productByKey = new Map(
      existingProducts.map((product) => [
        `${product.productCode}::${product.packageCode}`,
        product,
      ]),
    );
    const previousQuantityByKey = new Map<string, string | null>();

    for (const item of input.counts) {
      const key = `${item.productCode}::${item.packageCode}`;
      const product = productByKey.get(key);

      if (!product) {
        throw new ApiError(
          404,
          "PRODUCT_NOT_FOUND",
          `Product ${item.productCode}/${item.packageCode} was not found on this booth.`,
        );
      }

      previousQuantityByKey.set(key, product.confirmed_quantity);
    }

    const updatedProducts =
      await gateTicketRepository.updateTicketProductConfirmations(
        ticket.id,
        input.counts.map((item) => ({
          productCode: item.productCode,
          packageCode: item.packageCode,
          confirmed_quantity: item.actual_quantity,
        })),
        transaction,
      );

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        gate_ticket_id: ticket.id,
        action_type: ADMIN_ACTION_TYPE.OVERRIDE_COUNT,
        reason_code: input.reason_code,
        reason_text: input.reason_text ?? null,
        actor_account_id: actorId,
        metadata: {
          boothCode: ticket.boothCode,
          counts: input.counts.map((item) => ({
            productCode: item.productCode,
            packageCode: item.packageCode,
            previous_quantity:
              previousQuantityByKey.get(`${item.productCode}::${item.packageCode}`) ??
              null,
            actual_quantity: item.actual_quantity,
          })),
        },
      },
      transaction,
    );

    const updatedByKey = new Map(
      updatedProducts.map((product) => [
        `${product.productCode}::${product.packageCode}`,
        product,
      ]),
    );

    return {
      ticket,
      products: input.counts.map((item) => {
        const key = `${item.productCode}::${item.packageCode}`;

        return {
          productCode: item.productCode,
          packageCode: item.packageCode,
          previous_quantity: previousQuantityByKey.get(key) ?? null,
          confirmed_quantity: updatedByKey.get(key)?.confirmed_quantity ?? null,
        };
      }),
    };
  });

  return {
    message: "Booth counts overridden successfully.",
    ticket_number: vehicleJob.ticket_number,
    boothCode: result.ticket.boothCode,
    status: result.ticket.status,
    reason_code: input.reason_code,
    reason_text: input.reason_text ?? null,
    products: result.products,
  };
}

// Function Admin สั่งให้ VehicleJob กลับไปสถานะ WAIT (เช่นรถยังไม่พร้อมเข้าจุดลงสินค้า) ใน service flow
//
// อนุญาตเฉพาะตอนที่ยังไม่มี Booth ไหนเริ่มทำงานจริง (ทุก Booth ยังเป็น WAIT) เพื่อไม่ให้ไปขัดจังหวะ
// งานที่ Worker กำลังทำอยู่ ไม่แตะ Assignment/Worker Queue เพราะทีมที่ Dispatch ไปแล้วถือว่ายังรอ
// รถอยู่ที่หน้างาน ไม่ใช่ถูกถอดออกจากงาน
export async function changeVehicleJobToWait(
  ticketNumberParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload,
): Promise<AdminVehicleWaitResponse> {
  const vehicleJob = await requireVehicleJobByRef(ticketNumberParam);
  const input = parseWithSchema(adminVehicleWaitBodySchema, body);
  const actorId = requireActorId(auth);

  const updated = await withTransaction(async (transaction) => {
    if (TERMINAL_JOB_STATUSES.includes(vehicleJob.status)) {
      throw new ApiError(
        409,
        "VEHICLE_JOB_CLOSED",
        "Vehicle job is already closed and cannot be changed to wait.",
      );
    }

    const lifecycleState = await vehicleJobRepository.findVehicleJobLifecycleState(
      vehicleJob.id,
      transaction,
    );
    const hasStartedTicket = (lifecycleState?.marketJobs ?? []).some((market) =>
      market.tickets.some((ticket) => ticket.status !== TICKET_STATUS.WAIT),
    );

    if (hasStartedTicket) {
      throw new ApiError(
        409,
        "VEHICLE_JOB_ALREADY_STARTED",
        "Vehicle job already has a booth in progress and can no longer be changed to wait.",
      );
    }

    const result = await vehicleJobRepository.updateVehicleJobStatus(
      vehicleJob.id,
      VEHICLE_JOB_STATUS.WAIT,
      transaction,
    );

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        action_type: ADMIN_ACTION_TYPE.VEHICLE_WAIT,
        reason_code: input.reason_code,
        reason_text: input.reason_text ?? null,
        actor_account_id: actorId,
      },
      transaction,
    );

    return result;
  });

  publishRealtimeEvent({
    type: "VEHICLE_JOB_WAIT",
    title: "Vehicle job set to wait",
    message: `Vehicle job ${vehicleJob.ticket_number} was set back to wait by admin.`,
    payload: {
      ticketNumber: vehicleJob.ticket_number,
      reason_code: input.reason_code,
    },
    admin: true,
  });

  return {
    message: "Vehicle job set to wait successfully.",
    ticket_number: updated.ticket_number,
    status: updated.status,
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

    const releasable = await assignmentRepository.listReleasableAssignmentsByVehicleJob(
      vehicleJob.id,
      transaction,
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

    await adminActionLogRepository.create(
      {
        vehicle_job_id: vehicleJob.id,
        action_type: ADMIN_ACTION_TYPE.WORKERS_RELEASED,
        reason_code: input.reason_code,
        reason_text: input.reason_text ?? null,
        actor_account_id: actorId,
        metadata: {
          worker_account_ids: releasable.map(
            (assignment) => assignment.worker_account_id,
          ),
        },
      },
      transaction,
    );

    return releasable;
  });

  const releasedWorkerAccountIds = releasableAssignments.map(
    (assignment) => assignment.worker_account_id,
  );
  const releasedWorkerCodes = await returnCompletedWorkersToQueue({
    vehicle_job: {
      ticket_number: vehicleJob.ticket_number,
    },
    completed_worker_account_ids: releasedWorkerAccountIds,
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

// Function จัดรูปแบบแถวรายได้ Worker รายวันหนึ่งแถว ใน service flow
// Reuse ticketWorker.final_earning_amount ที่ Finalize แล้วตรงๆเป็น payable ห้ามคำนวณสูตรใหม่
function formatDailyWorkerIncomeItem(
  record: DailyWorkerIncomeRecord,
): DailyWorkerIncomeItemResponse {
  const { marketJob } = record;
  const { vehicleJob } = marketJob;
  const businessDateSource = record.completedAt ?? record.joinedAt;
  const matchingAssignments = vehicleJob.assignments
    .filter((assignment) => assignment.workerAccountId === record.workerAccountId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const assignment = matchingAssignments[0] ?? null;
  const submittedAtMs = Math.max(
    0,
    ...marketJob.tickets.flatMap((ticket) =>
      ticket.completionSubmissions
        .filter((submission) => submission.submittedByWorkerAccountId === record.workerAccountId)
        .map((submission) => submission.createdAt.getTime()),
    ),
  );
  const collected = marketJob.tickets.reduce(
    (total, ticket) =>
      ticket.finalStallAmount ? total.plus(ticket.finalStallAmount) : total,
    new Prisma.Decimal(0),
  );
  const confirmedStalls = marketJob.tickets.filter(
    (ticket) => ticket.status === TICKET_STATUS.COMPLETED,
  ).length;

  return {
    id: `${marketJob.ticketNo}-${marketJob.marketCode}`,
    business_date: formatBangkokDate(businessDateSource),
    shift: record.worker.shiftNo ?? null,
    ticket_number: vehicleJob.ticketNumber,
    marketJobNo: marketJob.ticketNo,
    plate: vehicleJob.licensePlate,
    worker: {
      code: record.worker.username,
      name: record.worker.fullName,
      shirt: record.worker.shirtNumber ?? null,
    },
    assigned_stalls: marketJob.tickets.length,
    confirmed_stalls: confirmedStalls,
    collected: collected.toFixed(2),
    payable: record.finalEarningAmount?.toFixed(2) ?? "0.00",
    status: record.status,
    accepted_at: assignment?.acceptedAt?.toISOString() ?? null,
    scanned_at: assignment?.scannedAt?.toISOString() ?? null,
    // ไม่มีสัญญาณ "เริ่มงาน" แยกจาก Scan ใน Data Model ปัจจุบัน จึงใช้ scanned_at เป็น started_at
    started_at: assignment?.scannedAt?.toISOString() ?? null,
    submitted_at: submittedAtMs > 0 ? new Date(submittedAtMs).toISOString() : null,
    confirmedAt: marketJob.completedAt?.toISOString() ?? null,
    released_at: assignment?.releasedAt?.toISOString() ?? null,
    cancellation:
      record.status === TICKET_WORKER_STATUS.CANCELLED
        ? {
          cancelled_at: record.cancelledAt?.toISOString() ?? null,
          // Reason ของการ Cancel Roster ระดับ Business Ticket ยังไม่ได้บันทึกลง admin_action_logs
          // (endpoint cancelTicketWorker เดิมไม่ได้แก้ในรอบนี้ นอกขอบเขต Requirement)
          reason_code: null,
          reason_text: null,
        }
        : null,
  };
}

// Function ดึงรายได้ Worker รายวันสำหรับ Admin ใน service flow
export async function listDailyWorkerIncome(query: unknown): Promise<{
  data: DailyWorkerIncomeItemResponse[];
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
    page,
    limit,
    ...dateRange,
  });

  return {
    data: result.data.map(formatDailyWorkerIncomeItem),
    pagination: {
      page,
      limit,
      total: result.total,
      total_pages: Math.ceil(result.total / limit),
    },
  };
}
