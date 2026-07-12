/* -------------------------------------- Test Env Guard -------------------------------------- */

// Config รายชื่อ environment/database ที่ห้าม integration test แตะเด็ดขาด
const FORBIDDEN_DATABASE_PATTERNS = [
  "prod",
  "production",
  "staging",
];

// Function ตรวจคำต้องห้ามใน DATABASE_URL เพื่อกัน test ยิง production/staging โดยไม่ตั้งใจ
function includesForbiddenDatabaseName(databaseUrl: string): boolean {
  const normalized = databaseUrl.toLowerCase();

  return FORBIDDEN_DATABASE_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}

// Function ตั้งค่า env ปลอดภัยสำหรับ test ที่ใช้ mock infra และไม่แตะ DB จริง
export function applyIsolatedTestEnv(prefix = "test"): void {
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET ??= `${prefix}-access-secret`;
  process.env.JWT_REFRESH_SECRET ??= `${prefix}-refresh-secret`;
  process.env.JWT_LOGIN_CHALLENGE_SECRET ??= `${prefix}-login-challenge-secret`;
  process.env.REFRESH_TOKEN_HASH_SECRET ??= `${prefix}-refresh-hash-secret`;
  process.env.REDIS_URL ??= "redis://localhost:6379/15";
  process.env.REDIS_WORKER_QUEUE_KEY = `${prefix}:worker:queue`;
  process.env.REDIS_WORKER_STATUS_KEY_PREFIX = `${prefix}:worker:status:`;
  process.env.REDIS_WORKER_PRESENCE_KEY_PREFIX = `${prefix}:worker:presence:`;
  process.env.REDIS_WORKER_BREAK_COUNT_KEY_PREFIX = `${prefix}:worker:break:`;
  process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE = `${prefix}:assignment-timeout`;
  process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE = `${prefix}:worker-break-return`;
  process.env.BULLMQ_LINE_MESSAGE_QUEUE = `${prefix}:line-message`;
}

// Function ตรวจว่า DATABASE_URL เหมาะสำหรับ integration test จริงก่อนแตะ DB
export function assertSafeTestDatabaseUrl(databaseUrl = process.env.DATABASE_URL): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for DB integration tests.");
  }

  if (!databaseUrl.toLowerCase().includes("test")) {
    throw new Error("DATABASE_URL for DB integration tests must include 'test'.");
  }

  if (includesForbiddenDatabaseName(databaseUrl)) {
    throw new Error("DATABASE_URL appears to target a non-test environment.");
  }
}
