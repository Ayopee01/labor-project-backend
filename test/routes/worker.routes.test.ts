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

test("GET /api/workers/me/status returns worker profile and shift", async () => {
  const { token, worker } = await loginWorker(102);

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
    "work_start_date",
    "worker_code",
  ]);
  assert.equal(response.body.full_name, worker.full_name);
  assert.equal(response.body.worker_code, `W${worker.id}`);
  assert.equal(response.body.image_url, null);
  assert.equal(response.body.nationality, "Thai");
  assert.equal(response.body.work_start_date, "2026-01-01");
  assert.equal(response.body.phone, worker.phone);
  assert.equal(typeof response.body.shift.name, "string");
  assert.equal(response.body.shift.start_time, "00:00");
  assert.equal(response.body.shift.end_time, "23:59");
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
test("POST /api/workers/me/assignments/:id/accept accepts pending assignment", async () => {
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
    "stall_name",
  ]);
  assert.equal(response.body.markets[0].stalls[0].product_count, 2);
  assert.deepEqual(Object.keys(response.body.markets[0].stalls[0].products[0]).sort(), [
    "name",
    "quantity",
    "unit",
  ]);
  assert.equal(response.body.markets[0].stalls[0].products[0].name, "Apple");
});

// Test endpoint accept assignment ว่า accept ช้าเกิน deadline จะ timeout และ requeue worker ที่ยัง online
test("POST /api/workers/me/assignments/:id/accept times out late accept and requeues connected worker", async () => {
  // Step Arrange assignment หมดเวลาแล้ว แต่ worker ยัง connected
  const { token, worker } = await loginWorker(52);
  state.connectedWorkers.add(worker.id);
  addPendingAssignment(952, 852, worker.id, -1000);

  // Step Act กดรับงานช้าเกิน deadline
  const response = await server.request("POST", "/api/workers/me/assignments/952/accept", {
    token,
  });

  // Step Assert ได้ ASSIGNMENT_TIMEOUT และ worker กลับเข้า queue เป็น ready
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "ASSIGNMENT_TIMEOUT");
  assert.equal(state.assignments[0].status, "TIMEOUT");
  assert.equal((await workerQueue.getWorkerQueueStatus(worker.id))?.status, "ready");
});

// Test endpoint check-in QR ว่า worker scan QR ถูกต้องแล้ว assignment ไปสถานะ SCANNED
test("POST /api/workers/me/assignments/:id/check-in-qr scans correct QR", async () => {
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
  assert.equal(response.body.status, "SCANNED");
  assert.equal(job.status, "IN_PROGRESS");
});

// Test endpoint check-in QR ว่า worker scan QR ผิดต้องถูก reject
test("POST /api/workers/me/assignments/:id/check-in-qr rejects wrong QR", async () => {
  // Step Arrange เตรียม assignment ที่รับงานแล้ว
  const { token, worker } = await loginWorker(62);
  const job = addDispatchableJob(862, 1);
  const assignment = addPendingAssignment(962, job.id, worker.id);
  assignment.status = "ACCEPTED";

  // Step Act scan QR ผิด
  const response = await server.request("POST", "/api/workers/me/assignments/962/check-in-qr", {
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

/* -------------------------------------- Worker Ticket Route Tests -------------------------------------- */

// Test endpoint complete ticket ว่า worker ส่งจำนวนสินค้าได้ครบและ ticket รอ vendor confirm
test("POST /api/workers/me/tickets/:id/complete submits quantities for vendor confirmation", async () => {
  // Step Arrange เตรียม worker ที่ scan แล้ว, ticket และสินค้า
  const { token, worker } = await loginWorker(71);
  const job = addDispatchableJob(871, 1);
  const ticket = addTicketForVehicleJob(job.id, 971);
  const assignment = addPendingAssignment(1071, job.id, worker.id);
  assignment.status = "SCANNED";
  assignment.scanned_at = new Date().toISOString();
  const products = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  // Step Act ส่งยอดสินค้าครบทุก product ผ่าน endpoint worker
  const response = await server.request("POST", `/api/workers/me/tickets/${ticket.id}/complete`, {
    token,
    body: {
      items: products.map((product, index) => ({
        ticket_product_id: product.id,
        confirmed_quantity: index === 0 ? 10 : 4,
      })),
    },
  });

  // Step Assert ticket รอ vendor confirm และมี LINE/realtime event ถูกส่งออก
  assert.equal(response.status, 200);
  assert.equal(response.body.ticket.status, "WAITING_VENDOR_CONFIRM");
  assert.equal(response.body.ticket.confirmation_status, "WAITING_VENDOR_CONFIRM");
  assert.deepEqual(
    response.body.products.map((product: { confirmed_quantity: string | null }) => product.confirmed_quantity),
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
});

// Test endpoint complete ticket ว่า reject เมื่อส่งจำนวนสินค้าไม่ครบทุก product ใน ticket
test("POST /api/workers/me/tickets/:id/complete rejects incomplete product quantities", async () => {
  // Step Arrange เตรียม worker ที่อยู่ใน ticket แต่ส่งสินค้าไม่ครบ
  const { token, worker } = await loginWorker(72);
  const job = addDispatchableJob(872, 1);
  const ticket = addTicketForVehicleJob(job.id, 972);
  const assignment = addPendingAssignment(1072, job.id, worker.id);
  assignment.status = "SCANNED";
  const [firstProduct] = state.ticketProducts.filter((product) => product.ticket_id === ticket.id);

  // Step Act ส่งยอดมาแค่ product เดียว ทั้งที่ ticket มี 2 product
  const response = await server.request("POST", `/api/workers/me/tickets/${ticket.id}/complete`, {
    token,
    body: {
      items: [
        {
          ticket_product_id: firstProduct.id,
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
