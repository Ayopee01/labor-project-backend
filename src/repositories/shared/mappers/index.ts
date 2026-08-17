// Import Library
import type { Account, DriverSession, GateTicket, MarketJob, TicketCompletionSubmission, TicketProduct, TicketWorker, UserSession, VehicleJob, VehicleJobAssignment } from "@prisma/client";

// Import Types
import type { SessionDto } from "../../../types/auth.type";
import type { DriverSessionDto } from "../../../types/driver.type";
import type { GateTicketDto, MarketJobDto, TicketCompletionSubmissionDto, TicketProductDto, TicketWorkerDto, VehicleJobAssignmentDto, VehicleJobDto } from "../../../types/worker.type";
import { ACCOUNT_ROLES, ACCOUNT_SOURCES, type AccountDto, type AccountRole, type AccountSource, type ProfileDto, type SafeAccountDto, type WorkScheduleDto } from "../../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลงวันที่จาก DB เป็น ISO string สำหรับ DTO
function toIsoString(value: Date): string;
function toIsoString(value: string): string;
function toIsoString(value: Date | null): string | null;
function toIsoString(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

// Function จัดการ เป็น date string จาก DB
function toDateString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.trim().slice(0, 10);
}

// Function ตัดข้อมูล sensitive และข้อมูล sync ภายในออกจาก account response
export function sanitizeAccount(account: AccountDto): SafeAccountDto;
export function sanitizeAccount(account: null): null;
export function sanitizeAccount(account: AccountDto | null): SafeAccountDto | null {
  if (!account) {
    return null;
  }

  const {
    password_hash: _passwordHash,
    source: _source,
    master_worker_id: _masterWorkerId,
    master_updated_at: _masterUpdatedAt,
    synced_at: _syncedAt,
    ...safeAccount
  } = account;

  return safeAccount;
}

// Function จัดการ เป็น account role จาก DB
function toAccountRole(role: string): AccountRole {
  if ((ACCOUNT_ROLES as readonly string[]).includes(role)) {
    return role as AccountRole;
  }

  throw new Error(`Unsupported account role: ${role}`);
}

// Function จัดการ เป็น account source จาก DB
function toAccountSource(source: string): AccountSource {
  if ((ACCOUNT_SOURCES as readonly string[]).includes(source)) {
    return source as AccountSource;
  }

  return "internal";
}

// Function แปลง account จาก DB
export function mapAccount(record: Account | null): AccountDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    username: record.username,
    password_hash: record.passwordHash,
    role: toAccountRole(record.role),
    status: record.status,
    full_name: record.fullName,
    position: record.position,
    email: record.email,
    phone: record.phone,
    image_url: record.imageUrl,
    nationality: record.nationality,
    work_start_date: record.workStartDate,
    shirt_type: record.shirtType,
    shirt_number: record.shirtNumber,
    shift_no: record.shiftNo,
    shift_start_time: record.shiftStartTime,
    shift_end_time: record.shiftEndTime,
    lang: record.lang,
    source: toAccountSource(record.source),
    master_worker_id: record.masterWorkerId,
    master_updated_at: toIsoString(record.masterUpdatedAt),
    synced_at: toIsoString(record.syncedAt),
    permission_level: record.permissionLevel,
    created_by: record.createdBy,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

type WorkerProfileWithAccount = Account & {
  account?: Pick<Account, "username" | "phone"> | null;
};

// Function แปลง field profile ของ worker บน accounts เป็น profile DTO เดิม
export function mapProfile(record: WorkerProfileWithAccount | null): ProfileDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    account_id: record.id,
    worker_code: record.username,
    image_url: record.imageUrl,
    nationality: record.nationality ?? "",
    work_start_date: record.workStartDate ? toDateString(record.workStartDate) : "",
    phone: record.phone,
    shirt_type: record.shirtType,
    shirt_number: record.shirtNumber,
  };
}

// Function แปลง field schedule ปัจจุบันบน accounts เป็น schedule DTO เดิม
export function mapSchedule(record: Account | null): WorkScheduleDto | null {
  if (
    !record ||
    record.shiftNo === null ||
    record.shiftStartTime === null ||
    record.shiftEndTime === null
  ) {
    return null;
  }

  return {
    id: record.id,
    account_id: record.id,
    shift_no: record.shiftNo,
    work_date: record.workStartDate ? toDateString(record.workStartDate) : toDateString(record.createdAt),
    shift_start_time: record.shiftStartTime,
    shift_end_time: record.shiftEndTime,
    is_current: true,
    created_by: record.createdBy,
    updated_by: null,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง session จาก DB
export function mapSession(record: UserSession | null): SessionDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    account_id: record.accountId,
    refresh_token_hash: record.refreshTokenHash,
    device_id: record.deviceId,
    device_name: record.deviceName,
    ip_address: record.ipAddress,
    user_agent: record.userAgent,
    is_active: record.isActive,
    last_active_at: toIsoString(record.lastActiveAt),
    expires_at: toIsoString(record.expiresAt),
    revoked_at: toIsoString(record.revokedAt),
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง vehicle job จาก DB
export function mapVehicleJob(record: VehicleJob | null): VehicleJobDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    ticketNo: record.ticketNo,
    gate_transaction_ref: record.gateTransactionRef,
    license_plate: record.licensePlate,
    license_plate_province: record.licensePlateProvince,
    vehicle_type: record.vehicleType,
    ticket_created_at: toIsoString(record.ticketCreatedAt),
    booth_count: record.boothCount,
    workers_required: record.workersRequired,
    dispatch_now: record.dispatchNow,
    status: record.status,
    driver_qr_token: record.driverQrToken,
    worker_qr_token: record.ticketNo,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง market job จาก DB
export function mapMarketJob(record: MarketJob | null): MarketJobDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    vehicle_job_id: record.vehicleJobId,
    marketCode: record.marketCode,
    marketName: record.marketName,
    dropoff_point: record.dropoffPoint,
    status: record.status,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง Gate ticket จาก DB
export function mapGateTicket(record: GateTicket | null): GateTicketDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    vehicle_job_id: record.vehicleJobId,
    market_job_id: record.marketJobId,
    boothCode: record.boothCode,
    boothName: record.boothName,
    vendor_line_id: record.vendorLineId,
    reject_reason: record.rejectReason,
    status: record.status,
    confirmation_status: record.status,
    final_stall_amount: record.finalStallAmount?.toFixed(2) ?? null,
    completed_at: record.completedAt ? toIsoString(record.completedAt) : null,
    financialized_at: record.financializedAt ? toIsoString(record.financializedAt) : null,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง ticket product จาก DB
export function mapTicketProduct(record: TicketProduct | null): TicketProductDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    ticket_id: record.ticketId,
    productCode: record.productCode,
    productName: record.productName,
    packageCode: record.packageCode,
    packageName: record.packageName,
    quantity: record.quantity.toString(),
    confirmed_quantity: record.confirmedQuantity?.toString() ?? null,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง ticket worker จาก DB
export function mapTicketWorker(record: TicketWorker | null): TicketWorkerDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    ticket_id: record.ticketId,
    worker_account_id: record.workerAccountId,
    status: record.status,
    final_earning_amount: record.finalEarningAmount?.toFixed(2) ?? null,
    joined_at: toIsoString(record.joinedAt),
    cancelled_at: record.cancelledAt
      ? toIsoString(record.cancelledAt)
      : null,
    completed_at: record.completedAt
      ? toIsoString(record.completedAt)
      : null,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง ticket completion submission จาก DB
export function mapTicketCompletionSubmission(
  record: TicketCompletionSubmission | null
): TicketCompletionSubmissionDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    ticket_id: record.ticketId,
    submitted_by_worker_account_id: record.submittedByWorkerAccountId,
    status: record.status,
    confirmed_at: toIsoString(record.confirmedAt),
    rejected_at: toIsoString(record.rejectedAt),
    resolved_by_line_user_id: record.resolvedByLineUserId,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}


// Function แปลง driver session จาก DB
export function mapDriverSession(record: DriverSession | null): DriverSessionDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    vehicle_job_id: record.vehicleJobId,
    session_token: record.sessionToken,
    expires_at: toIsoString(record.expiresAt),
    revoked_at: toIsoString(record.revokedAt),
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง vehicle job assignment จาก DB
export function mapVehicleJobAssignment(
  record: VehicleJobAssignment | null
): VehicleJobAssignmentDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    vehicle_job_id: record.vehicleJobId,
    worker_account_id: record.workerAccountId,
    status: record.status,
    accept_deadline_at: toIsoString(record.acceptDeadlineAt),
    scan_deadline_at: toIsoString(record.scanDeadlineAt),
    accepted_at: toIsoString(record.acceptedAt),
    scanned_at: toIsoString(record.scannedAt),
    completed_at: toIsoString(record.completedAt),
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}
