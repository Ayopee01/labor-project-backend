import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addAdmin,
  addDispatchableJob,
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

function addHistoryAssignment(
  id: number,
  jobId: number,
  workerAccountId: number,
  createdAt: string,
) {
  const job = addDispatchableJob(jobId, 1);
  addTicketForVehicleJob(job.id, jobId * 10);
  const assignment = addPendingAssignment(id, job.id, workerAccountId);

  assignment.status = "COMPLETED";
  assignment.created_at = createdAt;
  assignment.completed_at = createdAt;
  assignment.updated_at = createdAt;

  return job;
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

test("POST /api/workers/me/online puts worker into queue", async () => {
  const { token, worker } = await loginWorker(101);
  state.connectedWorkers.add(worker.id);

  const response = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["code", "message", "statusCode"]);
  assert.equal(response.body.statusCode, 200);
  assert.equal(response.body.code, "WORKER_ONLINE_SUCCESS");
  assert.equal(response.body.message, "Worker entered queue successfully.");
  assert.equal(state.shiftAttendances.length, 1);
  assert.equal(state.shiftAttendances[0].accountId, worker.id);
  assert.ok(state.shiftAttendances[0].firstOnlineAt);
  assert.equal(state.shiftAttendances[0].closedAt, null);
});

test("POST /api/workers/me/online dispatches an existing ready job when queue was empty", async () => {
  const job = addDispatchableJob(1030, 1);
  const { token, worker } = await loginWorker(103);
  state.connectedWorkers.add(worker.id);

  const response = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["code", "message", "statusCode"]);
  assert.equal(response.body.statusCode, 200);
  assert.equal(response.body.code, "WORKER_ONLINE_SUCCESS");
  assert.equal(response.body.message, "Worker entered queue successfully.");
  assert.equal(state.assignments.length, 1);
  assert.equal(state.assignments[0].vehicle_job_id, job.id);
  assert.equal(state.assignments[0].worker_account_id, worker.id);
  assert.equal(state.assignments[0].status, "PENDING");

  const assignedEvent = state.socketEvents.find(
    (event) => event.event === "WORKER_ASSIGNED" && event.accountId === worker.id
  );
  assert.ok(assignedEvent);
  assert.equal(
    (assignedEvent.payload as { ticketNumber?: string }).ticketNumber,
    job.ticket_number
  );
});

test("GET /api/workers/me/status does not count TIMEOUT assignments", async () => {
  const { token, worker } = await loginWorker(104);
  state.connectedWorkers.add(worker.id);
  const timeoutAssignment = addPendingAssignment(10201, 1020, worker.id);
  const completedAssignment = addPendingAssignment(10202, 1021, worker.id);
  timeoutAssignment.status = "TIMEOUT";
  completedAssignment.status = "COMPLETED";
  completedAssignment.completed_at = new Date().toISOString();

  await server.request("POST", "/api/workers/me/online", {
    token,
  });
  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.today_job_count, 1);
  assert.equal(response.body.completed_job_count, 1);
});

test("GET /api/workers/me/assignments/history returns job summary without financial fields", async () => {
  const { token, worker } = await loginWorker(111);
  const acceptTimeoutJob = addDispatchableJob(1110, 1);
  const scanTimeoutJob = addDispatchableJob(1111, 1);
  const completedJob = addDispatchableJob(1112, 1);
  addTicketForVehicleJob(acceptTimeoutJob.id, 11100);
  addTicketForVehicleJob(scanTimeoutJob.id, 11110);
  addTicketForVehicleJob(completedJob.id, 11120);
  const acceptTimeoutAssignment = addPendingAssignment(11101, acceptTimeoutJob.id, worker.id);
  const scanTimeoutAssignment = addPendingAssignment(11102, scanTimeoutJob.id, worker.id);
  const completedAssignment = addPendingAssignment(11103, completedJob.id, worker.id);

  acceptTimeoutAssignment.status = "TIMEOUT";
  acceptTimeoutAssignment.accept_deadline_at = "2026-07-24T02:01:00.000Z";
  acceptTimeoutAssignment.created_at = "2026-07-24T02:00:00.000Z";
  acceptTimeoutAssignment.updated_at = "2026-07-24T02:01:00.000Z";
  scanTimeoutAssignment.status = "TIMEOUT";
  scanTimeoutAssignment.accept_deadline_at = "2026-07-24T02:01:00.000Z";
  scanTimeoutAssignment.accepted_at = "2026-07-24T02:00:30.000Z";
  scanTimeoutAssignment.scan_deadline_at = "2026-07-24T02:15:30.000Z";
  scanTimeoutAssignment.scanned_at = null;
  scanTimeoutAssignment.created_at = "2026-07-24T02:00:30.000Z";
  scanTimeoutAssignment.updated_at = "2026-07-24T02:15:30.000Z";
  completedAssignment.status = "COMPLETED";
  completedAssignment.completed_at = "2026-07-24T03:00:00.000Z";
  completedAssignment.created_at = "2026-07-24T02:30:00.000Z";
  completedAssignment.updated_at = "2026-07-24T03:00:00.000Z";

  const response = await server.request("GET", "/api/workers/me/assignments/history?date=2026-07-24", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.date, "2026-07-24");
  assert.deepEqual(response.body.summary, {
    jobCount: 3,
    acceptTimeoutJobCount: 1,
    completed_job_count: 1,
  });
  assert.equal(response.body.total_earnings, undefined);
  assert.equal(response.body.data.length, 3);
  assert.deepEqual(Object.keys(response.body.data[0]).sort(), [
    "license_plate",
    "license_plate_province",
    "markets",
    "status",
    "ticketCompletedAt",
    "ticket_number",
  ]);
  assert.equal(response.body.data[0].ticket_number, completedJob.ticket_number);
  assert.equal(response.body.data[0].status, "COMPLETED");
  assert.equal(response.body.data[0].ticketCompletedAt, completedAssignment.completed_at);
  assert.equal(response.body.data[0].markets[0].booths[0].rating, null);
  assert.equal(response.body.data[0].markets[0].booths[0].status, "WORKING");
  assert.equal(response.body.data[0].markets[0].booths[0].confirmation_status, "WORKING");
  assert.equal(response.body.data[0].markets[0].booths[0].completed_at, null);
  assert.equal(response.body.data[0].markets[0].booths[0].confirmedAt, null);
  assert.equal(response.body.data[0].markets[0].booths[0].products[0].confirmed_quantity, null);
  assert.equal(response.body.data[1].ticket_number, scanTimeoutJob.ticket_number);
  assert.equal(response.body.data[1].status, "TIMEOUT");
  assert.equal(response.body.data[2].ticket_number, acceptTimeoutJob.ticket_number);
});

test("GET /api/workers/me/assignments/history returns per-booth completed_at from GateTicket", async () => {
  const { token, worker } = await loginWorker(117);
  const job = addDispatchableJob(1171, 3);
  const firstTicket = addTicketForVehicleJob(job.id, 11710);
  const secondTicket = addTicketForVehicleJob(job.id, 11711);
  const incompleteTicket = addTicketForVehicleJob(job.id, 11712);
  const assignment = addPendingAssignment(11701, job.id, worker.id);

  firstTicket.boothCode = "BOOTH-A";
  secondTicket.boothCode = "BOOTH-B";
  incompleteTicket.boothCode = "BOOTH-C";
  firstTicket.status = "COMPLETED";
  secondTicket.status = "COMPLETED";
  incompleteTicket.status = "DELIVERED";
  firstTicket.completed_at = "2026-08-14T03:15:42.000Z";
  secondTicket.completed_at = "2026-08-14T03:30:00.000Z";
  incompleteTicket.completed_at = null;
  assignment.status = "COMPLETED";
  assignment.created_at = "2026-08-14T02:30:00.000Z";
  assignment.completed_at = "2026-08-14T04:00:00.000Z";
  assignment.updated_at = "2026-08-14T04:00:00.000Z";

  const response = await server.request("GET", "/api/workers/me/assignments/history?date=2026-08-14", {
    token,
  });

  assert.equal(response.status, 200);

  const historyItem = response.body.data.find(
    (item: { ticket_number: string }) => item.ticket_number === job.ticket_number
  );
  assert.ok(historyItem);

  const booths = historyItem.markets[0].booths;
  assert.deepEqual(
    booths.map((booth: { boothCode: string; completed_at: string | null }) => ({
      boothCode: booth.boothCode,
      completed_at: booth.completed_at,
    })),
    [
      {
        boothCode: "BOOTH-A",
        completed_at: "2026-08-14T03:15:42.000Z",
      },
      {
        boothCode: "BOOTH-B",
        completed_at: "2026-08-14T03:30:00.000Z",
      },
      {
        boothCode: "BOOTH-C",
        completed_at: null,
      },
    ]
  );
});

test("GET /api/workers/me/assignments/history filters by inclusive Bangkok date range", async () => {
  const { token, worker } = await loginWorker(113);
  const otherWorker = addWorker(213, await password.hashPassword("Worker@123456"));
  addHistoryAssignment(11301, 11301, worker.id, "2026-07-31T16:59:59.000Z");
  const firstDayJob = addHistoryAssignment(11302, 11302, worker.id, "2026-07-31T17:00:00.000Z");
  const lastDayJob = addHistoryAssignment(11303, 11303, worker.id, "2026-08-14T16:59:59.000Z");
  addHistoryAssignment(11304, 11304, worker.id, "2026-08-14T17:00:00.000Z");
  addHistoryAssignment(11305, 11305, otherWorker.id, "2026-08-10T05:00:00.000Z");

  const response = await server.request(
    "GET",
    "/api/workers/me/assignments/history?date_from=2026-08-01&date_to=2026-08-14",
    {
      token,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["data", "date", "summary"]);
  assert.equal(response.body.date, "2026-08-01");
  assert.deepEqual(
    response.body.data.map((item: { ticket_number: string }) => item.ticket_number),
    [lastDayJob.ticket_number, firstDayJob.ticket_number],
  );
  assert.deepEqual(response.body.summary, {
    jobCount: 2,
    acceptTimeoutJobCount: 0,
    completed_job_count: 2,
  });
  assert.equal(response.body.total_earnings, undefined);
});

test("GET /api/workers/me/assignments/history supports optional page and limit", async () => {
  const { token, worker } = await loginWorker(118);
  const oldestJob = addHistoryAssignment(11801, 11801, worker.id, "2026-08-16T01:00:00.000Z");
  const secondJob = addHistoryAssignment(11802, 11802, worker.id, "2026-08-16T02:00:00.000Z");
  const thirdJob = addHistoryAssignment(11803, 11803, worker.id, "2026-08-16T03:00:00.000Z");
  const newestJob = addHistoryAssignment(11804, 11804, worker.id, "2026-08-16T04:00:00.000Z");

  const response = await server.request(
    "GET",
    "/api/workers/me/assignments/history?date=2026-08-16&page=2&limit=2",
    {
      token,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.pagination, {
    page: 2,
    limit: 2,
    total: 4,
    totalPages: 2,
  });
  assert.deepEqual(response.body.summary, {
    jobCount: 4,
    acceptTimeoutJobCount: 0,
    completed_job_count: 4,
  });
  assert.deepEqual(
    response.body.data.map((item: { ticket_number: string }) => item.ticket_number),
    [secondJob.ticket_number, oldestJob.ticket_number],
  );
  assert.equal(response.body.data.some((item: { ticket_number: string }) => item.ticket_number === thirdJob.ticket_number), false);
  assert.equal(response.body.data.some((item: { ticket_number: string }) => item.ticket_number === newestJob.ticket_number), false);
});

test("GET /api/workers/me/assignments/history defaults to today's Bangkok date", async () => {
  const { token, worker } = await loginWorker(119);
  const todayBangkok = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayJob = addHistoryAssignment(
    11901,
    11901,
    worker.id,
    new Date(`${todayBangkok}T12:00:00.000+07:00`).toISOString(),
  );
  addHistoryAssignment(
    11902,
    11902,
    worker.id,
    new Date(
      new Date(`${todayBangkok}T00:00:00.000+07:00`).getTime() - 1,
    ).toISOString(),
  );

  const response = await server.request("GET", "/api/workers/me/assignments/history?limit=20", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.date, todayBangkok);
  assert.deepEqual(response.body.pagination, {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  });
  assert.deepEqual(
    response.body.data.map((item: { ticket_number: string }) => item.ticket_number),
    [todayJob.ticket_number],
  );
});

test("GET /api/workers/me/assignments/history uses Bangkok calendar boundaries for single date", async () => {
  const { token, worker } = await loginWorker(114);
  addHistoryAssignment(11401, 11401, worker.id, "2026-08-13T16:59:59.000Z");
  const bangkokDateJob = addHistoryAssignment(11402, 11402, worker.id, "2026-08-13T17:00:00.000Z");

  const response = await server.request("GET", "/api/workers/me/assignments/history?date=2026-08-14", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.data.map((item: { ticket_number: string }) => item.ticket_number),
    [bangkokDateJob.ticket_number],
  );
});

test("GET /api/workers/me/assignments/history accepts exactly 31 inclusive days", async () => {
  const { token } = await loginWorker(115);

  const response = await server.request(
    "GET",
    "/api/workers/me/assignments/history?date_from=2026-08-01&date_to=2026-08-31",
    {
      token,
    },
  );

  assert.equal(response.status, 200);
});

test("GET /api/workers/me/assignments/history rejects invalid date range queries", async () => {
  const { token } = await loginWorker(116);
  const invalidQueries = [
    "date_from=2026-08-01",
    "date_to=2026-08-14",
    "date=2026-08-14&date_from=2026-08-01&date_to=2026-08-14",
    "date_from=2026-08-14&date_to=2026-08-01",
    "date=2026-02-30",
    "date_from=2026-08-01&date_to=2026-09-01",
    "date=2026-08-14&page=0",
    "date=2026-08-14&limit=101",
  ];

  for (const query of invalidQueries) {
    const response = await server.request(
      "GET",
      `/api/workers/me/assignments/history${query ? `?${query}` : ""}`,
      {
        token,
      },
    );

    assert.equal(response.status, 400, query || "missing date query");
    assert.equal(response.body.code, "VALIDATION_ERROR");
  }
});

test("GET /api/workers/me/notifications returns current worker notification history with pagination", async () => {
  const { token, worker } = await loginWorker(120);
  const otherWorker = addWorker(220, await password.hashPassword("Worker@123456"));

  state.workerNotifications.push(
    {
      id: state.nextWorkerNotificationId++,
      worker_account_id: worker.id,
      type: "WORKER_ASSIGNED",
      notification_key: "worker.assigned",
      lang: "TH",
      title: "New assignment",
      message: "Job A is ready.",
      payload: {
        ticket_number: "JOB-A",
      },
      read_at: null,
      created_at: "2026-08-17T01:00:00.000Z",
      updated_at: "2026-08-17T01:00:00.000Z",
    },
    {
      id: state.nextWorkerNotificationId++,
      worker_account_id: worker.id,
      type: "TICKET_COMPLETION_RESULT",
      notification_key: "ticket.completion_confirmed",
      lang: "TH",
      title: "Vendor confirmed",
      message: "Stall confirmed quantities.",
      payload: {
        ticket_number: "JOB-B",
        status: "COMPLETED",
      },
      read_at: null,
      created_at: "2026-08-17T02:00:00.000Z",
      updated_at: "2026-08-17T02:00:00.000Z",
    },
    {
      id: state.nextWorkerNotificationId++,
      worker_account_id: otherWorker.id,
      type: "WORKER_ASSIGNED",
      notification_key: "worker.assigned",
      lang: "TH",
      title: "Other worker",
      message: "This should not be visible.",
      payload: null,
      read_at: null,
      created_at: "2026-08-17T03:00:00.000Z",
      updated_at: "2026-08-17T03:00:00.000Z",
    },
  );

  const response = await server.request("GET", "/api/workers/me/notifications?page=1&limit=1", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.pagination, {
    page: 1,
    limit: 1,
    total: 2,
    totalPages: 2,
  });
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].type, "TICKET_COMPLETION_RESULT");
  assert.equal(response.body.data[0].notification_key, "ticket.completion_confirmed");
  assert.equal(response.body.data[0].lang, "TH");
  assert.equal(response.body.data[0].notification.key, "ticket.completion_confirmed");
  assert.equal(response.body.data[0].notification.lang, "TH");
  assert.equal(response.body.data[0].payload.ticket_number, "JOB-B");
  assert.equal(response.body.data[0].readAt, null);
  assert.equal(response.body.data[0].created_at, "2026-08-17T02:00:00.000Z");
});

test("GET /api/workers/me/earnings/summary returns latest 15 completed days from persisted Business Ticket earnings", async () => {
  const { token, worker } = await loginWorker(112);
  const otherWorker = addWorker(212, await password.hashPassword("Worker@123456"));
  const todayBangkok = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayStart = new Date(`${todayBangkok}T00:00:00.000+07:00`);
  const atBangkokNoon = (dayOffset: number) =>
    new Date(todayStart.getTime() + dayOffset * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  const formatDisplayDate = (value: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  const yesterday = atBangkokNoon(-1);
  const today = atBangkokNoon(0);
  const tooOld = atBangkokNoon(-16);
  // firstTicket/secondTicket = สอง Business Ticket แยกกันใต้ TicketNumber เดียวกัน (รถคันเดียวกัน)
  const job = addDispatchableJob(1120, 1);
  const firstTicket = addTicketForVehicleJob(job.id, 11200, 112001);
  const secondTicket = addTicketForVehicleJob(job.id, 11201, 112002);
  const todayTicket = addTicketForVehicleJob(addDispatchableJob(1121, 1).id, 11210);
  const oldTicket = addTicketForVehicleJob(addDispatchableJob(1122, 1).id, 11220);
  const now = new Date().toISOString();
  const marketOf = (ticket: { market_job_id: number }) =>
    state.marketJobs.find((item) => item.id === ticket.market_job_id)!;
  const firstMarket = marketOf(firstTicket);
  const secondMarket = marketOf(secondTicket);
  const todayMarket = marketOf(todayTicket);
  const oldMarket = marketOf(oldTicket);

  for (const market of [firstMarket, secondMarket]) {
    market.status = "COMPLETED";
    market.completed_at = yesterday.toISOString();
    market.financialized_at = yesterday.toISOString();
  }

  todayMarket.status = "COMPLETED";
  todayMarket.completed_at = today.toISOString();
  todayMarket.financialized_at = today.toISOString();
  oldMarket.status = "COMPLETED";
  oldMarket.completed_at = tooOld.toISOString();
  oldMarket.financialized_at = tooOld.toISOString();

  state.ticketWorkers.push(
    {
      id: state.nextTicketWorkerId++,
      market_job_id: firstTicket.market_job_id,
      worker_account_id: worker.id,
      status: "COMPLETED",
      final_earning_amount: "150.00",
      joined_at: now,
      cancelled_at: null,
      completed_at: yesterday.toISOString(),
    },
    {
      id: state.nextTicketWorkerId++,
      market_job_id: secondTicket.market_job_id,
      worker_account_id: worker.id,
      status: "COMPLETED",
      final_earning_amount: "25.50",
      joined_at: now,
      cancelled_at: null,
      completed_at: yesterday.toISOString(),
    },
    {
      id: state.nextTicketWorkerId++,
      market_job_id: firstTicket.market_job_id,
      worker_account_id: otherWorker.id,
      status: "COMPLETED",
      final_earning_amount: "999.00",
      joined_at: now,
      cancelled_at: null,
      completed_at: yesterday.toISOString(),
    },
    {
      id: state.nextTicketWorkerId++,
      market_job_id: todayTicket.market_job_id,
      worker_account_id: worker.id,
      status: "COMPLETED",
      final_earning_amount: "300.00",
      joined_at: now,
      cancelled_at: null,
      completed_at: today.toISOString(),
    },
    {
      id: state.nextTicketWorkerId++,
      market_job_id: oldTicket.market_job_id,
      worker_account_id: worker.id,
      status: "COMPLETED",
      final_earning_amount: "400.00",
      joined_at: now,
      cancelled_at: null,
      completed_at: tooOld.toISOString(),
    }
  );

  const response = await server.request("GET", "/api/workers/me/earnings/summary", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.period.dayCount, 15);
  assert.equal(response.body.daily.length, 15);
  assert.equal(response.body.total_earnings, "175.50");
  assert.equal(response.body.details.length, 2);
  assert.deepEqual(
    response.body.details.map((detail: { ticket_no: string; earnings: string }) => ({
      ticket_no: detail.ticket_no,
      earnings: detail.earnings,
    })),
    [
      {
        ticket_no: firstMarket.ticket_no,
        earnings: "150.00",
      },
      {
        ticket_no: secondMarket.ticket_no,
        earnings: "25.50",
      },
    ]
  );

  const yesterdayDaily = response.body.daily.find(
    (item: { date: string }) => item.date === formatDisplayDate(yesterday)
  );
  const todayDaily = response.body.daily.find(
    (item: { date: string }) => item.date === formatDisplayDate(today)
  );

  assert.equal(yesterdayDaily?.earnings, "175.50");
  assert.equal(todayDaily, undefined);
  assert.equal(
    response.body.daily
      .reduce(
        (total: number, item: { earnings: string }) =>
          total + Number(item.earnings),
        0
      )
      .toFixed(2),
    response.body.total_earnings
  );
});

test("POST /api/workers/me/offline returns queue exit success status", async () => {
  const { token, worker } = await loginWorker(103);
  await workerQueue.enqueueWorker(worker.id);

  const response = await server.request("POST", "/api/workers/me/offline", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["code", "message", "statusCode"]);
  assert.equal(response.body.statusCode, 200);
  assert.equal(response.body.code, "WORKER_OFFLINE_SUCCESS");
  assert.equal(response.body.message, "Worker left queue successfully.");
});

test("POST /api/workers/me/online rejects re-entry after worker ends the shift", async () => {
  const { token, worker } = await loginWorker(106);
  state.connectedWorkers.add(worker.id);

  const firstOnline = await server.request("POST", "/api/workers/me/online", {
    token,
  });
  const offline = await server.request("POST", "/api/workers/me/offline", {
    token,
  });
  const secondOnline = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  assert.equal(firstOnline.status, 200);
  assert.equal(offline.status, 200);
  assert.equal(secondOnline.status, 409);
  assert.equal(secondOnline.body.code, "WORKER_SHIFT_CLOSED");
  assert.equal(state.shiftAttendances[0].closeReason, "worker_offline");
});

test("POST /api/workers/me/online uses DB attendance as the primary shift-entry guard", async () => {
  const { token, worker } = await loginWorker(107);
  state.connectedWorkers.add(worker.id);

  const firstOnline = await server.request("POST", "/api/workers/me/online", {
    token,
  });
  await workerQueue.markWorkerOpenApp(worker.id);
  const secondOnline = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  assert.equal(firstOnline.status, 200);
  assert.equal(secondOnline.status, 409);
  assert.equal(secondOnline.body.code, "WORKER_SHIFT_ONLINE_ALREADY_USED");
  assert.equal(state.shiftAttendances.length, 1);
  assert.equal(state.shiftAttendances[0].closedAt, null);
});

test("POST /api/workers/me/break returns worker break summary", async () => {
  const { token, worker } = await loginWorker(104);
  state.connectedWorkers.add(worker.id);
  await server.request("POST", "/api/workers/me/online", {
    token,
  });

  const response = await server.request("POST", "/api/workers/me/break", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "break_count_limit",
    "break_count_used",
    "full_name",
    "status",
    "worker_code",
  ]);
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.status, "break");
  assert.equal(response.body.break_count_used, 1);
  assert.equal(response.body.break_count_limit, 4);

  const breakSocketEvent = [...state.socketEvents]
    .reverse()
    .find((event) => event.event === "WORKER_STATUS_CHANGED");
  const breakSocketQueue = (
    breakSocketEvent?.payload as { queue?: Record<string, unknown> } | undefined
  )?.queue;

  assert.deepEqual(Object.keys(breakSocketQueue ?? {}).sort(), [
    "break_count_limit",
    "break_count_used",
    "break_until",
    "break_until_unix_ms",
    "created_at",
    "status",
    "updated_at",
    "worker_code",
  ]);
  assert.equal(breakSocketQueue?.worker_code, `W${worker.id}`);
  assert.equal(breakSocketQueue?.status, "break");
  assert.equal(typeof breakSocketQueue?.break_until, "string");
  assert.equal(
    breakSocketQueue?.break_until_unix_ms,
    Date.parse(String(breakSocketQueue?.break_until))
  );
  assert.equal(typeof breakSocketQueue?.created_at, "string");
  assert.equal(typeof breakSocketQueue?.updated_at, "string");
  assert.equal(breakSocketQueue?.break_count_used, 1);
  assert.equal(breakSocketQueue?.break_count_limit, 4);
});

test("POST /api/workers/me/online ends break early and removes pending break return job", async () => {
  const { token, worker } = await loginWorker(105);
  const breakQueueName = process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE as string;
  const breakReturnJobId = `worker-break-return-${worker.id}-${worker.id}`;
  state.connectedWorkers.add(worker.id);
  await server.request("POST", "/api/workers/me/online", {
    token,
  });
  await server.request("POST", "/api/workers/me/break", {
    token,
  });

  const queuedBreakJob = state.queueJobs.get(breakQueueName)?.get(breakReturnJobId);
  assert.equal(queuedBreakJob?.removed, false);

  const response = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["code", "message", "statusCode"]);
  assert.equal(response.body.statusCode, 200);
  assert.equal(response.body.code, "WORKER_ONLINE_SUCCESS");
  assert.equal(response.body.message, "Worker entered queue successfully.");
  assert.equal(queuedBreakJob?.removed, true);
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "ready");
});

test("GET /api/workers/me/status returns worker profile and shift", async () => {
  const { token, worker } = await loginWorker(102);
  await workerQueue.enqueueWorker(worker.id);

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "break_count_used",
    "completed_job_count",
    "full_name",
    "image_url",
    "nationality",
    "phone",
    "shift",
    "status",
    "today_job_count",
    "work_start_date",
    "worker_code",
  ]);
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.image_url, null);
  assert.equal(response.body.status, "ready");
  assert.equal(response.body.today_job_count, 0);
  assert.equal(response.body.break_count_used, 0);
  assert.equal(response.body.completed_job_count, 0);
  assert.equal(response.body.nationality, "Thai");
  assert.equal(response.body.work_start_date, "2026-01-01");
  assert.equal(response.body.phone, worker.phone);
  assert.equal(typeof response.body.shift.name, "string");
  assert.equal(response.body.shift.start_time, "00:00");
  assert.equal(response.body.shift.end_time, "23:59");
  assert.equal("break_until" in response.body, false);
  assert.equal("remaining_break_time" in response.body, false);
});

test("GET /api/workers/me/status returns open_app when worker is not ready yet", async () => {
  const { token } = await loginWorker(108);

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "open_app");
});

test("GET /api/workers/me/status maps pending assignment to assigned", async () => {
  const { token, worker } = await loginWorker(109);
  const teammate = addWorker(209, await password.hashPassword("Worker@123456"));
  const job = addDispatchableJob(1090, 2);
  addTicketForVehicleJob(job.id, 10900);
  const assignment = addPendingAssignment(10901, job.id, worker.id);
  const teammateAssignment = addPendingAssignment(10902, job.id, teammate.id);
  assignment.status = "ACCEPTED";
  assignment.accepted_at = "2026-07-24T02:00:00.000Z";
  assignment.scan_deadline_at = "2026-07-24T02:15:00.000Z";
  teammateAssignment.status = "SCANNED";
  teammateAssignment.scanned_at = "2026-07-24T02:10:00.000Z";

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "assigned");
  assert.equal(response.body.currentJob.ticket_number, job.ticket_number);
  assert.equal(response.body.currentJob.license_plate, job.license_plate);
  assert.equal(response.body.currentJob.license_plate_province, job.license_plate_province);
  assert.equal(response.body.currentJob.scan_deadline_at, "2026-07-24T02:15:00.000Z");
  assert.equal(
    response.body.currentJob.scan_deadline_unix_ms,
    Date.parse("2026-07-24T02:15:00.000Z")
  );
  assert.equal(response.body.currentJob.vehicle_type, job.vehicle_type);
  assert.deepEqual(response.body.currentJob.teamScan, {
    workers_required: 2,
    checked_in_count: 1,
    remainingCount: 1,
    isReady: false,
  });
  assert.equal(response.body.currentJob.markets[0].marketCode, `MARKET-${job.id}`);
  assert.equal(response.body.currentJob.markets[0].booths[0].boothCode, "STALL-10900");
  assert.equal(response.body.currentJob.markets[0].booths[0].products[0].quantity, "10");
  assert.deepEqual(
    response.body.currentJob.team.map((member: { scan_status: string; scanned_at: string | null }) => ({
      scan_status: member.scan_status,
      scanned_at: member.scanned_at,
    })),
    [
      {
        scan_status: "not_scanned",
        scanned_at: null,
      },
      {
        scan_status: "scanned",
        scanned_at: "2026-07-24T02:10:00.000Z",
      },
    ]
  );

  assignment.scan_deadline_at = "2026-07-24T02:12:00.000Z";
  const shortenedResponse = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(shortenedResponse.status, 200);
  assert.equal(shortenedResponse.body.currentJob.scan_deadline_at, "2026-07-24T02:12:00.000Z");
  assert.equal(
    shortenedResponse.body.currentJob.scan_deadline_unix_ms,
    Date.parse("2026-07-24T02:12:00.000Z")
  );

  assignment.scan_deadline_at = "2026-07-24T02:25:00.000Z";
  const extendedResponse = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(extendedResponse.status, 200);
  assert.equal(extendedResponse.body.currentJob.scan_deadline_at, "2026-07-24T02:25:00.000Z");
  assert.equal(
    extendedResponse.body.currentJob.scan_deadline_unix_ms,
    Date.parse("2026-07-24T02:25:00.000Z")
  );
});

test("GET /api/workers/me/status maps scanned assignment to working", async () => {
  const { token, worker } = await loginWorker(110);
  const job = addDispatchableJob(1100, 1);
  addTicketForVehicleJob(job.id, 11000);
  const assignment = addPendingAssignment(11001, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();
  assignment.scan_deadline_at = "2026-07-24T02:15:00.000Z";

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "working");
  assert.equal(response.body.currentJob.scan_deadline_at, null);
  assert.equal(response.body.currentJob.scan_deadline_unix_ms, null);
  assert.deepEqual(response.body.currentJob.teamScan, {
    workers_required: 1,
    checked_in_count: 1,
    remainingCount: 0,
    isReady: true,
  });
});

test("GET /api/workers/me/status maps scanned assignment to waiting_team while teammates have not scanned", async () => {
  const { token, worker } = await loginWorker(210);
  const teammate = addWorker(211, await password.hashPassword("Worker@123456"));
  const job = addDispatchableJob(2100, 2);
  addTicketForVehicleJob(job.id, 21000);
  const assignment = addPendingAssignment(21001, job.id, worker.id);
  const teammateAssignment = addPendingAssignment(21002, job.id, teammate.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = "2026-07-24T02:10:00.000Z";
  assignment.scan_deadline_at = "2026-07-24T02:15:00.000Z";
  teammateAssignment.status = "ACCEPTED";
  teammateAssignment.accepted_at = "2026-07-24T02:00:00.000Z";
  teammateAssignment.scan_deadline_at = "2026-07-24T02:15:00.000Z";

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "waiting_team");
  assert.equal(response.body.currentJob.scan_deadline_at, null);
  assert.equal(response.body.currentJob.scan_deadline_unix_ms, null);
  assert.deepEqual(response.body.currentJob.teamScan, {
    workers_required: 2,
    checked_in_count: 1,
    remainingCount: 1,
    isReady: false,
  });
});

test("GET /api/workers/me/status returns remaining break time while on break", async () => {
  const { token, worker } = await loginWorker(107);
  state.connectedWorkers.add(worker.id);
  await server.request("POST", "/api/workers/me/online", {
    token,
  });
  await server.request("POST", "/api/workers/me/break", {
    token,
  });

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "break");
  assert.equal(typeof response.body.break_until, "string");
  assert.equal(response.body.break_until_unix_ms, Date.parse(response.body.break_until));
  assert.deepEqual(Object.keys(response.body.remaining_break_time).sort(), [
    "minutes",
    "seconds",
    "text",
    "total_seconds",
  ]);
  assert.ok(response.body.remaining_break_time.total_seconds > 0);
  assert.ok(response.body.remaining_break_time.total_seconds <= 15 * 60);
  assert.equal(
    response.body.remaining_break_time.minutes,
    Math.floor(response.body.remaining_break_time.total_seconds / 60)
  );
  assert.equal(
    response.body.remaining_break_time.seconds,
    response.body.remaining_break_time.total_seconds % 60
  );
  assert.equal(typeof response.body.remaining_break_time.text, "string");
  assert.match(response.body.remaining_break_time.text, /minute|second/);
  assert.doesNotMatch(response.body.remaining_break_time.text, /[เธ-เน]/);
});

/* -------------------------------------- Worker Queue Function Tests -------------------------------------- */

test("worker queue keeps FIFO order when workers enter in the same millisecond", async () => {
  const originalNow = Date.now;
  Date.now = () => 1_800_000_000_000;

  try {
    await Promise.all([
      workerQueue.enqueueWorker(2),
      workerQueue.enqueueWorker(10),
      workerQueue.enqueueWorker(1),
    ]);
  } finally {
    Date.now = originalNow;
  }

  const popped = await workerQueue.popReadyWorkers(3);

  assert.deepEqual(
    popped.map((worker) => worker.account_id),
    [2, 10, 1]
  );
});

test("worker queue can return admin-cancelled workers to the front in priority order", async () => {
  await workerQueue.enqueueWorker(11);
  await workerQueue.enqueueWorker(12);
  await workerQueue.enqueueWorkersAtFront([21, 22]);

  const popped = await workerQueue.popReadyWorkers(4);

  assert.deepEqual(
    popped.map((worker) => worker.account_id),
    [21, 22, 11, 12]
  );
});

/* -------------------------------------- Worker Dispatch Flow Tests -------------------------------------- */

test("dispatch assigns ready workers in FIFO order", async () => {
  const job = addDispatchableJob(501, 2);
  addWorker(11);
  addWorker(12);
  addWorker(13);
  state.connectedWorkers.add(11);
  state.connectedWorkers.add(12);
  state.connectedWorkers.add(13);

  await workerQueue.enqueueWorker(11);
  await workerQueue.enqueueWorker(12);
  await workerQueue.enqueueWorker(13);

  await workerDispatch.dispatchReadyWorkers();

  assert.deepEqual(
    state.assignments.map((assignment) => assignment.worker_account_id),
    [11, 12]
  );
  assert.equal((await workerQueue.getWorkerQueueStatus(11))?.status, "assigned");
  assert.equal((await workerQueue.getWorkerQueueStatus(12))?.status, "assigned");
  assert.equal((await workerQueue.getWorkerQueueStatus(13))?.status, "ready");
  const assignedEvent = state.socketEvents.find(
    (event) => event.event === "WORKER_ASSIGNED" && event.accountId === 11
  );
  const payload = assignedEvent?.payload as {
    ticketNumber: string;
    assignment: {
      created_at: string;
      accept_deadline_at: string | null;
      accept_deadline_unix_ms: number | null;
    };
  };

  assert.deepEqual(Object.keys(payload).sort(), [
    "assignment",
    "ticketNumber",
  ]);
  assert.equal(payload.ticketNumber, job.ticket_number);
  assert.deepEqual(Object.keys(payload.assignment).sort(), [
    "accept_deadline_at",
    "accept_deadline_unix_ms",
    "created_at",
  ]);
  assert.equal(
    payload.assignment.accept_deadline_unix_ms,
    Date.parse(String(payload.assignment.accept_deadline_at))
  );
});

test("dispatch assigns disconnected ready worker by FIFO order", async () => {
  addDispatchableJob(601, 1);
  addWorker(21);
  addWorker(22);
  await workerQueue.enqueueWorker(21);
  await workerQueue.enqueueWorker(22);

  await workerDispatch.dispatchReadyWorkers();

  assert.equal((await workerQueue.getWorkerQueueStatus(21))?.status, "assigned");
  assert.equal((await workerQueue.getWorkerQueueStatus(22))?.status, "ready");
  assert.deepEqual(
    state.assignments.map((assignment) => assignment.worker_account_id),
    [21]
  );
});

/* -------------------------------------- Worker Assignment Route Tests -------------------------------------- */

test("POST /api/workers/me/assignments/:ticketNumber/accept accepts pending assignment", async () => {
  const { token, worker } = await loginWorker(51);
  const job = addDispatchableJob(851, 1);
  addTicketForVehicleJob(job.id, 1851);
  const oldAssignment = addPendingAssignment(950, job.id, worker.id);
  oldAssignment.status = "TIMEOUT";
  addPendingAssignment(951, job.id, worker.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/accept`, {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "accepted_at",
    "license_plate",
    "license_plate_province",
    "markets",
    "scan_deadline_at",
    "scan_deadline_unix_ms",
    "shirt_number",
    "team",
    "ticket_number",
    "triggeredByTicketNo",
    "worker_code",
  ]);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.shirt_number, String(worker.id));
  assert.equal(response.body.ticket_number, job.ticket_number);
  assert.equal(response.body.triggeredByTicketNo, null);
  assert.ok(response.body.accepted_at);
  assert.equal(response.body.license_plate, job.license_plate);
  assert.equal(response.body.license_plate_province, job.license_plate_province);
  assert.ok(response.body.scan_deadline_at);
  assert.equal(response.body.scan_deadline_unix_ms, Date.parse(response.body.scan_deadline_at));
  assert.equal(response.body.team.length, 1);
  assert.deepEqual(Object.keys(response.body.team[0]).sort(), [
    "full_name",
    "image_url",
    "scan_status",
    "shirt_number",
    "worker_code",
  ]);
  assert.equal(response.body.team[0].full_name, worker.full_name);
  assert.equal(response.body.team[0].shirt_number, String(worker.id));
  assert.equal(response.body.team[0].scan_status, "accepted");
  assert.deepEqual(Object.keys(response.body.markets[0]).sort(), [
    "marketName",
    "stall_count",
    "stalls",
    "ticket_no",
  ]);
  assert.equal(response.body.markets[0].marketName, "Market A");
  assert.equal(response.body.markets[0].stall_count, 1);
  assert.deepEqual(Object.keys(response.body.markets[0].stalls[0]).sort(), [
    "boothCode",
    "boothName",
    "completed_at",
    "confirmation_status",
    "product_count",
    "products",
    "status",
  ]);
  assert.equal(response.body.markets[0].stalls[0].boothCode, "STALL-1851");
  assert.equal(response.body.markets[0].stalls[0].status, "WORKING");
  assert.equal(response.body.markets[0].stalls[0].confirmation_status, "WORKING");
  assert.equal(response.body.markets[0].stalls[0].completed_at, null);
  assert.equal(response.body.markets[0].stalls[0].product_count, 2);
  assert.deepEqual(Object.keys(response.body.markets[0].stalls[0].products[0]).sort(), [
    "packageName",
    "productCode",
    "productName",
    "quantity",
  ]);
  assert.equal(response.body.markets[0].stalls[0].products[0].productName, "Apple");

  const acceptedEvent = state.socketEvents.find(
    (item) => item.accountId === worker.id && item.event === "ASSIGNMENT_ACCEPTED"
  );
  assert.ok(acceptedEvent);
  const acceptedPayload = acceptedEvent.payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(acceptedPayload).sort(), [
    "accepted_at",
    "scan_deadline_at",
    "scan_deadline_unix_ms",
    "status",
    "ticketNumber",
    "worker_code",
  ]);
  assert.equal(acceptedPayload.worker_code, `W${worker.id}`);
  assert.equal(acceptedPayload.status, "ACCEPTED");
  assert.equal(acceptedPayload.ticketNumber, job.ticket_number);
  assert.equal(acceptedPayload.scan_deadline_at, response.body.scan_deadline_at);
  assert.equal(acceptedPayload.scan_deadline_unix_ms, response.body.scan_deadline_unix_ms);
  assert.equal(acceptedPayload.id, undefined);
  assert.equal(acceptedPayload.vehicle_job_id, undefined);
  assert.equal(acceptedPayload.worker_account_id, undefined);
  const acceptedTeamEvent = state.socketEvents.find(
    (item) => item.accountId === worker.id && item.event === "ASSIGNMENT_TEAM_UPDATED"
  );
  assert.ok(acceptedTeamEvent);
  const acceptedTeamPayload = acceptedTeamEvent.payload as {
    ticketNumber?: string;
    worker_status?: string;
    team_scan?: {
      workers_required?: number;
      checked_in_count?: number;
      remaining_count?: number;
      is_ready?: boolean;
    };
    team?: Array<{
      worker_code?: string | null;
      shirt_number?: string | null;
      scan_status?: string;
      accepted_at?: string | null;
      scanned_at?: string | null;
    }>;
  };
  assert.equal(acceptedTeamPayload.ticketNumber, job.ticket_number);
  assert.equal(acceptedTeamPayload.worker_status, "assigned");
  assert.deepEqual(acceptedTeamPayload.team_scan, {
    workers_required: 1,
    checked_in_count: 0,
    remaining_count: 1,
    is_ready: false,
  });
  assert.equal(acceptedTeamPayload.team?.[0]?.worker_code, `W${worker.id}`);
  assert.equal(acceptedTeamPayload.team?.[0]?.shirt_number, String(worker.id));
  assert.equal(acceptedTeamPayload.team?.[0]?.scan_status, "accepted");
  assert.equal(acceptedTeamPayload.team?.[0]?.accepted_at, response.body.accepted_at);
  assert.equal(acceptedTeamPayload.team?.[0]?.scanned_at, null);
  const scanTimeoutJob = state.queueJobs
    .get(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string)
    ?.get("assignment-scan-timeout-951");
  assert.deepEqual(scanTimeoutJob?.data, {
    assignmentId: 951,
    workerAccountId: worker.id,
    kind: "scan",
  });
  const scanWarningJob = state.queueJobs
    .get(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string)
    ?.get("assignment-scan-warning-951");
  assert.deepEqual(scanWarningJob?.data, {
    assignmentId: 951,
    workerAccountId: worker.id,
    kind: "scan_warning",
  });
});

test("POST /api/workers/me/assignments/:ticketNumber/accept times out late accept and requeues worker even when socket is disconnected", async () => {
  const { token, worker } = await loginWorker(52);
  const job = addDispatchableJob(852, 1);
  job.status = "WAIT";
  addPendingAssignment(952, job.id, worker.id, -1000);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/accept`, {
    token,
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "ASSIGNMENT_TIMEOUT");
  assert.equal(state.assignments[0].status, "TIMEOUT");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "ready");
  assert.equal(state.shiftAttendances[0].acceptTimeoutStreak, 1);
  assert.ok(state.shiftAttendances[0].lastAcceptTimeoutAt);
  const timeoutEvent = state.socketEvents.find(
    (item) => item.accountId === worker.id && item.event === "ASSIGNMENT_TIMEOUT"
  );
  assert.ok(timeoutEvent);
  const timeoutPayload = timeoutEvent.payload as Record<string, unknown>;
  assert.equal(timeoutPayload.ticketNumber, job.ticket_number);
  assert.equal(timeoutPayload.assignment_id, undefined);
  assert.equal(timeoutPayload.vehicle_job_id, undefined);
});

test("POST /api/workers/me/assignments/:ticketNumber/accept resets consecutive timeout streak after accepting", async () => {
  const { token, worker } = await loginWorker(54);
  const timedOutJob = addDispatchableJob(8541, 1);
  timedOutJob.status = "WAIT";
  addPendingAssignment(9541, timedOutJob.id, worker.id, -1000);

  const timeoutResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${timedOutJob.ticket_number}/accept`,
    { token }
  );
  assert.equal(timeoutResponse.status, 409);
  assert.equal(state.shiftAttendances[0].acceptTimeoutStreak, 1);

  const acceptedJob = addDispatchableJob(8542, 1);
  acceptedJob.status = "WAIT";
  addTicketForVehicleJob(acceptedJob.id, 18542);
  addPendingAssignment(9542, acceptedJob.id, worker.id);

  const acceptedResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${acceptedJob.ticket_number}/accept`,
    { token }
  );

  assert.equal(acceptedResponse.status, 200);
  assert.equal(state.shiftAttendances[0].acceptTimeoutStreak, 0);
  assert.equal(state.shiftAttendances[0].lastAcceptTimeoutAt, null);
});

test("POST /api/workers/me/assignments/:ticketNumber/accept closes worker shift after configured timeout limit", async () => {
  const { token, worker } = await loginWorker(53);
  state.connectedWorkers.add(worker.id);

  for (const suffix of [8531, 8532, 8533]) {
    const job = addDispatchableJob(suffix, 1);
    job.status = "WAIT";
    addPendingAssignment(suffix, job.id, worker.id, -1000);

    const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/accept`, {
      token,
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, "ASSIGNMENT_TIMEOUT");
  }

  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "open_app");
  assert.equal(state.assignments.every((assignment) => assignment.status === "TIMEOUT"), true);
  assert.equal(state.shiftAttendances[0].acceptTimeoutStreak, 3);
  assert.equal(state.shiftAttendances[0].closeReason, "assignment_timeout_limit_reached");
  assert.ok(
    state.notifications.some((notification) => {
      const payload = (notification as { payload?: { reason?: string; timeout_count?: number } }).payload;

      return (
        payload?.reason === "assignment_timeout_limit_reached" &&
        payload.timeout_count === 3
      );
    })
  );
});

test("POST /api/workers/me/assignments/:ticketNumber/check-in-qr scans correct QR", async () => {
  const { token, worker } = await loginWorker(61);
  const job = addDispatchableJob(861, 1);
  const ticket = addTicketForVehicleJob(job.id, 1861);
  const market = state.marketJobs.find((item) => item.id === ticket.market_job_id)!;
  const assignment = addPendingAssignment(961, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/check-in-qr`, {
    token,
    body: {
      worker_qr_token: market.worker_qr_token,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "status",
    "teamScan",
    "ticket_number",
    "workerStatus",
    "worker_code",
  ].sort());
  assert.equal(response.body.status, "SCANNED");
  assert.equal(response.body.workerStatus, "working");
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.ticket_number, job.ticket_number);
  assert.deepEqual(response.body.teamScan, {
    workers_required: 1,
    checked_in_count: 1,
    remainingCount: 0,
    isReady: true,
  });
  assert.equal(job.status, "WORKING");
  assert.equal(
    state.workerAssignmentEvents.filter(
      (event) =>
        event.assignment_id === assignment.id &&
        event.event_type === "SCANNED"
    ).length,
    1
  );
  const scannedTeamEvent = state.socketEvents.find(
    (item) => item.accountId === worker.id && item.event === "ASSIGNMENT_TEAM_UPDATED"
  );
  assert.ok(scannedTeamEvent);
  const scannedTeamPayload = scannedTeamEvent.payload as {
    ticketNumber?: string;
    worker_status?: string;
    team_scan?: {
      workers_required?: number;
      checked_in_count?: number;
      remaining_count?: number;
      is_ready?: boolean;
    };
    team?: Array<{
      worker_code?: string | null;
      shirt_number?: string | null;
      scan_status?: string;
      scanned_at?: string | null;
    }>;
  };
  assert.equal(scannedTeamPayload.ticketNumber, job.ticket_number);
  assert.equal(scannedTeamPayload.worker_status, "working");
  assert.deepEqual(scannedTeamPayload.team_scan, {
    workers_required: 1,
    checked_in_count: 1,
    remaining_count: 0,
    is_ready: true,
  });
  assert.equal(scannedTeamPayload.team?.[0]?.worker_code, `W${worker.id}`);
  assert.equal(scannedTeamPayload.team?.[0]?.shirt_number, String(worker.id));
  assert.equal(scannedTeamPayload.team?.[0]?.scan_status, "scanned");
  assert.ok(scannedTeamPayload.team?.[0]?.scanned_at);
});

test("POST /api/workers/me/assignments/:ticketNumber/check-in-qr shortens remaining team scan window from settings", async () => {
  const [{ token, worker }, second, third] = await Promise.all([
    loginWorker(64),
    loginWorker(65),
    loginWorker(66),
  ]);
  const job = addDispatchableJob(864, 3);
  const ticket = addTicketForVehicleJob(job.id, 1864);
  const market = state.marketJobs.find((item) => item.id === ticket.market_job_id)!;
  const firstAssignment = addPendingAssignment(964, job.id, worker.id);
  const secondAssignment = addPendingAssignment(965, job.id, second.worker.id);
  const thirdAssignment = addPendingAssignment(966, job.id, third.worker.id);
  const teamScanRemainingMinutes = 5;
  const originalDeadline = new Date(Date.now() + 15 * 60_000).toISOString();

  for (const assignment of [firstAssignment, secondAssignment, thirdAssignment]) {
    assignment.status = "ACCEPTED";
    assignment.scan_deadline_at = originalDeadline;
  }

  const startedAt = Date.now();
  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/check-in-qr`, {
    token,
    body: {
      worker_qr_token: market.worker_qr_token,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.workerStatus, "waiting_team");
  assert.deepEqual(response.body.teamScan, {
    workers_required: 3,
    checked_in_count: 1,
    remainingCount: 2,
    isReady: false,
  });
  assert.equal(firstAssignment.status, "SCANNED");
  assert.equal(job.status, "WORKING");
  const teamUpdatedEvents = state.socketEvents.filter(
    (item) => item.event === "ASSIGNMENT_TEAM_UPDATED"
  );
  assert.deepEqual(
    teamUpdatedEvents.map((item) => item.accountId).sort(),
    [worker.id, second.worker.id, third.worker.id].sort()
  );
  const teamUpdatedPayload = teamUpdatedEvents[0].payload as {
    ticketNumber?: string;
    worker_status?: string;
    team_scan?: {
      workers_required?: number;
      checked_in_count?: number;
      remaining_count?: number;
      is_ready?: boolean;
    };
    team?: Array<{
      worker_code?: string | null;
      shirt_number?: string | null;
      scan_status?: string;
      scanned_at?: string | null;
    }>;
  };
  assert.equal(teamUpdatedPayload.ticketNumber, job.ticket_number);
  assert.equal(teamUpdatedPayload.worker_status, "waiting_team");
  assert.deepEqual(teamUpdatedPayload.team_scan, {
    workers_required: 3,
    checked_in_count: 1,
    remaining_count: 2,
    is_ready: false,
  });
  assert.deepEqual(
    teamUpdatedPayload.team?.map((member) => ({
      worker_code: member.worker_code,
      shirt_number: member.shirt_number,
      scan_status: member.scan_status,
      scanned: Boolean(member.scanned_at),
    })),
    [
      {
        worker_code: `W${worker.id}`,
        shirt_number: String(worker.id),
        scan_status: "scanned",
        scanned: true,
      },
      {
        worker_code: `W${second.worker.id}`,
        shirt_number: String(second.worker.id),
        scan_status: "accepted",
        scanned: false,
      },
      {
        worker_code: `W${third.worker.id}`,
        shirt_number: String(third.worker.id),
        scan_status: "accepted",
        scanned: false,
      },
    ]
  );

  for (const assignment of [secondAssignment, thirdAssignment]) {
    assert.equal(assignment.status, "ACCEPTED");
    assert.ok(assignment.scan_deadline_at);
    const shortenedDeadlineMs = new Date(assignment.scan_deadline_at).getTime();
    assert.ok(shortenedDeadlineMs >= startedAt + teamScanRemainingMinutes * 60_000 - 2_000);
    assert.ok(shortenedDeadlineMs <= Date.now() + teamScanRemainingMinutes * 60_000 + 2_000);
    assert.ok(shortenedDeadlineMs < new Date(originalDeadline).getTime());
    assert.deepEqual(
      state.queueJobs
        .get(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string)
        ?.get(`assignment-scan-timeout-${assignment.id}`)?.data,
      {
        assignmentId: assignment.id,
        workerAccountId: assignment.worker_account_id,
        kind: "scan",
      }
    );
    assert.deepEqual(
      state.queueJobs
        .get(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string)
        ?.get(`assignment-scan-warning-${assignment.id}`)?.data,
      {
        assignmentId: assignment.id,
        workerAccountId: assignment.worker_account_id,
        kind: "scan_warning",
      }
    );
  }

  const shortenedEvents = state.realtimeEvents.filter(
    (item) =>
      (item as { type?: string }).type === "ASSIGNMENT_SCAN_DEADLINE_SHORTENED"
  );
  assert.equal(shortenedEvents.length, 1);
  assert.deepEqual(
    ((shortenedEvents[0] as { worker_account_ids?: number[] }).worker_account_ids ?? []).sort(),
    [second.worker.id, third.worker.id].sort()
  );
  const shortenedWorkerPayload = (shortenedEvents[0] as {
    worker_payload?: { scan_deadline_at?: string; scan_deadline_unix_ms?: number };
  }).worker_payload;
  assert.equal(
    shortenedWorkerPayload?.scan_deadline_unix_ms,
    Date.parse(String(shortenedWorkerPayload?.scan_deadline_at))
  );
});

test("POST /api/workers/me/assignments/:ticketNumber/check-in-qr rejects unknown TicketNumber", async () => {
  const { token, worker } = await loginWorker(62);
  const job = addDispatchableJob(862, 1);
  const assignment = addPendingAssignment(962, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  const response = await server.request("POST", "/api/workers/me/assignments/unknown-ticket-number/check-in-qr", {
    token,
    body: {
      worker_qr_token: "any-token",
    },
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "ASSIGNMENT_NOT_FOUND");
  assert.equal(assignment.status, "ACCEPTED");
});

test("POST /api/workers/me/assignments/:ticketNumber/check-in-qr rejects unknown WorkerQrToken", async () => {
  const { token, worker } = await loginWorker(621);
  const job = addDispatchableJob(8621, 1);
  addTicketForVehicleJob(job.id, 18621);
  const assignment = addPendingAssignment(9621, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/check-in-qr`, {
    token,
    body: {
      worker_qr_token: "does-not-exist",
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_WORKER_QR");
  assert.equal(assignment.status, "ACCEPTED");
});

// Ticket ที่สแกน ต้องถูก resolve จาก DB จริงแล้วเทียบ TicketNumber ของรถ worker คนนั้น
// ห้ามเชื่อค่า TicketNumber ที่ QR อ้างมาตรงๆ (scenario 11)
test("POST /api/workers/me/assignments/:ticketNumber/check-in-qr rejects QR belonging to a different vehicle", async () => {
  const { token, worker } = await loginWorker(622);
  const job = addDispatchableJob(8622, 1);
  const otherJob = addDispatchableJob(8623, 1);
  const otherTicket = addTicketForVehicleJob(otherJob.id, 18623);
  const otherMarket = state.marketJobs.find((item) => item.id === otherTicket.market_job_id)!;
  const assignment = addPendingAssignment(9622, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/check-in-qr`, {
    token,
    body: {
      worker_qr_token: otherMarket.worker_qr_token,
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "QR_TICKET_NUMBER_MISMATCH");
  assert.equal(assignment.status, "ACCEPTED");
});

test("POST /api/workers/me/assignments/:ticketNumber/check-in-qr rejects expired QR scan window", async () => {
  const { token, worker } = await loginWorker(63);
  const replacementWorker = addWorker(64, await password.hashPassword("Worker@123456"));
  const job = addDispatchableJob(863, 1);
  const assignment = addPendingAssignment(963, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() - 1000).toISOString();
  await workerQueue.enqueueWorker(replacementWorker.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/check-in-qr`, {
    token,
    body: {
      worker_qr_token: "any-token",
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "QR_EXPIRED");
  assert.equal(assignment.status, "TIMEOUT");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "open_app");
  assert.equal((await workerQueue.getWorkerQueueStatus(replacementWorker.id))?.status, "assigned");
  const replacementAssignment = state.assignments.find(
    (item) =>
      item.vehicle_job_id === job.id &&
      item.worker_account_id === replacementWorker.id
  );
  assert.equal(replacementAssignment?.status, "PENDING");
  assert.ok(replacementAssignment?.accept_deadline_at);
  const statusResponse = await server.request("GET", "/api/workers/me/status", {
    token,
  });
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.body.status, "open_app");
  assert.equal(job.status, "WORKING");
  const timeoutEvent = state.socketEvents.find(
    (item) => item.accountId === worker.id && item.event === "ASSIGNMENT_TIMEOUT"
  );
  assert.ok(timeoutEvent);
  assert.equal(
    (timeoutEvent.payload as { reason?: string }).reason,
    "scan_timeout"
  );
});

test("assignment scan timeout processor dispatches replacement worker from queue", async () => {
  const worker = addWorker(65, await password.hashPassword("Worker@123456"));
  const replacementWorker = addWorker(66, await password.hashPassword("Worker@123456"));
  const job = addDispatchableJob(866, 1);
  const assignment = addPendingAssignment(966, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() - 1000).toISOString();
  await workerQueue.enqueueWorker(replacementWorker.id);

  workerDispatch.startAssignmentTimeoutProcessing();
  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);

  assert.ok(processor, "Assignment timeout processor must be registered.");
  await processor({
    data: {
      assignmentId: assignment.id,
      workerAccountId: worker.id,
      kind: "scan",
    },
  });

  assert.equal(assignment.status, "TIMEOUT");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "open_app");
  assert.equal((await workerQueue.getWorkerQueueStatus(replacementWorker.id))?.status, "assigned");
  const replacementAssignment = state.assignments.find(
    (item) =>
      item.vehicle_job_id === job.id &&
      item.worker_account_id === replacementWorker.id
  );
  assert.equal(replacementAssignment?.status, "PENDING");
  assert.ok(replacementAssignment?.accept_deadline_at);
});

/* -------------------------------------- Worker Ticket Route Tests -------------------------------------- */

test("POST /api/workers/me/assignments/:ticketNumber/tickets/complete submits quantities for vendor confirmation", async () => {
  const { token, worker } = await loginWorker(71);
  const job = addDispatchableJob(871, 1);
  const ticket = addTicketForVehicleJob(job.id, 971);
  const newerJobWithSameBooth = addDispatchableJob(872, 1);
  newerJobWithSameBooth.status = "WAIT";
  const newerTicketWithSameBooth = addTicketForVehicleJob(newerJobWithSameBooth.id, 972);
  newerTicketWithSameBooth.boothCode = ticket.boothCode;
  newerTicketWithSameBooth.status = "WAIT";
  const assignment = addPendingAssignment(1071, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();
  state.connectedWorkers.add(worker.id);
  await workerQueue.markWorkerAssigned(worker.id);
  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`, {
    token,
    body: {
      boothCode: ticket.boothCode,
      items: products.map((product, index) => ({
        productCode: product.productCode,
        packageCode: product.packageCode,
        confirmed_quantity: index === 0 ? 10 : 4,
      })),
    },
  });



  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "assignment_status",
    "boothCode",
    "boothName",
    "completed_at",
    "confirmation_status",
    "confirmedAt",
    "items",
    "marketCode",
    "marketName",
    "message",
    "rejectedAt",
    "status",
    "submission_status",
    "ticketCompletedAt",
    "ticket_no",
    "ticket_number",
  ]);
  assert.equal(response.body.status, "DELIVERED");
  assert.equal(response.body.confirmation_status, "DELIVERED");
  assert.equal(response.body.assignment_status, "DELIVERED");
  assert.equal(response.body.completed_at, null);
  assert.equal(response.body.confirmedAt, null);
  assert.equal(response.body.rejectedAt, null);
  assert.equal(response.body.ticketCompletedAt, null);
  assert.equal(assignment.status, "DELIVERED");
  assert.equal(response.body.ticket_number, job.ticket_number);
  assert.equal(response.body.marketCode, "MARKET-871");
  assert.equal(response.body.boothCode, ticket.boothCode);
  assert.equal(response.body.ticket, undefined);
  assert.equal(response.body.submission, undefined);
  assert.equal(response.body.products, undefined);
  assert.deepEqual(
    response.body.items.map((product: { confirmed_quantity: string | null }) => product.confirmed_quantity),
    ["10", "4"]
  );
  assert.equal(state.lineMessages.length, 2);
  const vendorTimeoutJob = state.queueJobs
    .get(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string)
    ?.get(`vendor-confirm-timeout-${ticket.id}-${state.completionSubmissions[0].id}`);
  assert.deepEqual(vendorTimeoutJob?.data, {
    ticketId: ticket.id,
    submissionId: state.completionSubmissions[0].id,
    kind: "vendor_confirm",
  });
  assert.ok(
    state.realtimeEvents.some(
      (event) =>
        Boolean(
          event &&
          typeof event === "object" &&
          (event as { type?: string }).type === "TICKET_COMPLETION_SUBMITTED"
        )
    )
  );
  const submittedEvent = state.realtimeEvents.find(
    (event) =>
      Boolean(
        event &&
        typeof event === "object" &&
        (event as { type?: string }).type === "TICKET_COMPLETION_SUBMITTED"
      )
  );
  const submittedWorkerPayload = (submittedEvent as { worker_payload?: Record<string, unknown> })
    .worker_payload;
  assert.equal(submittedWorkerPayload?.ticket_number, job.ticket_number);
  assert.equal(submittedWorkerPayload?.marketCode, "MARKET-871");
  assert.equal(submittedWorkerPayload?.boothCode, ticket.boothCode);
  assert.equal(submittedWorkerPayload?.assignment_status, "DELIVERED");
  assert.equal(submittedWorkerPayload?.ticket_id, undefined);
  assert.equal(submittedWorkerPayload?.submission_id, undefined);
  assert.equal(submittedWorkerPayload?.vehicle_job_id, undefined);
  const submittedItems = submittedWorkerPayload?.items as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(submittedItems[0]).sort(), [
    "confirmed_quantity",
    "packageCode",
    "packageName",
    "productCode",
    "productName",
    "quantity",
  ]);
  assert.equal(submittedItems[0].ticket_id, undefined);

  // Worker เธชเนเธเธขเธญเธ”เธเธฃเธดเธเนเธฅเนเธง เนเธ•เน Vendor เธขเธฑเธเนเธกเน Confirm
  // เธเธถเธเธขเธฑเธเธซเนเธฒเธกเธชเธฃเนเธฒเธ Financial
  assert.equal(state.ticketProductFinancials.length, 0);
  assert.equal(state.ticketWorkerPayments.length, 0);
  assert.equal(ticket.final_stall_amount ?? null, null);
  assert.equal(ticket.financialized_at ?? null, null);

  const lineMessage = state.lineMessages[0] as {
    data?: {
      to?: string;
      messages?: Array<{
        type?: string;
        contents?: {
          footer?: {
            contents?: Array<{
              action?: {
                label?: string;
                data?: string;
              };
            }>;
          };
        };
      }>;
    };
  };
  const lineFlexMessage = lineMessage.data?.messages?.[0];
  const lineFlexContents = JSON.stringify(lineFlexMessage?.contents);
  const confirmButtonPostback = lineFlexMessage?.contents?.footer?.contents?.find(
    (button) => button.action?.label === "ถูกต้อง"
  )?.action?.data;
  const confirmToken = /token=([^&\s]+)/.exec(confirmButtonPostback ?? "")?.[1];

  assert.equal(lineFlexMessage?.type, "flex");
  assert.ok(lineFlexContents.includes(job.ticket_number));
  assert.match(lineFlexContents, /ถูกต้อง/);
  assert.match(confirmButtonPostback ?? "", /^token=/);
  assert.ok((confirmButtonPostback ?? "").length <= 300);
  assert.equal(lineMessage.data?.to, ticket.vendor_line_id);
  assert.ok(confirmToken);

  const lineResponse = await server.request("POST", "/api/line/webhook", {
    body: {
      events: [
        {
          type: "postback",
          source: {
            userId: ticket.vendor_line_id,
          },
          postback: {
            data: confirmButtonPostback,
          },
        },
      ],
    },
  });

  assert.equal(lineResponse.status, 200);
  assert.equal(lineResponse.body.processed, 1);
  assert.equal(vendorTimeoutJob?.removed, true);
  assert.equal(ticket.status, "COMPLETED");
  assert.equal(assignment.status, "COMPLETED");
  assert.equal(job.status, "COMPLETED");
  const ticketCompletedAt = ticket.completed_at;
  const completedTicketWorker = state.ticketWorkers.find(
    (ticketWorker) =>
      ticketWorker.market_job_id === ticket.market_job_id &&
      ticketWorker.worker_account_id === worker.id
  );
  assert.ok(ticketCompletedAt);
  assert.ok(completedTicketWorker?.completed_at);
  assert.ok(
    new Date(String(completedTicketWorker?.completed_at)).getTime() >=
      new Date(ticketCompletedAt).getTime()
  );

  // Financialization เธ•เนเธญเธเน€เธเธดเธ”เธซเธฅเธฑเธ Vendor Confirm
  assert.equal(state.ticketProductFinancials.length, products.length);
  assert.equal(state.ticketWorkerPayments.length, products.length);

  // Ticket เธเธตเนเธกเธต Worker เธเธฃเธดเธ 1 เธเธ
  assert.ok(state.ticketProductFinancials.every((financial) => financial.worker_count === 1));
  assert.equal(ticket.final_stall_amount, "34.00");
  assert.ok(ticket.financialized_at);
  assert.equal(ticket.completed_at, ticketCompletedAt);
  assert.equal(state.ticketProductFinancials[0].product_charge, "24");
  assert.equal(state.ticketProductFinancials[1].product_charge, "10");
  assert.equal(state.ticketProductFinancials[0].labor_fee_raw, "9");
  assert.equal(state.ticketProductFinancials[1].labor_fee_raw, "3.6");
  assert.equal(state.ticketProductFinancials[1].worker_payout_total, "3");
  assert.equal(state.ticketProductFinancials[1].fund_amount, "0.6");

  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "ready");
  const workerReadyEvent = state.socketEvents.find((item) => {
    const payload = item.payload as { queue?: { status?: string } };

    return (
      item.accountId === worker.id &&
      item.event === "WORKER_STATUS_CHANGED" &&
      payload.queue?.status === "ready"
    );
  });
  assert.ok(workerReadyEvent);
  assert.ok(
    state.notifications.some((notification) => {
      const payload = (notification as { payload?: { reason?: string } }).payload;

      return payload?.reason === "vehicle_job_completed_requeue";
    })
  );
  const resultEvent = [...state.realtimeEvents].reverse().find(
    (event) =>
      Boolean(
        event &&
        typeof event === "object" &&
        (event as { type?: string }).type === "TICKET_COMPLETION_RESULT"
      )
  );
  const resultWorkerPayload = (resultEvent as { worker_payload?: Record<string, unknown> })
    .worker_payload;
  assert.equal(resultWorkerPayload?.ticket_number, job.ticket_number);
  assert.equal(resultWorkerPayload?.marketCode, "MARKET-871");
  assert.equal(resultWorkerPayload?.boothCode, ticket.boothCode);
  assert.equal(resultWorkerPayload?.assignment_status, "COMPLETED");
  assert.equal(resultWorkerPayload?.ticket_id, undefined);
  assert.equal(resultWorkerPayload?.submission_id, undefined);
  assert.equal(resultWorkerPayload?.vehicle_job_id, undefined);
  const resultItems = resultWorkerPayload?.items as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(resultItems[0]).sort(), [
    "confirmed_quantity",
    "packageCode",
    "packageName",
    "productCode",
    "productName",
    "quantity",
  ]);
  assert.equal(resultItems[0].ticket_id, undefined);

  assert.equal(state.lineMessages.length, 4);
  const ratingPromptMessage = state.lineMessages.at(-1) as {
    name?: string;
    data?: {
      to?: string;
      messages?: Array<{
        type?: string;
        contents?: unknown;
      }>;
    };
  };
  const ratingFlex = ratingPromptMessage.data?.messages?.[0];
  const ratingFlexContents = JSON.stringify(ratingFlex?.contents);
  const ratingPostback = /"label":"5","data":"([^"]+)"/.exec(ratingFlexContents)?.[1];
  assert.equal(ratingPromptMessage.name, "send-vendor-ticket-rating-prompt");
  assert.equal(ratingPromptMessage.data?.to, ticket.vendor_line_id);
  assert.equal(ratingFlex?.type, "flex");
  // Rating Prompt เธขเธฑเธเธซเนเธฒเธกเนเธชเธ”เธเธขเธญเธ”เน€เธเธดเธเธเธฃเธดเธ
  assert.doesNotMatch(ratingFlexContents, /34\.00 บาท/);
  assert.doesNotMatch(ratingFlexContents, /สรุปค่าใช้บริการ/);
  assert.match(ratingPostback ?? "", /^token=.*&score=5$/);
  assert.match(ratingFlexContents, /"displayText":"5"/);
  assert.ok((ratingPostback ?? "").length <= 300);

  const ratingResponse = await server.request("POST", "/api/line/webhook", {
    body: {
      events: [
        {
          type: "postback",
          source: {
            userId: ticket.vendor_line_id,
          },
          postback: {
            data: ratingPostback,
          },
        },
      ],
    },
  });

  assert.equal(ratingResponse.status, 200);
  assert.equal(ratingResponse.body.processed, 1);
  assert.equal(state.ticketRatings.length, 1);
  assert.equal(state.ticketRatings[0].ticket_id, ticket.id);
  assert.equal(state.ticketRatings[0].submission_id, state.completionSubmissions[0].id);
  assert.equal(state.ticketRatings[0].line_user_id, ticket.vendor_line_id);
  assert.equal(state.ticketRatings[0].target_type, "owner");
  assert.equal(state.ticketRatings[0].score, 5);
  assert.equal(state.lineMessages.length, 5);
  const ratingResultMessage = state.lineMessages.at(-1) as {
    name?: string;
    data?: {
      messages?: Array<{
        type?: string;
        contents?: unknown;
      }>;
    };
  };
  assert.equal(ratingResultMessage.name, "send-vendor-ticket-rating-result");
  assert.equal(ratingResultMessage.data?.messages?.length, 2);
  assert.equal(ratingResultMessage.data?.messages?.[0]?.type, "flex");
  assert.equal(ratingResultMessage.data?.messages?.[1]?.type, "flex");
  assert.equal(
    state.completionSubmissions[0].resolved_by_line_user_id,
    ticket.vendor_line_id
  );
  const duplicateOwnerResponse = await server.request("POST", "/api/line/webhook", {
    body: {
      events: [
        {
          type: "postback",
          source: {
            userId: ticket.vendor_line_id,
          },
          postback: {
            data: confirmButtonPostback,
          },
        },
      ],
    },
  });
  assert.equal(duplicateOwnerResponse.status, 200);
  assert.equal(duplicateOwnerResponse.body.processed, 1);
  assert.equal(state.lineMessages.length, 6);
  const duplicateOwnerMessage = state.lineMessages.at(-1) as {
    name?: string;
    data?: { to?: string; messages?: Array<{ text?: string }> };
  };
  assert.equal(duplicateOwnerMessage.name, "send-vendor-ticket-already-handled");
  assert.equal(duplicateOwnerMessage.data?.to, ticket.vendor_line_id);
  assert.match(
    duplicateOwnerMessage.data?.messages?.[0]?.text ?? "",
    /รายการนี้ได้รับการดำเนินการเรียบร้อยแล้ว/
  );

  const duplicateMemberResponse = await server.request("POST", "/api/line/webhook", {
    body: {
      events: [
        {
          type: "postback",
          source: {
            userId: `${ticket.vendor_line_id}-member`,
          },
          postback: {
            data: confirmButtonPostback,
          },
        },
      ],
    },
  });
  assert.equal(duplicateMemberResponse.status, 200);
  assert.equal(duplicateMemberResponse.body.processed, 1);
  assert.equal(state.lineMessages.length, 7);
  const duplicateMemberMessage = state.lineMessages.at(-1) as {
    name?: string;
    data?: { to?: string; messages?: Array<{ text?: string }> };
  };
  assert.equal(duplicateMemberMessage.name, "send-vendor-ticket-already-handled");
  assert.equal(duplicateMemberMessage.data?.to, `${ticket.vendor_line_id}-member`);
  assert.match(duplicateMemberMessage.data?.messages?.[0]?.text ?? "", /รายการนี้ได้รับการดำเนินการเรียบร้อยแล้ว/);
  assert.match(JSON.stringify(ratingResultMessage.data?.messages?.[1]?.contents), /34\.00 บาท/);
  assert.doesNotMatch(JSON.stringify(ratingResultMessage.data?.messages?.[1]?.contents), /0\.00 บาท/);
});

test("vendor confirmation timeout auto-confirms ticket and financializes only once", async () => {
  const { token, worker } = await loginWorker(76);
  const job = addDispatchableJob(876, 1);
  const ticket = addTicketForVehicleJob(job.id, 977);
  const assignment = addPendingAssignment(1077, job.id, worker.id);

  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();

  state.connectedWorkers.add(worker.id);
  await workerQueue.markWorkerAssigned(worker.id);

  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  const submitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token,
      body: {
        boothCode: ticket.boothCode,
        items: products.map((product, index) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: index === 0 ? 10 : 4,
        })),
      },
    }
  );

  assert.equal(submitResponse.status, 200);
  assert.equal(ticket.status, "DELIVERED");
  assert.equal(assignment.status, "DELIVERED");

  workerDispatch.startAssignmentTimeoutProcessing();

  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);

  assert.ok(processor, "Assignment timeout processor must be registered.");

  const submission = state.completionSubmissions.at(-1);

  assert.ok(submission, "Completion submission must exist.");

  await processor({
    data: {
      ticketId: ticket.id,
      submissionId: submission.id,
      kind: "vendor_confirm",
    },
  });

  assert.equal(ticket.status, "COMPLETED");
  assert.equal(ticket.confirmation_status, "COMPLETED");
  assert.equal(submission.status, "COMPLETED");
  assert.equal(assignment.status, "COMPLETED");
  assert.equal(job.status, "COMPLETED");
  assert.equal(
    state.workerAssignmentEvents.filter(
      (event) =>
        event.assignment_id === assignment.id &&
        event.event_type === "COMPLETED"
    ).length,
    1
  );

  assert.equal(ticket.final_stall_amount, "34.00");
  assert.ok(ticket.completed_at);
  assert.ok(ticket.financialized_at);
  const ticketCompletedAt = ticket.completed_at;
  const completedTicketWorker = state.ticketWorkers.find(
    (ticketWorker) =>
      ticketWorker.market_job_id === ticket.market_job_id &&
      ticketWorker.worker_account_id === worker.id
  );
  // Booth (ticket.completed_at) เธเธฑเธเธเธฒเธฃ Lock Roster (completedTicketWorker.completed_at) เนเธเนเธเธ Step เนเธขเธเธเธฑเธเนเธฅเนเธง
  // เนเธกเนเธ•เนเธญเธเนเธเน timestamp เธ•เธฃเธเธเธฑเธเธ—เธธเธเธเธดเธ• เนเธ•เนเธ•เนเธญเธเนเธกเนเธเนเธญเธเธเธงเนเธฒ Booth complete
  assert.ok(completedTicketWorker?.completed_at);
  assert.ok(
    new Date(String(completedTicketWorker?.completed_at)).getTime() >=
      new Date(ticketCompletedAt).getTime()
  );

  assert.equal(state.ticketProductFinancials.length, products.length);
  assert.equal(state.ticketWorkerPayments.length, products.length);

  assert.ok(
    state.ticketProductFinancials.every((financial) => financial.worker_count === 1)
  );

  assert.equal(state.ticketProductFinancials[0].product_charge, "24");
  assert.equal(state.ticketProductFinancials[1].product_charge, "10");

  assert.equal(state.ticketProductFinancials[0].labor_fee_raw, "9");
  assert.equal(state.ticketProductFinancials[1].labor_fee_raw, "3.6");

  assert.equal(state.ticketProductFinancials[1].worker_payout_total, "3");
  assert.equal(state.ticketProductFinancials[1].fund_amount, "0.6");

  const financialCount = state.ticketProductFinancials.length;
  const paymentCount = state.ticketWorkerPayments.length;
  const financializedAt = ticket.financialized_at;

  await processor({
    data: {
      ticketId: ticket.id,
      submissionId: submission.id,
      kind: "vendor_confirm",
    },
  });

  assert.equal(state.ticketProductFinancials.length, financialCount);
  assert.equal(state.ticketWorkerPayments.length, paymentCount);
  assert.equal(ticket.final_stall_amount, "34.00");
  assert.equal(ticket.financialized_at, financializedAt);
  assert.equal(ticket.completed_at, ticketCompletedAt);
  const assignmentCreatedAt = assignment.created_at;
  assert.ok(assignmentCreatedAt);

  const historyDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(assignmentCreatedAt));

  const historyResponse = await server.request(
    "GET",
    `/api/workers/me/assignments/history?date=${historyDate}`,
    {
      token,
    }
  );

  assert.equal(historyResponse.status, 200);

  const historyItem = historyResponse.body.data.find(
    (item: { ticket_number: string }) => item.ticket_number === job.ticket_number
  );

  assert.ok(historyItem);

  assert.equal(historyItem.earnings, undefined);
  assert.equal(historyResponse.body.total_earnings, undefined);

  const boothHistory = historyItem.markets[0].booths[0];
  const boothEarning = state.ticketWorkers.find(
    (ticketWorker) =>
      ticketWorker.market_job_id === ticket.market_job_id &&
      ticketWorker.worker_account_id === worker.id
  );

  assert.equal(boothHistory.boothCode, ticket.boothCode);
  assert.equal(boothHistory.completed_at, ticketCompletedAt);
  assert.equal(boothHistory.products.length, 2);
  assert.equal(boothEarning?.status, "COMPLETED");
  assert.equal(boothEarning?.final_earning_amount, "12.00");
});

test("POST /api/workers/me/assignments/:ticketNumber/tickets/complete allows submitting another stall in the same job", async () => {
  const { token, worker } = await loginWorker(73);
  const job = addDispatchableJob(873, 1);
  const currentTicket = addTicketForVehicleJob(job.id, 973);
  const nextTicket = addTicketForVehicleJob(job.id, 974);
  const assignment = addPendingAssignment(1073, job.id, worker.id);
  assignment.status = "SCANNED";
  nextTicket.status = "WAIT";
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === nextTicket.id
  );

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`, {
    token,
    body: {
      boothCode: nextTicket.boothCode,
      items: products.map((product) => ({
        productCode: product.productCode,
        packageCode: product.packageCode,
        confirmed_quantity: Number(product.quantity),
      })),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "DELIVERED");
  assert.equal(response.body.assignment_status, "DELIVERED");
  assert.equal(response.body.boothCode, nextTicket.boothCode);
  assert.equal(currentTicket.status, "WORKING");
  assert.equal(nextTicket.status, "DELIVERED");
  assert.equal(assignment.status, "DELIVERED");
  assert.equal(state.lineMessages.length, 2);
});

test("POST /api/workers/me/assignments/:ticketNumber/tickets/complete accepts BoothCode with slash in body", async () => {
  const { token, worker } = await loginWorker(75);
  const job = addDispatchableJob(875, 1);
  const ticket = addTicketForVehicleJob(job.id, 976);
  const assignment = addPendingAssignment(1075, job.id, worker.id);
  ticket.boothCode = "OM3/40";
  assignment.status = "SCANNED";
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id
  );

  const response = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token,
      body: {
        BoothCode: ticket.boothCode,
        Items: products.map((product) => ({
          ProductCode: product.productCode,
          PackageCode: product.packageCode,
          ConfirmedQuantity: Number(product.quantity),
        })),
      },
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "DELIVERED");
  assert.equal(response.body.boothCode, ticket.boothCode);
  assert.equal(ticket.status, "DELIVERED");
});

test("POST /api/workers/me/assignments/:ticketNumber/tickets/:boothCode/complete is not supported", async () => {
  const { token, worker } = await loginWorker(76);
  const job = addDispatchableJob(8760, 1);
  const ticket = addTicketForVehicleJob(job.id, 9760);
  addPendingAssignment(1076, job.id, worker.id).status = "SCANNED";
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id
  );

  const response = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/${ticket.boothCode}/complete`,
    {
      token,
      body: {
        items: products.map((product) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: Number(product.quantity),
        })),
      },
    }
  );

  assert.equal(response.status, 404);
  assert.equal(ticket.status, "WORKING");
});

test("POST /api/workers/me/assignments/:ticketNumber/tickets/complete rejects before all required workers check in", async () => {
  const { token, worker } = await loginWorker(74);
  const job = addDispatchableJob(874, 2);
  const ticket = addTicketForVehicleJob(job.id, 975);
  const assignment = addPendingAssignment(1074, job.id, worker.id);
  assignment.status = "SCANNED";
  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`, {
    token,
    body: {
      boothCode: ticket.boothCode,
      items: products.map((product) => ({
        productCode: product.productCode,
        packageCode: product.packageCode,
        confirmed_quantity: Number(product.quantity),
      })),
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "WORKERS_NOT_CHECKED_IN");
  assert.equal(response.body.workers_required, 2);
  assert.equal(response.body.checked_in_count, 1);
  assert.equal(ticket.status, "WORKING");
  assert.equal(state.lineMessages.length, 0);
});

test("POST /api/workers/me/assignments/:ticketNumber/tickets/complete rejects incomplete product quantities", async () => {
  const { token, worker } = await loginWorker(72);
  const job = addDispatchableJob(872, 1);
  const ticket = addTicketForVehicleJob(job.id, 972);
  const assignment = addPendingAssignment(1072, job.id, worker.id);
  assignment.status = "SCANNED";
  const [firstProduct] = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`, {
    token,
    body: {
      boothCode: ticket.boothCode,
      items: [
        {
          productCode: firstProduct.productCode,
          packageCode: firstProduct.packageCode,
          confirmed_quantity: 10,
        },
      ],
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INCOMPLETE_TICKET_PRODUCTS");
  assert.equal(ticket.status, "WORKING");
  assert.equal(state.lineMessages.length, 0);
});

test("break return moves worker to open_app when WebSocket is still disconnected", async () => {
  const { token, worker } = await loginWorker(106);
  const breakQueueName = process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE as string;
  const assignmentQueueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  state.connectedWorkers.add(worker.id);
  await server.request("POST", "/api/workers/me/online", {
    token,
  });
  await server.request("POST", "/api/workers/me/break", {
    token,
  });
  state.connectedWorkers.delete(worker.id);

  workerDispatch.startAssignmentTimeoutProcessing();
  const breakReturnProcessor = state.workerProcessors.get(breakQueueName);
  const assignmentTimeoutProcessor = state.workerProcessors.get(assignmentQueueName);

  assert.ok(breakReturnProcessor);
  assert.ok(assignmentTimeoutProcessor);
  await breakReturnProcessor({
    data: {
      accountId: worker.id,
      scheduleId: worker.id,
    },
  });

  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "open_app");
  assert.equal(
    (state.notifications.at(-1) as { payload?: { reason?: string } })?.payload?.reason,
    "break_finished_not_available"
  );

  const job = addDispatchableJob(999, 1);
  const assignment = addPendingAssignment(1999, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 90_000).toISOString();

  await assignmentTimeoutProcessor({
    data: {
      assignmentId: assignment.id,
      workerAccountId: worker.id,
      kind: "scan_warning",
    },
  });

  const warningNotification = state.notifications.find(
    (notification) =>
      (notification as { type?: string }).type === "ASSIGNMENT_SCAN_DEADLINE_WARNING"
  ) as { payload?: Record<string, unknown> } | undefined;

  assert.ok(warningNotification);
  assert.equal(warningNotification.payload?.ticketNumber, job.ticket_number);
  assert.equal(warningNotification.payload?.worker_code, `W${worker.id}`);
  assert.equal(warningNotification.payload?.assignment_status, "ACCEPTED");
  assert.equal(warningNotification.payload?.worker_status, "assigned");
  assert.equal(warningNotification.payload?.warning_before_minutes, 2);
  assert.equal(
    Number(warningNotification.payload?.remaining_seconds) > 0 &&
    Number(warningNotification.payload?.remaining_seconds) <= 120,
    true
  );
});

test("worker assignment audit events are immutable and distinguish accept timeout from scan timeout", async () => {
  const { token, worker } = await loginWorker(12401);
  const acceptTimeoutJob = addDispatchableJob(124010, 1);
  const scanTimeoutJob = addDispatchableJob(124020, 1);
  state.connectedWorkers.add(worker.id);
  addPendingAssignment(1240101, acceptTimeoutJob.id, worker.id, -1000);
  const scanAssignment = addPendingAssignment(1240201, scanTimeoutJob.id, worker.id);

  const acceptTimeoutResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${acceptTimeoutJob.ticket_number}/accept`,
    { token }
  );

  assert.equal(acceptTimeoutResponse.status, 409);
  assert.equal(
    state.workerAssignmentEvents.filter(
      (event) =>
        event.assignment_id === 1240101 &&
        event.event_type === "ACCEPT_TIMEOUT"
    ).length,
    1
  );
  assert.equal(
    state.workerAssignmentEvents.some(
      (event) =>
        event.assignment_id === 1240101 &&
        event.event_type === "SCAN_TIMEOUT"
    ),
    false
  );

  const acceptResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${scanTimeoutJob.ticket_number}/accept`,
    { token }
  );

  assert.equal(acceptResponse.status, 200);
  scanAssignment.scan_deadline_at = new Date(Date.now() - 1000).toISOString();
  const scanTimeoutResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${scanTimeoutJob.ticket_number}/check-in-qr`,
    {
      token,
      body: {
        worker_qr_token: "any-token",
      },
    }
  );

  assert.equal(scanTimeoutResponse.status, 409);
  assert.equal(
    state.workerAssignmentEvents.filter(
      (event) =>
        event.assignment_id === scanAssignment.id &&
        event.event_type === "ACCEPTED"
    ).length,
    1
  );
  assert.equal(
    state.workerAssignmentEvents.filter(
      (event) =>
        event.assignment_id === scanAssignment.id &&
        event.event_type === "SCAN_TIMEOUT"
    ).length,
    1
  );
  assert.equal(
    state.workerAssignmentEvents.some(
      (event) =>
        event.assignment_id === scanAssignment.id &&
        event.event_type === "ACCEPT_TIMEOUT"
    ),
    false
  );
  assert.equal(
    state.workerAssignmentEvents.some(
      (event) =>
        event.assignment_id === scanAssignment.id &&
        event.event_type === "ADMIN_CANCELLED"
    ),
    false
  );
});

test("worker only returns to the FIFO queue once every Business Ticket is terminal AND Gate's TicketCount has been reached", async () => {
  // Gate ไม่มี endpoint close แยกต่างหากอีกแล้ว — ticketsClosedAt ถูกตั้งค่าได้ทางเดียวคือตอนสร้าง
  // Business Ticket ใบที่ทำให้จำนวน Ticket ที่มีอยู่ถึง TicketCount ที่ Gate แจ้งไว้ (ดู
  // gate.routes.test.ts สำหรับ test ของกลไกนับ TicketCount นี้โดยตรง) จำลองเคสนี้ด้วยรถที่มี
  // 2 Business Ticket คนละตลาด แล้วตั้ง tickets_closed_at เอง ณ จุดที่ Gate ควรจะตั้งให้จริง
  // (ตอนสร้าง Ticket ใบที่ 2 ซึ่งทำให้ครบ TicketCount) เพื่อพิสูจน์ว่า Worker ยังไม่ถูกคืนคิว
  // จนกว่าทั้งสองเงื่อนไขจะครบพร้อมกัน
  const { token: workerToken, worker } = await loginWorker(9950);
  const job = addDispatchableJob(9950, 1);
  // Gate ยังไม่ได้ยืนยันว่าไม่มี Business Ticket เพิ่ม (ต่างจาก default ของ addDispatchableJob)
  job.tickets_closed_at = null;
  const ticketA = addTicketForVehicleJob(job.id, 19950);
  const assignment = addPendingAssignment(19951, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();
  state.connectedWorkers.add(worker.id);
  await workerQueue.markWorkerAssigned(worker.id);

  workerDispatch.startAssignmentTimeoutProcessing();
  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);

  assert.ok(processor, "Assignment timeout processor must be registered.");

  const submitTicketA = async (ticket: ReturnType<typeof addTicketForVehicleJob>) => {
    const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);
    const submitResponse = await server.request(
      "POST",
      `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
      {
        token: workerToken,
        body: {
          boothCode: ticket.boothCode,
          items: products.map((product, index) => ({
            productCode: product.productCode,
            packageCode: product.packageCode,
            confirmed_quantity: index === 0 ? 10 : 4,
          })),
        },
      }
    );

    assert.equal(submitResponse.status, 200);

    const submission = state.completionSubmissions.at(-1);

    assert.ok(submission, "Completion submission must exist.");

    await processor({
      data: {
        ticketId: ticket.id,
        submissionId: submission.id,
        kind: "vendor_confirm",
      },
    });
  };

  await submitTicketA(ticketA);

  // Business Ticket ใบแรกของ TicketNumber นี้ Terminal แล้ว แต่ Gate ยังไม่ครบ TicketCount
  // (Ticket ใบที่สองยังไม่ถูกสร้าง) -> ห้ามถือว่ารถจบ ห้ามคืนคิว Worker
  assert.equal(ticketA.status, "COMPLETED");
  assert.equal(job.status, "WORKING");
  assert.equal(assignment.status, "WORKING");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "assigned");

  // Gate สร้าง Business Ticket ใบที่สอง (ตลาดอื่น) ซึ่งทำให้ครบ TicketCount = 2 พอดี
  const ticketB = addTicketForVehicleJob(job.id, 19960, 21960);
  job.tickets_closed_at = new Date().toISOString();

  await submitTicketA(ticketB);

  // ทุก Business Ticket Terminal ครบ และ Gate ครบ TicketCount แล้ว -> ปิดงานทั้งคัน คืนคิว Worker
  assert.equal(ticketB.status, "COMPLETED");
  assert.equal(job.status, "COMPLETED");
  assert.equal(assignment.status, "COMPLETED");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "ready");
});
