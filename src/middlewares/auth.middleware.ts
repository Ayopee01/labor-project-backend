// Import Library
import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
// Import Dependencies
import { extractBearerToken } from "../utils/bearer-token";

/* -------------------------------------- Functions -------------------------------------- */

// Function จัดการ auth middleware สำหรับ Express middleware
export default function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractBearerToken(req.headers.authorization, {
      missingCode: "INVALID_TOKEN",
      missingMessage: "Authorization token is required.",
      invalidCode: "INVALID_TOKEN",
      invalidMessage: "Invalid authorization format.",
    });

    req.auth = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}
