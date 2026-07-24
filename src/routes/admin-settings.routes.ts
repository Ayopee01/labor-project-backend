// import Library
import express from "express";
// import
import authMiddleware from "../middlewares/auth.middleware";
import permissionMiddleware from "../middlewares/permission.middleware";
import roleMiddleware from "../middlewares/role.middleware";
import sessionMiddleware from "../middlewares/session.middleware";
import * as adminSettingsService from "../services/admin-settings.service";
import * as gateClientsService from "../services/gate-clients.service";

// Config Express router สำหรับ Admin Settings routes
const router = express.Router();

router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));

// Route ดึง runtime settings ของระบบ
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

// Route แก้ไข runtime settings ของระบบ
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

// Route ดึงรายการ role และ permission level สำหรับ Admin
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

// Route สร้าง admin account ใหม่ผ่าน Settings/Permissions โดย admin ผู้สร้างต้องมี level สูงกว่า level ที่จะสร้าง
// Route ดู Gate client credentials ทั้งหมดโดยไม่แสดง secret
router.get(
  "/gate-clients",
  permissionMiddleware(["gate_clients:read"]),
  async (_req, res, next) => {
    try {
      const result = await gateClientsService.listGateClients();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route สร้าง Gate client credential และแสดง secret เฉพาะครั้งนี้
router.post(
  "/gate-clients",
  permissionMiddleware(["gate_clients:create"]),
  async (req, res, next) => {
    try {
      const result = await gateClientsService.createGateClient(req.body, req.auth);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Route แก้ชื่อหรือสถานะ Gate client
router.patch(
  "/gate-clients/:clientId",
  permissionMiddleware(["gate_clients:update"]),
  async (req, res, next) => {
    try {
      const result = await gateClientsService.updateGateClient(
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

// Route rotate secret ของ Gate client เดิมและแสดง secret ใหม่เฉพาะครั้งนี้
router.post(
  "/gate-clients/:clientId/secret/rotate",
  permissionMiddleware(["gate_clients:rotate_secret"]),
  async (req, res, next) => {
    try {
      const result = await gateClientsService.rotateGateClientSecret(
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

// Route ดึง permission ของ admin user รายคน
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

// Route แก้ไข permission ของ admin user รายคน
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
