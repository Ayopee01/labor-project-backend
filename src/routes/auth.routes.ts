// Import Library
import express from "express";
// Import Dependencies
import authMiddleware from "../middlewares/auth.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import * as authService from "../services/auth.service";

const router = express.Router();

router.post(
  "/login",
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

export default router;
