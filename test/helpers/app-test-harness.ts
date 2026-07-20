import type { Server } from "node:http";
import Module = require("node:module");
import { applyIsolatedTestEnv } from "../setup/test-env";

/* -------------------------------------- Test Env -------------------------------------- */

// Config แยก env ของ route test ออกจาก infra จริง เช่น Redis key, BullMQ queue และ JWT secret
applyIsolatedTestEnv("route-test");
process.env.WORKER_PRESENCE_STALE_SECONDS = "90";

/* -------------------------------------- Module Loader Types -------------------------------------- */

// Type function _load ของ Node module loader ที่ใช้ patch dependency เฉพาะตอน test
type ModuleLoad = (
  request: string,
  parent: NodeModule | null | undefined,
  isMain: boolean
) => unknown;

// Type Module ที่เพิ่ม _load เพื่อให้ TypeScript รู้จัก field private ที่ต้อง patch ใน test
type ModuleWithLoad = typeof Module & {
  _load: ModuleLoad;
};

/* -------------------------------------- Test Record Types -------------------------------------- */

// Type record account จำลองที่ repository mock ส่งให้ service เหมือนข้อมูลจาก database
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

// Type record assignment จำลองสำหรับ worker dispatch, accept, timeout และ scan QR flow
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

// Type record vehicle job จำลองสำหรับงานที่พร้อม dispatch ให้ worker
type VehicleJobRecord = {
  id: number;
  vehicle_job_ref: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  workers_required: number;
  status: string;
  driver_qr_token: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
};

// Type record gate ticket จำลองสำหรับ flow complete งานและรอ vendor confirm
type GateTicketRecord = {
  id: number;
  vehicle_job_id: number;
  market_job_id: number;
  market_job_ref?: string;
  market_name?: string;
  stall_job_ref: string;
  ticket_no: string | null;
  stall_no: string | null;
  vendor_name: string | null;
  vendor_line_id: string | null;
  status: string;
  confirmation_status: string | null;
  created_at?: string;
  updated_at?: string;
};

// Type record product ใน ticket เพื่อทดสอบการกรอกจำนวนสินค้าให้ครบ
type TicketProductRecord = {
  id: number;
  ticket_id: number;
  product_ref: string;
  product_type: string | null;
  name: string;
  quantity: string;
  confirmed_quantity: string | null;
  unit: string;
  created_at?: string;
  updated_at?: string;
};

// Type record ความสัมพันธ์ ticket กับ worker ที่รับงานใน flow complete ticket
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

// State กลางของ route test ใช้แทน DB/Redis/BullMQ/WebSocket เพื่อให้ test ตรวจ flow จริงโดยไม่แตะ infra จริง
export const state = {
  connectedWorkers: new Set<number>(),
  socketEvents: [] as Array<{ accountId: number; event: string; payload: unknown }>,
  notifications: [] as unknown[],
  realtimeEvents: [] as unknown[],
  lineMessages: [] as unknown[],
  workers: new Map<number, AccountRecord>(),
  schedules: new Map<number, unknown>(),
  vehicleJobs: [] as VehicleJobRecord[],
  assignments: [] as AssignmentRecord[],
  gateTickets: [] as GateTicketRecord[],
  ticketProducts: [] as TicketProductRecord[],
  ticketWorkers: [] as TicketWorkerRecord[],
  completionSubmissions: [] as TicketCompletionSubmissionRecord[],
  gateRequestLogs: [] as GateRequestLogRecord[],
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
};

/* -------------------------------------- Fake Infra -------------------------------------- */

// Class จำลอง Redis เฉพาะ command ที่ worker queue และ dispatch ใช้ใน test
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

// Class จำลอง BullMQ Queue เพื่อเก็บ delayed job เช่น assignment timeout ไว้ใน memory
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

// Class จำลอง BullMQ Worker เพื่อเก็บ processor ไว้ให้ test เรียกตรวจ behavior ได้
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

// Function สร้าง work schedule วันนี้ให้ worker มีสิทธิ์ online และรับงานใน route test
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

// Function reset state ทุกส่วนก่อนแต่ละ test เพื่อไม่ให้ session/queue/job จาก test ก่อนหน้าปนกัน
export function resetRouteTestState(): void {
  FakeRedis.hashes.clear();
  FakeRedis.zsets.clear();
  FakeRedis.strings.clear();
  state.connectedWorkers.clear();
  state.socketEvents.length = 0;
  state.notifications.length = 0;
  state.realtimeEvents.length = 0;
  state.lineMessages.length = 0;
  state.workers.clear();
  state.schedules.clear();
  state.vehicleJobs.length = 0;
  state.assignments.length = 0;
  state.gateTickets.length = 0;
  state.ticketProducts.length = 0;
  state.ticketWorkers.length = 0;
  state.completionSubmissions.length = 0;
  state.gateRequestLogs.length = 0;
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
}

// Function เพิ่ม worker account พร้อม profile/schedule ลง mock repository state
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

// Function เพิ่ม admin account ลง mock repository state สำหรับทดสอบ auth/admin route
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
    "permissions:read",
    "permissions:update",
    "roles:read",
    "workers:read",
  ]);

  return admin;
}

// Function เพิ่ม vehicle job ที่พร้อม dispatch ให้ worker ตามจำนวนแรงงานที่ต้องการ
export function addDispatchableJob(id: number, workersRequired: number): VehicleJobRecord {
  const now = new Date().toISOString();
  const job = {
    id,
    vehicle_job_ref: `JOB-${id}`,
    gate_transaction_ref: `GATE-${id}`,
    license_plate: `TEST-${id}`,
    vehicle_type: "truck",
    workers_required: workersRequired,
    status: "IN_PROGRESS",
    driver_qr_token: `driver-qr-${id}`,
    worker_qr_token: `worker-qr-${id}`,
    created_at: now,
    updated_at: now,
  };

  state.vehicleJobs.push(job);

  return job;
}

// Function เพิ่ม assignment ค้างรับงาน เพื่อทดสอบ accept, timeout และ requeue flow
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

// Function เพิ่ม ticket และสินค้าใน ticket เพื่อทดสอบ worker complete งาน
export function addTicketForVehicleJob(
  vehicleJobId: number,
  ticketId = vehicleJobId + 1000
): GateTicketRecord {
  const now = new Date().toISOString();
  const ticket = {
    id: ticketId,
    vehicle_job_id: vehicleJobId,
    market_job_id: vehicleJobId + 2000,
    market_job_ref: `MARKET-${vehicleJobId}`,
    market_name: "Market A",
    stall_job_ref: `STALL-${ticketId}`,
    ticket_no: `TICKET-${ticketId}`,
    stall_no: "A1",
    vendor_name: "Vendor A",
    vendor_line_id: "line-vendor-a",
    status: "IN_PROGRESS",
    confirmation_status: null,
    created_at: now,
    updated_at: now,
  };

  state.gateTickets.push(ticket);
  state.ticketProducts.push(
    {
      id: ticketId * 10 + 1,
      ticket_id: ticketId,
      product_ref: `PRODUCT-${ticketId}-1`,
      product_type: "fruit",
      name: "Apple",
      quantity: "10",
      confirmed_quantity: null,
      unit: "kg",
      created_at: now,
      updated_at: now,
    },
    {
      id: ticketId * 10 + 2,
      ticket_id: ticketId,
      product_ref: `PRODUCT-${ticketId}-2`,
      product_type: "vegetable",
      name: "Cabbage",
      quantity: "5",
      confirmed_quantity: null,
      unit: "box",
      created_at: now,
      updated_at: now,
    }
  );

  return ticket;
}

function findCurrentOpenTicketForVehicleJob(vehicleJobId: number): {
  ticket: GateTicketRecord;
  market_job_ref: string;
  market_name: string;
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
    market_job_ref: ticket.market_job_ref ?? `MARKET-${ticket.market_job_id}`,
    market_name: ticket.market_name ?? `Market ${ticket.market_job_id}`,
  };
}

function activateNextTicketForVehicleJob(vehicleJobId: number): {
  ticket: GateTicketRecord;
  market_job_ref: string;
  market_name: string;
} | null {
  const current = findCurrentOpenTicketForVehicleJob(vehicleJobId);

  if (!current) {
    return null;
  }

  if (current.ticket.status === "WAIT") {
    current.ticket.status = "IN_PROGRESS";
    current.ticket.updated_at = new Date().toISOString();
  }

  return current;
}

/* -------------------------------------- Repository Mocks -------------------------------------- */

// Mock repository ฝั่ง worker service โดยเก็บข้อมูลใน memory แต่ยังให้ service จริงเป็นคนตัดสิน business rule
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
  listDispatchableVehicleJobs: async () =>
    state.vehicleJobs.filter((job) => job.status === "IN_PROGRESS"),
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
    vehicleJobRef: string,
    workerAccountId: number
  ) => {
    const job = state.vehicleJobs.find(
      (vehicleJob) => vehicleJob.vehicle_job_ref === vehicleJobRef
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

    job.status = "IN_PROGRESS";
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
      .map((assignment) => ({
        assignment,
        vehicle_job: state.vehicleJobs.find(
          (job) => job.id === assignment.vehicle_job_id
        ) ?? {
          id: assignment.vehicle_job_id,
          vehicle_job_ref: `JOB-${assignment.vehicle_job_id}`,
          gate_transaction_ref: `GATE-${assignment.vehicle_job_id}`,
          license_plate: "TEST",
          vehicle_type: null,
          workers_required: 1,
          status: "IN_PROGRESS",
          driver_qr_token: `driver-qr-${assignment.vehicle_job_id}`,
          worker_qr_token: `worker-qr-${assignment.vehicle_job_id}`,
          created_at: assignment.created_at ?? new Date().toISOString(),
          updated_at: assignment.created_at ?? new Date().toISOString(),
        },
      })),
  findGateTicketForCompletion: async (ticketId: number) =>
    state.gateTickets.find((ticket) => ticket.id === ticketId) ?? null,
  findGateTicketForCompletionByReference: async (reference: string) =>
    state.gateTickets.find(
      (ticket) => ticket.stall_job_ref === reference || ticket.ticket_no === reference
    ) ?? null,
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
          status: "ACTIVE",
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
      !["WAIT", "IN_PROGRESS", "REJECT"].includes(ticket.status)
    ) {
      return false;
    }

    ticket.status = "DELIVERED";
    ticket.confirmation_status = "DELIVERED";
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
  confirmTicketCompletion: async (ticketId: number, submissionId: number) => {
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
  rejectTicketCompletion: async (ticketId: number, submissionId: number) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);
    const submission = state.completionSubmissions.find(
      (item) => item.id === submissionId
    );

    if (!ticket || ticket.status !== "DELIVERED" || !submission) {
      throw new Error("Ticket reject did not update a waiting ticket.");
    }

    ticket.status = "REJECT";
    ticket.confirmation_status = "REJECT";
    submission.status = "REJECT";
    submission.rejected_at = new Date().toISOString();
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
    items: Array<{ product_ref: string; confirmed_quantity: number }>
  ) => {
    for (const item of items) {
      const product = state.ticketProducts.find(
        (candidate) =>
          candidate.ticket_id === ticketId &&
          candidate.product_ref === item.product_ref
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
        vehicle_job_ref: job.vehicle_job_ref,
        gate_transaction_ref: job.gate_transaction_ref,
        license_plate: job.license_plate,
        vehicle_type: job.vehicle_type,
        workers_required: job.workers_required,
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
          market_job_ref: firstTicket?.market_job_ref ?? `MARKET-${marketJobId}`,
          market_name: firstTicket?.market_name ?? "Market A",
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

// Mock repository ฝั่ง auth service สำหรับ login, session, refresh และ current user route
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
  findVehicleJobByRef: async (vehicleJobRef: string) =>
    state.vehicleJobs.find((job) => job.vehicle_job_ref === vehicleJobRef) ?? null,
  createVehicleJobFromGate: async (input: {
    gate_transaction_ref: string;
    vehicle_job_ref: string;
    license_plate: string;
    vehicle_type?: string | null;
    workers_required: number;
    dispatch_now?: boolean;
    markets: Array<{
      market_job_ref: string;
      market_name: string;
      tickets: Array<{
        stall_job_ref: string;
        ticket_no?: string | null;
        stall_no?: string | null;
        vendor_name?: string | null;
        vendor_line_id?: string | null;
        products: Array<{
          product_ref: string;
          product_type?: string | null;
          name: string;
          quantity: number;
          unit: string;
        }>;
      }>;
    }>;
  }, payloadSnapshot: unknown) => {
    const now = new Date().toISOString();
    const dispatchNow = input.dispatch_now === true;
    const vehicleJobId = Math.max(0, ...state.vehicleJobs.map((job) => job.id)) + 1;
    const vehicleJob = {
      id: vehicleJobId,
      vehicle_job_ref: input.vehicle_job_ref,
      gate_transaction_ref: input.gate_transaction_ref,
      license_plate: input.license_plate,
      vehicle_type: input.vehicle_type ?? null,
      workers_required: input.workers_required,
      status: dispatchNow ? "IN_PROGRESS" : "WAIT",
      driver_qr_token: `driver-qr-${vehicleJobId}`,
      worker_qr_token: `worker-qr-${vehicleJobId}`,
      created_at: now,
      updated_at: now,
    };

    state.vehicleJobs.push(vehicleJob);

    let marketJobId = Math.max(0, ...state.gateTickets.map((ticket) => ticket.market_job_id)) + 1;
    let ticketId = Math.max(0, ...state.gateTickets.map((ticket) => ticket.id)) + 1;
    let productId = Math.max(0, ...state.ticketProducts.map((product) => product.id)) + 1;

    for (const market of input.markets) {
      const currentMarketJobId = marketJobId++;

      for (const ticketInput of market.tickets) {
        const currentTicketId = ticketId++;
        state.gateTickets.push({
          id: currentTicketId,
          vehicle_job_id: vehicleJob.id,
          market_job_id: currentMarketJobId,
          market_job_ref: market.market_job_ref,
          market_name: market.market_name,
          stall_job_ref: ticketInput.stall_job_ref,
          ticket_no: ticketInput.ticket_no ?? null,
          stall_no: ticketInput.stall_no ?? null,
          vendor_name: ticketInput.vendor_name ?? null,
          vendor_line_id: ticketInput.vendor_line_id ?? null,
          status: "WAIT",
          confirmation_status: "WAIT",
          created_at: now,
          updated_at: now,
        });

        ticketInput.products.forEach((product) => {
          state.ticketProducts.push({
            id: productId++,
            ticket_id: currentTicketId,
            product_ref: product.product_ref,
            product_type: product.product_type ?? null,
            name: product.name,
            quantity: String(product.quantity),
            confirmed_quantity: null,
            unit: product.unit,
            created_at: now,
            updated_at: now,
          });
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
  },
};

// Mock repository ฝั่ง admin settings สำหรับสร้าง admin และจัดการ permission ผ่าน service จริง
const adminSettingsRepositoryMock = {
  accountRepository: {
    findAdminById: async (accountId: number) => {
      const account = state.authAccountsById.get(accountId);

      return account?.role === "admin" ? account : null;
    },
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

/* -------------------------------------- Module Loader Patch -------------------------------------- */

// Function patch import ของ dependency ภายนอกให้ route test ใช้ fake infra และ mock repository
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

    if (request === "../repositories/worker-application.repository") {
      return workerApplicationRepositoryMock;
    }

    if (request === "../repositories/gate.repository") {
      return gateRepositoryMock;
    }

    if (request === "../repositories/auth.repository") {
      return authRepositoryMock;
    }

    if (request === "../repositories/admin-settings.repository") {
      return adminSettingsRepositoryMock;
    }

    if (request === "../services/admin-settings.service" || request === "./admin-settings.service") {
      const parentFilename = (parent?.filename ?? "").replaceAll("\\", "/");

      if (parentFilename.endsWith("routes/admin-settings.routes.ts")) {
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
      };
    }

    if (request === "./realtime.service") {
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
      };
    }

    if (request === "../repositories/line.repository") {
      return {
        createMessageDeliveryLog: async () => 1,
      };
    }

    return originalLoad.apply(this, [request, parent, isMain]);
  };
}

/* -------------------------------------- Module Getters -------------------------------------- */

// Function โหลด password utility หลัง patch loader แล้ว เพื่อให้ env/config test พร้อมก่อน import
export async function getPassword() {
  patchModuleLoader();
  passwordModule ??= await import("../../src/utils/password");
  return passwordModule;
}

// Function โหลด worker queue จริงของ project แต่ผูกกับ FakeRedis ใน test
export async function getWorkerQueue() {
  patchModuleLoader();
  workerQueueModule ??= await import("../../src/queues/worker-queue");
  return workerQueueModule;
}

// Function โหลด worker dispatch จริงของ project แต่ผูกกับ mock repository และ FakeRedis ใน test
export async function getWorkerDispatch() {
  patchModuleLoader();
  workerDispatchModule ??= await import("../../src/queues/worker-dispatch");
  return workerDispatchModule;
}

/* -------------------------------------- Test Server -------------------------------------- */

// Type server helper สำหรับเรียก endpoint จริงผ่าน HTTP โดยไม่ต้องติดตั้ง supertest เพิ่ม
export type TestServer = {
  request: (
    method: string,
    path: string,
    options?: { body?: unknown; token?: string }
  ) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
};

// Function start Express app จริงบน random port แล้วคืน helper สำหรับยิง request ใน route test
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
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();

      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
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

// Function restore Node module loader หลังจบ route test เพื่อไม่ให้ patch กระทบ test ชุดอื่น
export function restoreRouteTestLoader(): void {
  if (!patched) {
    return;
  }

  moduleWithLoad._load = originalLoad;
  patched = false;
}
