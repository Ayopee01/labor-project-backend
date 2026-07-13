import type { AccountRole, AccountStatus, ProfileDto, WorkScheduleWithShiftDto } from "./admin-workers.type";
import type { AdminPermission } from "../config/permission.config";

// Type ส่วน Token: ชนิดของ JWT ที่ระบบ auth รองรับ
export type TokenType = "access" | "refresh" | "login_challenge";

// Type ส่วน Payload ของ access token
export interface AccessTokenPayload {
  account_id: number;
  role: AccountRole;
  permission_level?: string | null;
  permissions?: AdminPermission[];
  session_id: number;
  token_type: "access";
  iat?: number;
  exp?: number;
}

// Type ส่วน Payload ของ refresh token
export interface RefreshTokenPayload {
  account_id: number;
  session_id: number;
  token_type: "refresh";
  iat?: number;
  exp?: number;
}

// Type ส่วน Payload ของ token ยืนยัน force login
export interface LoginChallengeTokenPayload {
  account_id: number;
  role: AccountRole;
  old_session_id: number;
  new_device_id: string;
  token_type: "login_challenge";
  iat?: number;
  exp?: number;
}

// Type ส่วน Mapping ของ token type กับ payload ที่ต้องได้
export type TokenPayloadByType = {
  access: AccessTokenPayload;
  refresh: RefreshTokenPayload;
  login_challenge: LoginChallengeTokenPayload;
};

// Type ส่วน DTO ของ table user_sessions
export interface SessionDto {
  id: number;
  account_id: number;
  refresh_token_hash: string;
  device_id: string;
  device_name: string;
  ip_address: string | null;
  user_agent: string | null;
  is_active: boolean;
  last_active_at: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน Repository input สำหรับสร้าง session
export interface PendingSessionInput {
  account_id: number;
  device_id: string;
  device_name: string;
  ip_address?: string | null;
  user_agent?: string | null;
  expires_at: string | Date;
}

// Type ส่วน Response ภายใน service สำหรับ token ที่สร้างแล้ว
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ProfileCardShift {
  name: string;
  start_time: string;
  end_time: string;
}

export interface AdminProfileCard {
  role: "admin";
  full_name: string;
  position: string | null;
  employee_code: string;
  admin_code: string;
  status: AccountStatus;
  email: string | null;
  phone: string | null;
  permission_level: string | null;
  permissions: AdminPermission[];
  latest_active_at: string | null;
}

export interface WorkerProfileCard {
  role: "worker";
  full_name: string;
  employee_code: string | null;
  worker_code: string | null;
  nationality: string | null;
  nationality_code: string | null;
  nationality_name: string | null;
  work_start_date: string | null;
  phone: string | null;
  shift: ProfileCardShift | null;
}

export type AuthProfileCard = AdminProfileCard | WorkerProfileCard;

export interface AdminMeResponse {
  full_name: string;
  position: string | null;
  admin_code: string;
  status: AccountStatus;
  email: string | null;
  phone: string | null;
  permission_level: string | null;
  permissions: AdminPermission[];
  latest_active_at: string | null;
}

export interface WorkerMeResponse {
  full_name: string;
  worker_code: string | null;
  nationality: string | null;
  work_start_date: string | null;
  phone: string | null;
  shift: ProfileCardShift | null;
}

export type MeResponse = AdminMeResponse | WorkerMeResponse;

export interface AdminLoginAccountResponse {
  full_name: string;
  status: AccountStatus;
  position: string | null;
  email: string | null;
  phone: string | null;
  image_url: string | null;
  permission_level: string | null;
  permissions: AdminPermission[];
  latest_active_at: string | null;
}

export interface WorkerLoginAccountResponse {
  full_name: string;
  worker_code: string | null;
  image_url: string | null;
  status: AccountStatus;
  shift: ProfileCardShift | null;
  server_time: string;
}

export type AuthAccountResponse =
  | AdminLoginAccountResponse
  | WorkerLoginAccountResponse;

// Type ส่วน Response ของข้อมูล account ที่ auth ส่งกลับ
export interface AccountResponse {
  account: AuthAccountResponse;
  profile?: ProfileDto | null;
  current_work_schedule?: WorkScheduleWithShiftDto | null;
  permissions?: AdminPermission[];
  latest_active_at?: string | null;
  profile_card?: AuthProfileCard;
}

// Type ส่วน Response ของ API auth login / confirm-force-login
export interface AuthSuccessResponse extends AccountResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

// Type ส่วน Config สำหรับ signing token
export interface TokenSignOptions {
  expiresIn?: string | number;
}

// Type ส่วน Config ของ token แต่ละประเภท
export interface TokenConfig {
  secret?: string;
  expiresIn: string | number;
  invalidCode: string;
  expiredCode: string;
}
