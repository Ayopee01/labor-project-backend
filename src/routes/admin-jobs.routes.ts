// import Library
import express from "express";
// import Middleware
import authMiddleware from "../middlewares/auth.middleware";
import permissionMiddleware from "../middlewares/permission.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";

// import Service
import * as adminJobsService from "../services/admin-jobs.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

router.get(
  "/vehicle-jobs",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.listVehicleJobs(req.query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/vehicle-jobs/:id",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.getVehicleJob(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:id/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelVehicleJob(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:id/cancel-and-requeue",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelVehicleJobAndRequeue(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:id/assign-workers",
  permissionMiddleware(["jobs:assign"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.assignVehicleJobWorkers(
        req.params.id,
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:id/scan-deadline/extend",
  permissionMiddleware(["jobs:extend_deadline"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.extendVehicleJobScanDeadline(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/assignments/:id/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelAssignment(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/market-jobs/:id/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelMarketJob(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/stall-jobs/:id/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelStallJob(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/stall-jobs/:id/reopen",
  permissionMiddleware(["jobs:reopen"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.reopenStallJob(
        req.params.id,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
