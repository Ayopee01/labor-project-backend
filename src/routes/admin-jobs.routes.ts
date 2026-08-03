// Import Library
import express from "express";
// Import Middleware
import authMiddleware from "../middlewares/auth.middleware";
import permissionMiddleware from "../middlewares/permission.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";

// Import Services
import * as adminJobsService from "../services/admin-jobs.service";
import * as adminWorkersService from "../services/admin-workers.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

router.get(
  "/jobs/workers/status",
  permissionMiddleware(["jobs:read"]),
  async (_req, res, next) => {
    try {
      const result = await adminWorkersService.listAdminWorkerStatuses();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/jobs/workers/:workerCode/status/force",
  permissionMiddleware(["workers:force_status"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.forceAdminWorkerStatus(
        req.params.workerCode,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/jobs/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelJob(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/vehicle-jobs/operations",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.listVehicleJobOperations(req.query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/vehicle-jobs/history",
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

router.post(
  "/vehicle-jobs/:ticketNo/assign-workers",
  permissionMiddleware(["jobs:assign"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.assignVehicleJobWorkers(
        req.params.ticketNo,
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:ticketNo/scan-deadline/extend",
  permissionMiddleware(["jobs:extend_deadline"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.extendVehicleJobScanDeadline(
        req.params.ticketNo,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:ticketNo/workers/:workerCode/assignment/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelAssignment(
        req.params.ticketNo,
        req.params.workerCode,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
