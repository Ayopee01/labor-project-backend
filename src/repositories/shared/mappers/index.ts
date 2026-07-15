// import Library
import type { Account, DriverSession, GateTicket, MarketJob, TicketCompletionSubmission, TicketProduct, TicketWorker, UserProfile, UserSession, UserWorkSchedule, VehicleJob, VehicleJobAssignment } from "@prisma/client";

// import Types
import type { SessionDto } from "../../../types/auth.type";
import type { DriverSessionDto } from "../../../types/driver.type";
import type { GateTicketDto, MarketJobDto, TicketCompletionSubmissionDto, TicketProductDto, TicketWorkerDto, VehicleJobAssignmentDto, VehicleJobDto } from "../../../types/worker.type";
import { ACCOUNT_ROLES, type AccountDto, type AccountRole, type ProfileDto, type SafeAccountDto, type WorkScheduleDto } from "../../../types/admin-workers.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลงค่า Date จาก Prisma เป็น ISO string สำหรับ DTO
function toIsoString(value: Date): string;
// Function overload รองรับ string ที่เป็น ISO อยู่แล้ว
function toIsoString(value: string): string;
// Function overload รองรับ Date ที่อาจเป็น null
function toIsoString(value: Date | null): string | null;
// Function แปลง Date/string/null เป็น ISO string หรือ null
function toIsoString(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

// Function แปลงค่า Date หรือ string เป็นวันที่รูปแบบ YYYY-MM-DD
function toDateString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.trim().slice(0, 10);
}

// Function ลบ password_hash ออกจาก account ก่อนส่งเป็น response
export function sanitizeAccount(account: AccountDto): SafeAccountDto;
// Function overload คืน null เมื่อไม่มี account
export function sanitizeAccount(account: null): null;
// Function ลบ password_hash ออกจาก account หรือคืน null
export function sanitizeAccount(account: AccountDto | null): SafeAccountDto | null {
  if (!account) {
    return null;
  }

  const { password_hash: _passwordHash, ...safeAccount } = account;

  return safeAccount;
}

// Function แปลง record จาก table accounts เป็น AccountDto
function toAccountRole(role: string): AccountRole {
  if ((ACCOUNT_ROLES as readonly string[]).includes(role)) {
    return role as AccountRole;
  }

  throw new Error(`Unsupported account role: ${role}`);
}

// Function แปลง record จาก table accounts เป็น AccountDto
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
    permission_level: record.permissionLevel,
    created_by: record.createdBy,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง record จาก table user_profiles เป็น ProfileDto
export function mapProfile(record: UserProfile | null): ProfileDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    account_id: record.accountId,
    worker_code: record.workerCode,
    image_url: record.imageUrl,
    nationality: record.nationality,
    nationality_code: record.nationalityCode,
    nationality_name: record.nationalityName,
    work_start_date: toDateString(record.workStartDate),
    phone: record.phone,
    shirt_type: record.shirtType,
    shirt_number: record.shirtNumber,
  };
}

// Function แปลง record จาก table user_work_schedules เป็น WorkScheduleDto
export function mapSchedule(record: UserWorkSchedule | null): WorkScheduleDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    account_id: record.accountId,
    work_date: toDateString(record.workDate),
    shift_start_time: record.shiftStartTime,
    shift_end_time: record.shiftEndTime,
    is_current: record.isCurrent,
    created_by: record.createdBy,
    updated_by: record.updatedBy,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง record จาก table user_sessions เป็น SessionDto
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

// Function แปลง record จาก table vehicle_jobs เป็น VehicleJobDto
export function mapVehicleJob(record: VehicleJob | null): VehicleJobDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    vehicle_job_ref: record.vehicleJobRef,
    gate_transaction_ref: record.gateTransactionRef,
    license_plate: record.licensePlate,
    vehicle_type: record.vehicleType,
    workers_required: record.workersRequired,
    status: record.status,
    driver_qr_token: record.driverQrToken,
    worker_qr_token: record.workerQrToken,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง record จาก table market_jobs เป็น MarketJobDto
export function mapMarketJob(record: MarketJob | null): MarketJobDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    vehicle_job_id: record.vehicleJobId,
    market_job_ref: record.marketJobRef,
    market_name: record.marketName,
    status: record.status,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง record จาก table gate_tickets เป็น GateTicketDto
export function mapGateTicket(record: GateTicket | null): GateTicketDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    vehicle_job_id: record.vehicleJobId,
    market_job_id: record.marketJobId,
    stall_job_ref: record.stallJobRef,
    ticket_no: record.ticketNo,
    stall_no: record.stallNo,
    vendor_name: record.vendorName,
    vendor_line_id: record.vendorLineId,
    status: record.status,
    confirmation_status: record.confirmationStatus,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง record จาก table ticket_products เป็น TicketProductDto
export function mapTicketProduct(record: TicketProduct | null): TicketProductDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    ticket_id: record.ticketId,
    product_ref: record.productRef,
    product_type: record.productType,
    name: record.name,
    quantity: record.quantity.toString(),
    confirmed_quantity: record.confirmedQuantity?.toString() ?? null,
    unit: record.unit,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง record จาก table ticket_workers เป็น TicketWorkerDto
export function mapTicketWorker(record: TicketWorker | null): TicketWorkerDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    ticket_id: record.ticketId,
    worker_account_id: record.workerAccountId,
    status: record.status,
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}

// Function แปลง record จาก table ticket_completion_submissions เป็น TicketCompletionSubmissionDto
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
    created_at: toIsoString(record.createdAt),
    updated_at: toIsoString(record.updatedAt),
  };
}


// Function แปลง record จาก table driver_sessions เป็น DriverSessionDto
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

// Function แปลง record จาก table vehicle_job_assignments เป็น VehicleJobAssignmentDto
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
