import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import * as sessionRepository from "./shared/session.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { prisma } from "../db/prisma";
import { createHash } from "crypto";
import type { WorkerPushToken } from "@prisma/client";
import { mapAccount, mapSession } from "./shared/mappers";
import { buildRevokeData, requireMapped, toId } from "./shared/repository-utils";

import type { DbConnection } from "../types/shared/common.type";
import type { PendingSessionInput, SessionDto } from "../types/auth.type";
import type { AccountDto } from "../types/admin-workers.type";
import type { PushPlatform, UpsertWorkerPushTokenInput, WorkerPushTokenDto } from "../types/notifications.type";

/* -------------------------------------- Config -------------------------------------- */

const PENDING_REFRESH_TOKEN_HASH = "";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา ตาม username จาก DB
async function findByUsername(
  username: string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const account = await (connection ?? prisma).account.findUnique({
    where: {
      username,
    },
  });

  return mapAccount(account);
}

const authAccountRepository = {
  ...accountRepository,
  findByUsername,
};

// Function สร้าง pending session data จาก DB
function buildPendingSessionData(session: PendingSessionInput) {
  return {
    accountId: session.account_id,
    refreshTokenHash: PENDING_REFRESH_TOKEN_HASH,
    deviceId: session.device_id,
    deviceName: session.device_name,
    ipAddress: session.ip_address ?? null,
    userAgent: session.user_agent ?? null,
    expiresAt: new Date(session.expires_at),
  };
}

// Function สร้าง refresh token hash data จาก DB
function buildRefreshTokenHashData(refreshTokenHash: string) {
  const updatedAt = new Date();

  return {
    refreshTokenHash,
    lastActiveAt: updatedAt,
    updatedAt,
  };
}

// Function ค้นหา active ตาม ID จาก DB
async function findActiveById(
  sessionId: number | string,
  connection?: DbConnection
): Promise<SessionDto | null> {
  return mapSession(
    await (connection ?? prisma).userSession.findFirst({
      where: {
        id: toId(sessionId),
        isActive: true,
        expiresAt: {
          gt: new Date(),
        },
      },
    })
  );
}

// Function สร้าง pending จาก DB
async function createPending(
  session: PendingSessionInput,
  connection?: DbConnection
): Promise<SessionDto> {
  return requireMapped(
    mapSession(
      await (connection ?? prisma).userSession.create({
        data: buildPendingSessionData(session),
      })
    ),
    "Session",
    "create"
  );
}

// Function อัปเดต refresh token hash จาก DB
async function updateRefreshTokenHash(
  sessionId: number | string,
  refreshTokenHash: string,
  connection?: DbConnection
): Promise<SessionDto> {
  return requireMapped(
    mapSession(
      await (connection ?? prisma).userSession.update({
        where: {
          id: toId(sessionId),
        },
        data: buildRefreshTokenHashData(refreshTokenHash),
      })
    ),
    "Session",
    "update"
  );
}

// Function เพิกถอน revoke จาก DB
async function revoke(
  sessionId: number | string,
  connection?: DbConnection
): Promise<SessionDto | null> {
  const db = connection ?? prisma;
  const activeSession = await db.userSession.findFirst({
    where: {
      id: toId(sessionId),
      isActive: true,
    },
  });

  if (!activeSession) {
    return null;
  }

  return mapSession(
    await db.userSession.update({
      where: {
        id: activeSession.id,
      },
      data: buildRevokeData(),
    })
  );
}

const authSessionRepository = {
  ...sessionRepository,
  findActiveById,
  createPending,
  updateRefreshTokenHash,
  revoke,
};

// Function จัดการ เป็น push token ISO string จาก DB
function toPushTokenIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// Function แปลงให้เป็นรูปแบบกลาง push platform จาก DB
function normalizePushPlatform(value?: string | null): PushPlatform {
  const platform = value?.trim().toLowerCase();

  if (platform === "android" || platform === "ios" || platform === "web") {
    return platform;
  }

  return "unknown";
}

// Function hash FCM token จาก DB
function hashFcmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Function แปลง worker push token จาก DB
function mapWorkerPushToken(record: WorkerPushToken): WorkerPushTokenDto {
  return {
    id: record.id,
    worker_code: record.workerCode,
    session_id: record.sessionId,
    device_id: record.deviceId,
    platform: normalizePushPlatform(record.platform),
    fcm_token: record.fcmToken,
    fcm_token_hash: record.fcmTokenHash,
    is_active: record.isActive,
    last_seen_at: record.lastSeenAt.toISOString(),
    revoked_at: toPushTokenIsoString(record.revokedAt),
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

// Function สร้างหรืออัปเดต worker push token จาก DB
async function upsertWorkerPushToken(
  input: UpsertWorkerPushTokenInput,
  connection?: DbConnection
): Promise<WorkerPushTokenDto> {
  const db = connection ?? prisma;
  const platform = normalizePushPlatform(input.platform);
  const now = new Date();
  const data = {
    workerCode: input.worker_code,
    sessionId: input.session_id ?? null,
    deviceId: input.device_id,
    platform,
    fcmToken: input.fcm_token,
    fcmTokenHash: hashFcmToken(input.fcm_token),
    isActive: true,
    revokedAt: null,
    lastSeenAt: now,
    updatedAt: now,
  };

  const record = await db.workerPushToken.upsert({
    where: {
      workerCode_deviceId_platform: {
        workerCode: input.worker_code,
        deviceId: input.device_id,
        platform,
      },
    },
    update: data,
    create: {
      ...data,
      createdAt: now,
    },
  });

  return mapWorkerPushToken(record);
}

// Function ดึงรายการ active push tokens ตาม WorkerCodes จาก DB
async function listActivePushTokensByWorkerCodes(
  workerCodes: string[],
  connection?: DbConnection
): Promise<WorkerPushTokenDto[]> {
  const uniqueWorkerCodes = [...new Set(workerCodes.filter(Boolean))];

  if (uniqueWorkerCodes.length === 0) {
    return [];
  }

  const records = await (connection ?? prisma).workerPushToken.findMany({
    where: {
      workerCode: {
        in: uniqueWorkerCodes,
      },
      isActive: true,
    },
  });

  return records.map(mapWorkerPushToken);
}

// Function เพิกถอน push tokens ตาม session ID จาก DB
async function revokePushTokensBySessionId(
  sessionId: number,
  connection?: DbConnection
): Promise<number> {
  const revokedAt = new Date();
  const result = await (connection ?? prisma).workerPushToken.updateMany({
    where: {
      sessionId,
      isActive: true,
    },
    data: {
      isActive: false,
      revokedAt,
      updatedAt: revokedAt,
    },
  });

  return result.count;
}

// Function เพิกถอน push tokens ตาม token hashes จาก DB
async function revokePushTokensByTokenHashes(
  fcmTokenHashes: string[],
  connection?: DbConnection
): Promise<number> {
  const uniqueHashes = [...new Set(fcmTokenHashes.filter(Boolean))];

  if (uniqueHashes.length === 0) {
    return 0;
  }

  const revokedAt = new Date();
  const result = await (connection ?? prisma).workerPushToken.updateMany({
    where: {
      fcmTokenHash: {
        in: uniqueHashes,
      },
      isActive: true,
    },
    data: {
      isActive: false,
      revokedAt,
      updatedAt: revokedAt,
    },
  });

  return result.count;
}

const authWorkerPushTokenRepository = {
  upsertWorkerPushToken,
  listActiveTokensByWorkerCodes: listActivePushTokensByWorkerCodes,
  revokeBySessionId: revokePushTokensBySessionId,
  revokeByTokenHashes: revokePushTokensByTokenHashes,
};

export {
  authAccountRepository as accountRepository,
  profileRepository,
  authSessionRepository as sessionRepository,
  authWorkerPushTokenRepository as workerPushTokenRepository,
  workScheduleRepository,
};
