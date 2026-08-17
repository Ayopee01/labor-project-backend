import dotenv from "dotenv";
import { createServer } from "http";

dotenv.config({ quiet: true });

const { assertRuntimeEnv } = require("./src/config/env.config");

assertRuntimeEnv();

const { default: app } = require("./src/app");
const { startAssignmentTimeoutProcessing } = require("./src/queues/worker-dispatch");
const { startNotificationWorkers } = require("./src/queues/notification-queue");
const { registerGracefulShutdown } = require("./src/runtime/shutdown");
const { setupWorkerWebSocket } = require("./src/websockets/worker.socket");
const { logger } = require("./src/utils/logger");

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST || "0.0.0.0";
const server = createServer(app);

startAssignmentTimeoutProcessing();
startNotificationWorkers();
setupWorkerWebSocket(server);
registerGracefulShutdown(server);

server.listen(PORT, HOST, () => {
  logger.info("Server started.", { host: HOST, port: PORT });
});
