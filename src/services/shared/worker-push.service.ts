import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import * as accountRepository from "../../repositories/shared/account.repository";
import * as profileRepository from "../../repositories/shared/profile.repository";
import * as workerPushTokenRepository from "../../repositories/shared/worker-push-token.repository";
import type { AccessTokenPayload, SessionDto } from "../../types/auth.type";
import type { DbConnection } from "../../types/shared/common.type";
import type {
  WorkerPushEventInput,
  WorkerPushRegistrationResponse,
} from "../../types/notifications.type";
import { parseWithSchema } from "../../validation/parser";
import { workerPushTokenBodySchema } from "../../validation/schemas";
import ApiError from "../../utils/api-error";

/* -------------------------------------- Config -------------------------------------- */

// Config จำนวน token สูงสุดต่อ batch ของ Firebase Admin SDK
const FCM_MULTICAST_LIMIT = 500;

// Config error ของ Firebase ที่หมายถึง token ใน DB ควรถูกเพิกถอน
const INVALID_FCM_ERROR_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/* -------------------------------------- State -------------------------------------- */

// State เก็บ cache ความพร้อมของ Firebase env เพื่อลดการอ่าน env ซ้ำทุก notification
let firebaseConfigured: boolean | null = null;

/* -------------------------------------- Functions -------------------------------------- */

// Function ปรับรูปแบบ private key หลายบรรทัดที่เก็บใน .env
function getFirebasePrivateKey(): string | undefined {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

// Function ตรวจสอบว่า environment นี้พร้อม init Firebase Admin SDK หรือไม่
function isFirebaseConfigured(): boolean {
  if (firebaseConfigured !== null) {
    return firebaseConfigured;
  }

  firebaseConfigured = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    getFirebasePrivateKey(),
  );

  return firebaseConfigured;
}

// Function เริ่มต้น Firebase Admin SDK แบบ lazy ก่อนส่ง push ครั้งแรก
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

// Function แปลง payload แบบ WebSocket เป็น FCM data payload ที่ทุกค่าเป็น string
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

// Function แบ่ง token array เป็น batch ที่ส่งผ่าน Firebase multicast ได้
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

// Function ตรวจ auth payload ให้เป็น token ของ Worker ที่ active ก่อนลงทะเบียน push token
function isWorkerAuth(auth?: AccessTokenPayload): auth is AccessTokenPayload {
  return Boolean(
    auth && auth.role === "worker" && auth.account_id && auth.session_id,
  );
}

// Function ลงทะเบียนหรือ refresh FCM token จาก API ของ Worker Mobile ที่ auth แล้ว
export async function registerWorkerPushToken(
  auth: AccessTokenPayload | undefined,
  session: SessionDto | undefined,
  body: unknown,
): Promise<WorkerPushRegistrationResponse> {
  if (
    !isWorkerAuth(auth) ||
    !session ||
    session.account_id !== auth.account_id
  ) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const input = parseWithSchema(workerPushTokenBodySchema, body);
  const deviceId = input.device_id ?? session.device_id;
  const account = await accountRepository.findUserById(auth.account_id);

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

// Function ลงทะเบียน FCM token ตอน auth login/force-login เมื่อ Mobile ส่ง token มา
export async function registerWorkerPushTokenForAccount(
  input: {
    worker_code: string;
    session_id: number;
    device_id: string;
    platform?: string | null;
    fcm_token?: string | null;
  },
  connection?: DbConnection,
): Promise<void> {
  if (!input.fcm_token) {
    return;
  }

  await workerPushTokenRepository.upsertWorkerPushToken(
    {
      worker_code: input.worker_code,
      session_id: input.session_id,
      device_id: input.device_id,
      platform: input.platform,
      fcm_token: input.fcm_token,
    },
    connection,
  );
}

// Function เพิกถอน push token ที่ active ทั้งหมดของ session เมื่อ session ถูกเพิกถอน
export async function revokeWorkerPushTokensBySession(
  sessionId: number,
  connection?: DbConnection,
): Promise<void> {
  await workerPushTokenRepository.revokeBySessionId(sessionId, connection);
}

// Function ส่ง FCM push notification ตาม WorkerCode และ revoke token ที่ใช้ไม่ได้
async function sendWorkerPushNotification(
  input: WorkerPushEventInput,
): Promise<void> {
  if (!ensureFirebaseApp()) {
    return;
  }

  const tokens = await workerPushTokenRepository.listActiveTokensByWorkerCodes(
    input.worker_codes,
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

// Function แปลง account id ภายในเป็น WorkerCode ก่อนส่ง push notification ไป Mobile
export async function sendWorkerPushNotificationByAccountIds(input: {
  account_ids: number[];
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const workerCodes = (
    await profileRepository.findWorkerCodesByAccountIds(input.account_ids)
  ).filter((workerCode): workerCode is string => Boolean(workerCode));

  await sendWorkerPushNotification({
    worker_codes: workerCodes,
    type: input.type,
    title: input.title,
    message: input.message,
    payload: input.payload,
  });
}
