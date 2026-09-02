// Import Library
import crypto from "crypto";
import { Prisma } from "@prisma/client";

// Import Dependencies
import { client } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { LineActionTokenDto, TicketRatingDto, VendorTicketAction } from "../types/line.type";
import { TICKET_STATUS } from "../constants/job-status";

export const MESSAGE_DELIVERY_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  FAILED: "FAILED",
} as const;

/* -------------------------------------- Functions -------------------------------------- */

// Function อ่านค่า duration เป็น milliseconds จาก DB
function parseDurationToMilliseconds(value: string | undefined): number {
  const defaultTtlMs = 7 * 24 * 60 * 60 * 1000;

  if (!value) {
    return defaultTtlMs;
  }

  const match = value.trim().match(/^(\d+)\s*([smhd])?$/i);

  if (!match) {
    return defaultTtlMs;
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[unit] ?? multipliers.s);
}

// Function สร้าง LINE action token expires at จาก DB
function buildLineActionTokenExpiresAt(): Date {
  return new Date(
    Date.now() + parseDurationToMilliseconds(process.env.VENDOR_ACTION_TOKEN_EXPIRES_IN)
  );
}

// Function จัดการ เป็น LINE action token DTO จาก DB
function toLineActionTokenDto(record: {
  id: number;
  token: string;
  action: string;
  ticketId: number;
  submissionId: number;
  boothCode: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): LineActionTokenDto {
  return {
    id: record.id,
    token: record.token,
    action: record.action as VendorTicketAction,
    ticket_id: record.ticketId,
    submission_id: record.submissionId,
    boothCode: record.boothCode,
    expires_at: record.expiresAt.toISOString(),
    used_at: record.usedAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

// Function สร้าง random LINE action token จาก DB
function createRandomLineActionToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// Function สร้าง LINE action token จาก DB
export async function createLineActionToken(
  input: {
    action: VendorTicketAction;
    ticket_id: number;
    submission_id: number;
    boothCode: string;
    expires_at?: Date;
  },
  connection?: DbConnection
): Promise<LineActionTokenDto> {
  const db = client(connection);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const token = await db.lineActionToken.create({
        data: {
          token: createRandomLineActionToken(),
          action: input.action,
          ticketId: input.ticket_id,
          submissionId: input.submission_id,
          boothCode: input.boothCode,
          expiresAt: input.expires_at ?? buildLineActionTokenExpiresAt(),
        },
      });

      return toLineActionTokenDto(token);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        attempt < 2
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to create LINE action token.");
}

// Function ค้นหา LINE action token จาก DB
export async function findLineActionToken(
  token: string,
  connection?: DbConnection
): Promise<LineActionTokenDto | null> {
  const db = client(connection);
  const record = await db.lineActionToken.findUnique({
    where: {
      token,
    },
  });

  return record ? toLineActionTokenDto(record) : null;
}

// Function สร้าง message delivery log จาก DB
export async function createMessageDeliveryLog(
  channel: string,
  jobName: string,
  payload: Prisma.InputJsonValue,
  target?: string | null,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const log = await db.messageDeliveryLog.create({
    data: {
      channel,
      jobName,
      target: target ?? null,
      payload,
      status: MESSAGE_DELIVERY_STATUS.PENDING,
    },
  });

  return log.id;
}

// Function อัปเดต message delivery log status จาก DB
export async function updateMessageDeliveryLogStatus(
  id: number,
  status: string,
  error?: string | null,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);
  await db.messageDeliveryLog.update({
    where: {
      id,
    },
    data: {
      status,
      lastError: error ?? null,
      sentAt: status === MESSAGE_DELIVERY_STATUS.SENT ? new Date() : undefined,
    },
  });
}

// Function สร้างหรืออัปเดตคะแนนความพึงพอใจหนึ่งคะแนนต่อ ticket และ LINE user
function mapTicketRating(rating: {
  id: number;
  ticketId: number;
  submissionId: number;
  lineUserId: string;
  targetType: string | null;
  score: number;
  ratedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): TicketRatingDto {
  return {
    id: rating.id,
    ticket_id: rating.ticketId,
    submission_id: rating.submissionId,
    line_user_id: rating.lineUserId,
    target_type: rating.targetType,
    score: rating.score,
    rated_at: rating.ratedAt.toISOString(),
    created_at: rating.createdAt.toISOString(),
    updated_at: rating.updatedAt.toISOString(),
  };
}

export async function upsertTicketRating(
  input: {
    ticket_id: number;
    submission_id: number;
    line_user_id: string;
    target_type?: string | null;
    score: number;
  },
  connection?: DbConnection
): Promise<TicketRatingDto> {
  const db = client(connection);

  try {
    return mapTicketRating(
      await db.ticketRating.create({
        data: {
          ticketId: input.ticket_id,
          submissionId: input.submission_id,
          lineUserId: input.line_user_id,
          targetType: input.target_type ?? null,
          score: input.score,
        },
      })
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existingRating = await db.ticketRating.findUnique({
        where: {
          ticketId: input.ticket_id,
        },
      });

      if (existingRating) {
        return mapTicketRating(existingRating);
      }
    }

    throw error;
  }
}
