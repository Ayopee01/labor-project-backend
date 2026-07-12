import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addAdmin,
  addWorker,
  getPassword,
  resetRouteTestState,
  restoreRouteTestLoader,
  startRouteTestServer,
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

/* -------------------------------------- Auth Route Tests -------------------------------------- */

// Test endpoint login ฝั่ง admin ว่าไม่ต้องส่ง device_id/device_name เพราะตัดสิน flow จาก account.role
test("POST /api/auth/login allows admin login without device fields", async () => {
  // Step Arrange เตรียม admin account ที่ active
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(9001, passwordHash);

  // Step Act เรียก endpoint login ของจริงผ่าน route
  const response = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  // Step Assert admin login ได้ token และไม่มี worker profile/schedule
  assert.equal(response.status, 200);
  assert.equal(response.body.account.id, admin.id);
  assert.equal(response.body.account.role, "admin");
  assert.equal(response.body.profile, null);
  assert.equal(response.body.current_work_schedule, null);
  assert.ok(response.body.access_token);
  assert.ok(response.body.refresh_token);
});

// Test endpoint login ฝั่ง worker ว่าต้องส่ง device_id/device_name สำหรับ mobile session
test("POST /api/auth/login requires device fields for worker login", async () => {
  // Step Arrange เตรียม worker account ที่ active
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1001, passwordHash);

  // Step Act เรียก login โดยไม่ส่ง device_id/device_name
  const response = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
    },
  });

  // Step Assert worker login ต้องถูก reject ด้วย validation error
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

// Test endpoint /me ว่าดึง account/profile/schedule จาก access token และ active session ได้ถูกต้อง
test("GET /api/auth/me returns current worker account from access token", async () => {
  // Step Arrange login worker ผ่าน route เพื่อให้ได้ token/session จริง
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

  // Step Act เรียก /me ด้วย access token ที่ได้จาก login route
  const response = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  // Step Assert middleware auth/session และ auth service คืนข้อมูล worker ถูกต้อง
  assert.equal(response.status, 200);
  assert.equal(response.body.account.id, worker.id);
  assert.equal(response.body.account.role, "worker");
  assert.equal(response.body.profile.worker_code, `W${worker.id}`);
});

// Test endpoint refresh ว่า refresh token เดิมสร้าง token ชุดใหม่ให้ active session ได้
test("POST /api/auth/refresh rotates refresh token for active session", async () => {
  // Step Arrange login worker เพื่อสร้าง active session และ refresh token
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

  // Step Act ขอ token ชุดใหม่ด้วย refresh token
  const response = await server.request("POST", "/api/auth/refresh", {
    body: {
      refresh_token: login.body.refresh_token,
    },
  });

  // Step Assert ได้ access/refresh token ใหม่ครบถ้วน
  assert.equal(response.status, 200);
  assert.equal(response.body.token_type, "Bearer");
  assert.ok(response.body.access_token);
  assert.ok(response.body.refresh_token);
});

// Test endpoint logout ว่า revoke session แล้ว access token เดิมใช้เรียก /me ต่อไม่ได้
test("POST /api/auth/logout revokes current session and prevents /me reuse", async () => {
  // Step Arrange login worker เพื่อให้ได้ access token ที่มี session active
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

  // Step Act logout ด้วย token เดิม
  const logout = await server.request("POST", "/api/auth/logout", {
    token: login.body.access_token,
  });
  const meAfterLogout = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  // Step Assert session ถูก revoke และ token เดิมใช้เรียก protected route ต่อไม่ได้
  assert.equal(logout.status, 200);
  assert.equal(logout.body.message, "Logged out successfully.");
  assert.equal(meAfterLogout.status, 401);
  assert.equal(meAfterLogout.body.code, "INVALID_TOKEN");
});

// Test endpoint login worker ซ้ำคนละ device ว่าต้องคืน force-login challenge ก่อนแทน session เดิม
test("POST /api/auth/login returns force-login challenge when worker logs in from another device", async () => {
  // Step Arrange login worker ครั้งแรกจาก device A
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

  // Step Act login ซ้ำจาก device B
  const response = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-b",
      device_name: "Worker Mobile B",
    },
  });

  // Step Assert ระบบไม่สร้าง session ใหม่ทันที แต่คืน challenge ให้ยืนยัน force login
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "ACTIVE_SESSION_EXISTS");
  assert.ok(response.body.login_challenge_token);
  assert.equal(response.body.active_device.device_id, "mobile-a");
});

// Test endpoint confirm-force ว่า challenge token สามารถ revoke session เก่าและสร้าง session ใหม่ได้
test("POST /api/auth/login/confirm-force replaces old worker session", async () => {
  // Step Arrange login device A แล้วขอ challenge จาก device B
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

  // Step Act confirm force login ด้วย challenge token
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

  // Step Assert ได้ token ใหม่ และ session เก่าถูก revoke
  assert.equal(response.status, 200);
  assert.ok(response.body.access_token);
  assert.equal(oldMe.status, 401);
  assert.equal(oldMe.body.code, "INVALID_TOKEN");
});

// Test route middleware ว่า worker token ไม่สามารถเข้า admin endpoint ได้
test("worker token cannot access admin worker route", async () => {
  // Step Arrange login worker
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

  // Step Act ใช้ worker token เรียก admin route
  const response = await server.request("GET", "/api/admin/users", {
    token: login.body.access_token,
  });

  // Step Assert role middleware ต้องปฏิเสธ
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "FORBIDDEN");
});
