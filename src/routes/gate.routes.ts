// import Library
import express from "express";
// import Service
import * as gateService from "../services/gate.service";

const router = express.Router();

// Route รับงานรถจาก Gate mock payload
router.post(
  "/vehicle-jobs",
  async (req, res, next) => {
    try {
      const result = await gateService.createVehicleJobFromGate(req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
