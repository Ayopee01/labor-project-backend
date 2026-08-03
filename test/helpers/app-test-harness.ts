import type { Server } from "node:http";
import Module = require("node:module");
import { normalizeApiRequestPayload } from "../../src/middlewares/api-case.middleware";
import { applyIsolatedTestEnv } from "../setup/test-env";

/* -------------------------------------- Test Env -------------------------------------- */

applyIsolatedTestEnv("route-test");
process.env.WORKER_PRESENCE_STALE_SECONDS = "90";

/* -------------------------------------- Test Module Loader Types -------------------------------------- */

type ModuleLoad = (
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean
) => unknown;

type ModuleWithLoad = typeof Module & {
  _load: ModuleLoad;
};

/* -------------------------------------- Test Record Types -------------------------------------- */

export type AccountRecord = {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "worker";
  status: string;
  full_name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  permission_level?: string | null;
};

export type GateClientRecord = {
  id: number;
  client_id: string;
  name: string;
  secret_hash: string;
  status: "active" | "inactive";
  last_used_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentRecord = {
  id: number;
  vehicle_job_id: number;
  worker_account_id: number;
  status: string;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at?: string | null;
  scanned_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type VehicleJobRecord = {
  id: number;
  ticketNo: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  ticket_created_at: string;
  booth_count: number;
  workers_required: number;
  dispatch_now: boolean;
  status: string;
  driver_qr_token: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
};

type GateTicketRecord = {
  id: number;
  vehicle_job_id: number;
  market_job_id: number;
  marketCode?: string;
  marketName?: string;
  dropoff_point?: string | null;
  boothCode: string;
  boothName: string | null;
  vendor_line_id: string | null;
  reject_reason: string | null;
  status: string;
  confirmation_status: string | null;
  created_at?: string;
  updated_at?: string;
};

type WorkerShiftAttendanceRecord = {
  id: number;
  accountId: number;
  workerCode: string;
  shiftInstanceKey: string;
  shiftNo: number;
  shiftStartTime: string;
  shiftEndTime: string;
  firstOnlineAt: string | null;
  lastOnlineAt: string | null;
  offlineAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  acceptTimeoutStreak: number;
  lastAcceptTimeoutAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TicketProductRecord = {
  id: number;
  ticket_id: number;
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
  confirmed_quantity: string | null;
  created_at?: string;
  updated_at?: string;
};

type TicketWorkerRecord = {
  id: number;
  ticket_id: number;
  worker_account_id: number;
  status: string;
};

type TicketCompletionSubmissionRecord = {
  id: number;
  ticket_id: number;
  submitted_by_worker_account_id: number;
  status: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  resolved_by_line_user_id: string | null;
};

type TicketRatingRecord = {
  id: number;
  ticket_id: number;
  submission_id: number;
  line_user_id: string;
  target_type: string | null;
  score: number;
  rated_at: string;
  created_at: string;
  updated_at: string;
};

type LineActionTokenRecord = {
  id: number;
  token: string;
  action: string;
  ticket_id: number;
  submission_id: number;
  boothCode: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  updated_at: string;
};

type GateRequestLogRecord = {
  gate_transaction_ref: string;
  vehicle_job_id: number | null;
  payload_snapshot: unknown;
  response_snapshot: unknown | null;
};

const ACTIVE_ASSIGNMENT_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "SCANNED",
  "WORKING",
  "DELIVERED",
  "REJECT",
];
const WORKING_ASSIGNMENT_STATUSES = ["SCANNED", "WORKING", "DELIVERED", "REJECT"];
const SCANNED_ASSIGNMENT_STATUSES = [
  "SCANNED",
  "WORKING",
  "DELIVERED",
  "REJECT",
  "COMPLETED",
];
const FINISHED_ASSIGNMENT_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "SCANNED",
  "WORKING",
  "DELIVERED",
  "REJECT",
  "COMPLETED",
];

/* -------------------------------------- Shared Test State -------------------------------------- */

const moduleWithLoad = Module as ModuleWithLoad;
const originalLoad = moduleWithLoad._load;
let patched = false;
let appModule: typeof import("../../src/app") | null = null;
let workerQueueModule: typeof import("../../src/queues/worker-queue") | null = null;
let workerDispatchModule: typeof import("../../src/queues/worker-dispatch") | null = null;
let passwordModule: typeof import("../../src/utils/password") | null = null;

export const state = {
  connectedWorkers: new Set<number>(),
  socketEvents: [] as Array<{ accountId: number; event: string; payload: unknown }>,
  notifications: [] as unknown[],
  realtimeEvents: [] as unknown[],
  lineMessages: [] as unknown[],
  workerPushTokens: [] as Array<{
    worker_code: string;
    session_id: number | null;
    device_id: string;
    platform: string;
    fcm_token: string;
    fcm_token_hash: string;
    is_active: boolean;
  }>,
  workers: new Map<number, AccountRecord>(),
  schedules: new Map<number, unknown>(),
  vehicleJobs: [] as VehicleJobRecord[],
  assignments: [] as AssignmentRecord[],
  gateTickets: [] as GateTicketRecord[],
  ticketProducts: [] as TicketProductRecord[],
  ticketWorkers: [] as TicketWorkerRecord[],
  completionSubmissions: [] as TicketCompletionSubmissionRecord[],
  ticketRatings: [] as TicketRatingRecord[],
  lineActionTokens: [] as LineActionTokenRecord[],
  gateRequestLogs: [] as GateRequestLogRecord[],
  gateClients: new Map<string, GateClientRecord>(),
  shiftAttendances: [] as WorkerShiftAttendanceRecord[],
  authAccountsByUsername: new Map<string, AccountRecord>(),
  authAccountsById: new Map<number, AccountRecord>(),
  adminPermissions: new Map<number, string[]>(),
  profiles: new Map<number, unknown>(),
  authSchedules: new Map<number, unknown>(),
  sessions: new Map<number, Record<string, unknown>>(),
  queueJobs: new Map<string, Map<string, { data: unknown; removed: boolean }>>(),
  workerProcessors: new Map<string, (job: { data: unknown }) => Promise<void>>(),
  nextAssignmentId: 1,
  nextSessionId: 1,
  nextTicketWorkerId: 1,
  nextSubmissionId: 1,
  nextRatingId: 1,
  nextLineActionTokenId: 1,
  nextGateClientId: 1,
  nextShiftAttendanceId: 1,
};

/* -------------------------------------- Fake Infra -------------------------------------- */

class FakeRedis {
  static hashes = new Map<string, Record<string, string>>();
  static zsets = new Map<string, Map<string, number>>();
  static strings = new Map<string, number>();

  async zadd(key: string, score: number, member: string): Promise<void> {
    const set = FakeRedis.zsets.get(key) ?? new Map<string, number>();
    set.set(member, Number(score));
    FakeRedis.zsets.set(key, set);
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    withScores?: string
  ): Promise<string[]> {
    const items = Array.from(FakeRedis.zsets.get(key)?.entries() ?? [])
      .sort(([leftMember, leftScore], [rightMember, rightScore]) => {
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }

        return leftMember.localeCompare(rightMember);
      })
      .slice(start, stop + 1);

    if (withScores === "WITHSCORES") {
      return items.flatMap(([member, score]) => [member, String(score)]);
    }

    return items.map(([member]) => member);
  }

  async zrem(key: string, ...members: string[]): Promise<void> {
    const set = FakeRedis.zsets.get(key);
    members.forEach((member) => set?.delete(member));
  }

  async zrank(key: string, member: string): Promise<number | null> {
    const items = Array.from(FakeRedis.zsets.get(key)?.entries() ?? [])
      .sort(([leftMember, leftScore], [rightMember, rightScore]) => {
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }

        return leftMember.localeCompare(rightMember);
      })
      .map(([itemMember]) => itemMember);
    const index = items.indexOf(member);

    return index === -1 ? null : index;
  }

  async hset(key: string, values: Record<string, string>): Promise<void> {
    FakeRedis.hashes.set(key, {
      ...(FakeRedis.hashes.get(key) ?? {}),
      ...values,
    });
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return { ...(FakeRedis.hashes.get(key) ?? {}) };
  }

  async expire(): Promise<void> {}

  async get(key: string): Promise<string | null> {
    const value = FakeRedis.strings.get(key);
    return value === undefined ? null : String(value);
  }

  async incr(key: string): Promise<number> {
    const value = (FakeRedis.strings.get(key) ?? 0) + 1;
    FakeRedis.strings.set(key, value);
    return value;
  }

  async del(key: string): Promise<void> {
    FakeRedis.hashes.delete(key);
    FakeRedis.zsets.delete(key);
    FakeRedis.strings.delete(key);
  }

  pipeline() {
    const commands: Array<() => Promise<unknown>> = [];

    return {
      hgetall: (key: string) => {
        commands.push(() => this.hgetall(key));
      },
      zrank: (key: string, member: string) => {
        commands.push(() => this.zrank(key, member));
      },
      exec: async () => Promise.all(commands.map(async (command) => [null, await command()])),
    };
  }
}

class FakeQueue {
  name: string;

  constructor(name: string) {
    this.name = name;
    state.queueJobs.set(name, state.queueJobs.get(name) ?? new Map());
  }

  async add(_name: string, data: unknown, options: { jobId?: string } = {}) {
    const jobId = options.jobId ?? String(Date.now());
    state.queueJobs.get(this.name)?.set(jobId, {
      data,
      removed: false,
    });
  }

  async getJob(jobId: string) {
    const job = state.queueJobs.get(this.name)?.get(jobId);

    if (!job || job.removed) {
      return null;
    }

    return {
      remove: async () => {
        job.removed = true;
      },
    };
  }
}

class FakeWorker {
  constructor(
    name: string,
    processor: (job: { data: unknown }) => Promise<void>
  ) {
    state.workerProcessors.set(name, processor);
  }

  on(): void {}
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
  state.gateTickets.length = 0;
  state.ticketProducts.length = 0;
  state.ticketWorkers.length = 0;
  state.completionSubmissions.length = 0;
  state.ticketRatings.length = 0;
  state.lineActionTokens.length = 0;
  state.gateRequestLogs.length = 0;
  state.gateClients.clear();
  state.shiftAttendances.length = 0;
  state.authAccountsByUsername.clear();
  state.authAccountsById.clear();
  state.adminPermissions.clear();
  state.profiles.clear();
  state.authSchedules.clear();
  state.sessions.clear();
  state.queueJobs.clear();
  state.queueJobs.set(process.env.BULLMQ_ASSIGNMENT_TIMEOUT_QUEUE as string, new Map());
  state.queueJobs.set(process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE as string, new Map());
  state.workerProcessors.clear();
  state.nextAssignmentId = 1;
  state.nextSessionId = 1;
  state.nextTicketWorkerId = 1;
  state.nextSubmissionId = 1;
  state.nextRatingId = 1;
  state.nextLineActionTokenId = 1;
  state.nextGateClientId = 1;
  state.nextShiftAttendanceId = 1;
}

// Function จัดการ add worker สำหรับ test
export function addWorker(accountId: number, passwordHash = "hash"): AccountRecord {
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
export function addAdmin(accountId: number, passwordHash = "hash"): AccountRecord {
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
  status: "active" | "inactive" = "active"
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
export function addDispatchableJob(id: number, workersRequired: number): VehicleJobRecord {
  const now = new Date().toISOString();
  const job = {
    id,
    ticketNo: `JOB-${id}`,
    gate_transaction_ref: `GATE-${id}`,
    license_plate: `TEST-${id}`,
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
  deadlineMs = 60_000
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
  ticketId = vehicleJobId + 1000
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
    created_at: now,
    updated_at: now,
  };

  state.gateTickets.push(ticket);
  state.ticketProducts.push(
    {
      id: ticketId * 10 + 1,
      ticket_id: ticketId,
      productCode: `PRODUCT-${ticketId}-1`,
      productName: "Apple",
      packageCode: "fruit",
      packageName: "kg",
      quantity: "10",
      confirmed_quantity: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: ticketId * 10 + 2,
      ticket_id: ticketId,
      productCode: `PRODUCT-${ticketId}-2`,
      productName: "Cabbage",
      packageCode: "vegetable",
      packageName: "box",
      quantity: "5",
      confirmed_quantity: null,
      created_at: now,
      updated_at: now,
    }
  );

  return ticket;
}

// Function ค้นหา current open ticket สำหรับ vehicle job สำหรับ test
function findCurrentOpenTicketForVehicleJob(vehicleJobId: number): {
  ticket: GateTicketRecord;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
} | null {
  const ticket = state.gateTickets
    .filter(
      (candidate) =>
        candidate.vehicle_job_id === vehicleJobId &&
        !["COMPLETED", "CANCELLED"].includes(candidate.status)
    )
    .sort(
      (a, b) =>
        a.market_job_id - b.market_job_id ||
        a.id - b.id
    )[0];

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
function activateNextTicketForVehicleJob(vehicleJobId: number): {
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

/* -------------------------------------- Repository Mocks -------------------------------------- */

const workerApplicationRepositoryMock = {
  accountRepository: {
    findUserById: async (accountId: number) => state.workers.get(accountId) ?? null,
    listAdmins: async () => [],
  },
  profileRepository: {
    findByAccountId: async (accountId: number) =>
      state.profiles.get(accountId) ?? null,
    findByAccountIds: async (accountIds: number[]) =>
      accountIds
        .map((accountId) => state.profiles.get(accountId) ?? null)
        .filter((profile): profile is NonNullable<typeof profile> => profile !== null),
  },
  workScheduleRepository: {
    findCurrentByAccountId: async (accountId: number) =>
      state.schedules.get(accountId) ?? null,
    findById: async (scheduleId: number) =>
      Array.from(state.schedules.values()).find(
        (schedule) => (schedule as { id?: number }).id === scheduleId
      ) ?? null,
  },
  workerShiftAttendanceRepository: {
    findByWorkerAndShift: async (input: {
      account_id: number;
      shift_instance_key: string;
    }) =>
      state.shiftAttendances.find(
        (attendance) =>
          attendance.accountId === input.account_id &&
          attendance.shiftInstanceKey === input.shift_instance_key
      ) ?? null,
    markWorkerShiftOnline: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key
      );

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: now,
          lastOnlineAt: now,
          offlineAt: null,
          closedAt: null,
          closeReason: null,
          acceptTimeoutStreak: 0,
          lastAcceptTimeoutAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);
      } else {
        attendance.workerCode = input.worker_code;
        attendance.shiftNo = input.schedule.shift_no;
        attendance.shiftStartTime = input.schedule.shift_start_time;
        attendance.shiftEndTime = input.schedule.shift_end_time;
        attendance.lastOnlineAt = now;
        attendance.updatedAt = now;
      }

      return attendance;
    },
    incrementAcceptTimeoutStreak: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key
      );

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: now,
          lastOnlineAt: now,
          offlineAt: null,
          closedAt: null,
          closeReason: null,
          acceptTimeoutStreak: 1,
          lastAcceptTimeoutAt: now,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);

        return attendance;
      }

      attendance.workerCode = input.worker_code;
      attendance.shiftNo = input.schedule.shift_no;
      attendance.shiftStartTime = input.schedule.shift_start_time;
      attendance.shiftEndTime = input.schedule.shift_end_time;
      attendance.acceptTimeoutStreak += 1;
      attendance.lastAcceptTimeoutAt = now;
      attendance.updatedAt = now;

      return attendance;
    },
    resetAcceptTimeoutStreak: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key
      );

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: now,
          lastOnlineAt: now,
          offlineAt: null,
          closedAt: null,
          closeReason: null,
          acceptTimeoutStreak: 0,
          lastAcceptTimeoutAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);

        return attendance;
      }

      attendance.workerCode = input.worker_code;
      attendance.shiftNo = input.schedule.shift_no;
      attendance.shiftStartTime = input.schedule.shift_start_time;
      attendance.shiftEndTime = input.schedule.shift_end_time;
      attendance.acceptTimeoutStreak = 0;
      attendance.lastAcceptTimeoutAt = null;
      attendance.updatedAt = now;

      return attendance;
    },
    closeWorkerShift: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
      reason: string;
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key
      );

      if (attendance?.closedAt) {
        return attendance;
      }

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: null,
          lastOnlineAt: null,
          offlineAt: now,
          closedAt: now,
          closeReason: input.reason,
          acceptTimeoutStreak: 0,
          lastAcceptTimeoutAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);

        return attendance;
      }

      attendance.workerCode = input.worker_code;
      attendance.shiftNo = input.schedule.shift_no;
      attendance.shiftStartTime = input.schedule.shift_start_time;
      attendance.shiftEndTime = input.schedule.shift_end_time;
      attendance.offlineAt = now;
      attendance.closedAt = now;
      attendance.closeReason = input.reason;
      attendance.updatedAt = now;

      return attendance;
    },
  },
  listDispatchableVehicleJobs: async () =>
    state.vehicleJobs.filter((job) => job.status === "WORKING"),
  countActiveAssignments: async (vehicleJobId: number) =>
    state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
            ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
    ).length,
  createAssignment: async (
    vehicleJobId: number,
    workerAccountId: number,
    acceptDeadlineAt: Date
  ) => {
    const assignment = {
      id: state.nextAssignmentId++,
      vehicle_job_id: vehicleJobId,
      worker_account_id: workerAccountId,
      status: "PENDING",
      accept_deadline_at: acceptDeadlineAt.toISOString(),
      scan_deadline_at: null,
    };

    state.assignments.push(assignment);

    return assignment;
  },
  findAssignmentById: async (assignmentId: number) =>
    state.assignments.find((assignment) => assignment.id === assignmentId) ?? null,
  findAssignmentByIdAndWorker: async (assignmentId: number, workerAccountId: number) =>
    state.assignments.find(
      (assignment) =>
        assignment.id === assignmentId &&
        assignment.worker_account_id === workerAccountId
    ) ?? null,
  findCurrentAssignmentByVehicleJobRefAndWorker: async (
    ticketNo: string,
    workerAccountId: number
  ) => {
    const job = state.vehicleJobs.find(
      (vehicleJob) => vehicleJob.ticketNo === ticketNo
    );

    if (!job) {
      return null;
    }

    return [...state.assignments]
      .reverse()
      .find(
        (assignment) =>
          assignment.vehicle_job_id === job.id &&
          assignment.worker_account_id === workerAccountId &&
          ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
      ) ?? null;
  },
  findCurrentAssignmentByWorker: async (workerAccountId: number) =>
    state.assignments.find(
      (assignment) =>
        assignment.worker_account_id === workerAccountId &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
    ) ?? null,
  timeoutAssignment: async (assignmentId: number) => {
    const assignment = state.assignments.find((item) => item.id === assignmentId);

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.status = "TIMEOUT";
    assignment.updated_at = new Date().toISOString();
    return assignment;
  },
  acceptAssignment: async (assignmentId: number, scanDeadlineAt: Date) => {
    const assignment = state.assignments.find((item) => item.id === assignmentId);

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.status = "ACCEPTED";
    assignment.scan_deadline_at = scanDeadlineAt.toISOString();
    assignment.accepted_at = new Date().toISOString();
    assignment.updated_at = assignment.accepted_at;
    return assignment;
  },
  listAcceptedAssignmentsByVehicleJob: async (
    vehicleJobId: number,
    excludedAssignmentId?: number
  ) =>
    state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        assignment.status === "ACCEPTED" &&
        assignment.id !== excludedAssignmentId
    ),
  updateAssignmentScanDeadline: async (
    assignmentId: number,
    scanDeadlineAt: Date
  ) => {
    const assignment = state.assignments.find((item) => item.id === assignmentId);

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.scan_deadline_at = scanDeadlineAt.toISOString();
    assignment.updated_at = new Date().toISOString();
    return assignment;
  },
  findVehicleJobById: async (vehicleJobId: number) =>
    state.vehicleJobs.find((job) => job.id === vehicleJobId) ?? null,
  scanAssignment: async (assignmentId: number) => {
    const assignment = state.assignments.find((item) => item.id === assignmentId);

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.status = "SCANNED";
    assignment.scanned_at = new Date().toISOString();
    assignment.updated_at = assignment.scanned_at;
    return assignment;
  },
  countScannedAssignments: async (vehicleJobId: number) =>
    state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        WORKING_ASSIGNMENT_STATUSES.includes(assignment.status)
    ).length,
  listVehicleJobAssignmentTeam: async (vehicleJobId: number) =>
    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          FINISHED_ASSIGNMENT_STATUSES.includes(assignment.status)
      )
      .map((assignment) => {
        const worker =
          state.workers.get(assignment.worker_account_id) ??
          state.authAccountsById.get(assignment.worker_account_id);
        const profile = state.profiles.get(assignment.worker_account_id) as
          | { worker_code?: string; image_url?: string | null }
          | undefined;
        const scanStatus =
          assignment.status === "COMPLETED" || assignment.completed_at
            ? "completed"
            : WORKING_ASSIGNMENT_STATUSES.includes(assignment.status) || assignment.scanned_at
              ? "scanned"
              : assignment.status === "ACCEPTED" || assignment.accepted_at
                ? "accepted"
                : "pending";

        return {
          full_name: worker?.full_name ?? `Worker ${assignment.worker_account_id}`,
          worker_code: profile?.worker_code ?? null,
          image_url: profile?.image_url ?? null,
          scan_status: scanStatus,
        };
      }),
  markVehicleJobInProgress: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);

    if (!job) {
      throw new Error("Vehicle job not found.");
    }

    job.status = "WORKING";
    activateNextTicketForVehicleJob(vehicleJobId);
    return job;
  },
  findCurrentOpenTicketByVehicleJob: async (vehicleJobId: number) =>
    findCurrentOpenTicketForVehicleJob(vehicleJobId),
  getVehicleWorkReadiness: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);
    const workersRequired = job?.workers_required ?? 0;
    const checkedInCount = state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        SCANNED_ASSIGNMENT_STATUSES.includes(assignment.status)
    ).length;

    return {
      workers_required: workersRequired,
      checked_in_count: checkedInCount,
      remaining_count: Math.max(0, workersRequired - checkedInCount),
      is_ready: workersRequired > 0 && checkedInCount >= workersRequired,
    };
  },
  activateNextTicketIfReady: async (vehicleJobId: number) =>
    activateNextTicketForVehicleJob(vehicleJobId),
  listWorkerAssignmentHistoryByDate: async (
    workerAccountId: number,
    startAt: Date,
    endAt: Date
  ) =>
    state.assignments
      .filter((assignment) => {
        const createdAt = new Date(assignment.created_at ?? Date.now());

        return (
          assignment.worker_account_id === workerAccountId &&
          createdAt >= startAt &&
          createdAt < endAt
        );
      })
      .sort(
        (left, right) =>
          new Date(right.created_at ?? 0).getTime() -
          new Date(left.created_at ?? 0).getTime()
      )
      .map((assignment) => ({
        assignment,
        vehicle_job: state.vehicleJobs.find(
          (job) => job.id === assignment.vehicle_job_id
        ) ?? {
          id: assignment.vehicle_job_id,
          ticketNo: `JOB-${assignment.vehicle_job_id}`,
          gate_transaction_ref: `GATE-${assignment.vehicle_job_id}`,
          license_plate: "TEST",
          vehicle_type: null,
          ticket_created_at: assignment.created_at ?? new Date().toISOString(),
          booth_count: 1,
          workers_required: 1,
          status: "WORKING",
          driver_qr_token: `driver-qr-${assignment.vehicle_job_id}`,
          worker_qr_token: `JOB-${assignment.vehicle_job_id}`,
          created_at: assignment.created_at ?? new Date().toISOString(),
          updated_at: assignment.created_at ?? new Date().toISOString(),
        },
      })),
  findGateTicketForCompletion: async (ticketId: number) =>
    state.gateTickets.find((ticket) => ticket.id === ticketId) ?? null,
  listActiveVendorLineTargetsForTicket: async (ticketId: number) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (!ticket?.vendor_line_id) {
      return [];
    }

    return [
      {
        line_user_id: ticket.vendor_line_id,
        target_type: "owner",
      },
      {
        line_user_id: `${ticket.vendor_line_id}-member`,
        target_type: "member",
      },
    ];
  },
  findGateTicketForCompletionByTicketNoAndBoothCode: async (
    ticketNo: string,
    boothCode: string
  ) => {
    const vehicleJob = state.vehicleJobs.find((job) => job.ticketNo === ticketNo);

    if (!vehicleJob) {
      return null;
    }

    return state.gateTickets.find(
      (ticket) =>
        ticket.vehicle_job_id === vehicleJob.id &&
        ticket.boothCode === boothCode
    ) ?? null;
  },
  ensureTicketWorkersFromVehicleAssignments: async (
    ticketId: number,
    vehicleJobId: number
  ) => {
    const existing = state.ticketWorkers.filter((worker) => worker.ticket_id === ticketId);

    if (existing.length > 0) {
      return existing;
    }

    return state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          SCANNED_ASSIGNMENT_STATUSES.includes(assignment.status)
      )
      .map((assignment) => {
        const ticketWorker = {
          id: state.nextTicketWorkerId++,
          ticket_id: ticketId,
          worker_account_id: assignment.worker_account_id,
          status: "WORKING",
        };

        state.ticketWorkers.push(ticketWorker);
        return ticketWorker;
      });
  },
  listTicketWorkers: async (ticketId: number) =>
    state.ticketWorkers.filter((worker) => worker.ticket_id === ticketId),
  listTicketProducts: async (ticketId: number) =>
    state.ticketProducts.filter((product) => product.ticket_id === ticketId),
  markTicketDelivered: async (ticketId: number) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (
      !ticket ||
      !["WAIT", "WORKING", "REJECT"].includes(ticket.status)
    ) {
      return false;
    }

    ticket.status = "DELIVERED";
    ticket.confirmation_status = "DELIVERED";
    ticket.reject_reason = null;
    return true;
  },
  createTicketCompletionSubmission: async (
    ticketId: number,
    workerAccountId: number
  ) => {
    const submission = {
      id: state.nextSubmissionId++,
      ticket_id: ticketId,
      submitted_by_worker_account_id: workerAccountId,
      status: "DELIVERED",
      confirmed_at: null,
      rejected_at: null,
      resolved_by_line_user_id: null,
    };

    state.completionSubmissions.push(submission);
    return submission;
  },
  markVehicleAssignmentsDelivered: async (vehicleJobId: number) => {
    let count = 0;

    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          WORKING_ASSIGNMENT_STATUSES.includes(assignment.status)
      )
      .forEach((assignment) => {
        assignment.status = "DELIVERED";
        assignment.updated_at = new Date().toISOString();
        count += 1;
      });

    return count;
  },
  markVehicleAssignmentsRejected: async (vehicleJobId: number) => {
    let count = 0;

    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          WORKING_ASSIGNMENT_STATUSES.includes(assignment.status)
      )
      .forEach((assignment) => {
        assignment.status = "REJECT";
        assignment.updated_at = new Date().toISOString();
        count += 1;
      });

    return count;
  },
  markVehicleAssignmentsWorking: async (vehicleJobId: number) => {
    let count = 0;

    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          WORKING_ASSIGNMENT_STATUSES.includes(assignment.status)
      )
      .forEach((assignment) => {
        assignment.status = "WORKING";
        assignment.updated_at = new Date().toISOString();
        count += 1;
      });

    return count;
  },
  findWaitingTicketCompletionSubmission: async (ticketId: number) =>
    state.completionSubmissions
      .filter(
        (submission) =>
          submission.ticket_id === ticketId &&
          submission.status === "DELIVERED"
      )
      .at(-1) ?? null,
  findTicketCompletionSubmissionById: async (submissionId: number) =>
    state.completionSubmissions.find(
      (submission) => submission.id === submissionId
    ) ?? null,
  confirmTicketCompletion: async (
    ticketId: number,
    submissionId: number,
    _connection?: unknown,
    resolvedByLineUserId?: string | null
  ) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);
    const submission = state.completionSubmissions.find(
      (item) => item.id === submissionId
    );

    if (!ticket || ticket.status !== "DELIVERED" || !submission) {
      throw new Error("Ticket confirm did not update a waiting ticket.");
    }

    ticket.status = "COMPLETED";
    ticket.confirmation_status = "COMPLETED";
    submission.status = "COMPLETED";
    submission.confirmed_at = new Date().toISOString();
    submission.resolved_by_line_user_id = resolvedByLineUserId ?? null;
    state.ticketWorkers
      .filter((worker) => worker.ticket_id === ticketId)
      .forEach((worker) => {
        worker.status = "COMPLETED";
      });

    return {
      ticket,
      submission,
    };
  },
  rejectTicketCompletion: async (
    ticketId: number,
    submissionId: number,
    rejectReason?: string | null,
    _connection?: unknown,
    resolvedByLineUserId?: string | null
  ) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);
    const submission = state.completionSubmissions.find(
      (item) => item.id === submissionId
    );

    if (!ticket || ticket.status !== "DELIVERED" || !submission) {
      throw new Error("Ticket reject did not update a waiting ticket.");
    }

    ticket.status = "REJECT";
    ticket.confirmation_status = "REJECT";
    ticket.reject_reason = rejectReason ?? null;
    submission.status = "REJECT";
    submission.rejected_at = new Date().toISOString();
    submission.resolved_by_line_user_id = resolvedByLineUserId ?? null;
    state.ticketWorkers
      .filter((worker) => worker.ticket_id === ticketId)
      .forEach((worker) => {
        worker.status = "REJECT";
      });

    return {
      ticket,
      submission,
    };
  },
  closeCompletedVehicleJobIfReady: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);
    const tickets = state.gateTickets.filter(
      (ticket) => ticket.vehicle_job_id === vehicleJobId
    );
    const allTicketsTerminal =
      tickets.length > 0 &&
      tickets.every((ticket) => ["COMPLETED", "CANCELLED"].includes(ticket.status));

    if (!job || !allTicketsTerminal) {
      return null;
    }

    job.status = tickets.every((ticket) => ticket.status === "CANCELLED")
      ? "CANCELLED"
      : "COMPLETED";

    const activeAssignments = state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
    );
    const now = new Date().toISOString();

    activeAssignments.forEach((assignment) => {
      assignment.status = "COMPLETED";
      assignment.completed_at = now;
    });

    return {
      vehicle_job: job,
      completed_assignment_ids: activeAssignments.map((assignment) => assignment.id),
      completed_worker_account_ids: activeAssignments.map(
        (assignment) => assignment.worker_account_id
      ),
    };
  },
  updateTicketProductConfirmations: async (
    ticketId: number,
    items: Array<{ productCode: string; confirmed_quantity: number }>
  ) => {
    for (const item of items) {
      const product = state.ticketProducts.find(
        (candidate) =>
          candidate.ticket_id === ticketId &&
          candidate.productCode === item.productCode
      );

      if (!product) {
        throw new Error("Ticket product not found.");
      }

      product.confirmed_quantity = String(item.confirmed_quantity);
    }

    return state.ticketProducts.filter((product) => product.ticket_id === ticketId);
  },
  getVehicleJobDetail: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);

    if (!job) {
      return null;
    }

    const tickets = state.gateTickets.filter((ticket) => ticket.vehicle_job_id === vehicleJobId);
    const marketIds = Array.from(new Set(tickets.map((ticket) => ticket.market_job_id)));

    return {
      vehicle_job: {
        id: job.id,
        ticketNo: job.ticketNo,
        gate_transaction_ref: job.gate_transaction_ref,
        license_plate: job.license_plate,
        vehicle_type: job.vehicle_type,
        ticket_created_at: job.ticket_created_at,
        booth_count: job.booth_count,
        workers_required: job.workers_required,
        dispatch_now: job.dispatch_now,
        status: job.status,
        driver_qr_token: job.driver_qr_token,
        worker_qr_token: job.worker_qr_token,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
      markets: marketIds.map((marketJobId) => {
        const marketTickets = tickets.filter((ticket) => ticket.market_job_id === marketJobId);
        const firstTicket = marketTickets[0];

        return {
          id: marketJobId,
          vehicle_job_id: vehicleJobId,
          marketCode: firstTicket?.marketCode ?? `MARKET-${marketJobId}`,
          marketName: firstTicket?.marketName ?? "Market A",
          dropoff_point: firstTicket?.dropoff_point ?? null,
          status: job.status,
          tickets: marketTickets.map((ticket) => ({
            ...ticket,
            products: state.ticketProducts.filter((product) => product.ticket_id === ticket.id),
          })),
        };
      }),
    };
  },
};

const gateRepositoryMock = {
  findGateRequestResponseByRef: async (gateTransactionRef: string) => {
    const requestLog = state.gateRequestLogs.find(
      (item) => item.gate_transaction_ref === gateTransactionRef
    );

    return requestLog?.response_snapshot ?? null;
  },
  findGateRequestReplayByRef: async (gateTransactionRef: string) => {
    const requestLog = state.gateRequestLogs.find(
      (item) => item.gate_transaction_ref === gateTransactionRef
    );

    if (!requestLog) {
      return null;
    }

    return {
      gate_transaction_ref: requestLog.gate_transaction_ref,
      payload_snapshot: requestLog.payload_snapshot,
      response_snapshot: requestLog.response_snapshot,
    };
  },
  findVehicleJobByRef: async (ticketNo: string) =>
    state.vehicleJobs.find((job) => job.ticketNo === ticketNo) ?? null,
  getGateTicketAppendState: async (ticketNo: string, boothCode: string) => {
    const vehicleJob = state.vehicleJobs.find((job) => job.ticketNo === ticketNo);

    if (!vehicleJob) {
      return null;
    }

    const tickets = state.gateTickets.filter(
      (ticket) => ticket.vehicle_job_id === vehicleJob.id
    );
    const boothCodes = new Set(tickets.map((ticket) => ticket.boothCode));
    const duplicateBooth = tickets.find((ticket) => ticket.boothCode === boothCode);

    return {
      vehicle_job_id: vehicleJob.id,
      booth_count: vehicleJob.booth_count,
      existing_booth_count: boothCodes.size,
      duplicate_booth: duplicateBooth
        ? {
            boothCode: duplicateBooth.boothCode,
            marketCode: duplicateBooth.marketCode ?? "",
          }
        : null,
    };
  },
  findActiveVendorLineTargetsByStall: async (_marketCode: string, boothCode: string) => [
    {
      line_user_id: `line-vendor-${boothCode.toLowerCase()}`,
      target_type: "owner",
    },
    {
      line_user_id: `line-member-${boothCode.toLowerCase()}`,
      target_type: "member",
    },
  ],
  createVehicleJobFromGate: async (input: {
    gate_transaction_ref: string;
    ticketNo: string;
    ticket_created_at: Date;
    booth_count: number;
    license_plate: string;
    vehicle_type?: string | null;
    dispatch_now?: boolean;
    markets: Array<{
      marketCode: string;
      marketName: string;
      dropoff_point?: string | null;
      tickets: Array<{
        boothCode: string;
        boothName?: string | null;
        vendor_line_id?: string | null;
        reject_reason?: string | null;
        products: Array<{
          productCode: string;
          productName: string;
          packageCode: string;
          packageName: string;
          quantity: number;
        }>;
      }>;
    }>;
  }, payloadSnapshot: unknown) => {
    const now = new Date().toISOString();
    const dispatchNow = input.dispatch_now === true;
    let vehicleJob = state.vehicleJobs.find(
      (job) => job.ticketNo === input.ticketNo
    );

    if (!vehicleJob) {
      const vehicleJobId = Math.max(0, ...state.vehicleJobs.map((job) => job.id)) + 1;
      vehicleJob = {
        id: vehicleJobId,
        ticketNo: input.ticketNo,
        gate_transaction_ref: input.gate_transaction_ref,
        license_plate: input.license_plate,
        vehicle_type: input.vehicle_type ?? null,
        ticket_created_at: input.ticket_created_at.toISOString(),
        booth_count: input.booth_count,
        workers_required: 1,
        dispatch_now: dispatchNow,
        status: dispatchNow ? "WORKING" : "WAIT",
        driver_qr_token: `driver-qr-${vehicleJobId}`,
        worker_qr_token: input.ticketNo,
        created_at: now,
        updated_at: now,
      };

      state.vehicleJobs.push(vehicleJob);
    } else {
      vehicleJob.gate_transaction_ref = input.gate_transaction_ref;
      vehicleJob.license_plate = input.license_plate;
      vehicleJob.vehicle_type = input.vehicle_type ?? null;
      vehicleJob.ticket_created_at = input.ticket_created_at.toISOString();
      vehicleJob.booth_count = input.booth_count;
      vehicleJob.workers_required = 1;
      vehicleJob.worker_qr_token = input.ticketNo;
      vehicleJob.dispatch_now = vehicleJob.dispatch_now || dispatchNow;
      if (dispatchNow && vehicleJob.status === "WAIT") {
        vehicleJob.status = "WORKING";
      }
      vehicleJob.updated_at = now;
    }

    let marketJobId = Math.max(0, ...state.gateTickets.map((ticket) => ticket.market_job_id)) + 1;
    let ticketId = Math.max(0, ...state.gateTickets.map((ticket) => ticket.id)) + 1;
    let productId = Math.max(0, ...state.ticketProducts.map((product) => product.id)) + 1;

    for (const market of input.markets) {
      const existingMarketTicket = state.gateTickets.find(
        (ticket) =>
          ticket.vehicle_job_id === vehicleJob.id &&
          ticket.marketCode === market.marketCode
      );
      const currentMarketJobId = existingMarketTicket?.market_job_id ?? marketJobId++;

      for (const ticketInput of market.tickets) {
        let ticket = state.gateTickets.find(
          (item) =>
            item.market_job_id === currentMarketJobId &&
            item.boothCode === ticketInput.boothCode
        );

        if (!ticket) {
          ticket = {
            id: ticketId++,
            vehicle_job_id: vehicleJob.id,
            market_job_id: currentMarketJobId,
            marketCode: market.marketCode,
            marketName: market.marketName,
            dropoff_point: market.dropoff_point ?? null,
            boothCode: ticketInput.boothCode,
            boothName: ticketInput.boothName ?? null,
            vendor_line_id: ticketInput.vendor_line_id ?? null,
            reject_reason: ticketInput.reject_reason ?? null,
            status: "WAIT",
            confirmation_status: "WAIT",
            created_at: now,
            updated_at: now,
          };
          state.gateTickets.push(ticket);
        } else {
          ticket.marketName = market.marketName;
          ticket.dropoff_point = market.dropoff_point ?? null;
          ticket.boothName = ticketInput.boothName ?? null;
          ticket.vendor_line_id = ticketInput.vendor_line_id ?? null;
          ticket.reject_reason = ticketInput.reject_reason ?? null;
          ticket.updated_at = now;
        }

        ticketInput.products.forEach((product) => {
          let ticketProduct = state.ticketProducts.find(
            (item) =>
              item.ticket_id === ticket.id &&
              item.productCode === product.productCode
          );

          if (!ticketProduct) {
            ticketProduct = {
              id: productId++,
              ticket_id: ticket.id,
              productCode: product.productCode,
              productName: product.productName,
              packageCode: product.packageCode,
              packageName: product.packageName,
              quantity: String(product.quantity),
              confirmed_quantity: null,
              created_at: now,
              updated_at: now,
            };
            state.ticketProducts.push(ticketProduct);
          } else {
            ticketProduct.productName = product.productName;
            ticketProduct.packageCode = product.packageCode;
            ticketProduct.packageName = product.packageName;
            ticketProduct.quantity = String(product.quantity);
            ticketProduct.updated_at = now;
          }
        });
      }
    }

    state.gateRequestLogs.push({
      gate_transaction_ref: input.gate_transaction_ref,
      vehicle_job_id: vehicleJob.id,
      payload_snapshot: payloadSnapshot,
      response_snapshot: null,
    });

    return vehicleJob;
  },
  updateGateRequestResponse: async (
    gateTransactionRef: string,
    responseSnapshot: unknown
  ) => {
    const requestLog = state.gateRequestLogs.find(
      (item) => item.gate_transaction_ref === gateTransactionRef
    );

    if (!requestLog) {
      throw new Error("Gate request log not found.");
    }

    requestLog.response_snapshot = responseSnapshot;
  },
};

const authRepositoryMock = {
  accountRepository: {
    findByUsername: async (username: string) =>
      state.authAccountsByUsername.get(username) ?? null,
    findById: async (accountId: number) => state.authAccountsById.get(accountId) ?? null,
    updatePassword: async (accountId: number, passwordHash: string) => {
      const account = state.authAccountsById.get(accountId);

      if (!account) {
        throw new Error("Account not found.");
      }

      account.password_hash = passwordHash;
      return account;
    },
    sanitizeAccount: (account: AccountRecord | null) => {
      if (!account) {
        return null;
      }

      const { password_hash: _passwordHash, ...safeAccount } = account;
      return safeAccount;
    },
  },
  profileRepository: {
    findByAccountId: async (accountId: number) => state.profiles.get(accountId) ?? null,
    findByAccountIds: async (accountIds: number[]) =>
      accountIds
        .map((accountId) => state.profiles.get(accountId) ?? null)
        .filter((profile): profile is NonNullable<typeof profile> => profile !== null),
  },
  workScheduleRepository: {
    findCurrentByAccountId: async (accountId: number) =>
      state.authSchedules.get(accountId) ?? null,
    findById: async (scheduleId: number) =>
      Array.from(state.authSchedules.values()).find(
        (schedule) => (schedule as { id?: number }).id === scheduleId
      ) ?? null,
  },
  sessionRepository: {
    findActiveByAccountId: async (accountId: number) =>
      Array.from(state.sessions.values()).find(
        (session) => session.account_id === accountId && session.is_active
      ) ?? null,
    findActiveById: async (sessionId: number) => {
      const session = state.sessions.get(sessionId);

      if (!session || !session.is_active) {
        return null;
      }

      if (
        typeof session.expires_at === "string" &&
        new Date(session.expires_at).getTime() <= Date.now()
      ) {
        return null;
      }

      return session;
    },
    createPending: async (session: Record<string, unknown>) => {
      const created = {
        id: state.nextSessionId++,
        ...session,
        refresh_token_hash: "",
        is_active: true,
        last_active_at: new Date().toISOString(),
      };
      state.sessions.set(created.id, created);
      return created;
    },
    updateRefreshTokenHash: async (sessionId: number, refreshTokenHash: string) => {
      const session = state.sessions.get(sessionId);

      if (!session) {
        throw new Error("Session not found.");
      }

      session.refresh_token_hash = refreshTokenHash;
      return session;
    },
    revoke: async (sessionId: number) => {
      const session = state.sessions.get(sessionId);

      if (session) {
        session.is_active = false;
      }

      return session ?? null;
    },
    revokeActiveByAccountIdExcept: async (accountId: number, exceptSessionId: number) => {
      for (const session of state.sessions.values()) {
        if (session.account_id === accountId && session.id !== exceptSessionId) {
          session.is_active = false;
        }
      }
    },
  },
};

const workerPushTokenRepositoryMock = {
  upsertWorkerPushToken: async (input: {
    worker_code: string;
    session_id?: number | null;
    device_id: string;
    platform?: string | null;
    fcm_token: string;
  }) => {
    const platform = input.platform ?? "unknown";
    const existingIndex = state.workerPushTokens.findIndex(
      (token) =>
        token.worker_code === input.worker_code &&
        token.device_id === input.device_id &&
        token.platform === platform
    );
    const token = {
      worker_code: input.worker_code,
      session_id: input.session_id ?? null,
      device_id: input.device_id,
      platform,
      fcm_token: input.fcm_token,
      fcm_token_hash: `hash:${input.fcm_token}`,
      is_active: true,
    };

    if (existingIndex >= 0) {
      state.workerPushTokens[existingIndex] = token;
    } else {
      state.workerPushTokens.push(token);
    }

    return {
      id: existingIndex >= 0 ? existingIndex + 1 : state.workerPushTokens.length,
      ...token,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  },
  listActiveTokensByWorkerCodes: async (workerCodes: string[]) =>
    state.workerPushTokens
      .filter((token) => token.is_active && workerCodes.includes(token.worker_code))
      .map((token, index) => ({
        id: index + 1,
        ...token,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
  revokeBySessionId: async (sessionId: number) => {
    let count = 0;

    for (const token of state.workerPushTokens) {
      if (token.session_id === sessionId && token.is_active) {
        token.is_active = false;
        count += 1;
      }
    }

    return count;
  },
  revokeByTokenHashes: async (hashes: string[]) => {
    let count = 0;

    for (const token of state.workerPushTokens) {
      if (hashes.includes(token.fcm_token_hash) && token.is_active) {
        token.is_active = false;
        count += 1;
      }
    }

    return count;
  },
};

// Function ค้นหา worker account ตาม identifier สำหรับ test
function findWorkerAccountByIdentifier(identifier: string): AccountRecord | null {
  const directAccount = state.authAccountsByUsername.get(identifier);

  if (directAccount?.role === "worker") {
    return directAccount;
  }

  const profile = (
    Array.from(state.profiles.values()) as Array<{
      account_id: number;
      worker_code?: string;
    }>
  ).find((item) => item.worker_code === identifier);

  if (!profile) {
    return null;
  }

  const account = state.authAccountsById.get(profile.account_id);

  return account?.role === "worker" ? account : null;
}

const adminWorkersRepositoryMock = {
  accountRepository: {
    findUserById: async (accountId: number | string) => {
      const account = state.authAccountsById.get(Number(accountId));

      return account?.role === "worker" ? account : null;
    },
    findUserByIdentifier: async (identifier: string) =>
      findWorkerAccountByIdentifier(identifier),
    listAllUsers: async () =>
      Array.from(state.authAccountsById.values())
        .filter((account) => account.role === "worker")
        .sort((left, right) => right.id - left.id),
  },
  profileRepository: {
    findByAccountId: async (accountId: number) =>
      state.profiles.get(accountId) ?? null,
    findByAccountIds: async (accountIds: number[]) =>
      accountIds
        .map((accountId) => state.profiles.get(accountId) ?? null)
        .filter((profile): profile is NonNullable<typeof profile> => profile !== null),
  },
  workScheduleRepository: {
    findCurrentByAccountId: async (accountId: number) =>
      state.authSchedules.get(accountId) ?? null,
    findById: async (scheduleId: number) =>
      Array.from(state.authSchedules.values()).find(
        (schedule) => (schedule as { id?: number }).id === scheduleId
      ) ?? null,
  },
  sessionRepository: authRepositoryMock.sessionRepository,
};

const adminSettingsRepositoryMock = {
  accountRepository: {
    findAdminById: async (accountId: number) => {
      const account = state.authAccountsById.get(accountId);

      return account?.role === "admin" ? account : null;
    },
    listAdmins: async () =>
      Array.from(state.authAccountsById.values())
        .filter((account) => account.role === "admin")
        .sort((left, right) => left.id - right.id),
    usernameExists: async (username: string) =>
      state.authAccountsByUsername.has(username),
    createAdmin: async (account: {
      username: string;
      password_hash: string;
      role: "admin";
      status?: string;
      full_name: string;
      position?: string | null;
      email?: string | null;
      phone?: string | null;
      permission_level?: string | null;
      created_by?: number | null;
    }) => {
      const nextId = Math.max(0, ...state.authAccountsById.keys()) + 1;
      const created: AccountRecord = {
        id: nextId,
        username: account.username,
        password_hash: account.password_hash,
        role: "admin",
        status: account.status ?? "active",
        full_name: account.full_name,
        position: account.position ?? null,
        email: account.email ?? null,
        phone: account.phone ?? null,
        permission_level: account.permission_level ?? null,
      };

      state.authAccountsByUsername.set(created.username, created);
      state.authAccountsById.set(created.id, created);

      return created;
    },
    updatePermissionLevel: async (accountId: number, permissionLevel: string) => {
      const account = state.authAccountsById.get(accountId);

      if (!account) {
        throw new Error("Admin account not found.");
      }

      account.permission_level = permissionLevel;
      return account;
    },
    updateStatus: async (accountId: number, status: string) => {
      const account = state.authAccountsById.get(accountId);

      if (!account) {
        throw new Error("Admin account not found.");
      }

      account.status = status;
      return account;
    },
    sanitizeAccount: (account: AccountRecord | null) => {
      if (!account) {
        return null;
      }

      const { password_hash: _passwordHash, ...safeAccount } = account;
      return safeAccount;
    },
  },
  permissionRepository: {
    listByAccountId: async (accountId: number) =>
      state.adminPermissions.get(accountId) ?? [],
    replaceAccountPermissions: async (accountId: number, permissions: string[]) => {
      state.adminPermissions.set(accountId, permissions);
    },
  },
  sessionRepository: {
    revokeActiveByAccountId: async (accountId: number) => {
      for (const session of state.sessions.values()) {
        if (session.account_id === accountId) {
          session.is_active = false;
        }
      }
    },
  },
  listSettings: async () => [],
  upsertSettings: async () => {},
};

const gateClientRepositoryMock = {
  listGateClients: async () =>
    Array.from(state.gateClients.values()).sort((left, right) => left.id - right.id),
  findByClientId: async (clientId: string) =>
    state.gateClients.get(clientId) ?? null,
  clientIdExists: async (clientId: string) =>
    state.gateClients.has(clientId),
  createGateClient: async (input: {
    client_id: string;
    name: string;
    secret_hash: string;
    status?: "active" | "inactive";
    created_by?: number | null;
    updated_by?: number | null;
  }) => {
    const now = new Date().toISOString();
    const created: GateClientRecord = {
      id: state.nextGateClientId++,
      client_id: input.client_id,
      name: input.name,
      secret_hash: input.secret_hash,
      status: input.status ?? "active",
      last_used_at: null,
      created_by: input.created_by ?? null,
      updated_by: input.updated_by ?? null,
      created_at: now,
      updated_at: now,
    };

    state.gateClients.set(created.client_id, created);

    return created;
  },
  updateGateClient: async (
    clientId: string,
    input: {
      name?: string;
      status?: "active" | "inactive";
      updated_by?: number | null;
    }
  ) => {
    const existing = state.gateClients.get(clientId);

    if (!existing) {
      throw new Error("Gate client not found.");
    }

    existing.name = input.name ?? existing.name;
    existing.status = input.status ?? existing.status;
    existing.updated_by = input.updated_by ?? null;
    existing.updated_at = new Date().toISOString();

    return existing;
  },
  updateGateClientSecret: async (
    clientId: string,
    secretHash: string,
    updatedBy?: number | null
  ) => {
    const existing = state.gateClients.get(clientId);

    if (!existing) {
      throw new Error("Gate client not found.");
    }

    existing.secret_hash = secretHash;
    existing.updated_by = updatedBy ?? null;
    existing.updated_at = new Date().toISOString();

    return existing;
  },
  updateLastUsedAt: async (clientId: string) => {
    const existing = state.gateClients.get(clientId);

    if (!existing) {
      throw new Error("Gate client not found.");
    }

    existing.last_used_at = new Date().toISOString();
    existing.updated_at = existing.last_used_at;
  },
};

/* -------------------------------------- Module Loader Patch -------------------------------------- */

// Function ตั้งค่า module loader จำลองสำหรับ route test
function patchModuleLoader(): void {
  if (patched) {
    return;
  }

  patched = true;
  moduleWithLoad._load = function patchedLoad(
    request: string,
    parent: NodeModule | null | undefined,
    isMain: boolean
  ) {
    if (request === "ioredis") {
      return FakeRedis;
    }

    if (request === "bullmq") {
      return {
        Queue: FakeQueue,
        Worker: FakeWorker,
      };
    }

    if (request === "../db/prisma" || request === "../../db/prisma") {
      return {
        withTransaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
          callback({ transaction: true }),
      };
    }

    if (request === "../repositories/worker.repository") {
      return workerApplicationRepositoryMock;
    }

    if (request === "../repositories/gate.repository") {
      return gateRepositoryMock;
    }

    if (request === "../repositories/auth.repository") {
      return {
        ...authRepositoryMock,
        workerPushTokenRepository: workerPushTokenRepositoryMock,
      };
    }

    if (request === "../repositories/admin-workers.repository") {
      return adminWorkersRepositoryMock;
    }

    if (request === "../repositories/admin-settings.repository") {
      return {
        ...adminSettingsRepositoryMock,
        gateClientRepository: gateClientRepositoryMock,
      };
    }

    if (request === "../services/admin-settings.service" || request === "./admin-settings.service") {
      const parentFilename = (parent?.filename ?? "").replaceAll("\\", "/");

      if (
        parentFilename.endsWith("routes/admin-settings.routes.ts") ||
        parentFilename.endsWith("middlewares/gate-client-auth.middleware.ts")
      ) {
        return originalLoad.apply(this, [request, parent, isMain]);
      }

      return {
        getRuntimeSettings: async () => ({
          worker_accept_deadline_seconds: 60,
          worker_accept_timeout_limit: 3,
          worker_scan_deadline_minutes: 15,
          worker_scan_warning_before_minutes: 2,
          worker_scan_team_remaining_minutes: 5,
          worker_break_duration_minutes: 15,
          worker_break_limit: 4,
          worker_break_count_ttl_hours: 48,
          worker_presence_stale_seconds: 90,
          vendor_confirm_timeout_hours: 24,
          vendor_reconfirm_timeout_hours: 4,
          driver_session_ttl_hours: 24,
        }),
        getAccountPermissions: async (account: AccountRecord) => ({
          account_id: account.id,
          role: account.role,
          permission_level: account.permission_level,
          permissions: state.adminPermissions.get(account.id) ?? [],
        }),
      };
    }

    if (request === "../services/notifications.service" || request === "./notifications.service") {
      return {
        publishNotification: (event: unknown) => state.notifications.push(event),
        publishAdminWorkerStatusChanged: (event: {
          title: string;
          message: string;
          workerCode: string | null;
          queue: unknown;
          reason: string;
          extraPayload?: Record<string, unknown>;
        }) => state.notifications.push({
          type: "WORKER_STATUS_CHANGED",
          title: event.title,
          message: event.message,
          payload: {
            worker_code: event.workerCode,
            queue: event.queue,
            reason: event.reason,
            ...(event.extraPayload ?? {}),
          },
          audience: {
            roles: ["admin"],
          },
        }),
      };
    }

    if (request === "../utils/realtime-event") {
      return {
        publishRealtimeEvent: (event: unknown) => state.realtimeEvents.push(event),
      };
    }

    if (request === "../websockets/worker.socket") {
      return {
        isWorkerSocketConnected: (accountId: number) => state.connectedWorkers.has(accountId),
        sendWorkerSocketEvent: (accountId: number, event: string, payload: unknown) => {
          state.socketEvents.push({
            accountId,
            event,
            payload,
          });
        },
      };
    }

    if (request === "../queues/notification-queue") {
      return {
        enqueueLineMessage: async (name: string, data: unknown) => {
          state.lineMessages.push({
            name,
            data,
          });
        },
        enqueueLoggedLineMessage: async (input: {
          jobName: string;
          targetLineUserId: string;
          messages: unknown;
        }) => {
          state.lineMessages.push({
            name: input.jobName,
            data: {
              log_id: 1,
              to: input.targetLineUserId,
              messages: input.messages,
            },
          });
          return 1;
        },
      };
    }

    if (request === "../repositories/line.repository") {
      return {
        createMessageDeliveryLog: async () => 1,
        createLineActionToken: async (input: {
          action: string;
          ticket_id: number;
          submission_id: number;
          boothCode: string;
          expires_at?: Date;
        }) => {
          const now = new Date();
          const id = state.nextLineActionTokenId++;
          const record = {
            id,
            token: `line-action-token-${id}`,
            action: input.action,
            ticket_id: input.ticket_id,
            submission_id: input.submission_id,
            boothCode: input.boothCode,
            expires_at:
              input.expires_at?.toISOString() ??
              new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            used_at: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          };

          state.lineActionTokens.push(record);
          return record;
        },
        findLineActionToken: async (token: string) =>
          state.lineActionTokens.find((record) => record.token === token) ?? null,
        upsertTicketRating: async (input: {
          ticket_id: number;
          submission_id: number;
          line_user_id: string;
          target_type?: string | null;
          score: number;
        }) => {
          const now = new Date().toISOString();
          let rating = state.ticketRatings.find(
            (item) =>
              item.ticket_id === input.ticket_id &&
              item.line_user_id === input.line_user_id
          );

          if (!rating) {
            rating = {
              id: state.nextRatingId++,
              ticket_id: input.ticket_id,
              submission_id: input.submission_id,
              line_user_id: input.line_user_id,
              target_type: input.target_type ?? null,
              score: input.score,
              rated_at: now,
              created_at: now,
              updated_at: now,
            };
            state.ticketRatings.push(rating);
            return rating;
          }

          rating.submission_id = input.submission_id;
          rating.target_type = input.target_type ?? null;
          rating.score = input.score;
          rating.rated_at = now;
          rating.updated_at = now;
          return rating;
        },
      };
    }

    return originalLoad.apply(this, [request, parent, isMain]);
  };
}

/* -------------------------------------- Module Getters -------------------------------------- */

// Function ดึง password สำหรับ test
export async function getPassword() {
  patchModuleLoader();
  passwordModule ??= await import("../../src/utils/password");
  return passwordModule;
}

// Function ดึง worker queue สำหรับ test
export async function getWorkerQueue() {
  patchModuleLoader();
  workerQueueModule ??= await import("../../src/queues/worker-queue");
  return workerQueueModule;
}

// Function ดึง worker dispatch สำหรับ test
export async function getWorkerDispatch() {
  patchModuleLoader();
  workerDispatchModule ??= await import("../../src/queues/worker-dispatch");
  return workerDispatchModule;
}

/* -------------------------------------- Test Server -------------------------------------- */

export type TestServer = {
  request: (
    method: string,
    path: string,
    options?: {
      body?: unknown;
      token?: string;
      headers?: Record<string, string>;
      external?: boolean;
    }
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
};

// Function ตรวจว่า return external body สำหรับ test
function shouldReturnExternalBody(body: unknown, forceExternal?: boolean): boolean {
  return Boolean(
    forceExternal ||
      (body &&
        typeof body === "object" &&
        ("Result" in body || "Ticket" in body))
  );
}

// Function เริ่ม server จำลองสำหรับ test route API
export async function startRouteTestServer(): Promise<TestServer> {
  patchModuleLoader();
  appModule ??= await import("../../src/app");

  const server: Server = appModule.default.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Test server address is not available.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    request: async (method, path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.headers ?? {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      const parsedBody = text ? JSON.parse(text) : null;

      return {
        status: response.status,
        body: shouldReturnExternalBody(parsedBody, options.external)
          ? parsedBody
          : normalizeApiRequestPayload(parsedBody),
      };
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

// Function คืน module loader กลับสู่สภาพเดิมหลัง test
export function restoreRouteTestLoader(): void {
  if (!patched) {
    return;
  }

  moduleWithLoad._load = originalLoad;
  patched = false;
}

