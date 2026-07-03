// import Library
import express from "express";

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

export default router;
