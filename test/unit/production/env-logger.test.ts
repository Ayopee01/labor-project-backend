import assert from "node:assert/strict";
import test from "node:test";

import { validateRuntimeEnv } from "../../../src/config/env.config";
import { buildRequestLogContext } from "../../../src/middlewares/request-logger.middleware";
import { createGracefulShutdownHandler } from "../../../src/runtime/shutdown";
import { logger } from "../../../src/utils/logger";

const PRODUCTION_ENV_KEYS = [
  "NODE_ENV",
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
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_LOGIN_CHALLENGE_SECRET",
  "REFRESH_TOKEN_HASH_SECRET",
  "CORS_ORIGIN",
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

function withValidProductionEnv(
  callback: () => void,
  overrides: Partial<Record<(typeof PRODUCTION_ENV_KEYS)[number], string | undefined>> = {},
): void {
  const previous = Object.fromEntries(
    PRODUCTION_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof PRODUCTION_ENV_KEYS)[number], string | undefined>;

  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
    REDIS_URL: "redis://localhost:6379",
    REDIS_WORKER_QUEUE_KEY: "worker:queue",
    REDIS_WORKER_STATUS_KEY_PREFIX: "worker:status:",
    REDIS_WORKER_PRESENCE_KEY_PREFIX: "worker:presence:",
    WORKER_PRESENCE_STALE_SECONDS: "90",
    REDIS_WORKER_BREAK_COUNT_KEY_PREFIX: "worker:break:",
    BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE: "assignment-timeouts",
    BULLMQ_WORKER_BREAK_RETURN_QUEUE: "worker-break-returns",
    BULLMQ_LINE_MESSAGE_QUEUE: "line-messages",
    JWT_ACCESS_SECRET: "x".repeat(32),
    JWT_REFRESH_SECRET: "x".repeat(32),
    JWT_LOGIN_CHALLENGE_SECRET: "y".repeat(32),
    REFRESH_TOKEN_HASH_SECRET: "z".repeat(32),
    CORS_ORIGIN: "https://example.com",
    LINE_CHANNEL_SECRET: "line-channel-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "line-channel-access-token",
    FIREBASE_PROJECT_ID: "labor-test-project",
    FIREBASE_CLIENT_EMAIL: "firebase-admin@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----\\n",
  });

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const key of PRODUCTION_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("env validation rejects weak production secrets", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAccessSecret = process.env.JWT_ACCESS_SECRET;

  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/app";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.REDIS_WORKER_QUEUE_KEY = "worker:queue";
  process.env.REDIS_WORKER_STATUS_KEY_PREFIX = "worker:status:";
  process.env.REDIS_WORKER_PRESENCE_KEY_PREFIX = "worker:presence:";
  process.env.WORKER_PRESENCE_STALE_SECONDS = "90";
  process.env.REDIS_WORKER_BREAK_COUNT_KEY_PREFIX = "worker:break:";
  process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE = "assignment-timeouts";
  process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE = "worker-break-returns";
  process.env.BULLMQ_LINE_MESSAGE_QUEUE = "line-messages";
  process.env.JWT_ACCESS_SECRET = "change-this-access-secret";
  process.env.JWT_REFRESH_SECRET = "x".repeat(32);
  process.env.JWT_LOGIN_CHALLENGE_SECRET = "y".repeat(32);
  process.env.REFRESH_TOKEN_HASH_SECRET = "z".repeat(32);
  process.env.CORS_ORIGIN = "https://example.com";
  process.env.LINE_CHANNEL_SECRET = "line-channel-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-channel-access-token";

  try {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /JWT_ACCESS_SECRET/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousAccessSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = previousAccessSecret;
    }
  }
});

test("env validation rejects missing production CORS origin and LINE config", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;
  const previousLineSecret = process.env.LINE_CHANNEL_SECRET;
  const previousLineAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  process.env.NODE_ENV = "production";
  delete process.env.CORS_ORIGIN;
  delete process.env.LINE_CHANNEL_SECRET;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/app";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.REDIS_WORKER_QUEUE_KEY = "worker:queue";
  process.env.REDIS_WORKER_STATUS_KEY_PREFIX = "worker:status:";
  process.env.REDIS_WORKER_PRESENCE_KEY_PREFIX = "worker:presence:";
  process.env.WORKER_PRESENCE_STALE_SECONDS = "90";
  process.env.REDIS_WORKER_BREAK_COUNT_KEY_PREFIX = "worker:break:";
  process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE = "assignment-timeouts";
  process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE = "worker-break-returns";
  process.env.BULLMQ_LINE_MESSAGE_QUEUE = "line-messages";
  process.env.JWT_ACCESS_SECRET = "x".repeat(32);
  process.env.JWT_REFRESH_SECRET = "x".repeat(32);
  process.env.JWT_LOGIN_CHALLENGE_SECRET = "y".repeat(32);
  process.env.REFRESH_TOKEN_HASH_SECRET = "z".repeat(32);

  try {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /CORS_ORIGIN/);
    assert.match(result.errors.join(" "), /LINE_CHANNEL_SECRET/);
    assert.match(result.errors.join(" "), /LINE_CHANNEL_ACCESS_TOKEN/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = previousCorsOrigin;
    }
    if (previousLineSecret === undefined) {
      delete process.env.LINE_CHANNEL_SECRET;
    } else {
      process.env.LINE_CHANNEL_SECRET = previousLineSecret;
    }
    if (previousLineAccessToken === undefined) {
      delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    } else {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = previousLineAccessToken;
    }
  }
});

// test ทดสอบ
test("env validation allows wildcard CORS when explicitly enabled", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;
  const previousAllowWildcard = process.env.ALLOW_CORS_WILDCARD;

  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGIN = "*";
  process.env.ALLOW_CORS_WILDCARD = "true";

  process.env.DATABASE_URL =
    "postgresql://user:pass@localhost:5432/app";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.REDIS_WORKER_QUEUE_KEY = "worker:queue";
  process.env.REDIS_WORKER_STATUS_KEY_PREFIX = "worker:status:";
  process.env.REDIS_WORKER_PRESENCE_KEY_PREFIX = "worker:presence:";
  process.env.WORKER_PRESENCE_STALE_SECONDS = "90";
  process.env.REDIS_WORKER_BREAK_COUNT_KEY_PREFIX = "worker:break:";
  process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE = "assignment-timeouts";
  process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE =
    "worker-break-returns";
  process.env.BULLMQ_LINE_MESSAGE_QUEUE = "line-messages";

  process.env.JWT_ACCESS_SECRET = "x".repeat(32);
  process.env.JWT_REFRESH_SECRET = "x".repeat(32);
  process.env.JWT_LOGIN_CHALLENGE_SECRET = "y".repeat(32);
  process.env.REFRESH_TOKEN_HASH_SECRET = "z".repeat(32);

  process.env.LINE_CHANNEL_SECRET = "line-channel-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN =
    "line-channel-access-token";

  process.env.FIREBASE_PROJECT_ID = "firebase-project";
  process.env.FIREBASE_CLIENT_EMAIL =
    "firebase@example.com";
  process.env.FIREBASE_PRIVATE_KEY =
    "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----\\n";

  try {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;

    if (previousCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = previousCorsOrigin;
    }

    if (previousAllowWildcard === undefined) {
      delete process.env.ALLOW_CORS_WILDCARD;
    } else {
      process.env.ALLOW_CORS_WILDCARD = previousAllowWildcard;
    }
  }
});

test("env validation rejects wildcard production CORS origin", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;

  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGIN = "*";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/app";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.REDIS_WORKER_QUEUE_KEY = "worker:queue";
  process.env.REDIS_WORKER_STATUS_KEY_PREFIX = "worker:status:";
  process.env.REDIS_WORKER_PRESENCE_KEY_PREFIX = "worker:presence:";
  process.env.WORKER_PRESENCE_STALE_SECONDS = "90";
  process.env.REDIS_WORKER_BREAK_COUNT_KEY_PREFIX = "worker:break:";
  process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE = "assignment-timeouts";
  process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE = "worker-break-returns";
  process.env.BULLMQ_LINE_MESSAGE_QUEUE = "line-messages";
  process.env.JWT_ACCESS_SECRET = "x".repeat(32);
  process.env.JWT_REFRESH_SECRET = "x".repeat(32);
  process.env.JWT_LOGIN_CHALLENGE_SECRET = "y".repeat(32);
  process.env.REFRESH_TOKEN_HASH_SECRET = "z".repeat(32);
  process.env.LINE_CHANNEL_SECRET = "line-channel-secret";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-channel-access-token";

  try {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /CORS_ORIGIN must not be '\*'/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = previousCorsOrigin;
    }
  }
});

test("env validation rejects missing production Firebase project id", () => {
  withValidProductionEnv(() => {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, false);
    assert.match(
      result.errors.join(" "),
      /Missing required environment variable: FIREBASE_PROJECT_ID/,
    );
  }, { FIREBASE_PROJECT_ID: undefined });
});

test("env validation rejects missing production Firebase client email", () => {
  withValidProductionEnv(() => {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, false);
    assert.match(
      result.errors.join(" "),
      /Missing required environment variable: FIREBASE_CLIENT_EMAIL/,
    );
  }, { FIREBASE_CLIENT_EMAIL: undefined });
});

test("env validation rejects missing production Firebase private key", () => {
  withValidProductionEnv(() => {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, false);
    assert.match(
      result.errors.join(" "),
      /Missing required environment variable: FIREBASE_PRIVATE_KEY/,
    );
  }, { FIREBASE_PRIVATE_KEY: undefined });
});

test("env validation accepts valid production Firebase config", () => {
  withValidProductionEnv(() => {
    const result = validateRuntimeEnv();

    assert.equal(result.ok, true);
  });
});

test("env validation does not require Firebase credentials outside production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFirebaseProjectId = process.env.FIREBASE_PROJECT_ID;
  const previousFirebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const previousFirebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  process.env.NODE_ENV = "test";
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;

  try {
    const result = validateRuntimeEnv();

    assert.equal(
      result.errors.some((error) => error.includes("FIREBASE_")),
      false,
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousFirebaseProjectId === undefined) {
      delete process.env.FIREBASE_PROJECT_ID;
    } else {
      process.env.FIREBASE_PROJECT_ID = previousFirebaseProjectId;
    }
    if (previousFirebaseClientEmail === undefined) {
      delete process.env.FIREBASE_CLIENT_EMAIL;
    } else {
      process.env.FIREBASE_CLIENT_EMAIL = previousFirebaseClientEmail;
    }
    if (previousFirebasePrivateKey === undefined) {
      delete process.env.FIREBASE_PRIVATE_KEY;
    } else {
      process.env.FIREBASE_PRIVATE_KEY = previousFirebasePrivateKey;
    }
  }
});

test("logger redacts nested secret-shaped keys", () => {
  const redacted = logger.redact({
    Authorization: "Bearer token",
    nested: {
      database_url: "postgresql://secret",
      safe: "visible",
    },
  }) as Record<string, unknown>;

  assert.equal(redacted.Authorization, "[REDACTED]");
  assert.deepEqual(redacted.nested, {
    database_url: "[REDACTED]",
    safe: "visible",
  });
});

test("logger redacts secrets and URL credentials in Error fields", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://user:super-secret-password@db:5432/app";

  try {
    const redacted = logger.redact(
      new Error(
        "Unable to connect to postgresql://user:super-secret-password@db:5432/app",
      ),
    ) as Record<string, unknown>;

    assert.equal(
      redacted.message,
      "Unable to connect to postgresql://[REDACTED]:[REDACTED]@db:5432/app",
    );
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

test("request completion logger context includes request id and duration", () => {
  assert.deepEqual(
    buildRequestLogContext({
      requestId: "request-1",
      method: "GET",
      path: "/ready",
      statusCode: 503,
      durationMs: 12.3456,
    }),
    {
      requestId: "request-1",
      method: "GET",
      path: "/ready",
      statusCode: 503,
      durationMs: 12.35,
    },
  );
});

test("graceful shutdown initiates HTTP close before waiting for WebSocket close", async () => {
  const events: string[] = [];
  let resolveWebSocketClose: (() => void) | undefined;
  const server = {
    close: (callback: (error?: Error) => void) => {
      events.push("http-close-start");
      setImmediate(() => {
        events.push("http-close-finish");
        callback();
      });
      return server;
    },
  };
  const shutdown = createGracefulShutdownHandler(server as never, {
    markReadinessShuttingDown: () => events.push("readiness-false"),
    closeHttpServer: (httpServer) =>
      new Promise((resolve, reject) => {
        httpServer.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    closeWorkerWebSocketServer: () =>
      new Promise((resolve) => {
        events.push("ws-close-start");
        resolveWebSocketClose = () => {
          events.push("ws-close-finish");
          resolve();
        };
      }),
    closeNotificationQueueConnections: async () => {
      events.push("notification-close");
    },
    closeWorkerQueueConnections: async () => {
      events.push("worker-queue-close");
    },
    closePrisma: async () => {
      events.push("prisma-close");
    },
    stopRateLimitCleanupTimer: () => events.push("rate-limit-stop"),
    logger: {
      info: () => undefined,
      error: () => undefined,
    },
    exit: (code) => events.push(`exit-${code}`),
    setTimeout: (() =>
      ({ unref: () => undefined }) as unknown as NodeJS.Timeout) as unknown as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
    readShutdownTimeoutMs: () => 20_000,
  });

  const shutdownPromise = shutdown("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events.slice(0, 3), [
    "readiness-false",
    "http-close-start",
    "ws-close-start",
  ]);

  resolveWebSocketClose?.();
  assert.equal(await shutdownPromise, true);
  assert.deepEqual(events, [
    "readiness-false",
    "http-close-start",
    "ws-close-start",
    "http-close-finish",
    "ws-close-finish",
    "notification-close",
    "worker-queue-close",
    "prisma-close",
    "rate-limit-stop",
    "exit-0",
  ]);
});

test("graceful shutdown is idempotent for duplicate signals", async () => {
  const events: string[] = [];
  const server = {
    close: (callback: (error?: Error) => void) => {
      events.push("http-close");
      callback();
      return server;
    },
  };
  const shutdown = createGracefulShutdownHandler(server as never, {
    markReadinessShuttingDown: () => events.push("readiness-false"),
    closeHttpServer: (httpServer) =>
      new Promise((resolve, reject) => {
        httpServer.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    closeWorkerWebSocketServer: async () => {
      events.push("ws-close");
    },
    closeNotificationQueueConnections: async () => {
      events.push("notification-close");
    },
    closeWorkerQueueConnections: async () => {
      events.push("worker-queue-close");
    },
    closePrisma: async () => {
      events.push("prisma-close");
    },
    stopRateLimitCleanupTimer: () => events.push("rate-limit-stop"),
    logger: {
      info: () => undefined,
      error: () => undefined,
    },
    exit: (code) => events.push(`exit-${code}`),
    setTimeout: (() =>
      ({ unref: () => undefined }) as unknown as NodeJS.Timeout) as unknown as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
    readShutdownTimeoutMs: () => 20_000,
  });

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");

  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.equal(events.filter((event) => event === "http-close").length, 1);
  assert.equal(events.filter((event) => event === "ws-close").length, 1);
});
