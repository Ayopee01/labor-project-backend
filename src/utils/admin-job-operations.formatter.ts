// Import Types
import type { VehicleJobOperationRecord } from "../types/admin-jobs.type";
import type { AdminVehicleJobOperationItemResponse, AdminVehicleJobOperationMarketResponse, AdminVehicleJobOperationMarketSummaryResponse, AdminVehicleJobOperationSummaryResponse, AdminVehicleJobOperationWorkerSummaryResponse, VehicleOperationStatus} from "../types/admin-jobs.type";

// Import Config
import { ACTIVE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS, SCANNED_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES, TICKET_STATUS, VEHICLE_JOB_STATUS, VEHICLE_OPERATION_STATUS } from "../constants/job-status";

// Import Utils
import { findActiveWorkSchedule, formatScheduleWithShift } from "../utils/shift";
import { WORKER_WORK_STATUS } from "../types/shared/worker-status.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลง Date เป็น ISO string โดยรองรับค่า null
function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// Function แปลงสถานะ assignment เป็นสถานะ worker สำหรับบอร์ด operation
function toOperationWorkerStatus(assignmentStatus: string): string {
  if (
    ([ASSIGNMENT_STATUS.PENDING, ASSIGNMENT_STATUS.ACCEPTED] as string[]).includes(
      assignmentStatus
    )
  ) {
    return WORKER_WORK_STATUS.ASSIGNED;
  }

  if (
    ([
      ASSIGNMENT_STATUS.SCANNED,
      ASSIGNMENT_STATUS.WORKING,
      ASSIGNMENT_STATUS.DELIVERED,
      ASSIGNMENT_STATUS.REJECT,
      ASSIGNMENT_STATUS.COMPLETED,
    ] as string[]).includes(assignmentStatus)
  ) {
    return WORKER_WORK_STATUS.WORKING;
  }

  return WORKER_WORK_STATUS.OPEN_APP;
}

// Function หา label กะของ worker จากข้อมูล schedule ที่เก็บบน account
function resolveOperationWorkerShiftName(
  worker: VehicleJobOperationRecord["assignments"][number]["worker"]
): string | null {
  if (
    worker.shiftNo === null ||
    worker.shiftStartTime === null ||
    worker.shiftEndTime === null
  ) {
    return null;
  }

  const scheduleDto = {
    id: worker.id,
    account_id: worker.id,
    shift_no: worker.shiftNo,
    work_date: worker.workStartDate ?? worker.createdAt.toISOString().slice(0, 10),
    shift_start_time: worker.shiftStartTime,
    shift_end_time: worker.shiftEndTime,
    is_current: true,
    created_by: worker.createdBy,
    updated_by: null,
    created_at: worker.createdAt.toISOString(),
    updated_at: worker.updatedAt.toISOString(),
  };
  const activeSchedule = findActiveWorkSchedule([scheduleDto]) ?? scheduleDto;

  return formatScheduleWithShift(activeSchedule)?.shift_name ?? null;
}

// Function ตรวจว่า ticket อยู่สถานะ REJECT หรือไม่
function isTicketRejected(
  ticket: VehicleJobOperationRecord["marketJobs"][number]["tickets"][number]
): boolean {
  return ticket.status === TICKET_STATUS.REJECT;
}

// Function ตรวจว่า ticket ส่งยอดแล้วและรอ vendor หรือไม่
function isTicketDelivered(
  ticket: VehicleJobOperationRecord["marketJobs"][number]["tickets"][number]
): boolean {
  return ticket.status === TICKET_STATUS.DELIVERED;
}

// Function ตรวจว่า ticket จบสมบูรณ์แล้วหรือไม่
function isTicketCompleted(
  ticket: VehicleJobOperationRecord["marketJobs"][number]["tickets"][number]
): boolean {
  return ticket.status === TICKET_STATUS.COMPLETED;
}

// Function รวม ticket ทุกตลาดของงานรถเดียวกันเป็น list เดียว
function listOperationTickets(
  record: VehicleJobOperationRecord
): VehicleJobOperationRecord["marketJobs"][number]["tickets"] {
  return record.marketJobs.flatMap((market) => market.tickets);
}

// Function สรุปจำนวน worker ตามสถานะ assignment ของงานรถหนึ่งงาน
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
    if (
      !([ASSIGNMENT_STATUS.CANCELLED, ASSIGNMENT_STATUS.TIMEOUT] as string[]).includes(
        assignment.status
      )
    ) {
      summary.assigned += 1;
    }

    if (ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
      summary.active += 1;
    }

    if (assignment.status === ASSIGNMENT_STATUS.ACCEPTED) {
      summary.accepted += 1;
    }

    if (
      assignment.scannedAt ||
      SCANNED_ASSIGNMENT_STATUSES.includes(assignment.status)
    ) {
      summary.scanned += 1;
    }

    if (assignment.status === ASSIGNMENT_STATUS.WORKING) {
      summary.working += 1;
    } else if (assignment.status === ASSIGNMENT_STATUS.DELIVERED) {
      summary.delivered += 1;
    } else if (assignment.status === ASSIGNMENT_STATUS.REJECT) {
      summary.rejected += 1;
    } else if (assignment.status === ASSIGNMENT_STATUS.COMPLETED) {
      summary.completed += 1;
    } else if (assignment.status === ASSIGNMENT_STATUS.CANCELLED) {
      summary.cancelled += 1;
    } else if (assignment.status === ASSIGNMENT_STATUS.TIMEOUT) {
      summary.timeout += 1;
    }
  }

  summary.missing = Math.max(
    0,
    record.workersRequired - Math.max(summary.active, summary.assigned)
  );

  return summary;
}

// Function สรุปจำนวนตลาด แผง สินค้า และผลยืนยันของงานรถหนึ่งงาน
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

// Function ตัดสิน operation_status สำหรับ UI จัดการรถจาก dispatch และจำนวน worker
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

// Function คำนวณเวลาผ่าน Gate และเวลาทำงานหลัง worker scan QR
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
    gate_elapsed_seconds: Math.max(
      0,
      Math.floor((endTime - record.ticketCreatedAt.getTime()) / 1000)
    ),
    working_elapsed_seconds:
      firstScannedAt === null
        ? null
        : Math.max(0, Math.floor((endTime - firstScannedAt) / 1000)),
  };
}

// Function แปลงตลาด/แผง/สินค้าเป็น response สำหรับรายละเอียด operation
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
      confirmation_status: ticket.status,
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

// Function แปลง record งานรถเป็น item สำหรับหน้า Admin vehicle operations
export function formatVehicleOperationItem(
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
      license_plate_province: record.licensePlateProvince,
      vehicle_type: record.vehicleType,
      ticket_created_at: record.ticketCreatedAt.toISOString(),
      booth_count: record.boothCount,
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
      shirt_number: assignment.worker.shirtNumber ?? null,
      image_url: assignment.worker.imageUrl ?? null,
      shift_name: resolveOperationWorkerShiftName(assignment.worker),
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

// Function สรุปจำนวนงานรถแยกตาม operation_status
export function buildVehicleOperationSummary(
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
