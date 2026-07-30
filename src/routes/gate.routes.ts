// import Library
import express from "express";
// import Middleware
import gateClientAuthMiddleware from "../middlewares/gate-client-auth.middleware";
// import Service
import * as gateService from "../services/gate.service";

// Config Express router สำหรับ Gate Flow routes
const router = express.Router();

// Route receives one Gate ticket print item and creates/replays the matching labor job.
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
