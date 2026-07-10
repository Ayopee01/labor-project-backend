// import Library
import type { Response } from "express";
// import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { NotificationAudience, NotificationClient, RealtimeNotificationEvent } from "../types/notifications.type";

/* -------------------------------------- Config -------------------------------------- */

const clients = new Map<number, NotificationClient>();
let clientSequence = 1;

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจว่า event นี้ควรส่งให้ client คนนี้หรือไม่
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

// Function เขียน event ลง SSE stream
function writeSseEvent(
  response: Response,
  eventName: string,
  data: unknown
): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Function เปิด SSE stream สำหรับ notification ล่าสุดของระบบ
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

// Function ส่ง event สดให้ SSE clients ที่เกี่ยวข้อง โดยไม่บันทึกเป็น notification row
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
