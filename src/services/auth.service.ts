import { accountRepository, sessionRepository } from "../repositories/auth.repository";
import * as profileRepository from "../repositories/shared/profile.repository";
import * as workScheduleRepository from "../repositories/shared/work-schedule.repository";
import { AUTH_DEFAULTS, getAccessTokenExpiresInSeconds } from "../config/auth.config";
import { getAccountPermissions } from "./shared/account-permission.service";
import {
  registerWorkerPushToken as registerWorkerPushTokenForSession,
  registerWorkerPushTokenForAccount,
  revokeWorkerPushTokensBySession,
  sendWorkerPushNotificationToSession,
} from "./shared/worker-push.service";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import { withTransaction } from "../db/prisma";
import type { AccessTokenPayload, AuthSuccessResponse, AuthTokens, MeResponse, ProfileCardShift, SessionDto, UpdateLangResponse } from "../types/auth.type";
import type { DbConnection } from "../types/shared/common.type";
import type { AccountDto } from "../types/admin-workers.type";
import { parseWithSchema } from "../validation/parser";
import { changeOwnPasswordBodySchema, confirmForceLoginBodySchema, loginBodySchema, refreshBodySchema, updateOwnLangBodySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";
import { signAccessToken, signLoginChallengeToken, signRefreshToken, verifyLoginChallengeToken, verifyRefreshToken } from "../utils/jwt";
import { hashPassword, verifyPassword } from "../utils/password";
import { hashRefreshToken, refreshTokenHashesMatch } from "../utils/refresh-token-hash";
import { formatScheduleWithShift, isTimeInWorkSchedule } from "../utils/shift";

/* -------------------------------------- Config -------------------------------------- */

const WORKER_ROLE = "worker";

const ADMIN_SESSION_DEVICE_NAME = "Admin Web";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง default session device ID ใน service flow
function getDefaultSessionDeviceId(account: AccountDto): string {
  return account.role === "admin"
    ? `admin:${account.id}`
    : `${account.role}:${account.id}`;
}

// Function ดึง default session device name ใน service flow
function getDefaultSessionDeviceName(account: AccountDto): string {
  return account.role === "admin" ? ADMIN_SESSION_DEVICE_NAME : `${account.role} Web`;
}

// Function สร้าง admin employee code ใน service flow
function buildAdminEmployeeCode(accountId: number): string {
  return `ADM${String(accountId).padStart(4, "0")}`;
}

// Function จัดรูปแบบ profile card shift ใน service flow
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

// Function ค้นหาหรือตัดสิน latest session ใน service flow
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

// Function สร้าง me response ใน service flow
async function buildMeResponse(
  account: AccountDto,
  currentSession?: SessionDto | null
): Promise<MeResponse> {
  const latestSession = await resolveLatestSession(account, currentSession);
  const latestActiveAt = latestSession?.last_active_at ?? null;

  if (account.role !== WORKER_ROLE) {
    const accountPermissions = await getAccountPermissions(account);
    const employeeCode = buildAdminEmployeeCode(account.id);

    return {
      role: "admin",
      full_name: account.full_name,
      employee_code: employeeCode,
      position: account.position,
      admin_code: employeeCode,
      status: account.status,
      email: account.email,
      phone: account.phone,
      permission_level: account.permission_level,
      permissions: accountPermissions.permissions,
      lang: account.lang,
      latest_active_at: latestActiveAt,
    };
  }

  const [profile, currentWorkSchedule] = await Promise.all([
    profileRepository.findByAccountId(account.id),
    workScheduleRepository.findCurrentByAccountId(account.id),
  ]);
  const schedule = formatScheduleWithShift(currentWorkSchedule);

  return {
    role: "worker",
    full_name: account.full_name,
    worker_code: account.username,
    nationality: profile?.nationality ?? null,
    shirt_number: profile?.shirt_number ?? null,
    shirt_type: profile?.shirt_type ?? null,
    work_start_date: profile?.work_start_date ?? null,
    phone: account.phone,
    lang: account.lang,
    shift: formatProfileCardShift(schedule),
    // เงื่อนไขเดียวกับที่ workerOnline ใช้ตรวจก่อน throw OUTSIDE_WORK_SHIFT — ต้องมี schedule และ
    // เวลาปัจจุบันต้องอยู่ในช่วงกะ ห้าม duplicate logic นี้แยกที่อื่น
    shift_active: Boolean(
      currentWorkSchedule && isTimeInWorkSchedule(currentWorkSchedule),
    ),
  };
}

// Function ตรวจสอบและดึง worker device ใน service flow
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

// Function ค้นหาหรือตัดสิน login device ใน service flow
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

// Function สร้าง session ใน service flow
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
    session,
  };
}

// Function สร้าง auth success response ใน service flow
async function buildAuthSuccessResponse(
  tokens: AuthTokens
): Promise<AuthSuccessResponse> {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: "Bearer",
    expires_in: getAccessTokenExpiresInSeconds(),
  };
}

// Function จัดการ login ใน service flow
export async function login(body: unknown) {
  const {
    username,
    password,
    device_id: deviceId,
    device_name: deviceName,
    fcm_token: fcmToken,
    platform,
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
      await revokeWorkerPushTokensBySession(activeSession.id, transaction);
    }

    const tokens = await createSession(
      account,
      sessionDevice.deviceId,
      sessionDevice.deviceName,
      transaction
    );
    if (account.role === WORKER_ROLE) {
      await registerWorkerPushTokenForAccount(
        {
          worker_code: account.username,
          session_id: tokens.session.id,
          device_id: sessionDevice.deviceId,
          platform,
          fcm_token: fcmToken,
        },
        transaction
      );
    }

    return buildAuthSuccessResponse(tokens);
  });
}

// Function ยืนยัน force login ใน service flow
export async function confirmForceLogin(body: unknown) {
  const {
    login_challenge_token: loginChallengeToken,
    device_id: deviceId,
    device_name: deviceName,
    fcm_token: fcmToken,
    platform,
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

  if (account.role === WORKER_ROLE) {
    const notificationPayload = {
      reason: "force_login",
      old_device_id: oldSession.device_id,
      old_device_name: oldSession.device_name,
      new_device_id: deviceId,
      new_device_name: deviceName,
    };

    sendWorkerSocketEvent(account.id, "SESSION_REVOKED", notificationPayload, {
      push: false,
      notificationKey: "auth.session_revoked",
      notificationParams: notificationPayload,
      fallbackTitle: "Signed in on another device",
      fallbackMessage:
        "This session was signed out because login was confirmed on another device.",
    });
    await sendWorkerPushNotificationToSession({
      session_id: oldSession.id,
      type: "SESSION_REVOKED",
      title: "Signed in on another device",
      message:
        "This session was signed out because login was confirmed on another device.",
      notification_key: "auth.session_revoked",
      notification_params: notificationPayload,
      lang: account.lang,
      payload: notificationPayload,
    });
  }

  return withTransaction(async (transaction) => {
    await sessionRepository.revoke(oldSession.id, transaction);
    await revokeWorkerPushTokensBySession(oldSession.id, transaction);

    const tokens = await createSession(account, deviceId, deviceName, transaction);
    if (account.role === WORKER_ROLE) {
      await registerWorkerPushTokenForAccount(
        {
          worker_code: account.username,
          session_id: tokens.session.id,
          device_id: deviceId,
          platform,
          fcm_token: fcmToken,
        },
        transaction
      );
    }

    return buildAuthSuccessResponse(tokens);
  });
}

// Function refresh refresh ใน service flow
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

// Function จัดการ logout ใน service flow
export async function logout(auth?: AccessTokenPayload) {
  if (!auth || !auth.session_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  await withTransaction(async (transaction) => {
    await sessionRepository.revoke(auth.session_id, transaction);
    await revokeWorkerPushTokensBySession(auth.session_id, transaction);
  });

  return {
    message: "Logged out successfully.",
  };
}

// Function จัดการ register worker push token ใน service flow
export async function registerWorkerPushToken(
  auth: AccessTokenPayload | undefined,
  session: SessionDto | undefined,
  body: unknown
) {
  return registerWorkerPushTokenForSession(auth, session, body);
}

// Function จัดการ me ใน service flow
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

// Function จัดการ change own password ใน service flow
export async function changeOwnPassword(
  auth: AccessTokenPayload | undefined,
  body: unknown
): Promise<{ message: string }> {
  if (!auth || !auth.account_id || !auth.session_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const { current_password: currentPassword, new_password: newPassword } =
    parseWithSchema(changeOwnPasswordBodySchema, body);
  const account = await accountRepository.findById(auth.account_id);

  if (!account || account.status !== "active") {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  if (!(await verifyPassword(currentPassword, account.password_hash))) {
    throw new ApiError(
      400,
      "INVALID_CURRENT_PASSWORD",
      "Current password is incorrect."
    );
  }

  return withTransaction(async (transaction) => {
    await accountRepository.updatePassword(
      account.id,
      await hashPassword(newPassword),
      transaction
    );
    await sessionRepository.revokeActiveByAccountIdExcept(
      account.id,
      auth.session_id,
      transaction
    );

    return {
      message: "Password changed successfully.",
    };
  });
}

export async function updateOwnLang(
  auth: AccessTokenPayload | undefined,
  body: unknown
): Promise<UpdateLangResponse> {
  if (!auth || !auth.account_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const { lang } = parseWithSchema(updateOwnLangBodySchema, body);
  const account = await accountRepository.findById(auth.account_id);

  if (!account || account.status !== "active") {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const updatedAccount = await accountRepository.updateLang(account.id, lang);

  return {
    message: "Language updated successfully.",
    lang: updatedAccount.lang,
  };
}
