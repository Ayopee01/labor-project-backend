import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addAdmin,
  addGateClient,
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
    "gate_clients:read",
    "gate_clients:create",
    "gate_clients:update",
    "gate_clients:rotate_secret",
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
      email: "manager01@simmummuang.local",
      phone: "081-000-0002",
      permission_level: "manager",
      permissions: ["workers:read", "workers:create"],
    },
  });

  // Step Assert account ใหม่ต้องเป็น role admin และได้ permission level/permissions ตามที่กำหนด
  assert.equal(response.status, 201);
  assert.equal(response.body.message, "Admin account created successfully.");
  assert.equal(response.body.account.role, "admin");
  assert.equal(response.body.account.username, "manager01");
  assert.equal(response.body.account.email, "manager01@simmummuang.local");
  assert.equal(response.body.account.phone, "081-000-0002");
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

test("POST /api/admin/gate-clients creates a Gate client and shows secret once", async () => {
  const { token, admin } = await loginAdmin(9151, "owner");

  const response = await server.request("POST", "/api/admin/gate-clients", {
    token,
    body: {
      client_id: "gate-north",
      name: "North Gate",
    },
  });
  const listed = await server.request("GET", "/api/admin/gate-clients", {
    token,
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.message.includes("Save client_secret now"), true);
  assert.equal(response.body.client_id, "gate-north");
  assert.equal(response.body.client_secret.startsWith("gate_live_"), true);
  assert.equal(response.body.secret_hash, undefined);
  assert.equal(state.gateClients.get("gate-north")?.created_by, admin.id);
  assert.equal(
    await password.verifyPassword(
      response.body.client_secret,
      state.gateClients.get("gate-north")?.secret_hash
    ),
    true
  );
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data[0].client_id, "gate-north");
  assert.equal(listed.body.data[0].client_secret, undefined);
  assert.equal(listed.body.data[0].secret_hash, undefined);
});

test("PATCH /api/admin/gate-clients/:clientId updates name and status", async () => {
  const { token, admin } = await loginAdmin(9152, "owner");
  addGateClient("gate-south", await password.hashPassword("GateSecret@123456"));

  const response = await server.request("PATCH", "/api/admin/gate-clients/gate-south", {
    token,
    body: {
      name: "South Gate Disabled",
      status: "inactive",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.client_id, "gate-south");
  assert.equal(response.body.name, "South Gate Disabled");
  assert.equal(response.body.status, "inactive");
  assert.equal(response.body.client_secret, undefined);
  assert.equal(response.body.secret_hash, undefined);
  assert.equal(state.gateClients.get("gate-south")?.updated_by, admin.id);
});

test("POST /api/admin/gate-clients/:clientId/secret/rotate replaces the old secret", async () => {
  const { token } = await loginAdmin(9153, "owner");
  const oldSecret = "GateSecret@123456";
  addGateClient("gate-west", await password.hashPassword(oldSecret));

  const response = await server.request(
    "POST",
    "/api/admin/gate-clients/gate-west/secret/rotate",
    { token }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.client_id, "gate-west");
  assert.equal(response.body.client_secret.startsWith("gate_live_"), true);
  assert.equal(response.body.client_secret === oldSecret, false);
  assert.equal(response.body.secret_hash, undefined);
  assert.equal(
    await password.verifyPassword(
      oldSecret,
      state.gateClients.get("gate-west")?.secret_hash
    ),
    false
  );
  assert.equal(
    await password.verifyPassword(
      response.body.client_secret,
      state.gateClients.get("gate-west")?.secret_hash
    ),
    true
  );
});

test("GET /api/admin/roles groups admin accounts by permission level", async () => {
  const { token } = await loginAdmin(9201, "owner");
  const manager = addAdmin(9202, await password.hashPassword("Admin@123456"));
  manager.permission_level = "manager";
  const supervisor = addAdmin(9203, await password.hashPassword("Admin@123456"));
  supervisor.permission_level = "supervisor";

  const response = await server.request("GET", "/api/admin/roles", {
    token,
  });

  assert.equal(response.status, 200);
  const managerRole = response.body.data.find((role: { key: string }) => role.key === "manager");
  const supervisorRole = response.body.data.find((role: { key: string }) => role.key === "supervisor");
  assert.ok(managerRole.admins.some((admin: { id: number }) => admin.id === manager.id));
  assert.ok(supervisorRole.admins.some((admin: { id: number }) => admin.id === supervisor.id));
  assert.equal(managerRole.admins[0].password_hash, undefined);
});

test("GET /api/admin/users/:id/permissions allows reading only lower level admins", async () => {
  const { token: ownerToken, admin: owner } = await loginAdmin(9301, "owner");
  const manager = addAdmin(9302, await password.hashPassword("Admin@123456"));
  manager.permission_level = "manager";
  state.adminPermissions.set(manager.id, ["workers:read"]);
  const { token: managerToken } = await loginAdmin(9303, "manager");
  const peerManager = addAdmin(9304, await password.hashPassword("Admin@123456"));
  peerManager.permission_level = "manager";

  const lowerResponse = await server.request(
    "GET",
    `/api/admin/users/${manager.id}/permissions`,
    { token: ownerToken }
  );
  const selfResponse = await server.request(
    "GET",
    `/api/admin/users/${owner.id}/permissions`,
    { token: ownerToken }
  );
  const peerResponse = await server.request(
    "GET",
    `/api/admin/users/${peerManager.id}/permissions`,
    { token: managerToken }
  );

  assert.equal(lowerResponse.status, 200);
  assert.equal(lowerResponse.body.account_id, manager.id);
  assert.equal(lowerResponse.body.status, "active");
  assert.deepEqual(lowerResponse.body.permissions, ["workers:read"]);
  assert.equal(selfResponse.status, 403);
  assert.equal(selfResponse.body.code, "CANNOT_READ_OWN_PERMISSIONS");
  assert.equal(peerResponse.status, 403);
  assert.equal(peerResponse.body.code, "TARGET_PERMISSION_LEVEL_NOT_READABLE");
});

test("PATCH /api/admin/users/:id/permissions updates lower admin status and revokes sessions", async () => {
  const { token: ownerToken } = await loginAdmin(9401, "owner");
  const { token: supervisorToken, admin: supervisor } = await loginAdmin(9402, "supervisor");

  const response = await server.request(
    "PATCH",
    `/api/admin/users/${supervisor.id}/permissions`,
    {
      token: ownerToken,
      body: {
        permission_level: "supervisor",
        status: "inactive",
        permissions: ["workers:read"],
      },
    }
  );
  const targetMeAfterPatch = await server.request("GET", "/api/auth/me", {
    token: supervisorToken,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "inactive");
  assert.equal(state.authAccountsById.get(supervisor.id)?.status, "inactive");
  assert.deepEqual(response.body.permissions, ["workers:read"]);
  assert.equal(targetMeAfterPatch.status, 401);
});
