import type { AdminPermission } from "../config/permission.config";
import type { RuntimeSettings } from "../config/runtime.config";
import type { AccountStatus } from "./admin-workers.type";

export interface SystemSettingDto {
  key: string;
  value: string;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export type RuntimeSettingsResponse = RuntimeSettings;

export interface AccountPermissionsResponse {
  account_id: number;
  role: string;
  status: AccountStatus;
  permission_level: string | null;
  permissions: AdminPermission[];
}

interface AdminRoleAccountSummary {
  id: number;
  username: string;
  full_name: string;
  position: string | null;
  status: AccountStatus;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminRoleListItem {
  key: string;
  name: string;
  order: number;
  admins: AdminRoleAccountSummary[];
}

export interface AdminRoleListResponse {
  data: AdminRoleListItem[];
}

// Config สถานะ credential ของ Gate client ที่จัดการจาก Admin Settings
export const GATE_CLIENT_STATUSES = ["active", "inactive"] as const;

// Type ค่า status ของ Gate client
type GateClientStatus = (typeof GATE_CLIENT_STATUSES)[number];

// Type DTO ของตาราง gate_clients รวม secret hash สำหรับตรวจสอบฝั่ง server
export interface GateClientDto {
  id: number;
  client_id: string;
  name: string;
  secret_hash: string;
  status: GateClientStatus;
  last_used_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

// Type DTO ของ Gate client ฝั่ง public ที่ไม่เปิดเผย secret_hash
export type PublicGateClient = Omit<GateClientDto, "secret_hash">;

// Type response รายการ Gate client ใน Admin Settings
export interface GateClientListResponse {
  data: PublicGateClient[];
}

// Type response หลังอัปเดต metadata ที่แสดงได้ของ Gate client
export interface GateClientMutationResponse extends PublicGateClient {
  message: string;
}

// Type response หลังสร้างหรือ rotate secret ของ Gate client
export interface GateClientSecretResponse extends GateClientMutationResponse {
  client_secret: string;
}

// Type input ของ repository สำหรับสร้าง credential ของ Gate client
export interface GateClientCreateInput {
  client_id: string;
  name: string;
  secret_hash: string;
  status?: GateClientStatus;
  created_by?: number | null;
  updated_by?: number | null;
}

// Type input ของ repository สำหรับอัปเดต metadata ของ Gate client โดยไม่เปลี่ยน secret
export interface GateClientUpdateInput {
  name?: string;
  status?: GateClientStatus;
  updated_by?: number | null;
}
