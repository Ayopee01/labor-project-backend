import type { Server } from "http";

import { stopRateLimitCleanupTimer } from "../middlewares/security.middleware";
import { markReadinessShuttingDown } from "./readiness-state";
import { logger } from "../utils/logger";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000;

function readShutdownTimeoutMs(): number {
  const value = Number(process.env.SHUTDOWN_TIMEOUT_MS);

  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

type ShutdownDependencies = {
  markReadinessShuttingDown: () => void;
  closeHttpServer: (server: Server) => Promise<void>;
  closeWorkerWebSocketServer: () => Promise<void>;
  closeNotificationQueueConnections: () => Promise<void>;
  closeWorkerQueueConnections: () => Promise<void>;
  closeRuntimeSettingsSyncConnections: () => Promise<void>;
  // Optional (ต่างจาก close*Connections ตัวอื่น) เพื่อไม่ต้องแก้ ShutdownDependencies literal ที่มีอยู่
  // แล้วในเทสเดิม (env-logger.test.ts) — job นี้เป็น housekeeping เสริม ไม่ใช่ core flow ที่ทุก caller
  // ของ createGracefulShutdownHandler ต้องระบุเสมอ
  closeSecurityAuditLogCleanupConnections?: () => Promise<void>;
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
  closeNotificationQueueConnections: async () => {
    const notificationQueue = await import("../queues/notification-queue");
    await notificationQueue.closeNotificationQueueConnections();
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
      // ต้องรอ HTTP server ปิดเสร็จ (drain in-flight request ทุกตัวจนจบ) ก่อนเสมอ ค่อยไปปิด
      // WebSocket/Queue/Prisma ต่อ — ถ้าปิด Prisma/Redis ไปพร้อมกับที่ยังมี request ทำงานอยู่ (แค่
      // เริ่ม close ไม่รอให้ปิดเสร็จ) request นั้นจะพังกลางคันเพราะ connection ที่ใช้อยู่ถูกตัดไปแล้ว
      await dependencies.closeHttpServer(server).catch((error) => {
        httpCloseError = error;
      });
      await dependencies.closeWorkerWebSocketServer();
      await dependencies.closeNotificationQueueConnections();
      await dependencies.closeWorkerQueueConnections();
      await dependencies.closeRuntimeSettingsSyncConnections();
      await dependencies.closeSecurityAuditLogCleanupConnections?.();
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
