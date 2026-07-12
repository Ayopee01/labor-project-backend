import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addAdmin,
  getPassword,
  resetRouteTestState,
  restoreRouteTestLoader,
  startRouteTestServer,
  state,
  type TestServer,
} from "../helpers/app-test-harness";

let server: TestServer;
let password: typeof import("../../src/utils/password");

/* -------------------------------------- Test Lifecycle -------------------------------------- */

before(async () => {
  password = await getPassword();
  server = await startRouteTestServer();
});

beforeEach(() => {
  resetRouteTestState();
});

after(async () => {
  await server.close();
  restoreRouteTestLoader();
});

/* -------------------------------------- Admin Settings Route Tests -------------------------------------- */

// Function login admin ผ่าน auth route จริง เพื่อให้ได้ token พร้อม permissions เหมือน flow จริง
async function loginAdmin(accountId: number, permissionLevel: string) {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(accountId, passwordHash);
  admin.permission_level = permissionLevel;
  state.adminPermissions.set(admin.id, [
    "admins:create",
    "permissions:read",
    "permissions:update",
    "roles:read",
    "workers:read",
  ]);

  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  assert.equal(login.status, 200);

  return {
    token: login.body.access_token,
    admin,
  };
}

// Test endpoint create admin ว่า owner สร้าง manager level ต่ำกว่า พร้อม permissions เริ่มต้นได้
test("POST /api/admin/admins allows owner to create lower level admin", async () => {
  // Step Arrange login owner ที่มี admins:create permission
  const { token } = await loginAdmin(9101, "owner");

  // Step Act เรียก endpoint สร้าง admin account ใหม่ใน Settings/Permissions flow
  const response = await server.request("POST", "/api/admin/admins", {
    token,
    body: {
      username: "manager01",
      password: "Manager@123456",
      full_name: "Branch Manager",
      position: "Manager",
      permission_level: "manager",
      permissions: ["workers:read", "workers:create"],
    },
  });

  // Step Assert account ใหม่ต้องเป็น role admin และได้ permission level/permissions ตามที่กำหนด
  assert.equal(response.status, 201);
  assert.equal(response.body.message, "Admin account created successfully.");
  assert.equal(response.body.account.role, "admin");
  assert.equal(response.body.account.username, "manager01");
  assert.equal(response.body.account.password_hash, undefined);
  assert.equal(response.body.permission_level, "manager");
  assert.deepEqual(response.body.permissions, ["workers:read", "workers:create"]);
});

// Test endpoint create admin ว่า manager level เท่ากันหรือต่ำกว่าไม่สามารถสร้าง admin level เดียวกันได้
test("POST /api/admin/admins rejects creating equal level admin", async () => {
  // Step Arrange login manager level ปกติที่มี admins:create แต่ rank ไม่สูงกว่า target admin
  const { token } = await loginAdmin(9102, "manager");

  // Step Act พยายามสร้าง admin level manager เท่ากัน
  const response = await server.request("POST", "/api/admin/admins", {
    token,
    body: {
      username: "manager02",
      password: "Manager@123456",
      full_name: "Another Manager",
      permission_level: "manager",
      permissions: ["workers:read"],
    },
  });

  // Step Assert ต้องถูก reject เพราะ actor ต้องมี permission level สูงกว่า target เท่านั้น
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "NEW_PERMISSION_LEVEL_NOT_MANAGEABLE");
});
