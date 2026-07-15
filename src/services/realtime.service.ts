import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import { publishNotification } from "./notifications.service";

import type { PublishRealtimeEventInput } from "../types/notifications.type";
import type { WorkerSocketEventType } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ส่ง realtime event ไปยัง Admin ผ่าน SSE และ Worker ผ่าน WebSocket ตามกลุ่มผู้รับ
export function publishRealtimeEvent(input: PublishRealtimeEventInput): void {
  const payload = input.payload ?? {};

  if (input.admin) {
    publishNotification({
      type: input.type,
      title: input.title,
      message: input.message,
      payload,
      audience: {
        roles: ["admin"],
      },
    });
  }

  const workerAccountIds = [...new Set(input.worker_account_ids ?? [])];
  const workerPayload = input.worker_payload ?? payload;

  for (const workerAccountId of workerAccountIds) {
    sendWorkerSocketEvent(
      workerAccountId,
      input.type as WorkerSocketEventType,
      workerPayload
    );
  }
}
