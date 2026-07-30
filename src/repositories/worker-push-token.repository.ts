import { createHash } from "crypto";
import type { WorkerPushToken } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { DbConnection } from "../types/common.type";
import type { PushPlatform, UpsertWorkerPushTokenInput, WorkerPushTokenDto } from "../types/push-notification.type";

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function normalizePushPlatform(value?: string | null): PushPlatform {
  const platform = value?.trim().toLowerCase();

  if (platform === "android" || platform === "ios" || platform === "web") {
    return platform;
  }

  return "unknown";
}

export function hashFcmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
    revoked_at: toIsoString(record.revokedAt),
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export async function upsertWorkerPushToken(
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

export async function listActiveTokensByWorkerCodes(
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

export async function revokeBySessionId(
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

export async function revokeByTokenHashes(
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
