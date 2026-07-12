// import Library
import type { IncomingMessage } from "http";
import type { Server } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";

// import
import { accountRepository } from "../repositories/worker-application.repository";
import { findActiveByIdAndAccountId } from "../repositories/shared/session.repository";
import { findCurrentAssignmentByWorker } from "../repositories/shared/vehicle-job-assignment.repository";
import { getWorkerQueueStatus, markWorkerOffline, recordWorkerHeartbeat } from "../queues/worker-queue";
import { publishNotification } from "../services/notifications.service";

// import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { WorkerSocketEvent, WorkerSocketEventType } from "../types/worker.type";

// import Utils
import ApiError from "../utils/api-error";
import { verifyAccessToken } from "../utils/jwt";

/* -------------------------------------- Config -------------------------------------- */

const WORKER_SOCKET_PATH = "/ws/workers";
const WORKER_SOCKET_DISCONNECT_GRACE_MS = Number(
  process.env.WORKER_SOCKET_DISCONNECT_GRACE_MS || 15000
);

/* -------------------------------------- Types -------------------------------------- */

type WorkerSocket = WebSocket & {
  accountId?: number;
  isAlive?: boolean;
};

type WorkerSocketPayload = Record<string, unknown>;

/* -------------------------------------- State -------------------------------------- */

const workerSockets = new Map<number, Set<WorkerSocket>>();
const disconnectTimers = new Map<number, NodeJS.Timeout>();

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง token จาก query หรือ header ของ WebSocket upgrade request
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

// Function ตรวจ access token และ session ก่อนยอมให้ worker เปิด socket
async function authenticateWorkerSocket(
  request: IncomingMessage
): Promise<AccessTokenPayload> {
  const payload = verifyAccessToken(getSocketToken(request));

  if (payload.role !== "worker") {
    throw new ApiError(403, "FORBIDDEN", "Worker account is required.");
  }

  const [account, session] = await Promise.all([
    accountRepository.findUserById(payload.account_id),
    findActiveByIdAndAccountId(payload.session_id, payload.account_id),
  ]);

  if (!account || account.status !== "active") {
    throw new ApiError(403, "WORKER_NOT_ACTIVE", "Worker account is not active.");
  }

  if (!session) {
    throw new ApiError(401, "SESSION_REVOKED", "Worker session is not active.");
  }

  return payload;
}

// Function ส่ง WebSocket HTTP error ตอน upgrade ไม่ผ่าน
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

// Function เพิ่ม socket เข้า registry ของ worker
function registerWorkerSocket(accountId: number, socket: WorkerSocket): void {
  const sockets = workerSockets.get(accountId) ?? new Set<WorkerSocket>();
  const disconnectTimer = disconnectTimers.get(accountId);

  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimers.delete(accountId);
  }

  socket.accountId = accountId;
  socket.isAlive = true;
  sockets.add(socket);
  workerSockets.set(accountId, sockets);
}

// Function ลบ socket ออกจาก registry และตั้ง grace period ก่อน mark offline
function unregisterWorkerSocket(socket: WorkerSocket): void {
  const accountId = socket.accountId;

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

// Function จัดการ worker หลุดเกิน grace period ตาม policy ready/no assignment -> offline
async function handleWorkerSocketGraceExpired(accountId: number): Promise<void> {
  disconnectTimers.delete(accountId);

  if (isWorkerSocketConnected(accountId)) {
    return;
  }

  const [assignment, queueEntry] = await Promise.all([
    findCurrentAssignmentByWorker(accountId),
    getWorkerQueueStatus(accountId),
  ]);

  if (!assignment && queueEntry?.status === "ready") {
    const latestQueue = await markWorkerOffline(accountId);
    sendWorkerSocketEvent(accountId, "WORKER_STATUS_CHANGED", {
      queue: latestQueue,
      reason: "socket_disconnected",
    });
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker offline",
      message: `Worker ${accountId} was marked offline because WebSocket disconnected.`,
      payload: {
        worker_account_id: accountId,
        queue: latestQueue,
        reason: "socket_disconnected",
      },
      audience: {
        roles: ["admin"],
      },
    });
  }
}

// Function ส่ง event ไปยัง socket ทั้งหมดของ worker คนนั้น
export function sendWorkerSocketEvent(
  accountId: number,
  type: WorkerSocketEventType,
  payload: WorkerSocketPayload = {}
): boolean {
  const sockets = workerSockets.get(accountId);

  if (!sockets || sockets.size === 0) {
    return false;
  }

  const event: WorkerSocketEvent = {
    type,
    payload,
    occurred_at: new Date().toISOString(),
  };
  const message = JSON.stringify(event);

  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }

  return true;
}

// Function ตรวจว่า worker ยังมี socket connected อยู่หรือไม่
export function isWorkerSocketConnected(accountId: number): boolean {
  const sockets = workerSockets.get(accountId);

  if (!sockets) {
    return false;
  }

  return Array.from(sockets).some((socket) => socket.readyState === WebSocket.OPEN);
}

// Function ตั้ง WebSocket server สำหรับ Worker Mobile
export function setupWorkerWebSocket(server: Server): void {
  const webSocketServer = new WebSocketServer({
    noServer: true,
  });

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
      void recordWorkerHeartbeat(auth.account_id);
      sendWorkerSocketEvent(auth.account_id, "WORKER_CONNECTED", {
        account_id: auth.account_id,
      });

      socket.on("pong", () => {
        socket.isAlive = true;
        if (socket.accountId) {
          void recordWorkerHeartbeat(socket.accountId);
        }
      });

      socket.on("close", () => {
        unregisterWorkerSocket(socket);
      });
    }
  );

  setInterval(() => {
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
