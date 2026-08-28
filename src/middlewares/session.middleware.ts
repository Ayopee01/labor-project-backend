// Import Library
import type { NextFunction, Request, Response } from "express";
// Import Dependencies
import { accountRepository, sessionRepository } from "../repositories/auth.repository";
import ApiError from "../utils/api-error";
// Import Types
import type { AccessTokenPayload, SessionDto } from "../types/auth.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจสอบและดึง auth payload สำหรับ Express middleware
function requireAuthPayload(req: Request): AccessTokenPayload {
  if (!req.auth || !req.auth.session_id || !req.auth.account_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  return req.auth;
}

// Function จัดการ session matches auth สำหรับ Express middleware
function sessionMatchesAuth(
  session: SessionDto | null,
  auth: AccessTokenPayload
): session is SessionDto {
  return Boolean(session && session.account_id === auth.account_id);
}

// Function จัดการ session middleware สำหรับ Express middleware
export default async function sessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const auth = requireAuthPayload(req);
    const session = await sessionRepository.findActiveById(auth.session_id);

    if (!sessionMatchesAuth(session, auth)) {
      throw new ApiError(401, "INVALID_TOKEN", "Session is no longer active.");
    }

    // Function เช็คสถานะบัญชีจริงทุก request หลัง auth token ผ่าน
    const account = await accountRepository.findById(auth.account_id);

    if (!account || account.status !== "active") {
      throw new ApiError(401, "INVALID_TOKEN", "Account is inactive.");
    }

    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}
