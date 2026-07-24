// import Library
import express from "express";
// import
import authMiddleware from "../middlewares/auth.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import * as authService from "../services/auth.service";

// Config Express router สำหรับ Auth routes
const router = express.Router();

// Route login ด้วย username/password และข้อมูล client
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

// Route ยืนยัน force login เมื่อมี session เดิมบนอุปกรณ์อื่น
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

// Route ขอ access token และ refresh token ชุดใหม่
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

// Route logout และ revoke session ปัจจุบัน
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

// Route ดึงข้อมูลผู้ใช้จาก token ปัจจุบัน
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

// Route เปลี่ยน password ของ account ที่ login อยู่ ใช้ได้ทั้ง admin และ worker
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

export default router;
