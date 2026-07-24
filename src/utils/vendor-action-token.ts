import jwt, { type SignOptions } from "jsonwebtoken";
import ApiError from "./api-error";
import type { VendorTicketAction, VendorTicketActionTokenPayload } from "../types/line.type";

/* -------------------------------------- Functions -------------------------------------- */

function getVendorActionTokenSecret(): string {
  const secret =
    process.env.VENDOR_ACTION_TOKEN_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("Vendor action token secret must be configured.");
  }

  return secret;
}

function getVendorActionTokenExpiresIn(): string {
  return process.env.VENDOR_ACTION_TOKEN_EXPIRES_IN || "7d";
}

function isVendorTicketAction(value: unknown): value is VendorTicketAction {
  return (
    value === "vendor_confirm_completion" ||
    value === "vendor_reject_completion"
  );
}

function parseVendorActionPayload(
  payload: unknown,
  expectedAction?: VendorTicketAction
): VendorTicketActionTokenPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(401, "INVALID_VENDOR_ACTION_TOKEN", "Invalid vendor action token.");
  }

  const record = payload as Record<string, unknown>;

  if (
    record.token_type !== "vendor_ticket_action" ||
    !isVendorTicketAction(record.action) ||
    (expectedAction && record.action !== expectedAction) ||
    !Number.isInteger(record.ticket_id) ||
    !Number.isInteger(record.submission_id) ||
    typeof record.boothCode !== "string" ||
    !Number.isInteger(record.iat) ||
    !Number.isInteger(record.exp)
  ) {
    throw new ApiError(401, "INVALID_VENDOR_ACTION_TOKEN", "Invalid vendor action token.");
  }

  return record as unknown as VendorTicketActionTokenPayload;
}

export function signVendorTicketActionToken(input: {
  action: VendorTicketAction;
  ticket_id: number;
  submission_id: number;
  boothCode: string;
}): string {
  return jwt.sign(
    {
      token_type: "vendor_ticket_action",
      action: input.action,
      ticket_id: input.ticket_id,
      submission_id: input.submission_id,
      boothCode: input.boothCode,
    },
    getVendorActionTokenSecret(),
    {
      algorithm: "HS256",
      expiresIn: getVendorActionTokenExpiresIn() as SignOptions["expiresIn"],
    }
  );
}

export function verifyVendorTicketActionToken(
  token: string,
  expectedAction?: VendorTicketAction
): VendorTicketActionTokenPayload {
  if (!token || typeof token !== "string") {
    throw new ApiError(401, "INVALID_VENDOR_ACTION_TOKEN", "Invalid vendor action token.");
  }

  try {
    const payload = jwt.verify(token, getVendorActionTokenSecret(), {
      algorithms: ["HS256"],
    });

    return parseVendorActionPayload(payload, expectedAction);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "TokenExpiredError") {
      throw new ApiError(
        401,
        "VENDOR_ACTION_TOKEN_EXPIRED",
        "Vendor action token expired."
      );
    }

    throw new ApiError(401, "INVALID_VENDOR_ACTION_TOKEN", "Invalid vendor action token.");
  }
}
