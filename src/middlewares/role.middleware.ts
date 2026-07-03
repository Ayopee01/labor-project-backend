// import Library
import type { NextFunction, Request, RequestHandler, Response } from "express";
// import
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจสอบว่า role ใน token มีสิทธิ์เข้าใช้งาน route นี้หรือไม่
export default function roleMiddleware(allowedRoles: string[]): RequestHandler {
  const allowedRoleSet = new Set(allowedRoles);

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !allowedRoleSet.has(req.auth.role)) {
      next(new ApiError(403, "FORBIDDEN", "Permission denied."));
      return;
    }

    next();
  };
}
