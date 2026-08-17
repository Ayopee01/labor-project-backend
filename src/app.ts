// Import Dependencies
import cors from "cors";
import express from "express";

// Import
import setupSwagger from "./docs/swagger";
import { normalizeApiRequestBody, pascalCaseApiResponse } from "./middlewares/api-case.middleware";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import { requestIdMiddleware } from "./middlewares/request-id.middleware";
import { requestLoggerMiddleware } from "./middlewares/request-logger.middleware";
import {
  rateLimitMiddleware,
  securityHeadersMiddleware,
} from "./middlewares/security.middleware";
import adminAuditRoutes from "./routes/admin-audit.routes";
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

const app = express();
const uploadDir = process.env.UPLOAD_DIR || "uploads";

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// Middleware
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);
app.use(securityHeadersMiddleware);
app.use(rateLimitMiddleware);
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
app.use("/uploads", express.static(uploadDir));

// Routes
app.use("/", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin/users", adminWorkersRoutes);
app.use("/api/admin", adminAuditRoutes);
app.use("/api/admin", adminSettingsRoutes);
app.use("/api/admin", adminJobRoutes);
app.use("/api/gate", gateRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/line", lineRoutes);
app.use("/api/admin/events", notificationRoutes);
app.use("/api/workers", workerRoutes);

// Swagger Setup
setupSwagger(app);

// Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// Export
export default app;
