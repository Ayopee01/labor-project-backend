import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import * as masterWorkerRepository from "../../repositories/shared/master-worker.repository";
import * as workerPushTokenRepository from "../../repositories/shared/worker-push-token.repository";
import { buildLocalizedNotification } from "../../utils/notification-localization";
import type { AccessTokenPayload, SessionDto } from "../../types/auth.type";
import type { DbConnection } from "../../types/shared/common.type";
import type { WorkerPushEventInput, WorkerPushTokenDto, WorkerPushRegistrationResponse } from "../../types/notifications.type";
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
  const worker = await masterWorkerRepository.findById(auth.account_id);

  if (!worker || worker.status !== 1) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const token = await workerPushTokenRepository.upsertWorkerPushToken({
    worker_id: worker.id,
    worker_code: worker.labor_code,
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
    worker_id: number;
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
      worker_id: input.worker_id,
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

  await sendWorkerPushNotificationToTokens(tokens, input);
}

async function sendWorkerPushNotificationToTokens(
  tokens: WorkerPushTokenDto[],
  input: WorkerPushEventInput,
): Promise<void> {
  if (!ensureFirebaseApp() || tokens.length === 0) {
    return;
  }

  const notification = {
    key: input.notification_key ?? input.type,
    lang: input.lang ?? null,
    title: input.title,
    message: input.message,
  };
  const payload = {
    ...(input.payload ?? {}),
    type: input.type,
    notification,
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

// Function แปลง worker id ภายในเป็น WorkerCode ก่อนส่ง push notification ไป Mobile
export async function sendWorkerPushNotificationByWorkerIds(input: {
  worker_ids: number[];
  type: string;
  title: string;
  message: string;
  notification_key?: string | null;
  notification_params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const workers = await masterWorkerRepository.findByIds(input.worker_ids);
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));

  for (const workerId of [...new Set(input.worker_ids)]) {
    const worker = workerById.get(workerId);

    if (!worker) {
      continue;
    }

    const localized = buildLocalizedNotification({
      type: input.type,
      lang: worker.lang,
      key: input.notification_key,
      params: input.notification_params ?? input.payload,
      fallbackTitle: input.title,
      fallbackMessage: input.message,
    });

    await sendWorkerPushNotification({
      worker_codes: [worker.labor_code],
      type: input.type,
      title: localized.title,
      message: localized.message,
      notification_key: localized.key,
      lang: localized.lang,
      payload: input.payload,
    });
  }
}

// Function ส่ง FCM push ให้ Worker ที่ active token ทุกคน แบบ localized ตามภาษาที่แต่ละคนตั้งไว้
// (ใช้ notification-localization mechanism เดิมของ project) — group token ตาม lang ก่อนแล้วยิง
// multicast ทีละกลุ่ม (ไม่ query/ยิงทีละ account เหมือน sendWorkerPushNotificationByAccountIds
// เพราะผู้รับเป็นทุกคน ไม่ใช่ account_ids ที่ระบุมา จึงต้อง batch ตาม lang แทนเพื่อเลี่ยง N+1)
export async function sendWorkerPushNotificationToAllActive(input: {
  type: string;
  notification_key?: string | null;
  notification_params?: Record<string, unknown>;
  fallbackTitle: string;
  fallbackMessage: string;
  // ข้อความเพิ่มเติมที่ Admin กำหนดเอง (เช่น ReleaseMessage ของ Mobile App Version) ต่อท้าย
  // localized message เสมอ ไม่ผ่าน localization เพราะเป็น free text ที่ Admin พิมพ์เอง
  appendMessage?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const tokens = await workerPushTokenRepository.listAllActiveTokens();

  if (tokens.length === 0) {
    return;
  }

  const workerCodes = [...new Set(tokens.map((token) => token.worker_code))];
  const workers = await masterWorkerRepository.listActiveByLaborCodes(workerCodes);
  const langByWorkerCode = new Map(workers.map((worker) => [worker.labor_code, worker.lang]));

  const tokensByLang = new Map<string, WorkerPushTokenDto[]>();

  for (const token of tokens) {
    const lang = langByWorkerCode.get(token.worker_code) ?? undefined;
    const bucketKey = lang ?? "";
    const bucket = tokensByLang.get(bucketKey) ?? [];

    bucket.push(token);
    tokensByLang.set(bucketKey, bucket);
  }

  for (const [lang, langTokens] of tokensByLang) {
    const localized = buildLocalizedNotification({
      type: input.type,
      lang: lang || undefined,
      key: input.notification_key,
      params: input.notification_params,
      fallbackTitle: input.fallbackTitle,
      fallbackMessage: input.fallbackMessage,
    });

    await sendWorkerPushNotificationToTokens(langTokens, {
      worker_codes: [],
      type: input.type,
      title: localized.title,
      message: input.appendMessage
        ? `${localized.message} ${input.appendMessage}`
        : localized.message,
      notification_key: localized.key,
      lang: localized.lang,
      payload: input.payload,
    });
  }
}

export async function sendWorkerPushNotificationToSession(input: {
  session_id: number;
  type: string;
  title: string;
  message: string;
  notification_key?: string | null;
  notification_params?: Record<string, unknown>;
  lang?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const tokens = await workerPushTokenRepository.listActiveTokensBySessionId(
    input.session_id,
  );
  const localized = buildLocalizedNotification({
    type: input.type,
    lang: input.lang,
    key: input.notification_key,
    params: input.notification_params ?? input.payload,
    fallbackTitle: input.title,
    fallbackMessage: input.message,
  });

  await sendWorkerPushNotificationToTokens(tokens, {
    worker_codes: [],
    type: input.type,
    title: localized.title,
    message: localized.message,
    notification_key: localized.key,
    lang: localized.lang,
    payload: input.payload,
  });
}
