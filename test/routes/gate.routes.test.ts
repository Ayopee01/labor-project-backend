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


test(
  "GET /api/gate/options returns Gate test helper data without financial rates",
  async () => {
    const headers =
      await gateAuthHeaders();

    const response =
      await server.request(
        "GET",
        "/api/gate/options",
        {
          headers,
          external: true,
        }
      );

    assert.equal(
      response.status,
      200
    );

    assert.ok(
      response.body.Markets.length > 0
    );

    assert.ok(
      response.body.Products.length > 0
    );

    assert.deepEqual(
      response.body.Booths,
      []
    );

    const product =
      response.body.Products[0];

    const packageItem =
      product.Packages[0];

    assert.deepEqual(
      Object.keys(packageItem).sort(),
      [
        "PackageCode",
        "PackageName",
        "PackageWeight",
      ]
    );

    assert.equal(
      packageItem.StallRate,
      undefined
    );

    assert.equal(
      packageItem.LaborRate,
      undefined
    );

    assert.equal(
      packageItem.StallPayment,
      undefined
    );

    assert.equal(
      packageItem.WorkerPayment,
      undefined
    );

    const marketResponse =
      await server.request(
        "GET",
        "/api/gate/options?MarketCode=MARKET-001",
        {
          headers,
          external: true,
        }
      );

    assert.equal(
      marketResponse.status,
      200
    );

    assert.equal(
      marketResponse.body.Markets[0]
        .MarketCode,
      "MARKET-001"
    );

    assert.equal(
      marketResponse.body.Booths[0]
        .BoothCode,
      "STALL-001"
    );

    assert.deepEqual(
      marketResponse.body.Products,
      []
    );
  }
);

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
    "TicketNumber",
    "WorkerCount",
  ]);
  assert.deepEqual(Object.keys(response.body.Ticket).sort(), [
    "BoothCount",
    "LicensePlate",
    "LicensePlateProvince",
    "Status",
    "TicketCreatedAt",
    "TicketNo",
    "VehicleTypeCode",
    "VehicleTypeName",
  ]);
  assert.equal(response.body.Result, "CREATED");
  assert.equal(response.body.TicketNumber, "TRUCK-20260723-001");
  assert.equal(response.body.Ticket.TicketNo, "TKT-20260723-001");
  assert.equal(response.body.Ticket.TicketCreatedAt, "2026-07-23T07:30:00.000Z");
  assert.equal(response.body.Ticket.BoothCount, 1);
  assert.equal(response.body.Ticket.LicensePlate, "ABC-001");
  assert.equal(response.body.Ticket.LicensePlateProvince, "Bangkok");
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

  // Gate Create เธ•เนเธญเธ Snapshot Rate เนเธ•เนเธขเธฑเธเธซเนเธฒเธกเธชเธฃเนเธฒเธเน€เธเธดเธเธเธฃเธดเธ
  assert.equal(state.ticketProducts.length, 1);
  assert.equal(state.ticketProducts[0].confirmed_quantity, null);
  assert.notEqual(state.ticketProducts[0].stall_rate_snapshot, null);
  assert.notEqual(state.ticketProducts[0].labor_rate_snapshot, null);
  assert.equal(state.ticketProductFinancials.length, 0);
  assert.equal(state.ticketWorkerPayments.length, 0);

  assert.equal(response.body.Ticket.WorkerQrToken, undefined);
  assert.equal(response.body.Qr.WorkerQrToken, undefined);
  assert.ok(response.body.Qr.DriverQrToken);
  assert.equal(response.body.message, undefined);
  assert.equal(response.body.vehicle_job, undefined);
  assert.equal(response.body.gate_transaction_ref, undefined);
  assert.equal(response.body.markets, undefined);

  assert.equal(state.vehicleJobs.length, 1);
  assert.equal(state.vehicleJobs[0].ticket_number, "TRUCK-20260723-001");
  assert.equal(state.vehicleJobs[0].vehicle_type, "Pickup truck");

  assert.equal(state.marketJobs.length, 1);
  assert.equal(state.marketJobs[0].ticket_no, "TKT-20260723-001");
  assert.equal(state.marketJobs[0].ticket_created_at, "2026-07-23T07:30:00.000Z");
  assert.equal(state.marketJobs[0].booth_count, 1);
  assert.equal(state.marketJobs[0].ticket_no, response.body.Ticket.TicketNo);

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
  assert.equal(savedProduct.confirmed_quantity, null); // Gate Create เธขเธฑเธเนเธกเนเธกเธตเธเธณเธเธงเธเธเธฃเธดเธ

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

test("POST /api/gate/tickets does not dispatch queued workers when Dispatch is false", async () => {
  const worker = addWorker(9700);

  await workerQueue.enqueueWorker(
    worker.id
  );

  const response = await server.request(
    "POST",
    "/api/gate/tickets",
    {
      body: {
        ...buildGateVehicleJobBody("006"),
        Dispatch: false,
      },
      headers: await gateAuthHeaders(),
    }
  );

  const queueEntry =
    await workerQueue.getWorkerQueueStatus(
      worker.id
    );

  assert.equal(
    response.status,
    201
  );

  assert.equal(
    response.body.Ticket.Status,
    "waiting_unload"
  );

  // Gate เธขเธฑเธเธ•เธญเธเธเธณเธเธงเธ Worker เธ—เธตเนเธเธฒเธเธ•เนเธญเธเธเธฒเธฃ
  assert.equal(
    response.body.WorkerCount,
    3
  );

  // Dispatch=false เธ•เนเธญเธเธขเธฑเธเนเธกเนเธชเธฃเนเธฒเธ Assignment
  assert.equal(
    state.assignments.length,
    0
  );

  // Worker เธ•เนเธญเธเธขเธฑเธเธญเธขเธนเนเนเธ FIFO queue
  assert.equal(
    queueEntry?.status,
    "ready"
  );
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
  assert.equal(
    state.workerAssignmentEvents.filter(
      (event) =>
        event.assignment_id === state.assignments[0].id &&
        event.event_type === "ASSIGNED"
    ).length,
    1
  );
  assert.equal(queueEntry?.status, "assigned");
  assert.ok(
    state.socketEvents.some(
      (event) => event.accountId === worker.id && event.event === "WORKER_ASSIGNED"
    )
  );
});

test("POST /api/gate/tickets dispatches exactly the required FIFO workers", async () => {
  const workers = Array.from(
    { length: 8 },
    (_, index) =>
      addWorker(9801 + index)
  );

  // เน€เธเนเธฒ FIFO เธ•เธฒเธกเธฅเธณเธ”เธฑเธ 9801 -> 9808
  for (const worker of workers) {
    await workerQueue.enqueueWorker(
      worker.id
    );
  }

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

  const response = await server.request(
    "POST",
    "/api/gate/tickets",
    {
      body,
      headers: await gateAuthHeaders(),
    }
  );

  /*
   * Worker requirement:
   *
   * Rambutan 180 = 3
   * Cherry   100 = 2
   * Melon     80 = 2
   *
   * เธฃเธงเธก = 7
   */
  assert.equal(
    response.status,
    201
  );

  assert.equal(
    response.body.WorkerCount,
    7
  );

  assert.equal(
    state.vehicleJobs[0]
      .workers_required,
    7
  );

  // เธ•เนเธญเธเธชเธฃเนเธฒเธ Assignment เน€เธ—เนเธฒเธเธณเธเธงเธเธ—เธตเน Gate เธ•เนเธญเธเธเธฒเธฃ
  assert.equal(
    state.assignments.length,
    7
  );

  // เธ•เนเธญเธเน€เธเนเธ Worker 7 เธเธเนเธฃเธเธ•เธฒเธก FIFO
  assert.deepEqual(
    state.assignments.map(
      (assignment) =>
        assignment.worker_account_id
    ),
    workers
      .slice(0, 7)
      .map((worker) => worker.id)
  );

  // Worker เธเธเธ—เธตเน 8 เธ•เนเธญเธเนเธกเนเธ–เธนเธเธ”เธถเธเน€เธเธดเธเธเธณเธเธงเธ
  const remainingWorker =
    await workerQueue
      .getWorkerQueueStatus(
        workers[7].id
      );

  assert.equal(
    remainingWorker?.status,
    "ready"
  );

  // 7 เธเธเนเธฃเธเธ•เนเธญเธเธ–เธนเธ mark assigned
  for (
    const worker
    of workers.slice(0, 7)
  ) {
    const queueEntry =
      await workerQueue
        .getWorkerQueueStatus(
          worker.id
        );

    assert.equal(
      queueEntry?.status,
      "assigned"
    );
  }
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
    "TicketNumber",
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
  assert.equal(state.vehicleJobs[0].workers_required, 7);
  assert.equal(state.marketJobs.length, 1);
  assert.equal(state.marketJobs[0].booth_count, 2);

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

/* -------------------------------------- TicketNumber -> Ticket (Business Ticket) Route Tests -------------------------------------- */

test("POST /api/gate/tickets creates multiple Business Tickets under the same TicketNumber without creating a new VehicleJob, aggregating WorkerCount by SUM", async () => {
  const headers = await gateAuthHeaders();
  const ticketNumber = "TRUCK-MULTI-001";

  const first = await server.request("POST", "/api/gate/tickets", {
    body: {
      TicketNumber: ticketNumber,
      TicketNo: "TKT-MULTI-001",
      TicketCreatedAt: "2026-07-23T14:30:00+07:00",
      TicketCount: 2,
      BoothCount: 1,
      MarketCode: "MARKET-010",
      LicensePlate: "MULTI-001",
      LicensePlateProvince: "Bangkok",
      VehicleTypeCode: "PICKUP",
      VehicleTypeName: "Pickup truck",
      Booths: [
        {
          BoothCode: "STALL-010",
          Products: [{ ProductCode: "02020300", PackageCode: "29", Quantity: 180 }],
        },
      ],
      Dispatch: true,
    },
    headers,
  });

  assert.equal(first.status, 201);
  assert.equal(first.body.TicketNumber, ticketNumber);
  assert.equal(first.body.WorkerCount, 3);

  const second = await server.request("POST", "/api/gate/tickets", {
    body: {
      TicketNumber: ticketNumber,
      TicketNo: "TKT-MULTI-002",
      TicketCreatedAt: "2026-07-23T14:35:00+07:00",
      TicketCount: 2,
      BoothCount: 1,
      MarketCode: "MARKET-011",
      LicensePlate: "MULTI-001",
      LicensePlateProvince: "Bangkok",
      VehicleTypeCode: "PICKUP",
      VehicleTypeName: "Pickup truck",
      Booths: [
        {
          BoothCode: "STALL-011",
          Products: [{ ProductCode: "02030103", PackageCode: "19", Quantity: 100 }],
        },
      ],
      Dispatch: true,
    },
    headers,
  });

  assert.equal(second.status, 201);
  assert.equal(second.body.TicketNumber, ticketNumber);

  // ต้องยังเป็น VehicleJob เดียว (TicketNumber เดียวกัน) ไม่สร้างใหม่ซ้ำ
  assert.equal(
    state.vehicleJobs.filter((job) => job.ticket_number === ticketNumber).length,
    1
  );
  assert.equal(
    state.marketJobs.filter((market) => market.vehicle_job_id === state.vehicleJobs.find((j) => j.ticket_number === ticketNumber)!.id).length,
    2
  );

  // Worker requirement ของ TicketNumber = SUM ของทุก Business Ticket ห้ามใช้ MAX
  const vehicleJob = state.vehicleJobs.find((job) => job.ticket_number === ticketNumber)!;
  const marketJobsOfVehicle = state.marketJobs.filter(
    (market) => market.vehicle_job_id === vehicleJob.id
  );
  const sumOfMarketWorkersRequired = marketJobsOfVehicle.reduce(
    (total, market) => total + market.workers_required,
    0
  );

  assert.equal(vehicleJob.workers_required, sumOfMarketWorkersRequired);
  // WorkerCount ที่ Gate response คืนกลับต้องเป็นยอดรวมสะสมของทั้ง TicketNumber (ไม่ใช่แค่ Ticket ล่าสุด)
  assert.equal(second.body.WorkerCount, vehicleJob.workers_required);
  assert.notEqual(vehicleJob.workers_required, Math.max(...marketJobsOfVehicle.map((m) => m.workers_required)));
});

test("POST /api/gate/tickets replay/mismatch idempotency is keyed by TicketNumber+TicketNo, never rejects a new TicketNo under the same TicketNumber", async () => {
  const headers = await gateAuthHeaders();
  const ticketNumber = "TRUCK-MULTI-002";
  const buildBody = (ticketNo: string, marketSuffix: string) => ({
    TicketNumber: ticketNumber,
    TicketNo: ticketNo,
    TicketCreatedAt: "2026-07-23T14:30:00+07:00",
    TicketCount: 2,
    BoothCount: 1,
    MarketCode: `MARKET-${marketSuffix}`,
    LicensePlate: "MULTI-002",
    LicensePlateProvince: "Bangkok",
    VehicleTypeCode: "PICKUP",
    VehicleTypeName: "Pickup truck",
    Booths: [
      {
        BoothCode: `STALL-${marketSuffix}`,
        Products: [{ ProductCode: "02020300", PackageCode: "29", Quantity: 180 }],
      },
    ],
    Dispatch: true,
  });

  const created = await server.request("POST", "/api/gate/tickets", {
    body: buildBody("TKT-A", "012"),
    headers,
  });

  assert.equal(created.status, 201);

  // Payload เดิมทุกอย่าง (TicketNumber+TicketNo เดิม) -> REPLAYED
  const replayed = await server.request("POST", "/api/gate/tickets", {
    body: buildBody("TKT-A", "012"),
    headers,
  });

  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.Result, "REPLAYED");

  // TicketNumber เดิม แต่ TicketNo ใหม่ -> ต้องสร้าง Ticket ใหม่เสมอ ห้าม Reject
  const differentTicketNo = await server.request("POST", "/api/gate/tickets", {
    body: buildBody("TKT-B", "013"),
    headers,
  });

  assert.equal(differentTicketNo.status, 201);
  assert.equal(differentTicketNo.body.Result, "CREATED");

  // ref เดิม (TicketNumber+TicketNo เดิม) แต่ payload ต่างกัน -> 409
  const sameRefDifferentPayload = await server.request("POST", "/api/gate/tickets", {
    body: { ...buildBody("TKT-A", "012"), LicensePlate: "DIFFERENT-PLATE" },
    headers,
  });

  assert.equal(sameRefDifferentPayload.status, 409);
  assert.equal(sameRefDifferentPayload.body.code, "GATE_TRANSACTION_REF_PAYLOAD_MISMATCH");
});

test("POST /api/gate/tickets auto-closes TicketNumber once TicketCount is reached", async () => {
  const headers = await gateAuthHeaders();
  const ticketNumber = "TRUCK-COUNT-001";
  const buildBody = (ticketNo: string, marketSuffix: string, ticketCount?: number) => ({
    TicketNumber: ticketNumber,
    TicketNo: ticketNo,
    TicketCreatedAt: "2026-07-23T14:30:00+07:00",
    TicketCount: ticketCount,
    BoothCount: 1,
    MarketCode: `MARKET-${marketSuffix}`,
    LicensePlate: "COUNT-001",
    LicensePlateProvince: "Bangkok",
    VehicleTypeCode: "PICKUP",
    VehicleTypeName: "Pickup truck",
    Booths: [
      {
        BoothCode: `STALL-${marketSuffix}`,
        Products: [{ ProductCode: "02020300", PackageCode: "29", Quantity: 180 }],
      },
    ],
    Dispatch: true,
  });

  await server.request("POST", "/api/gate/tickets", {
    body: buildBody("TKT-1", "005", 2),
    headers,
  });

  let vehicleJob = state.vehicleJobs.find((job) => job.ticket_number === ticketNumber)!;
  assert.equal(vehicleJob.tickets_closed_at ?? null, null);

  await server.request("POST", "/api/gate/tickets", {
    body: buildBody("TKT-2", "006", 2),
    headers,
  });

  vehicleJob = state.vehicleJobs.find((job) => job.ticket_number === ticketNumber)!;
  assert.ok(vehicleJob.tickets_closed_at);
});

/* -------------------------------------- Admin Worker Status Route Tests -------------------------------------- */
