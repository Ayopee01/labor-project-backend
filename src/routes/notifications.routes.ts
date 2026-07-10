// import Library
import express from "express";
// import Middleware
import authMiddleware from "../middlewares/auth.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
// import Service
import * as notificationsService from "../services/notifications.service";

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  sessionMiddleware,
  roleMiddleware(["admin"]),
  (req, res, next) => {
    try {
      if (!req.auth) {
        throw new Error("Authentication payload is missing.");
      }

      notificationsService.subscribeAdminEvents(res, req.auth);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
