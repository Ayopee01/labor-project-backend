// import Library
import type { Account, UserProfile, UserSession, UserWorkSchedule } from "@prisma/client";

// import Types
import type { SessionDto } from "../types/auth.type";
import type { AccountDto, ProfileDto, SafeAccountDto, WorkScheduleDto } from "../types/users.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลงค่า Date จาก Prisma เป็น ISO string สำหรับ DTO
function toIsoString(value: Date): string;
function toIsoString(value: string): string;
function toIsoString(value: Date | null): string | null;
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
export function sanitizeAccount(account: null): null;
export function sanitizeAccount(account: AccountDto | null): SafeAccountDto | null {
  if (!account) {
    return null;
  }

  const { password_hash: _passwordHash, ...safeAccount } = account;

  return safeAccount;
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
    role: record.role,
    status: record.status,
    full_name: record.fullName,
    position: record.position,
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
