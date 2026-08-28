import type { NextFunction, Request, Response } from "express";

import { logger } from "../utils/logger";

const SKIPPED_LOG_PATHS = new Set(["/ready"]);

export function buildRequestLogContext(input: {
  requestId?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}): Record<string, unknown> {
  return {
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    durationMs: Math.round(input.durationMs * 100) / 100,
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

    logger.info(
      "Request completed.",
      buildRequestLogContext({
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        statusCode: res.statusCode,
        durationMs,
      }),
    );
  });

  next();
}
