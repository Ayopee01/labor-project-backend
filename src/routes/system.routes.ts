// Import Library
import express from "express";

import { checkReadiness } from "../services/health.service";

const router = express.Router();

async function handleReadiness(_req: express.Request, res: express.Response) {
  const readiness = await checkReadiness();

  res.status(readiness.status === "ready" ? 200 : 503).json({
    ...readiness,
    timestamp: new Date().toISOString(),
  });
}

router.get("/", handleReadiness);
router.get("/ready", handleReadiness);

export default router;
