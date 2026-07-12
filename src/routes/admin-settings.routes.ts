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

// Route ดึง permission ของ admin user รายคน
// Route สร้าง admin account ใหม่ผ่าน Settings/Permissions โดย admin ผู้สร้างต้องมี level สูงกว่า level ที่จะสร้าง
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
        req.params.id
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
