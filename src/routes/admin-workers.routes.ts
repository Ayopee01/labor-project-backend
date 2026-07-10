// import Library
import express from "express";
// import 
import authMiddleware from "../middlewares/auth.middleware";
import permissionMiddleware from "../middlewares/permission.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import { normalizeCreateUserMultipartBody, uploadWorkerImage } from "../middlewares/upload.middleware";
import * as adminWorkersService from "../services/admin-workers.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

router.post(
  "/",
  permissionMiddleware(["workers:create"]),
  uploadWorkerImage.single("image"),
  normalizeCreateUserMultipartBody,
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.createUser(req.body, req.auth);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/",
  permissionMiddleware(["workers:read"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.listUsers(req.query, req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/worker-status",
  permissionMiddleware(["workers:read"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.listAdminWorkerStatuses();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/worker-status/:id",
  permissionMiddleware(["workers:read"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.getAdminWorkerStatus(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:id",
  permissionMiddleware(["workers:read"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.getUser(String(req.params.id), req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:id",
  permissionMiddleware(["workers:update"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.updateUser(
        String(req.params.id),
        req.body,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:id/password",
  permissionMiddleware(["workers:reset_password"]),
  async (req, res, next) => {
    try {
      const result = await adminWorkersService.resetPassword(
        String(req.params.id),
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
  "/:id/work-schedules",
  permissionMiddleware(["workers:read"]),
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

router.post(
  "/:id/worker-status/force",
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

export default router;
