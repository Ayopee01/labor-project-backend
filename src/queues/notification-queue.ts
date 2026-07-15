// import Library
import { Queue, Worker, type Job } from "bullmq";
// import Config
import { REDIS_CONFIG } from "../config/redis.config";
// import Repository
import * as lineRepository from "../repositories/line.repository";
// import Types
import type { LineMessageJobData } from "../types/line.type";

/* -------------------------------------- Config -------------------------------------- */

// Config แปลง REDIS_URL เป็น connection object สำหรับ BullMQ
const redisUrl = new URL(REDIS_CONFIG.url);

// Config connection object สำหรับ BullMQ queue/worker
const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.replace("/", "") || 0) : 0,
  maxRetriesPerRequest: null,
};

// Config queue สำหรับส่ง LINE message แบบ background
const lineMessageQueue = new Queue(REDIS_CONFIG.lineMessageQueueName, {
  connection: bullConnection,
});

// State เก็บ BullMQ worker เพื่อไม่ให้ start ซ้ำ
let lineWorker: Worker | null = null;

/* -------------------------------------- Functions -------------------------------------- */

// Function ส่ง LINE push message ถ้ามี token จริง ถ้าไม่มีจะถือว่าเป็น mock delivery
async function sendLinePushMessage(data: LineMessageJobData): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    return;
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

// Function ใส่ job ส่งข้อความ LINE ให้ vendor
export async function enqueueLineMessage(
  jobName: string,
  data: LineMessageJobData
): Promise<void> {
  await lineMessageQueue.add(jobName, data, {
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

// Function เริ่ม worker สำหรับส่ง LINE
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
