// import Library
import type { NextFunction, Request, Response } from "express";

// import Repository
import * as driverRepository from "../repositories/driver.repository";

// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง Bearer token จาก header Authorization
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

// Function ตรวจ driver session token และผูกข้อมูลไว้ใน request
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
