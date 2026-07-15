// import Library
import express from "express";
// import Service
import * as gateService from "../services/gate.service";

// Config Express router สำหรับ Gate Flow routes
const router = express.Router();

// Route รับงานรถจาก Gate mock payload
router.post(
  "/vehicle-jobs",
  async (req, res, next) => {
    try {
      const result = await gateService.createVehicleJobFromGate(req.body);
      res.status(result.result === "REPLAYED" ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
