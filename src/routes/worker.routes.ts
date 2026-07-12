// import Library
import express from "express";
// import Middleware
import authMiddleware from "../middlewares/auth.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
// import Service
import * as workerService from "../services/worker.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["worker"]));

// Route ให้ worker เข้า queue และพร้อมรับงาน
router.post(
  "/me/online",
  async (req, res, next) => {
    try {
      const result = await workerService.workerOnline(req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ให้ worker ออกจาก queue
router.post(
  "/me/offline",
  async (req, res, next) => {
    try {
      const result = await workerService.workerOffline(req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ให้ worker พักชั่วคราวตาม runtime settings
router.post(
  "/me/break",
  async (req, res, next) => {
    try {
      const result = await workerService.workerBreak(req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ดึงสถานะ queue และ assignment ปัจจุบันของ worker
router.get(
  "/me/status",
  async (req, res, next) => {
    try {
      const result = await workerService.getWorkerStatus(req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ดึงประวัติงานของ worker ตามวันที่
router.get(
  "/me/assignments/history",
  async (req, res, next) => {
    try {
      const result = await workerService.listWorkerAssignmentHistory(
        req.query,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ให้ worker รับ assignment
router.post(
  "/me/assignments/:id/accept",
  async (req, res, next) => {
    try {
      const result = await workerService.acceptWorkerAssignment(
        req.params.id,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ให้ worker scan QR เพื่อ check-in เข้างาน
router.post(
  "/me/assignments/:id/check-in-qr",
  async (req, res, next) => {
    try {
      const result = await workerService.scanWorkerAssignment(
        req.params.id,
        req.body,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ให้ worker ส่งยอดปิดงานระดับ ticket
router.post(
  "/me/tickets/:id/complete",
  async (req, res, next) => {
    try {
      const result = await workerService.completeWorkerTicket(
        req.params.id,
        req.body,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
