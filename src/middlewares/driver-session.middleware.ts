// Import Library
import type { NextFunction, Request, Response } from "express";

// Import Repositories
import * as driverRepository from "../repositories/driver.repository";

// Import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function อ่านค่า Bearer token จาก Authorization header
function getBearerToken(req: Request): string {
  const authorization = req.header("authorization");

  if (!authorization) {
    throw new ApiError(401, "MISSING_DRIVER_SESSION", "Missing driver session token.");
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "INVALID_DRIVER_SESSION", "Invalid driver session token.");
  }

  return token;
}

// Function จัดการ driver session middleware สำหรับ Express middleware
export default async function driverSessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = getBearerToken(req);
    const session = await driverRepository.findActiveDriverSessionByToken(token);

    if (!session) {
      throw new ApiError(401, "INVALID_DRIVER_SESSION", "Invalid driver session token.");
    }

    req.driverSession = session;
    next();
  } catch (error) {
    next(error);
  }
}
