// Import Library
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";

// Import Dependencies
import * as masterWorkerRepository from "../repositories/shared/master-worker.repository";
import { findActiveById as findActiveWorkerSessionById } from "../repositories/shared/worker-session.repository";
import { findCurrentAssignmentByWorker } from "../repositories/shared/vehicle-job-assignment.repository";
import { clearWorkerPresence, getWorkerQueueStatus, recordWorkerHeartbeat } from "../queues/worker-queue";
import { buildWorkerNotification, persistWorkerNotification, publishNotification } from "../services/notifications.service";
import { sendWorkerPushNotificationByWorkerIds } from "../services/shared/worker-push.service";
import { toPascalCasePayload } from "../middlewares/api-case.middleware";

// Import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { WorkerSocket, WorkerSocketEventOptions, WorkerSocketEventType, WorkerSocketPayload } from "../types/worker.type";

// Import Utils
import ApiError from "../utils/api-error";
import { verifyAccessToken } from "../utils/jwt";
import { logger } from "../utils/logger";
import { buildWorkerQueueSocketPayload } from "../utils/worker-payload";

/* -------------------------------------- Config -------------------------------------- */

const WORKER_SOCKET_PATH = "/ws/workers";

// Config grace period before reporting a Worker socket disconnect
const configuredWorkerSocketDisconnectGraceMs = Number(
  process.env.WORKER_SOCKET_DISCONNECT_GRACE_MS
);
const WORKER_SOCKET_DISCONNECT_GRACE_MS =
  Number.isFinite(configuredWorkerSocketDisconnectGraceMs) &&
  configuredWorkerSocketDisconnectGraceMs > 0
    ? configuredWorkerSocketDisconnectGraceMs
    : 15000;

/* -------------------------------------- State -------------------------------------- */

// State stores Worker sockets for the current instance
const workerSockets = new Map<number, Set<WorkerSocket>>();

const disconnectTimers = new Map<number, NodeJS.Timeout>();
let workerWebSocketServer: WebSocketServer | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

// Config event ของ Worker WebSocket ที่ต้องส่ง FCM push เพิ่มด้วย
const PUSH_WORKER_SOCKET_EVENTS = new Set<WorkerSocketEventType>([
  "WORKER_ASSIGNED",
  "ASSIGNMENT_TIMEOUT",
  "ASSIGNMENT_CANCELLED",
  "TEAM_READY",
  "ASSIGNMENT_SCAN_DEADLINE_EXTENDED",
  "ASSIGNMENT_SCAN_DEADLINE_SHORTENED",
  "TICKET_COMPLETION_SUBMITTED",
  "TICKET_COMPLETION_RESULT",
  "STALL_JOB_CANCELLED",
  "MARKET_JOB_CANCELLED",
  "VEHICLE_JOB_CANCELLED",
]);

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง socket token ใน Worker WebSocket
function getSocketToken(request: IncomingMessage): string {
  const url = new URL(request.url || "", "http://localhost");
  const queryToken = url.searchParams.get("token");

  if (queryToken) {
    return queryToken;
  }

  const authorization = request.headers.authorization;

  if (authorization) {
    const [scheme, token] = authorization.split(" ");

    if (scheme === "Bearer" && token) {
      return token;
    }
  }

  const protocol = request.headers["sec-websocket-protocol"];
  const protocolValue = Array.isArray(protocol) ? protocol[0] : protocol;
  const protocolToken = protocolValue
    ?.split(",")
    .map((value: string) => value.trim())
    .find((value: string) => value.startsWith("token."));

  if (protocolToken) {
    return protocolToken.replace("token.", "");
  }

  throw new ApiError(401, "INVALID_TOKEN", "Worker WebSocket token is required.");
}

// Function จัดการ authenticate worker socket ใน Worker WebSocket
async function authenticateWorkerSocket(
  request: IncomingMessage
): Promise<AccessTokenPayload> {
  const payload = verifyAccessToken(getSocketToken(request));

  if (payload.role !== "worker") {
    throw new ApiError(403, "FORBIDDEN", "Worker account is required.");
  }

  const [worker, session] = await Promise.all([
    masterWorkerRepository.findById(payload.account_id),
    findActiveWorkerSessionById(payload.session_id),
  ]);

  if (!worker || worker.status !== 1) {
    throw new ApiError(403, "WORKER_NOT_ACTIVE", "Worker account is not active.");
  }

  if (!session || session.account_id !== payload.account_id) {
    throw new ApiError(401, "SESSION_REVOKED", "Worker session is not active.");
  }

  return payload;
}

// Function ตีกลับ socket upgrade ใน Worker WebSocket
function rejectSocketUpgrade(
  socket: Duplex,
  statusCode: number,
  message: string
): void {
  socket.write(
    [
      `HTTP/1.1 ${statusCode} ${message}`,
      "Connection: close",
      "Content-Type: text/plain",
      "",
      message,
    ].join("\r\n")
  );
  socket.destroy();
}

// Function จัดการ register worker socket ใน Worker WebSocket
function registerWorkerSocket(accountId: number, socket: WorkerSocket): void {
  const sockets = workerSockets.get(accountId) ?? new Set<WorkerSocket>();
  const disconnectTimer = disconnectTimers.get(accountId);

  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimers.delete(accountId);
  }

  socket.workerId = accountId;
  socket.isAlive = true;
  sockets.add(socket);
  workerSockets.set(accountId, sockets);
}

// Function ลบ socket ออกจาก registry และเริ่ม grace period ก่อนประกาศว่า disconnected
function unregisterWorkerSocket(socket: WorkerSocket): void {
  const accountId = socket.workerId;

  if (!accountId) {
    return;
  }

  const sockets = workerSockets.get(accountId);
  sockets?.delete(socket);

  if (sockets && sockets.size > 0) {
    return;
  }

  workerSockets.delete(accountId);

  const timer = setTimeout(() => {
    void handleWorkerSocketGraceExpired(accountId);
  }, WORKER_SOCKET_DISCONNECT_GRACE_MS);

  disconnectTimers.set(accountId, timer);
}

// Function สร้าง + กระจาย WORKER_CONNECTION_CHANGED ไปหา admin ใน service flow — ใช้ร่วมกันทั้งตอน
// connect, disconnect ตามธรรมชาติ (หลัง grace period), และ force-disconnect (logout/admin revoke)
async function publishWorkerConnectionChanged(
  accountId: number,
  connected: boolean,
  reason: string,
): Promise<void> {
  const [assignment, queueEntry, worker] = await Promise.all([
    findCurrentAssignmentByWorker(accountId),
    getWorkerQueueStatus(accountId),
    masterWorkerRepository.findById(accountId).catch((error: unknown) => {
      logger.error("Failed to load worker profile for WebSocket connection event.", { error });
      return null;
    }),
  ]);

  const workerCode = worker?.labor_code ?? null;

  publishNotification({
    type: "WORKER_CONNECTION_CHANGED",
    title: connected ? "Worker socket connected" : "Worker socket disconnected",
    message: `Worker ${workerCode ?? accountId} socket ${connected ? "connected" : "disconnected"}.`,
    payload: {
      worker_code: workerCode,
      socket_connected: connected,
      queue: queueEntry ? buildWorkerQueueSocketPayload(queueEntry, workerCode, assignment) : null,
      assignment_status: assignment?.status ?? null,
      reason,
    },
    audience: {
      roles: ["admin"],
    },
  });
}

// Function จัดการ socket worker หลุดหลังหมด grace โดยไม่เปลี่ยนสถานะคิวงาน
async function handleWorkerSocketGraceExpired(accountId: number): Promise<void> {
  disconnectTimers.delete(accountId);

  if (isWorkerSocketConnected(accountId)) {
    return;
  }

  await publishWorkerConnectionChanged(accountId, false, "socket_disconnected");
}

// Function ตัดการเชื่อมต่อ socket ของ worker คนหนึ่งจากฝั่ง server ทันที ใน Worker WebSocket — ใช้ตอน
// session ถูก revoke แบบชัดเจน (logout/admin revoke) เพื่อให้ admin เห็นว่า worker หลุดการเชื่อมต่อทันที
// ไม่ต้องรอ grace period 15 วิที่ออกแบบไว้กันกรณีเน็ตกระตุกเท่านั้น
export async function disconnectWorkerSocket(
  accountId: number,
  reason: string,
): Promise<void> {
  const sockets = workerSockets.get(accountId);

  if (sockets && sockets.size > 0) {
    for (const socket of sockets) {
      // เคลียร์ workerId ก่อนปิด กัน close handler เดิม (unregisterWorkerSocket) ไปตั้ง grace timer ซ้ำ
      // ซึ่งจะ publish WORKER_CONNECTION_CHANGED ซ้ำอีกรอบตอน 15 วิให้หลัง
      socket.workerId = undefined;
      socket.close();
    }
    workerSockets.delete(accountId);
  }

  const timer = disconnectTimers.get(accountId);

  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(accountId);
  }

  await clearWorkerPresence(accountId);
  await publishWorkerConnectionChanged(accountId, false, reason);
}

// Function ส่ง worker socket event ใน Worker WebSocket
export function sendWorkerSocketEvent(
  accountId: number,
  type: WorkerSocketEventType,
  payload: WorkerSocketPayload = {},
  options: WorkerSocketEventOptions = {}
): boolean {
  const sockets = workerSockets.get(accountId);
  const shouldPush = options.push ?? PUSH_WORKER_SOCKET_EVENTS.has(type);
  const hasSockets = Boolean(sockets && sockets.size > 0);
  const fallbackTitle = options.fallbackTitle ?? buildWorkerPushTitle(type);
  const fallbackMessage = options.fallbackMessage ?? buildWorkerPushMessage(type, payload);

  void masterWorkerRepository.findById(accountId).then((worker) => {
    const localized = buildWorkerNotification({
      type,
      lang: worker?.lang,
      notification_key: options.notificationKey,
      notification_params: options.notificationParams,
      payload,
      fallbackTitle,
      fallbackMessage,
    });
    const notification = {
      key: localized.key,
      lang: localized.lang,
      title: localized.title,
      message: localized.message,
    };

    if (shouldPush) {
      persistWorkerNotification({
        worker_id: accountId,
        type,
        notification_key: localized.key,
        lang: localized.lang,
        title: localized.title,
        message: localized.message,
        payload,
      });

      void sendWorkerPushNotificationByWorkerIds({
        worker_ids: [accountId],
        type,
        title: fallbackTitle,
        message: fallbackMessage,
        notification_key: localized.key,
        notification_params: options.notificationParams,
        payload,
      }).catch((error: unknown) => {
        logger.error("Failed to send worker push notification.", { error });
      });
    }

    if (!sockets || sockets.size === 0) {
      return;
    }

    const event = toPascalCasePayload({
      type,
      notification,
      payload,
      occurred_at: new Date().toISOString(),
    });
    const message = JSON.stringify(event);

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }).catch((error: unknown) => {
    logger.error("Failed to send worker socket event.", { error });
  });

  return hasSockets;
}

// Function สร้าง title ของ FCM notification ให้ตรงกับชนิด event จาก Worker WebSocket
function buildWorkerPushTitle(type: WorkerSocketEventType): string {
  switch (type) {
    case "WORKER_ASSIGNED":
      return "New assignment";
    case "ASSIGNMENT_TIMEOUT":
      return "Assignment timed out";
    case "ASSIGNMENT_CANCELLED":
    case "STALL_JOB_CANCELLED":
    case "MARKET_JOB_CANCELLED":
    case "VEHICLE_JOB_CANCELLED":
      return "Assignment cancelled";
    case "TEAM_READY":
      return "Team ready";
    case "ASSIGNMENT_SCAN_DEADLINE_EXTENDED":
      return "Scan deadline extended";
    case "ASSIGNMENT_SCAN_DEADLINE_SHORTENED":
      return "Scan deadline updated";
    case "TICKET_COMPLETION_SUBMITTED":
      return "Ticket submitted";
    case "TICKET_COMPLETION_RESULT":
      return "Ticket result updated";
    case "SESSION_REVOKED":
      return "Signed in on another device";
    default:
      return "Worker notification";
  }
}

// Function สร้าง body ของ FCM notification โดยเก็บรายละเอียดไว้ใน payload
function buildWorkerPushMessage(
  type: WorkerSocketEventType,
  payload: WorkerSocketPayload
): string {
  const ticketNumber = typeof payload.ticketNumber === "string" ? payload.ticketNumber : null;

  switch (type) {
    case "WORKER_ASSIGNED":
      return ticketNumber
        ? `You have a new assignment for ticket ${ticketNumber}.`
        : "You have a new assignment.";
    case "ASSIGNMENT_TIMEOUT":
      return "Your assignment deadline has expired.";
    case "ASSIGNMENT_CANCELLED":
    case "STALL_JOB_CANCELLED":
    case "MARKET_JOB_CANCELLED":
    case "VEHICLE_JOB_CANCELLED":
      return ticketNumber
        ? `Assignment ${ticketNumber} was cancelled.`
        : "Your assignment was cancelled.";
    case "TEAM_READY":
      return "Your whole team has checked in. You can start working now.";
    case "ASSIGNMENT_SCAN_DEADLINE_EXTENDED":
      return "Your QR scan deadline was extended.";
    case "ASSIGNMENT_SCAN_DEADLINE_SHORTENED":
      return "Please scan QR before the updated deadline.";
    case "TICKET_COMPLETION_SUBMITTED":
      return "Ticket completion is waiting for vendor confirmation.";
    case "TICKET_COMPLETION_RESULT":
      return "Vendor confirmation result is available.";
    case "SESSION_REVOKED":
      return "This session was signed out because login was confirmed on another device.";
    default:
      return "A worker notification is available.";
  }
}

// Function ตรวจว่า worker socket connected ใน Worker WebSocket
export function isWorkerSocketConnected(accountId: number): boolean {
  const sockets = workerSockets.get(accountId);

  if (!sockets) {
    return false;
  }

  return Array.from(sockets).some((socket) => socket.readyState === WebSocket.OPEN);
}

// Function จัดการหลัง Worker socket เชื่อมต่อสำเร็จและอัปเดต presence
async function handleWorkerSocketConnected(accountId: number): Promise<void> {
  await recordWorkerHeartbeat(accountId);

  const worker = await masterWorkerRepository.findById(accountId).catch((error: unknown) => {
    logger.error("Failed to load worker profile for WebSocket connection.", { error });
    return null;
  });
  const workerCode = worker?.labor_code ?? null;

  sendWorkerSocketEvent(accountId, "WORKER_CONNECTED", {
    worker_code: workerCode,
  });

  await publishWorkerConnectionChanged(accountId, true, "socket_connected");
}

// Function ตั้งค่า worker web socket ใน Worker WebSocket
export function setupWorkerWebSocket(server: Server): void {
  const webSocketServer = new WebSocketServer({
    noServer: true,
  });
  workerWebSocketServer = webSocketServer;

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");

    if (url.pathname !== WORKER_SOCKET_PATH) {
      rejectSocketUpgrade(socket, 404, "WebSocket Not Found");
      return;
    }

    authenticateWorkerSocket(request)
      .then((auth) => {
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          webSocketServer.emit("connection", webSocket, request, auth);
        });
      })
      .catch((error) => {
        const statusCode = error instanceof ApiError ? error.statusCode : 401;
        rejectSocketUpgrade(socket, statusCode, "WebSocket Unauthorized");
      });
  });

  webSocketServer.on(
    "connection",
    (socket: WorkerSocket, _request: IncomingMessage, auth: AccessTokenPayload) => {
      registerWorkerSocket(auth.account_id, socket);
      void handleWorkerSocketConnected(auth.account_id);

      socket.on("pong", () => {
        socket.isAlive = true;
        if (socket.workerId) {
          void recordWorkerHeartbeat(socket.workerId);
        }
      });

      socket.on("close", () => {
        unregisterWorkerSocket(socket);
      });
    }
  );

  heartbeatInterval = setInterval(() => {
    webSocketServer.clients.forEach((socket) => {
      const workerSocket = socket as WorkerSocket;

      if (workerSocket.isAlive === false) {
        workerSocket.terminate();
        return;
      }

      workerSocket.isAlive = false;
      workerSocket.ping();
    });
  }, 30000);
}

export function closeWorkerWebSocketServer(): Promise<void> {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  for (const timer of disconnectTimers.values()) {
    clearTimeout(timer);
  }
  disconnectTimers.clear();

  const server = workerWebSocketServer;
  workerWebSocketServer = null;

  if (!server) {
    return Promise.resolve();
  }

  server.clients.forEach((socket) => socket.close());

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
