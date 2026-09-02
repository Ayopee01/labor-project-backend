import IORedis from "ioredis";

import { REDIS_CONFIG } from "../config/redis.config";
import { getPrisma } from "../db/prisma";
import { isReadinessShuttingDown } from "../runtime/readiness-state";
import { logger } from "../utils/logger";

type ReadinessCheck = {
  status: "ok" | "error";
};

type ReadinessResult = {
  status: "ready" | "not_ready";
  checks: {
    database: ReadinessCheck;
    redis: ReadinessCheck;
  };
};

async function checkDatabaseReady(): Promise<ReadinessCheck> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    logger.error("Readiness database check failed.", { error });
    return {
      status: "error",
    };
  }
}

async function checkRedisReady(): Promise<ReadinessCheck> {
  const redis = new IORedis(REDIS_CONFIG.url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    await redis.ping();
    return { status: "ok" };
  } catch (error) {
    logger.error("Readiness Redis check failed.", { error });
    return {
      status: "error",
    };
  } finally {
    if (redis.status !== "end") {
      await redis.quit().catch(() => undefined);
    }
  }
}

export async function checkReadiness(): Promise<ReadinessResult> {
  if (isReadinessShuttingDown()) {
    return {
      status: "not_ready",
      checks: {
        database: { status: "error" },
        redis: { status: "error" },
      },
    };
  }

  const [database, redis] = await Promise.all([
    checkDatabaseReady(),
    checkRedisReady(),
  ]);
  const ready = database.status === "ok" && redis.status === "ok";

  return {
    status: ready ? "ready" : "not_ready",
    checks: {
      database,
      redis,
    },
  };
}
