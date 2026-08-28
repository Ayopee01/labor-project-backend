import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { addAdmin, addWorker, getPassword, resetRouteTestState, restoreRouteTestLoader, startRouteTestServer, state, type TestServer } from "../helpers/app-test-harness";

// ตั้ง UPLOAD_DIR ให้ชี้ไปที่โฟลเดอร์ย่อยใต้ uploads/ (gitignored อยู่แล้ว) ก่อน src/app.ts และ
// upload.middleware.ts ถูก import จริงใน startRouteTestServer() — ป้องกันไม่ให้ test เขียนไฟล์รูป
// จริงเข้าไปปนกับ uploads/workers ที่ใช้งานจริง
process.env.UPLOAD_DIR = "uploads/test-tmp";

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

test("POST /api/auth/login rejects a nonexistent username with the same error as a wrong password (no account-existence leak)", async () => {
  const response = await server.request("POST", "/api/auth/login", {
    body: {
      username: "no-such-admin-9999",
      password: "AnyPassword@123456",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, "INVALID_CREDENTIALS");
});

test("POST /api/auth/login is rate-limited separately and more strictly than the general /api/auth/* limit", async () => {
  // ทั้งไฟล์ตั้ง LOGIN_RATE_LIMIT_MAX_REQUESTS ไว้สูงมาก (ดู applyIsolatedTestEnv) เพื่อกัน false
  // 429 จากการที่เทสต์อื่นๆ login จริงกันเยอะ — เทสต์นี้ต้องการยืนยันพฤติกรรม rate limit เอง จึงต้อง
  // override กลับเป็นค่าต่ำที่รู้ตัวเลขแน่นอนเฉพาะเทสต์นี้ แล้วคืนค่าเดิมก่อนออกเสมอ
  const previousLimit = process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS;

  process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS = "10";

  try {
    const passwordHash = await password.hashPassword("Admin@123456");
    const admin = addAdmin(9006, passwordHash);
    const attempt = () =>
      server.request("POST", "/api/auth/login", {
        body: { username: admin.username, password: "WrongPassword@123456" },
      });

    const responses = [];

    for (let i = 0; i < 11; i += 1) {
      responses.push(await attempt());
    }

    const statuses = responses.map((response) => response.status);

    assert.ok(statuses.slice(0, 10).every((status) => status === 401));
    assert.equal(statuses[10], 429);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS;
    } else {
      process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS = previousLimit;
    }
  }
});

test("an authenticated request is rejected mid-session once the account's status becomes inactive, even though the session row itself is still active", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(9004, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  assert.equal(login.status, 200);

  const before = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(before.status, 200);

  // จำลองบัญชีถูกปิดใช้งานผ่านช่องทางที่ไม่ผ่าน endpoint ปกติ (เช่น script แก้ DB ตรงๆ) โดยไม่ได้
  // revoke session — session row ยัง is_active=true และ token ยังไม่หมดอายุ
  admin.status = "inactive";

  const after = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(after.status, 401);
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
    "image_url",
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
  // ยังไม่เคยอัปโหลดรูป ต้องเป็น null เสมอ ไม่ใช่การละ field ทิ้ง (Frontend ต้องแยก "ยังไม่มีรูป"
  // ออกจาก response รุ่นเก่าที่ไม่มี contract นี้ได้)
  assert.equal(response.body.image_url, null);
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
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.nationality, "Thai");
  assert.equal(response.body.shirt_number, String(worker.id));
  assert.equal(response.body.shirt_type, "standard");
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

test("PATCH /api/auth/me updates the current admin's own full_name/email/phone and returns the refreshed profile", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(1020, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const update = await server.request("PATCH", "/api/auth/me", {
    token: login.body.access_token,
    body: {
      full_name: "Updated Admin Name",
      email: "updated@simmummuang.local",
      phone: "089-999-9999",
    },
  });

  assert.equal(update.status, 200);
  assert.equal(update.body.full_name, "Updated Admin Name");
  assert.equal(update.body.email, "updated@simmummuang.local");
  assert.equal(update.body.phone, "089-999-9999");

  const me = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(me.body.full_name, "Updated Admin Name");
  assert.equal(me.body.email, "updated@simmummuang.local");
  assert.equal(me.body.phone, "089-999-9999");
});

test("PATCH /api/auth/me clears email/phone when sent as null, and leaves them unchanged when omitted", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(1025, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const clearEmail = await server.request("PATCH", "/api/auth/me", {
    token: login.body.access_token,
    body: { email: null },
  });

  assert.equal(clearEmail.status, 200, JSON.stringify(clearEmail.body));
  assert.equal(clearEmail.body.email, null);
  // phone ไม่ได้ส่งมาในรอบนี้ ต้องไม่ถูกแตะ
  assert.equal(clearEmail.body.phone, admin.phone);

  const clearPhone = await server.request("PATCH", "/api/auth/me", {
    token: login.body.access_token,
    body: { phone: null },
  });

  assert.equal(clearPhone.status, 200, JSON.stringify(clearPhone.body));
  assert.equal(clearPhone.body.phone, null);
  // email ที่เพิ่งล้างไปรอบก่อน ต้องยังเป็น null ต่อเนื่อง ไม่ถูกเดากลับมา
  assert.equal(clearPhone.body.email, null);

  const me = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(me.body.email, null);
  assert.equal(me.body.phone, null);
});

test("PATCH /api/auth/me treats an empty string for email/phone as \"leave unchanged\", not as clear", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(1026, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const response = await server.request("PATCH", "/api/auth/me", {
    token: login.body.access_token,
    body: { email: "", phone: "" },
  });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.email, admin.email);
  assert.equal(response.body.phone, admin.phone);
});

test("PATCH /api/auth/me is rejected for a worker token (admin-only self-service)", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1021, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-1021",
      device_name: "Worker Mobile",
    },
  });

  const update = await server.request("PATCH", "/api/auth/me", {
    token: login.body.access_token,
    body: {
      full_name: "Should not apply",
    },
  });

  assert.equal(update.status, 403);
});

test("POST /api/auth/me/upload-image stores the file under uploads/admins and persists image_url", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(1022, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
    "avatar.jpg",
  );

  const response = await server.request("POST", "/api/auth/me/upload-image", {
    token: login.body.access_token,
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.image_url.startsWith("/uploads/admins/"));
  assert.ok(response.body.image_url.endsWith(".jpg"));

  const me = await server.request("GET", "/api/auth/me", {
    token: login.body.access_token,
  });

  assert.equal(me.status, 200);
  // ต้องโหลดรูปกลับมาได้จาก GET /api/auth/me เสมอ ไม่พึ่ง cache ฝั่ง Frontend (เช่น หลัง logout/login
  // หรือเปิดจาก device ใหม่)
  assert.equal(me.body.image_url, response.body.image_url);
});

test("POST /api/auth/me/upload-image rejects a non-image file", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(1023, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" }),
    "document.pdf",
  );

  const response = await server.request("POST", "/api/auth/me/upload-image", {
    token: login.body.access_token,
    body: formData,
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_IMAGE_TYPE");
});

test("POST /api/auth/me/upload-image ignores a spoofed filename extension and always stores an image extension derived from the validated Content-Type", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(1024, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e])], {
      type: "image/jpeg",
    }),
    "pwn.html",
  );

  const response = await server.request("POST", "/api/auth/me/upload-image", {
    token: login.body.access_token,
    body: formData,
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.image_url.endsWith(".jpg"));
  assert.ok(!response.body.image_url.includes(".html"));
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

test("PATCH /api/auth/me/password rejects a new password shorter than 8 characters", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(9003, passwordHash);
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
      new_password: "short1",
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
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

test("POST /api/auth/refresh rejects a refresh token once the session's hash has already moved on to a different value", async () => {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(1005, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: "mobile-1005",
      device_name: "Worker Mobile",
    },
  });

  // จำลองว่ามีอีก request ที่ถือ refresh token เดิมชนะ race ไปก่อนแล้ว (rotate hash ของ session
  // นี้ไปเป็นค่าใหม่ที่ request นี้ไม่รู้จัก) — ยืนยัน safety property ปลายทางที่ต้องคงอยู่เสมอไม่ว่า
  // จะมาจาก race จริงหรือ token เก่าที่หลุดมาใช้ซ้ำ: request ที่ถือ hash ที่ไม่ตรงกับปัจจุบันของ
  // session ต้องถูกปฏิเสธเสมอ ไม่ใช่ได้ session ใหม่ไปแบบเงียบๆ (การจำลอง interleaving ของ 2
  // request จริงๆ ทำไม่ได้แม่นยำใน test harness นี้เพราะ mock เก็บ session เป็น object reference
  // เดียวที่ใช้ร่วมกัน ต่างจาก Postgres จริงที่แต่ละ transaction เห็น snapshot ของตัวเอง — ส่วนการ
  // รับประกันไม่ให้ race นี้เกิดจริงอยู่ที่ conditional update ใน updateRefreshTokenHash โดยตรง)
  const session = Array.from(state.sessions.values()).find(
    (item) => item.account_id === worker.id,
  );

  assert.ok(session);
  session.refresh_token_hash = "hmac-sha256$some-other-rotated-hash";

  const response = await server.request("POST", "/api/auth/refresh", {
    body: { refresh_token: login.body.refresh_token },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, "INVALID_REFRESH_TOKEN");
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
