// Import Library
import express from "express";

import { checkReadiness } from "../services/health.service";

const router = express.Router();

router.get("/ready", async (_req, res) => {
  const readiness = await checkReadiness();

  res.status(readiness.status === "ready" ? 200 : 503).json({
    ...readiness,
    timestamp: new Date().toISOString(),
  });
});

export default router;
