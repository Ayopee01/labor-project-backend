import type { AdminPermission } from "../config/permission.config";
import type { RuntimeSettings } from "../config/runtime.config";

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
  permission_level: string | null;
  permissions: AdminPermission[];
}
