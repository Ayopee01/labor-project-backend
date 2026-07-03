// import Library
import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
// import
import ApiError from "../utils/api-error";


/* -------------------------------------- Config -------------------------------------- */

// ค่าคงที่: scheme ของ Authorization header
const AUTHORIZATION_SCHEME = "Bearer";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง token จาก Authorization header
function getBearerToken(authorization: string | undefined): string {
  if (!authorization || typeof authorization !== "string") {
    throw new ApiError(401, "INVALID_TOKEN", "Authorization token is required.");
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== AUTHORIZATION_SCHEME || !token) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid authorization format.");
  }

  return token;
}

// Function ตรวจสอบ access token และเก็บ payload ไว้ใน req.auth
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
