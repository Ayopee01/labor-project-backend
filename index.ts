import dotenv from "dotenv";
import { createServer } from "http";

dotenv.config({ quiet: true });

// ต้อง init ก่อนอย่างอื่นทั้งหมด (แม้แต่ก่อน assertRuntimeEnv) เพื่อให้ Sentry จับ error ได้ตั้งแต่
// ต้นจริงๆ รวมถึงกรณี env var ที่ required ขาดหายจน assertRuntimeEnv throw เอง
require("./src/config/sentry");

const { assertRuntimeEnv } = require("./src/config/env.config");

assertRuntimeEnv();

const { default: app } = require("./src/app");
const { startAssignmentTimeoutProcessing } = require("./src/queues/worker-dispatch");
const { startNotificationWorkers } = require("./src/queues/notification-queue");
const { startRuntimeSettingsSync } = require("./src/queues/runtime-settings-sync");
const { registerGracefulShutdown } = require("./src/runtime/shutdown");
const { setupWorkerWebSocket } = require("./src/websockets/worker.socket");
const { reconcileOrphanedTicketSubmissions } = require("./src/services/shared/ticket-completion.service");
const { logger } = require("./src/utils/logger");

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST || "0.0.0.0";
const server = createServer(app);

startAssignmentTimeoutProcessing();
startNotificationWorkers();
startRuntimeSettingsSync();
setupWorkerWebSocket(server);
registerGracefulShutdown(server);

server.listen(PORT, HOST, () => {
  logger.info("Server started.", { host: HOST, port: PORT });

  // Function กู้คืน Ticket ที่ค้างรอ Vendor หลัง server restart
  reconcileOrphanedTicketSubmissions()
    .then((reconciledCount: number) => {
      if (reconciledCount > 0) {
        logger.info("Reconciled orphaned ticket submissions on startup.", { reconciledCount });
      }
    })
    .catch((error: unknown) => {
      logger.error("Failed to reconcile orphaned ticket submissions on startup.", { error });
    });
});
