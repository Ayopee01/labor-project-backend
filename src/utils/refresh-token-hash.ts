// import Library
import crypto from "node:crypto";

/* -------------------------------------- Config -------------------------------------- */

const REFRESH_TOKEN_HASH_CONFIG = {
  secret:
    process.env.REFRESH_TOKEN_HASH_SECRET ||
    process.env.JWT_REFRESH_SECRET ||
    process.env.JWT_SECRET,
  algorithm: "sha256" as const,
  prefix: "hmac-sha256",
};

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง config สำหรับ hash refresh token และตรวจสอบว่า secret พร้อมใช้งาน
function getRefreshTokenHashConfig(): typeof REFRESH_TOKEN_HASH_CONFIG & {
  secret: string;
} {
  if (!REFRESH_TOKEN_HASH_CONFIG.secret) {
    throw new Error("Refresh token hash secret must be configured.");
  }

  return REFRESH_TOKEN_HASH_CONFIG as typeof REFRESH_TOKEN_HASH_CONFIG & {
    secret: string;
  };
}

// Function hash refresh token ก่อนเก็บลง database โดยใช้ HMAC-SHA256
export function hashRefreshToken(refreshToken: string): string {
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new TypeError("Refresh token must be a non-empty string.");
  }

  const config = getRefreshTokenHashConfig();

  const digest = crypto
    .createHmac(config.algorithm, config.secret)
    .update(refreshToken)
    .digest("base64url");

  return `${config.prefix}$${digest}`;
}

// Function เปรียบเทียบ hash ของ refresh token แบบ timing-safe
export function refreshTokenHashesMatch(
  candidateHash: string | null | undefined,
  storedHash: string | null | undefined
): boolean {
  if (typeof candidateHash !== "string" || typeof storedHash !== "string") {
    return false;
  }

  const candidateBuffer = Buffer.from(candidateHash);
  const storedBuffer = Buffer.from(storedHash);

  return (
    candidateBuffer.length === storedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, storedBuffer)
  );
}
