import type { WorkerWorkStatus } from "./shared/worker-status.type";
import type { AccountStatus } from "./shared/account.type";

export const ACCOUNT_ROLES = ["admin", "worker"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export type { AccountStatus };

export type WorkerNationality = "Myanmar" | "Cambodia";

export type WorkerShirtType = "Navy" | "Blue" | "Green";

export interface BuildWorkerCodeInput {
  nationality: string;
  shirt_type: string;
  shirt_number: string;
}

// Type DTO ของ Admin/back-office account — Worker ไม่มี record ในตารางนี้อีกต่อไป (ดู MasterWorkerDto)
export interface AccountDto {
  id: number;
  username: string;
  password_hash: string;
  role: AccountRole;
  status: AccountStatus;
  full_name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  image_url: string | null;
  lang: string;
  permission_level: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export type SafeAccountDto = Omit<AccountDto, "password_hash">;

export const MASTER_WORKER_SOURCES = ["master_sync", "admin_created"] as const;

export type MasterWorkerSource = (typeof MASTER_WORKER_SOURCES)[number];

// Type DTO ของ MasterWorker — source of truth เดียวของข้อมูล Worker ทั้งหมดในระบบ (แทน
// Account/Profile/WorkSchedule เดิม) picture ถูกแปลงเป็น base64 ไว้แล้วที่ชั้น mapper ตามข้อ 29 ของ
// worker.md ไม่ส่ง Buffer ดิบออกไป
export interface MasterWorkerDto {
  id: number;
  labor_id: number | null;
  labor_code: string;
  prefix: string | null;
  name: string | null;
  full_name: string | null;
  labor_status: string | null;
  status: number | null;
  work_code: number | null;
  nationality: string | null;
  telephone: string | null;
  work_start_date: string | null;
  labor_color: string | null;
  labor_coat: string | null;
  coat_no: string | null;
  time_work: string | null;
  time_in: string | null;
  time_out: string | null;
  picture: string | null;
  update_date: string | null;
  shift_no: number | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  lang: string;
  source: MasterWorkerSource;
  password_hash: string | null;
  created_at: string;
  updated_at: string;
}

export type SafeMasterWorkerDto = Omit<MasterWorkerDto, "password_hash">;

// Type schedule ปัจจุบันของ worker หนึ่งคน — field เก็บอยู่บน MasterWorker เอง (shiftNo/
// shiftStartTime/shiftEndTime) ไม่ใช่ entity แยก เหมือนที่เคยเป็น Account มาก่อน
export interface WorkScheduleDto {
  id: number;
  worker_id: number;
  shift_no: number;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  is_current: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkScheduleWithShiftDto extends WorkScheduleDto {
  shift_name: string;
}

export type ShiftWaitInfo = {
  shift: {
    name: string;
    start_time: string;
    end_time: string;
  };
  remaining_time: string;
};

export interface AccountCreateInput {
  username: string;
  password_hash: string;
  role: AccountRole;
  status?: AccountStatus;
  full_name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  image_url?: string | null;
  permission_level?: string | null;
  created_by?: number | null;
}

export interface UserAccountUpdateInput {
  username?: string;
  full_name?: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
}

// Type input สร้าง MasterWorker จาก Admin panel (source = "admin_created") — labor_code ถูก
// generate จาก nationality/shirt_type/shirt_number ด้วย buildWorkerCode() เดิม (ดู worker-code.ts)
// ไม่ใช้กับ record ที่ sync มาจาก Master ซึ่ง labor_code มาจาก Master ตรงๆ
export interface MasterWorkerCreateInput {
  labor_code: string;
  full_name: string;
  telephone?: string | null;
  nationality: string;
  labor_color: string;
  work_start_date?: string | null;
  shift_no?: number | null;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
  status?: number;
}

export interface MasterWorkerUpdateInput {
  labor_code?: string;
  full_name?: string;
  telephone?: string | null;
  nationality?: string | null;
  labor_color?: string | null;
  work_start_date?: string | null;
  status?: number;
}

export interface WorkScheduleCreateInput {
  worker_id: number;
  shift_no?: number;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  is_current?: boolean;
  created_by?: number | null;
  updated_by?: number | null;
}

interface PaginationFilters {
  offset: number;
  limit: number;
}

export interface UserListFilters extends PaginationFilters {
  search?: string;
  status?: AccountStatus;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface UserListSchedule {
  shift_no: number;
  shift_start_time: string;
  shift_end_time: string;
  shift_name: string;
}

export interface UserListItem {
  worker_code: string;
  labor_color: string | null;
  full_name: string | null;
  phone: string | null;
  work_start_date: string | null;
  work_schedule: UserListSchedule | null;
  status: AccountStatus;
  updated_at: string;
}

interface UserDetailInfo {
  phone: string | null;
  nationality: string | null;
  labor_color: string | null;
  work_start_date: string | null;
  shift_no: number | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  shift_name: string | null;
}

export interface UserDetailResponse {
  picture: string | null;
  worker_code: string;
  full_name: string | null;
  status: AccountStatus;
  details: UserDetailInfo;
}

export type AdminWorkerBoardStatus = WorkerWorkStatus;

export type AdminWorkerStatusAssignment = {
  ticket_number: string | null;
  status: string;
  created_at: string;
  accepted_at: string | null;
  accept_deadline_at: string | null;
  accept_deadline_unix_ms: number | null;
  scan_deadline_at: string | null;
};

export type AdminWorkerStatusItem = {
  full_name: string | null;
  worker_code: string;
  labor_color: string | null;
  picture: string | null;
  shift_name: string | null;
  latest_activity_at: string | null;
  status_entered_at: string | null;
  queue_position: number | null;
  socket_connected: boolean;
  status: AdminWorkerBoardStatus;
  assignment: AdminWorkerStatusAssignment | null;
};
