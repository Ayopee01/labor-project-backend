import * as adminAuditRepository from "../repositories/admin-audit.repository";

import { parseWithSchema } from "../validation/parser";
import { adminAuditEventsQuerySchema, adminAuditWorkerPerformanceQuerySchema } from "../validation/schemas";
import { buildBangkokDateRange, buildBangkokDateSpanRange, formatBangkokDate } from "../utils/time";
import { ADMIN_ACTION_TYPE } from "../types/shared/admin-action-log.type";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";

import type { AdminActionLogDto } from "../types/shared/admin-action-log.type";
import type {
  AdminAuditActionLogRow,
  AdminAuditCompletionSubmissionRow,
  AdminAuditDriverSessionRow,
  AdminAuditEventItem,
  AdminAuditEventsQuery,
  AdminAuditEventsResponse,
  AdminAuditGateRequestLogRow,
  AdminAuditMessageDeliveryLogRow,
  AdminAuditTicketRatingRow,
  AdminAuditVehicleJobRow,
  AdminAuditWorkerAssignmentEventRow,
  AdminAuditWorkerPerformanceQuery,
  AdminAuditWorkerPerformanceResponse,
} from "../types/admin-audit.type";
import type { AdminAuditDateRange } from "../repositories/admin-audit.repository";

/* -------------------------------------- Functions -------------------------------------- */

export async function listWorkerPerformance(
  query: unknown,
): Promise<AdminAuditWorkerPerformanceResponse> {
  const filters = parseWithSchema(
    adminAuditWorkerPerformanceQuerySchema,
    query,
  ) as AdminAuditWorkerPerformanceQuery;
  const today = formatBangkokDate();
  const dateFrom = filters.date_from ?? today;
  const dateTo = filters.date_to ?? today;
  const dateRange =
    filters.date_from && filters.date_to
      ? buildBangkokDateSpanRange(filters.date_from, filters.date_to)
      : buildBangkokDateRange(today);
  const result = await adminAuditRepository.listWorkerPerformance({
    startAt: dateRange.startAt as Date,
    endAt: dateRange.endAt as Date,
    worker_code: filters.worker_code,
    page: filters.page,
    limit: filters.limit,
    sort_by: filters.sort_by ?? "accept_rate",
    sort_order: filters.sort_order ?? "desc",
  });

  return {
    period: {
      date_from: dateFrom,
      date_to: dateTo,
      timezone: "Asia/Bangkok",
    },
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      total_pages: Math.ceil(result.total / filters.limit),
    },
    data: result.data,
  };
}

/* -------------------------------------- Audit Events -------------------------------------- */
// Merge event จากข้อมูลเดิม 8 source เป็น unified timeline เดียว — ทำที่ TypeScript layer นี้แทน SQL
// UNION เดียว เพราะกฎ merge บางข้อ (ดู mapWorkerAssignmentEvents/mapAdminActionLogEvents ด้านล่าง)
// ต้อง cross-reference ข้าม source กัน (เช่น WorkerAssignmentEvent.ADMIN_CANCELLED กับ
// AdminActionLog.ASSIGNMENT_CANCELLED ต้องรวมเป็น event เดียว ไม่ใช่สอง row ซ้ำกัน)

interface RawAuditEvent extends AdminAuditEventItem {
  search_text: string;
}

// Function แปลงค่าเป็น string สำหรับ ID field ที่เป็น nullable แบบเดียวกันทุก event
function toIdString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

// Function ตรวจว่า timestamp (ISO string) อยู่ในช่วงที่ filter มาหรือไม่ — ใช้ตอน 1 แถวจาก DB อาจมี
// ได้หลาย timestamp (เช่น VehicleJob.createdAt/workStartedAt/completedAt) แต่ query กรองแบบ OR รวม
// จึงต้องเช็คซ้ำเป็นรายฟิลด์ว่าฟิลด์ไหนที่อยู่ในช่วงจริงถึงจะสร้าง event นั้น
function isWithinRange(iso: string, range: AdminAuditDateRange): boolean {
  const time = new Date(iso).getTime();

  return time >= range.startAt.getTime() && time < range.endAt.getTime();
}

// Function ประกอบ text สำหรับค้นหาแบบ case-insensitive จากทุกฟิลด์ที่ search รองรับ
function buildSearchText(
  parts: Array<string | number | null | undefined>,
): string {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map((part) => String(part).toLowerCase())
    .join(" ");
}

// Function map แถว VehicleJob ดิบเป็น event created/started/completed (สูงสุด 3 event ต่อแถว)
function mapVehicleJobEvents(
  rows: AdminAuditVehicleJobRow[],
  range: AdminAuditDateRange,
): RawAuditEvent[] {
  const events: RawAuditEvent[] = [];

  for (const row of rows) {
    if (isWithinRange(row.created_at, range)) {
      events.push({
        event_id: `vehicle_job:${row.id}:created`,
        event_type: "vehicle_job_created",
        actor_type: "gate",
        actor_id: null,
        vehicle_job_id: toIdString(row.id),
        market_job_id: null,
        ticket_id: null,
        assignment_id: null,
        worker_id: null,
        reason_code: null,
        reason_text: null,
        metadata: { ticketNumber: row.ticket_number },
        occurred_at: row.created_at,
        search_text: buildSearchText([
          `vehicle_job:${row.id}:created`,
          "vehicle_job_created",
          row.ticket_number,
        ]),
      });
    }

    if (row.work_started_at && isWithinRange(row.work_started_at, range)) {
      events.push({
        event_id: `vehicle_job:${row.id}:started`,
        event_type: "vehicle_job_started",
        actor_type: "system",
        actor_id: null,
        vehicle_job_id: toIdString(row.id),
        market_job_id: null,
        ticket_id: null,
        assignment_id: null,
        worker_id: null,
        reason_code: null,
        reason_text: null,
        metadata: { ticketNumber: row.ticket_number },
        occurred_at: row.work_started_at,
        search_text: buildSearchText([
          `vehicle_job:${row.id}:started`,
          "vehicle_job_started",
          row.ticket_number,
        ]),
      });
    }

    if (row.completed_at && isWithinRange(row.completed_at, range)) {
      events.push({
        event_id: `vehicle_job:${row.id}:completed`,
        event_type: "vehicle_job_completed",
        actor_type: "system",
        actor_id: null,
        vehicle_job_id: toIdString(row.id),
        market_job_id: null,
        ticket_id: null,
        assignment_id: null,
        worker_id: null,
        reason_code: null,
        reason_text: null,
        metadata: { ticketNumber: row.ticket_number },
        occurred_at: row.completed_at,
        search_text: buildSearchText([
          `vehicle_job:${row.id}:completed`,
          "vehicle_job_completed",
          row.ticket_number,
        ]),
      });
    }
  }

  return events;
}

// Function map แถว GateRequestLog ดิบเป็น gate_arrival_received
function mapGateRequestLogEvents(
  rows: AdminAuditGateRequestLogRow[],
): RawAuditEvent[] {
  return rows.map((row) => ({
    event_id: `gate_request:${row.id}:received`,
    event_type: "gate_arrival_received",
    actor_type: "gate",
    actor_id: null,
    vehicle_job_id: toIdString(row.vehicle_job_id),
    market_job_id: toIdString(row.market_job_id),
    ticket_id: null,
    assignment_id: null,
    worker_id: null,
    reason_code: null,
    reason_text: null,
    metadata: {
      ticketNumber: row.ticket_number,
      gateTransactionRef: row.gate_transaction_ref,
    },
    occurred_at: row.created_at,
    search_text: buildSearchText([
      `gate_request:${row.id}:received`,
      "gate_arrival_received",
      row.ticket_number,
      row.gate_transaction_ref,
    ]),
  }));
}

// Function map แถว DriverSession ดิบเป็น driver_qr_opened
function mapDriverSessionEvents(
  rows: AdminAuditDriverSessionRow[],
): RawAuditEvent[] {
  return rows.map((row) => ({
    event_id: `driver_session:${row.id}:opened`,
    event_type: "driver_qr_opened",
    actor_type: "driver",
    actor_id: null,
    vehicle_job_id: toIdString(row.vehicle_job_id),
    market_job_id: null,
    ticket_id: null,
    assignment_id: null,
    worker_id: null,
    reason_code: null,
    reason_text: null,
    metadata: { ticketNumber: row.ticket_number },
    occurred_at: row.created_at,
    search_text: buildSearchText([
      `driver_session:${row.id}:opened`,
      "driver_qr_opened",
      row.ticket_number,
    ]),
  }));
}

const WORKER_ASSIGNMENT_EVENT_TYPE_MAP: Record<string, string> = {
  [WORKER_ASSIGNMENT_EVENT_TYPE.ASSIGNED]: "worker_assigned",
  [WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPTED]: "worker_accepted",
  [WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPT_TIMEOUT]: "worker_accept_timeout",
  [WORKER_ASSIGNMENT_EVENT_TYPE.SCANNED]: "worker_qr_scanned",
  [WORKER_ASSIGNMENT_EVENT_TYPE.SCAN_TIMEOUT]: "worker_scan_timeout",
  [WORKER_ASSIGNMENT_EVENT_TYPE.COMPLETED]: "worker_completed",
  [WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED]: "worker_assignment_cancelled",
};

// Function map แถว WorkerAssignmentEvent ดิบเป็น event ตามชนิด พร้อม merge กับ AdminActionLog
// ตามกฎ 27.4.6 (ADMIN_CANCELLED จับคู่ ASSIGNMENT_CANCELLED) และ 27.4.7 (ASSIGNED ที่มาจาก Manual
// Assign ให้ Manual Assign log เป็น event หลักแทน ไม่คืน worker_assigned ซ้ำ) — คืน
// consumedAdminActionLogIds กลับไปด้วยเพื่อกันไม่ให้ AdminActionLog แถวที่ถูก merge ไปแล้วถูกคืนซ้ำ
// เป็น event แยกอีกรอบ
function mapWorkerAssignmentEvents(
  rows: AdminAuditWorkerAssignmentEventRow[],
  manualAssignmentAssignmentIds: Set<number>,
  assignmentCancelLogByAssignmentId: Map<number, AdminActionLogDto>,
): { events: RawAuditEvent[]; consumedAdminActionLogIds: Set<number> } {
  const events: RawAuditEvent[] = [];
  const consumedAdminActionLogIds = new Set<number>();

  for (const row of rows) {
    if (
      row.event_type === WORKER_ASSIGNMENT_EVENT_TYPE.ASSIGNED &&
      manualAssignmentAssignmentIds.has(row.assignment_id)
    ) {
      continue;
    }

    const eventType =
      WORKER_ASSIGNMENT_EVENT_TYPE_MAP[row.event_type] ??
      row.event_type.toLowerCase();
    const isWorkerActor =
      row.event_type === WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPTED ||
      row.event_type === WORKER_ASSIGNMENT_EVENT_TYPE.SCANNED;

    let actorType: AdminAuditEventItem["actor_type"] = isWorkerActor
      ? "worker"
      : "system";
    let actorId: string | null = isWorkerActor
      ? toIdString(row.worker_account_id)
      : null;
    let reasonCode: string | null = null;
    let reasonText: string | null = null;
    let metadata: Record<string, unknown> | null = {
      ...(row.metadata ?? {}),
      ticketNumber: row.ticket_number,
      workerCode: row.worker_code,
    };

    if (row.event_type === WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED) {
      const matchedLog = assignmentCancelLogByAssignmentId.get(
        row.assignment_id,
      );

      if (matchedLog) {
        consumedAdminActionLogIds.add(matchedLog.id);
        actorType = "admin";
        actorId = toIdString(matchedLog.actor_account_id);
        reasonCode = matchedLog.reason_code;
        reasonText = matchedLog.reason_text;
        metadata = {
          ...metadata,
          ...(matchedLog.metadata ?? {}),
        };
      }
    }

    events.push({
      event_id: `worker_assignment_event:${row.id}`,
      event_type: eventType,
      actor_type: actorType,
      actor_id: actorId,
      vehicle_job_id: toIdString(row.vehicle_job_id),
      market_job_id: null,
      ticket_id: null,
      assignment_id: toIdString(row.assignment_id),
      worker_id: toIdString(row.worker_account_id),
      reason_code: reasonCode,
      reason_text: reasonText,
      metadata,
      occurred_at: row.occurred_at,
      search_text: buildSearchText([
        `worker_assignment_event:${row.id}`,
        eventType,
        row.ticket_number,
        row.worker_code,
        reasonCode,
        reasonText,
      ]),
    });
  }

  return { events, consumedAdminActionLogIds };
}

// Function map แถว TicketCompletionSubmission ดิบเป็น count_submitted/vendor_rejected/
// vendor_confirmed (สูงสุด 3 event ต่อแถว ตามว่า timestamp ไหนอยู่ในช่วงที่ filter มาบ้าง)
function mapCompletionSubmissionEvents(
  rows: AdminAuditCompletionSubmissionRow[],
  range: AdminAuditDateRange,
): RawAuditEvent[] {
  const events: RawAuditEvent[] = [];

  for (const row of rows) {
    const baseMetadata = {
      ticketNumber: row.ticket_number,
      ticketNo: row.ticket_no,
      boothCode: row.booth_code,
    };
    const base = {
      vehicle_job_id: toIdString(row.vehicle_job_id),
      market_job_id: toIdString(row.market_job_id),
      ticket_id: toIdString(row.ticket_id),
      assignment_id: toIdString(row.assignment_id),
    };

    if (isWithinRange(row.created_at, range)) {
      const actorType =
        row.submitted_by_role === "admin" ? "admin" : "worker";

      events.push({
        event_id: `submission:${row.id}:submitted`,
        event_type: "count_submitted",
        actor_type: actorType,
        actor_id: toIdString(row.submitted_by_account_id),
        ...base,
        worker_id:
          actorType === "worker"
            ? toIdString(row.submitted_by_account_id)
            : null,
        reason_code: null,
        reason_text: null,
        metadata: { ...baseMetadata, workerCode: row.submitted_by_code },
        occurred_at: row.created_at,
        search_text: buildSearchText([
          `submission:${row.id}:submitted`,
          "count_submitted",
          row.ticket_number,
          row.ticket_no,
          row.booth_code,
          row.submitted_by_code,
        ]),
      });
    }

    if (row.rejected_at && isWithinRange(row.rejected_at, range)) {
      const isVendor = Boolean(row.resolved_by_line_user_id);

      events.push({
        event_id: `submission:${row.id}:rejected`,
        event_type: "vendor_rejected",
        actor_type: isVendor ? "vendor" : "system",
        actor_id: isVendor ? row.resolved_by_line_user_id : null,
        ...base,
        worker_id: null,
        reason_code: null,
        reason_text: null,
        metadata: baseMetadata,
        occurred_at: row.rejected_at,
        search_text: buildSearchText([
          `submission:${row.id}:rejected`,
          "vendor_rejected",
          row.ticket_number,
          row.ticket_no,
          row.booth_code,
        ]),
      });
    }

    if (row.confirmed_at && isWithinRange(row.confirmed_at, range)) {
      const isVendor = Boolean(row.resolved_by_line_user_id);

      events.push({
        event_id: `submission:${row.id}:confirmed`,
        event_type: "vendor_confirmed",
        actor_type: isVendor ? "vendor" : "system",
        actor_id: isVendor ? row.resolved_by_line_user_id : null,
        ...base,
        worker_id: null,
        reason_code: null,
        reason_text: null,
        metadata: isVendor
          ? baseMetadata
          : { ...baseMetadata, confirmationSource: "timeout" },
        occurred_at: row.confirmed_at,
        search_text: buildSearchText([
          `submission:${row.id}:confirmed`,
          "vendor_confirmed",
          row.ticket_number,
          row.ticket_no,
          row.booth_code,
        ]),
      });
    }
  }

  return events;
}

// Function map แถว TicketRating ดิบเป็น vendor_rated
function mapTicketRatingEvents(
  rows: AdminAuditTicketRatingRow[],
): RawAuditEvent[] {
  return rows.map((row) => ({
    event_id: `ticket_rating:${row.id}`,
    event_type: "vendor_rated",
    actor_type: "vendor",
    actor_id: row.line_user_id,
    vehicle_job_id: toIdString(row.vehicle_job_id),
    market_job_id: toIdString(row.market_job_id),
    ticket_id: toIdString(row.ticket_id),
    assignment_id: null,
    worker_id: null,
    reason_code: null,
    reason_text: null,
    metadata: {
      ticketNumber: row.ticket_number,
      ticketNo: row.ticket_no,
      boothCode: row.booth_code,
      score: row.score,
      targetType: row.target_type,
    },
    occurred_at: row.rated_at,
    search_text: buildSearchText([
      `ticket_rating:${row.id}`,
      "vendor_rated",
      row.ticket_number,
      row.ticket_no,
      row.booth_code,
    ]),
  }));
}

// Function map แถว MessageDeliveryLog ดิบเป็น message_delivery_sent/message_delivery_failed —
// repository resolve ไว้แล้วว่า sent_at/failed_at ตัวไหนที่ใช้ได้ตาม status
function mapMessageDeliveryLogEvents(
  rows: AdminAuditMessageDeliveryLogRow[],
): RawAuditEvent[] {
  const events: RawAuditEvent[] = [];

  for (const row of rows) {
    const isSent = row.sent_at !== null;
    const occurredAt = isSent ? row.sent_at : row.failed_at;

    if (!occurredAt) {
      continue;
    }

    const eventType = isSent
      ? "message_delivery_sent"
      : "message_delivery_failed";

    events.push({
      event_id: `message_delivery:${row.id}:${isSent ? "sent" : "failed"}`,
      event_type: eventType,
      actor_type: "system",
      actor_id: null,
      vehicle_job_id: null,
      market_job_id: null,
      ticket_id: null,
      assignment_id: null,
      worker_id: null,
      reason_code: null,
      reason_text: null,
      metadata: {
        channel: row.channel,
        jobName: row.job_name,
        target: row.target,
      },
      occurred_at: occurredAt,
      search_text: buildSearchText([
        `message_delivery:${row.id}`,
        eventType,
        row.channel,
        row.job_name,
        row.target,
      ]),
    });
  }

  return events;
}

// Config map AdminActionLog.action_type -> Audit EventType คงที่ (ตาราง 27.5) — action ที่ต้อง
// derive event_type จาก metadata เพิ่ม (OVERRIDE_COUNT/VEHICLE_WAIT/MANUAL_ASSIGNMENT) handle แยก
const ADMIN_ACTION_EVENT_TYPE_MAP: Partial<Record<string, string>> = {
  [ADMIN_ACTION_TYPE.WORKERS_RELEASED]: "workers_released",
  [ADMIN_ACTION_TYPE.ASSIGNMENT_CANCELLED]: "worker_assignment_cancelled",
  [ADMIN_ACTION_TYPE.SCAN_DEADLINE_EXTENDED]: "scan_timer_extended",
  [ADMIN_ACTION_TYPE.MARKET_JOB_CANCELLED]: "market_cancelled",
  [ADMIN_ACTION_TYPE.VEHICLE_JOB_CANCELLED]: "vehicle_cancelled",
  [ADMIN_ACTION_TYPE.STALL_JOB_CANCELLED]: "ticket_cancelled",
  [ADMIN_ACTION_TYPE.TICKET_WORKER_CANCELLED]: "ticket_worker_cancelled",
  [ADMIN_ACTION_TYPE.TICKET_WORKER_CANCELLED_FROM_BOOTH]: "booth_worker_cancelled",
  [ADMIN_ACTION_TYPE.WORKER_STATUS_FORCED]: "worker_force_status_changed",
};

// Function หา event_type + metadata เสริมของ AdminActionLog แถวหนึ่ง ตามตาราง 27.5
function resolveAdminActionEventTypeAndMetadata(
  log: AdminActionLogDto & AdminAuditActionLogRow,
): { eventType: string; metadata: Record<string, unknown> | null } {
  const baseMetadata = log.metadata ?? {};

  switch (log.action_type) {
    case ADMIN_ACTION_TYPE.OVERRIDE_COUNT:
      return {
        eventType: "admin_override",
        metadata: { ...baseMetadata, action: "override_count" },
      };
    case ADMIN_ACTION_TYPE.VEHICLE_WAIT: {
      const dispatch =
        (baseMetadata as { dispatch?: boolean }).dispatch === true;

      return dispatch
        ? {
            eventType: "admin_override",
            metadata: { ...baseMetadata, action: "dispatch_vehicle" },
          }
        : { eventType: "job_reverted_to_wait", metadata: baseMetadata };
    }
    case ADMIN_ACTION_TYPE.MANUAL_ASSIGNMENT:
      return {
        eventType: "admin_override",
        metadata: { ...baseMetadata, action: "manual_assign" },
      };
    default: {
      const mapped = ADMIN_ACTION_EVENT_TYPE_MAP[log.action_type];

      return {
        eventType: mapped ?? log.action_type.toLowerCase(),
        metadata: baseMetadata,
      };
    }
  }
}

// Function map แถว AdminActionLog ดิบเป็น event ตามตาราง 27.5 — ข้ามแถวที่ถูก merge เข้ากับ
// WorkerAssignmentEvent.ADMIN_CANCELLED ไปแล้ว (consumedAdminActionLogIds) เพื่อไม่ให้คืนซ้ำสอง event
function mapAdminActionLogEvents(
  rows: Array<AdminActionLogDto & AdminAuditActionLogRow>,
  consumedAdminActionLogIds: Set<number>,
): RawAuditEvent[] {
  const events: RawAuditEvent[] = [];

  for (const row of rows) {
    if (consumedAdminActionLogIds.has(row.id)) {
      continue;
    }

    const { eventType, metadata } = resolveAdminActionEventTypeAndMetadata(row);
    const assignmentId =
      (row.metadata as { assignment_id?: number } | null)?.assignment_id ??
      null;
    const workerAccountId =
      (row.metadata as { worker_account_id?: number } | null)
        ?.worker_account_id ?? null;
    const enrichedMetadata = {
      ...(metadata ?? {}),
      ...(row.vehicle_ticket_number && {
        ticketNumber: row.vehicle_ticket_number,
      }),
      ...(row.market_ticket_no && { ticketNo: row.market_ticket_no }),
      ...(row.gate_ticket_booth_code && {
        boothCode: row.gate_ticket_booth_code,
      }),
    };

    events.push({
      event_id: `admin_action:${row.id}`,
      event_type: eventType,
      actor_type: "admin",
      actor_id: toIdString(row.actor_account_id),
      vehicle_job_id: toIdString(row.vehicle_job_id),
      market_job_id: toIdString(row.market_job_id),
      ticket_id: toIdString(row.gate_ticket_id),
      assignment_id: toIdString(assignmentId),
      worker_id: toIdString(workerAccountId),
      reason_code: row.reason_code,
      reason_text: row.reason_text,
      metadata: enrichedMetadata,
      occurred_at: row.created_at,
      search_text: buildSearchText([
        `admin_action:${row.id}`,
        eventType,
        row.actor_worker_code,
        row.actor_full_name,
        row.reason_code,
        row.reason_text,
        row.vehicle_ticket_number,
        row.market_ticket_no,
        row.gate_ticket_booth_code,
      ]),
    });
  }

  return events;
}

export async function listAuditEvents(
  query: unknown,
): Promise<AdminAuditEventsResponse> {
  const filters = parseWithSchema(
    adminAuditEventsQuerySchema,
    query,
  ) as AdminAuditEventsQuery;
  const today = formatBangkokDate();
  const dateRange =
    filters.date_from && filters.date_to
      ? buildBangkokDateSpanRange(filters.date_from, filters.date_to)
      : buildBangkokDateRange(today);
  const range: AdminAuditDateRange = {
    startAt: dateRange.startAt as Date,
    endAt: dateRange.endAt as Date,
  };

  const [
    vehicleJobRows,
    gateRequestLogRows,
    driverSessionRows,
    workerAssignmentEventRows,
    completionSubmissionRows,
    ticketRatingRows,
    messageDeliveryLogRows,
    adminActionLogRows,
  ] = await Promise.all([
    adminAuditRepository.listVehicleJobsForAudit(range),
    adminAuditRepository.listGateRequestLogsForAudit(range),
    adminAuditRepository.listDriverSessionsForAudit(range),
    adminAuditRepository.listWorkerAssignmentEventsForAudit(range),
    adminAuditRepository.listCompletionSubmissionsForAudit(range),
    adminAuditRepository.listTicketRatingsForAudit(range),
    adminAuditRepository.listMessageDeliveryLogsForAudit(range),
    adminAuditRepository.listAdminActionLogsForAudit(range),
  ]);

  const assignmentCancelLogByAssignmentId = new Map<number, AdminActionLogDto>();
  const manualAssignmentAssignmentIds = new Set<number>();

  for (const log of adminActionLogRows) {
    if (log.action_type === ADMIN_ACTION_TYPE.ASSIGNMENT_CANCELLED) {
      const assignmentId = (
        log.metadata as { assignment_id?: number } | null
      )?.assignment_id;

      if (typeof assignmentId === "number") {
        assignmentCancelLogByAssignmentId.set(assignmentId, log);
      }
    }

    if (log.action_type === ADMIN_ACTION_TYPE.MANUAL_ASSIGNMENT) {
      const assignmentIds = (
        log.metadata as { assignment_ids?: number[] } | null
      )?.assignment_ids;

      for (const assignmentId of assignmentIds ?? []) {
        manualAssignmentAssignmentIds.add(assignmentId);
      }
    }
  }

  const { events: workerAssignmentEvents, consumedAdminActionLogIds } =
    mapWorkerAssignmentEvents(
      workerAssignmentEventRows,
      manualAssignmentAssignmentIds,
      assignmentCancelLogByAssignmentId,
    );

  const allEvents: RawAuditEvent[] = [
    ...mapVehicleJobEvents(vehicleJobRows, range),
    ...mapGateRequestLogEvents(gateRequestLogRows),
    ...mapDriverSessionEvents(driverSessionRows),
    ...workerAssignmentEvents,
    ...mapCompletionSubmissionEvents(completionSubmissionRows, range),
    ...mapTicketRatingEvents(ticketRatingRows),
    ...mapMessageDeliveryLogEvents(messageDeliveryLogRows),
    ...mapAdminActionLogEvents(adminActionLogRows, consumedAdminActionLogIds),
  ];

  const searchTerm = filters.search?.toLowerCase();
  const filteredEvents = allEvents.filter((event) => {
    if (filters.actor_type && event.actor_type !== filters.actor_type) {
      return false;
    }

    if (filters.event_type && event.event_type !== filters.event_type) {
      return false;
    }

    if (searchTerm && !event.search_text.includes(searchTerm)) {
      return false;
    }

    return true;
  });

  filteredEvents.sort((left, right) => {
    const timeDiff =
      new Date(right.occurred_at).getTime() -
      new Date(left.occurred_at).getTime();

    if (timeDiff !== 0) {
      return timeDiff;
    }

    return right.event_id.localeCompare(left.event_id);
  });

  const uniqueVehicleIds = new Set<string>();
  let withReasonCount = 0;
  const actorTypeCounts: Record<string, number> = {};
  const eventTypeCounts: Record<string, number> = {};

  for (const event of filteredEvents) {
    if (event.vehicle_job_id) {
      uniqueVehicleIds.add(event.vehicle_job_id);
    }

    if (event.reason_code) {
      withReasonCount += 1;
    }

    actorTypeCounts[event.actor_type] =
      (actorTypeCounts[event.actor_type] ?? 0) + 1;
    eventTypeCounts[event.event_type] =
      (eventTypeCounts[event.event_type] ?? 0) + 1;
  }

  const total = filteredEvents.length;
  const startIndex = (filters.page - 1) * filters.limit;
  const pageEvents = filteredEvents
    .slice(startIndex, startIndex + filters.limit)
    .map(({ search_text: _searchText, ...event }) => event);

  return {
    data: pageEvents,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      total_pages: Math.ceil(total / filters.limit),
    },
    summary: {
      unique_vehicle_count: uniqueVehicleIds.size,
      with_reason_count: withReasonCount,
      actor_type_counts: actorTypeCounts,
      event_type_counts: eventTypeCounts,
    },
  };
}
