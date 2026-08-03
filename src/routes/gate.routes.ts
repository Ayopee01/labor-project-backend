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

export default router;
