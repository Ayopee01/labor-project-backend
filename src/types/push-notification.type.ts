export type PushPlatform = "android" | "ios" | "web" | "unknown";

export interface WorkerPushTokenDto {
  id: number;
  worker_code: string;
  session_id: number | null;
  device_id: string;
  platform: PushPlatform;
  fcm_token: string;
  fcm_token_hash: string;
  is_active: boolean;
  last_seen_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertWorkerPushTokenInput {
  worker_code: string;
  session_id?: number | null;
  device_id: string;
  platform?: string | null;
  fcm_token: string;
}

export interface WorkerPushRegistrationResponse {
  statusCode: number;
  code: string;
  message: string;
  worker_code: string;
  device_id: string;
  platform: PushPlatform;
}

export interface WorkerPushEventInput {
  worker_codes: string[];
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}
