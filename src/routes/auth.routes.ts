// Import Library
import express from "express";
// Import Dependencies
import authMiddleware from "../middlewares/auth.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import { loginRateLimitMiddleware } from "../middlewares/security.middleware";
import { uploadAdminImage } from "../middlewares/upload.middleware";
import * as authService from "../services/auth.service";
import ApiError from "../utils/api-error";

const router = express.Router();

router.post(
  "/login",
  loginRateLimitMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/login/confirm-force",
  loginRateLimitMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.confirmForceLogin(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/refresh",
  async (req, res, next) => {
    try {
      const result = await authService.refresh(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/logout",
  authMiddleware,
  sessionMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.logout(req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ลงทะเบียนหรือ refresh FCM token ให้ Worker Mobile เมื่อ login ไม่ได้ส่ง token มา
router.post(
  "/push-token",
  authMiddleware,
  sessionMiddleware,
  roleMiddleware(["worker"]),
  async (req, res, next) => {
    try {
      const result = await authService.registerWorkerPushToken(
        req.auth,
        req.session,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route ดึง profile ของ account ปัจจุบันจาก access token ที่ใช้งานอยู่
router.get(
  "/me",
  authMiddleware,
  sessionMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.me(req.auth, req.session);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/me/password",
  authMiddleware,
  sessionMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.changeOwnPassword(req.auth, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/me/lang",
  authMiddleware,
  sessionMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.updateOwnLang(req.auth, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route แก้ไขข้อมูลส่วนตัว (full_name/email/phone) ของ Admin ที่ login อยู่เอง
router.patch(
  "/me",
  authMiddleware,
  sessionMiddleware,
  roleMiddleware(["admin"]),
  async (req, res, next) => {
    try {
      const result = await authService.updateOwnProfile(
        req.auth,
        req.session,
        req.body
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route อัปโหลดรูปโปรไฟล์ของ Admin ที่ login อยู่เอง
router.post(
  "/me/upload-image",
  authMiddleware,
  sessionMiddleware,
  roleMiddleware(["admin"]),
  uploadAdminImage.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(400, "IMAGE_FILE_REQUIRED", "Image file is required.");
      }

      const imageUrl = `/uploads/admins/${req.file.filename}`;
      const result = await authService.uploadOwnProfileImage(req.auth, imageUrl);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
