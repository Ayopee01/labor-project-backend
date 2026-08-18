import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addAdmin,
  addWorker,
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

/* -------------------------------------- Auth Config Tests -------------------------------------- */

test("POST /api/auth/login allows admin login without device fields", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(9001, passwordHash);

  const response = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "access_token",
    "expires_in",
    "refresh_token",
    "token_type",
  ]);
  assert.equal(response.body.account, undefined);
  assert.ok(response.body.access_token);
  assert.ok(response.body.refresh_token);
});

test("GET /api/auth/me returns only the admin profile fields", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(1, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const response = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "admin_code",
    "email",
    "employee_code",
    "full_name",
    "lang",
    "latest_active_at",
    "permission_level",
    "permissions",
    "phone",
    "position",
    "role",
    "status",
  ]);
  assert.equal(response.body.full_name, admin.full_name);
  assert.equal(response.body.role, "admin");
  assert.equal(response.body.employee_code, "ADM0001");
  assert.equal(response.body.position, admin.position);
  assert.equal(response.body.admin_code, "ADM0001");
  assert.equal(response.body.status, "active");
  assert.equal(response.body.email, admin.email);
  assert.equal(response.body.phone, admin.phone);
  assert.equal(response.body.lang, "TH");
  assert.equal(response.body.permission_level, "manager");
  assert.ok(response.body.permissions.includes("admins:create"));
  assert.ok(response.body.latest_active_at);
});

test("POST /api/auth/login requires device fields for worker login", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1001, passwordHash);

  const response = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("GET /api/auth/me returns current worker account from access token", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1002, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-1002",
      device_name: "Worker Mobile",
    },
  });

  assert.equal(login.status, 200);
  assert.deepEqual(Object.keys(login.body).sort(), [
    "access_token",
    "expires_in",
    "refresh_token",
    "token_type",
  ]);
  assert.equal(login.body.account, undefined);

  const response = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "full_name",
    "lang",
    "nationality",
    "phone",
    "role",
    "shift",
    "shirt_number",
    "shirt_type",
    "work_start_date",
    "worker_code",
  ]);
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.role, "worker");
  assert.equal(response.body.employee_code, `W${worker.id}`);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.nationality, "Thai");
  assert.equal(response.body.work_start_date, "2026-01-01");
  assert.equal(response.body.phone, worker.phone);
  assert.equal(response.body.lang, "TH");
  assert.equal(response.body.shift.start_time, "00:00");
  assert.equal(response.body.shift.end_time, "23:59");
});

test("PATCH /api/auth/me/lang updates current account language", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1008, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-1008",
      device_name: "Worker Mobile",
    },
  });

  const update = await server.request("PATCH", "/api/auth/me/lang", {
    token: login.body.access_token,
    body: {
      lang: "EN",
    },
  });

  assert.equal(update.status, 200);
  assert.deepEqual(update.body, {
    message: "Language updated successfully.",
    lang: "EN",
  });

  const me = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(me.body.lang, "EN");
});

test("worker auth flow stores, refreshes, and revokes FCM token by WorkerCode", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1010, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-push-1010",
      device_name: "Worker Mobile",
      fcm_token: "fcm-token-1010-a",
      platform: "android",
    },
  });

  assert.equal(login.status, 200);
  assert.equal(state.workerPushTokens.length, 1);
  assert.equal(state.workerPushTokens[0].worker_code, worker.username);
  assert.equal(state.workerPushTokens[0].device_id, "mobile-push-1010");
  assert.equal(state.workerPushTokens[0].platform, "android");
  assert.equal(state.workerPushTokens[0].fcm_token, "fcm-token-1010-a");
  assert.equal(state.workerPushTokens[0].is_active, true);

  const refreshPushToken = await server.request("POST", "/api/auth/push-token", {
    token: login.body.access_token,
    body: {
      fcm_token: "fcm-token-1010-b",
      platform: "android",
    },
  });

  assert.equal(refreshPushToken.status, 200);
  assert.equal(refreshPushToken.body.code, "WORKER_PUSH_TOKEN_REGISTERED");
  assert.equal(refreshPushToken.body.worker_code, worker.username);
  assert.equal(refreshPushToken.body.device_id, "mobile-push-1010");
  assert.equal(refreshPushToken.body.platform, "android");
  assert.equal(state.workerPushTokens.length, 1);
  assert.equal(state.workerPushTokens[0].fcm_token, "fcm-token-1010-b");

  const logout = await server.request("POST", "/api/auth/logout", {
    token: login.body.access_token,
  });

  assert.equal(logout.status, 200);
  assert.equal(state.workerPushTokens[0].is_active, false);
});

test("worker can register FCM token after login when token was not available during auth", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1011, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-push-1011",
      device_name: "Worker Mobile",
    },
  });

  assert.equal(login.status, 200);
  assert.equal(state.workerPushTokens.length, 0);

  const registerPushToken = await server.request("POST", "/api/auth/push-token", {
    token: login.body.access_token,
    body: {
      fcm_token: "fcm-token-1011-late",
      platform: "ios",
    },
  });

  assert.equal(registerPushToken.status, 200);
  assert.equal(registerPushToken.body.code, "WORKER_PUSH_TOKEN_REGISTERED");
  assert.equal(registerPushToken.body.worker_code, worker.username);
  assert.equal(registerPushToken.body.device_id, "mobile-push-1011");
  assert.equal(registerPushToken.body.platform, "ios");
  assert.equal(state.workerPushTokens.length, 1);
  assert.equal(state.workerPushTokens[0].worker_code, worker.username);
  assert.equal(state.workerPushTokens[0].fcm_token, "fcm-token-1011-late");
});

test("PATCH /api/auth/me/password changes own password and keeps current session active", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(9002, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const response = await server.request("PATCH", "/api/auth/me/password", {
    token: login.body.access_token,
    body: {
      current_password: "Admin@123456",
      new_password: "Admin@654321",
    },
  });
  const meAfterChange = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });
  const oldPasswordLogin = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });
  const newPasswordLogin = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@654321",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.message, "Password changed successfully.");
  assert.equal(meAfterChange.status, 200);
  assert.equal(oldPasswordLogin.status, 401);
  assert.equal(oldPasswordLogin.body.code, "INVALID_CREDENTIALS");
  assert.equal(newPasswordLogin.status, 200);
});

test("POST /api/auth/refresh rotates refresh token for active session", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1003, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-1003",
      device_name: "Worker Mobile",
    },
  });

  const response = await server.request("POST", "/api/auth/refresh", {
    body: {
      refresh_token: login.body.refresh_token,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.token_type, "Bearer");
  assert.ok(response.body.access_token);
  assert.ok(response.body.refresh_token);
});

test("POST /api/auth/logout revokes current session and prevents /me reuse", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1004, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-1004",
      device_name: "Worker Mobile",
    },
  });

  const logout = await server.request("POST", "/api/auth/logout", {
    token: login.body.access_token,
  });
  const meAfterLogout = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(logout.status, 200);
  assert.equal(logout.body.message, "Logged out successfully.");
  assert.equal(meAfterLogout.status, 401);
  assert.equal(meAfterLogout.body.code, "INVALID_TOKEN");
});

test("POST /api/auth/login returns force-login challenge when worker logs in from another device", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1005, passwordHash);
  await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-a",
      device_name: "Worker Mobile A",
    },
  });

  const response = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-b",
      device_name: "Worker Mobile B",
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "ACTIVE_SESSION_EXISTS");
  assert.ok(response.body.login_challenge_token);
  assert.equal(response.body.active_device.device_id, "mobile-a");
});

test("POST /api/auth/login/confirm-force replaces old worker session", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1006, passwordHash);
  const firstLogin = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-a",
      device_name: "Worker Mobile A",
    },
  });
  const challenge = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-b",
      device_name: "Worker Mobile B",
    },
  });

  const response = await server.request("POST", "/api/auth/login/confirm-force", {
    body: {
      login_challenge_token: challenge.body.login_challenge_token,
      device_id: "mobile-b",
      device_name: "Worker Mobile B",
    },
  });
  const oldMe = await server.request("GET", "/api/auth/me", {
    token: firstLogin.body.access_token,
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.access_token);
  assert.equal(oldMe.status, 401);
  assert.equal(oldMe.body.code, "INVALID_TOKEN");
});

test("worker token cannot access admin worker route", async () => {
  // Step เตรียมข้อมูล login worker
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1007, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-1007",
      device_name: "Worker Mobile",
    },
  });

  const response = await server.request("GET", "/api/admin/users", {
    token: login.body.access_token,
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "FORBIDDEN");
});
