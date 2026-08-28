import type { Prisma } from "@prisma/client";

// Import Mappers
import { mapSession } from "./mappers";
import { buildRevokeData, client, toId } from "./repository-utils";

// Import Types
import type { SessionDto } from "../../types/auth.type";
import type { DbConnection } from "../../types/shared/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง active session where จาก DB
function buildActiveSessionWhere(
  where: Prisma.UserSessionWhereInput = {}
): Prisma.UserSessionWhereInput {
  return {
    ...where,
    isActive: true,
    expiresAt: {
      gt: new Date(),
    },
  };
}

// Function ค้นหา active ตาม account ID จาก DB
export async function findActiveByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<SessionDto | null> {
  return mapSession(
    await client(connection).userSession.findFirst({
      where: buildActiveSessionWhere({
        accountId: toId(accountId),
      }),
      orderBy: {
        id: "desc",
      },
    })
  );
}

// Function ค้นหา active ตาม ID และ account ID จาก DB
export async function findActiveByIdAndAccountId(
  sessionId: number | string,
  accountId: number | string,
  connection?: DbConnection
): Promise<SessionDto | null> {
  return mapSession(
    await client(connection).userSession.findFirst({
      where: buildActiveSessionWhere({
        id: toId(sessionId),
        accountId: toId(accountId),
      }),
    })
  );
}

// Function เพิกถอน active ตาม account ID จาก DB
export async function revokeActiveByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<void> {
  await client(connection).userSession.updateMany({
    where: {
      accountId: toId(accountId),
      isActive: true,
    },
    data: buildRevokeData(),
  });
}

// Function เพิกถอน active ตาม account ID except จาก DB
export async function revokeActiveByAccountIdExcept(
  accountId: number | string,
  exceptSessionId: number | string,
  connection?: DbConnection
): Promise<void> {
  await client(connection).userSession.updateMany({
    where: {
      accountId: toId(accountId),
      id: {
        not: toId(exceptSessionId),
      },
      isActive: true,
    },
    data: buildRevokeData(),
  });
}
