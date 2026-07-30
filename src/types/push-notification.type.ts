// Type value of the client platform that owns an FCM token.
export type PushPlatform = "android" | "ios" | "web" | "unknown";

// Type DTO of table worker_push_tokens used for mobile push notification delivery.
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

// Type repository input for registering or refreshing a worker FCM token.
export interface UpsertWorkerPushTokenInput {
  worker_code: string;
  session_id?: number | null;
  device_id: string;
  platform?: string | null;
  fcm_token: string;
}

// Type response after Worker Mobile registers a push token.
export interface WorkerPushRegistrationResponse {
  statusCode: number;
  code: string;
  message: string;
  worker_code: string;
  device_id: string;
  platform: PushPlatform;
}

// Type input for sending one push notification event to one or more WorkerCodes.
export interface WorkerPushEventInput {
  worker_codes: string[];
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}
