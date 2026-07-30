import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { accountRepository } from "../repositories/auth.repository";
import * as profileRepository from "../repositories/shared/profile.repository";
import * as workerPushTokenRepository from "../repositories/worker-push-token.repository";
import type { AccessTokenPayload, SessionDto } from "../types/auth.type";
import type { DbConnection } from "../types/common.type";
import type { WorkerPushEventInput, WorkerPushRegistrationResponse } from "../types/push-notification.type";
import { parseWithSchema } from "../validation/parser";
import { workerPushTokenBodySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";

/* -------------------------------------- Config -------------------------------------- */

// Config Firebase multicast batch limit per Admin SDK request.
const FCM_MULTICAST_LIMIT = 500;

// Config Firebase errors that mean the stored token should be revoked.
const INVALID_FCM_ERROR_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/* -------------------------------------- State -------------------------------------- */

// State caches Firebase env readiness so every notification does not re-check env parsing.
let firebaseConfigured: boolean | null = null;

/* -------------------------------------- Functions -------------------------------------- */

// Function normalizes multiline private key values stored in .env.
function getFirebasePrivateKey(): string | undefined {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

// Function checks whether Firebase Admin SDK can be initialized in this environment.
function isFirebaseConfigured(): boolean {
  if (firebaseConfigured !== null) {
    return firebaseConfigured;
  }

  firebaseConfigured = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      getFirebasePrivateKey()
  );

  return firebaseConfigured;
}

// Function initializes Firebase Admin SDK lazily before sending the first push.
function ensureFirebaseApp(): boolean {
  if (!isFirebaseConfigured()) {
    return false;
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: getFirebasePrivateKey(),
      }),
    });
  }

  return true;
}

// Function converts WebSocket-style payload objects to string-only FCM data payloads.
function toFcmData(payload?: Record<string, unknown>): Record<string, string> {
  const data: Record<string, string> = {};

  for (const [key, value] of Object.entries(payload ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }

    data[key] = typeof value === "string" ? value : JSON.stringify(value);
  }

  return data;
}

// Function splits token arrays into Firebase-compatible multicast chunks.
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

// Function narrows auth payload to an active Worker token shape for push token registration.
function isWorkerAuth(auth?: AccessTokenPayload): auth is AccessTokenPayload {
  return Boolean(auth && auth.role === "worker" && auth.account_id && auth.session_id);
}

// Function registers or refreshes an FCM token from the authenticated Worker Mobile API.
export async function registerWorkerPushToken(
  auth: AccessTokenPayload | undefined,
  session: SessionDto | undefined,
  body: unknown
): Promise<WorkerPushRegistrationResponse> {
  if (!isWorkerAuth(auth) || !session || session.account_id !== auth.account_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const input = parseWithSchema(workerPushTokenBodySchema, body);
  const deviceId = input.device_id ?? session.device_id;
  const account = await accountRepository.findById(auth.account_id);

  if (!account || account.role !== "worker" || account.status !== "active") {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const token = await workerPushTokenRepository.upsertWorkerPushToken({
    worker_code: account.username,
    session_id: auth.session_id,
    device_id: deviceId,
    platform: input.platform,
    fcm_token: input.fcm_token,
  });

  return {
    statusCode: 200,
    code: "WORKER_PUSH_TOKEN_REGISTERED",
    message: "Worker push token registered successfully.",
    worker_code: token.worker_code,
    device_id: token.device_id,
    platform: token.platform,
  };
}

// Function registers an FCM token during auth login/force-login when Mobile sends one.
export async function registerWorkerPushTokenForAccount(input: {
  worker_code: string;
  session_id: number;
  device_id: string;
  platform?: string | null;
  fcm_token?: string | null;
}, connection?: DbConnection): Promise<void> {
  if (!input.fcm_token) {
    return;
  }

  await workerPushTokenRepository.upsertWorkerPushToken({
    worker_code: input.worker_code,
    session_id: input.session_id,
    device_id: input.device_id,
    platform: input.platform,
    fcm_token: input.fcm_token,
  }, connection);
}

// Function revokes all active push tokens tied to a session when the session is revoked.
export async function revokeWorkerPushTokensBySession(
  sessionId: number,
  connection?: DbConnection
): Promise<void> {
  await workerPushTokenRepository.revokeBySessionId(sessionId, connection);
}

// Function sends FCM push notifications by WorkerCode and revokes invalid stored tokens.
export async function sendWorkerPushNotification(
  input: WorkerPushEventInput
): Promise<void> {
  if (!ensureFirebaseApp()) {
    return;
  }

  const tokens = await workerPushTokenRepository.listActiveTokensByWorkerCodes(
    input.worker_codes
  );

  if (tokens.length === 0) {
    return;
  }

  const payload = {
    ...(input.payload ?? {}),
    type: input.type,
  };
  const data = toFcmData(payload);
  const invalidTokenHashes: string[] = [];

  for (const tokenChunk of chunk(tokens, FCM_MULTICAST_LIMIT)) {
    const response = await getMessaging().sendEachForMulticast({
      tokens: tokenChunk.map((token) => token.fcm_token),
      notification: {
        title: input.title,
        body: input.message,
      },
      data,
    });

    response.responses.forEach((sendResponse, index) => {
      const errorCode = sendResponse.error?.code;

      if (errorCode && INVALID_FCM_ERROR_CODES.has(errorCode)) {
        invalidTokenHashes.push(tokenChunk[index]?.fcm_token_hash ?? "");
      }
    });
  }

  await workerPushTokenRepository.revokeByTokenHashes(invalidTokenHashes);
}

// Function bridges internal account ids to WorkerCode before sending mobile push notifications.
export async function sendWorkerPushNotificationByAccountIds(input: {
  account_ids: number[];
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const profiles = await profileRepository.findByAccountIds(input.account_ids);
  const workerCodes = profiles
    .map((profile) => profile.worker_code)
    .filter((workerCode): workerCode is string => Boolean(workerCode));

  await sendWorkerPushNotification({
    worker_codes: workerCodes,
    type: input.type,
    title: input.title,
    message: input.message,
    payload: input.payload,
  });
}
