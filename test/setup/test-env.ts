/* -------------------------------------- Test Env Guard -------------------------------------- */

const FORBIDDEN_DATABASE_PATTERNS = [
  "prod",
  "production",
  "staging",
];

// Function ตรวจว่า DATABASE_URL ชี้ไป environment ที่ห้ามใช้กับ test หรือไม่
function includesForbiddenDatabaseName(databaseUrl: string): boolean {
  const normalized = databaseUrl.toLowerCase();

  return FORBIDDEN_DATABASE_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}

// Function ตั้งค่า env แยกสำหรับ test ไม่ให้ชนข้อมูลจริง
export function applyIsolatedTestEnv(prefix = "test"): void {
  process.env.NODE_ENV = "test";
  // Route test files ยิง POST /api/auth/login จริงแทบทุกเทสต์ (ไม่มี token cache) ไฟล์ที่มีหลายร้อย
  // เทสต์จึงชน default LOGIN_RATE_LIMIT_MAX_REQUESTS (10 ครั้ง/60s ต่อ IP) ได้ง่ายเมื่อมีเทสต์เพิ่มขึ้น
  // เรื่อยๆ (พิสูจน์แล้วจริงตอนเพิ่มเทสต์ HistoryFlags 4 ตัว) — ยกเพดานเฉพาะ process ของ test เท่านั้น
  // ไม่กระทบ production/security จริง เผื่อ default rate limit ทั่วไปไว้ด้วยด้วยเหตุผลเดียวกัน
  process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS ??= "1000";
  process.env.RATE_LIMIT_MAX_REQUESTS ??= "5000";
  process.env.RATE_LIMIT_WINDOW_MS ??= "60000";
  process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS ??= "60000";
  process.env.SHUTDOWN_TIMEOUT_MS ??= "20000";
  process.env.JWT_ACCESS_SECRET ??= `${prefix}-access-secret`;
  process.env.JWT_REFRESH_SECRET ??= `${prefix}-refresh-secret`;
  process.env.JWT_LOGIN_CHALLENGE_SECRET ??= `${prefix}-login-challenge-secret`;
  process.env.REFRESH_TOKEN_HASH_SECRET ??= `${prefix}-refresh-hash-secret`;
  process.env.VENDOR_ACTION_TOKEN_SECRET ??= `${prefix}-vendor-action-token-secret`;
  process.env.LINE_CHANNEL_SECRET ??= `${prefix}-line-channel-secret`;
  process.env.SPACES_ENDPOINT ??= "https://sgp1.digitaloceanspaces.com";
  process.env.SPACES_REGION ??= "sgp1";
  process.env.SPACES_ACCESS_KEY ??= `${prefix}-spaces-access-key`;
  process.env.SPACES_SECRET_KEY ??= `${prefix}-spaces-secret-key`;
  process.env.SPACES_ADMIN_BUCKET ??= `${prefix}-admin-uploads`;
  process.env.REDIS_URL ??= "redis://localhost:6379/15";
  process.env.REDIS_WORKER_QUEUE_KEY = `${prefix}:worker:queue`;
  process.env.REDIS_WORKER_STATUS_KEY_PREFIX = `${prefix}:worker:status:`;
  process.env.REDIS_WORKER_PRESENCE_KEY_PREFIX = `${prefix}:worker:presence:`;
  process.env.REDIS_WORKER_BREAK_COUNT_KEY_PREFIX = `${prefix}:worker:break:`;
  process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE = `${prefix}:assignment-timeout`;
  process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE = `${prefix}:worker-break-return`;
  process.env.BULLMQ_LINE_MESSAGE_QUEUE = `${prefix}:line-message`;
}

// Function ตรวจสอบ DATABASE_URL ของ test ก่อนรัน integration
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
