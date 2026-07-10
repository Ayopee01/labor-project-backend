/* -------------------------------------- Functions -------------------------------------- */

// Function เช็คค่า env ว่ามีหรือไม่ ถ้าไม่มีให้ throw error
function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

// Function ดึงค่า env แบบ number และตรวจว่าเป็นตัวเลขถูกต้อง
function requiredNumberEnv(name: string): number {
  const value = requiredEnv(name);
  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    throw new Error(`${name} must be a valid number`);
  }

  return numberValue;
}

/* -------------------------------------- Config -------------------------------------- */

// Config การเชื่อมต่อ Redis สำหรับ queue ชั่วคราวและ BullMQ
export const REDIS_CONFIG = {
  url: requiredEnv("REDIS_URL"),
  workerQueueKey: requiredEnv("REDIS_WORKER_QUEUE_KEY"),
  workerStatusKeyPrefix: requiredEnv("REDIS_WORKER_STATUS_KEY_PREFIX"),
  workerPresenceKeyPrefix: requiredEnv("REDIS_WORKER_PRESENCE_KEY_PREFIX"),
  workerPresenceStaleSeconds: requiredNumberEnv("WORKER_PRESENCE_STALE_SECONDS"),
  workerBreakCountKeyPrefix: requiredEnv("REDIS_WORKER_BREAK_COUNT_KEY_PREFIX"),
  assignmentTimeoutQueueName: requiredEnv("BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE"),
  workerBreakReturnQueueName: requiredEnv("BULLMQ_WORKER_BREAK_RETURN_QUEUE"),
  lineMessageQueueName: requiredEnv("BULLMQ_LINE_MESSAGE_QUEUE"),
} as const;