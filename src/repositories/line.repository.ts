// import Library
import { Prisma } from "@prisma/client";

// import
import { client } from "./shared/repository-utils";

// import Types
import type { DbConnection } from "../types/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง log การส่ง message ผ่าน BullMQ
export async function createMessageDeliveryLog(
  channel: string,
  jobName: string,
  payload: Prisma.InputJsonValue,
  target?: string | null,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const log = await db.messageDeliveryLog.create({
    data: {
      channel,
      jobName,
      target: target ?? null,
      payload,
      status: "PENDING",
    },
  });

  return log.id;
}

// Function อัปเดต log การส่ง message
export async function updateMessageDeliveryLogStatus(
  id: number,
  status: string,
  error?: string | null,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);
  await db.messageDeliveryLog.update({
    where: {
      id,
    },
    data: {
      status,
      lastError: error ?? null,
      sentAt: status === "SENT" ? new Date() : undefined,
    },
  });
}
