// Type ส่วน Value ของ role account: schema DB เก็บเป็น string
export type AccountRole = string;

// Type ส่วน Value ของ status account: schema DB เก็บเป็น string
export type AccountStatus = string;

// Type ส่วน DTO ของ table accounts
export interface AccountDto {
  id: number;
  username: string;
  password_hash: string;
  role: AccountRole;
  status: AccountStatus;
  full_name: string;
  position: string | null;
  permission_level: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ account ที่ปลอดภัยสำหรับ response
export type SafeAccountDto = Omit<AccountDto, "password_hash">;

// Type ส่วน DTO ของ table user_profiles
export interface ProfileDto {
  id: number;
  account_id: number;
  worker_code: string;
  image_url: string | null;
  nationality: string;
  nationality_code: string;
  nationality_name: string;
  work_start_date: string;
  phone: string;
  shirt_type: string | null;
  shirt_number: string | null;
}

// Type ส่วน DTO ของ table user_work_schedules
export interface WorkScheduleDto {
  id: number;
  account_id: number;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  is_current: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของตารางงานพร้อมชื่อกะ
export interface WorkScheduleWithShiftDto extends WorkScheduleDto {
  shift_name: string;
}

// Type ส่วน Repository input สำหรับสร้าง account
export interface AccountCreateInput {
  username: string;
  password_hash: string;
  role: AccountRole;
  status?: AccountStatus;
  full_name: string;
  position?: string | null;
  permission_level?: string | null;
  created_by?: number | null;
}

// Type ส่วน Repository input สำหรับแก้ไข account ของ user
export interface UserAccountUpdateInput {
  full_name?: string;
}

// Type ส่วน Repository input สำหรับสร้าง profile
export interface ProfileCreateInput {
  account_id: number;
  worker_code: string;
  image_url?: string | null;
  nationality: string;
  nationality_code: string;
  nationality_name: string;
  work_start_date: string;
  phone: string;
  shirt_type?: string | null;
  shirt_number?: string | null;
}

// Type ส่วน Repository input สำหรับแก้ไข profile
export type ProfileUpdateInput = Partial<Omit<ProfileCreateInput, "account_id">>;

// Type ส่วน Repository input สำหรับสร้างตารางงาน
export interface WorkScheduleCreateInput {
  account_id: number;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  is_current?: boolean;
  created_by?: number | null;
  updated_by?: number | null;
}

// Type ส่วน Repository input สำหรับแก้ไขตารางงานปัจจุบัน
export interface WorkScheduleUpdateInput {
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  updated_by?: number | null;
}

// Type ส่วน Filter สำหรับ pagination พื้นฐาน
export interface PaginationFilters {
  offset: number;
  limit: number;
}

// Type ส่วน Filter สำหรับ API list users
export interface UserListFilters extends PaginationFilters {
  search?: string;
  status?: AccountStatus;
}

// Type ส่วน Response pagination
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

// Type ส่วน Response ของ session ที่แสดงใน user detail
export interface FormattedSession {
  id: number;
  device_id: string;
  device_name: string;
  last_active_at: string;
}

// Type ส่วน Response item ของ API list users
export interface UserListItem {
  id: number;
  username: string;
  role: AccountRole;
  status: AccountStatus;
  full_name: string;
  profile: ProfileDto | null;
  current_work_schedule: WorkScheduleWithShiftDto | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน Response ของ API user detail
export interface UserDetailResponse {
  account: SafeAccountDto;
  profile: ProfileDto | null;
  current_work_schedule: WorkScheduleWithShiftDto | null;
  active_session: FormattedSession | null;
}
