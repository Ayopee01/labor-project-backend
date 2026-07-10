import dotenv from "dotenv";
import { createServer } from "http";

dotenv.config({ quiet: true });

const { default: app } = require("./src/app");
const { startAssignmentTimeoutProcessing } = require("./src/queues/worker-dispatch");
const { startNotificationWorkers } = require("./src/queues/notification-queue");
const { setupWorkerWebSocket } = require("./src/websockets/worker.socket");

const PORT = process.env.PORT || 8080;
const server = createServer(app);

startAssignmentTimeoutProcessing();
startNotificationWorkers();
setupWorkerWebSocket(server);

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
