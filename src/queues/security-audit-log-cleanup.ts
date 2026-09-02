// Import Library
import { Queue, Worker } from "bullmq";

// Import Config
import { REDIS_CONFIG } from "../config/redis.config";
import { runSecurityAuditLogRetentionCleanup } from "../services/shared/security-audit-log.service";
import { logger } from "../utils/logger";

/* -------------------------------------- Config -------------------------------------- */

// Config ชื่อ queue มี default เพราะ job นี้เป็น background housekeeping ล้วนๆ ไม่มี route/service ใด
// เรียกใช้ระหว่าง request ปกติเลย (ต่างจาก BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE ฯลฯ ใน redis.config.ts ที่
// เป็น required env เพราะ core flow พึ่งพา) จึงไม่ต้องบังคับ env var ใหม่สำหรับทุก deployment
const QUEUE_NAME =
  process.env.BULLMQ_SECURITY_AUDIT_LOG_CLEANUP_QUEUE ?? "security-audit-log-cleanup";
const JOB_NAME = "cleanup";
const REPEATABLE_JOB_ID = "security-audit-log-cleanup-daily";
const RUN_EVERY_MS = 24 * 60 * 60 * 1000;

const redisUrl = new URL(REDIS_CONFIG.url);

const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.replace("/", "") || 0) : 0,
  maxRetriesPerRequest: null,
};

const cleanupQueue = new Queue(QUEUE_NAME, { connection: bullConnection });

let cleanupWorker: Worker | null = null;

/* -------------------------------------- Functions -------------------------------------- */

// Function ลงทะเบียน repeatable job ของ retention cleanup — เรียกครั้งเดียวตอน startup ปลอดภัยเรียกซ้ำ
// ได้เพราะ BullMQ ใช้ jobId เดียวกันแทนที่ schedule เดิมแทนที่จะสร้างซ้ำ
export async function scheduleSecurityAuditLogCleanup(): Promise<void> {
  await cleanupQueue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: RUN_EVERY_MS },
      jobId: REPEATABLE_JOB_ID,
    }
  );
}

// Function เริ่ม worker ที่ประมวลผล retention cleanup job
export function startSecurityAuditLogCleanupWorker(): void {
  if (cleanupWorker) {
    return;
  }

  cleanupWorker = new Worker(
    QUEUE_NAME,
    async () => {
      await runSecurityAuditLogRetentionCleanup();
    },
    { connection: bullConnection }
  );

  cleanupWorker.on("failed", (_job, error) => {
    logger.error("Security audit log cleanup job failed.", { error });
  });
}

// Function ปิด Redis/BullMQ connections ของ retention cleanup สำหรับ graceful shutdown
export async function closeSecurityAuditLogCleanupConnections(): Promise<void> {
  if (cleanupWorker) {
    await cleanupWorker.close();
    cleanupWorker = null;
  }

  await cleanupQueue.close();
}
