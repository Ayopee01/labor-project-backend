// Import Library
import type { Response } from "express";
import * as workerNotificationRepository from "../repositories/shared/worker-notification.repository";
import { toPascalCasePayload } from "../middlewares/api-case.middleware";
import { buildWorkerQueueSocketPayload } from "../utils/worker-payload";
import { parseWithSchema } from "../validation/parser";
import { paginationQuerySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";
import { logger } from "../utils/logger";
import { buildLocalizedNotification } from "../utils/notification-localization";
// Import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { NotificationAudience, NotificationClient, RealtimeNotificationEvent, WorkerNotificationListResponse, WorkerStatusChangedInput } from "../types/notifications.type";
import type { VehicleJobAssignmentDto, WorkerQueueEntryDto } from "../types/worker.type";

/* -------------------------------------- Config -------------------------------------- */

const clients = new Map<number, NotificationClient>();
let clientSequence = 1;

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจว่า receive event ใน service flow
function canReceiveEvent(
  auth: AccessTokenPayload,
  audience?: NotificationAudience
): boolean {
  if (!audience) {
    return true;
  }

  if (audience.account_ids?.includes(auth.account_id)) {
    return true;
  }

  if (audience.roles?.includes(auth.role)) {
    return true;
  }

  return false;
}

// Function บันทึก SSE event ใน service flow — ห่อด้วย try/catch เพราะ response อาจถูก destroy ไป
// แล้ว (client หลุดกะทันหันแบบ ECONNRESET ก่อน "close" event ทัน) เขียนซ้ำเข้า stream ที่ตายแล้ว
// จะ throw แบบ synchronous ได้ ถ้าไม่ครอบไว้จะทำให้ publishNotification ที่วน loop client อื่นๆ
// หยุดกลางคันไปด้วย
function writeSseEvent(
  response: Response,
  eventName: string,
  data: unknown
): void {
  try {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(toPascalCasePayload(data))}\n\n`);
  } catch (error) {
    logger.error("Failed to write SSE event.", { error });
  }
}

// Function เลิก subscribe และเคลียร์ client ตัวหนึ่งออกจาก in-memory list ใน service flow — ใช้ร่วม
// กันทั้ง "close" (client ปิด connection แบบสุภาพ) และ "error" (connection หลุดกะทันหัน เช่น
// ECONNRESET) เพื่อไม่ให้ heartbeat interval/reference ของ client ที่ตายไปแล้วค้างอยู่ในระบบ
function removeSseClient(clientId: number): void {
  const client = clients.get(clientId);

  if (client) {
    clearInterval(client.heartbeat);
    clients.delete(clientId);
  }
}

// Function จัดการ subscribe admin events ใน service flow
export function subscribeAdminEvents(
  response: Response,
  auth: AccessTokenPayload
): void {
  const clientId = clientSequence;
  clientSequence += 1;

  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();

  writeSseEvent(response, "connected", {
    message: "Notification stream connected.",
    connected_at: new Date().toISOString(),
  });

  const heartbeat = setInterval(() => {
    try {
      response.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    } catch (error) {
      logger.error("Failed to write SSE heartbeat.", { error });
    }
  }, 25000);

  clients.set(clientId, {
    id: clientId,
    auth,
    response,
    heartbeat,
  });

  // "close" = client ปิด connection ปกติ, "error" = connection หลุดกะทันหัน (เช่น ECONNRESET) ก่อน
  // "close" event ทัน — ถ้าไม่ดัก error ไว้ Node จะ throw error ที่ไม่มี listener แบบ uncaught เมื่อ
  // เขียนซ้ำเข้า stream ที่หลุดไปแล้ว (เช่นจาก heartbeat/publishNotification รอบถัดไป) จนกระทบ process
  // ทั้งตัว ทั้งที่เป็นแค่ client SSE หนึ่งตัวหลุดเน็ต
  response.req.on("close", () => removeSseClient(clientId));
  response.req.on("error", () => removeSseClient(clientId));
  response.on("error", () => removeSseClient(clientId));
}

// Function กระจาย event notification ใน service flow
export function publishNotification(event: RealtimeNotificationEvent): void {
  const payload = {
    type: event.type,
    title: event.title,
    message: event.message,
    payload: event.payload ?? null,
    occurred_at: new Date().toISOString(),
  };

  for (const client of clients.values()) {
    if (!canReceiveEvent(client.auth, event.audience)) {
      continue;
    }

    writeSseEvent(client.response, event.type, payload);
  }
}

export function persistWorkerNotification(input: {
  worker_id: number;
  type: string;
  notification_key?: string | null;
  lang?: string | null;
  title: string;
  message: string;
  payload?: unknown;
}): void {
  void workerNotificationRepository.createWorkerNotification(input).catch((error) => {
    logger.error("Failed to persist worker notification.", { error });
  });
}

export function persistWorkerNotifications(inputs: Array<{
  worker_id: number;
  type: string;
  notification_key?: string | null;
  lang?: string | null;
  title: string;
  message: string;
  payload?: unknown;
}>): void {
  void workerNotificationRepository.createWorkerNotifications(inputs).catch((error) => {
    logger.error("Failed to persist worker notifications.", { error });
  });
}

export async function listWorkerNotifications(
  query: unknown,
  auth?: AccessTokenPayload
): Promise<WorkerNotificationListResponse> {
  if (!auth || !auth.account_id || auth.role !== "worker") {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const { page, limit } = parseWithSchema(paginationQuerySchema, query);
  const result = await workerNotificationRepository.listWorkerNotifications(
    auth.account_id,
    page,
    limit,
  );

  return {
    data: result.items.map((item) => ({
      id: item.id,
      type: item.type,
      notification_key: item.notification_key,
      lang: item.lang,
      title: item.title,
      message: item.message,
      notification: {
        key: item.notification_key,
        lang: item.lang,
        title: item.title,
        message: item.message,
      },
      payload: item.payload,
      read_at: item.read_at,
      created_at: item.created_at,
    })),
    pagination: {
      page,
      limit,
      total: result.total,
      total_pages: Math.ceil(result.total / limit),
    },
  };
}

export function buildWorkerNotification(input: {
  type: string;
  lang?: string | null;
  notification_key?: string | null;
  notification_params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  fallbackTitle: string;
  fallbackMessage: string;
}) {
  return buildLocalizedNotification({
    type: input.type,
    lang: input.lang,
    key: input.notification_key,
    params: input.notification_params ?? input.payload,
    fallbackTitle: input.fallbackTitle,
    fallbackMessage: input.fallbackMessage,
  });
}

// Function สร้าง worker status changed payload ใน service flow
function buildWorkerStatusChangedPayload(input: {
  workerCode: string | null;
  queue: WorkerQueueEntryDto | null | undefined;
  reason: string;
  assignment?: VehicleJobAssignmentDto | null;
  extraPayload?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    worker_code: input.workerCode,
    queue: buildWorkerQueueSocketPayload(
      input.queue,
      input.workerCode,
      input.assignment ?? null
    ),
    reason: input.reason,
    ...(input.extraPayload ?? {}),
  };
}

// Function กระจาย event admin worker status changed ใน service flow
export function publishAdminWorkerStatusChanged(
  input: WorkerStatusChangedInput
): void {
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: input.title,
    message: input.message,
    payload: buildWorkerStatusChangedPayload(input),
    audience: {
      roles: ["admin"],
    },
  });
}
