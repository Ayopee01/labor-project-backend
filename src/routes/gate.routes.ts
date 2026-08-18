// Import Library
import express from "express";
// Import Middleware
import gateClientAuthMiddleware from "../middlewares/gate-client-auth.middleware";
// Import Services
import * as gateService from "../services/gate.service";

const router = express.Router();

// Route รับ ticket หนึ่งใบจาก Gate และสร้างหรือ replay งานแรงงานที่ตรงกัน
router.post(
  "/tickets",
  gateClientAuthMiddleware,
  async (req, res, next) => {
    try {
      const result = await gateService.createVehicleJobFromGate(req.body);
      res.status(result.Result === "REPLAYED" ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ปิดรับ Business Ticket เพิ่มของ TicketNumber นี้แบบ explicit เมื่อ Gate ไม่สามารถ
// บอกจำนวน Ticket ทั้งหมดล่วงหน้าผ่าน TicketCount ได้
router.post(
  "/vehicle-jobs/:ticketNumber/close",
  gateClientAuthMiddleware,
  async (req, res, next) => {
    try {
      const result = await gateService.closeVehicleJobTickets(req.params.ticketNumber);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// TEST HELPER: ใช้สำหรับ Postman / Swagger / Gate integration testing
// Route ดึงรายการตลาด แผงค้า สินค้า และแพ็กเกจสำหรับช่วยสร้าง Gate request
router.get(
  "/options",
  gateClientAuthMiddleware,
  async (req, res, next) => {
    try {
      const result = await gateService.getGateOptions(req.query);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;