// import Library
import type { NextFunction, Request, Response } from "express";
// import
import { sessionRepository } from "../repositories/auth.repository";
import ApiError from "../utils/api-error";
// import types
import type { AccessTokenPayload, SessionDto } from "../types/auth.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง auth payload จาก request และโยน error ถ้า token ไม่สมบูรณ์
function requireAuthPayload(req: Request): AccessTokenPayload {
  if (!req.auth || !req.auth.session_id || !req.auth.account_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  return req.auth;
}

// Function ตรวจสอบว่า session เป็นของ account ใน token หรือไม่
function sessionMatchesAuth(
  session: SessionDto | null,
  auth: AccessTokenPayload
): session is SessionDto {
  return Boolean(session && session.account_id === auth.account_id);
}

// Function ตรวจสอบว่า session ใน token ยัง active อยู่
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

    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}
