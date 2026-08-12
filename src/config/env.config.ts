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
] as const;

const REQUIRED_SECRET_ENV = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_LOGIN_CHALLENGE_SECRET",
  "REFRESH_TOKEN_HASH_SECRET",
] as const;

const REQUIRED_PRODUCTION_LINE_ENV = [
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
] as const;

const REQUIRED_PRODUCTION_FIREBASE_ENV = [
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
]);

function hasValue(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim() !== "";
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
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

    if (isProduction() && (value.length < 32 || WEAK_SECRET_VALUES.has(value))) {
      errors.push(`${name} must be a strong production secret.`);
    }
  }

  if (isProduction()) {
    for (const name of REQUIRED_PRODUCTION_LINE_ENV) {
      if (!hasValue(name)) {
        errors.push(`${name} is required in production.`);
      }
    }

    for (const name of REQUIRED_PRODUCTION_FIREBASE_ENV) {
      if (!hasValue(name)) {
        errors.push(`Missing required environment variable: ${name}`);
      }
    }
  }

  if (process.env.WORKER_PRESENCE_STALE_SECONDS) {
    const staleSeconds = Number(process.env.WORKER_PRESENCE_STALE_SECONDS);

    if (!Number.isFinite(staleSeconds) || staleSeconds <= 0) {
      errors.push("WORKER_PRESENCE_STALE_SECONDS must be a positive number.");
    }
  }

  if (isProduction()) {
    if (!hasValue("CORS_ORIGIN")) {
      errors.push("CORS_ORIGIN is required in production.");
    } else if (process.env.CORS_ORIGIN!.trim() === "*") {
      errors.push("CORS_ORIGIN must not be '*' in production.");
    }
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
