import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  addDispatchableJob,
  addPendingAssignment,
  addTicketForVehicleJob,
  addWorker,
  getPassword,
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

/* -------------------------------------- Test Helpers -------------------------------------- */

// Function login worker ผ่าน auth route จริง เพื่อให้ worker route test ได้ access token/session เหมือน flow จริง
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

function buildGateVehicleJobBody(suffix: string) {
  return {
    gate_transaction_ref: `GATE-REQ-${suffix}`,
    vehicle_job_ref: `VEH-20260706-${suffix}`,
    license_plate: `ABC-${suffix}`,
    vehicle_type: "Six-wheel truck",
    workers_required: 1,
    dispatch_now: true,
    markets: [
      {
        market_job_ref: `MARKETJOB-${suffix}`,
        market_name: "Market A",
        tickets: [
          {
            stall_job_ref: `STALLJOB-${suffix}`,
            ticket_no: `BILL-${suffix}`,
            stall_no: "A-01",
            vendor_name: "Vendor A",
            vendor_line_id: "line-vendor-a",
            products: [
              {
                product_ref: `PRODUCT-${suffix}-001`,
                product_type: "Vegetable",
                name: "Cabbage",
                quantity: 10,
                unit: "crate",
              },
            ],
          },
        ],
      },
    ],
  };
}

/* -------------------------------------- Test Lifecycle -------------------------------------- */

before(async () => {
  password = await getPassword();
  workerQueue = await getWorkerQueue();
  workerDispatch = await getWorkerDispatch();
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

test("POST /api/gate/vehicle-jobs creates a new vehicle job", async () => {
  const response = await server.request("POST", "/api/gate/vehicle-jobs", {
    body: buildGateVehicleJobBody("001"),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "message",
    "qr",
    "result",
    "vehicle_job",
  ]);
  assert.deepEqual(Object.keys(response.body.vehicle_job).sort(), [
    "gate_transaction_ref",
    "license_plate",
    "status",
    "vehicle_job_ref",
  ]);
  assert.equal(response.body.result, "CREATED");
  assert.equal(response.body.vehicle_job.vehicle_job_ref, "VEH-20260706-001");
  assert.equal(response.body.vehicle_job.gate_transaction_ref, "GATE-REQ-001");
  assert.equal(response.body.markets, undefined);
  assert.equal(state.vehicleJobs.length, 1);
});

test("POST /api/gate/vehicle-jobs replays the same Gate request", async () => {
  const body = buildGateVehicleJobBody("002");
  const created = await server.request("POST", "/api/gate/vehicle-jobs", { body });
  const replayed = await server.request("POST", "/api/gate/vehicle-jobs", { body });

  assert.equal(created.status, 201);
  assert.equal(replayed.status, 200);
  assert.deepEqual(Object.keys(replayed.body).sort(), [
    "message",
    "qr",
    "result",
    "vehicle_job",
  ]);
  assert.equal(replayed.body.result, "REPLAYED");
  assert.equal(replayed.body.vehicle_job.vehicle_job_ref, "VEH-20260706-002");
  assert.equal(replayed.body.idempotency_key, undefined);
  assert.equal(replayed.body.duplicate_field, undefined);
  assert.equal(replayed.body.markets, undefined);
  assert.equal(state.vehicleJobs.length, 1);
});

test("POST /api/gate/vehicle-jobs rejects reused Gate ref with a different payload", async () => {
  const body = buildGateVehicleJobBody("003");
  await server.request("POST", "/api/gate/vehicle-jobs", { body });

  const mismatch = await server.request("POST", "/api/gate/vehicle-jobs", {
    body: {
      ...body,
      license_plate: "DIFFERENT-003",
    },
  });

  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, "GATE_TRANSACTION_REF_PAYLOAD_MISMATCH");
  assert.equal(mismatch.body.duplicate_field, "gate_transaction_ref");
});

test("POST /api/gate/vehicle-jobs rejects duplicate vehicle job refs", async () => {
  const createdBody = buildGateVehicleJobBody("004");
  await server.request("POST", "/api/gate/vehicle-jobs", { body: createdBody });

  const duplicateBody = {
    ...buildGateVehicleJobBody("005"),
    vehicle_job_ref: createdBody.vehicle_job_ref,
  };
  const duplicate = await server.request("POST", "/api/gate/vehicle-jobs", {
    body: duplicateBody,
  });

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "VEHICLE_JOB_REF_ALREADY_EXISTS");
  assert.equal(duplicate.body.duplicate_field, "vehicle_job_ref");
});

/* -------------------------------------- Worker Queue Route Tests -------------------------------------- */

// Test endpoint worker online ว่า worker ที่มี WebSocket connected ถูกเพิ่มเข้า queue ด้วยสถานะ ready
test("POST /api/workers/me/online puts worker into queue", async () => {
  // Step Arrange login worker และจำลองว่า WebSocket connected แล้ว
  const { token, worker } = await loginWorker(101);
  state.connectedWorkers.add(worker.id);

  // Step Act เรียก endpoint เข้า queue
  const response = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  // Step Assert worker อยู่ใน queue ด้วยสถานะ ready
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "break_count_used",
    "completed_job_count",
    "full_name",
    "status",
    "today_job_count",
    "worker_code",
  ]);
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.status, "ready");
  assert.equal(response.body.today_job_count, 0);
  assert.equal(response.body.break_count_used, 0);
  assert.equal(response.body.completed_job_count, 0);
});

test("POST /api/workers/me/online dispatches an existing ready job when queue was empty", async () => {
  const job = addDispatchableJob(1030, 1);
  const { token, worker } = await loginWorker(103);
  state.connectedWorkers.add(worker.id);

  const response = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "busy");
  assert.equal(state.assignments.length, 1);
  assert.equal(state.assignments[0].vehicle_job_id, job.id);
  assert.equal(state.assignments[0].worker_account_id, worker.id);
  assert.equal(state.assignments[0].status, "PENDING");

  const assignedEvent = state.socketEvents.find(
    (event) => event.event === "WORKER_ASSIGNED" && event.accountId === worker.id
  );
  assert.ok(assignedEvent);
  assert.equal(
    (assignedEvent.payload as { vehicle_job_ref?: string }).vehicle_job_ref,
    job.vehicle_job_ref
  );
});

test("POST /api/workers/me/online does not count TIMEOUT assignments", async () => {
  const { token, worker } = await loginWorker(104);
  state.connectedWorkers.add(worker.id);
  const timeoutAssignment = addPendingAssignment(10201, 1020, worker.id);
  const completedAssignment = addPendingAssignment(10202, 1021, worker.id);
  timeoutAssignment.status = "TIMEOUT";
  completedAssignment.status = "COMPLETED";
  completedAssignment.completed_at = new Date().toISOString();

  const response = await server.request("POST", "/api/workers/me/online", {
    token,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.today_job_count, 1);
  assert.equal(response.body.completed_job_count, 1);
});

test("POST /api/workers/me/offline returns worker daily summary", async () => {
  const { token, worker } = await loginWorker(103);
  await workerQueue.enqueueWorker(worker.id);

  const response = await server.request("POST", "/api/workers/me/offline", {
    token,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "break_count_used",
    "completed_job_count",
    "full_name",
    "status",
    "today_job_count",
    "worker_code",
  ]);
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.status, "offline");
  assert.equal(response.body.today_job_count, 0);
  assert.equal(response.body.break_count_used, 0);
  assert.equal(response.body.completed_job_count, 0);
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
  assert.equal(response.body.break_count_limit, 5);

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
  assert.equal(breakSocketQueue?.break_count_limit, 5);
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
  assert.equal(response.body.status, "ready");
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
    "full_name",
    "image_url",
    "nationality",
    "phone",
    "shift",
    "status",
    "work_start_date",
    "worker_code",
  ]);
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.image_url, null);
  assert.equal(response.body.status, "ready");
  assert.equal(response.body.nationality, "Thai");
  assert.equal(response.body.work_start_date, "2026-01-01");
  assert.equal(response.body.phone, worker.phone);
  assert.equal(typeof response.body.shift.name, "string");
  assert.equal(response.body.shift.start_time, "00:00");
  assert.equal(response.body.shift.end_time, "23:59");
  assert.equal("break_until" in response.body, false);
  assert.equal("remaining_break_time" in response.body, false);
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
});

/* -------------------------------------- Worker Queue Function Tests -------------------------------------- */

// Test queue function ว่า worker ที่เข้าคิวพร้อมกันใน millisecond เดียวกันยังคงเรียง FIFO ตามลำดับ enqueue
test("worker queue keeps FIFO order when workers enter in the same millisecond", async () => {
  // Step Arrange ล็อก Date.now แล้วเรียก queue function ของ project เพื่อจำลองเข้า queue พร้อมกัน
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

  // Step Act ดึง worker จาก queue ตามลำดับที่ระบบจะจ่ายงาน
  const popped = await workerQueue.popReadyWorkers(3);

  // Step Assert ต้องเรียงตามลำดับ enqueue จริง ไม่ใช่เลข account id
  assert.deepEqual(
    popped.map((worker) => worker.account_id),
    [2, 10, 1]
  );
});

/* -------------------------------------- Worker Dispatch Flow Tests -------------------------------------- */

// Test dispatch function ว่าจ่ายงานให้ worker ที่ ready ตามลำดับ FIFO และเหลือคนถัดไปในคิว
test("dispatch assigns ready workers in FIFO order", async () => {
  // Step Arrange งานต้องการ 2 คน และ worker online 3 คนตามลำดับ
  const job = addDispatchableJob(501, 2);
  state.connectedWorkers.add(11);
  state.connectedWorkers.add(12);
  state.connectedWorkers.add(13);

  await workerQueue.enqueueWorker(11);
  await workerQueue.enqueueWorker(12);
  await workerQueue.enqueueWorker(13);

  // Step Act ใช้ dispatch function ของ project จ่ายงานจาก queue
  await workerDispatch.dispatchReadyWorkers();

  // Step Assert 2 คนแรกได้งานตาม FIFO และคนที่ 3 ยังรอคิว
  assert.deepEqual(
    state.assignments.map((assignment) => assignment.worker_account_id),
    [11, 12]
  );
  assert.equal((await workerQueue.getWorkerQueueStatus(11))?.status, "busy");
  assert.equal((await workerQueue.getWorkerQueueStatus(12))?.status, "busy");
  assert.equal((await workerQueue.getWorkerQueueStatus(13))?.status, "ready");
  const assignedEvent = state.socketEvents.find(
    (event) => event.event === "WORKER_ASSIGNED" && event.accountId === 11
  );
  const payload = assignedEvent?.payload as {
    vehicle_job_ref: string;
    gate_transaction_ref: string;
    worker_qr_token: string;
    assignment: { created_at: string; accept_deadline_at: string | null };
  };

  assert.deepEqual(Object.keys(payload).sort(), [
    "assignment",
    "gate_transaction_ref",
    "vehicle_job_ref",
    "worker_qr_token",
  ]);
  assert.equal(payload.vehicle_job_ref, job.vehicle_job_ref);
  assert.equal(payload.gate_transaction_ref, job.gate_transaction_ref);
  assert.equal(payload.worker_qr_token, job.worker_qr_token);
  assert.deepEqual(Object.keys(payload.assignment).sort(), [
    "accept_deadline_at",
    "created_at",
  ]);
});

// Test dispatch function ว่าข้าม worker ที่ socket หลุดและจ่ายงานให้ worker คนถัดไปที่ online
test("dispatch skips disconnected worker and assigns the next ready worker", async () => {
  // Step Arrange worker 21 อยู่หัวคิวแต่หลุดเน็ต ส่วน worker 22 connected
  addDispatchableJob(601, 1);
  state.connectedWorkers.add(22);

  await workerQueue.enqueueWorker(21);
  await workerQueue.enqueueWorker(22);

  // Step Act dispatch งานจาก queue
  await workerDispatch.dispatchReadyWorkers();

  // Step Assert คนหลุดถูก offline และคนถัดไปได้ assignment
  assert.equal((await workerQueue.getWorkerQueueStatus(21))?.status, "offline");
  assert.deepEqual(
    state.assignments.map((assignment) => assignment.worker_account_id),
    [22]
  );
});

/* -------------------------------------- Worker Assignment Route Tests -------------------------------------- */

// Test endpoint accept assignment ว่า worker รับงาน pending ได้ก่อนหมดเวลา
test("POST /api/workers/me/assignments/:vehicleJobRef/accept accepts pending assignment", async () => {
  // Step Arrange เตรียม worker และ pending assignment ที่ยังไม่หมดเวลา
  const { token, worker } = await loginWorker(51);
  const job = addDispatchableJob(851, 1);
  addTicketForVehicleJob(job.id, 1851);
  const oldAssignment = addPendingAssignment(950, job.id, worker.id);
  oldAssignment.status = "TIMEOUT";
  addPendingAssignment(951, job.id, worker.id);

  // Step Act เรียก endpoint รับงาน
  const response = await server.request("POST", `/api/workers/me/assignments/${job.vehicle_job_ref}/accept`, {
    token,
  });

  // Step Assert assignment เปลี่ยนเป็น ACCEPTED และมี scan deadline
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
    "market_name",
    "stall_count",
    "stalls",
  ]);
  assert.equal(response.body.markets[0].market_name, "Market A");
  assert.equal(response.body.markets[0].stall_count, 1);
  assert.deepEqual(Object.keys(response.body.markets[0].stalls[0]).sort(), [
    "product_count",
    "products",
    "stall_code",
    "stall_job_ref",
    "stall_name",
  ]);
  assert.equal(response.body.markets[0].stalls[0].stall_job_ref, "STALL-1851");
  assert.equal(response.body.markets[0].stalls[0].product_count, 2);
  assert.deepEqual(Object.keys(response.body.markets[0].stalls[0].products[0]).sort(), [
    "name",
    "product_ref",
    "quantity",
    "unit",
  ]);
  assert.equal(response.body.markets[0].stalls[0].products[0].name, "Apple");

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
    "vehicle_job_ref",
    "worker_code",
  ]);
  assert.equal(acceptedPayload.worker_code, `W${worker.id}`);
  assert.equal(acceptedPayload.status, "ACCEPTED");
  assert.equal(acceptedPayload.vehicle_job_ref, job.vehicle_job_ref);
  assert.equal(acceptedPayload.gate_transaction_ref, job.gate_transaction_ref);
  assert.equal(acceptedPayload.id, undefined);
  assert.equal(acceptedPayload.vehicle_job_id, undefined);
  assert.equal(acceptedPayload.worker_account_id, undefined);
});

// Test endpoint accept assignment ว่า accept ช้าเกิน deadline จะ timeout และ requeue worker ที่ยัง online
test("POST /api/workers/me/assignments/:vehicleJobRef/accept times out late accept and requeues connected worker", async () => {
  // Step Arrange assignment หมดเวลาแล้ว แต่ worker ยัง connected
  const { token, worker } = await loginWorker(52);
  const job = addDispatchableJob(852, 1);
  job.status = "WAIT";
  state.connectedWorkers.add(worker.id);
  addPendingAssignment(952, job.id, worker.id, -1000);

  // Step Act กดรับงานช้าเกิน deadline
  const response = await server.request("POST", `/api/workers/me/assignments/${job.vehicle_job_ref}/accept`, {
    token,
  });

  // Step Assert ได้ ASSIGNMENT_TIMEOUT และ worker กลับเข้า queue เป็น ready
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "ASSIGNMENT_TIMEOUT");
  assert.equal(state.assignments[0].status, "TIMEOUT");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "ready");
  const timeoutEvent = state.socketEvents.find(
    (item) => item.accountId === worker.id && item.event === "ASSIGNMENT_TIMEOUT"
  );
  assert.ok(timeoutEvent);
  const timeoutPayload = timeoutEvent.payload as Record<string, unknown>;
  assert.equal(timeoutPayload.vehicle_job_ref, job.vehicle_job_ref);
  assert.equal(timeoutPayload.assignment_id, undefined);
  assert.equal(timeoutPayload.vehicle_job_id, undefined);
});

// Test endpoint check-in QR ว่า worker scan QR ถูกต้องแล้ว assignment ไปสถานะ SCANNED
test("POST /api/workers/me/assignments/:vehicleJobRef/check-in-qr scans correct QR", async () => {
  // Step Arrange เตรียม assignment ที่รับงานแล้วและ QR ของงานรถ
  const { token, worker } = await loginWorker(61);
  const job = addDispatchableJob(861, 1);
  const assignment = addPendingAssignment(961, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  // Step Act scan QR ผ่าน endpoint worker
  const response = await server.request("POST", `/api/workers/me/assignments/${job.vehicle_job_ref}/check-in-qr`, {
    token,
    body: {
      qr_token: job.worker_qr_token,
    },
  });

  // Step Assert assignment เป็น SCANNED และ vehicle job เป็น IN_PROGRESS
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "status",
    "vehicle_job_ref",
    "worker_qr_token",
    "worker_code",
  ].sort());
  assert.equal(response.body.status, "SCANNED");
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.vehicle_job_ref, job.vehicle_job_ref);
  assert.equal(response.body.worker_qr_token, job.worker_qr_token);
  assert.equal(job.status, "IN_PROGRESS");
});

// Test endpoint check-in QR ว่า worker scan QR ผิดต้องถูก reject
test("POST /api/workers/me/assignments/:vehicleJobRef/check-in-qr rejects wrong QR", async () => {
  // Step Arrange เตรียม assignment ที่รับงานแล้ว
  const { token, worker } = await loginWorker(62);
  const job = addDispatchableJob(862, 1);
  const assignment = addPendingAssignment(962, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() + 15 * 60_000).toISOString();

  // Step Act scan QR ผิด
  const response = await server.request("POST", `/api/workers/me/assignments/${job.vehicle_job_ref}/check-in-qr`, {
    token,
    body: {
      qr_token: "wrong-qr-token",
    },
  });

  // Step Assert route คืน INVALID_WORKER_QR และ assignment ยังไม่เปลี่ยนสถานะ
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_WORKER_QR");
  assert.equal(assignment.status, "ACCEPTED");
});

test("POST /api/workers/me/assignments/:vehicleJobRef/check-in-qr rejects expired QR scan window", async () => {
  const { token, worker } = await loginWorker(63);
  const job = addDispatchableJob(863, 1);
  const assignment = addPendingAssignment(963, job.id, worker.id);
  assignment.status = "ACCEPTED";
  assignment.scan_deadline_at = new Date(Date.now() - 1000).toISOString();

  const response = await server.request("POST", `/api/workers/me/assignments/${job.vehicle_job_ref}/check-in-qr`, {
    token,
    body: {
      qr_token: job.worker_qr_token,
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "QR_EXPIRED");
  assert.equal(assignment.status, "ACCEPTED");
  assert.equal(job.status, "DISPATCH_NOW");
});

/* -------------------------------------- Worker Ticket Route Tests -------------------------------------- */

// Test endpoint complete ticket ว่า worker ส่งจำนวนสินค้าได้ครบและ ticket รอ vendor confirm
test("POST /api/workers/me/tickets/:stallJobRef/complete submits quantities for vendor confirmation", async () => {
  // Step Arrange เตรียม worker ที่ scan แล้ว, ticket และสินค้า
  const { token, worker } = await loginWorker(71);
  const job = addDispatchableJob(871, 1);
  const ticket = addTicketForVehicleJob(job.id, 971);
  const assignment = addPendingAssignment(1071, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();
  state.connectedWorkers.add(worker.id);
  await workerQueue.markWorkerBusy(worker.id);
  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);
  const originalDebugLinePostback = process.env.LINE_DEBUG_POSTBACK_RESPONSE;
  process.env.LINE_DEBUG_POSTBACK_RESPONSE = "true";

  // Step Act ส่งยอดสินค้าครบทุก product ผ่าน endpoint worker
  const response = await server.request("POST", `/api/workers/me/tickets/${ticket.stall_job_ref}/complete`, {
    token,
    body: {
      items: products.map((product, index) => ({
        product_ref: product.product_ref,
        confirmed_quantity: index === 0 ? 10 : 4,
      })),
    },
  });
  if (originalDebugLinePostback === undefined) {
    delete process.env.LINE_DEBUG_POSTBACK_RESPONSE;
  } else {
    process.env.LINE_DEBUG_POSTBACK_RESPONSE = originalDebugLinePostback;
  }

  // Step Assert ticket รอ vendor confirm และมี LINE/realtime event ถูกส่งออก
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "confirmation_status",
    "debug_line_postback",
    "items",
    "market_job_ref",
    "market_name",
    "message",
    "stall_job_ref",
    "stall_name",
    "stall_no",
    "status",
    "submission_status",
    "ticket_no",
    "vehicle_job_ref",
  ]);
  assert.equal(response.body.status, "WAITING_VENDOR_CONFIRM");
  assert.equal(response.body.confirmation_status, "WAITING_VENDOR_CONFIRM");
  assert.equal(response.body.vehicle_job_ref, job.vehicle_job_ref);
  assert.equal(response.body.market_job_ref, "MARKET-871");
  assert.equal(response.body.stall_job_ref, ticket.stall_job_ref);
  assert.equal(response.body.ticket_no, ticket.ticket_no);
  assert.equal(response.body.ticket, undefined);
  assert.equal(response.body.submission, undefined);
  assert.equal(response.body.products, undefined);
  assert.deepEqual(
    response.body.items.map((product: { confirmed_quantity: string | null }) => product.confirmed_quantity),
    ["10", "4"]
  );
  assert.equal(state.lineMessages.length, 1);
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
  assert.equal(submittedWorkerPayload?.vehicle_job_ref, job.vehicle_job_ref);
  assert.equal(submittedWorkerPayload?.market_job_ref, "MARKET-871");
  assert.equal(submittedWorkerPayload?.stall_job_ref, ticket.stall_job_ref);
  assert.equal(submittedWorkerPayload?.ticket_no, ticket.ticket_no);
  assert.equal(submittedWorkerPayload?.ticket_id, undefined);
  assert.equal(submittedWorkerPayload?.submission_id, undefined);
  assert.equal(submittedWorkerPayload?.vehicle_job_id, undefined);
  const submittedItems = submittedWorkerPayload?.items as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(submittedItems[0]).sort(), [
    "confirmed_quantity",
    "name",
    "product_ref",
    "product_type",
    "quantity",
    "unit",
  ]);
  assert.equal(submittedItems[0].ticket_id, undefined);

  const lineMessage = state.lineMessages[0] as {
    data?: {
      messages?: Array<{ text?: string }>;
    };
  };
  const lineText = lineMessage.data?.messages?.[0]?.text ?? "";
  const confirmPostback = response.body.debug_line_postback?.confirm;
  const rejectPostback = response.body.debug_line_postback?.reject;
  const confirmToken = /token=([^\s]+)/.exec(confirmPostback ?? "")?.[1];

  assert.match(lineText, /Confirm: action=vendor_confirm_completion&token=/);
  assert.equal(typeof confirmPostback, "string");
  assert.equal(typeof rejectPostback, "string");
  assert.match(confirmPostback, /^action=vendor_confirm_completion&token=/);
  assert.match(rejectPostback, /^action=vendor_reject_completion&token=/);
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
            data: confirmPostback,
          },
        },
      ],
    },
  });

  assert.equal(lineResponse.status, 200);
  assert.equal(lineResponse.body.processed, 1);
  assert.equal(ticket.status, "CLOSED");
  assert.equal(assignment.status, "COMPLETED");
  assert.equal(job.status, "COMPLETED");
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
  assert.equal(resultWorkerPayload?.vehicle_job_ref, job.vehicle_job_ref);
  assert.equal(resultWorkerPayload?.market_job_ref, "MARKET-871");
  assert.equal(resultWorkerPayload?.stall_job_ref, ticket.stall_job_ref);
  assert.equal(resultWorkerPayload?.ticket_no, ticket.ticket_no);
  assert.equal(resultWorkerPayload?.ticket_id, undefined);
  assert.equal(resultWorkerPayload?.submission_id, undefined);
  assert.equal(resultWorkerPayload?.vehicle_job_id, undefined);
  const resultItems = resultWorkerPayload?.items as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(resultItems[0]).sort(), [
    "confirmed_quantity",
    "name",
    "product_ref",
    "product_type",
    "quantity",
    "unit",
  ]);
  assert.equal(resultItems[0].ticket_id, undefined);

});

// Test endpoint complete ticket ว่า reject เมื่อส่งจำนวนสินค้าไม่ครบทุก product ใน ticket
test("POST /api/workers/me/tickets/:stallJobRef/complete rejects next stall before current stall closes", async () => {
  const { token, worker } = await loginWorker(73);
  const job = addDispatchableJob(873, 1);
  const currentTicket = addTicketForVehicleJob(job.id, 973);
  const nextTicket = addTicketForVehicleJob(job.id, 974);
  const assignment = addPendingAssignment(1073, job.id, worker.id);
  assignment.status = "SCANNED";
  nextTicket.status = "READY";
  const products = state.ticketProducts.filter(
    (product) => product.ticket_id === nextTicket.id
  );

  const response = await server.request("POST", `/api/workers/me/tickets/${nextTicket.stall_job_ref}/complete`, {
    token,
    body: {
      items: products.map((product) => ({
        product_ref: product.product_ref,
        confirmed_quantity: Number(product.quantity),
      })),
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "CURRENT_STALL_NOT_COMPLETED");
  assert.equal(response.body.current_stall_job_ref, currentTicket.stall_job_ref);
  assert.equal(nextTicket.status, "READY");
  assert.equal(state.lineMessages.length, 0);
});

test("POST /api/workers/me/tickets/:stallJobRef/complete rejects before all required workers check in", async () => {
  const { token, worker } = await loginWorker(74);
  const job = addDispatchableJob(874, 2);
  const ticket = addTicketForVehicleJob(job.id, 975);
  const assignment = addPendingAssignment(1074, job.id, worker.id);
  assignment.status = "SCANNED";
  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  const response = await server.request("POST", `/api/workers/me/tickets/${ticket.stall_job_ref}/complete`, {
    token,
    body: {
      items: products.map((product) => ({
        product_ref: product.product_ref,
        confirmed_quantity: Number(product.quantity),
      })),
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "WORKERS_NOT_CHECKED_IN");
  assert.equal(response.body.workers_required, 2);
  assert.equal(response.body.checked_in_count, 1);
  assert.equal(ticket.status, "IN_PROGRESS");
  assert.equal(state.lineMessages.length, 0);
});

test("POST /api/workers/me/tickets/:stallJobRef/complete rejects incomplete product quantities", async () => {
  // Step Arrange เตรียม worker ที่อยู่ใน ticket แต่ส่งสินค้าไม่ครบ
  const { token, worker } = await loginWorker(72);
  const job = addDispatchableJob(872, 1);
  const ticket = addTicketForVehicleJob(job.id, 972);
  const assignment = addPendingAssignment(1072, job.id, worker.id);
  assignment.status = "SCANNED";
  const [firstProduct] = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  // Step Act ส่งยอดมาแค่ product เดียว ทั้งที่ ticket มี 2 product
  const response = await server.request("POST", `/api/workers/me/tickets/${ticket.ticket_no}/complete`, {
    token,
    body: {
      items: [
        {
          product_ref: firstProduct.product_ref,
          confirmed_quantity: 10,
        },
      ],
    },
  });

  // Step Assert route reject ก่อนเปลี่ยน ticket เป็น waiting vendor confirm
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INCOMPLETE_TICKET_PRODUCTS");
  assert.equal(ticket.status, "IN_PROGRESS");
  assert.equal(state.lineMessages.length, 0);
});

test("break return marks worker offline when WebSocket is still disconnected", async () => {
  const { token, worker } = await loginWorker(106);
  const breakQueueName = process.env.BULLMQ_WORKER_BREAK_RETURN_QUEUE as string;
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

  assert.ok(breakReturnProcessor);
  await breakReturnProcessor({
    data: {
      accountId: worker.id,
      scheduleId: worker.id,
    },
  });

  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "offline");
  assert.equal(
    (state.notifications.at(-1) as { payload?: { reason?: string } })?.payload?.reason,
    "break_finished_not_available"
  );
});
