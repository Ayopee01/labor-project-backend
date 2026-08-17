import { Prisma } from "@prisma/client";
import { FakeRedis } from "./app-test-infra-mocks";
import { state } from "./app-test-state";
import type {
  AccountRecord,
  AssignmentRecord,
  GateClientRecord,
  GateTicketRecord,
  VehicleJobRecord,
} from "./app-test-harness.records";

/* -------------------------------------- Test Data Builders -------------------------------------- */

function seedMasterDataForRouteTests(): void {
  state.masterMarkets.push(
    ...[
      "000",
      "000B",
      "001",
      "002",
      "003",
      "004",
      "005",
      "006",
      "007",
      "008",
      "009",
      "010",
      "011",
      "012",
      "013",
    ].map((suffix, index) => ({
      id: index + 1,
      marketCode: `MARKET-${suffix}`,
      marketName: "Market A",
      boothCode: `STALL-${suffix}`,
      boothName: "Vendor A",
      marketStatus: "Normal",
      boothStatus: "Normal",
    })),
    {
      id: 1001,
      marketCode: "MARKET-004",
      marketName: "Market A",
      boothCode: "STALL-004-B",
      boothName: "Vendor B",
      marketStatus: "Normal",
      boothStatus: "Normal",
    },
    {
      id: 1002,
      marketCode: "MARKET-008",
      marketName: "Market A",
      boothCode: "STALL-008-B",
      boothName: "Vendor B",
      marketStatus: "Normal",
      boothStatus: "Normal",
    },
    {
      id: 1004,
      marketCode: "MARKET-009",
      marketName: "Market A",
      boothCode: "STALL-008-B",
      boothName: "Vendor B",
      marketStatus: "Normal",
      boothStatus: "Normal",
    },
    {
      id: 1003,
      marketCode: "MARKET-012",
      marketName: "Market A",
      boothCode: "STALL-012-B",
      boothName: "Vendor B",
      marketStatus: "Normal",
      boothStatus: "Normal",
    },
    {
      id: 1005,
      marketCode: "MARKET-011",
      marketName: "Market A",
      boothCode: "STALL-010",
      boothName: "Vendor A",
      marketStatus: "Normal",
      boothStatus: "Normal",
    },
    {
      id: 1006,
      marketCode: "MARKET-013",
      marketName: "Market A",
      boothCode: "STALL-012-B",
      boothName: "Vendor B",
      marketStatus: "Normal",
      boothStatus: "Normal",
    },
  );
  state.masterProducts.push(
    {
      id: 1,
      productCode: "02020300",
      productFullCode: "02020300000000000000",
      productName: "Rambutan",
      packageCode: "29",
      packageName: "Crate 20",
      packageWeight: 20,
      range: {
        workerRanges: {
          range1To50: 1,
          range51To100: 2,
          range101To200: 3,
          range201To400: 4,
          range401To600: 4,
          rangeOver600: 5,
        },
      },
      status: "ACTIVE",
    },
    {
      id: 2,
      productCode: "02030103",
      productFullCode: "02030103000000000000",
      productName: "Cherry",
      packageCode: "19",
      packageName: "Box 10",
      packageWeight: 20,
      range: {
        workerRanges: {
          range1To50: 1,
          range51To100: 2,
          range101To200: 3,
          range201To400: 4,
          range401To600: 4,
          rangeOver600: 5,
        },
      },
      status: "ACTIVE",
    },
    {
      id: 3,
      productCode: "02011701",
      productFullCode: "02011701000000000000",
      productName: "Melon",
      packageCode: "19",
      packageName: "Box 10",
      packageWeight: 20,
      range: {
        workerRanges: {
          range1To50: 1,
          range51To100: 2,
          range101To200: 3,
          range201To400: 4,
          range401To600: 4,
          rangeOver600: 5,
        },
      },
      status: "ACTIVE",
    },
  );
  state.masterRates.push(
    {
      id: 1,
      sourceRateId: 1,
      marketCode: "0000",
      weightRangeName: "1-25.0",
      weightMin: new Prisma.Decimal("0.00"),
      weightMax: new Prisma.Decimal("25.00"),
      stallRate: new Prisma.Decimal("1.50"),
      laborRate: new Prisma.Decimal("0.90"),
      status: 1,
    },
    {
      id: 2,
      sourceRateId: 2,
      marketCode: "0000",
      weightRangeName: "25.1-50.0",
      weightMin: new Prisma.Decimal("25.00"),
      weightMax: new Prisma.Decimal("50.00"),
      stallRate: new Prisma.Decimal("3.50"),
      laborRate: new Prisma.Decimal("2.59"),
      status: 1,
    },
  );
}

/* -------------------------------------- Test Data Builders -------------------------------------- */

// Function สร้าง schedule ของวันนี้สำหรับ test data
function todaySchedule(accountId: number) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return {
    id: accountId,
    account_id: accountId,
    shift_no: 1,
    work_date: `${year}-${month}-${day}`,
    shift_start_time: "00:00",
    shift_end_time: "23:59",
    is_current: true,
    created_by: null,
    updated_by: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

export function recordWorkerAssignmentEventOnce(
  assignment: AssignmentRecord,
  eventType: string,
  metadata: Record<string, unknown> | null = null,
  occurredAt = new Date().toISOString(),
): void {
  const existing = state.workerAssignmentEvents.find(
    (event) =>
      event.assignment_id === assignment.id && event.event_type === eventType,
  );

  if (existing) {
    return;
  }

  state.workerAssignmentEvents.push({
    id: state.nextWorkerAssignmentEventId++,
    assignment_id: assignment.id,
    worker_account_id: assignment.worker_account_id,
    vehicle_job_id: assignment.vehicle_job_id,
    event_type: eventType,
    occurred_at: occurredAt,
    metadata,
    created_at: new Date().toISOString(),
  });
}

// Function รีเซ็ต route test state สำหรับ test
export function resetRouteTestState(): void {
  FakeRedis.hashes.clear();
  FakeRedis.zsets.clear();
  FakeRedis.strings.clear();
  state.connectedWorkers.clear();
  state.socketEvents.length = 0;
  state.notifications.length = 0;
  state.realtimeEvents.length = 0;
  state.lineMessages.length = 0;
  state.workerPushTokens.length = 0;
  state.workers.clear();
  state.schedules.clear();
  state.vehicleJobs.length = 0;
  state.assignments.length = 0;
  state.workerAssignmentEvents.length = 0;
  state.gateTickets.length = 0;
  state.ticketProducts.length = 0;
  state.ticketWorkers.length = 0;
  state.ticketProductFinancials.length = 0;
  state.ticketWorkerPayments.length = 0;
  state.completionSubmissions.length = 0;
  state.ticketRatings.length = 0;
  state.lineActionTokens.length = 0;
  state.gateRequestLogs.length = 0;
  state.masterMarkets.length = 0;
  state.masterProducts.length = 0;
  state.masterRates.length = 0;
  state.gateClients.clear();
  state.shiftAttendances.length = 0;
  state.authAccountsByUsername.clear();
  state.authAccountsById.clear();
  state.adminPermissions.clear();
  state.profiles.clear();
  state.authSchedules.clear();
  state.sessions.clear();
  state.queueJobs.clear();
  state.queueJobs.set(
    process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string,
    new Map(),
  );
  state.queueJobs.set(
    process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE as string,
    new Map(),
  );
  state.nextAssignmentId = 1;
  state.nextWorkerAssignmentEventId = 1;
  state.nextSessionId = 1;
  state.nextTicketWorkerId = 1;
  state.nextTicketProductFinancialId = 1;
  state.nextTicketWorkerPaymentId = 1;
  state.nextSubmissionId = 1;
  state.nextRatingId = 1;
  state.nextLineActionTokenId = 1;
  state.nextGateClientId = 1;
  state.nextShiftAttendanceId = 1;
  seedMasterDataForRouteTests();
}

// Function จัดการ add worker สำหรับ test
export function addWorker(
  accountId: number,
  passwordHash = "hash",
): AccountRecord {
  const workerCode = `W${accountId}`;
  const worker: AccountRecord = {
    id: accountId,
    username: workerCode,
    password_hash: passwordHash,
    role: "worker",
    status: "active",
    full_name: `Worker ${accountId}`,
    position: null,
    email: null,
    phone: `081-${String(accountId).padStart(7, "0")}`,
    shirt_number: String(accountId),
    permission_level: null,
  };

  state.workers.set(accountId, worker);
  state.schedules.set(accountId, todaySchedule(accountId));
  state.authAccountsByUsername.set(worker.username, worker);
  state.authAccountsById.set(worker.id, worker);
  state.profiles.set(worker.id, {
    id: worker.id,
    account_id: worker.id,
    worker_code: workerCode,
    image_url: null,
    nationality: "Thai",
    work_start_date: "2026-01-01",
    phone: worker.phone,
    shirt_type: "standard",
    shirt_number: String(worker.id),
  });
  state.authSchedules.set(worker.id, state.schedules.get(worker.id));

  return worker;
}

// Function จัดการ add admin สำหรับ test
export function addAdmin(
  accountId: number,
  passwordHash = "hash",
): AccountRecord {
  const admin: AccountRecord = {
    id: accountId,
    username: `admin-${accountId}`,
    password_hash: passwordHash,
    role: "admin",
    status: "active",
    full_name: `Admin ${accountId}`,
    position: "Administrator",
    email: `admin-${accountId}@simmummuang.local`,
    phone: `081-000-${String(accountId).padStart(4, "0")}`,
    permission_level: "manager",
  };

  state.authAccountsByUsername.set(admin.username, admin);
  state.authAccountsById.set(admin.id, admin);
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
  ]);

  return admin;
}

// Function จัดการ add Gate client สำหรับ test
export function addGateClient(
  clientId: string,
  secretHash = "hash",
  status: "active" | "inactive" = "active",
): GateClientRecord {
  const now = new Date().toISOString();
  const gateClient: GateClientRecord = {
    id: state.nextGateClientId++,
    client_id: clientId,
    name: `Gate ${clientId}`,
    secret_hash: secretHash,
    status,
    last_used_at: null,
    created_by: null,
    updated_by: null,
    created_at: now,
    updated_at: now,
  };

  state.gateClients.set(gateClient.client_id, gateClient);

  return gateClient;
}

// Function จัดการ add dispatchable job สำหรับ test
export function addDispatchableJob(
  id: number,
  workersRequired: number,
): VehicleJobRecord {
  const now = new Date().toISOString();
  const job = {
    id,
    ticketNo: `JOB-${id}`,
    gate_transaction_ref: `GATE-${id}`,
    license_plate: `TEST-${id}`,
    license_plate_province: "Bangkok",
    vehicle_type: "truck",
    ticket_created_at: now,
    booth_count: 1,
    workers_required: workersRequired,
    dispatch_now: true,
    status: "WORKING",
    driver_qr_token: `driver-qr-${id}`,
    worker_qr_token: `JOB-${id}`,
    created_at: now,
    updated_at: now,
  };

  state.vehicleJobs.push(job);

  return job;
}

// Function จัดการ add pending assignment สำหรับ test
export function addPendingAssignment(
  id: number,
  vehicleJobId: number,
  workerAccountId: number,
  deadlineMs = 60_000,
): AssignmentRecord {
  const now = new Date().toISOString();
  const assignment = {
    id,
    vehicle_job_id: vehicleJobId,
    worker_account_id: workerAccountId,
    status: "PENDING",
    accept_deadline_at: new Date(Date.now() + deadlineMs).toISOString(),
    scan_deadline_at: null,
    accepted_at: null,
    scanned_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };

  state.assignments.push(assignment);

  return assignment;
}

// Function จัดการ add ticket สำหรับ vehicle job สำหรับ test
export function addTicketForVehicleJob(
  vehicleJobId: number,
  ticketId = vehicleJobId + 1000,
): GateTicketRecord {
  const now = new Date().toISOString();
  const ticket = {
    id: ticketId,
    vehicle_job_id: vehicleJobId,
    market_job_id: vehicleJobId + 2000,
    marketCode: `MARKET-${vehicleJobId}`,
    marketName: "Market A",
    dropoff_point: "Dock A1",
    boothCode: `STALL-${ticketId}`,
    boothName: "Vendor A",
    vendor_line_id: "line-vendor-a",
    reject_reason: null,
    status: "WORKING",
    confirmation_status: null,
    completed_at: null,
    financialized_at: null,
    created_at: now,
    updated_at: now,
  };

  state.gateTickets.push(ticket);
  state.ticketProducts.push(
    {
      id: ticketId * 10 + 1,
      ticket_id: ticketId,
      productCode: `PRODUCT-${ticketId}-1`,
      productFullCode: null,
      productName: "Apple",
      packageCode: "fruit",
      packageName: "kg",
      quantity: "10",
      confirmed_quantity: null,

      package_weight_snapshot: "20",
      rate_id_snapshot: 1,
      source_rate_id_snapshot: 1,
      rate_market_code: "0000",
      rate_source: "CENTRAL_RATE",
      weight_range_name: "1-25.0",
      weight_min_snapshot: "0.00",
      weight_max_snapshot: "25.00",
      stall_rate_snapshot: "1.50",
      labor_rate_snapshot: "0.90",
      rate_snapshot_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: ticketId * 10 + 2,
      ticket_id: ticketId,

      productCode: `PRODUCT-${ticketId}-2`,
      productFullCode: null,
      productName: "Cabbage",

      packageCode: "vegetable",
      packageName: "box",

      quantity: "5",
      confirmed_quantity: null,

      package_weight_snapshot: "20",
      rate_id_snapshot: 1,
      source_rate_id_snapshot: 1,
      rate_market_code: "0000",
      rate_source: "CENTRAL_RATE",
      weight_range_name: "1-25.0",
      weight_min_snapshot: "0.00",
      weight_max_snapshot: "25.00",
      stall_rate_snapshot: "1.50",
      labor_rate_snapshot: "0.90",
      rate_snapshot_at: now,
      created_at: now,
      updated_at: now,
    },
  );

  return ticket;
}

// Function ค้นหา current open ticket สำหรับ vehicle job สำหรับ test
export function findCurrentOpenTicketForVehicleJob(vehicleJobId: number): {
  ticket: GateTicketRecord;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
} | null {
  const ticket = state.gateTickets
    .filter(
      (candidate) =>
        candidate.vehicle_job_id === vehicleJobId &&
        !["COMPLETED", "CANCELLED"].includes(candidate.status),
    )
    .sort((a, b) => a.market_job_id - b.market_job_id || a.id - b.id)[0];

  if (!ticket) {
    return null;
  }

  return {
    ticket,
    marketCode: ticket.marketCode ?? `MARKET-${ticket.market_job_id}`,
    marketName: ticket.marketName ?? `Market ${ticket.market_job_id}`,
    dropoff_point: ticket.dropoff_point ?? null,
  };
}

// Function จัดการ activate next ticket สำหรับ vehicle job สำหรับ test
export function activateNextTicketForVehicleJob(vehicleJobId: number): {
  ticket: GateTicketRecord;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
} | null {
  const current = findCurrentOpenTicketForVehicleJob(vehicleJobId);

  if (!current) {
    return null;
  }

  if (current.ticket.status === "WAIT") {
    current.ticket.status = "WORKING";
    current.ticket.updated_at = new Date().toISOString();
  }

  return current;
}
