import type { AccountRole, ProfileDto, SafeAccountDto, WorkScheduleWithShiftDto } from "./admin-workers.type";
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

// Type ส่วน Response ของข้อมูล account ที่ auth ส่งกลับ
export interface AccountResponse {
  account: SafeAccountDto;
  profile: ProfileDto | null;
  current_work_schedule: WorkScheduleWithShiftDto | null;
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
