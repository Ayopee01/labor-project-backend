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
    ticket_id: ticket.id,
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
    `/api/admin/vehicle-jobs/${job.ticketNo}/financials`,
    {
      token,
    }
  );

  assert.equal(response.status, 200);

  assert.equal(
    response.body.vehicle_job.ticketNo,
    job.ticketNo
  );

  assert.equal(
    response.body.vehicle_job.gate_transaction_ref,
    job.gate_transaction_ref
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
    `/api/admin/vehicle-jobs/${job.ticketNo}/financials`,
    {
      token,
    }
  );

  assert.equal(response.status, 200);

  assert.equal(
    response.body.vehicle_job.ticketNo,
    job.ticketNo
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
  job.booth_count = 2;

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
    `/api/admin/vehicle-jobs/${job.ticketNo}/financials`,
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
    ticket_id: ticket.id,
    worker_account_id: firstWorker.id,
    status: "WORKING",
    final_earning_amount: null,
    joined_at: scannedAt,
    cancelled_at: null,
    completed_at: null,
  };

  const cancelledTicketWorker = {
    id: state.nextTicketWorkerId++,
    ticket_id: ticket.id,
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
    `/api/admin/vehicle-jobs/${job.ticketNo}/workers/${secondWorker.username}/assignment/cancel`,
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
    `/api/admin/vehicle-jobs/${job.ticketNo}/assign-workers`,
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
    `/api/workers/me/assignments/${job.ticketNo}/tickets/complete`,
    {
      token: workerToken,
      body: {
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
        ticketWorker.ticket_id === ticket.id &&
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
    `/api/admin/vehicle-jobs/${job.ticketNo}/financials`,
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

test("admin cancel on next booth preserves worker earnings from completed booth", async () => {
  const { token: workerToken, worker } =
    await loginWorker(9801);

  const replacementWorker =
    addWorker(9802);

  const { token: adminToken } =
    await loginJobAdmin(9800);

  const job =
    addDispatchableJob(980, 1);

  const firstTicket =
    addTicketForVehicleJob(
      job.id,
      19800
    );

  const secondTicket =
    addTicketForVehicleJob(
      job.id,
      19801
    );

  // Booth 2 เธ•เนเธญเธเธฃเธญ Booth 1 เธเธเธเนเธญเธ
  secondTicket.status = "WAIT";

  job.booth_count = 2;

  const assignment =
    addPendingAssignment(
      19802,
      job.id,
      worker.id
    );

  assignment.status = "SCANNED";
  assignment.scanned_at =
    new Date().toISOString();

  const firstProducts =
    state.ticketProducts.filter(
      (product) =>
        product.ticket_id ===
        firstTicket.id
    );

  /* -------------------------------------- Complete Booth 1 -------------------------------------- */

  const firstSubmitResponse =
    await server.request(
      "POST",
      `/api/workers/me/assignments/${job.ticketNo}/tickets/complete`,
      {
        token: workerToken,
        body: {
          boothCode: firstTicket.boothCode,
          items: firstProducts.map(
            (product, index) => ({
              productCode:
                product.productCode,

              packageCode:
                product.packageCode,

              confirmed_quantity:
                index === 0 ? 10 : 4,
            })
          ),
        },
      }
    );

  assert.equal(
    firstSubmitResponse.status,
    200
  );

  assert.equal(
    firstTicket.status,
    "DELIVERED"
  );

  /* -------------------------------------- Vendor Auto Confirm Booth 1 -------------------------------------- */

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

  const firstSubmission =
    state.completionSubmissions.at(-1);

  assert.ok(
    firstSubmission,
    "First booth completion submission must exist."
  );

  await processor({
    data: {
      ticketId:
        firstTicket.id,

      submissionId:
        firstSubmission.id,

      kind:
        "vendor_confirm",
    },
  });

  /* -------------------------------------- เธ•เธฃเธงเธ Booth 1 เธเนเธญเธ Cancel -------------------------------------- */

  assert.equal(
    firstTicket.status,
    "COMPLETED"
  );

  assert.equal(
    firstTicket.final_stall_amount,
    "34.00"
  );

  assert.ok(
    firstTicket.financialized_at
  );

  assert.equal(
    secondTicket.status,
    "WORKING"
  );

  assert.equal(
    assignment.status,
    "WORKING"
  );

  const firstTicketWorker =
    state.ticketWorkers.find(
      (ticketWorker) =>
        ticketWorker.ticket_id ===
        firstTicket.id &&
        ticketWorker.worker_account_id ===
        worker.id
    );

  assert.ok(
    firstTicketWorker
  );

  assert.equal(
    firstTicketWorker.status,
    "COMPLETED"
  );

  const firstBoothPaymentsBeforeCancel =
    state.ticketWorkerPayments
      .filter(
        (payment) =>
          payment.ticket_worker_id ===
          firstTicketWorker.id
      )
      .map((payment) => ({
        id:
          payment.id,

        ticket_product_financial_id:
          payment.ticket_product_financial_id,

        raw_amount:
          payment.raw_amount,

        remainder_amount:
          payment.remainder_amount,

        final_amount:
          payment.final_amount,
      }));

  assert.equal(
    firstBoothPaymentsBeforeCancel.length,
    2
  );

  const firstBoothAmountBeforeCancel =
    firstBoothPaymentsBeforeCancel.reduce(
      (total, payment) =>
        total +
        Number(
          payment.final_amount
        ),
      0
    );

  assert.equal(
    firstBoothAmountBeforeCancel,
    12
  );

  /*
   * Production activateNextTicketIfReady()
   * เธเธฐ sync Worker เน€เธเนเธฒ Booth เธ–เธฑเธ”เนเธเธญเธฑเธ•เนเธเธกเธฑเธ•เธด
   *
   * Route-test harness เธเธฑเธเธเธธเธเธฑเธ activate เน€เธเธเธฒเธฐเธชเธ–เธฒเธเธฐ Ticket
   * เธเธถเธเธชเธฃเนเธฒเธ membership เธเธญเธ Booth 2 เธ•เธฃเธเธเธตเน
   * เน€เธเธทเนเธญเธเธณเธฅเธญเธ state เธเธญเธ DB เธเธฃเธดเธเธเนเธญเธ Admin Cancel
   */
  const secondTicketWorker = {
    id:
      state.nextTicketWorkerId++,

    ticket_id:
      secondTicket.id,

    worker_account_id:
      worker.id,

    status:
      "WORKING",

    joined_at:
      new Date().toISOString(),

    cancelled_at:
      null,

    completed_at:
      null,
  };

  state.ticketWorkers.push(
    secondTicketWorker
  );

  /* -------------------------------------- Admin Cancel Worker A เธ—เธตเน Booth 2 -------------------------------------- */

  const cancelResponse =
    await server.request(
      "POST",
      `/api/admin/vehicle-jobs/${job.ticketNo}/workers/${worker.username}/assignment/cancel`,
      {
        token:
          adminToken,

        body: {
          reason:
            "replace worker for next booth",
        },
      }
    );

  assert.equal(
    cancelResponse.status,
    200
  );

  assert.equal(
    assignment.status,
    "CANCELLED"
  );

  // Booth 1 เธ•เนเธญเธเนเธกเนเธ–เธนเธเธขเนเธญเธเธเธฅเธฑเธเนเธเนเธเน
  assert.equal(
    firstTicketWorker.status,
    "COMPLETED"
  );

  assert.equal(
    firstTicketWorker.cancelled_at,
    null
  );

  assert.ok(
    firstTicketWorker.completed_at
  );

  // Booth 2 เน€เธ—เนเธฒเธเธฑเนเธเธ—เธตเนเธ–เธนเธ Cancel
  assert.equal(
    secondTicketWorker.status,
    "CANCELLED"
  );

  assert.ok(
    secondTicketWorker.cancelled_at
  );

  assert.equal(
    secondTicketWorker.completed_at,
    null
  );

  /* -------------------------------------- Admin Replace Worker C -------------------------------------- */

  await workerQueue.enqueueWorker(
    replacementWorker.id
  );

  const replacementResponse =
    await server.request(
      "POST",
      `/api/admin/vehicle-jobs/${job.ticketNo}/assign-workers`,
      {
        token:
          adminToken,

        body: {
          worker_codes: [
            replacementWorker.username,
          ],
        },
      }
    );

  assert.equal(
    replacementResponse.status,
    201
  );

  const replacementAssignment =
    state.assignments.find(
      (item) =>
        item.vehicle_job_id ===
        job.id &&
        item.worker_account_id ===
        replacementWorker.id &&
        item.status ===
        "PENDING"
    );

  assert.ok(
    replacementAssignment
  );

  /* -------------------------------------- เน€เธเธดเธ Booth 1 เธ•เนเธญเธเนเธกเนเน€เธเธฅเธตเนเธขเธ -------------------------------------- */

  const firstBoothPaymentsAfterCancel =
    state.ticketWorkerPayments
      .filter(
        (payment) =>
          payment.ticket_worker_id ===
          firstTicketWorker.id
      )
      .map((payment) => ({
        id:
          payment.id,

        ticket_product_financial_id:
          payment.ticket_product_financial_id,

        raw_amount:
          payment.raw_amount,

        remainder_amount:
          payment.remainder_amount,

        final_amount:
          payment.final_amount,
      }));

  assert.deepEqual(
    firstBoothPaymentsAfterCancel,
    firstBoothPaymentsBeforeCancel
  );

  const firstBoothAmountAfterCancel =
    firstBoothPaymentsAfterCancel.reduce(
      (total, payment) =>
        total +
        Number(
          payment.final_amount
        ),
      0
    );

  assert.equal(
    firstBoothAmountAfterCancel,
    12
  );

  /* -------------------------------------- Worker History -------------------------------------- */

  const assignmentCreatedAt =
    assignment.created_at;

  assert.ok(
    assignmentCreatedAt
  );

  const historyDate =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Bangkok",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    ).format(
      new Date(
        assignmentCreatedAt
      )
    );

  const historyResponse =
    await server.request(
      "GET",
      `/api/workers/me/assignments/history?date=${historyDate}`,
      {
        token:
          workerToken,
      }
    );

  assert.equal(
    historyResponse.status,
    200
  );

  const historyItem =
    historyResponse.body.data.find(
      (item: {
        ticketNo: string;
      }) =>
        item.ticketNo ===
        job.ticketNo
    );

  assert.ok(
    historyItem
  );

  // เธ–เธถเธ Assignment เธเธฐเธ–เธนเธ Cancel เธ•เธญเธ Booth 2
  // เน€เธเธดเธ Booth 1 เธ•เนเธญเธเธขเธฑเธเธญเธขเธนเน
  assert.equal(
    historyItem.status,
    "CANCELLED"
  );

  assert.equal(
    historyResponse.body.total_earnings,
    undefined
  );

  assert.equal(
    historyItem.earnings,
    undefined
  );

  const firstBoothEarning =
    state.ticketWorkers.find(
      (ticketWorker) =>
        ticketWorker.ticket_id === firstTicket.id &&
        ticketWorker.worker_account_id === worker.id
    );

  const secondBoothEarning =
    state.ticketWorkers.find(
      (ticketWorker) =>
        ticketWorker.ticket_id === secondTicket.id &&
        ticketWorker.worker_account_id === worker.id
    );

  assert.ok(
    firstBoothEarning
  );

  assert.ok(
    secondBoothEarning
  );

  // Booth 1 = เน€เธเธดเธเน€เธเนเธฒเธ•เนเธญเธเธญเธขเธนเนเธเธฃเธ
  assert.equal(
    firstBoothEarning.status,
    "COMPLETED"
  );

  assert.equal(
    firstBoothEarning.final_earning_amount,
    "12.00"
  );

  // Booth 2 = Cancel เนเธฅเนเธงเธเธถเธเนเธกเนเธกเธตเน€เธเธดเธ
  assert.equal(
    secondBoothEarning.status,
    "CANCELLED"
  );

  assert.equal(
    secondBoothEarning.final_earning_amount ?? null,
    null
  );

  /* -------------------------------------- Admin Financial API -------------------------------------- */

  const financialResponse =
    await server.request(
      "GET",
      `/api/admin/vehicle-jobs/${job.ticketNo}/financials`,
      {
        token:
          adminToken,
      }
    );

  assert.equal(
    financialResponse.status,
    200
  );

  // Booth 1 เธเธ เนเธ•เน Booth 2 เธขเธฑเธเนเธกเนเธเธ
  assert.equal(
    financialResponse.body
      .financial_status,
    "PARTIAL"
  );

  assert.deepEqual(
    financialResponse.body.summary,
    {
      booth_count:
        2,

      financialized_booth_count:
        1,

      final_stall_amount:
        "34.00",

      labor_fee_raw:
        "12.6000",

      worker_payout_total:
        "12.00",

      fund_amount:
        "0.6000",
    }
  );

  const financialFirstBooth =
    financialResponse.body.booths.find(
      (booth: {
        ticket_id: number;
      }) =>
        booth.ticket_id ===
        firstTicket.id
    );

  const financialSecondBooth =
    financialResponse.body.booths.find(
      (booth: {
        ticket_id: number;
      }) =>
        booth.ticket_id ===
        secondTicket.id
    );

  assert.ok(
    financialFirstBooth
  );

  assert.ok(
    financialSecondBooth
  );

  const completedWorker =
    financialFirstBooth.workers.find(
      (item: {
        worker_code: string;
      }) =>
        item.worker_code ===
        worker.username
    );

  const cancelledWorker =
    financialSecondBooth.workers.find(
      (item: {
        worker_code: string;
      }) =>
        item.worker_code ===
        worker.username
    );

  assert.ok(
    completedWorker
  );

  assert.ok(
    cancelledWorker
  );

  assert.equal(
    completedWorker.membership_status,
    "COMPLETED"
  );

  assert.equal(
    completedWorker.total_amount,
    "12.00"
  );

  assert.equal(
    cancelledWorker.membership_status,
    "CANCELLED"
  );

  assert.equal(
    cancelledWorker.total_amount,
    "0.00"
  );
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
        item.ticketNo ===
        gateBody.TicketNo
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
      `/api/workers/me/assignments/${job.ticketNo}/tickets/complete`,
      {
        token:
          workerToken,

        body: {
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
      `/api/admin/vehicle-jobs/${job.ticketNo}/financials`,
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

    ticket_id:
      ticket.id,

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
        .finalizeTicketFinancials(
          ticket.id
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
        .finalizeTicketFinancials(
          ticket.id
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

/* -------------------------------------- Worker Queue Route Tests -------------------------------------- */
