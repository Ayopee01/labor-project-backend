import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canManagePermissionLevel,
  getPermissionLevelOrder,
  isAdminPermission,
  isAdminPermissionLevel,
} from "../../../src/config/permission.config";

/* -------------------------------------- Permission Config Tests -------------------------------------- */

// Test ตรวจว่า config permission รู้จักสิทธิ์ admin ที่ระบบรองรับ และ reject สิทธิ์ที่ไม่มีจริง
test("permission config recognizes supported admin permissions and rejects unknown values", () => {
  // Step Assert permission ที่ระบบรองรับต้องผ่าน และค่าที่ไม่มีใน config ต้องไม่ผ่าน
  assert.equal(isAdminPermission("workers:read"), true);
  assert.equal(isAdminPermission("gate_clients:rotate_secret"), true);
  assert.equal(isAdminPermission("permissions:update"), true);
  assert.equal(isAdminPermission("unknown:permission"), false);
});

// Test ตรวจลำดับ permission_level ของ admin เพื่อใช้ตัดสินสิทธิ์จัดการ admin คนอื่น
test("permission config orders admin levels from highest to lowest rank", () => {
  // Step Assert index น้อยกว่าคือ rank สูงกว่า และ level ที่ไม่รู้จักต้องเป็น -1
  assert.equal(getPermissionLevelOrder("owner"), 0);
  assert.equal(getPermissionLevelOrder("manager"), 1);
  assert.equal(getPermissionLevelOrder("supervisor"), 2);
  assert.equal(getPermissionLevelOrder("unknown"), -1);
});

// Test ตรวจ rule ว่า admin จัดการได้เฉพาะ permission_level ที่ต่ำกว่าตัวเอง
test("permission config only allows higher rank admin to manage lower rank admin", () => {
  // Step Assert owner จัดการ manager/supervisor ได้ แต่ manager จัดการ owner หรือ rank เดียวกันไม่ได้
  assert.equal(canManagePermissionLevel("owner", "manager"), true);
  assert.equal(canManagePermissionLevel("owner", "supervisor"), true);
  assert.equal(canManagePermissionLevel("manager", "supervisor"), true);
  assert.equal(canManagePermissionLevel("manager", "manager"), false);
  assert.equal(canManagePermissionLevel("manager", "owner"), false);
  assert.equal(canManagePermissionLevel("supervisor", "manager"), false);
});

// Test ตรวจว่า permission_level มีเฉพาะฝั่ง admin และไม่รับค่า worker/null เป็น admin level
test("permission config recognizes supported admin permission levels", () => {
  // Step Assert รับเฉพาะ permission_level ที่ระบบกำหนด
  assert.equal(isAdminPermissionLevel("owner"), true);
  assert.equal(isAdminPermissionLevel("manager"), true);
  assert.equal(isAdminPermissionLevel("supervisor"), true);
  assert.equal(isAdminPermissionLevel("worker"), false);
  assert.equal(isAdminPermissionLevel(null), false);
});
