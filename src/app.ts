// import
import cors from "cors";
import express from "express";

import setupSwagger from "./docs/swagger_origin";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import authRoutes from "./routes/auth.routes";
import systemRoutes from "./routes/system.routes";
import usersRoutes from "./routes/users.routes";

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
  })
);
app.use(express.json());

// Routes
app.use("/", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin/users", usersRoutes);

// Swagger setup
setupSwagger(app);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Export
export default app;
