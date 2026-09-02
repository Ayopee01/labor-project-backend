import type { NextFunction, Request, Response } from "express";

import { detectClientType } from "../utils/client-type";
import { logger } from "../utils/logger";

const SKIPPED_LOG_PATHS = new Set(["/ready"]);
const CLIENT_VERSION_HEADER = "x-client-version";

// Function เลือก log level ตาม status code — 5xx = error (bug/failure ฝั่ง server), 4xx = warn (client
// error ที่คาดเดาได้ เช่น validation/permission), อื่นๆ = info (สำเร็จปกติ)
function resolveLogLevel(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) {
    return "error";
  }

  if (statusCode >= 400) {
    return "warn";
  }

  return "info";
}

export function buildRequestLogContext(input: {
  requestId?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  clientType?: string;
  clientVersion?: string;
  userId?: number;
  ip?: string;
}): Record<string, unknown> {
  return {
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    durationMs: Math.round(input.durationMs * 100) / 100,
    clientType: input.clientType,
    clientVersion: input.clientVersion,
    userId: input.userId,
    ip: input.ip,
  };
}

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    if (SKIPPED_LOG_PATHS.has(req.path)) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const level = resolveLogLevel(res.statusCode);

    logger[level](
      "Request completed.",
      buildRequestLogContext({
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        statusCode: res.statusCode,
        durationMs,
        clientType: detectClientType(req),
        clientVersion: req.header(CLIENT_VERSION_HEADER) || undefined,
        userId: req.auth?.account_id,
        ip: req.ip,
      }),
    );
  });

  next();
}
