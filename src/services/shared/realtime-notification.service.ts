import { buildWorkerNotification, persistWorkerNotifications, publishNotification } from "../notifications.service";
import * as accountRepository from "../../repositories/shared/account.repository";
import * as ticketWorkerRepository from "../../repositories/shared/ticket-worker.repository";
import { sendWorkerPushNotificationByAccountIds } from "./worker-push.service";
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

  const workerAccountIds = [...new Set(input.worker_account_ids ?? [])];
  const workerPayload = input.worker_payload ?? payload;

  if (workerAccountIds.length > 0) {
    void accountRepository.listByIds(workerAccountIds).then((accounts) => {
      const accountById = new Map(accounts.map((account) => [account.id, account]));

      persistWorkerNotifications(
        workerAccountIds.map((workerAccountId) => {
          const localized = buildWorkerNotification({
            type: input.type,
            lang: accountById.get(workerAccountId)?.lang,
            notification_key: input.notification_key,
            notification_params: input.notification_params,
            payload: workerPayload,
            fallbackTitle: input.title,
            fallbackMessage: input.message,
          });

          return {
            worker_account_id: workerAccountId,
            type: input.type,
            notification_key: localized.key,
            lang: localized.lang,
            title: localized.title,
            message: localized.message,
            payload: workerPayload,
          };
        }),
      );
    }).catch((error) => {
      logger.error("Failed to localize worker notifications.", { error });
    });

    void sendWorkerPushNotificationByAccountIds({
      account_ids: workerAccountIds,
      type: input.type,
      title: input.title,
      message: input.message,
      notification_key: input.notification_key,
      notification_params: input.notification_params,
      payload: workerPayload,
    }).catch((error) => {
      logger.error("Failed to send worker push notification.", { error });
    });
  }

  for (const workerAccountId of workerAccountIds) {
    sendWorkerSocketEvent(
      workerAccountId,
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

export async function resolveTicketResultAudience(
  ticket: GateTicketDto,
  connection?: DbConnection
): Promise<number[]> {
  const [ticketWorkers, admins] = await Promise.all([
    // Roster เป็นระดับ Business Ticket (market job) ไม่ใช่ระดับ Booth แล้ว
    ticketWorkerRepository.listTicketWorkers(ticket.market_job_id, connection),
    accountRepository.listAdmins(connection),
  ]);
  const receiverIds = new Set<number>();

  ticketWorkers.forEach((worker) => receiverIds.add(worker.worker_account_id));
  admins.forEach((admin) => receiverIds.add(admin.id));

  return Array.from(receiverIds);
}
