// Import Library
import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
// Import Dependencies
import ApiError from "../utils/api-error";


/* -------------------------------------- Functions -------------------------------------- */

// Function อ่านค่า Bearer token จาก Authorization header
function getBearerToken(authorization: string | undefined): string {
  if (!authorization || typeof authorization !== "string") {
    throw new ApiError(401, "INVALID_TOKEN", "Authorization token is required.");
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid authorization format.");
  }

  return token;
}

// Function จัดการ auth middleware สำหรับ Express middleware
export default function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = getBearerToken(req.headers.authorization);

    req.auth = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}
