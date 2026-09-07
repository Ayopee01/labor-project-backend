import type { NextFunction, Request, Response } from "express";

type RateLimitBucket = {
  resetAt: number;
  count: number;
};

const buckets = new Map<string, RateLimitBucket>();
const RATE_LIMITED_ROUTE_PATTERNS = [
  /^\/api\/auth\//,
  /^\/api\/admin\//,
] as const;
let cleanupTimer: NodeJS.Timeout | null = null;

function getClientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function cleanupExpiredBuckets(now = Date.now()): void {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

// Function หา bucket ของ key นี้ (สร้างใหม่ถ้ายังไม่มีหรือหมดอายุแล้ว) แล้วนับเพิ่ม 1
function incrementRateLimitBucket(key: string, windowMs: number): RateLimitBucket {
  const now = Date.now();
  const current = buckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { resetAt: now + windowMs, count: 0 }
      : current;

  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket;
}

function ensureRateLimitCleanupTimer(): void {
  if (cleanupTimer) {
    return;
  }

  const cleanupIntervalMs = Number(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS);

  cleanupTimer = setInterval(() => cleanupExpiredBuckets(), cleanupIntervalMs);
  cleanupTimer.unref();
}

export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
}

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!RATE_LIMITED_ROUTE_PATTERNS.some((pattern) => pattern.test(req.path))) {
    next();
    return;
  }

  ensureRateLimitCleanupTimer();

  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS);
  const key = getClientKey(req);
  const bucket = incrementRateLimitBucket(key, windowMs);

  res.setHeader("RateLimit-Limit", String(maxRequests));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, maxRequests - bucket.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > maxRequests) {
    res.status(429).json({
      statusCode: 429,
      code: "RATE_LIMITED",
      message: "Too many requests.",
    });
    return;
  }

  next();
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}

export function stopRateLimitCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function cleanupRateLimitBucketsForTest(now = Date.now()): void {
  cleanupExpiredBuckets(now);
}

export function getRateLimitBucketCountForTest(): number {
  return buckets.size;
}
