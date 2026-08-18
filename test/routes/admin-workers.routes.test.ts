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

/* -------------------------------------- Test Helpers -------------------------------------- */

// Function จัดการ login job admin สำหรับ test
async function loginJobAdmin(accountId: number): Promise<{ token: string }> {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(accountId, passwordHash);
  state.adminPermissions.set(admin.id, ["workers:read"]);

  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  assert.equal(login.status, 200);

  return {
    token: login.body.access_token,
  };
}

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

/* -------------------------------------- Admin Users Route Tests -------------------------------------- */

test("GET /api/admin/users returns Phone alongside existing fields for every worker", async () => {
  const { token } = await loginJobAdmin(9700);
  const worker = addWorker(9701);
  worker.phone = "0899999999";

  const response = await server.request("GET", "/api/admin/users", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);

  const item = response.body.data[0];

  assert.deepEqual(Object.keys(item).sort(), [
    "full_name",
    "phone",
    "shirt_number",
    "status",
    "updated_at",
    "work_schedule",
    "work_start_date",
    "worker_code",
  ]);
  assert.equal(item.worker_code, worker.username);
  assert.equal(item.full_name, worker.full_name);
  assert.equal(item.phone, "0899999999");
  assert.equal(item.shirt_number, worker.shirt_number);
  assert.equal(item.status, worker.status);
});

test("GET /api/admin/users returns Phone as null when the worker has none on file", async () => {
  const { token } = await loginJobAdmin(9710);
  const worker = addWorker(9711);
  worker.phone = null;

  const response = await server.request("GET", "/api/admin/users", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data[0].worker_code, worker.username);
  assert.equal(response.body.data[0].phone, null);
});

test("GET /api/admin/users/:workerCode detail still returns Phone under details (unchanged)", async () => {
  const { token } = await loginJobAdmin(9720);
  const worker = addWorker(9721);
  worker.phone = "0888888888";

  const response = await server.request(
    "GET",
    `/api/admin/users/${worker.username}`,
    { token }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.details.phone, "0888888888");
});
