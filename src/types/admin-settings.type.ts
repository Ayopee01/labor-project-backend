import type { AdminPermission } from "../config/permission.config";
import type { RuntimeSettings } from "../config/runtime.config";
import type { AccountStatus } from "./admin-workers.type";

// Type DTO ของ system setting จาก DB
export interface SystemSettingDto {
  key: string;
  value: string;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

// Type response ของ runtime settings ที่แปลงเป็นค่าพร้อมใช้งานแล้ว
export type RuntimeSettingsResponse = RuntimeSettings;

// Type response รายละเอียดสิทธิ์ของ admin account
export interface AccountPermissionsResponse {
  account_id: number;
  role: string;
  status: AccountStatus;
  permission_level: string | null;
  permissions: AdminPermission[];
}

export interface AdminRoleAccountSummary {
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

export interface AdminRoleListItem {
  key: string;
  name: string;
  order: number;
  admins: AdminRoleAccountSummary[];
}

export interface AdminRoleListResponse {
  data: AdminRoleListItem[];
}
