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
    const httpClosePromise = dependencies.closeHttpServer(server).catch((error) => {
      httpCloseError = error;
    });

    try {
      await dependencies.closeWorkerWebSocketServer();
      await dependencies.closeNotificationQueueConnections();
      await dependencies.closeWorkerQueueConnections();
      await dependencies.closePrisma();
      dependencies.stopRateLimitCleanupTimer();
      await httpClosePromise;

      if (httpCloseError) {
        throw httpCloseError;
      }

      dependencies.clearTimeout(timeout);
      dependencies.logger.info("Shutdown completed.", { signal });
      dependencies.exit(0);
    } catch (error) {
      await httpClosePromise;
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
