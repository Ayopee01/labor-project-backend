import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addAdmin,
  addGateClient,
  addMobileAppVersion,
  getPassword,
  getWorkerDispatch,
  resetRouteTestState,
  restoreRouteTestLoader,
  startRouteTestServer,
  state,
  type TestServer,
} from "../helpers/app-test-harness";

let server: TestServer;
let password: typeof import("../../src/utils/password");
let workerDispatch: typeof import("../../src/queues/worker-dispatch");

/* -------------------------------------- Test Lifecycle -------------------------------------- */

before(async () => {
  password = await getPassword();
  workerDispatch = await getWorkerDispatch();
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

// Function จัดการ login admin สำหรับ test
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
    "settings:read",
    "settings:update",
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

test("POST /api/admin/admins allows owner to create lower level admin", async () => {
  const { token } = await loginAdmin(9101, "owner");

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

test("POST /api/admin/admins rejects creating equal level admin", async () => {
  const { token } = await loginAdmin(9102, "manager");

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

/* -------------------------------------- Mobile App Version Route Tests -------------------------------------- */

// Function หา delayed job release notification ของ Version หนึ่งจาก queue จำลอง สำหรับ test
function findReleaseNotificationJob(mobileAppVersionId: number) {
  const jobs = state.queueJobs.get(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string);

  return jobs?.get(`mobile-app-release-notification-${mobileAppVersionId}`);
}

// Function หา delayed job force-update notification ของ Version หนึ่งจาก queue จำลอง สำหรับ test
function findForceUpdateNotificationJob(mobileAppVersionId: number) {
  const jobs = state.queueJobs.get(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string);

  return jobs?.get(`mobile-app-force-update-notification-${mobileAppVersionId}`);
}

// Function จำลองเวลาถึง ReleaseNotificationAt โดยเรียก processor ตรงๆ (แบบเดียวกับ pattern เดิม
// ที่ใช้จำลอง assignment/vendor-confirm timeout ทั่วทั้ง test suite นี้) แทนการรอ BullMQ จริง
async function fireReleaseNotificationJob(mobileAppVersionId: number): Promise<void> {
  workerDispatch.startAssignmentTimeoutProcessing();
  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);

  assert.ok(processor, "Assignment timeout processor must be registered.");
  await processor({
    data: {
      mobileAppVersionId,
      kind: "mobile_app_release_notification",
    },
  });
}

// Function จำลองเวลาถึง ForceUpdateAt โดยเรียก processor ตรงๆ สำหรับ force-update notification job
async function fireForceUpdateNotificationJob(mobileAppVersionId: number): Promise<void> {
  workerDispatch.startAssignmentTimeoutProcessing();
  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);

  assert.ok(processor, "Assignment timeout processor must be registered.");
  await processor({
    data: {
      mobileAppVersionId,
      kind: "mobile_app_force_update_notification",
    },
  });
}

test("GET /api/admin/mobile-app-versions classifies rows into current/scheduled/history by time", async () => {
  const { token } = await loginAdmin(9501, "owner");
  const pastActivation = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const futureActivation = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  addMobileAppVersion({
    version: "1.2.0",
    build_number: 10200,
    force_update_at: pastActivation,
  });
  const current = addMobileAppVersion({
    version: "1.3.0",
    build_number: 10300,
    force_update_at: pastActivation,
  });
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: futureActivation,
  });

  const response = await server.request("GET", "/api/admin/mobile-app-versions", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.current.id, current.id);
  assert.equal(response.body.current.status, "current");
  assert.equal(response.body.scheduled.id, scheduled.id);
  assert.equal(response.body.scheduled.status, "scheduled");
  assert.equal(response.body.history.length, 1);
  assert.equal(response.body.history[0].version, "1.2.0");
  assert.equal(response.body.history[0].status, "history");
});

test("POST /api/admin/mobile-app-versions creates a scheduled version without affecting the current one", async () => {
  const { token } = await loginAdmin(9502, "owner");

  addMobileAppVersion({ version: "1.3.0", build_number: 10300 });

  const response = await server.request("POST", "/api/admin/mobile-app-versions", {
    token,
    body: {
      version: "1.4.0",
      build_number: 10400,
      android_download_url: "https://play.google.com/store/apps/details?id=worker",
      ios_download_url: "https://apps.apple.com/app/id123456789",
      release_message: "Please update by the deadline.",
      release_notes: "Improved dispatch and notifications.",
      force_update_at: "2026-08-25T15:00:00.000Z",
      release_notification_at: "2026-08-24T02:00:00.000Z",
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.status, "scheduled");
  assert.equal(response.body.version, "1.4.0");

  const overview = await server.request("GET", "/api/admin/mobile-app-versions", {
    token,
  });

  assert.equal(overview.body.current.version, "1.3.0");
  assert.equal(overview.body.scheduled.version, "1.4.0");
});

test("POST /api/admin/mobile-app-versions rejects a duplicate BuildNumber", async () => {
  const { token } = await loginAdmin(9503, "owner");

  addMobileAppVersion({ version: "1.3.0", build_number: 10300 });

  const response = await server.request("POST", "/api/admin/mobile-app-versions", {
    token,
    body: {
      version: "1.3.1",
      build_number: 10300,
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "BUILD_NUMBER_ALREADY_EXISTS");
});

test("POST /api/admin/mobile-app-versions rejects ReleaseNotificationAt later than ForceUpdateAt", async () => {
  const { token } = await loginAdmin(9508, "owner");

  const response = await server.request("POST", "/api/admin/mobile-app-versions", {
    token,
    body: {
      version: "1.4.0",
      build_number: 10400,
      force_update_at: "2026-08-22T15:00:00.000Z",
      release_notification_at: "2026-08-23T02:00:00.000Z",
    },
  });

  assert.equal(response.status, 400);
});

test("PATCH /api/admin/mobile-app-versions/:id allows changing Version/BuildNumber while still scheduled", async () => {
  const { token } = await loginAdmin(9505, "owner");
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${scheduled.id}`,
    {
      token,
      body: {
        version: "1.4.1",
        build_number: 10401,
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.version, "1.4.1");
  assert.equal(response.body.build_number, 10401);
  assert.equal(response.body.status, "scheduled");
});

test("PATCH /api/admin/mobile-app-versions/:id rejects changing Version/BuildNumber once it is current", async () => {
  const { token } = await loginAdmin(9506, "owner");
  const current = addMobileAppVersion({ version: "1.3.0", build_number: 10300 });

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${current.id}`,
    {
      token,
      body: {
        version: "1.3.9",
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "MOBILE_APP_VERSION_LOCKED");
});

test("PATCH /api/admin/mobile-app-versions/:id reschedules the ReleaseNotificationAt BullMQ job to the latest time", async () => {
  const { token } = await loginAdmin(9507, "owner");
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: "2026-08-25T15:00:00.000Z",
    release_notification_at: "2026-08-24T02:00:00.000Z",
  });

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${scheduled.id}`,
    {
      token,
      body: {
        // ReleaseNotificationAt is one of two independent timestamps that each have their own
        // attached BullMQ job (release pre-notice vs force-update-now); "current" activation is
        // still derived live from server time on every read/check, never from either job.
        release_notification_at: "2026-08-24T05:00:00.000Z",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.release_notification_at, "2026-08-24T05:00:00.000Z");
  assert.equal(response.body.release_notification_sent_at, null);

  const job = findReleaseNotificationJob(scheduled.id);

  assert.ok(job);
  assert.equal(job?.data && (job.data as { mobileAppVersionId?: number }).mobileAppVersionId, scheduled.id);
});

test("PATCH /api/admin/mobile-app-versions/:id reschedules the ForceUpdateAt force-update notification job to the latest time", async () => {
  const { token } = await loginAdmin(9514, "owner");
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: "2026-08-25T15:00:00.000Z",
  });

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${scheduled.id}`,
    {
      token,
      body: {
        force_update_at: "2026-08-26T09:00:00.000Z",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.force_update_at, "2026-08-26T09:00:00.000Z");
  assert.equal(response.body.force_update_notification_sent_at, null);

  const job = findForceUpdateNotificationJob(scheduled.id);

  assert.ok(job);
  assert.equal(job?.data && (job.data as { mobileAppVersionId?: number }).mobileAppVersionId, scheduled.id);
});

test("PATCH /api/admin/mobile-app-versions/:id clearing ForceUpdateAt removes the force-update notification job", async () => {
  const { token } = await loginAdmin(9515, "owner");
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: "2026-08-25T15:00:00.000Z",
  });

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${scheduled.id}`,
    {
      token,
      body: {
        force_update_at: null,
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.force_update_at, null);

  const job = findForceUpdateNotificationJob(scheduled.id);

  assert.ok(!job || job.removed);
});

test("POST /api/admin/mobile-app-versions with ReleaseNotificationAt left null sends the release notification now but does not activate the version", async () => {
  const { token } = await loginAdmin(9509, "owner");

  addMobileAppVersion({ version: "1.3.0", build_number: 10300 });

  const response = await server.request("POST", "/api/admin/mobile-app-versions", {
    token,
    body: {
      version: "1.4.0",
      build_number: 10400,
      force_update_at: "2026-12-25T15:00:00.000Z",
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.release_notification_at, null);
  assert.ok(
    response.body.release_notification_sent_at,
    "release_notification_sent_at must be set immediately.",
  );
  assert.equal(response.body.force_update_notification_sent_at, null);
  assert.equal(findReleaseNotificationJob(response.body.id), undefined);
  assert.ok(findForceUpdateNotificationJob(response.body.id));

  const overview = await server.request("GET", "/api/admin/mobile-app-versions", {
    token,
  });

  // ส่ง Release Notification ทันทีแล้ว แต่ Version ยังไม่ Active เพราะ ForceUpdateAt อยู่ในอนาคต
  assert.equal(overview.body.current.version, "1.3.0");
  assert.equal(overview.body.scheduled.version, "1.4.0");
});

test("POST /api/admin/mobile-app-versions with ReleaseNotificationAt set does not send yet and creates a delayed job", async () => {
  const { token } = await loginAdmin(9510, "owner");
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const response = await server.request("POST", "/api/admin/mobile-app-versions", {
    token,
    body: {
      version: "1.4.0",
      build_number: 10400,
      release_notification_at: tomorrow,
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.release_notification_sent_at, null);

  const job = findReleaseNotificationJob(response.body.id);

  assert.ok(job);
  assert.equal(job?.removed, false);
});

test("scheduled release notification sends FCM and sets ReleaseNotificationSentAt once ReleaseNotificationAt is reached, without activating the version", async () => {
  const { token } = await loginAdmin(9511, "owner");

  addMobileAppVersion({ version: "1.3.0", build_number: 10300 });
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: "2026-12-25T15:00:00.000Z",
    release_notification_at: "2026-12-24T02:00:00.000Z",
  });

  await fireReleaseNotificationJob(scheduled.id);

  assert.ok(
    scheduled.release_notification_sent_at,
    "release_notification_sent_at must be set after the job fires.",
  );

  const overview = await server.request("GET", "/api/admin/mobile-app-versions", {
    token,
  });

  // FCM ส่งแล้วแต่ Version ยังไม่ Active เพราะยังไม่ถึง ForceUpdateAt
  assert.equal(overview.body.current.version, "1.3.0");
  assert.equal(overview.body.scheduled.version, "1.4.0");

  const check = await server.request(
    "GET",
    "/api/workers/app-version/check?platform=android&version=1.3.0&build_number=10300",
  );

  assert.equal(check.body.status, "UP_TO_DATE");
});

test("force-update notification sends a standard-pattern-only FCM and sets ForceUpdateNotificationSentAt once ForceUpdateAt is reached", async () => {
  const { token } = await loginAdmin(9516, "owner");

  addMobileAppVersion({ version: "1.3.0", build_number: 10300 });
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: "2026-12-25T15:00:00.000Z",
    release_message: "This should not appear in the force-update notification.",
  });

  await fireForceUpdateNotificationJob(scheduled.id);

  assert.ok(
    scheduled.force_update_notification_sent_at,
    "force_update_notification_sent_at must be set after the job fires.",
  );
  // Release Notification ยังคนละ tracker กัน ยิงคนละครั้งกัน ไม่เกี่ยวกัน
  assert.equal(scheduled.release_notification_sent_at, null);
});

test("PATCH /api/admin/mobile-app-versions/:id setting ReleaseNotificationAt to null removes the job and sends now", async () => {
  const { token } = await loginAdmin(9512, "owner");
  const scheduled = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    release_notification_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${scheduled.id}`,
    {
      token,
      body: {
        release_notification_at: null,
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.release_notification_at, null);
  assert.ok(response.body.release_notification_sent_at);

  const job = findReleaseNotificationJob(scheduled.id);

  assert.ok(!job || job.removed);
});

test("PATCH /api/admin/mobile-app-versions/:id never resends FCM once ReleaseNotificationSentAt is already set", async () => {
  const { token } = await loginAdmin(9513, "owner");
  const alreadySent = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    release_notification_sent_at: new Date().toISOString(),
  });
  const sentAtBefore = alreadySent.release_notification_sent_at;

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${alreadySent.id}`,
    {
      token,
      body: {
        release_message: "Updated release message text.",
        release_notification_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.release_message, "Updated release message text.");
  // ReleaseNotificationSentAt ต้องไม่เปลี่ยน (ไม่ส่งซ้ำ) แม้ Admin จะแก้เวลากลับไปเป็น scheduled
  assert.equal(response.body.release_notification_sent_at, sentAtBefore);
  assert.equal(findReleaseNotificationJob(alreadySent.id), undefined);
});

test("PATCH /api/admin/mobile-app-versions/:id never resends the force-update FCM once ForceUpdateNotificationSentAt is already set", async () => {
  const { token } = await loginAdmin(9517, "owner");
  const alreadySent = addMobileAppVersion({
    version: "1.4.0",
    build_number: 10400,
    force_update_at: "2026-08-25T15:00:00.000Z",
    force_update_notification_sent_at: new Date().toISOString(),
  });
  const sentAtBefore = alreadySent.force_update_notification_sent_at;

  const response = await server.request(
    "PATCH",
    `/api/admin/mobile-app-versions/${alreadySent.id}`,
    {
      token,
      body: {
        force_update_at: "2026-08-26T09:00:00.000Z",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.force_update_at, "2026-08-26T09:00:00.000Z");
  // ForceUpdateNotificationSentAt ต้องไม่เปลี่ยน (ไม่ส่งซ้ำ) แม้ Admin จะเลื่อนเวลาใหม่
  assert.equal(response.body.force_update_notification_sent_at, sentAtBefore);
  assert.equal(findForceUpdateNotificationJob(alreadySent.id), undefined);
});
