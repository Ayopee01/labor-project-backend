// import Library
import { prisma } from "../db/prisma";
import type { Prisma } from "@prisma/client";

// import Mapper
import { mapSession } from "./mapper";

// import Types
import type { PendingSessionInput, SessionDto } from "../types/auth.type";
import type { DbConnection } from "../types/common.type";


/* -------------------------------------- Config -------------------------------------- */

// ค่าเริ่มต้น: session จะยังไม่มี refresh token hash จนกว่าจะสร้าง token สำเร็จ
const PENDING_REFRESH_TOKEN_HASH = "";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id ให้เป็น number ก่อนส่งเข้า Prisma
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function แปลง session id ให้เป็น number ก่อนส่งเข้า Prisma
function toSessionId(id: number | string): number {
  return Number(id);
}

// Function ตรวจสอบว่า Prisma คืน session กลับมาหลัง create/update
function requireMappedSession(
  session: SessionDto | null,
  action: string
): SessionDto {
  if (!session) {
    throw new Error(`Session ${action} did not return a record.`);
  }

  return session;
}

// Function สร้างเงื่อนไขค้นหา session ที่ยัง active และยังไม่หมดอายุ
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

// Function สร้างข้อมูล session ตอนเริ่มต้นก่อน update refresh token hash
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

// Function สร้างข้อมูลสำหรับ update refresh token hash และ last active
function buildRefreshTokenHashData(refreshTokenHash: string) {
  const updatedAt = new Date();

  return {
    refreshTokenHash,
    lastActiveAt: updatedAt,
    updatedAt,
  };
}

// Function สร้างข้อมูลสำหรับยกเลิก session
function buildRevokeData() {
  const revokedAt = new Date();

  return {
    isActive: false,
    revokedAt,
    updatedAt: revokedAt,
  };
}

// Function ค้นหา session ที่ยัง active ล่าสุดของ account
export async function findActiveByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<SessionDto | null> {
  return mapSession(
    await client(connection).userSession.findFirst({
      where: buildActiveSessionWhere({
        accountId: toAccountId(accountId),
      }),
      orderBy: {
        id: "desc",
      },
    })
  );
}

// Function ค้นหา session ที่ยัง active จาก session id
export async function findActiveById(
  sessionId: number | string,
  connection?: DbConnection
): Promise<SessionDto | null> {
  return mapSession(
    await client(connection).userSession.findFirst({
      where: buildActiveSessionWhere({
        id: toSessionId(sessionId),
      }),
    })
  );
}

// Function สร้าง session ใหม่ใน table user_sessions แบบรอใส่ refresh token hash
export async function createPending(
  session: PendingSessionInput,
  connection?: DbConnection
): Promise<SessionDto> {
  return requireMappedSession(
    mapSession(
      await client(connection).userSession.create({
        data: buildPendingSessionData(session),
      })
    ),
    "create"
  );
}

// Function update refresh token hash หลังสร้าง refresh token แล้ว
export async function updateRefreshTokenHash(
  sessionId: number | string,
  refreshTokenHash: string,
  connection?: DbConnection
): Promise<SessionDto> {
  return requireMappedSession(
    mapSession(
      await client(connection).userSession.update({
        where: {
          id: toSessionId(sessionId),
        },
        data: buildRefreshTokenHashData(refreshTokenHash),
      })
    ),
    "update"
  );
}

// Function ยกเลิก session จาก session id
export async function revoke(
  sessionId: number | string,
  connection?: DbConnection
): Promise<SessionDto | null> {
  const activeSession = await client(connection).userSession.findFirst({
    where: {
      id: toSessionId(sessionId),
      isActive: true,
    },
  });

  if (!activeSession) {
    return null;
  }

  return mapSession(
    await client(connection).userSession.update({
      where: {
        id: activeSession.id,
      },
      data: buildRevokeData(),
    })
  );
}

// Function ยกเลิก session ที่ยัง active ทั้งหมดของ account
export async function revokeActiveByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<void> {
  await client(connection).userSession.updateMany({
    where: {
      accountId: toAccountId(accountId),
      isActive: true,
    },
    data: buildRevokeData(),
  });
}
