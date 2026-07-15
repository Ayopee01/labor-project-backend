// import Library
import express from "express";

// Config Express router สำหรับ System routes
const router = express.Router();

// Route แสดงสถานะพื้นฐานและ path เอกสาร API
router.get("/", (_req, res) => {
  res.json({
    message: "Backend is running",
    docs: "/api-docs",
    health: "/health",
  });
});

// Route health check สำหรับตรวจว่า backend ยังทำงานอยู่
router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;
