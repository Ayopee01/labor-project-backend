// import Library
import express from "express";
// import
import authMiddleware from "../middlewares/auth.middleware";
import permissionMiddleware from "../middlewares/permission.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import * as adminSettingsService from "../services/admin-settings.service";

const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

router.get(
  "/settings",
  permissionMiddleware(["settings:read"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.listSystemSettings();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/settings",
  permissionMiddleware(["settings:update"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.updateSystemSettings(
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
  "/roles",
  permissionMiddleware(["roles:read"]),
  async (_req, res, next) => {
    try {
      const result = await adminSettingsService.listRoles();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/users/:id/permissions",
  permissionMiddleware(["permissions:read"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.getAdminUserPermissions(
        req.params.id
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/users/:id/permissions",
  permissionMiddleware(["permissions:update"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.updateAdminUserPermissions(
        req.params.id,
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
