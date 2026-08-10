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
let ticketFinancialService: typeof import("../../src/services/ticket-financial.service");

/* -------------------------------------- Test Helpers -------------------------------------- */

// Function จัดการ login worker สำหรับ test
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

// Function สร้าง gate vehicle job body สำหรับ test
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

// Function จัดการ gate auth headers สำหรับ test
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

// Function จัดการ login job admin สำหรับ test
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

test("POST /api/gate/tickets requires Gate client credentials", async () => {
  const response = await server.request("POST", "/api/gate/tickets", {
    body: buildGateVehicleJobBody("000"),
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, "GATE_AUTH_REQUIRED");
});

test("POST /api/gate/tickets rejects invalid Gate client credentials", async () => {
  addGateClient("gate-test", await password.hashPassword("GateSecret@123456"));

  const response = await server.request("POST", "/api/gate/tickets", {
    body: buildGateVehicleJobBody("000B"),
    headers: {
      Authorization: `Basic ${Buffer.from("gate-test:wrong-secret").toString("base64")}`,
    },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.code, "INVALID_GATE_CREDENTIALS");
});

test("POST /api/gate/tickets creates a new Gate ticket", async () => {
  const response = await server.request("POST", "/api/gate/tickets", {
    body: buildGateVehicleJobBody("001"),
    headers: await gateAuthHeaders(),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "Booths",
    "Market",
    "Qr",
    "Result",
    "Ticket",
    "WorkerCount",
  ]);
  assert.deepEqual(Object.keys(response.body.Ticket).sort(), [
    "BoothCount",
    "LicensePlate",
    "Status",
    "TicketCreatedAt",
    "TicketNo",
    "VehicleTypeCode",
    "VehicleTypeName",
  ]);
  assert.equal(response.body.Result, "CREATED");
  assert.equal(response.body.Ticket.TicketNo, "TKT-20260723-001");
  assert.equal(response.body.Ticket.TicketCreatedAt, "2026-07-23T07:30:00.000Z");
  assert.equal(response.body.Ticket.BoothCount, 1);
  assert.equal(response.body.Ticket.LicensePlate, "ABC-001");
  assert.equal(response.body.Ticket.VehicleTypeCode, "PICKUP");
  assert.equal(response.body.Ticket.VehicleTypeName, "Pickup truck");
  assert.equal(response.body.Ticket.Status, "unload_now");
  assert.equal(response.body.Market.MarketCode, "MARKET-001");
  assert.equal(response.body.Market.MarketName, "Market A");
  assert.equal(response.body.Booths.length, 1);

  const firstBooth = response.body.Booths[0];
  const firstProduct = firstBooth.Products[0];

  assert.equal(firstBooth.BoothCode, "STALL-001");
  assert.equal(firstBooth.BoothName, "Vendor A");
  assert.equal(firstBooth.Products.length, 1);
  assert.equal(firstProduct.ProductCode, "02020300");
  assert.equal(firstProduct.ProductFullCode, "02020300000000000000");
  assert.equal(firstProduct.ProductName, "Rambutan");
  assert.equal(firstProduct.PackageCode, "29");
  assert.equal(firstProduct.PackageName, "Crate 20");
  assert.equal(firstProduct.Quantity, 180);
  assert.equal(response.body.WorkerCount, 3);
  assert.equal(firstProduct.WorkerCount, 3);

  assert.equal(firstProduct.StallAmount, undefined);
  assert.equal(firstProduct.WorkerPayment, undefined);
  assert.equal(firstBooth.StallPayment, undefined);
  assert.equal(firstBooth.WorkerPayment, undefined);
  assert.equal(response.body.WorkerPayment, undefined);
  assert.equal(response.body.OrderRemainder, undefined);

  assert.equal(response.body.Qr.WorkerQrToken, "TKT-20260723-001");
  assert.equal(response.body.message, undefined);
  assert.equal(response.body.vehicle_job, undefined);
  assert.equal(response.body.gate_transaction_ref, undefined);
  assert.equal(response.body.markets, undefined);

  assert.equal(state.vehicleJobs.length, 1);
  assert.equal(state.vehicleJobs[0].vehicle_type, "Pickup truck");
  assert.equal(state.vehicleJobs[0].ticket_created_at, "2026-07-23T07:30:00.000Z");
  assert.equal(state.vehicleJobs[0].booth_count, 1);
  assert.equal(state.vehicleJobs[0].worker_qr_token, "TKT-20260723-001");

  assert.equal(state.gateTickets.length, 1);
  assert.equal(state.gateTickets[0].marketCode, "MARKET-001");
  assert.equal(state.gateTickets[0].boothCode, "STALL-001");
  assert.equal(state.gateTickets[0].boothName, "Vendor A");
  assert.equal(state.gateTickets[0].vendor_line_id, "line-vendor-stall-001");

  assert.equal(state.ticketProducts.length, 1);
  assert.equal(state.ticketProducts[0].productCode, "02020300");
  assert.equal(state.ticketProducts[0].packageCode, "29");
  assert.equal(state.ticketProducts[0].packageName, "Crate 20");

  const savedProduct = state.ticketProducts[0];
  assert.equal(savedProduct.productFullCode, "02020300000000000000");
  assert.equal(savedProduct.package_weight_snapshot, "20");
  assert.equal(savedProduct.rate_id_snapshot, 1);
  assert.equal(savedProduct.source_rate_id_snapshot, 1);
  assert.equal(savedProduct.rate_market_code, "0000");
  assert.equal(savedProduct.rate_source, "CENTRAL_RATE");
  assert.equal(savedProduct.weight_range_name, "1-25.0");
  assert.equal(savedProduct.weight_min_snapshot, "0");
  assert.equal(savedProduct.weight_max_snapshot, "25");
  assert.equal(savedProduct.stall_rate_snapshot, "1.5");
  assert.equal(savedProduct.labor_rate_snapshot, "0.9");
  assert.ok(savedProduct.rate_snapshot_at);
  assert.equal(savedProduct.confirmed_quantity, null); // Gate Create ยังไม่มีจำนวนจริง

  assert.equal(state.lineMessages.length, 2);
  const gateLineMessage = state.lineMessages[0] as {
    name?: string;
    data?: {
      to?: string;
      messages?: Array<{
        type?: string;
        contents?: unknown;
      }>;
    };
  };

  assert.equal(gateLineMessage.name, "send-gate-ticket-created");
  assert.equal(gateLineMessage.data?.to, "line-vendor-stall-001");

  const gateFlexMessage = gateLineMessage.data?.messages?.[0];
  const gateFlexContents = JSON.stringify(gateFlexMessage?.contents);

  assert.equal(gateFlexMessage?.type, "flex");
  assert.match(gateFlexContents, /TKT-20260723-001/);
  assert.match(gateFlexContents, /ABC-001/);
  assert.match(gateFlexContents, /Rambutan/);
});

test("POST /api/gate/tickets returns waiting_unload status when Dispatch is false", async () => {
  const response = await server.request("POST", "/api/gate/tickets", {
    body: {
      ...buildGateVehicleJobBody("006"),
      Dispatch: false,
    },
    headers: await gateAuthHeaders(),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.Ticket.Status, "waiting_unload");
});

test("POST /api/gate/tickets dispatches a ready connected worker to the new Gate job", async () => {
  const worker = addWorker(9701);
  state.connectedWorkers.add(worker.id);
  await workerQueue.enqueueWorker(worker.id);

  const response = await server.request("POST", "/api/gate/tickets", {
    body: buildGateVehicleJobBody("007"),
    headers: await gateAuthHeaders(),
  });

  const queueEntry = await workerQueue.getWorkerQueueStatus(worker.id);

  assert.equal(response.status, 201);
  assert.equal(state.vehicleJobs.length, 1);
  assert.equal(state.assignments.length, 1);
  assert.equal(state.assignments[0].vehicle_job_id, state.vehicleJobs[0].id);
  assert.equal(state.assignments[0].worker_account_id, worker.id);
  assert.equal(queueEntry?.status, "assigned");
  assert.ok(
    state.socketEvents.some(
      (event) => event.accountId === worker.id && event.event === "WORKER_ASSIGNED"
    )
  );
});

test("POST /api/gate/tickets replays the same Gate request", async () => {
  const body = buildGateVehicleJobBody("002");
  const headers = await gateAuthHeaders();

  const created = await server.request("POST", "/api/gate/tickets", {
    body,
    headers,
  });
  const replayed = await server.request("POST", "/api/gate/tickets", {
    body,
    headers,
  });

  assert.equal(created.status, 201);
  assert.equal(replayed.status, 200);
  assert.deepEqual(Object.keys(replayed.body).sort(), [
    "Booths",
    "Market",
    "Qr",
    "Result",
    "Ticket",
    "WorkerCount",
  ]);
  assert.equal(replayed.body.Result, "REPLAYED");
  assert.equal(replayed.body.Ticket.TicketNo, "TKT-20260723-002");
  assert.equal(replayed.body.Ticket.Status, "unload_now");
  assert.equal(replayed.body.Market.MarketCode, "MARKET-002");
  assert.equal(replayed.body.Booths[0].BoothCode, "STALL-002");
  assert.equal(replayed.body.Booths[0].Products[0].ProductCode, "02020300");
  assert.equal(replayed.body.WorkerCount, 3);
  assert.equal(replayed.body.message, undefined);
  assert.equal(replayed.body.vehicle_job, undefined);
  assert.equal(replayed.body.idempotency_key, undefined);
  assert.equal(replayed.body.duplicate_field, undefined);
  assert.equal(replayed.body.markets, undefined);
  assert.equal(state.vehicleJobs.length, 1);
});

test("POST /api/gate/tickets rejects reused Gate ref with a different payload", async () => {
  const body = buildGateVehicleJobBody("003");
  const headers = await gateAuthHeaders();

  await server.request("POST", "/api/gate/tickets", {
    body,
    headers,
  });

  const mismatch = await server.request("POST", "/api/gate/tickets", {
    body: {
      ...body,
      LicensePlate: "DIFFERENT-003",
    },
    headers,
  });

  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, "GATE_TRANSACTION_REF_PAYLOAD_MISMATCH");
  assert.equal(mismatch.body.duplicate_field, "gate_transaction_ref");
});

test("POST /api/gate/tickets creates multiple booths and products in one request", async () => {
  const body = {
    ...buildGateVehicleJobBody("004"),
    BoothCount: 2,
    Booths: [
      {
        BoothCode: "STALL-004",
        Products: [
          {
            ProductCode: "02020300",
            PackageCode: "29",
            Quantity: 180,
          },
        ],
      },
      {
        BoothCode: "STALL-004-B",
        Products: [
          {
            ProductCode: "02030103",
            PackageCode: "19",
            Quantity: 100,
          },
          {
            ProductCode: "02011701",
            PackageCode: "19",
            Quantity: 80,
          },
        ],
      },
    ],
  };

  const response = await server.request("POST", "/api/gate/tickets", {
    body,
    headers: await gateAuthHeaders(),
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.Result, "CREATED");
  assert.equal(response.body.Ticket.TicketNo, "TKT-20260723-004");
  assert.equal(response.body.Ticket.BoothCount, 2);
  assert.equal(response.body.Booths.length, 2);

  assert.equal(response.body.Booths[0].BoothCode, "STALL-004");
  assert.equal(response.body.Booths[0].BoothName, "Vendor A");
  assert.equal(response.body.Booths[0].Products.length, 1);

  assert.equal(response.body.Booths[1].BoothCode, "STALL-004-B");
  assert.equal(response.body.Booths[1].BoothName, "Vendor B");
  assert.equal(response.body.Booths[1].Products.length, 2);
  assert.equal(response.body.Booths[1].Products[0].ProductCode, "02030103");
  assert.equal(response.body.Booths[1].Products[1].ProductCode, "02011701");

  assert.equal(response.body.Booths[0].StallPayment, undefined);
  assert.equal(response.body.Booths[1].StallPayment, undefined);

  assert.equal(response.body.WorkerCount, 7);
  assert.equal(response.body.WorkerPayment, undefined);
  assert.equal(response.body.OrderRemainder, undefined);

  for (const booth of response.body.Booths) {
    for (const product of booth.Products) {
      assert.equal(product.StallAmount, undefined);
      assert.equal(product.WorkerPayment, undefined);
    }
  }

  assert.equal(state.vehicleJobs.length, 1);
  assert.equal(state.vehicleJobs[0].booth_count, 2);
  assert.equal(state.vehicleJobs[0].workers_required, 7);

  assert.equal(state.gateTickets.length, 2);
  assert.equal(state.gateTickets[0].boothCode, "STALL-004");
  assert.equal(state.gateTickets[1].boothCode, "STALL-004-B");

  assert.equal(state.ticketProducts.length, 3);
  assert.deepEqual(
    state.ticketProducts.map((product) => product.productCode),
    ["02020300", "02030103", "02011701"]
  );

  assert.equal(state.lineMessages.length, 4);
  const vendorBMessages = state.lineMessages.filter((message) => {
    const data = (message as { data?: { to?: string } }).data;
    return data?.to === "line-vendor-stall-004-b";
  });

  assert.equal(vendorBMessages.length, 1);
  assert.match(
    JSON.stringify(
      (vendorBMessages[0] as {
        data?: {
          messages?: Array<{
            contents?: unknown;
          }>;
        };
      }).data?.messages?.[0]?.contents
    ),
    /Cherry|Melon/
  );
});

test("POST /api/gate/tickets rejects BoothCount mismatch", async () => {
  const response = await server.request("POST", "/api/gate/tickets", {
    body: {
      ...buildGateVehicleJobBody("008"),
      BoothCount: 2,
    },
    headers: await gateAuthHeaders(),
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("POST /api/gate/tickets rejects duplicate BoothCode in the same request", async () => {
  const base = buildGateVehicleJobBody("010");

  const response = await server.request("POST", "/api/gate/tickets", {
    body: {
      ...base,
      BoothCount: 2,
      Booths: [
        base.Booths[0],
        {
          BoothCode: base.Booths[0].BoothCode,
          Products: [
            {
              ProductCode: "02020300",
              PackageCode: "29",
              Quantity: 100,
            },
          ],
        },
      ],
    },
    headers: await gateAuthHeaders(),
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("POST /api/gate/tickets rejects duplicate ProductCode + PackageCode in the same booth", async () => {
  const base = buildGateVehicleJobBody("012");

  const response = await server.request("POST", "/api/gate/tickets", {
    body: {
      ...base,
      Booths: [
        {
          BoothCode: "STALL-012",
          Products: [
            {
              ProductCode: "02020300",
              PackageCode: "29",
              Quantity: 180,
            },
            {
              ProductCode: "02020300",
              PackageCode: "29",
              Quantity: 100,
            },
          ],
        },
      ],
    },
    headers: await gateAuthHeaders(),
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

/* -------------------------------------- Admin Worker Status Route Tests -------------------------------------- */

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
    joined_at: scannedAt,
    cancelled_at: null,
    completed_at: null,
  };

  const cancelledTicketWorker = {
    id: state.nextTicketWorkerId++,
    ticket_id: ticket.id,
    worker_account_id: secondWorker.id,
    status: "WORKING",
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
    cancelledTicketWorker.status,
    "CANCELLED"
  );
  assert.ok(cancelledTicketWorker.cancelled_at);

  // Worker C พร้อมรับงานใหม่
  await workerQueue.enqueueWorker(
    replacementWorker.id
  );

  // Admin ใส่ Worker C มาแทน
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

  // จำลอง Worker C accept + scan สำเร็จ
  replacementAssignment.status = "SCANNED";
  replacementAssignment.scanned_at =
    new Date().toISOString();

  // Worker A ส่งยอดจริง
  const submitResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`,
    {
      token: workerToken,
      body: {
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

  // จำลอง Vendor timeout → Auto Confirm
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

  // A + C Complete แต่ B ต้องยัง Cancelled
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

  // Financial ต้องหารแค่ A + C = 2 คน
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
  // Worker ได้ 4 + 4 = 8
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
  // Worker ได้ 1 + 1 = 2
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

  // 2 Product × 2 Worker = 4 Payment
  assert.equal(
    state.ticketWorkerPayments.length,
    4
  );

  // Worker B ห้ามมี Payment
  assert.equal(
    state.ticketWorkerPayments.some(
      (payment) =>
        payment.ticket_worker_id ===
        cancelledTicketWorker.id
    ),
    false
  );

  // Worker A ต้องมี 2 Product
  assert.equal(
    state.ticketWorkerPayments.filter(
      (payment) =>
        payment.ticket_worker_id ===
        firstTicketWorker.id
    ).length,
    2
  );

  // Worker C ต้องมี 2 Product
  assert.equal(
    state.ticketWorkerPayments.filter(
      (payment) =>
        payment.ticket_worker_id ===
        replacementTicketWorker.id
    ).length,
    2
  );

  // ตรวจผ่าน Admin Financial API อีกชั้น
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

  // Booth 2 ต้องรอ Booth 1 จบก่อน
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
      `/api/workers/me/assignments/${job.ticketNo}/tickets/${firstTicket.boothCode}/complete`,
      {
        token: workerToken,
        body: {
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

  /* -------------------------------------- ตรวจ Booth 1 ก่อน Cancel -------------------------------------- */

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
   * จะ sync Worker เข้า Booth ถัดไปอัตโนมัติ
   *
   * Route-test harness ปัจจุบัน activate เฉพาะสถานะ Ticket
   * จึงสร้าง membership ของ Booth 2 ตรงนี้
   * เพื่อจำลอง state ของ DB จริงก่อน Admin Cancel
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

  /* -------------------------------------- Admin Cancel Worker A ที่ Booth 2 -------------------------------------- */

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

  // Booth 1 ต้องไม่ถูกย้อนกลับไปแก้
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

  // Booth 2 เท่านั้นที่ถูก Cancel
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

  /* -------------------------------------- เงิน Booth 1 ต้องไม่เปลี่ยน -------------------------------------- */

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

  // ถึง Assignment จะถูก Cancel ตอน Booth 2
  // เงิน Booth 1 ต้องยังอยู่
  assert.equal(
    historyItem.status,
    "CANCELLED"
  );

  assert.equal(
    historyItem.earnings.total_amount,
    "12.00"
  );

  assert.equal(
    historyResponse.body.total_earnings,
    "12.00"
  );

  assert.equal(
    historyItem.earnings.booths.length,
    2
  );

  const firstBoothEarning =
    historyItem.earnings.booths.find(
      (booth: {
        ticket_id: number;
      }) =>
        booth.ticket_id ===
        firstTicket.id
    );

  const secondBoothEarning =
    historyItem.earnings.booths.find(
      (booth: {
        ticket_id: number;
      }) =>
        booth.ticket_id ===
        secondTicket.id
    );

  assert.ok(
    firstBoothEarning
  );

  assert.ok(
    secondBoothEarning
  );

  // Booth 1 = เงินเก่าต้องอยู่ครบ
  assert.equal(
    firstBoothEarning.membership_status,
    "COMPLETED"
  );

  assert.equal(
    firstBoothEarning.amount,
    "12.00"
  );

  assert.equal(
    firstBoothEarning.products.length,
    2
  );

  assert.equal(
    firstBoothEarning.products[0]
      .final_amount,
    "9.00"
  );

  assert.equal(
    firstBoothEarning.products[1]
      .final_amount,
    "3.00"
  );

  // Booth 2 = Cancel แล้วจึงไม่มีเงิน
  assert.equal(
    secondBoothEarning.membership_status,
    "CANCELLED"
  );

  assert.equal(
    secondBoothEarning.amount,
    "0.00"
  );

  assert.equal(
    secondBoothEarning.products.length,
    0
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

  // Booth 1 จบ แต่ Booth 2 ยังไม่จบ
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
   *เงินจริงภายหลังจะใช้ confirmed_quantity = 10
   * เพื่อยืนยันว่า Financialization ไม่ใช้ Gate quantity
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

  /* -------------------------------------- ตรวจ Snapshot ตอน Gate Create -------------------------------------- */

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

  /* -------------------------------------- เปลี่ยน Master Rate หลัง Gate Create -------------------------------------- */

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

  // Master ปัจจุบันเปลี่ยนเป็น 999 แล้วจริง
  assert.equal(
    centralRate.stallRate.toString(),
    "999"
  );

  assert.equal(
    centralRate.laborRate.toString(),
    "999"
  );

  // แต่ Snapshot ของ TicketProduct ต้องไม่เปลี่ยน
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
      `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`,
      {
        token:
          workerToken,

        body: {
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

  // Actual = 10 แม้ Gate Quantity = 1
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

  /* -------------------------------------- ตรวจ Financial Result -------------------------------------- */

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
   * ต้องเป็นผลจาก Snapshot:
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

  /* -------------------------------------- Snapshot ต้องยังเหมือนเดิมหลัง Financialize -------------------------------------- */

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

  // Master ยังเป็น 999 เพื่อยืนยันว่าไม่ได้ revert กลับ
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

  // API ต้องรายงาน Snapshot เดิม ไม่ใช่ Master 999
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

  /* -------------------------------------- เตรียม Ticket สำหรับ Financialize -------------------------------------- */

  ticket.status = "COMPLETED";
  ticket.confirmation_status = "COMPLETED";
  ticket.completed_at =
    financializedAttemptAt;

  ticket.final_stall_amount = null;
  ticket.financialized_at = null;

  job.status = "WORKING";

  /* -------------------------------------- Confirmed Quantity + Snapshot ครบ -------------------------------------- */

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

  /* -------------------------------------- จำลอง Corrupted Partial State -------------------------------------- */

  /*
   * Product 1 มี Financial อยู่แล้ว
   * แต่ Ticket ยังไม่มี financialized_at
   *
   * Product 2 ยังไม่มี Financial
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

  /* -------------------------------------- Snapshot State ก่อน Finalize -------------------------------------- */

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

  /* -------------------------------------- ห้ามเขียนเพิ่ม / ห้ามแก้ของเดิม -------------------------------------- */

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

  // Product 2 ห้ามถูกสร้าง Financial
  assert.equal(
    state.ticketProductFinancials.some(
      (financial) =>
        financial.ticket_product_id ===
        products[1].id
    ),
    false
  );

  // Ticket marker ห้ามถูกเขียน
  assert.equal(
    ticket.final_stall_amount,
    null
  );

  assert.equal(
    ticket.financialized_at,
    null
  );

  /* -------------------------------------- Attempt 2 ต้องยัง Reject เหมือนเดิม -------------------------------------- */

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

  // ลองซ้ำก็ยังห้ามเพิ่ม record
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
    (assignedEvent.payload as { ticketNo?: string }).ticketNo,
    job.ticketNo
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

test("GET /api/workers/me/assignments/history returns scan audit fields and timeout reason", async () => {
  const { token, worker } = await loginWorker(111);
  const acceptTimeoutJob = addDispatchableJob(1110, 1);
  const scanTimeoutJob = addDispatchableJob(1111, 1);
  const acceptTimeoutAssignment = addPendingAssignment(11101, acceptTimeoutJob.id, worker.id);
  const scanTimeoutAssignment = addPendingAssignment(11102, scanTimeoutJob.id, worker.id);

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

  const response = await server.request("GET", "/api/workers/me/assignments/history?date=2026-07-24", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.date, "2026-07-24");
  assert.equal(response.body.total_earnings, "0.00");
  assert.equal(response.body.data.length, 2);
  assert.deepEqual(response.body.data[0].earnings, { total_amount: "0.00", booths: [], });
  assert.deepEqual(response.body.data[1].earnings, { total_amount: "0.00", booths: [], });
  assert.deepEqual(Object.keys(response.body.data[0]).sort(), [
    "accept_deadline_at",
    "accepted_at",
    "completed_at",
    "created_at",
    "earnings",
    "gate_transaction_ref",
    "license_plate",
    "scan_deadline_at",
    "scanned_at",
    "status",
    "ticketNo",
    "timeout_reason",
    "updated_at",
  ]);
  assert.equal(response.body.data[0].ticketNo, scanTimeoutJob.ticketNo);
  assert.equal(response.body.data[0].status, "TIMEOUT");
  assert.equal(response.body.data[0].timeout_reason, "scan_timeout");
  assert.equal(response.body.data[0].scan_deadline_at, "2026-07-24T02:15:30.000Z");
  assert.equal(response.body.data[0].scanned_at, null);
  assert.equal(response.body.data[1].ticketNo, acceptTimeoutJob.ticketNo);
  assert.equal(response.body.data[1].timeout_reason, "accept_timeout");
  assert.equal(response.body.data[1].scan_deadline_at, null);
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
    "created_at",
    "status",
    "updated_at",
    "worker_code",
  ]);
  assert.equal(breakSocketQueue?.worker_code, `W${worker.id}`);
  assert.equal(breakSocketQueue?.status, "break");
  assert.equal(typeof breakSocketQueue?.break_until, "string");
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
  addPendingAssignment(10901, 1090, worker.id);

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "assigned");
});

test("GET /api/workers/me/status maps scanned assignment to working", async () => {
  const { token, worker } = await loginWorker(110);
  const assignment = addPendingAssignment(11001, 1100, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();

  const response = await server.request("GET", "/api/workers/me/status", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "working");
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
  assert.doesNotMatch(response.body.remaining_break_time.text, /[ก-๙]/);
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
    ticketNo: string;
    gate_transaction_ref: string;
    worker_qr_token: string;
    assignment: { created_at: string; accept_deadline_at: string | null };
  };

  assert.deepEqual(Object.keys(payload).sort(), [
    "assignment",
    "gate_transaction_ref",
    "ticketNo",
    "worker_qr_token",
  ]);
  assert.equal(payload.ticketNo, job.ticketNo);
  assert.equal(payload.gate_transaction_ref, job.gate_transaction_ref);
  assert.equal(payload.worker_qr_token, job.ticketNo);
  assert.deepEqual(Object.keys(payload.assignment).sort(), [
    "accept_deadline_at",
    "created_at",
  ]);
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

test("POST /api/workers/me/assignments/:ticketNo/accept accepts pending assignment", async () => {
  const { token, worker } = await loginWorker(51);
  const job = addDispatchableJob(851, 1);
  addTicketForVehicleJob(job.id, 1851);
  const oldAssignment = addPendingAssignment(950, job.id, worker.id);
  oldAssignment.status = "TIMEOUT";
  addPendingAssignment(951, job.id, worker.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/accept`, {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "license_plate",
    "markets",
    "team",
  ]);
  assert.equal(response.body.license_plate, job.license_plate);
  assert.equal(response.body.team.length, 1);
  assert.deepEqual(Object.keys(response.body.team[0]).sort(), [
    "full_name",
    "image_url",
    "scan_status",
    "worker_code",
  ]);
  assert.equal(response.body.team[0].full_name, worker.full_name);
  assert.equal(response.body.team[0].scan_status, "accepted");
  assert.deepEqual(Object.keys(response.body.markets[0]).sort(), [
    "marketName",
    "stall_count",
    "stalls",
  ]);
  assert.equal(response.body.markets[0].marketName, "Market A");
  assert.equal(response.body.markets[0].stall_count, 1);
  assert.deepEqual(Object.keys(response.body.markets[0].stalls[0]).sort(), [
    "boothCode",
    "boothName",
    "product_count",
    "products",
  ]);
  assert.equal(response.body.markets[0].stalls[0].boothCode, "STALL-1851");
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
    "gate_transaction_ref",
    "scan_deadline_at",
    "status",
    "ticketNo",
    "worker_code",
  ]);
  assert.equal(acceptedPayload.worker_code, `W${worker.id}`);
  assert.equal(acceptedPayload.status, "ACCEPTED");
  assert.equal(acceptedPayload.ticketNo, job.ticketNo);
  assert.equal(acceptedPayload.gate_transaction_ref, job.gate_transaction_ref);
  assert.equal(acceptedPayload.id, undefined);
  assert.equal(acceptedPayload.vehicle_job_id, undefined);
  assert.equal(acceptedPayload.worker_account_id, undefined);
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

test("POST /api/workers/me/assignments/:ticketNo/accept times out late accept and requeues worker even when socket is disconnected", async () => {
  const { token, worker } = await loginWorker(52);
  const job = addDispatchableJob(852, 1);
  job.status = "WAIT";
  addPendingAssignment(952, job.id, worker.id, -1000);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/accept`, {
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
  assert.equal(timeoutPayload.ticketNo, job.ticketNo);
  assert.equal(timeoutPayload.assignment_id, undefined);
  assert.equal(timeoutPayload.vehicle_job_id, undefined);
});

test("POST /api/workers/me/assignments/:ticketNo/accept resets consecutive timeout streak after accepting", async () => {
  const { token, worker } = await loginWorker(54);
  const timedOutJob = addDispatchableJob(8541, 1);
  timedOutJob.status = "WAIT";
  addPendingAssignment(9541, timedOutJob.id, worker.id, -1000);

  const timeoutResponse = await server.request(
    "POST",
    `/api/workers/me/assignments/${timedOutJob.ticketNo}/accept`,
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
    `/api/workers/me/assignments/${acceptedJob.ticketNo}/accept`,
    { token }
  );

  assert.equal(acceptedResponse.status, 200);
  assert.equal(state.shiftAttendances[0].acceptTimeoutStreak, 0);
  assert.equal(state.shiftAttendances[0].lastAcceptTimeoutAt, null);
});

test("POST /api/workers/me/assignments/:ticketNo/accept closes worker shift after configured timeout limit", async () => {
  const { token, worker } = await loginWorker(53);
  state.connectedWorkers.add(worker.id);

  for (const suffix of [8531, 8532, 8533]) {
    const job = addDispatchableJob(suffix, 1);
    job.status = "WAIT";
    addPendingAssignment(suffix, job.id, worker.id, -1000);

    const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/accept`, {
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

test("POST /api/workers/me/assignments/:ticketNo/check-in-qr scans correct QR", async () => {
  const { token, worker } = await loginWorker(61);
  const job = addDispatchableJob(861, 1);
  const assignment = addPendingAssignment(961, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/check-in-qr`, {
    token,
    body: {
      qr_token: job.ticketNo,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "status",
    "ticketNo",
    "worker_qr_token",
    "worker_code",
  ].sort());
  assert.equal(response.body.status, "SCANNED");
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.ticketNo, job.ticketNo);
  assert.equal(response.body.worker_qr_token, job.ticketNo);
  assert.equal(job.status, "WORKING");
});

test("POST /api/workers/me/assignments/:ticketNo/check-in-qr shortens remaining team scan window from settings", async () => {
  const [{ token, worker }, second, third] = await Promise.all([
    loginWorker(64),
    loginWorker(65),
    loginWorker(66),
  ]);
  const job = addDispatchableJob(864, 3);
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
  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/check-in-qr`, {
    token,
    body: {
      qr_token: job.ticketNo,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(firstAssignment.status, "SCANNED");
  assert.equal(job.status, "WORKING");

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
});

test("POST /api/workers/me/assignments/:ticketNo/check-in-qr rejects wrong QR", async () => {
  const { token, worker } = await loginWorker(62);
  const job = addDispatchableJob(862, 1);
  const assignment = addPendingAssignment(962, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/check-in-qr`, {
    token,
    body: {
      qr_token: "wrong-qr-token",
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_WORKER_QR");
  assert.equal(assignment.status, "ACCEPTED");
});

test("POST /api/workers/me/assignments/:ticketNo/check-in-qr rejects expired QR scan window", async () => {
  const { token, worker } = await loginWorker(63);
  const job = addDispatchableJob(863, 1);
  const assignment = addPendingAssignment(963, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() - 1000).toISOString();

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/check-in-qr`, {
    token,
    body: {
      qr_token: job.ticketNo,
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "QR_EXPIRED");
  assert.equal(assignment.status, "TIMEOUT");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "open_app");
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

/* -------------------------------------- Worker Ticket Route Tests -------------------------------------- */

test("POST /api/workers/me/assignments/:ticketNo/tickets/:boothCode/complete submits quantities for vendor confirmation", async () => {
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

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`, {
    token,
    body: {
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
    "confirmation_status",
    "items",
    "marketCode",
    "marketName",
    "message",
    "status",
    "submission_status",
    "ticketNo",
  ]);
  assert.equal(response.body.status, "DELIVERED");
  assert.equal(response.body.confirmation_status, "DELIVERED");
  assert.equal(response.body.assignment_status, "DELIVERED");
  assert.equal(assignment.status, "DELIVERED");
  assert.equal(response.body.ticketNo, job.ticketNo);
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
  assert.equal(submittedWorkerPayload?.ticketNo, job.ticketNo);
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
  assert.ok(lineFlexContents.includes(job.ticketNo));
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

  // Financialization ต้องเกิดหลัง Vendor Confirm
  assert.equal(state.ticketProductFinancials.length, products.length);
  assert.equal(state.ticketWorkerPayments.length, products.length);

  // Ticket นี้มี Worker จริง 1 คน
  assert.ok(state.ticketProductFinancials.every((financial) => financial.worker_count === 1));
  assert.equal(ticket.final_stall_amount, "34.00");
  assert.ok(ticket.completed_at);
  assert.ok(ticket.financialized_at);
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
  assert.equal(resultWorkerPayload?.ticketNo, job.ticketNo);
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
    `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`,
    {
      token,
      body: {
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

  assert.equal(ticket.final_stall_amount, "34.00");
  assert.ok(ticket.completed_at);
  assert.ok(ticket.financialized_at);

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
    (item: { ticketNo: string }) => item.ticketNo === job.ticketNo
  );

  assert.ok(historyItem);

  assert.equal(historyItem.earnings.total_amount, "12.00");
  assert.equal(historyResponse.body.total_earnings, "12.00");

  assert.equal(historyItem.earnings.booths.length, 1);

  const boothEarning = historyItem.earnings.booths[0];

  assert.equal(boothEarning.ticket_id, ticket.id);
  assert.equal(boothEarning.boothCode, ticket.boothCode);
  assert.equal(boothEarning.membership_status, "COMPLETED");
  assert.equal(boothEarning.amount, "12.00");
  assert.equal(boothEarning.products.length, 2);

  assert.equal(boothEarning.products[0].final_amount, "9.00");
  assert.equal(boothEarning.products[1].final_amount, "3.00");
});

test("POST /api/line/webhook vendor reject marks assignment as REJECT and allows resubmit", async () => {
  const { token, worker } = await loginWorker(75);
  const job = addDispatchableJob(875, 1);
  const ticket = addTicketForVehicleJob(job.id, 976);
  const assignment = addPendingAssignment(1076, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();
  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);
  const submitResponse = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`, {
    token,
    body: {
      items: products.map((product) => ({
        productCode: product.productCode,
        packageCode: product.packageCode,
        confirmed_quantity: Number(product.quantity),
      })),
    },
  });
  assert.equal(submitResponse.status, 200);
  assert.equal(submitResponse.body.assignment_status, "DELIVERED");
  assert.equal(assignment.status, "DELIVERED");
  const lineMessage = state.lineMessages[0] as {
    data?: {
      messages?: Array<{
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
  const rejectPostback = lineMessage.data?.messages?.[0]?.contents?.footer?.contents?.find(
    (button) => button.action?.label === "ไม่ถูกต้อง"
  )?.action?.data;
  assert.match(rejectPostback ?? "", /^token=/);
  assert.ok((rejectPostback ?? "").length <= 300);

  const rejectResponse = await server.request("POST", "/api/line/webhook", {
    body: {
      events: [
        {
          type: "postback",
          source: {
            userId: ticket.vendor_line_id,
          },
          postback: {
            data: `${rejectPostback}&reject_reason=Quantity mismatch`,
          },
        },
      ],
    },
  });

  assert.equal(rejectResponse.status, 200);
  assert.equal(rejectResponse.body.processed, 1);
  assert.equal(ticket.status, "REJECT");
  assert.equal(ticket.confirmation_status, "REJECT");
  assert.equal(assignment.status, "REJECT");

  assert.equal(state.ticketProductFinancials.length, 0);
  assert.equal(state.ticketWorkerPayments.length, 0);
  assert.equal(ticket.final_stall_amount ?? null, null);
  assert.equal(ticket.financialized_at ?? null, null);

  const rejectEvent = [...state.realtimeEvents].reverse().find(
    (event) =>
      Boolean(
        event &&
        typeof event === "object" &&
        (event as { type?: string }).type === "TICKET_COMPLETION_RESULT"
      )
  );
  assert.equal(
    (rejectEvent as { worker_payload?: Record<string, unknown> }).worker_payload
      ?.assignment_status,
    "REJECT"
  );

  const resubmitResponse = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`, {
    token,
    body: {
      items: products.map((product) => ({
        productCode: product.productCode,
        packageCode: product.packageCode,
        confirmed_quantity: Number(product.quantity),
      })),
    },
  });

  assert.equal(resubmitResponse.status, 200);
  assert.equal(resubmitResponse.body.assignment_status, "DELIVERED");
  assert.equal(assignment.status, "DELIVERED");
});

test("POST /api/workers/me/assignments/:ticketNo/tickets/:boothCode/complete allows submitting another stall in the same job", async () => {
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

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/tickets/${nextTicket.boothCode}/complete`, {
    token,
    body: {
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

test("POST /api/workers/me/assignments/:ticketNo/tickets/:boothCode/complete rejects before all required workers check in", async () => {
  const { token, worker } = await loginWorker(74);
  const job = addDispatchableJob(874, 2);
  const ticket = addTicketForVehicleJob(job.id, 975);
  const assignment = addPendingAssignment(1074, job.id, worker.id);
  assignment.status = "SCANNED";
  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`, {
    token,
    body: {
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

test("POST /api/workers/me/assignments/:ticketNo/tickets/:boothCode/complete rejects incomplete product quantities", async () => {
  const { token, worker } = await loginWorker(72);
  const job = addDispatchableJob(872, 1);
  const ticket = addTicketForVehicleJob(job.id, 972);
  const assignment = addPendingAssignment(1072, job.id, worker.id);
  assignment.status = "SCANNED";
  const [firstProduct] = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  const response = await server.request("POST", `/api/workers/me/assignments/${job.ticketNo}/tickets/${ticket.boothCode}/complete`, {
    token,
    body: {
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
  assert.equal(warningNotification.payload?.ticketNo, job.ticketNo);
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