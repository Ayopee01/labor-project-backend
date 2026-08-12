import * as accountRepository from "./shared/account.repository";
import * as sessionRepository from "./shared/session.repository";
import { mapAccount, mapSession } from "./shared/mappers";
import {
  buildRevokeData,
  client,
  requireMapped,
  toId,
} from "./shared/repository-utils";

import type { DbConnection } from "../types/shared/common.type";
import type { PendingSessionInput, SessionDto } from "../types/auth.type";
import type { AccountDto } from "../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

const PENDING_REFRESH_TOKEN_HASH = "";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา account ตาม username จาก DB
async function findByUsername(
  username: string,
  connection?: DbConnection,
): Promise<AccountDto | null> {
  const account = await client(connection).account.findUnique({
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

// Function ค้นหา active session ตาม ID จาก DB
async function findActiveById(
  sessionId: number | string,
  connection?: DbConnection,
): Promise<SessionDto | null> {
  return mapSession(
    await client(connection).userSession.findFirst({
      where: {
        id: toId(sessionId),
        isActive: true,
        expiresAt: {
          gt: new Date(),
        },
      },
    }),
  );
}

// Function สร้าง pending session จาก DB
async function createPending(
  session: PendingSessionInput,
  connection?: DbConnection,
): Promise<SessionDto> {
  return requireMapped(
    mapSession(
      await client(connection).userSession.create({
        data: buildPendingSessionData(session),
      }),
    ),
    "Session",
    "create",
  );
}

// Function อัปเดต refresh token hash จาก DB
async function updateRefreshTokenHash(
  sessionId: number | string,
  refreshTokenHash: string,
  connection?: DbConnection,
): Promise<SessionDto> {
  return requireMapped(
    mapSession(
      await client(connection).userSession.update({
        where: {
          id: toId(sessionId),
        },
        data: buildRefreshTokenHashData(refreshTokenHash),
      }),
    ),
    "Session",
    "update",
  );
}

// Function revoke active session จาก DB
async function revoke(
  sessionId: number | string,
  connection?: DbConnection,
): Promise<SessionDto | null> {
  const db = client(connection);
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
    }),
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
  authSessionRepository as sessionRepository,
};
