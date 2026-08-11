import type { RuntimeSettings } from "../config/runtime.config";
import type { AccountStatus } from "./admin-workers.type";
import type {
  GateClientCreateInput,
  GateClientDto,
  GateClientUpdateInput,
  PublicGateClient,
} from "./shared/gate-client.type";
import type { AccountPermissionsResponse } from "./shared/account-permission.type";

export interface SystemSettingDto {
  key: string;
  value: string;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export type RuntimeSettingsResponse = RuntimeSettings;

export type { AccountPermissionsResponse };

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

export type {
  GateClientCreateInput,
  GateClientDto,
  GateClientUpdateInput,
  PublicGateClient,
};

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
