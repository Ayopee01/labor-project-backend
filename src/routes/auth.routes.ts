// import Library
import express from "express";
// import
import authMiddleware from "../middlewares/auth.middleware";
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

router.get(
  "/me",
  authMiddleware,
  sessionMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.me(req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
