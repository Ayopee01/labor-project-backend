// Import Library
import express from "express";

import { checkReadiness } from "../services/health.service";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({
    message: "Backend is running",
    docs: "/api-docs",
    health: "/health",
  });
});

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

router.get("/ready", async (_req, res) => {
  const readiness = await checkReadiness();

  res.status(readiness.status === "ready" ? 200 : 503).json({
    ...readiness,
    timestamp: new Date().toISOString(),
  });
});

export default router;
