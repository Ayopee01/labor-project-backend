// import
import cors from "cors";
import express from "express";

import setupSwagger from "./docs/swagger";
import {
  normalizeApiRequestBody,
  pascalCaseApiResponse,
} from "./middlewares/api-case.middleware";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import adminJobRoutes from "./routes/admin-jobs.routes";
import adminSettingsRoutes from "./routes/admin-settings.routes";
import adminWorkersRoutes from "./routes/admin-workers.routes";
import authRoutes from "./routes/auth.routes";
import driverRoutes from "./routes/driver.routes";
import gateRoutes from "./routes/gate.routes";
import lineRoutes from "./routes/line.routes";
import notificationRoutes from "./routes/notifications.routes";
import systemRoutes from "./routes/system.routes";
import workerRoutes from "./routes/worker.routes";

// Config Express app หลักของ API
const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
  })
);
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as express.Request).rawBody = buffer.toString("utf8");
    },
  })
);
app.use(normalizeApiRequestBody);
app.use(pascalCaseApiResponse);
app.use("/uploads", express.static("uploads"));

// Routes
app.use("/", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin/users", adminWorkersRoutes);
app.use("/api/admin", adminSettingsRoutes);
app.use("/api/admin", adminJobRoutes);
app.use("/api/gate", gateRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/line", lineRoutes);
app.use("/api/admin/events", notificationRoutes);
app.use("/api/workers", workerRoutes);

// Swagger setup
setupSwagger(app);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Export
export default app;
