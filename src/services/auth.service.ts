import { accountRepository, profileRepository, sessionRepository, workScheduleRepository } from "../repositories/auth.repository";
import { AUTH_DEFAULTS, getAccessTokenExpiresInSeconds } from "../config/auth.config";
import { getAccountPermissions } from "./admin-settings.service";
import { withTransaction } from "../db/prisma";
import type { AccessTokenPayload, AccountResponse, AdminLoginAccountResponse, AuthSuccessResponse, AuthTokens, MeResponse, ProfileCardShift, SessionDto, WorkerLoginAccountResponse } from "../types/auth.type";
import type { DbConnection } from "../types/common.type";
import type { AccountDto, ProfileDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import { parseWithSchema } from "../validation/parser";
import { confirmForceLoginBodySchema, loginBodySchema, refreshBodySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";
import { signAccessToken, signLoginChallengeToken, signRefreshToken, verifyLoginChallengeToken, verifyRefreshToken } from "../utils/jwt";
import { verifyPassword } from "../utils/password";
import { hashRefreshToken, refreshTokenHashesMatch } from "../utils/refresh-token-hash";
import { formatBangkokServerTime, formatScheduleWithShift } from "../utils/shift";

/* -------------------------------------- Config -------------------------------------- */

const WORKER_ROLE = "worker";
const ADMIN_SESSION_DEVICE_NAME = "Admin Web";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง device id สำหรับ session ของ admin หรือ worker
function getDefaultSessionDeviceId(account: AccountDto): string {
  return account.role === "admin"
    ? `admin:${account.id}`
    : `${account.role}:${account.id}`;
}

// Function สร้าง device name สำหรับ session ของ admin หรือ worker
function getDefaultSessionDeviceName(account: AccountDto): string {
  return account.role === "admin" ? ADMIN_SESSION_DEVICE_NAME : `${account.role} Web`;
}

function buildAdminEmployeeCode(accountId: number): string {
  return `ADM${String(accountId).padStart(4, "0")}`;
}

function formatProfileCardShift(
  schedule: ReturnType<typeof formatScheduleWithShift>
): ProfileCardShift | null {
  if (!schedule) {
    return null;
  }

  return {
    name: schedule.shift_name,
    start_time: schedule.shift_start_time,
    end_time: schedule.shift_end_time,
  };
}

function buildWorkerLoginAccountResponse(
  account: AccountDto,
  profile: ProfileDto | null,
  schedule: WorkScheduleWithShiftDto | null
): WorkerLoginAccountResponse {
  return {
    full_name: account.full_name,
    worker_code: profile?.worker_code ?? null,
    image_url: profile?.image_url ?? null,
    status: account.status,
    shift: formatProfileCardShift(schedule),
    server_time: formatBangkokServerTime(),
  };
}

function buildAdminLoginAccountResponse(
  account: AccountDto,
  permissions: AdminLoginAccountResponse["permissions"],
  latestActiveAt: string | null
): AdminLoginAccountResponse {
  return {
    full_name: account.full_name,
    status: account.status,
    position: account.position,
    email: account.email,
    phone: account.phone,
    image_url: null,
    permission_level: account.permission_level,
    permissions,
    latest_active_at: latestActiveAt,
  };
}

async function resolveLatestSession(
  account: AccountDto,
  currentSession?: SessionDto | null,
  connection?: DbConnection
): Promise<SessionDto | null> {
  if (currentSession) {
    return currentSession;
  }

  return sessionRepository.findActiveByAccountId(account.id, connection);
}

async function buildMeResponse(
  account: AccountDto,
  currentSession?: SessionDto | null
): Promise<MeResponse> {
  const latestSession = await resolveLatestSession(account, currentSession);
  const latestActiveAt = latestSession?.last_active_at ?? null;

  if (account.role !== WORKER_ROLE) {
    const accountPermissions = await getAccountPermissions(account);

    return {
      full_name: account.full_name,
      position: account.position,
      admin_code: buildAdminEmployeeCode(account.id),
      status: account.status,
      email: account.email,
      phone: account.phone,
      permission_level: account.permission_level,
      permissions: accountPermissions.permissions,
      latest_active_at: latestActiveAt,
    };
  }

  const [profile, currentWorkSchedule] = await Promise.all([
    profileRepository.findByAccountId(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
  ]);
  const schedule = formatScheduleWithShift(currentWorkSchedule);

  return {
    full_name: account.full_name,
    worker_code: profile?.worker_code ?? null,
    nationality: profile?.nationality_name ?? profile?.nationality ?? null,
    work_start_date: profile?.work_start_date ?? null,
    phone: profile?.phone ?? null,
    shift: formatProfileCardShift(schedule),
  };
}

// Function ตรวจสอบว่า worker ต้องมี device id และ device name ตอน login หรือไม่
function requireWorkerDevice(
  deviceId?: string,
  deviceName?: string
): { deviceId: string; deviceName: string } {
  if (!deviceId || !deviceName) {
    const validationErrors = [];

    if (!deviceId) {
      validationErrors.push({
        field: "device_id",
        message: "Required.",
      });
    }

    if (!deviceName) {
      validationErrors.push({
        field: "device_name",
        message: "Required.",
      });
    }

    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Device information is required for worker login.",
      {
        validation_errors: validationErrors,
      }
    );
  }

  return {
    deviceId,
    deviceName,
  };
}

// Function ระบุ device สำหรับ login ของ account
function resolveLoginDevice(
  account: AccountDto,
  deviceId?: string,
  deviceName?: string
): { deviceId: string; deviceName: string } {
  if (account.role === WORKER_ROLE) {
    return requireWorkerDevice(deviceId, deviceName);
  }

  return {
    deviceId: getDefaultSessionDeviceId(account),
    deviceName: getDefaultSessionDeviceName(account),
  };
}

// Function สร้าง response ของ account พร้อม profile และตารางงานปัจจุบัน
async function buildAccountResponse(
  account: AccountDto,
  connection?: DbConnection,
  currentSession?: SessionDto | null
): Promise<AccountResponse> {
  if (account.role !== WORKER_ROLE) {
    const latestSession = await resolveLatestSession(account, currentSession, connection);
    const latestActiveAt = latestSession?.last_active_at ?? null;
    const accountPermissions = await getAccountPermissions(account, connection);

    return {
      account: buildAdminLoginAccountResponse(
        account,
        accountPermissions.permissions,
        latestActiveAt
      ),
    };
  }

  const [profile, currentWorkSchedule] = await Promise.all([
    profileRepository.findByAccountId(account.id, connection),
    workScheduleRepository.findCurrentByAccountId(account.id, connection),
  ]);

  const schedule = formatScheduleWithShift(currentWorkSchedule);

  return {
    account: buildWorkerLoginAccountResponse(account, profile, schedule),
  };
}

// Function สร้าง session และออก access token กับ refresh token
async function createSession(
  account: AccountDto,
  deviceId: string,
  deviceName: string,
  connection: DbConnection
): Promise<AuthTokens> {
  const expiresAt = new Date(
    Date.now() + AUTH_DEFAULTS.sessionExpiresInMilliseconds
  ).toISOString();
  const session = await sessionRepository.createPending(
    {
      account_id: account.id,
      device_id: deviceId,
      device_name: deviceName,
      expires_at: expiresAt,
    },
    connection
  );
  const accountPermissions = await getAccountPermissions(account);
  const accessToken = signAccessToken({
    account_id: account.id,
    role: account.role,
    permission_level: account.permission_level,
    permissions: accountPermissions.permissions,
    session_id: session.id,
  });
  const refreshToken = signRefreshToken({
    account_id: account.id,
    session_id: session.id,
  });

  await sessionRepository.updateRefreshTokenHash(
    session.id,
    hashRefreshToken(refreshToken),
    connection
  );

  return {
    accessToken,
    refreshToken,
  };
}

// Function รวม token กับข้อมูล account เป็น response สำหรับ auth
async function buildAuthSuccessResponse(
  account: AccountDto,
  tokens: AuthTokens,
  connection?: DbConnection
): Promise<AuthSuccessResponse> {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: "Bearer",
    expires_in: getAccessTokenExpiresInSeconds(),
    ...(await buildAccountResponse(account, connection)),
  };
}

// Function ตรวจสอบ username/password และเข้าสู่ระบบ
export async function login(body: unknown) {
  const {
    username,
    password,
    device_id: deviceId,
    device_name: deviceName,
  } = parseWithSchema(loginBodySchema, body);
  const account = await accountRepository.findByUsername(username);

  if (!account || !(await verifyPassword(password, account.password_hash))) {
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid username or password."
    );
  }

  if (account.status !== "active") {
    throw new ApiError(423, "ACCOUNT_INACTIVE", "Account is inactive.");
  }

  const activeSession = await sessionRepository.findActiveByAccountId(account.id);
  const sessionDevice = resolveLoginDevice(account, deviceId, deviceName);
  const requiresDevice = account.role === WORKER_ROLE;

  if (
    requiresDevice &&
    activeSession &&
    activeSession.device_id !== sessionDevice.deviceId
  ) {
    const loginChallengeToken = signLoginChallengeToken({
      account_id: account.id,
      role: account.role,
      old_session_id: activeSession.id,
      new_device_id: sessionDevice.deviceId,
    });

    throw new ApiError(
      409,
      "ACTIVE_SESSION_EXISTS",
      "Another active session exists.",
      {
        login_challenge_token: loginChallengeToken,
        active_device: {
          device_id: activeSession.device_id,
          device_name: activeSession.device_name,
          last_active_at: activeSession.last_active_at,
        },
      }
    );
  }

  return withTransaction(async (transaction) => {
    if (activeSession) {
      await sessionRepository.revoke(activeSession.id, transaction);
    }

    const tokens = await createSession(
      account,
      sessionDevice.deviceId,
      sessionDevice.deviceName,
      transaction
    );

    return buildAuthSuccessResponse(account, tokens, transaction);
  });
}

// Function ยืนยันการบังคับ login เมื่อมี session อื่นใช้งานอยู่
export async function confirmForceLogin(body: unknown) {
  const {
    login_challenge_token: loginChallengeToken,
    device_id: deviceId,
    device_name: deviceName,
  } = parseWithSchema(confirmForceLoginBodySchema, body);
  const challenge = verifyLoginChallengeToken(loginChallengeToken);

  if (challenge.new_device_id !== deviceId) {
    throw new ApiError(
      401,
      "INVALID_LOGIN_CHALLENGE",
      "Invalid login challenge."
    );
  }

  const oldSession = await sessionRepository.findActiveById(
    challenge.old_session_id
  );

  if (!oldSession) {
    throw new ApiError(
      401,
      "INVALID_LOGIN_CHALLENGE",
      "Login challenge session is no longer active."
    );
  }

  if (oldSession.account_id !== challenge.account_id) {
    throw new ApiError(
      401,
      "INVALID_LOGIN_CHALLENGE",
      "Invalid login challenge."
    );
  }

  const account = await accountRepository.findById(challenge.account_id);

  if (!account || account.status !== "active") {
    throw new ApiError(423, "ACCOUNT_INACTIVE", "Account is inactive.");
  }

  return withTransaction(async (transaction) => {
    await sessionRepository.revoke(oldSession.id, transaction);

    const tokens = await createSession(account, deviceId, deviceName, transaction);

    return buildAuthSuccessResponse(account, tokens, transaction);
  });
}

// Function ตรวจสอบ refresh token และออก token ชุดใหม่
export async function refresh(body: unknown) {
  const { refresh_token: refreshToken } = parseWithSchema(refreshBodySchema, body);
  const payload = verifyRefreshToken(refreshToken);
  const session = await sessionRepository.findActiveById(payload.session_id);

  if (!session || session.account_id !== payload.account_id) {
    throw new ApiError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Invalid refresh token."
    );
  }

  const candidateHash = hashRefreshToken(refreshToken);

  if (!refreshTokenHashesMatch(candidateHash, session.refresh_token_hash)) {
    throw new ApiError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Invalid refresh token."
    );
  }

  const account = await accountRepository.findById(payload.account_id);

  if (!account || account.status !== "active") {
    throw new ApiError(423, "ACCOUNT_INACTIVE", "Account is inactive.");
  }

  const accountPermissions = await getAccountPermissions(account);
  const accessToken = signAccessToken({
    account_id: account.id,
    role: account.role,
    permission_level: account.permission_level,
    permissions: accountPermissions.permissions,
    session_id: session.id,
  });
  const nextRefreshToken = signRefreshToken({
    account_id: account.id,
    session_id: session.id,
  });

  await sessionRepository.updateRefreshTokenHash(
    session.id,
    hashRefreshToken(nextRefreshToken)
  );

  return {
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    token_type: "Bearer",
    expires_in: getAccessTokenExpiresInSeconds(),
  };
}

// Function ออกจากระบบโดยยกเลิก session ปัจจุบัน
export async function logout(auth?: AccessTokenPayload) {
  if (!auth || !auth.session_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  await sessionRepository.revoke(auth.session_id);

  return {
    message: "Logged out successfully.",
  };
}

// Function ดึงข้อมูลผู้ใช้จาก access token ปัจจุบัน
export async function me(
  auth?: AccessTokenPayload,
  currentSession?: SessionDto | null
): Promise<MeResponse> {
  if (!auth || !auth.account_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const account = await accountRepository.findById(auth.account_id);

  if (!account || account.status !== "active") {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  return buildMeResponse(account, currentSession);
}
