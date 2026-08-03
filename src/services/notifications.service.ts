// Import Library
import type { Response } from "express";
import { toPascalCasePayload } from "../middlewares/api-case.middleware";
import { buildWorkerQueueSocketPayload } from "../utils/worker-queue-payload";
// Import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { NotificationAudience, NotificationClient, RealtimeNotificationEvent, WorkerStatusChangedInput } from "../types/notifications.type";
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

// Function บันทึก SSE event ใน service flow
function writeSseEvent(
  response: Response,
  eventName: string,
  data: unknown
): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(toPascalCasePayload(data))}\n\n`);
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
    response.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  }, 25000);

  clients.set(clientId, {
    id: clientId,
    auth,
    response,
    heartbeat,
  });

  response.req.on("close", () => {
    const client = clients.get(clientId);

    if (client) {
      clearInterval(client.heartbeat);
      clients.delete(clientId);
    }
  });
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
