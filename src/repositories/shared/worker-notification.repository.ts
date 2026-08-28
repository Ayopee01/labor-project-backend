import { Prisma } from "@prisma/client";

import { client } from "./repository-utils";

import type { CreateWorkerNotificationInput, WorkerNotificationDto } from "../../types/notifications.type";
import type { DbConnection } from "../../types/shared/common.type";

function toIsoString(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function mapWorkerNotification(record: {
  id: number;
  workerAccountId: number;
  type: string;
  notificationKey: string | null;
  lang: string;
  title: string;
  message: string;
  payload: Prisma.JsonValue | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): WorkerNotificationDto {
  return {
    id: record.id,
    worker_account_id: record.workerAccountId,
    type: record.type,
    notification_key: record.notificationKey,
    lang: record.lang,
    title: record.title,
    message: record.message,
    payload: record.payload,
    read_at: toIsoString(record.readAt),
    created_at: toIsoString(record.createdAt) ?? "",
    updated_at: toIsoString(record.updatedAt) ?? "",
  };
}

function toJsonValue(
  payload: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (payload === undefined) {
    return undefined;
  }

  if (payload === null) {
    return Prisma.JsonNull;
  }

  return payload as Prisma.InputJsonValue;
}

export async function createWorkerNotification(
  input: CreateWorkerNotificationInput,
  connection?: DbConnection,
): Promise<WorkerNotificationDto> {
  const record = await client(connection).workerNotification.create({
    data: {
      workerAccountId: input.worker_account_id,
      type: input.type,
      notificationKey: input.notification_key ?? null,
      lang: input.lang ?? "TH",
      title: input.title,
      message: input.message,
      payload: toJsonValue(input.payload),
    },
  });

  return mapWorkerNotification(record);
}

export async function createWorkerNotifications(
  inputs: CreateWorkerNotificationInput[],
  connection?: DbConnection,
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }

  await client(connection).workerNotification.createMany({
    data: inputs.map((input) => ({
        workerAccountId: input.worker_account_id,
        type: input.type,
        notificationKey: input.notification_key ?? null,
        lang: input.lang ?? "TH",
        title: input.title,
      message: input.message,
      payload: toJsonValue(input.payload),
    })),
  });
}

export async function listWorkerNotifications(
  workerAccountId: number,
  page: number,
  limit: number,
  connection?: DbConnection,
): Promise<{ items: WorkerNotificationDto[]; total: number }> {
  const db = client(connection);
  const where = {
    workerAccountId,
  };
  const [total, items] = await Promise.all([
    db.workerNotification.count({ where }),
    db.workerNotification.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    total,
    items: items.map(mapWorkerNotification),
  };
}
