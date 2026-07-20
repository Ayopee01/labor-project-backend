// import Library
import express from "express";
// import Middleware
import authMiddleware from "../middlewares/auth.middleware";
import permissionMiddleware from "../middlewares/permission.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";

// import Service
import * as adminJobsService from "../services/admin-jobs.service";
import * as adminWorkersService from "../services/admin-workers.service";

// Config Express router สำหรับ Admin Jobs routes
const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

// Route ดึงตารางงานปัจจุบันของ worker สำหรับบริบทงาน/คิว
router.get(
  "/jobs/workers/:id/work-schedules",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.listWorkSchedules(
        String(req.params.id),
        req.query,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ดึงสถานะ worker ทั้งหมดสำหรับหน้า monitor/dispatch
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

// Route บังคับเปลี่ยนสถานะ worker จากหน้า monitor/dispatch
router.post(
  "/jobs/workers/:id/status/force",
  permissionMiddleware(["workers:force_status"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.forceAdminWorkerStatus(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ยกเลิกงานระดับรถ/ตลาด/แผงผ่าน endpoint เดียว
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

// Route ดึงรายการงานรถสำหรับ Admin
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

// Route assign worker เข้างานรถแบบระบุรายคน
router.post(
  "/vehicle-jobs/:vehicleJobRef/assign-workers",
  permissionMiddleware(["jobs:assign"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.assignVehicleJobWorkers(
        req.params.vehicleJobRef,
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ต่อเวลา scan QR ของงานรถ
router.post(
  "/vehicle-jobs/:vehicleJobRef/scan-deadline/extend",
  permissionMiddleware(["jobs:extend_deadline"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.extendVehicleJobScanDeadline(
        req.params.vehicleJobRef,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ยกเลิก assignment รายคน
router.post(
  "/vehicle-jobs/:vehicleJobRef/workers/:workerCode/assignment/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelAssignment(
        req.params.vehicleJobRef,
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
