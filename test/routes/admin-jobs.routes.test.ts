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
    TicketNumber: `TRUCK-20260723-${suffix}`,
    TicketNo: `TKT-20260723-${suffix}`,
    TicketCreatedAt: "2026-07-23T14:30:00+07:00",
    TicketCount: 1,
    BoothCount: 1,
    MarketCode: `MARKET-${suffix}`,
    LicensePlate: `ABC-${suffix}`,
    LicensePlateProvince: "Bangkok",
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
    "jobs:override_count",
    "jobs:wait",
    "jobs:release_workers",
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

test("POST /api/admin/jobs/workers/:workerCode/status/force rejects worker without WebSocket", async () => {
  const { token } = await loginJobAdmin(9601);
  const worker = addWorker(9602);

  const response = await server.request(
    "POST",
    `/api/admin/jobs/workers/${worker.username}/status/force`,
    {
      token,
      body: {
        status: "open_app",
      },
    }
  );
  const queueEntry = await workerQueue.getWorkerQueueStatus(worker.id);

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "WORKER_NOT_ONLINE");
  assert.equal(queueEntry, null);
});

test("POST /api/admin/jobs/workers/:workerCode/status/force allows connected worker", async () => {
  const { token } = await loginJobAdmin(9611);
  const worker = addWorker(9612);
  state.connectedWorkers.add(worker.id);
  await workerQueue.recordWorkerHeartbeat(worker.id);

  const response = await server.request(
    "POST",
    `/api/admin/jobs/workers/${worker.username}/status/force`,
    {
      token,
      body: {
        status: "ready",
      },
    }
  );
  const queueEntry = await workerQueue.getWorkerQueueStatus(worker.id);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "full_name",
    "message",
    "status",
    "worker_code",
  ]);
  assert.equal(response.body.message, "Worker status forced successfully.");
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.worker_code, worker.username);
  assert.equal(response.body.status, "ready");
  assert.equal(queueEntry?.status, "ready");
});

test("GET /api/admin/jobs/workers/status shows queued worker when socket is disconnected", async () => {
  const { token } = await loginJobAdmin(9621);
  const worker = addWorker(9622);
  await workerQueue.enqueueWorker(worker.id);

  const response = await server.request("GET", "/api/admin/jobs/workers/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.summary.total, 1);
  assert.equal(response.body.summary.ready, 1);
  assert.equal(response.body.data[0].worker_code, worker.username);
  assert.equal(response.body.data[0].status, "ready");
  assert.equal(response.body.data[0].socket_connected, false);
});

test("GET /api/admin/vehicle-jobs/:ticketNo/financials returns finalized persisted financial breakdown", async () => {
  const { token } = await loginJobAdmin(9631);
  const worker = addWorker(9632);

  const job = addDispatchableJob(9630, 1);
  const ticket = addTicketForVehicleJob(job.id, 19630);
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id
  );

  const finalizedAt = "2026-08-07T10:00:00.000Z";

  job.status = "COMPLETED";

  ticket.status = "COMPLETED";
  ticket.confirmation_status = "COMPLETED";
  ticket.final_stall_amount = "34.00";
  ticket.completed_at = finalizedAt;
  ticket.financialized_at = finalizedAt;

  products[0].confirmed_quantity = "10";
  products[1].confirmed_quantity = "4";

  const ticketWorker = {
    id: state.nextTicketWorkerId++,
    market_job_id: ticket.market_job_id,
    worker_account_id: worker.id,
    status: "COMPLETED",
    joined_at: finalizedAt,
    cancelled_at: null,
    completed_at: finalizedAt,
  };

  state.ticketWorkers.push(ticketWorker);

  const firstFinancial = {
    id: state.nextTicketProductFinancialId++,
    ticket_product_id: products[0].id,
    confirmed_quantity: "10",
    stall_fee_raw: "15",
    stall_fee_rounded: "15",
    labor_fee_raw: "9",
    product_charge: "24",
    worker_count: 1,
    worker_payout_total: "9",
    fund_amount: "0",
    finalized_at: finalizedAt,
  };

  const secondFinancial = {
    id: state.nextTicketProductFinancialId++,
    ticket_product_id: products[1].id,
    confirmed_quantity: "4",
    stall_fee_raw: "6",
    stall_fee_rounded: "6",
    labor_fee_raw: "3.6",
    product_charge: "10",
    worker_count: 1,
    worker_payout_total: "3",
    fund_amount: "0.6",
    finalized_at: finalizedAt,
  };

  state.ticketProductFinancials.push(
    firstFinancial,
    secondFinancial
  );

  state.ticketWorkerPayments.push(
    {
      id: state.nextTicketWorkerPaymentId++,
      ticket_product_financial_id: firstFinancial.id,
      ticket_worker_id: ticketWorker.id,
      raw_amount: "9",
      remainder_amount: "0",
      final_amount: "9",
    },
    {
      id: state.nextTicketWorkerPaymentId++,
      ticket_product_financial_id: secondFinancial.id,
      ticket_worker_id: ticketWorker.id,
      raw_amount: "3.6",
      remainder_amount: "0.6",
      final_amount: "3",
    }
  );

  const response = await server.request(
    "GET",
    `/api/admin/vehicle-jobs/${job.ticket_number}/financials`,
    {
      token,
    }
  );

  assert.equal(response.status, 200);

  assert.equal(
    response.body.vehicle_job.ticket_number,
    job.ticket_number
  );

  assert.equal(
    response.body.financial_status,
    "FINALIZED"
  );

  assert.deepEqual(response.body.summary, {
    booth_count: 1,
    financialized_booth_count: 1,
    final_stall_amount: "34.00",
    labor_fee_raw: "12.6000",
    worker_payout_total: "12.00",
    fund_amount: "0.6000",
  });

  assert.equal(response.body.booths.length, 1);

  const booth = response.body.booths[0];

  assert.equal(booth.ticket_id, ticket.id);
  assert.equal(booth.boothCode, ticket.boothCode);
  assert.equal(booth.financialized, true);
  assert.equal(booth.final_stall_amount, "34.00");
  assert.equal(booth.financialized_at, finalizedAt);

  assert.deepEqual(booth.summary, {
    labor_fee_raw: "12.6000",
    worker_payout_total: "12.00",
    fund_amount: "0.6000",
  });

  assert.equal(booth.workers.length, 1);

  assert.equal(
    booth.workers[0].ticket_worker_id,
    ticketWorker.id
  );

  assert.equal(
    booth.workers[0].worker_code,
    worker.username
  );

  assert.equal(
    booth.workers[0].membership_status,
    "COMPLETED"
  );

  assert.equal(
    booth.workers[0].total_amount,
    "12.00"
  );

  assert.equal(booth.products.length, 2);

  const firstProduct = booth.products[0];
  const secondProduct = booth.products[1];

  assert.equal(
    firstProduct.confirmed_quantity,
    "10.00"
  );

  assert.equal(
    firstProduct.rate_snapshot.stall_rate_snapshot,
    "1.50"
  );

  assert.equal(
    firstProduct.rate_snapshot.labor_rate_snapshot,
    "0.90"
  );

  assert.equal(
    firstProduct.financial.product_charge,
    "24.00"
  );

  assert.equal(
    firstProduct.financial.labor_fee_raw,
    "9.0000"
  );

  assert.equal(
    firstProduct.financial.worker_payout_total,
    "9.00"
  );

  assert.equal(
    firstProduct.financial.fund_amount,
    "0.0000"
  );

  assert.equal(
    firstProduct.workers[0].final_amount,
    "9.00"
  );

  assert.equal(
    secondProduct.confirmed_quantity,
    "4.00"
  );

  assert.equal(
    secondProduct.financial.product_charge,
    "10.00"
  );

  assert.equal(
    secondProduct.financial.labor_fee_raw,
    "3.6000"
  );

  assert.equal(
    secondProduct.financial.worker_payout_total,
    "3.00"
  );

  assert.equal(
    secondProduct.financial.fund_amount,
    "0.6000"
  );

  assert.equal(
    secondProduct.workers[0].final_amount,
    "3.00"
  );
});

test("GET /api/admin/vehicle-jobs/:ticketNo/financials returns pending financial status before financialization", async () => {
  const { token } = await loginJobAdmin(9633);

  const job = addDispatchableJob(9633, 1);
  const ticket = addTicketForVehicleJob(job.id, 19633);

  const response = await server.request(
    "GET",
    `/api/admin/vehicle-jobs/${job.ticket_number}/financials`,
    {
      token,
    }
  );

  assert.equal(response.status, 200);

  assert.equal(
    response.body.vehicle_job.ticket_number,
    job.ticket_number
  );

  assert.equal(
    response.body.financial_status,
    "PENDING"
  );

  assert.deepEqual(response.body.summary, {
    booth_count: 1,
    financialized_booth_count: 0,
    final_stall_amount: "0.00",
    labor_fee_raw: "0.0000",
    worker_payout_total: "0.00",
    fund_amount: "0.0000",
  });

  assert.equal(response.body.booths.length, 1);

  const booth = response.body.booths[0];

  assert.equal(booth.ticket_id, ticket.id);
  assert.equal(booth.financialized, false);
  assert.equal(booth.final_stall_amount, null);
  assert.equal(booth.completed_at, null);
  assert.equal(booth.financialized_at, null);

  assert.deepEqual(booth.summary, {
    labor_fee_raw: "0.0000",
    worker_payout_total: "0.00",
    fund_amount: "0.0000",
  });

  assert.equal(booth.workers.length, 0);
  assert.equal(booth.products.length, 2);

  assert.equal(
    booth.products[0].confirmed_quantity,
    null
  );

  assert.equal(
    booth.products[0].financial,
    null
  );

  assert.equal(
    booth.products[0].workers.length,
    0
  );

  assert.equal(
    booth.products[1].confirmed_quantity,
    null
  );

  assert.equal(
    booth.products[1].financial,
    null
  );

  assert.equal(
    booth.products[1].workers.length,
    0
  );
});

test("GET /api/admin/vehicle-jobs/:ticketNo/financials returns partial financial status when only some booths are finalized", async () => {
  const { token } = await loginJobAdmin(9634);

  const job = addDispatchableJob(9634, 1);

  const firstTicket = addTicketForVehicleJob(
    job.id,
    19634
  );

  const secondTicket = addTicketForVehicleJob(
    job.id,
    19635
  );

  const firstProducts = state.ticketProducts.filter(
    (product) => product.ticket_id === firstTicket.id
  );

  const secondProducts = state.ticketProducts.filter(
    (product) => product.ticket_id === secondTicket.id
  );

  const finalizedAt = "2026-08-07T11:00:00.000Z";

  job.status = "WORKING";
  state.marketJobs.find((item) => item.id === firstTicket.market_job_id)!.booth_count = 2;

  firstTicket.status = "COMPLETED";
  firstTicket.confirmation_status = "COMPLETED";
  firstTicket.final_stall_amount = "34.00";
  firstTicket.completed_at = finalizedAt;
  firstTicket.financialized_at = finalizedAt;

  firstProducts[0].confirmed_quantity = "10";
  firstProducts[1].confirmed_quantity = "4";

  const firstFinancial = {
    id: state.nextTicketProductFinancialId++,
    ticket_product_id: firstProducts[0].id,
    confirmed_quantity: "10",
    stall_fee_raw: "15",
    stall_fee_rounded: "15",
    labor_fee_raw: "9",
    product_charge: "24",
    worker_count: 1,
    worker_payout_total: "9",
    fund_amount: "0",
    finalized_at: finalizedAt,
  };

  const secondFinancial = {
    id: state.nextTicketProductFinancialId++,
    ticket_product_id: firstProducts[1].id,
    confirmed_quantity: "4",
    stall_fee_raw: "6",
    stall_fee_rounded: "6",
    labor_fee_raw: "3.6",
    product_charge: "10",
    worker_count: 1,
    worker_payout_total: "3",
    fund_amount: "0.6",
    finalized_at: finalizedAt,
  };

  state.ticketProductFinancials.push(
    firstFinancial,
    secondFinancial
  );

  const response = await server.request(
    "GET",
    `/api/admin/vehicle-jobs/${job.ticket_number}/financials`,
    {
      token,
    }
  );

  assert.equal(response.status, 200);

  assert.equal(
    response.body.financial_status,
    "PARTIAL"
  );

  assert.deepEqual(response.body.summary, {
    booth_count: 2,
    financialized_booth_count: 1,
    final_stall_amount: "34.00",
    labor_fee_raw: "12.6000",
    worker_payout_total: "12.00",
    fund_amount: "0.6000",
  });

  assert.equal(response.body.booths.length, 2);

  const finalizedBooth = response.body.booths.find(
    (booth: { ticket_id: number }) =>
      booth.ticket_id === firstTicket.id
  );

  const pendingBooth = response.body.booths.find(
    (booth: { ticket_id: number }) =>
      booth.ticket_id === secondTicket.id
  );

  assert.ok(finalizedBooth);
  assert.ok(pendingBooth);

  assert.equal(
    finalizedBooth.financialized,
    true
  );

  assert.equal(
    finalizedBooth.final_stall_amount,
    "34.00"
  );

  assert.equal(
    finalizedBooth.financialized_at,
    finalizedAt
  );

  assert.deepEqual(finalizedBooth.summary, {
    labor_fee_raw: "12.6000",
    worker_payout_total: "12.00",
    fund_amount: "0.6000",
  });

  assert.equal(
    finalizedBooth.products.length,
    2
  );

  assert.equal(
    finalizedBooth.products[0].financial.product_charge,
    "24.00"
  );

  assert.equal(
    finalizedBooth.products[1].financial.product_charge,
    "10.00"
  );

  assert.equal(
    pendingBooth.financialized,
    false
  );

  assert.equal(
    pendingBooth.final_stall_amount,
    null
  );

  assert.equal(
    pendingBooth.completed_at,
    null
  );

  assert.equal(
    pendingBooth.financialized_at,
    null
  );

  assert.deepEqual(pendingBooth.summary, {
    labor_fee_raw: "0.0000",
    worker_payout_total: "0.00",
    fund_amount: "0.0000",
  });

  assert.equal(
    pendingBooth.products.length,
    secondProducts.length
  );

  assert.ok(
    pendingBooth.products.every(
      (product: {
        confirmed_quantity: string | null;
        financial: unknown;
      }) =>
        product.confirmed_quantity === null &&
        product.financial === null
    )
  );
});

test("admin cancel + replacement excludes cancelled worker from booth financialization", async () => {
  const { token: workerToken, worker: firstWorker } =
    await loginWorker(9701);

  const secondWorker = addWorker(9702);
  const replacementWorker = addWorker(9703);

  const { token: adminToken } =
    await loginJobAdmin(9700);

  const job = addDispatchableJob(970, 2);
  const ticket = addTicketForVehicleJob(job.id, 19700);
  const market = state.marketJobs.find(
    (item) => item.id === ticket.market_job_id
  )!;

  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id
  );

  const firstAssignment = addPendingAssignment(
    19701,
    job.id,
    firstWorker.id
  );

  const cancelledAssignment = addPendingAssignment(
    19702,
    job.id,
    secondWorker.id
  );

  const scannedAt = new Date().toISOString();

  firstAssignment.status = "SCANNED";
  firstAssignment.scanned_at = scannedAt;

  cancelledAssignment.status = "SCANNED";
  cancelledAssignment.scanned_at = scannedAt;

  const firstTicketWorker = {
    id: state.nextTicketWorkerId++,
    market_job_id: ticket.market_job_id,
    worker_account_id: firstWorker.id,
    status: "WORKING",
    final_earning_amount: null,
    joined_at: scannedAt,
    cancelled_at: null,
    completed_at: null,
  };

  const cancelledTicketWorker = {
    id: state.nextTicketWorkerId++,
    market_job_id: ticket.market_job_id,
    worker_account_id: secondWorker.id,
    status: "WORKING",
    final_earning_amount: null,
    joined_at: scannedAt,
    cancelled_at: null,
    completed_at: null,
  };

  state.ticketWorkers.push(
    firstTicketWorker,
    cancelledTicketWorker
  );

  // Admin cancel Worker B
  const cancelResponse = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/workers/${secondWorker.username}/assignment/cancel`,
    {
      token: adminToken,
      body: {
        reason: "replacement",
      },
    }
  );

  assert.equal(cancelResponse.status, 200);
  assert.equal(
    cancelledAssignment.status,
    "CANCELLED"
  );
  assert.equal(
    state.workerAssignmentEvents.filter(
      (event) =>
        event.assignment_id === cancelledAssignment.id &&
        event.event_type === "ADMIN_CANCELLED"
    ).length,
    1
  );
  assert.equal(
    cancelledTicketWorker.status,
    "CANCELLED"
  );
  assert.ok(cancelledTicketWorker.cancelled_at);

  // Worker C เธเธฃเนเธญเธกเธฃเธฑเธเธเธฒเธเนเธซเธกเน
  await workerQueue.enqueueWorker(
    replacementWorker.id
  );

  // Admin เนเธชเน Worker C เธกเธฒเนเธ—เธ
  const assignResponse = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/assign-workers`,
    {
      token: adminToken,
      body: {
        worker_codes: [
          replacementWorker.username,
        ],
      },
    }
  );

  assert.equal(assignResponse.status, 201);

  const replacementAssignment =
    state.assignments.find(
      (assignment) =>
        assignment.vehicle_job_id === job.id &&
        assignment.worker_account_id ===
        replacementWorker.id &&
        assignment.status === "PENDING"
    );

  assert.ok(replacementAssignment);

  // เธเธณเธฅเธญเธ Worker C accept + scan เธชเธณเน€เธฃเนเธ
  replacementAssignment.status = "SCANNED";
  replacementAssignment.scanned_at =
    new Date().toISOString();

  // Worker A เธชเนเธเธขเธญเธ”เธเธฃเธดเธ
  const submitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token: workerToken,
      body: {
        ticket_no: market.ticket_no,
        boothCode: ticket.boothCode,
        items: products.map(
          (product, index) => ({
            productCode: product.productCode,
            packageCode: product.packageCode,
            confirmed_quantity:
              index === 0 ? 10 : 4,
          })
        ),
      },
    }
  );

  assert.equal(submitResponse.status, 200);
  assert.equal(ticket.status, "DELIVERED");

  // เธเธณเธฅเธญเธ Vendor timeout โ’ Auto Confirm
  workerDispatch.startAssignmentTimeoutProcessing();

  const queueName =
    process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;

  const processor =
    state.workerProcessors.get(queueName);

  assert.ok(
    processor,
    "Assignment timeout processor must be registered."
  );

  const submission =
    state.completionSubmissions.at(-1);

  assert.ok(
    submission,
    "Completion submission must exist."
  );

  await processor({
    data: {
      ticketId: ticket.id,
      submissionId: submission.id,
      kind: "vendor_confirm",
    },
  });

  const replacementTicketWorker =
    state.ticketWorkers.find(
      (ticketWorker) =>
        ticketWorker.market_job_id === ticket.market_job_id &&
        ticketWorker.worker_account_id ===
        replacementWorker.id
    );

  assert.ok(replacementTicketWorker);

  // A + C Complete เนเธ•เน B เธ•เนเธญเธเธขเธฑเธ Cancelled
  assert.equal(
    firstTicketWorker.status,
    "COMPLETED"
  );

  assert.equal(
    cancelledTicketWorker.status,
    "CANCELLED"
  );

  assert.equal(
    replacementTicketWorker.status,
    "COMPLETED"
  );

  // Financial เธ•เนเธญเธเธซเธฒเธฃเนเธเน A + C = 2 เธเธ
  assert.equal(
    state.ticketProductFinancials.length,
    2
  );

  assert.ok(
    state.ticketProductFinancials.every(
      (financial) =>
        financial.worker_count === 2
    )
  );

  // Product 1: labor 9 / 2
  // Worker เนเธ”เน 4 + 4 = 8
  // Fund = 1
  assert.equal(
    state.ticketProductFinancials[0]
      .worker_payout_total,
    "8"
  );

  assert.equal(
    state.ticketProductFinancials[0]
      .fund_amount,
    "1"
  );

  // Product 2: labor 3.6 / 2
  // Worker เนเธ”เน 1 + 1 = 2
  // Fund = 1.6
  assert.equal(
    state.ticketProductFinancials[1]
      .worker_payout_total,
    "2"
  );

  assert.equal(
    state.ticketProductFinancials[1]
      .fund_amount,
    "1.6"
  );

  // 2 Product ร— 2 Worker = 4 Payment
  assert.equal(
    state.ticketWorkerPayments.length,
    4
  );

  // Worker B เธซเนเธฒเธกเธกเธต Payment
  assert.equal(
    state.ticketWorkerPayments.some(
      (payment) =>
        payment.ticket_worker_id ===
        cancelledTicketWorker.id
    ),
    false
  );

  // Worker A เธ•เนเธญเธเธกเธต 2 Product
  assert.equal(
    state.ticketWorkerPayments.filter(
      (payment) =>
        payment.ticket_worker_id ===
        firstTicketWorker.id
    ).length,
    2
  );

  // Worker C เธ•เนเธญเธเธกเธต 2 Product
  assert.equal(
    state.ticketWorkerPayments.filter(
      (payment) =>
        payment.ticket_worker_id ===
        replacementTicketWorker.id
    ).length,
    2
  );

  // เธ•เธฃเธงเธเธเนเธฒเธ Admin Financial API เธญเธตเธเธเธฑเนเธ
  assert.equal(
    firstTicketWorker.final_earning_amount,
    "5.00"
  );

  assert.equal(
    replacementTicketWorker.final_earning_amount,
    "5.00"
  );

  assert.equal(
    cancelledTicketWorker.final_earning_amount ?? null,
    null
  );

  const financialResponse = await server.request(
    "GET",
    `/api/admin/vehicle-jobs/${job.ticket_number}/financials`,
    {
      token: adminToken,
    }
  );

  assert.equal(financialResponse.status, 200);

  assert.equal(
    financialResponse.body.financial_status,
    "FINALIZED"
  );

  assert.equal(
    financialResponse.body.summary
      .final_stall_amount,
    "34.00"
  );

  assert.equal(
    financialResponse.body.summary
      .worker_payout_total,
    "10.00"
  );

  assert.equal(
    financialResponse.body.summary
      .fund_amount,
    "2.6000"
  );

  const booth =
    financialResponse.body.booths[0];

  const firstWorkerSummary =
    booth.workers.find(
      (worker: { worker_code: string }) =>
        worker.worker_code ===
        firstWorker.username
    );

  const cancelledWorkerSummary =
    booth.workers.find(
      (worker: { worker_code: string }) =>
        worker.worker_code ===
        secondWorker.username
    );

  const replacementWorkerSummary =
    booth.workers.find(
      (worker: { worker_code: string }) =>
        worker.worker_code ===
        replacementWorker.username
    );

  assert.ok(firstWorkerSummary);
  assert.ok(cancelledWorkerSummary);
  assert.ok(replacementWorkerSummary);

  assert.equal(
    firstWorkerSummary.membership_status,
    "COMPLETED"
  );

  assert.equal(
    firstWorkerSummary.total_amount,
    "5.00"
  );

  assert.equal(
    cancelledWorkerSummary.membership_status,
    "CANCELLED"
  );

  assert.equal(
    cancelledWorkerSummary.total_amount,
    "0.00"
  );

  assert.equal(
    replacementWorkerSummary.membership_status,
    "COMPLETED"
  );

  assert.equal(
    replacementWorkerSummary.total_amount,
    "5.00"
  );
});

test("worker globally cancelled before Business Ticket roster locks forfeits earnings from an already-completed booth of that ticket", async () => {
  const { token: workerToken, worker } = await loginWorker(9801);
  const { token: replacementToken, worker: replacementWorker } = await loginWorker(9802);
  const { token: adminToken } = await loginJobAdmin(9800);

  const job = addDispatchableJob(980, 1);
  const firstTicket = addTicketForVehicleJob(job.id, 19800);
  const secondTicket = addTicketForVehicleJob(job.id, 19801);

  // firstTicket / secondTicket ใช้ market_job_id เดียวกัน (Business Ticket ใบเดียว สองแผง)
  assert.equal(firstTicket.market_job_id, secondTicket.market_job_id);
  const sharedMarket = state.marketJobs.find(
    (item) => item.id === firstTicket.market_job_id
  )!;

  // Booth 2 ยังไม่เริ่ม รอ Booth 1 เสร็จก่อน
  secondTicket.status = "WAIT";
  state.marketJobs.find((item) => item.id === firstTicket.market_job_id)!.booth_count = 2;

  const assignment = addPendingAssignment(19802, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();

  const firstProducts = state.ticketProducts.filter(
    (product) => product.ticket_id === firstTicket.id
  );

  /* -------------------------------------- Complete Booth 1 -------------------------------------- */

  const firstSubmitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token: workerToken,
      body: {
        ticket_no: sharedMarket.ticket_no,
        boothCode: firstTicket.boothCode,
        items: firstProducts.map((product, index) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: index === 0 ? 10 : 4,
        })),
      },
    }
  );

  assert.equal(firstSubmitResponse.status, 200);
  assert.equal(firstTicket.status, "DELIVERED");

  workerDispatch.startAssignmentTimeoutProcessing();

  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);

  assert.ok(processor, "Assignment timeout processor must be registered.");

  const firstSubmission = state.completionSubmissions.at(-1);

  assert.ok(firstSubmission, "First booth completion submission must exist.");

  await processor({
    data: {
      ticketId: firstTicket.id,
      submissionId: firstSubmission.id,
      kind: "vendor_confirm",
    },
  });

  // Booth 1 COMPLETED เองได้ แต่ Business Ticket ห้าม Finalize จนกว่า Booth 2 จะ Terminal ด้วย
  assert.equal(firstTicket.status, "COMPLETED");
  assert.equal(firstTicket.final_stall_amount ?? null, null);
  assert.equal(firstTicket.financialized_at ?? null, null);
  assert.equal(state.ticketProductFinancials.length, 0);
  assert.equal(state.ticketWorkerPayments.length, 0);

  const sharedTicketWorker = state.ticketWorkers.find(
    (ticketWorker) =>
      ticketWorker.market_job_id === firstTicket.market_job_id &&
      ticketWorker.worker_account_id === worker.id
  );

  assert.ok(sharedTicketWorker);
  // Roster ยังไม่ Lock: worker คนเดิมยังเป็น WORKING แม้ Booth ที่ตัวเองทำจะ COMPLETED แล้ว
  assert.equal(sharedTicketWorker.status, "WORKING");

  /* -------------------------------------- Admin ยกเลิก Worker ทั้ง TicketNumber -------------------------------------- */

  const cancelResponse = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/workers/${worker.username}/assignment/cancel`,
    {
      token: adminToken,
      body: {
        reason: "replace worker before ticket locks",
      },
    }
  );

  assert.equal(cancelResponse.status, 200);
  assert.equal(assignment.status, "CANCELLED");

  // Ticket ยังไม่ Lock -> Global Cancel ต้อง Cascade มาถอด Roster ของ Ticket นี้ด้วย
  assert.equal(sharedTicketWorker.status, "CANCELLED");
  assert.ok(sharedTicketWorker.cancelled_at);
  assert.equal(sharedTicketWorker.completed_at, null);

  /* -------------------------------------- Admin เพิ่ม Worker ทดแทน -------------------------------------- */

  await workerQueue.enqueueWorker(replacementWorker.id);

  const replacementResponse = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/assign-workers`,
    {
      token: adminToken,
      body: {
        worker_codes: [replacementWorker.username],
      },
    }
  );

  assert.equal(replacementResponse.status, 201);

  const replacementAssignment = state.assignments.find(
    (item) =>
      item.vehicle_job_id === job.id &&
      item.worker_account_id === replacementWorker.id &&
      item.status === "PENDING"
  );

  assert.ok(replacementAssignment);

  /* -------------------------------------- Complete Booth 2 -------------------------------------- */

  replacementAssignment.status = "SCANNED";
  replacementAssignment.scanned_at = new Date().toISOString();
  secondTicket.status = "WORKING";

  const secondProducts = state.ticketProducts.filter(
    (product) => product.ticket_id === secondTicket.id
  );

  // syncTicketWorkersFromVehicleAssignments เกิดตอน submit นี้เอง เพิ่ม Roster ของ Worker ทดแทน
  const secondSubmitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token: replacementToken,
      body: {
        ticket_no: sharedMarket.ticket_no,
        boothCode: secondTicket.boothCode,
        items: secondProducts.map((product, index) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: index === 0 ? 10 : 4,
        })),
      },
    }
  );

  assert.equal(secondSubmitResponse.status, 200);

  const replacementTicketWorker = state.ticketWorkers.find(
    (ticketWorker) =>
      ticketWorker.market_job_id === firstTicket.market_job_id &&
      ticketWorker.worker_account_id === replacementWorker.id
  );

  assert.ok(replacementTicketWorker);
  assert.equal(secondTicket.status, "DELIVERED");

  const secondSubmission = state.completionSubmissions.at(-1);

  assert.ok(secondSubmission, "Second booth completion submission must exist.");

  await processor({
    data: {
      ticketId: secondTicket.id,
      submissionId: secondSubmission.id,
      kind: "vendor_confirm",
    },
  });

  /* -------------------------------------- ตรวจผล Finalize ทั้ง Ticket -------------------------------------- */

  assert.equal(secondTicket.status, "COMPLETED");
  // ตอนนี้ทั้ง 2 Booth Terminal แล้ว -> Finalize ทั้ง Ticket รวมทั้ง Booth 1 ที่เสร็จไปก่อนหน้า
  assert.ok(firstTicket.final_stall_amount);
  assert.ok(firstTicket.financialized_at);
  assert.ok(secondTicket.final_stall_amount);
  assert.ok(secondTicket.financialized_at);

  // Worker เดิมถูก Cancel ก่อน Lock -> ไม่ได้รับเงินจาก Ticket นี้เลย แม้จะเป็นคนส่งของ Booth 1
  assert.equal(sharedTicketWorker.status, "CANCELLED");
  assert.equal(sharedTicketWorker.final_earning_amount ?? null, null);
  assert.equal(
    state.ticketWorkerPayments.some(
      (payment) => payment.ticket_worker_id === sharedTicketWorker.id
    ),
    false
  );

  // Worker ทดแทนเป็นคนเดียวใน Roster ตอน Lock -> ได้เงินเต็มจากสินค้าของ "ทั้งสอง" Booth
  assert.equal(replacementTicketWorker.status, "COMPLETED");
  assert.ok(replacementTicketWorker.final_earning_amount);
  assert.equal(
    state.ticketWorkerPayments.filter(
      (payment) => payment.ticket_worker_id === replacementTicketWorker.id
    ).length,
    4 // 2 booths x 2 products
  );

  /* -------------------------------------- Admin Financial API -------------------------------------- */

  const financialResponse = await server.request(
    "GET",
    `/api/admin/vehicle-jobs/${job.ticket_number}/financials`,
    {
      token: adminToken,
    }
  );

  assert.equal(financialResponse.status, 200);
  assert.equal(financialResponse.body.financial_status, "FINALIZED");
  assert.equal(financialResponse.body.summary.financialized_booth_count, 2);

  const financialFirstBooth = financialResponse.body.booths.find(
    (booth: { ticket_id: number }) => booth.ticket_id === firstTicket.id
  );

  assert.ok(financialFirstBooth);

  const cancelledWorkerRow = financialFirstBooth.workers.find(
    (item: { worker_code: string }) => item.worker_code === worker.username
  );
  const replacementWorkerRow = financialFirstBooth.workers.find(
    (item: { worker_code: string }) => item.worker_code === replacementWorker.username
  );

  // Worker ที่ถูก Cancel ยังต้องมองเห็นได้ใน Roster เพื่อการตรวจสอบ แต่ total_amount ของ Booth ต้องเป็น 0
  assert.ok(cancelledWorkerRow);
  assert.equal(cancelledWorkerRow.membership_status, "CANCELLED");
  assert.equal(cancelledWorkerRow.total_amount, "0.00");

  assert.ok(replacementWorkerRow);
  assert.equal(replacementWorkerRow.membership_status, "COMPLETED");
});

test("ticket financialization keeps Gate rate snapshot after MasterRate changes", async () => {
  const { token: workerToken, worker } =
    await loginWorker(9901);

  const { token: adminToken } =
    await loginJobAdmin(9900);

  /* -------------------------------------- Gate Create -------------------------------------- */

  const gateBody =
    buildGateVehicleJobBody("001");

  /*
   * Gate Quantity intentionally = 1
   *
   *เน€เธเธดเธเธเธฃเธดเธเธ เธฒเธขเธซเธฅเธฑเธเธเธฐเนเธเน confirmed_quantity = 10
   * เน€เธเธทเนเธญเธขเธทเธเธขเธฑเธเธงเนเธฒ Financialization เนเธกเนเนเธเน Gate quantity
   */
  gateBody.Booths[0].Products[0].Quantity = 1;

  const gateResponse =
    await server.request(
      "POST",
      "/api/gate/tickets",
      {
        body: gateBody,
        headers:
          await gateAuthHeaders(),
      }
    );

  assert.equal(
    gateResponse.status,
    201
  );

  assert.equal(
    gateResponse.body.WorkerCount,
    1
  );

  const job =
    state.vehicleJobs.find(
      (item) =>
        item.ticket_number ===
        gateBody.TicketNumber
    );

  assert.ok(job);

  const ticket =
    state.gateTickets.find(
      (item) =>
        item.vehicle_job_id ===
        job.id
    );

  assert.ok(ticket);

  const product =
    state.ticketProducts.find(
      (item) =>
        item.ticket_id ===
        ticket.id
    );

  assert.ok(product);

  /* -------------------------------------- เธ•เธฃเธงเธ Snapshot เธ•เธญเธ Gate Create -------------------------------------- */

  assert.equal(
    product.quantity,
    "1"
  );

  assert.equal(
    product.confirmed_quantity,
    null
  );

  assert.equal(
    product.rate_market_code,
    "0000"
  );

  assert.equal(
    product.rate_source,
    "CENTRAL_RATE"
  );

  assert.equal(
    product.stall_rate_snapshot,
    "1.5"
  );

  assert.equal(
    product.labor_rate_snapshot,
    "0.9"
  );

  assert.ok(
    product.rate_snapshot_at
  );

  const snapshotAt =
    product.rate_snapshot_at;

  /* -------------------------------------- เน€เธเธฅเธตเนเธขเธ Master Rate เธซเธฅเธฑเธ Gate Create -------------------------------------- */

  const centralRate =
    state.masterRates.find(
      (rate) =>
        rate.marketCode === "0000" &&
        rate.id === 1
    );

  assert.ok(centralRate);

  centralRate.stallRate =
    centralRate.stallRate.plus(
      "997.5"
    );

  centralRate.laborRate =
    centralRate.laborRate.plus(
      "998.1"
    );

  // Master เธเธฑเธเธเธธเธเธฑเธเน€เธเธฅเธตเนเธขเธเน€เธเนเธ 999 เนเธฅเนเธงเธเธฃเธดเธ
  assert.equal(
    centralRate.stallRate.toString(),
    "999"
  );

  assert.equal(
    centralRate.laborRate.toString(),
    "999"
  );

  // เนเธ•เน Snapshot เธเธญเธ TicketProduct เธ•เนเธญเธเนเธกเนเน€เธเธฅเธตเนเธขเธ
  assert.equal(
    product.stall_rate_snapshot,
    "1.5"
  );

  assert.equal(
    product.labor_rate_snapshot,
    "0.9"
  );

  assert.equal(
    product.rate_snapshot_at,
    snapshotAt
  );

  /* -------------------------------------- Worker Assignment -------------------------------------- */

  const assignment =
    addPendingAssignment(
      19901,
      job.id,
      worker.id
    );

  assignment.status = "SCANNED";
  assignment.scanned_at =
    new Date().toISOString();

  /* -------------------------------------- Submit Actual Quantity -------------------------------------- */

  const submitResponse =
    await server.request(
      "POST",
      `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
      {
        token:
          workerToken,

        body: {
          ticket_no:
            gateBody.TicketNo,

          boothCode:
            ticket.boothCode,

          items: [
            {
              productCode:
                product.productCode,

              packageCode:
                product.packageCode,

              confirmed_quantity:
                10,
            },
          ],
        },
      }
    );

  assert.equal(
    submitResponse.status,
    200
  );

  assert.equal(
    ticket.status,
    "DELIVERED"
  );

  // Actual = 10 เนเธกเน Gate Quantity = 1
  assert.equal(
    product.confirmed_quantity,
    "10"
  );

  /* -------------------------------------- Vendor Auto Confirm -------------------------------------- */

  workerDispatch
    .startAssignmentTimeoutProcessing();

  const queueName =
    process.env
      .BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;

  const processor =
    state.workerProcessors.get(
      queueName
    );

  assert.ok(
    processor,
    "Assignment timeout processor must be registered."
  );

  const submission =
    state.completionSubmissions.at(-1);

  assert.ok(
    submission,
    "Completion submission must exist."
  );

  await processor({
    data: {
      ticketId:
        ticket.id,

      submissionId:
        submission.id,

      kind:
        "vendor_confirm",
    },
  });

  /* -------------------------------------- เธ•เธฃเธงเธ Financial Result -------------------------------------- */

  assert.equal(
    ticket.status,
    "COMPLETED"
  );

  assert.ok(
    ticket.financialized_at
  );

  assert.equal(
    ticket.final_stall_amount,
    "24.00"
  );

  assert.equal(
    state.ticketProductFinancials.length,
    1
  );

  assert.equal(
    state.ticketWorkerPayments.length,
    1
  );

  const financial =
    state.ticketProductFinancials[0];

  /*
   * เธ•เนเธญเธเน€เธเนเธเธเธฅเธเธฒเธ Snapshot:
   *
   * confirmed = 10
   * stallRate = 1.50
   * laborRate = 0.90
   *
   * StallRaw = 15
   * LaborRaw = 9
   * ProductCharge = 24
   */
  assert.equal(
    financial.confirmed_quantity,
    "10"
  );

  assert.equal(
    financial.stall_fee_raw,
    "15"
  );

  assert.equal(
    financial.stall_fee_rounded,
    "15"
  );

  assert.equal(
    financial.labor_fee_raw,
    "9"
  );

  assert.equal(
    financial.product_charge,
    "24"
  );

  assert.equal(
    financial.worker_count,
    1
  );

  assert.equal(
    financial.worker_payout_total,
    "9"
  );

  assert.equal(
    financial.fund_amount,
    "0"
  );

  const payment =
    state.ticketWorkerPayments[0];

  assert.equal(
    payment.raw_amount,
    "9"
  );

  assert.equal(
    payment.final_amount,
    "9"
  );

  assert.equal(
    payment.remainder_amount,
    "0"
  );

  /* -------------------------------------- Snapshot เธ•เนเธญเธเธขเธฑเธเน€เธซเธกเธทเธญเธเน€เธ”เธดเธกเธซเธฅเธฑเธ Financialize -------------------------------------- */

  assert.equal(
    product.stall_rate_snapshot,
    "1.5"
  );

  assert.equal(
    product.labor_rate_snapshot,
    "0.9"
  );

  assert.equal(
    product.rate_snapshot_at,
    snapshotAt
  );

  // Master เธขเธฑเธเน€เธเนเธ 999 เน€เธเธทเนเธญเธขเธทเธเธขเธฑเธเธงเนเธฒเนเธกเนเนเธ”เน revert เธเธฅเธฑเธ
  assert.equal(
    centralRate.stallRate.toString(),
    "999"
  );

  assert.equal(
    centralRate.laborRate.toString(),
    "999"
  );

  /* -------------------------------------- Admin Financial API -------------------------------------- */

  const financialResponse =
    await server.request(
      "GET",
      `/api/admin/vehicle-jobs/${job.ticket_number}/financials`,
      {
        token:
          adminToken,
      }
    );

  assert.equal(
    financialResponse.status,
    200
  );

  assert.equal(
    financialResponse.body
      .financial_status,
    "FINALIZED"
  );

  assert.deepEqual(
    financialResponse.body.summary,
    {
      booth_count:
        1,

      financialized_booth_count:
        1,

      final_stall_amount:
        "24.00",

      labor_fee_raw:
        "9.0000",

      worker_payout_total:
        "9.00",

      fund_amount:
        "0.0000",
    }
  );

  const financialProduct =
    financialResponse.body
      .booths[0]
      .products[0];

  // API เธ•เนเธญเธเธฃเธฒเธขเธเธฒเธ Snapshot เน€เธ”เธดเธก เนเธกเนเนเธเน Master 999
  assert.equal(
    financialProduct
      .rate_snapshot
      .stall_rate_snapshot,
    "1.50"
  );

  assert.equal(
    financialProduct
      .rate_snapshot
      .labor_rate_snapshot,
    "0.90"
  );

  assert.equal(
    financialProduct
      .confirmed_quantity,
    "10.00"
  );

  assert.equal(
    financialProduct
      .financial
      .stall_fee_raw,
    "15.0000"
  );

  assert.equal(
    financialProduct
      .financial
      .labor_fee_raw,
    "9.0000"
  );

  assert.equal(
    financialProduct
      .financial
      .product_charge,
    "24.00"
  );

  assert.equal(
    financialProduct
      .financial
      .worker_payout_total,
    "9.00"
  );

  assert.equal(
    financialProduct
      .financial
      .fund_amount,
    "0.0000"
  );
});

test("ticket financialization rejects partial financial state without overwriting persisted money", async () => {
  const worker = addWorker(9951);

  const job = addDispatchableJob(
    995,
    1
  );

  const ticket =
    addTicketForVehicleJob(
      job.id,
      19950
    );

  const products =
    state.ticketProducts.filter(
      (product) =>
        product.ticket_id ===
        ticket.id
    );

  assert.equal(
    products.length,
    2
  );

  const financializedAttemptAt =
    "2026-08-09T08:00:00.000Z";

  /* -------------------------------------- เน€เธ•เธฃเธตเธขเธก Ticket เธชเธณเธซเธฃเธฑเธ Financialize -------------------------------------- */

  ticket.status = "COMPLETED";
  ticket.confirmation_status = "COMPLETED";
  ticket.completed_at =
    financializedAttemptAt;

  ticket.final_stall_amount = null;
  ticket.financialized_at = null;

  job.status = "WORKING";

  /* -------------------------------------- Confirmed Quantity + Snapshot เธเธฃเธ -------------------------------------- */

  products.forEach(
    (product, index) => {
      product.confirmed_quantity =
        index === 0
          ? "10"
          : "4";

      product.package_weight_snapshot =
        "20";

      product.rate_id_snapshot =
        1;

      product.source_rate_id_snapshot =
        1;

      product.rate_market_code =
        "0000";

      product.rate_source =
        "CENTRAL_RATE";

      product.weight_range_name =
        "1-25.0";

      product.weight_min_snapshot =
        "0";

      product.weight_max_snapshot =
        "25";

      product.stall_rate_snapshot =
        "1.5";

      product.labor_rate_snapshot =
        "0.9";

      product.rate_snapshot_at =
        financializedAttemptAt;
    }
  );

  /* -------------------------------------- Completed Worker -------------------------------------- */

  const ticketWorker = {
    id:
      state.nextTicketWorkerId++,

    market_job_id:
      ticket.market_job_id,

    worker_account_id:
      worker.id,

    status:
      "COMPLETED",

    joined_at:
      financializedAttemptAt,

    cancelled_at:
      null,

    completed_at:
      financializedAttemptAt,
  };

  state.ticketWorkers.push(
    ticketWorker
  );

  /* -------------------------------------- เธเธณเธฅเธญเธ Corrupted Partial State -------------------------------------- */

  /*
   * Product 1 เธกเธต Financial เธญเธขเธนเนเนเธฅเนเธง
   * เนเธ•เน Ticket เธขเธฑเธเนเธกเนเธกเธต financialized_at
   *
   * Product 2 เธขเธฑเธเนเธกเนเธกเธต Financial
   */
  const existingFinancial = {
    id:
      state
        .nextTicketProductFinancialId++,

    ticket_product_id:
      products[0].id,

    confirmed_quantity:
      "10",

    stall_fee_raw:
      "15",

    stall_fee_rounded:
      "15",

    labor_fee_raw:
      "9",

    product_charge:
      "24",

    worker_count:
      1,

    worker_payout_total:
      "9",

    fund_amount:
      "0",

    finalized_at:
      financializedAttemptAt,
  };

  state.ticketProductFinancials.push(
    existingFinancial
  );

  const existingPayment = {
    id:
      state
        .nextTicketWorkerPaymentId++,

    ticket_product_financial_id:
      existingFinancial.id,

    ticket_worker_id:
      ticketWorker.id,

    raw_amount:
      "9",

    remainder_amount:
      "0",

    final_amount:
      "9",
  };

  state.ticketWorkerPayments.push(
    existingPayment
  );

  /* -------------------------------------- Snapshot State เธเนเธญเธ Finalize -------------------------------------- */

  const financialBefore = {
    ...existingFinancial,
  };

  const paymentBefore = {
    ...existingPayment,
  };

  const financialCountBefore =
    state.ticketProductFinancials.length;

  const paymentCountBefore =
    state.ticketWorkerPayments.length;

  assert.equal(
    financialCountBefore,
    1
  );

  assert.equal(
    paymentCountBefore,
    1
  );

  assert.equal(
    state.ticketProductFinancials.some(
      (financial) =>
        financial.ticket_product_id ===
        products[1].id
    ),
    false
  );

  /* -------------------------------------- Attempt 1 -------------------------------------- */

  await assert.rejects(
    () =>
      ticketFinancialService
        .finalizeMarketJobFinancials(
          ticket.market_job_id
        ),

    (error) =>
      Boolean(
        error &&
        typeof error === "object" &&
        (
          error as {
            statusCode?: number;
            code?: string;
          }
        ).statusCode === 500 &&
        (
          error as {
            statusCode?: number;
            code?: string;
          }
        ).code ===
        "TICKET_FINANCIAL_PARTIAL_STATE"
      )
  );

  /* -------------------------------------- เธซเนเธฒเธกเน€เธเธตเธขเธเน€เธเธดเนเธก / เธซเนเธฒเธกเนเธเนเธเธญเธเน€เธ”เธดเธก -------------------------------------- */

  assert.equal(
    state.ticketProductFinancials.length,
    financialCountBefore
  );

  assert.equal(
    state.ticketWorkerPayments.length,
    paymentCountBefore
  );

  assert.deepEqual(
    state.ticketProductFinancials[0],
    financialBefore
  );

  assert.deepEqual(
    state.ticketWorkerPayments[0],
    paymentBefore
  );

  // Product 2 เธซเนเธฒเธกเธ–เธนเธเธชเธฃเนเธฒเธ Financial
  assert.equal(
    state.ticketProductFinancials.some(
      (financial) =>
        financial.ticket_product_id ===
        products[1].id
    ),
    false
  );

  // Ticket marker เธซเนเธฒเธกเธ–เธนเธเน€เธเธตเธขเธ
  assert.equal(
    ticket.final_stall_amount,
    null
  );

  assert.equal(
    ticket.financialized_at,
    null
  );

  /* -------------------------------------- Attempt 2 เธ•เนเธญเธเธขเธฑเธ Reject เน€เธซเธกเธทเธญเธเน€เธ”เธดเธก -------------------------------------- */

  await assert.rejects(
    () =>
      ticketFinancialService
        .finalizeMarketJobFinancials(
          ticket.market_job_id
        ),

    (error) =>
      Boolean(
        error &&
        typeof error === "object" &&
        (
          error as {
            statusCode?: number;
            code?: string;
          }
        ).statusCode === 500 &&
        (
          error as {
            statusCode?: number;
            code?: string;
          }
        ).code ===
        "TICKET_FINANCIAL_PARTIAL_STATE"
      )
  );

  // เธฅเธญเธเธเนเธณเธเนเธขเธฑเธเธซเนเธฒเธกเน€เธเธดเนเธก record
  assert.equal(
    state.ticketProductFinancials.length,
    financialCountBefore
  );

  assert.equal(
    state.ticketWorkerPayments.length,
    paymentCountBefore
  );

  assert.deepEqual(
    state.ticketProductFinancials[0],
    financialBefore
  );

  assert.deepEqual(
    state.ticketWorkerPayments[0],
    paymentBefore
  );

  assert.equal(
    ticket.final_stall_amount,
    null
  );

  assert.equal(
    ticket.financialized_at,
    null
  );
});

/* -------------------------------------- Ticket-Level Worker Cancel Route Tests -------------------------------------- */

test("POST /api/admin/vehicle-jobs/:ticketNumber/tickets/:ticketNo/workers/:workerCode/cancel removes the worker from only that Business Ticket's roster, leaving the VehicleJobAssignment and the worker's other Business Ticket untouched", async () => {
  const { token: workerToken, worker } = await loginWorker(9601);
  const { token: adminToken } = await loginJobAdmin(9600);

  const job = addDispatchableJob(960, 1);
  const firstTicket = addTicketForVehicleJob(job.id, 19601, 296001);
  const secondTicket = addTicketForVehicleJob(job.id, 19602, 296002);

  assert.notEqual(firstTicket.market_job_id, secondTicket.market_job_id);

  const firstMarket = state.marketJobs.find((item) => item.id === firstTicket.market_job_id)!;

  const assignment = addPendingAssignment(19603, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();

  const now = new Date().toISOString();

  state.ticketWorkers.push(
    {
      id: state.nextTicketWorkerId++,
      market_job_id: firstTicket.market_job_id,
      worker_account_id: worker.id,
      status: "WORKING",
      joined_at: now,
      cancelled_at: null,
      completed_at: null,
    },
    {
      id: state.nextTicketWorkerId++,
      market_job_id: secondTicket.market_job_id,
      worker_account_id: worker.id,
      status: "WORKING",
      joined_at: now,
      cancelled_at: null,
      completed_at: null,
    }
  );

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/tickets/${firstMarket.ticket_no}/workers/${worker.username}/cancel`,
    {
      token: adminToken,
      body: {
        reason: "vendor requested a different worker for this ticket only",
      },
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "CANCELLED");
  assert.equal(response.body.worker_code, worker.username);
  assert.equal(response.body.ticket_number, job.ticket_number);
  assert.equal(response.body.ticket_no, firstMarket.ticket_no);

  const firstTicketWorker = state.ticketWorkers.find(
    (item) =>
      item.market_job_id === firstTicket.market_job_id &&
      item.worker_account_id === worker.id
  );
  const secondTicketWorker = state.ticketWorkers.find(
    (item) =>
      item.market_job_id === secondTicket.market_job_id &&
      item.worker_account_id === worker.id
  );

  assert.equal(firstTicketWorker?.status, "CANCELLED");
  assert.ok(firstTicketWorker?.cancelled_at);

  // ต่างจาก Global Cancel: Assignment ระดับรถและ Roster ของ Ticket อื่นต้องไม่ถูกแตะ
  assert.equal(secondTicketWorker?.status, "WORKING");
  assert.equal(secondTicketWorker?.cancelled_at, null);
  assert.equal(assignment.status, "SCANNED");

  // Worker ยังส่งของ Ticket ที่สอง (ที่ยังไม่ถูก Cancel) ได้ตามปกติ
  const secondProducts = state.ticketProducts.filter(
    (product) => product.ticket_id === secondTicket.id
  );
  const secondMarket = state.marketJobs.find((item) => item.id === secondTicket.market_job_id)!;
  const submitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token: workerToken,
      body: {
        ticket_no: secondMarket.ticket_no,
        boothCode: secondTicket.boothCode,
        items: secondProducts.map((product, index) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: index === 0 ? 10 : 4,
        })),
      },
    }
  );

  assert.equal(submitResponse.status, 200);
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/tickets/:ticketNo/workers/:workerCode/cancel returns 404 when the worker is not an active member of that Business Ticket", async () => {
  const { token: adminToken } = await loginJobAdmin(9610);
  const worker = addWorker(9611);

  const job = addDispatchableJob(961, 1);
  const ticket = addTicketForVehicleJob(job.id, 19611);
  const market = state.marketJobs.find((item) => item.id === ticket.market_job_id)!;

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/tickets/${market.ticket_no}/workers/${worker.username}/cancel`,
    {
      token: adminToken,
      body: {},
    }
  );

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "TICKET_WORKER_NOT_FOUND");
});

/* -------------------------------------- Admin Override Count Route Tests -------------------------------------- */

test("POST /api/admin/vehicle-jobs/:ticketNumber/stalls/:stallCode/override-count overrides product quantities and records the admin action", async () => {
  const { token } = await loginJobAdmin(9800);
  const job = addDispatchableJob(980, 1);
  const ticket = addTicketForVehicleJob(job.id, 19800);
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id,
  );

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/stalls/${ticket.boothCode}/override-count`,
    {
      token,
      body: {
        reason_code: "R001",
        reason_text: "กรอกข้อมูลผิดพลาด",
        counts: [
          {
            productCode: products[0].productCode,
            packageCode: products[0].packageCode,
            actual_quantity: 15,
          },
        ],
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.ticket_number, job.ticket_number);
  assert.equal(response.body.boothCode, ticket.boothCode);
  assert.equal(response.body.reason_code, "R001");
  assert.equal(response.body.products.length, 1);
  assert.equal(response.body.products[0].confirmed_quantity, "15");
  assert.equal(response.body.products[0].previous_quantity, null);

  const updatedProduct = state.ticketProducts.find(
    (product) => product.id === products[0].id,
  );

  assert.equal(updatedProduct?.confirmed_quantity, "15");

  const log = state.adminActionLogs.find(
    (item) => item.vehicle_job_id === job.id,
  );

  assert.ok(log);
  assert.equal(log.action_type, "OVERRIDE_COUNT");
  assert.equal(log.gate_ticket_id, ticket.id);
  assert.equal(log.reason_code, "R001");
  assert.equal(log.reason_text, "กรอกข้อมูลผิดพลาด");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/stalls/:stallCode/override-count returns 404 for an unknown booth", async () => {
  const { token } = await loginJobAdmin(9810);
  const job = addDispatchableJob(981, 1);
  addTicketForVehicleJob(job.id, 19810);

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/stalls/UNKNOWN-STALL/override-count`,
    {
      token,
      body: {
        reason_code: "R001",
        counts: [{ productCode: "X", packageCode: "Y", actual_quantity: 1 }],
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "TICKET_NOT_FOUND");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/stalls/:stallCode/override-count returns 404 for an unknown product", async () => {
  const { token } = await loginJobAdmin(9820);
  const job = addDispatchableJob(982, 1);
  const ticket = addTicketForVehicleJob(job.id, 19820);

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/stalls/${ticket.boothCode}/override-count`,
    {
      token,
      body: {
        reason_code: "R001",
        counts: [
          { productCode: "UNKNOWN", packageCode: "UNKNOWN", actual_quantity: 1 },
        ],
      },
    },
  );

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "PRODUCT_NOT_FOUND");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/stalls/:stallCode/override-count rejects a booth that already completed", async () => {
  const { token } = await loginJobAdmin(9830);
  const job = addDispatchableJob(983, 1);
  const ticket = addTicketForVehicleJob(job.id, 19830);
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id,
  );

  ticket.status = "COMPLETED";

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/stalls/${ticket.boothCode}/override-count`,
    {
      token,
      body: {
        reason_code: "R001",
        counts: [
          {
            productCode: products[0].productCode,
            packageCode: products[0].packageCode,
            actual_quantity: 5,
          },
        ],
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "INVALID_TICKET_STATUS");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/stalls/:stallCode/override-count rejects a booth that is already financialized", async () => {
  const { token } = await loginJobAdmin(9840);
  const job = addDispatchableJob(984, 1);
  const ticket = addTicketForVehicleJob(job.id, 19840);
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id,
  );

  ticket.status = "WORKING";
  ticket.financialized_at = new Date().toISOString();

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/stalls/${ticket.boothCode}/override-count`,
    {
      token,
      body: {
        reason_code: "R001",
        counts: [
          {
            productCode: products[0].productCode,
            packageCode: products[0].packageCode,
            actual_quantity: 5,
          },
        ],
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TICKET_ALREADY_FINANCIALIZED");
});

/* -------------------------------------- Admin Vehicle Wait Route Tests -------------------------------------- */

test("POST /api/admin/vehicle-jobs/:ticketNumber/wait sets the vehicle job back to WAIT and records the admin action", async () => {
  const { token } = await loginJobAdmin(9850);
  const job = addDispatchableJob(985, 1);
  const ticket = addTicketForVehicleJob(job.id, 19850);
  job.status = "WORKING";
  // Booth ยังไม่เริ่มทำงานจริง (Fixture ปกติสร้าง Booth เป็น WORKING) จึงต้องปรับกลับเป็น WAIT
  // เพื่อจำลองสถานการณ์ "รถยังไม่พร้อมเข้าจุดลงสินค้า" ที่ยัง Change to Wait ได้
  ticket.status = "WAIT";

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/wait`,
    {
      token,
      body: {
        reason_code: "R003",
        reason_text: "รถยังไม่พร้อมเข้าจุดลงสินค้า",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "WAIT");
  assert.equal(response.body.reason_code, "R003");
  assert.equal(job.status, "WAIT");

  const log = state.adminActionLogs.find(
    (item) => item.vehicle_job_id === job.id,
  );

  assert.ok(log);
  assert.equal(log.action_type, "VEHICLE_WAIT");
  assert.equal(log.reason_text, "รถยังไม่พร้อมเข้าจุดลงสินค้า");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/wait rejects a vehicle job that already has a booth in progress", async () => {
  const { token } = await loginJobAdmin(9860);
  const job = addDispatchableJob(986, 1);
  const ticket = addTicketForVehicleJob(job.id, 19860);
  job.status = "WORKING";
  ticket.status = "WORKING";

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/wait`,
    {
      token,
      body: {
        reason_code: "R003",
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "VEHICLE_JOB_ALREADY_STARTED");
  assert.equal(job.status, "WORKING");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/wait rejects a vehicle job that is already completed", async () => {
  const { token } = await loginJobAdmin(9870);
  const job = addDispatchableJob(987, 1);
  addTicketForVehicleJob(job.id, 19870);
  job.status = "COMPLETED";

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/wait`,
    {
      token,
      body: {
        reason_code: "R003",
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "VEHICLE_JOB_CLOSED");
});

/* -------------------------------------- Admin Release Workers Route Tests -------------------------------------- */

test("POST /api/admin/vehicle-jobs/:ticketNumber/release-workers releases workers back to the FIFO queue right after submit, without waiting for vendor confirmation", async () => {
  const { token: adminToken } = await loginJobAdmin(9880);
  const { token: workerToken, worker } = await loginWorker(9881);
  const job = addDispatchableJob(988, 1);
  job.tickets_closed_at = null;
  const ticket = addTicketForVehicleJob(job.id, 19880);
  const assignment = addPendingAssignment(19881, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();
  state.connectedWorkers.add(worker.id);
  await workerQueue.markWorkerAssigned(worker.id);

  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id,
  );
  const market = state.marketJobs.find((item) => item.id === ticket.market_job_id)!;

  const submitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token: workerToken,
      body: {
        ticket_no: market.ticket_no,
        boothCode: ticket.boothCode,
        items: products.map((product, index) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: index === 0 ? 10 : 4,
        })),
      },
    },
  );

  assert.equal(submitResponse.status, 200);

  // Worker ส่งยอดครบแล้ว (DELIVERED) แต่ Vendor ยังไม่ได้กดยืนยันหรือ timeout เลย — งานทางกาย
  // ของ Worker จบแล้ว ไม่ต้องรอ Vendor ก่อนถึงจะ release ได้
  assert.equal(ticket.status, "DELIVERED");
  assert.equal(job.status, "WORKING");
  assert.equal(assignment.status, "DELIVERED");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "assigned");

  // Booth ทุกใบส่งยอดครบแล้ว ไม่มีความต้องการ Worker เพิ่มสำหรับรถคันนี้อีก (จำลอง SUM ที่ควรจะ
  // ลดลงเหลือ 0 เมื่อไม่มี Booth เหลือให้ทำ) เพื่อไม่ให้ Dispatch จับ Worker ที่เพิ่ง Release กลับมาทันที
  job.workers_required = 0;

  const releaseResponse = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/release-workers`,
    {
      token: adminToken,
      body: {
        reason_code: "R004",
        reason_text: "แรงงานส่งยอดครบแล้ว",
      },
    },
  );

  assert.equal(releaseResponse.status, 200);
  assert.deepEqual(releaseResponse.body.released_worker_codes, [worker.username]);
  assert.equal(assignment.status, "RELEASED");
  assert.ok(assignment.released_at);
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "ready");

  // ปล่อย Worker ไปแล้ว แต่ตัวงาน/Ticket ยังไม่ complete จนกว่า Vendor จะยืนยันหรือ timeout จริง
  assert.equal(ticket.status, "DELIVERED");
  assert.equal(job.status, "WORKING");

  const log = state.adminActionLogs.find(
    (item) => item.vehicle_job_id === job.id,
  );

  assert.ok(log);
  assert.equal(log.action_type, "WORKERS_RELEASED");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/release-workers rejects when a booth has an unresolved vendor rejection", async () => {
  const { token: adminToken } = await loginJobAdmin(9885);
  const { worker } = await loginWorker(9886);
  const job = addDispatchableJob(9885, 1);
  const ticket = addTicketForVehicleJob(job.id, 198850);
  addPendingAssignment(198851, job.id, worker.id);
  ticket.status = "REJECT";

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/release-workers`,
    {
      token: adminToken,
      body: {
        reason_code: "R004",
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "BOOTHS_NOT_SUBMITTED");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/release-workers rejects when a booth is still pending submission", async () => {
  const { token: adminToken } = await loginJobAdmin(9890);
  const { worker } = await loginWorker(9891);
  const job = addDispatchableJob(989, 1);
  addTicketForVehicleJob(job.id, 19890);
  addPendingAssignment(19891, job.id, worker.id);

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/release-workers`,
    {
      token: adminToken,
      body: {
        reason_code: "R004",
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "BOOTHS_NOT_SUBMITTED");
});

test("POST /api/admin/vehicle-jobs/:ticketNumber/release-workers rejects a vehicle job that is already completed", async () => {
  const { token: adminToken } = await loginJobAdmin(9900);
  const job = addDispatchableJob(990, 1);
  addTicketForVehicleJob(job.id, 19900);
  job.status = "COMPLETED";

  const response = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/release-workers`,
    {
      token: adminToken,
      body: {
        reason_code: "R004",
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "VEHICLE_JOB_CLOSED");
});

/* -------------------------------------- Work History Route Tests -------------------------------------- */

test("GET /api/admin/vehicle-jobs/history returns Workers, Timeline, Finance and job-level timestamps once a Business Ticket finalizes", async () => {
  const { token: adminToken } = await loginJobAdmin(9950);
  const { token: workerToken, worker } = await loginWorker(9951);
  const job = addDispatchableJob(995, 1);
  job.tickets_closed_at = new Date().toISOString();
  const ticket = addTicketForVehicleJob(job.id, 19950);
  const assignment = addPendingAssignment(19951, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.accepted_at = new Date().toISOString();
  assignment.scanned_at = new Date().toISOString();
  state.workerAssignmentEvents.push({
    id: state.nextWorkerAssignmentEventId++,
    assignment_id: assignment.id,
    worker_account_id: assignment.worker_account_id,
    vehicle_job_id: assignment.vehicle_job_id,
    event_type: "ASSIGNED",
    occurred_at: new Date().toISOString(),
    metadata: null,
    created_at: new Date().toISOString(),
  });
  state.connectedWorkers.add(worker.id);
  await workerQueue.markWorkerAssigned(worker.id);

  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id,
  );
  const market = state.marketJobs.find((item) => item.id === ticket.market_job_id)!;

  const submitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token: workerToken,
      body: {
        ticket_no: market.ticket_no,
        boothCode: ticket.boothCode,
        items: products.map((product, index) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: index === 0 ? 10 : 4,
        })),
      },
    },
  );

  assert.equal(submitResponse.status, 200);

  workerDispatch.startAssignmentTimeoutProcessing();
  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);
  const submission = state.completionSubmissions.at(-1);

  assert.ok(submission);

  await processor!({
    data: {
      ticketId: ticket.id,
      submissionId: submission.id,
      kind: "vendor_confirm",
    },
  });

  const historyResponse = await server.request(
    "GET",
    "/api/admin/vehicle-jobs/history",
    { token: adminToken },
  );

  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.body.data.length, 1);

  const item = historyResponse.body.data[0];

  assert.equal(item.vehicle_job.ticket_number, job.ticket_number);
  assert.ok(item.vehicle_job.work_start);
  assert.ok(item.vehicle_job.submitted_complete_at);
  assert.ok(item.vehicle_job.vendor_confirmed_complete_at);

  // Workers
  assert.equal(item.workers.length, 1);
  assert.equal(item.workers[0].worker_code, worker.username);
  assert.ok(item.workers[0].accepted_at);
  assert.ok(item.workers[0].scanned_at);
  assert.ok(item.workers[0].submitted_at);
  assert.equal(item.workers[0].cancellation, null);

  // Timeline
  const timelineTypes = item.timeline.map((entry: { type: string }) => entry.type);

  assert.ok(timelineTypes.includes("GATE_ARRIVAL"));
  assert.ok(timelineTypes.includes("WORKER_ASSIGNED"));
  assert.ok(timelineTypes.includes("COUNT_SUBMITTED"));
  assert.ok(timelineTypes.includes("TICKET_CONFIRMED"));
  // Timeline ต้องเรียงตามเวลาจริง
  const occurredAts = item.timeline.map((entry: { occurred_at: string }) => entry.occurred_at);
  const sortedOccurredAts = [...occurredAts].sort();

  assert.deepEqual(occurredAts, sortedOccurredAts);

  // Booth-level Finance (Reuse จาก formatAdminFinancialBooth)
  assert.equal(item.markets.length, 1);
  assert.equal(item.markets[0].booths.length, 1);

  const booth = item.markets[0].booths[0];

  assert.equal(booth.financialized, true);
  assert.ok(booth.final_stall_amount);
  assert.equal(booth.submitted_worker_codes.length, 1);
  assert.equal(booth.submitted_worker_codes[0], worker.username);
  assert.ok(booth.submitted_at);
  assert.ok(booth.confirmedAt);
  assert.deepEqual(booth.rejection_history, []);

  // Job-level Finance
  assert.equal(item.finance.worker_count, 1);
  assert.equal(item.finance.total_worker_share, booth.summary.worker_payout_total);
  assert.equal(item.finance.stall_fee_total, booth.final_stall_amount);
});

test("GET /api/admin/vehicle-jobs/history reflects Admin actions (override count) in the Timeline", async () => {
  const { token: adminToken } = await loginJobAdmin(9960);
  const job = addDispatchableJob(996, 1);
  const ticket = addTicketForVehicleJob(job.id, 19960);
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id,
  );

  const overrideResponse = await server.request(
    "POST",
    `/api/admin/vehicle-jobs/${job.ticket_number}/stalls/${ticket.boothCode}/override-count`,
    {
      token: adminToken,
      body: {
        reason_code: "R001",
        reason_text: "กรอกข้อมูลผิดพลาด",
        counts: [
          {
            productCode: products[0].productCode,
            packageCode: products[0].packageCode,
            actual_quantity: 7,
          },
        ],
      },
    },
  );

  assert.equal(overrideResponse.status, 200);

  const historyResponse = await server.request(
    "GET",
    "/api/admin/vehicle-jobs/history",
    { token: adminToken },
  );

  assert.equal(historyResponse.status, 200);

  const item = historyResponse.body.data[0];
  const adminEntry = item.timeline.find(
    (entry: { type: string }) => entry.type === "ADMIN_ACTION",
  );

  assert.ok(adminEntry);
  assert.equal(adminEntry.actor_type, "admin");

  const overriddenProduct = item.markets[0].booths[0].products.find(
    (product: { productCode: string }) => product.productCode === products[0].productCode,
  );

  assert.equal(overriddenProduct.confirmed_quantity, "7.00");
});

/* -------------------------------------- Daily Worker Income Route Tests -------------------------------------- */

test("GET /api/admin/vehicle-jobs/history/daily-worker-income lists one row per Worker per Business Ticket with the locked payout", async () => {
  const { token: adminToken } = await loginJobAdmin(9970);
  const { token: workerToken, worker } = await loginWorker(9971);
  const job = addDispatchableJob(997, 1);
  job.tickets_closed_at = new Date().toISOString();
  const ticket = addTicketForVehicleJob(job.id, 19970);
  const assignment = addPendingAssignment(19971, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.accepted_at = new Date().toISOString();
  assignment.scanned_at = new Date().toISOString();
  state.connectedWorkers.add(worker.id);
  await workerQueue.markWorkerAssigned(worker.id);

  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === ticket.id,
  );
  const market = state.marketJobs.find((item) => item.id === ticket.market_job_id)!;

  const submitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticket_number}/tickets/complete`,
    {
      token: workerToken,
      body: {
        ticket_no: market.ticket_no,
        boothCode: ticket.boothCode,
        items: products.map((product, index) => ({
          productCode: product.productCode,
          packageCode: product.packageCode,
          confirmed_quantity: index === 0 ? 10 : 4,
        })),
      },
    },
  );

  assert.equal(submitResponse.status, 200);

  workerDispatch.startAssignmentTimeoutProcessing();
  const queueName = process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string;
  const processor = state.workerProcessors.get(queueName);
  const submission = state.completionSubmissions.at(-1);

  assert.ok(submission);

  await processor!({
    data: {
      ticketId: ticket.id,
      submissionId: submission.id,
      kind: "vendor_confirm",
    },
  });

  const marketJob = state.marketJobs.find(
    (item) => item.id === ticket.market_job_id,
  );
  const ticketWorker = state.ticketWorkers.find(
    (item) => item.market_job_id === ticket.market_job_id,
  );

  assert.ok(marketJob);
  assert.ok(ticketWorker);
  assert.ok(ticketWorker.final_earning_amount);

  const response = await server.request(
    "GET",
    "/api/admin/vehicle-jobs/history/daily-worker-income",
    { token: adminToken },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);

  const row = response.body.data[0];

  assert.equal(row.id, `${marketJob.ticket_no}-${marketJob.marketCode}`);
  assert.equal(row.ticket_number, job.ticket_number);
  assert.equal(row.marketJobNo, marketJob.ticket_no);
  assert.equal(row.plate, job.license_plate);
  assert.equal(row.worker.code, worker.username);
  assert.equal(row.assigned_stalls, 1);
  assert.equal(row.confirmed_stalls, 1);
  assert.equal(row.payable, ticketWorker.final_earning_amount);
  assert.equal(row.status, "COMPLETED");
  assert.ok(row.accepted_at);
  assert.ok(row.scanned_at);
  assert.ok(row.submitted_at);
  assert.ok(row.confirmedAt);
  assert.equal(row.cancellation, null);
});

test("GET /api/admin/vehicle-jobs/history/daily-worker-income supports workerCode/from/to alias filters", async () => {
  const { token: adminToken } = await loginJobAdmin(9980);
  const workerA = addWorker(9981);
  const workerB = addWorker(9982);
  const jobA = addDispatchableJob(998, 1);
  const ticketA = addTicketForVehicleJob(jobA.id, 19980);
  const jobB = addDispatchableJob(999, 1);
  const ticketB = addTicketForVehicleJob(jobB.id, 19990);
  const now = new Date().toISOString();

  state.ticketWorkers.push(
    {
      id: state.nextTicketWorkerId++,
      market_job_id: ticketA.market_job_id,
      worker_account_id: workerA.id,
      status: "COMPLETED",
      final_earning_amount: "12.00",
      joined_at: now,
      cancelled_at: null,
      completed_at: now,
    },
    {
      id: state.nextTicketWorkerId++,
      market_job_id: ticketB.market_job_id,
      worker_account_id: workerB.id,
      status: "COMPLETED",
      final_earning_amount: "8.00",
      joined_at: now,
      cancelled_at: null,
      completed_at: now,
    },
  );

  const response = await server.request(
    "GET",
    `/api/admin/vehicle-jobs/history/daily-worker-income?workerCode=${workerA.username}`,
    { token: adminToken },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].worker.code, workerA.username);
  assert.equal(response.body.data[0].payable, "12.00");
});

/* -------------------------------------- Worker Queue Route Tests -------------------------------------- */
