import type { WorkerWorkStatus } from "./shared/worker-status.type";

export const ACCOUNT_ROLES = ["admin", "worker"] as const;
export const ACCOUNT_SOURCES = ["internal", "master_sync"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type AccountSource = (typeof ACCOUNT_SOURCES)[number];

export type AccountStatus = string;

export type WorkerNationality = "Myanmar" | "Cambodia";

export type WorkerShirtType = "Navy" | "Blue" | "Green";

export interface BuildWorkerCodeInput {
  nationality: string;
  shirt_type: string;
  shirt_number: string;
}

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
  nationality: string | null;
  work_start_date: string | null;
  shirt_type: string | null;
  shirt_number: string | null;
  shift_no: number | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  source: AccountSource;
  master_worker_id: string | null;
  master_updated_at: string | null;
  synced_at: string | null;
  permission_level: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export type SafeAccountDto = Omit<
  AccountDto,
  "password_hash" | "source" | "master_worker_id" | "master_updated_at" | "synced_at"
>;

// Type DTO profile ของ worker โดย field profile ถูกเก็บบน accounts หลังรวมตาราง
export interface ProfileDto {
  id: number;
  account_id: number;
  worker_code: string | null;
  image_url: string | null;
  nationality: string;
  work_start_date: string;
  phone: string | null;
  shirt_type: string | null;
  shirt_number: string | null;
}

// Type DTO ตารางกะปัจจุบันของ worker โดย field schedule ถูกเก็บบน accounts หลังรวมตาราง
export interface WorkScheduleDto {
  id: number;
  account_id: number;
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
  nationality?: string | null;
  work_start_date?: string | null;
  shirt_type?: string | null;
  shirt_number?: string | null;
  shift_no?: number | null;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
  source?: AccountSource;
  master_worker_id?: string | null;
  master_updated_at?: Date | string | null;
  synced_at?: Date | string | null;
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

export interface ProfileCreateInput {
  account_id: number;
  image_url?: string | null;
  nationality: string;
  work_start_date: string;
  shirt_type?: string | null;
  shirt_number?: string | null;
}

export type ProfileUpdateInput = Partial<Omit<ProfileCreateInput, "account_id">>;

export type ProfileDataInput = ProfileCreateInput | ProfileUpdateInput;

export type ProfileData = {
  imageUrl?: string | null;
  nationality?: string;
  workStartDate?: string;
  shirtType?: string | null;
  shirtNumber?: string | null;
};

export type ProfileCreateData = {
  imageUrl?: string | null;
  nationality: string;
  workStartDate: string;
  shirtType?: string | null;
  shirtNumber?: string | null;
};

export interface WorkScheduleCreateInput {
  account_id: number;
  shift_no?: number;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  is_current?: boolean;
  created_by?: number | null;
  updated_by?: number | null;
}

export interface WorkScheduleUpdateInput {
  shift_no?: number;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
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
  worker_code: string | null;
  shirt_number: string | null;
  full_name: string;
  work_start_date: string | null;
  work_schedule: UserListSchedule | null;
  status: AccountStatus;
  updated_at: string;
}

interface UserDetailInfo {
  phone: string | null;
  position: string | null;
  nationality: string | null;
  shirt_number: string | null;
  shirt_type: string | null;
  work_start_date: string | null;
  shift_no: number | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  shift_name: string | null;
}

export interface UserDetailResponse {
  image_url: string | null;
  worker_code: string | null;
  full_name: string;
  status: AccountStatus;
  details: UserDetailInfo;
}

export type AdminWorkerBoardStatus = WorkerWorkStatus;

export type AdminWorkerStatusItem = {
  full_name: string;
  worker_code: string | null;
  shirt_number: string | null;
  image_url: string | null;
  shift_name: string | null;
  latest_activity_at: string | null;
  status_entered_at: string | null;
  queue_position: number | null;
  socket_connected: boolean;
  status: AdminWorkerBoardStatus;
};
