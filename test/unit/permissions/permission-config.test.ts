import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canManagePermissionLevel,
  getPermissionLevelOrder,
  isAdminPermission,
  isAdminPermissionLevel,
} from "../../../src/config/permission.config";

/* -------------------------------------- Permission Config Tests -------------------------------------- */

test("permission config recognizes supported admin permissions and rejects unknown values", () => {
  assert.equal(isAdminPermission("workers:read"), true);
  assert.equal(isAdminPermission("gate_clients:rotate_secret"), true);
  assert.equal(isAdminPermission("permissions:update"), true);
  assert.equal(isAdminPermission("unknown:permission"), false);
});

test("permission config orders admin levels from highest to lowest rank", () => {
  assert.equal(getPermissionLevelOrder("owner"), 0);
  assert.equal(getPermissionLevelOrder("manager"), 1);
  assert.equal(getPermissionLevelOrder("supervisor"), 2);
  assert.equal(getPermissionLevelOrder("unknown"), -1);
});

test("permission config only allows higher rank admin to manage lower rank admin", () => {
  assert.equal(canManagePermissionLevel("owner", "manager"), true);
  assert.equal(canManagePermissionLevel("owner", "supervisor"), true);
  assert.equal(canManagePermissionLevel("manager", "supervisor"), true);
  assert.equal(canManagePermissionLevel("manager", "manager"), false);
  assert.equal(canManagePermissionLevel("manager", "owner"), false);
  assert.equal(canManagePermissionLevel("supervisor", "manager"), false);
});

test("permission config recognizes supported admin permission levels", () => {
  assert.equal(isAdminPermissionLevel("owner"), true);
  assert.equal(isAdminPermissionLevel("manager"), true);
  assert.equal(isAdminPermissionLevel("supervisor"), true);
  assert.equal(isAdminPermissionLevel("worker"), false);
  assert.equal(isAdminPermissionLevel(null), false);
});
