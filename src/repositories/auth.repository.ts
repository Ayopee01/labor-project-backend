// Repository facade สำหรับ Swagger tag: Auth
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import * as sessionRepository from "./shared/session.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { prisma } from "../db/prisma";
import { mapAccount, mapSession } from "./shared/mappers";
import { buildRevokeData, requireMapped, toId } from "./shared/repository-utils";

import type { DbConnection } from "../types/common.type";
import type { PendingSessionInput, SessionDto } from "../types/auth.type";
import type { AccountDto } from "../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

// Config ค่า placeholder ก่อน update refresh token hash จริงหลังสร้าง session
const PENDING_REFRESH_TOKEN_HASH = "";

/* -------------------------------------- Functions -------------------------------------- */

// Function หา account จาก username สำหรับ flow login
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

// Function รวม account repository ของ Auth พร้อม method login ด้วย username
const authAccountRepository = {
  ...accountRepository,
  findByUsername,
};

// Function สร้างข้อมูล session เริ่มต้นก่อนมี refresh token hash จริง
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

// Function สร้างข้อมูลอัปเดต refresh token hash และเวลาใช้งานล่าสุด
function buildRefreshTokenHashData(refreshTokenHash: string) {
  const updatedAt = new Date();

  return {
    refreshTokenHash,
    lastActiveAt: updatedAt,
    updatedAt,
  };
}

// Function หา session active จาก id และตรวจว่ายังไม่หมดอายุ
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

// Function สร้าง session pending เพื่อรออัปเดต refresh token hash
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

// Function อัปเดต hash ของ refresh token หลังออก token แล้ว
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

// Function revoke session ถ้ายัง active อยู่
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

// Function รวม session repository ของ Auth พร้อม method ออกและ revoke token
const authSessionRepository = {
  ...sessionRepository,
  findActiveById,
  createPending,
  updateRefreshTokenHash,
  revoke,
};

export {
  authAccountRepository as accountRepository,
  profileRepository,
  authSessionRepository as sessionRepository,
  workScheduleRepository,
};
