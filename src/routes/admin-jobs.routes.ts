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
        req.body,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ยกเลิกรวม — scope ตัดสินจาก body ว่าระบุ ticketNo/boothCode/workerCode ตัวไหนมาบ้าง
// (ticketNumber อย่างเดียว = ทั้งคัน, +ticketNo = ทั้ง Business Ticket, +boothCode = แค่ Booth,
// +workerCode ไม่มี ticketNo = worker คนนั้นทั้งคัน, +ticketNo+workerCode ไม่มี boothCode = worker
// คนนั้นออกจาก Business Ticket ใบนั้น) แทนที่ /jobs/cancel, tickets/:ticketNo/cancel,
// stalls/:stallCode/cancel, workers/:workerCode/assignment/cancel,
// tickets/:ticketNo/workers/:workerCode/cancel เดิมทั้งหมดด้วยเส้นเดียว
router.post(
  "/vehicle-jobs/assignment/cancel",
  permissionMiddleware(["jobs:cancel"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.cancelVehicleJobAssignment(
        req.body,
        req.auth
      );
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

// Route รายได้ Worker รายวัน — อยู่ใต้ namespace /vehicle-jobs/history เดิม (ไม่สร้าง /work-history
// namespace ใหม่) เพราะเป็นรายงานที่ derive จากข้อมูล Vehicle Job History เดียวกัน
router.get(
  "/vehicle-jobs/history/daily-worker-income",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.listDailyWorkerIncome(req.query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route รายงานค่าลงสินค้าแผงค้ารายวัน — อยู่ใต้ namespace เดียวกับ daily-worker-income ด้านบนตาม
// docs/backend-missing-apis-spec V8.md ข้อ 28.7.4
router.get(
  "/vehicle-jobs/history/daily-stall-fees",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.listDailyStallFees(req.query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route รายงานค่าลงสินค้าแผงค้ารายเดือน — group ด้วย market_code+booth_code+shirt_color ต่างจาก
// daily-stall-fees ด้านบนที่ list ทีละแถว TicketProductFinancial ตรงๆ
router.get(
  "/vehicle-jobs/history/monthly-stall-fees",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.listMonthlyStallFees(req.query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/vehicle-jobs/:ticketNumber/financials",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.getVehicleJobFinancials(
        req.params.ticketNumber
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:ticketNumber/assign-workers",
  permissionMiddleware(["jobs:assign"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.assignVehicleJobWorkers(
        req.params.ticketNumber,
        req.body,
        req.auth
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/vehicle-jobs/:ticketNumber/scan-deadline/extend",
  permissionMiddleware(["jobs:extend_deadline"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.extendVehicleJobScanDeadline(
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

// Route Admin ส่ง/แก้ยอดสินค้าของ Booth หนึ่งใบแทน Worker
// ต้องระบุ ticketNo (Business Ticket) มาด้วยเสมอ เพราะ stallCode ไม่ unique ข้าม Business Ticket
// คนละตลาดของรถคันเดียวกัน (unique แค่ภายใน MarketJob เดียว) — เหมือน tickets/:ticketNo/workers/... ด้านบน
router.post(
  "/vehicle-jobs/:ticketNumber/tickets/:ticketNo/stalls/:stallCode/override-count",
  permissionMiddleware(["jobs:override_count"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.overrideTicketProductCounts(
        req.params.ticketNumber,
        req.params.ticketNo,
        req.params.stallCode,
        req.body,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route Admin สั่งให้ VehicleJob กลับไปสถานะ WAIT (รถยังไม่พร้อมเข้าจุดลงสินค้า)
router.post(
  "/vehicle-jobs/:ticketNumber/wait",
  permissionMiddleware(["jobs:wait"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.changeVehicleJobToWait(
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

// Route Admin ปล่อย Worker ทั้งทีมของ VehicleJob กลับคิวก่อนเวลา (ส่งยอดครบทุก Booth แล้ว)
router.post(
  "/vehicle-jobs/:ticketNumber/release-workers",
  permissionMiddleware(["jobs:release_workers"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.releaseVehicleJobWorkers(
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
