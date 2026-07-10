// import Library
import express from "express";
// import Middleware
import driverSessionMiddleware from "../middlewares/driver-session.middleware";
// import Service
import * as driverService from "../services/driver.service";

const router = express.Router();

router.post(
  "/qr-sessions",
  async (req, res, next) => {
    try {
      const result = await driverService.createDriverSessionFromQr(req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/jobs/current",
  driverSessionMiddleware,
  async (req, res, next) => {
    try {
      const result = await driverService.getDriverCurrentJob(req.driverSession);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/jobs/:id/ready",
  driverSessionMiddleware,
  async (req, res, next) => {
    try {
      const result = await driverService.markDriverJobReady(
        req.params.id,
        req.driverSession
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
