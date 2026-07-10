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

const PENDING_REFRESH_TOKEN_HASH = "";

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

function buildRefreshTokenHashData(refreshTokenHash: string) {
  const updatedAt = new Date();

  return {
    refreshTokenHash,
    lastActiveAt: updatedAt,
    updatedAt,
  };
}

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

export {
  authAccountRepository as accountRepository,
  profileRepository,
  authSessionRepository as sessionRepository,
  workScheduleRepository,
};
