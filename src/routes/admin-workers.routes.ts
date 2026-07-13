// import Library
import express from "express";

// import Middleware
import authMiddleware from "../middlewares/auth.middleware";
import permissionMiddleware from "../middlewares/permission.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import { normalizeCreateUserMultipartBody, uploadWorkerImage } from "../middlewares/upload.middleware";

// import Service
import * as adminWorkersService from "../services/admin-workers.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

// Route สร้าง worker พร้อม profile, schedule และรูปภาพถ้ามี
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

// Route ดึงรายการ worker สำหรับหน้า Admin Workers
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

// Route ดึงรายละเอียด worker รายคนด้วย worker_code หรือ username
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

// Route แก้ไขข้อมูล worker จากหน้า Admin Workers
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

// Route reset password ของ worker และ revoke session เดิม
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

export default router;
