// import Library
import express from "express";
// import 
import authMiddleware from "../middlewares/auth.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import * as userService from "../services/user.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

router.post(
  "/",
  async (req, res, next) => {
    try {
      const result = await userService.createUser(req.body, req.auth);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/",
  async (req, res, next) => {
    try {
      const result = await userService.listUsers(req.query, req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:id",
  async (req, res, next) => {
    try {
      const result = await userService.getUser(String(req.params.id), req.auth);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:id",
  async (req, res, next) => {
    try {
      const result = await userService.updateUser(
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
  async (req, res, next) => {
    try {
      const result = await userService.resetPassword(
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
  async (req, res, next) => {
    try {
      const result = await userService.listWorkSchedules(
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

export default router;
