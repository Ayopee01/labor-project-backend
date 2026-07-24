import type { Prisma } from "@prisma/client";

// import Mapper
import { mapSession } from "./mappers";
import { buildRevokeData, client, toId } from "./repository-utils";

// import Types
import type { SessionDto } from "../../types/auth.type";
import type { DbConnection } from "../../types/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง where condition สำหรับหา session ที่ยัง active และยังไม่หมดอายุ
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

// Function ค้นหา session active ล่าสุดของ account ใช้ร่วมกับ Auth และ Admin Workers
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

// Function ค้นหา session active จาก id และ account ใช้กับ WebSocket auth
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

// Function revoke session active ทั้งหมดของ account ใช้ร่วมกับ Admin Workers และ Admin Settings
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

// Function revoke session active อื่นของ account โดยคง session ปัจจุบันไว้
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
