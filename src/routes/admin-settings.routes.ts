// Import Library
import express from "express";
// Import Dependencies
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
  async (_req, res, next) => {
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
  "/gate-clients",
  permissionMiddleware(["gate_clients:read"]),
  async (_req, res, next) => {
    try {
      const result = await adminSettingsService.listGateClients();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/gate-clients",
  permissionMiddleware(["gate_clients:create"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.createGateClient(req.body, req.auth);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/gate-clients/:clientId",
  permissionMiddleware(["gate_clients:update"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.updateGateClient(
        req.params.clientId,
        req.body,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/gate-clients/:clientId/secret/rotate",
  permissionMiddleware(["gate_clients:rotate_secret"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.rotateGateClientSecret(
        req.params.clientId,
        req.auth
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/admins",
  permissionMiddleware(["admins:create"]),
  async (req, res, next) => {
    try {
      const result = await adminSettingsService.createAdminAccount(
        req.body,
        req.auth
      );
      res.status(201).json(result);
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
        req.params.id,
        req.auth
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
