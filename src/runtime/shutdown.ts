import type { Server } from "http";

import { stopRateLimitCleanupTimer } from "../middlewares/security.middleware";
import { markReadinessShuttingDown } from "./readiness-state";
import { logger } from "../utils/logger";

// Function อ่าน Timeout จาก Env ตรงจุดที่ใช้จริง — Throw ถ้าไม่มีค่าหรือไม่ใช่ตัวเลขบวก กันเงียบๆ ได้
// ค่า NaN ที่ทำให้ setTimeout ยิงทันที (0ms) แทนที่จะรอ Drain Connection ตามเวลาที่ตั้งใจไว้จริง
function readShutdownTimeoutMs(): number {
  const value = Number(process.env.SHUTDOWN_TIMEOUT_MS);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("SHUTDOWN_TIMEOUT_MS must be set to a positive number.");
  }

  return value;
}

type ShutdownDependencies = {
  markReadinessShuttingDown: () => void;
  closeHttpServer: (server: Server) => Promise<void>;
  closeWorkerWebSocketServer: () => Promise<void>;
  closeLineMessageQueueConnections: () => Promise<void>;
  closeWorkerQueueConnections: () => Promise<void>;
  closeRuntimeSettingsSyncConnections: () => Promise<void>;
  // Optional เพราะเป็น housekeeping เสริม ไม่ใช่ core flow ที่ caller ทุกตัวต้องระบุ
  closeSecurityAuditLogCleanupConnections?: () => Promise<void>;
  // Optional ด้วยเหตุผลเดียวกับ closeSecurityAuditLogCleanupConnections ด้านบน
  closeHealthCheckRedisConnections?: () => Promise<void>;
  closePrisma: () => Promise<void>;
  stopRateLimitCleanupTimer: () => void;
  logger: Pick<typeof logger, "info" | "error">;
  exit: (code: number) => void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  readShutdownTimeoutMs: () => number;
};

const defaultShutdownDependencies: ShutdownDependencies = {
  markReadinessShuttingDown,
  closeHttpServer,
  closeWorkerWebSocketServer: async () => {
    const workerSocket = await import("../websockets/worker.socket");
    await workerSocket.closeWorkerWebSocketServer();
  },
  closeLineMessageQueueConnections: async () => {
    const lineMessageQueue = await import("../queues/line-message-queue");
    await lineMessageQueue.closeLineMessageQueueConnections();
  },
  closeWorkerQueueConnections: async () => {
    const workerQueue = await import("../queues/worker-queue");
    await workerQueue.closeWorkerQueueConnections();
  },
  closeRuntimeSettingsSyncConnections: async () => {
    const runtimeSettingsSync = await import("../queues/runtime-settings-sync");
    await runtimeSettingsSync.closeRuntimeSettingsSyncConnections();
  },
  closeSecurityAuditLogCleanupConnections: async () => {
    const securityAuditLogCleanup = await import("../queues/security-audit-log-cleanup");
    await securityAuditLogCleanup.closeSecurityAuditLogCleanupConnections();
  },
  closeHealthCheckRedisConnections: async () => {
    const healthService = await import("../services/health.service");
    await healthService.closeHealthCheckRedisConnections();
  },
  closePrisma: async () => {
    const prisma = await import("../db/prisma");
    await prisma.closePrisma();
  },
  stopRateLimitCleanupTimer,
  logger,
  exit: process.exit,
  setTimeout,
  clearTimeout,
  readShutdownTimeoutMs,
};

export function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function createGracefulShutdownHandler(
  server: Server,
  dependencies: ShutdownDependencies = defaultShutdownDependencies,
): (signal: NodeJS.Signals) => Promise<boolean> {
  let shuttingDown = false;

  return async function shutdown(signal: NodeJS.Signals): Promise<boolean> {
    if (shuttingDown) {
      return false;
    }

    shuttingDown = true;
    dependencies.markReadinessShuttingDown();
    dependencies.logger.info("Shutdown started.", { signal });

    const timeout = dependencies.setTimeout(() => {
      dependencies.logger.error("Shutdown timed out.", { signal });
      dependencies.exit(1);
    }, dependencies.readShutdownTimeoutMs());
    timeout.unref();

    let httpCloseError: unknown;

    try {
      // ต้องรอ HTTP server ปิดเสร็จ (drain in-flight request ให้จบ) ก่อนค่อยปิด WebSocket/Queue/Prisma
      // ไม่งั้น request ที่ยังทำงานอยู่จะพังกลางคันเพราะ connection ถูกตัดไปแล้ว
      await dependencies.closeHttpServer(server).catch((error) => {
        httpCloseError = error;
      });
      await dependencies.closeWorkerWebSocketServer();
      await dependencies.closeLineMessageQueueConnections();
      await dependencies.closeWorkerQueueConnections();
      await dependencies.closeRuntimeSettingsSyncConnections();
      await dependencies.closeSecurityAuditLogCleanupConnections?.();
      await dependencies.closeHealthCheckRedisConnections?.();
      await dependencies.closePrisma();
      dependencies.stopRateLimitCleanupTimer();

      if (httpCloseError) {
        throw httpCloseError;
      }

      dependencies.clearTimeout(timeout);
      dependencies.logger.info("Shutdown completed.", { signal });
      dependencies.exit(0);
    } catch (error) {
      dependencies.clearTimeout(timeout);
      dependencies.logger.error("Shutdown failed.", { signal, error });
      dependencies.exit(1);
    }

    return true;
  };
}

export function registerGracefulShutdown(server: Server): void {
  const shutdown = createGracefulShutdownHandler(server);

  process.once("SIGTERM", (signal) => void shutdown(signal));
  process.once("SIGINT", (signal) => void shutdown(signal));
}
