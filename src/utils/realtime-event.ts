import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import { publishNotification } from "../services/notifications.service";
import { sendWorkerPushNotificationByAccountIds } from "../utils/worker-push";

import type { PublishRealtimeEventInput } from "../types/notifications.type";
import type { WorkerSocketEventType } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function กระจาย event realtime event สำหรับ helper กลาง
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

  if (workerAccountIds.length > 0) {
    void sendWorkerPushNotificationByAccountIds({
      account_ids: workerAccountIds,
      type: input.type,
      title: input.title,
      message: input.message,
      payload: workerPayload,
    }).catch((error) => {
      console.error("Failed to send worker push notification.", error);
    });
  }

  for (const workerAccountId of workerAccountIds) {
    sendWorkerSocketEvent(
      workerAccountId,
      input.type as WorkerSocketEventType,
      workerPayload,
      {
        push: false,
      }
    );
  }
}
