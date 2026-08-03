// Import Library
import { Queue, Worker, type Job } from "bullmq";
import type { Prisma } from "@prisma/client";
// Import Config
import { REDIS_CONFIG } from "../config/redis.config";
// Import Repositories
import * as lineRepository from "../repositories/line.repository";
// Import Types
import type { LineMessage, LineMessageJobData } from "../types/line.type";

/* -------------------------------------- Config -------------------------------------- */

const redisUrl = new URL(REDIS_CONFIG.url);

const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.replace("/", "") || 0) : 0,
  maxRetriesPerRequest: null,
};

const lineMessageQueue = new Queue(REDIS_CONFIG.lineMessageQueueName, {
  connection: bullConnection,
});

let lineWorker: Worker | null = null;

/* -------------------------------------- Functions -------------------------------------- */

// Function ส่ง LINE push message ผ่าน LINE Messaging API จริง
async function sendLinePushMessage(data: LineMessageJobData): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN is required for LINE push delivery."
    );
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: data.to,
      messages: data.messages,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`LINE push failed with ${response.status}: ${responseText}`);
  }
}

// Function เพิ่มงานเข้า queue LINE message ใน Redis/BullMQ queue
export async function enqueueLineMessage(
  jobName: string,
  data: LineMessageJobData
): Promise<void> {
  await lineMessageQueue.add(jobName, data, {
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

// Function สร้าง log การส่ง LINE และนำข้อความเข้า queue
export async function enqueueLoggedLineMessage(input: {
  jobName: string;
  action: string;
  targetLineUserId: string;
  payload: unknown;
  messages: LineMessage[];
}): Promise<number> {
  const logId = await lineRepository.createMessageDeliveryLog(
    "LINE",
    input.action,
    input.payload as Prisma.InputJsonValue,
    input.targetLineUserId
  );

  await enqueueLineMessage(input.jobName, {
    log_id: logId,
    to: input.targetLineUserId,
    messages: input.messages,
  });

  return logId;
}

// Function เริ่ม notification workers ใน Redis/BullMQ queue
export function startNotificationWorkers(): void {
  if (lineWorker) {
    return;
  }

  lineWorker = new Worker(
    REDIS_CONFIG.lineMessageQueueName,
    async (job: Job<LineMessageJobData>) => {
      try {
        await sendLinePushMessage(job.data);
        await lineRepository.updateMessageDeliveryLogStatus(
          job.data.log_id,
          "SENT"
        );
      } catch (error) {
        await lineRepository.updateMessageDeliveryLogStatus(
          job.data.log_id,
          "FAILED",
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    },
    {
      connection: bullConnection,
    }
  );

  lineWorker.on("failed", (_job, error) => {
    console.error("LINE message job failed.", error);
  });
}
