import { buildWorkerNotification, persistWorkerNotifications, publishNotification } from "../notifications.service";
import * as masterWorkerRepository from "../../repositories/shared/master-worker.repository";
import * as ticketWorkerRepository from "../../repositories/shared/ticket-worker.repository";
import { sendWorkerPushNotificationByWorkerIds } from "./worker-push.service";
import { sendWorkerSocketEvent } from "../../websockets/worker.socket";
import { logger } from "../../utils/logger";

import type { PublishRealtimeEventInput } from "../../types/notifications.type";
import type { DbConnection } from "../../types/shared/common.type";
import type { GateTicketDto, WorkerSocketEventType } from "../../types/worker.type";

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

  const workerIds = [...new Set(input.worker_ids ?? [])];
  const workerPayload = input.worker_payload ?? payload;

  if (workerIds.length > 0) {
    void masterWorkerRepository.findByIds(workerIds).then((workers) => {
      const workerById = new Map(workers.map((worker) => [worker.id, worker]));

      persistWorkerNotifications(
        workerIds.map((workerId) => {
          const localized = buildWorkerNotification({
            type: input.type,
            lang: workerById.get(workerId)?.lang,
            notification_key: input.notification_key,
            notification_params: input.notification_params,
            payload: workerPayload,
            fallbackTitle: input.title,
            fallbackMessage: input.message,
          });

          return {
            worker_id: workerId,
            type: input.type,
            notification_key: localized.key,
            lang: localized.lang,
            title: localized.title,
            message: localized.message,
            payload: workerPayload,
          };
        }),
      );
    }).catch((error: unknown) => {
      logger.error("Failed to localize worker notifications.", { error });
    });

    void sendWorkerPushNotificationByWorkerIds({
      worker_ids: workerIds,
      type: input.type,
      title: input.title,
      message: input.message,
      notification_key: input.notification_key,
      notification_params: input.notification_params,
      payload: workerPayload,
    }).catch((error: unknown) => {
      logger.error("Failed to send worker push notification.", { error });
    });
  }

  for (const workerId of workerIds) {
    sendWorkerSocketEvent(
      workerId,
      input.type as WorkerSocketEventType,
      workerPayload,
      {
        push: false,
        notificationKey: input.notification_key,
        notificationParams: input.notification_params,
        fallbackTitle: input.title,
        fallbackMessage: input.message,
      },
    );
  }
}

// Function หา Worker ที่ต้องได้รับแจ้งเตือนผลของ Ticket — คืนเฉพาะ worker id เท่านั้น (Admin ไม่รวม
// ในนี้อีกต่อไป เพราะ MasterWorker.id และ Account.id เป็นคนละ id space กันแล้วตั้งแต่แยก Worker ออก
// จาก Account — ทุกจุดที่เรียกฟังก์ชันนี้ส่ง worker_ids ต่อให้ publishRealtimeEvent พร้อม admin: true
// อยู่แล้วเสมอ ซึ่งกระจายแจ้งเตือนไปหา Admin ทุกคนผ่าน role แยกต่างหาก ไม่ต้องพึ่ง id list นี้)
export async function resolveTicketResultAudience(
  ticket: GateTicketDto,
  connection?: DbConnection
): Promise<number[]> {
  // Roster เป็นระดับ Business Ticket (market job) ไม่ใช่ระดับ Booth แล้ว
  const ticketWorkers = await ticketWorkerRepository.listTicketWorkers(ticket.market_job_id, connection);
  const receiverIds = new Set<number>();

  ticketWorkers.forEach((worker) => receiverIds.add(worker.worker_id));

  return Array.from(receiverIds);
}
