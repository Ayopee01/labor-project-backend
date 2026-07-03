// import library
import jwt, { type SignOptions } from "jsonwebtoken";
import type { ZodType } from "zod";
// import
import { AUTH_DEFAULTS } from "../config/auth.config";
import type { AccessTokenPayload, LoginChallengeTokenPayload, RefreshTokenPayload, TokenConfig, TokenPayloadByType, TokenSignOptions, TokenType } from "../types/auth.type";
import { parseWithSchema } from "../validation/parser";
import { accessTokenPayloadSchema, loginChallengeTokenPayloadSchema, refreshTokenPayloadSchema } from "../validation/schemas";
import ApiError from "./api-error";

/* -------------------------------------- Config -------------------------------------- */

const TOKEN_CONFIG: Record<TokenType, TokenConfig> = {
  access: {
    secret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || AUTH_DEFAULTS.accessTokenExpiresIn,
    invalidCode: "INVALID_TOKEN",
    expiredCode: "TOKEN_EXPIRED",
  },
  refresh: {
    secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || AUTH_DEFAULTS.refreshTokenExpiresIn,
    invalidCode: "INVALID_REFRESH_TOKEN",
    expiredCode: "TOKEN_EXPIRED",
  },
  login_challenge: {
    secret: process.env.JWT_LOGIN_CHALLENGE_SECRET || process.env.JWT_SECRET,
    expiresIn: process.env.JWT_LOGIN_CHALLENGE_EXPIRES_IN || AUTH_DEFAULTS.loginChallengeExpiresIn,
    invalidCode: "INVALID_LOGIN_CHALLENGE",
    expiredCode: "LOGIN_CHALLENGE_EXPIRED",
  },
};

const TOKEN_PAYLOAD_SCHEMAS: {
  [TTokenType in TokenType]: ZodType<TokenPayloadByType[TTokenType]>;
} = {
  access: accessTokenPayloadSchema,
  refresh: refreshTokenPayloadSchema,
  login_challenge: loginChallengeTokenPayloadSchema,
};

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง config ของ token ตามประเภท และตรวจสอบว่า token มี secret พร้อมใช้งาน
function getTokenConfig(tokenType: TokenType): TokenConfig & { secret: string } {
  const config = TOKEN_CONFIG[tokenType];

  if (!config) {
    throw new TypeError(`Unsupported token type: ${tokenType}`);
  }

  if (!config.secret) {
    throw new Error(`${tokenType} token secret must be configured.`);
  }

  return config as TokenConfig & { secret: string };
}

// Function สร้าง token ตามประเภทที่กำหนด เช่น access, refresh, login_challenge
function signTypedToken<TTokenType extends TokenType>(
  payload: Omit<TokenPayloadByType[TTokenType], "token_type" | "iat" | "exp">,
  tokenType: TTokenType,
  options: TokenSignOptions = {}
): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("JWT payload must be an object.");
  }

  const config = getTokenConfig(tokenType);

  return jwt.sign(
    {
      ...payload,
      token_type: tokenType,
    },
    config.secret,
    {
      algorithm: "HS256",
      expiresIn: (options.expiresIn || config.expiresIn) as SignOptions["expiresIn"],
    }
  );
}

// Function ตรวจสอบ token ตามประเภทที่กำหนด เช่น access, refresh, login_challenge
function verifyTypedToken<TTokenType extends TokenType>(
  token: string,
  tokenType: TTokenType
): TokenPayloadByType[TTokenType] {
  const config = getTokenConfig(tokenType);

  if (!token || typeof token !== "string") {
    throw new ApiError(401, config.invalidCode, "Invalid token.");
  }

  try {
    const payload = jwt.verify(token, config.secret, {
      algorithms: ["HS256"],
    });

    const parseOptions = {
      statusCode: 401,
      code: config.invalidCode,
      message: "Invalid token.",
    };

    return parseWithSchema<TokenPayloadByType[TTokenType]>(
      TOKEN_PAYLOAD_SCHEMAS[tokenType],
      payload,
      parseOptions
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "TokenExpiredError") {
      throw new ApiError(401, config.expiredCode, "Token expired.");
    }

    throw new ApiError(401, config.invalidCode, "Invalid token.");
  }
}

// Function signature access token อายุสั้น ใช้สำหรับยืนยันการเข้าถึง resource
export const signAccessToken = (
  payload: Omit<AccessTokenPayload, "token_type" | "iat" | "exp">,
  options: TokenSignOptions = {}
): string => signTypedToken(payload, "access", options);

// Function signature refresh token อายุยาว ใช้สำหรับขอ access token ใหม่
export const signRefreshToken = (
  payload: Omit<RefreshTokenPayload, "token_type" | "iat" | "exp">,
  options: TokenSignOptions = {}
): string => signTypedToken(payload, "refresh", options);

// Function signature force-login challenge token อายุสั้น ใช้สำหรับยืนยันการเข้าสู่ระบบ
export const signLoginChallengeToken = (
  payload: Omit<LoginChallengeTokenPayload, "token_type" | "iat" | "exp">,
  options: TokenSignOptions = {}
): string => signTypedToken(payload, "login_challenge", options);

// Function ตรวจสอบ access token และคืนค่า payload ที่ decode แล้ว
export const verifyAccessToken = (token: string): AccessTokenPayload =>
  verifyTypedToken(token, "access");

// Function ตรวจสอบ refresh token และคืนค่า payload ที่ decode แล้ว
export const verifyRefreshToken = (token: string): RefreshTokenPayload =>
  verifyTypedToken(token, "refresh");

// Function ตรวจสอบ force-login challenge token และคืนค่า payload ที่ decode แล้ว
export const verifyLoginChallengeToken = (
  token: string
): LoginChallengeTokenPayload => verifyTypedToken(token, "login_challenge");
