// Config role account ที่ระบบรองรับ
export const ACCOUNT_ROLES = ["admin", "worker"] as const;

// Type ส่วน Value ของ role account ที่ระบบรองรับ
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

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
  email: string | null;
  phone: string | null;
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
  email?: string | null;
  phone?: string | null;
  permission_level?: string | null;
  created_by?: number | null;
}

// Type ส่วน Repository input สำหรับแก้ไข account ของ user
export interface UserAccountUpdateInput {
  username?: string;
  full_name?: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
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

// Type ส่วน input profile ที่ใช้ร่วมกันระหว่าง create และ update
export type ProfileDataInput = ProfileCreateInput | ProfileUpdateInput;

// Type ส่วน data สำหรับ update profile ผ่าน Prisma
export type ProfileData = {
  workerCode?: string;
  imageUrl?: string | null;
  nationality?: string;
  nationalityCode?: string;
  nationalityName?: string;
  workStartDate?: string;
  phone?: string;
  shirtType?: string | null;
  shirtNumber?: string | null;
};

// Type ส่วน data สำหรับ create profile ผ่าน Prisma
export type ProfileCreateData = {
  workerCode: string;
  imageUrl?: string | null;
  nationality: string;
  nationalityCode: string;
  nationalityName: string;
  workStartDate: string;
  phone: string;
  shirtType?: string | null;
  shirtNumber?: string | null;
};

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

// Type ส่วนตารางงานแบบย่อสำหรับ API list users
export interface UserListSchedule {
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  shift_name: string;
}

// Type ส่วน Response item ของ API list users
export interface UserListItem {
  worker_code: string | null;
  shirt_number: string | null;
  full_name: string;
  work_schedule: UserListSchedule | null;
  status: AccountStatus;
  updated_at: string;
}

// Type ส่วน Response ของ API user detail
interface UserDetailInfo {
  phone: string | null;
  position: string | null;
  shirt_number: string | null;
  shirt_type: string | null;
  work_date: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  shift_name: string | null;
}

// Type ส่วน Response ของ API user detail
export interface UserDetailResponse {
  image_url: string | null;
  worker_code: string | null;
  full_name: string;
  status: AccountStatus;
  details: UserDetailInfo;
}

// Type ส่วน column status สำหรับบอร์ดติดตาม worker ใน Admin Jobs
export type AdminWorkerBoardStatus =
  | "open_app"
  | "ready"
  | "assigned"
  | "working"
  | "break";

// Type ส่วน response สถานะ worker สำหรับ Admin Jobs board
export type AdminWorkerStatusItem = {
  full_name: string;
  worker_code: string | null;
  shirt_number: string | null;
  image_url: string | null;
  shift_name: string | null;
  latest_activity_at: string | null;
  status: AdminWorkerBoardStatus;
};
