// Import Library
import express from "express";
// Import Middleware
import authMiddleware from "../middlewares/auth.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
// Import Services
import * as notificationsService from "../services/notifications.service";
import * as workerService from "../services/worker.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["worker"]));

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

router.get(
  "/me/earnings/summary",
  async (req, res, next) => {
    try {
      const result = await workerService.getWorkerEarningsSummary(
        req.query,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/me/notifications",
  async (req, res, next) => {
    try {
      const result = await notificationsService.listWorkerNotifications(
        req.query,
        req.auth,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/me/assignments/:ticketNumber/accept",
  async (req, res, next) => {
    try {
      const result = await workerService.acceptWorkerAssignment(
        req.params.ticketNumber,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/me/assignments/:ticketNumber/check-in-qr",
  async (req, res, next) => {
    try {
      const result = await workerService.scanWorkerAssignment(
        req.params.ticketNumber,
        req.body,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/me/assignments/:ticketNumber/tickets/complete",
  async (req, res, next) => {
    try {
      const result =
        await workerService.completeWorkerAssignmentTicketFromBody(
          req.params.ticketNumber,
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
