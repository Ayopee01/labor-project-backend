import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addAdmin,
  addDispatchableJob,
  addGateClient,
  addPendingAssignment,
  addTicketForVehicleJob,
  addWorker,
  getPassword,
  getTicketFinancialService,
  getWorkerDispatch,
  getWorkerQueue,
  resetRouteTestState,
  restoreRouteTestLoader,
  startRouteTestServer,
  state,
  type TestServer,
} from "../helpers/app-test-harness";

let server: TestServer;
let password: typeof import("../../src/utils/password");
let workerQueue: typeof import("../../src/queues/worker-queue");
let workerDispatch: typeof import("../../src/queues/worker-dispatch");
let ticketFinancialService: typeof import("../../src/services/shared/ticket-financial.service");

/* -------------------------------------- Test Helpers -------------------------------------- */

// Function เธเธฑเธ”เธเธฒเธฃ login worker เธชเธณเธซเธฃเธฑเธ test
async function loginWorker(accountId: number): Promise<{ token: string; worker: ReturnType<typeof addWorker> }> {
  const passwordHash = await password.hashPassword("Worker@123456");
  const worker = addWorker(accountId, passwordHash);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: worker.username,
      password: "Worker@123456",
      device_id: `mobile-${accountId}`,
      device_name: "Worker Mobile",
    },
  });

  assert.equal(login.status, 200);

  return {
    token: login.body.access_token,
    worker,
  };
}

// Function เธชเธฃเนเธฒเธ gate vehicle job body เธชเธณเธซเธฃเธฑเธ test
function buildGateVehicleJobBody(suffix: string) {
  return {
    TicketNo: `TKT-20260723-${suffix}`,
    TicketCreatedAt: "2026-07-23T14:30:00+07:00",
    BoothCount: 1,
    MarketCode: `MARKET-${suffix}`,
    LicensePlate: `ABC-${suffix}`,
    VehicleTypeCode: "PICKUP",
    VehicleTypeName: "Pickup truck",
    Booths: [
      {
        BoothCode: `STALL-${suffix}`,
        Products: [
          {
            ProductCode: "02020300",
            PackageCode: "29",
            Quantity: 180,
          },
        ],
      },
    ],
    Dispatch: true,
  };
}

// Function เธเธฑเธ”เธเธฒเธฃ gate auth headers เธชเธณเธซเธฃเธฑเธ test
async function gateAuthHeaders(
  clientId = "gate-test",
  clientSecret = "GateSecret@123456",
  status: "active" | "inactive" = "active"
): Promise<Record<string, string>> {
  if (!state.gateClients.has(clientId)) {
    addGateClient(clientId, await password.hashPassword(clientSecret), status);
  }

  return {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
  };
}

// Function เธเธฑเธ”เธเธฒเธฃ login job admin เธชเธณเธซเธฃเธฑเธ test
async function loginJobAdmin(accountId: number): Promise<{ token: string }> {
  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(accountId, passwordHash);
  state.adminPermissions.set(admin.id, [
    "jobs:read",
    "jobs:assign",
    "jobs:cancel",
    "workers:force_status",
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
  };
}

function bangkokDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function bangkokDateToUtcIso(date: string, hour = 1): string {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000+07:00`).toISOString();
}

function addAuditAssignment(input: {
  id: number;
  workerId: number;
  vehicleJobId: number;
  createdAt: string;
  status?: string;
  acceptedAt?: string | null;
  scannedAt?: string | null;
  completedAt?: string | null;
  events?: string[];
}) {
  const assignment = {
    id: input.id,
    vehicle_job_id: input.vehicleJobId,
    worker_account_id: input.workerId,
    status: input.status ?? "PENDING",
    accept_deadline_at: null,
    scan_deadline_at: null,
    accepted_at: input.acceptedAt ?? null,
    scanned_at: input.scannedAt ?? null,
    completed_at: input.completedAt ?? null,
    created_at: input.createdAt,
    updated_at: input.completedAt ?? input.createdAt,
  };

  state.assignments.push(assignment);
  for (const eventType of input.events ?? []) {
    state.workerAssignmentEvents.push({
      id: state.nextWorkerAssignmentEventId++,
      assignment_id: assignment.id,
      worker_account_id: assignment.worker_account_id,
      vehicle_job_id: assignment.vehicle_job_id,
      event_type: eventType,
      occurred_at: assignment.updated_at,
      metadata: null,
      created_at: assignment.updated_at,
    });
  }

  return assignment;
}

/* -------------------------------------- Test Lifecycle -------------------------------------- */

before(async () => {
  password = await getPassword();
  workerQueue = await getWorkerQueue();
  workerDispatch = await getWorkerDispatch();
  ticketFinancialService = await getTicketFinancialService();
  server = await startRouteTestServer();
});

beforeEach(() => {
  resetRouteTestState();
});

after(async () => {
  await server.close();
  restoreRouteTestLoader();
});

/* -------------------------------------- Gate Route Tests -------------------------------------- */

test("GET /api/admin/audit/workers/performance aggregates today's Bangkok assignment cohort", async () => {
  const { token } = await loginJobAdmin(12001);
  const today = bangkokDateKey();
  const todayAt = bangkokDateToUtcIso(today, 1);
  const yesterdayAt = new Date(new Date(`${today}T00:00:00.000+07:00`).getTime() - 60_000).toISOString();
  const workerA = addWorker(12002, "hash");
  const workerB = addWorker(12003, "hash");
  const workerNull = addWorker(12004, "hash");
  addDispatchableJob(120020, 1);
  addDispatchableJob(120030, 1);
  addDispatchableJob(120040, 1);

  addAuditAssignment({
    id: 1200201,
    workerId: workerA.id,
    vehicleJobId: 120020,
    createdAt: todayAt,
    status: "COMPLETED",
    acceptedAt: todayAt,
    scannedAt: todayAt,
    completedAt: todayAt,
    events: ["ACCEPTED", "COMPLETED"],
  });
  addAuditAssignment({
    id: 1200202,
    workerId: workerA.id,
    vehicleJobId: 120020,
    createdAt: todayAt,
    status: "TIMEOUT",
  });
  addAuditAssignment({
    id: 1200203,
    workerId: workerA.id,
    vehicleJobId: 120020,
    createdAt: todayAt,
    status: "TIMEOUT",
    acceptedAt: todayAt,
    events: ["SCAN_TIMEOUT"],
  });
  addAuditAssignment({
    id: 1200301,
    workerId: workerB.id,
    vehicleJobId: 120030,
    createdAt: todayAt,
    status: "COMPLETED",
    acceptedAt: todayAt,
    scannedAt: todayAt,
    completedAt: todayAt,
  });
  addAuditAssignment({
    id: 1200302,
    workerId: workerB.id,
    vehicleJobId: 120030,
    createdAt: todayAt,
    status: "ACCEPTED",
    acceptedAt: todayAt,
  });
  addAuditAssignment({
    id: 1200401,
    workerId: workerNull.id,
    vehicleJobId: 120040,
    createdAt: todayAt,
    status: "CANCELLED",
    events: ["ADMIN_CANCELLED"],
  });
  addAuditAssignment({
    id: 1200999,
    workerId: workerB.id,
    vehicleJobId: 120030,
    createdAt: yesterdayAt,
    status: "TIMEOUT",
  });

  const response = await server.request(
    "GET",
    "/api/admin/audit/workers/performance",
    { token }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.period, {
    date_from: today,
    date_to: today,
    timezone: "Asia/Bangkok",
  });
  assert.deepEqual(response.body.pagination, {
    page: 1,
    limit: 20,
    total: 3,
    totalPages: 1,
  });
  assert.equal(response.body.data[0].worker_code, workerB.username);
  assert.equal(response.body.data[0].acceptRate, "100.00");
  assert.equal(response.body.data[1].worker_code, workerA.username);
  assert.equal(response.body.data[1].totalAssignedJobCount, 3);
  assert.equal(response.body.data[1].acceptedJobCount, 2);
  assert.equal(response.body.data[1].acceptTimeoutJobCount, 1);
  assert.equal(response.body.data[1].scanTimeoutJobCount, 1);
  assert.equal(response.body.data[1].completed_job_count, 1);
  assert.equal(response.body.data[1].acceptRate, "66.67");
  assert.equal(response.body.data[2].worker_code, workerNull.username);
  assert.equal(response.body.data[2].adminCancelledJobCount, 1);
  assert.equal(response.body.data[2].acceptRate, null);
  assert.equal("issue_count" in response.body.data[0], false);
  assert.equal("completionRate" in response.body.data[0], false);
  assert.equal("earnings" in response.body.data[0], false);
});

test("GET /api/admin/audit/workers/performance supports date range, worker filter, sorting, and pagination after aggregate", async () => {
  const { token } = await loginJobAdmin(12101);
  const workerA = addWorker(12102, "hash");
  const workerB = addWorker(12103, "hash");
  const workerNoHistory = addWorker(12104, "hash");
  addDispatchableJob(121020, 1);
  addDispatchableJob(121030, 1);
  const rangeAt = bangkokDateToUtcIso("2026-08-15", 10);
  const outsideAt = bangkokDateToUtcIso("2026-09-01", 1);

  addAuditAssignment({
    id: 1210201,
    workerId: workerA.id,
    vehicleJobId: 121020,
    createdAt: rangeAt,
    status: "TIMEOUT",
  });
  addAuditAssignment({
    id: 1210202,
    workerId: workerA.id,
    vehicleJobId: 121020,
    createdAt: rangeAt,
    status: "TIMEOUT",
    acceptedAt: rangeAt,
  });
  addAuditAssignment({
    id: 1210301,
    workerId: workerB.id,
    vehicleJobId: 121030,
    createdAt: rangeAt,
    status: "COMPLETED",
    acceptedAt: rangeAt,
    completedAt: rangeAt,
  });
  addAuditAssignment({
    id: 1210302,
    workerId: workerB.id,
    vehicleJobId: 121030,
    createdAt: outsideAt,
    status: "COMPLETED",
    acceptedAt: outsideAt,
    completedAt: outsideAt,
  });

  const filtered = await server.request(
    "GET",
    `/api/admin/audit/workers/performance?worker_code=${workerA.username}&date_from=2026-08-01&date_to=2026-08-31`,
    { token }
  );

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.pagination.total, 1);
  assert.equal(filtered.body.data[0].worker_code, workerA.username);
  assert.equal(filtered.body.data[0].totalAssignedJobCount, 2);
  assert.equal(filtered.body.data[0].scanTimeoutJobCount, 1);
  assert.equal(filtered.body.data[0].acceptRate, "50.00");

  const sorted = await server.request(
    "GET",
    "/api/admin/audit/workers/performance?date_from=2026-08-01&date_to=2026-08-31&sort_by=total_assigned&sort_order=asc&page=1&limit=1",
    { token }
  );

  assert.equal(sorted.status, 200);
  assert.equal(sorted.body.pagination.total, 2);
  assert.equal(sorted.body.pagination.totalPages, 2);
  assert.equal(sorted.body.data.length, 1);
  assert.notEqual(sorted.body.data[0].worker_code, workerNoHistory.username);
});

test("GET /api/admin/audit/workers/performance keeps total on empty pages beyond the last page", async () => {
  const { token } = await loginJobAdmin(12401);
  const date = "2026-08-20";
  const createdAt = bangkokDateToUtcIso(date, 9);

  for (let index = 0; index < 25; index += 1) {
    const worker = addWorker(12402 + index, "hash");
    const vehicleJobId = 124020 + index;

    addDispatchableJob(vehicleJobId, 1);
    addAuditAssignment({
      id: 1240200 + index,
      workerId: worker.id,
      vehicleJobId,
      createdAt,
      status: "COMPLETED",
      acceptedAt: createdAt,
      scannedAt: createdAt,
      completedAt: createdAt,
      events: ["ACCEPTED", "COMPLETED"],
    });
  }

  const pageTwo = await server.request(
    "GET",
    `/api/admin/audit/workers/performance?date_from=${date}&date_to=${date}&page=2&limit=20`,
    { token },
  );

  assert.equal(pageTwo.status, 200);
  assert.deepEqual(pageTwo.body.pagination, {
    page: 2,
    limit: 20,
    total: 25,
    totalPages: 2,
  });
  assert.equal(pageTwo.body.data.length, 5);

  const pageThree = await server.request(
    "GET",
    `/api/admin/audit/workers/performance?date_from=${date}&date_to=${date}&page=3&limit=20`,
    { token },
  );

  assert.equal(pageThree.status, 200);
  assert.deepEqual(pageThree.body.pagination, {
    page: 3,
    limit: 20,
    total: 25,
    totalPages: 2,
  });
  assert.deepEqual(pageThree.body.data, []);
});

test("GET /api/admin/audit/workers/performance validates date pairs and sort whitelist", async () => {
  const { token } = await loginJobAdmin(12201);

  for (const query of [
    "date_from=2026-08-01",
    "date_to=2026-08-31",
    "date_from=2026-09-01&date_to=2026-08-31",
    "sort_by=issue_count",
    "sort_order=sideways",
  ]) {
    const response = await server.request(
      "GET",
      `/api/admin/audit/workers/performance?${query}`,
      { token }
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION_ERROR");
  }
});

test("GET /api/admin/audit/workers/performance requires admin jobs:read permission", async () => {
  const unauthenticated = await server.request(
    "GET",
    "/api/admin/audit/workers/performance"
  );

  assert.equal(unauthenticated.status, 401);

  const workerLogin = await loginWorker(12301);
  const workerResponse = await server.request(
    "GET",
    "/api/admin/audit/workers/performance",
    { token: workerLogin.token }
  );

  assert.equal(workerResponse.status, 403);

  const passwordHash = await password.hashPassword("Admin@123456");
  const admin = addAdmin(12302, passwordHash);
  state.adminPermissions.set(admin.id, []);
  const login = await server.request("POST", "/api/auth/login", {
    body: {
      username: admin.username,
      password: "Admin@123456",
    },
  });

  assert.equal(login.status, 200);
  const forbidden = await server.request(
    "GET",
    "/api/admin/audit/workers/performance",
    { token: login.body.access_token }
  );

  assert.equal(forbidden.status, 403);
});
