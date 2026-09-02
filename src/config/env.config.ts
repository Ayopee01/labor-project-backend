type EnvValidationResult = {
  ok: boolean;
  errors: string[];
};

const REQUIRED_RUNTIME_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
  "REDIS_WORKER_QUEUE_KEY",
  "REDIS_WORKER_STATUS_KEY_PREFIX",
  "REDIS_WORKER_PRESENCE_KEY_PREFIX",
  "WORKER_PRESENCE_STALE_SECONDS",
  "REDIS_WORKER_BREAK_COUNT_KEY_PREFIX",
  "BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE",
  "BULLMQ_WORKER_BREAK_RETURN_QUEUE",
  "BULLMQ_LINE_MESSAGE_QUEUE",
  "SHUTDOWN_TIMEOUT_MS",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_MAX_REQUESTS",
  "RATE_LIMIT_CLEANUP_INTERVAL_MS",
] as const;

const REQUIRED_POSITIVE_NUMBER_ENV = [
  "WORKER_PRESENCE_STALE_SECONDS",
  "SHUTDOWN_TIMEOUT_MS",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_MAX_REQUESTS",
  "RATE_LIMIT_CLEANUP_INTERVAL_MS",
] as const;

const REQUIRED_SECRET_ENV = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_LOGIN_CHALLENGE_SECRET",
  "REFRESH_TOKEN_HASH_SECRET",
  "VENDOR_ACTION_TOKEN_SECRET",
] as const;

const REQUIRED_LINE_ENV = [
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
] as const;

// SPACES_BUCKET (backups) ไม่รวมอยู่ในนี้ตั้งใจ — ใช้เฉพาะ scripts/backup-postgres.sh ซึ่งมี guard
// ของตัวเองอยู่แล้ว (bash `${VAR:?...}`) ไม่ใช่ runtime ของแอป
const REQUIRED_SPACES_ENV = [
  "SPACES_ENDPOINT",
  "SPACES_REGION",
  "SPACES_ACCESS_KEY",
  "SPACES_SECRET_KEY",
  "SPACES_ADMIN_BUCKET",
] as const;

const REQUIRED_FIREBASE_ENV = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

const WEAK_SECRET_VALUES = new Set([
  "secret",
  "password",
  "change-me",
  "change-this-access-secret",
  "change-this-refresh-secret",
  "change-this-login-challenge-secret",
  "change-this-refresh-token-hash-secret",
  "change-this-vendor-action-token-secret",
  // .env.example placeholders — kept here too so an unedited copy still fails production
  // validation even though the text itself is long enough to pass the length check.
  "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32_ACCESS",
  "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32_REFRESH",
  "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32_LOGIN_CHALLENGE",
  "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32_VENDOR_ACTION",
  "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32_REFRESH_HASH",
]);

function hasValue(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim() !== "";
}

export function validateRuntimeEnv(): EnvValidationResult {
  const errors: string[] = [];

  for (const name of REQUIRED_RUNTIME_ENV) {
    if (!hasValue(name)) {
      errors.push(`${name} is required.`);
    }
  }

  for (const name of REQUIRED_SECRET_ENV) {
    if (!hasValue(name)) {
      errors.push(`${name} is required.`);
      continue;
    }

    const value = process.env[name]!.trim();

    if (value.length < 32 || WEAK_SECRET_VALUES.has(value)) {
      errors.push(`${name} must be a strong production secret.`);
    }
  }

  for (const name of REQUIRED_LINE_ENV) {
    if (!hasValue(name)) {
      errors.push(`${name} is required.`);
    }
  }

  for (const name of REQUIRED_SPACES_ENV) {
    if (!hasValue(name)) {
      errors.push(`${name} is required.`);
    }
  }

  for (const name of REQUIRED_FIREBASE_ENV) {
    if (!hasValue(name)) {
      errors.push(`Missing required environment variable: ${name}`);
    }
  }

  for (const name of REQUIRED_POSITIVE_NUMBER_ENV) {
    if (!hasValue(name)) {
      continue;
    }

    const value = Number(process.env[name]);

    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${name} must be a positive number.`);
    }
  }

  if (!hasValue("CORS_ORIGIN")) {
    errors.push("CORS_ORIGIN is required.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function assertRuntimeEnv(): void {
  const result = validateRuntimeEnv();

  if (!result.ok) {
    throw new Error(`Runtime environment validation failed: ${result.errors.join(" ")}`);
  }
}
