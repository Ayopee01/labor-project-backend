import { accountRepository, sessionRepository } from "../repositories/auth.repository";
import * as masterWorkerRepository from "../repositories/shared/master-worker.repository";
import * as workerSessionRepository from "../repositories/shared/worker-session.repository";
import { AUTH_DEFAULTS, getAccessTokenExpiresInSeconds } from "../config/auth.config";
import { getAccountPermissions } from "./shared/account-permission.service";
import { registerWorkerPushToken as registerWorkerPushTokenForSession, registerWorkerPushTokenForAccount, revokeWorkerPushTokensBySession, sendWorkerPushNotificationToSession } from "./shared/worker-push.service";
import { diffChangedFields, writeSecurityAuditLog, writeSecurityAuditLogBestEffort } from "./shared/security-audit-log.service";
import { sendWorkerSocketEvent } from "../websockets/worker.socket";
import { deleteAdminProfileImageLocal as deleteAdminProfileImageByUrl } from "../config/local-storage";
import { withTransaction } from "../db/prisma";
import { SECURITY_AUDIT_EVENT_TYPE, SECURITY_AUDIT_OUTCOME } from "../types/shared/security-audit-log.type";
import type { AccessTokenPayload, AuthSuccessResponse, AuthTokens, MeResponse, ProfileCardShift, SessionDto, UpdateLangResponse } from "../types/auth.type";
import type { DbConnection } from "../types/shared/common.type";
import type { AccountDto, MasterWorkerDto } from "../types/admin-workers.type";
import type { SecurityAuditRequestContext } from "../types/shared/security-audit-log.type";
import { parseWithSchema } from "../validation/parser";
import { changeOwnPasswordBodySchema, confirmForceLoginBodySchema, loginBodySchema, refreshBodySchema, updateOwnLangBodySchema, updateOwnProfileBodySchema } from "../validation/schemas";
import ApiError from "../utils/api-error";
import { signAccessToken, signLoginChallengeToken, signRefreshToken, verifyLoginChallengeToken, verifyRefreshToken } from "../utils/jwt";
import { logger } from "../utils/logger";
import { hashPassword, verifyPassword } from "../utils/password";
import { hashRefreshToken, refreshTokenHashesMatch } from "../utils/refresh-token-hash";
import { formatScheduleWithShift } from "../utils/shift";

/* -------------------------------------- Config -------------------------------------- */

const WORKER_ROLE = "worker";

const ADMIN_SESSION_DEVICE_NAME = "Admin Web";

// Config hash หลอกสำหรับกันไม่ให้ /auth/login ตอบเร็วขึ้นเวลา identifier ไม่มีอยู่จริง (เทียบกับ
// identifier ที่มีจริงแต่ password ผิด) — ถ้า login() short-circuit ข้าม verifyPassword ไปเลยตอนหา
// account/worker ไม่เจอ เวลาตอบสนองจะเร็วกว่ากรณี identifier มีจริงอย่างสม่ำเสมอ (argon2 verify ใช้
// เวลาคงที่หลายสิบ ms) ทำให้แยกแยะได้จาก response time แม้ error message/status code จะเหมือนกันทุกกรณี
// — hash เดียวนี้ compute ครั้งเดียวตอน module โหลด แล้วใช้แทน password_hash เมื่อไม่พบ account/worker
// เพื่อให้ argon2.verify ทำงานจริงเสมอ ไม่ว่า identifier จะมีอยู่จริงหรือไม่
const dummyPasswordHashPromise = hashPassword(
  "dummy-password-for-constant-time-login-check"
);

/* -------------------------------------- Admin (Account) helpers -------------------------------------- */

// Function ดึง account ที่ต้อง active จริงตาม ID — ใช้ร่วมกันทุก flow ที่ต้องเช็คสถานะ account
// ก่อนทำงานต่อ (pre-auth flow โยน 423 ACCOUNT_INACTIVE, self-service flow โยน 401 INVALID_TOKEN
// เพื่อไม่ให้รู้ว่า account มีอยู่จริงแต่ inactive)
async function requireActiveAccountById(
  accountId: number,
  statusCode: number,
  errorCode: string,
  errorMessage: string
): Promise<AccountDto> {
  const account = await accountRepository.findById(accountId);

  if (!account || account.status !== "active") {
    throw new ApiError(statusCode, errorCode, errorMessage);
  }

  return account;
}

// Function ดึง worker ที่ต้อง active จริงตาม ID — คู่ขนานของ requireActiveAccountById ฝั่ง Admin
async function requireActiveWorkerById(
  workerId: number,
  statusCode: number,
  errorCode: string,
  errorMessage: string
): Promise<MasterWorkerDto> {
  const worker = await masterWorkerRepository.findById(workerId);

  if (!worker || worker.status !== 1) {
    throw new ApiError(statusCode, errorCode, errorMessage);
  }

  return worker;
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

// Function สร้าง me response ของ Admin ใน service flow
async function buildAdminMeResponse(
  account: AccountDto,
  currentSession?: SessionDto | null
): Promise<MeResponse> {
  const latestSession = currentSession ?? (await sessionRepository.findActiveByAccountId(account.id));
  const latestActiveAt = latestSession?.last_active_at ?? null;
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
    // ต้องเป็น null เสมอเมื่อยังไม่มีรูป ห้ามละ field ทิ้ง (Frontend ต้องแยก "ยังไม่มีรูป" ออกจาก
    // response รุ่นเก่าที่ไม่มี contract นี้ได้)
    image_url: account.image_url ?? null,
    permission_level: account.permission_level,
    permissions: accountPermissions.permissions,
    lang: account.lang,
    latest_active_at: latestActiveAt,
  };
}

// Function สร้าง me response ของ Worker ใน service flow
function buildWorkerMeResponse(worker: MasterWorkerDto): MeResponse {
  const schedule = formatScheduleWithShift(
    worker.shift_no !== null && worker.shift_start_time !== null && worker.shift_end_time !== null
      ? {
          id: worker.id,
          worker_id: worker.id,
          shift_no: worker.shift_no,
          work_date: worker.work_start_date ?? worker.created_at.slice(0, 10),
          shift_start_time: worker.shift_start_time,
          shift_end_time: worker.shift_end_time,
          is_current: true,
          created_by: null,
          updated_by: null,
          created_at: worker.created_at,
          updated_at: worker.updated_at,
        }
      : null
  );

  return {
    role: "worker",
    full_name: worker.full_name,
    worker_code: worker.labor_code,
    nationality: worker.nationality,
    shirt_type: worker.labor_color,
    shirt_number: worker.coat_no,
    work_start_date: worker.work_start_date,
    phone: worker.telephone,
    lang: worker.lang,
    shift: formatProfileCardShift(schedule),
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

// Function สร้าง admin session ใน service flow
async function createAdminSession(
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
    role: account.role,
    session_id: session.id,
  });

  await sessionRepository.updateRefreshTokenHash(
    session.id,
    hashRefreshToken(refreshToken),
    session.refresh_token_hash,
    connection
  );

  return {
    accessToken,
    refreshToken,
    session,
  };
}

// Function สร้าง worker session ใน service flow — คู่ขนานของ createAdminSession แต่เขียนลง
// worker_sessions และ MasterWorker ไม่มี permission ให้ต้อง query
async function createWorkerSession(
  worker: MasterWorkerDto,
  deviceId: string,
  deviceName: string,
  connection: DbConnection
): Promise<AuthTokens> {
  const expiresAt = new Date(
    Date.now() + AUTH_DEFAULTS.sessionExpiresInMilliseconds
  ).toISOString();
  const session = await workerSessionRepository.createPending(
    {
      account_id: worker.id,
      device_id: deviceId,
      device_name: deviceName,
      expires_at: expiresAt,
    },
    connection
  );
  const accessToken = signAccessToken({
    account_id: worker.id,
    role: WORKER_ROLE,
    permission_level: null,
    permissions: [],
    session_id: session.id,
  });
  const refreshToken = signRefreshToken({
    account_id: worker.id,
    role: WORKER_ROLE,
    session_id: session.id,
  });

  await workerSessionRepository.updateRefreshTokenHash(
    session.id,
    hashRefreshToken(refreshToken),
    session.refresh_token_hash,
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

/* -------------------------------------- Functions -------------------------------------- */

const EMPTY_SECURITY_AUDIT_CONTEXT: SecurityAuditRequestContext = {
  ip_address: null,
  user_agent: null,
  request_id: null,
};

// Function จัดการ login ใน service flow — dispatch ไปหา Account (Admin) หรือ MasterWorker (Worker)
// ตาม username ที่ตรงกัน (Worker login ด้วย LaborCode เป็น username) ต้องเรียก verifyPassword เสมอ
// ไม่ว่าจะเจอ identity ฝั่งไหนหรือไม่เจอเลย เพื่อกัน timing-based username enumeration
export async function login(
  body: unknown,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
) {
  const {
    username,
    password,
    device_id: deviceId,
    device_name: deviceName,
    fcm_token: fcmToken,
    platform,
  } = parseWithSchema(loginBodySchema, body);
  const account = await accountRepository.findByUsername(username);
  const worker = account ? null : await masterWorkerRepository.findByLaborCode(username);
  const passwordHash =
    account?.password_hash ?? worker?.password_hash ?? (await dummyPasswordHashPromise);
  const passwordValid = await verifyPassword(password, passwordHash);

  if ((!account && !worker) || !passwordValid) {
    // Fire-and-forget (ไม่ await) เพื่อไม่ให้เวลาตอบสนองของ 401 ขึ้นกับเวลาที่ DB เขียน log เสร็จ —
    // ทั้งสอง branch (username ไม่มี / password ผิด) เขียน log แบบเดียวกันเป๊ะ (ไม่ await ทั้งคู่) จึง
    // ไม่สร้างช่องทาง timing ใหม่ระหว่างสอง case นี้ ส่วน response ยังคงเป็นข้อความเดียวกันเสมอ (401
    // INVALID_CREDENTIALS) ไม่เปิดช่อง username enumeration ใน response
    void writeSecurityAuditLogBestEffort({
      event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_LOGIN_FAILED,
      outcome: SECURITY_AUDIT_OUTCOME.FAILURE,
      actor_type: account ? "admin" : worker ? "worker" : null,
      actor_account_id: account?.id ?? null,
      actor_worker_id: worker?.id ?? null,
      actor_username: account?.username ?? worker?.labor_code ?? username,
      actor_full_name: account?.full_name ?? worker?.full_name ?? null,
      failure_code: !account && !worker ? "unknown_username" : "invalid_password",
      ip_address: context.ip_address,
      user_agent: context.user_agent,
      request_id: context.request_id,
    });

    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid username or password."
    );
  }

  if (account) {
    if (account.status !== "active") {
      void writeSecurityAuditLogBestEffort({
        event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_LOGIN_FAILED,
        outcome: SECURITY_AUDIT_OUTCOME.FAILURE,
        actor_type: "admin",
        actor_account_id: account.id,
        actor_username: account.username,
        actor_full_name: account.full_name,
        failure_code: "account_inactive",
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
      });

      throw new ApiError(423, "ACCOUNT_INACTIVE", "Account is inactive.");
    }

    const activeSession = await sessionRepository.findActiveByAccountId(account.id);
    const sessionDevice = {
      deviceId: getDefaultSessionDeviceId(account),
      deviceName: getDefaultSessionDeviceName(account),
    };

    return withTransaction(async (transaction) => {
      if (activeSession) {
        await sessionRepository.revoke(activeSession.id, transaction);
      }

      const tokens = await createAdminSession(
        account,
        sessionDevice.deviceId,
        sessionDevice.deviceName,
        transaction
      );

      await writeSecurityAuditLog(
        {
          event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_LOGIN_SUCCEEDED,
          outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
          actor_type: "admin",
          actor_account_id: account.id,
          actor_username: account.username,
          actor_full_name: account.full_name,
          session_id: tokens.session.id,
          ip_address: context.ip_address,
          user_agent: context.user_agent,
          request_id: context.request_id,
        },
        transaction
      );

      return buildAuthSuccessResponse(tokens);
    });
  }

  const activeWorker = worker as MasterWorkerDto;

  if (activeWorker.status !== 1) {
    void writeSecurityAuditLogBestEffort({
      event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_LOGIN_FAILED,
      outcome: SECURITY_AUDIT_OUTCOME.FAILURE,
      actor_type: "worker",
      actor_worker_id: activeWorker.id,
      actor_username: activeWorker.labor_code,
      actor_full_name: activeWorker.full_name,
      failure_code: "account_inactive",
      ip_address: context.ip_address,
      user_agent: context.user_agent,
      request_id: context.request_id,
    });

    throw new ApiError(423, "ACCOUNT_INACTIVE", "Account is inactive.");
  }

  const activeSession = await workerSessionRepository.findActiveByWorkerId(activeWorker.id);
  const sessionDevice = requireWorkerDevice(deviceId, deviceName);

  if (activeSession && activeSession.device_id !== sessionDevice.deviceId) {
    const loginChallengeToken = signLoginChallengeToken({
      account_id: activeWorker.id,
      role: WORKER_ROLE,
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
      await workerSessionRepository.revoke(activeSession.id, transaction);
      await revokeWorkerPushTokensBySession(activeSession.id, transaction);
    }

    const tokens = await createWorkerSession(
      activeWorker,
      sessionDevice.deviceId,
      sessionDevice.deviceName,
      transaction
    );
    await registerWorkerPushTokenForAccount(
      {
        worker_id: activeWorker.id,
        worker_code: activeWorker.labor_code,
        session_id: tokens.session.id,
        device_id: sessionDevice.deviceId,
        platform,
        fcm_token: fcmToken,
      },
      transaction
    );

    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_LOGIN_SUCCEEDED,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "worker",
        actor_worker_id: activeWorker.id,
        actor_username: activeWorker.labor_code,
        actor_full_name: activeWorker.full_name,
        session_id: tokens.session.id,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
      },
      transaction
    );

    return buildAuthSuccessResponse(tokens);
  });
}

// Function ดึง default session device ID ของ Admin ใน service flow
function getDefaultSessionDeviceId(account: AccountDto): string {
  return `admin:${account.id}`;
}

// Function ดึง default session device name ของ Admin ใน service flow
function getDefaultSessionDeviceName(_account: AccountDto): string {
  return ADMIN_SESSION_DEVICE_NAME;
}

// Function ยืนยัน force login ใน service flow
export async function confirmForceLogin(
  body: unknown,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
) {
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

  if (challenge.role === WORKER_ROLE) {
    const oldSession = await workerSessionRepository.findActiveById(challenge.old_session_id);

    if (!oldSession || oldSession.account_id !== challenge.account_id) {
      throw new ApiError(
        401,
        "INVALID_LOGIN_CHALLENGE",
        "Login challenge session is no longer active."
      );
    }

    const worker = await requireActiveWorkerById(
      challenge.account_id,
      423,
      "ACCOUNT_INACTIVE",
      "Account is inactive."
    );
    const notificationPayload = {
      reason: "force_login",
      old_device_id: oldSession.device_id,
      old_device_name: oldSession.device_name,
      new_device_id: deviceId,
      new_device_name: deviceName,
    };

    sendWorkerSocketEvent(worker.id, "SESSION_REVOKED", notificationPayload, {
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
      lang: worker.lang,
      payload: notificationPayload,
    });

    return withTransaction(async (transaction) => {
      await workerSessionRepository.revoke(oldSession.id, transaction);
      await revokeWorkerPushTokensBySession(oldSession.id, transaction);

      const tokens = await createWorkerSession(worker, deviceId, deviceName, transaction);
      await registerWorkerPushTokenForAccount(
        {
          worker_id: worker.id,
          worker_code: worker.labor_code,
          session_id: tokens.session.id,
          device_id: deviceId,
          platform,
          fcm_token: fcmToken,
        },
        transaction
      );

      // auth_session_revoked แยกจาก auth_force_login (27.14.1) — session_id คือ target session ที่
      // ถูก revoke (ต่างจาก auth_force_login ที่ session_id คือ session ใหม่ที่สร้างขึ้น) ใช้
      // request_id เดียวกันเพื่อ trace 2 event นี้กลับมาหากันได้จาก operation เดียวกัน
      await writeSecurityAuditLog(
        {
          event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_SESSION_REVOKED,
          outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
          actor_type: "worker",
          actor_worker_id: worker.id,
          actor_username: worker.labor_code,
          actor_full_name: worker.full_name,
          session_id: oldSession.id,
          ip_address: context.ip_address,
          user_agent: context.user_agent,
          request_id: context.request_id,
          metadata: { revoke_source: "force_login", new_session_id: tokens.session.id },
        },
        transaction
      );

      await writeSecurityAuditLog(
        {
          event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_FORCE_LOGIN,
          outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
          actor_type: "worker",
          actor_worker_id: worker.id,
          actor_username: worker.labor_code,
          actor_full_name: worker.full_name,
          session_id: tokens.session.id,
          ip_address: context.ip_address,
          user_agent: context.user_agent,
          request_id: context.request_id,
          metadata: { revoked_session_id: oldSession.id },
        },
        transaction
      );

      return buildAuthSuccessResponse(tokens);
    });
  }

  const oldSession = await sessionRepository.findActiveById(challenge.old_session_id);

  if (!oldSession || oldSession.account_id !== challenge.account_id) {
    throw new ApiError(
      401,
      "INVALID_LOGIN_CHALLENGE",
      "Invalid login challenge."
    );
  }

  const account = await requireActiveAccountById(
    challenge.account_id,
    423,
    "ACCOUNT_INACTIVE",
    "Account is inactive."
  );

  return withTransaction(async (transaction) => {
    await sessionRepository.revoke(oldSession.id, transaction);

    const tokens = await createAdminSession(account, deviceId, deviceName, transaction);

    // auth_session_revoked แยกจาก auth_force_login (27.14.1) — session_id คือ target session ที่ถูก
    // revoke (ต่างจาก auth_force_login ที่ session_id คือ session ใหม่ที่สร้างขึ้น) ใช้ request_id
    // เดียวกันเพื่อ trace 2 event นี้กลับมาหากันได้จาก operation เดียวกัน
    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_SESSION_REVOKED,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "admin",
        actor_account_id: account.id,
        actor_username: account.username,
        actor_full_name: account.full_name,
        session_id: oldSession.id,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
        metadata: { revoke_source: "force_login", new_session_id: tokens.session.id },
      },
      transaction
    );

    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_FORCE_LOGIN,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "admin",
        actor_account_id: account.id,
        actor_username: account.username,
        actor_full_name: account.full_name,
        session_id: tokens.session.id,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
        metadata: { revoked_session_id: oldSession.id },
      },
      transaction
    );

    return buildAuthSuccessResponse(tokens);
  });
}

// Function refresh refresh ใน service flow
export async function refresh(body: unknown) {
  const { refresh_token: refreshToken } = parseWithSchema(refreshBodySchema, body);
  const payload = verifyRefreshToken(refreshToken);

  if (payload.role === WORKER_ROLE) {
    const session = await workerSessionRepository.findActiveById(payload.session_id);

    if (!session || session.account_id !== payload.account_id) {
      throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token.");
    }

    const candidateHash = hashRefreshToken(refreshToken);

    if (!refreshTokenHashesMatch(candidateHash, session.refresh_token_hash)) {
      throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token.");
    }

    const worker = await requireActiveWorkerById(
      payload.account_id,
      423,
      "ACCOUNT_INACTIVE",
      "Account is inactive."
    );

    const accessToken = signAccessToken({
      account_id: worker.id,
      role: WORKER_ROLE,
      permission_level: null,
      permissions: [],
      session_id: session.id,
    });
    const nextRefreshToken = signRefreshToken({
      account_id: worker.id,
      role: WORKER_ROLE,
      session_id: session.id,
    });
    const rotated = await workerSessionRepository.updateRefreshTokenHash(
      session.id,
      hashRefreshToken(nextRefreshToken),
      session.refresh_token_hash
    );

    if (!rotated) {
      throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token.");
    }

    return {
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      token_type: "Bearer",
      expires_in: getAccessTokenExpiresInSeconds(),
    };
  }

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

  const account = await requireActiveAccountById(
    payload.account_id,
    423,
    "ACCOUNT_INACTIVE",
    "Account is inactive."
  );

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
    role: account.role,
    session_id: session.id,
  });

  const rotated = await sessionRepository.updateRefreshTokenHash(
    session.id,
    hashRefreshToken(nextRefreshToken),
    session.refresh_token_hash
  );

  if (!rotated) {
    // แพ้ race ให้อีก request ที่ใช้ refresh token เดิมตัวเดียวกันนี้รีเฟรชไปก่อนแล้วเสี้ยววินาที
    // ก่อนหน้า (เช่น 2 tab/2 request ที่เจอ 401 พร้อมกันแล้ว trigger refresh พร้อมกันด้วย token
    // เดิม) — refresh token ที่ใช้ในคำขอนี้ไม่ใช่ตัวล่าสุดของ session นี้อีกต่อไปแล้วจริงๆ
    throw new ApiError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Invalid refresh token."
    );
  }

  return {
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    token_type: "Bearer",
    expires_in: getAccessTokenExpiresInSeconds(),
  };
}

// Function จัดการ logout ใน service flow
export async function logout(
  auth?: AccessTokenPayload,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
) {
  if (!auth || !auth.session_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  if (auth.role === WORKER_ROLE) {
    const worker = await masterWorkerRepository.findById(auth.account_id);

    await withTransaction(async (transaction) => {
      await workerSessionRepository.revoke(auth.session_id, transaction);
      await revokeWorkerPushTokensBySession(auth.session_id, transaction);

      await writeSecurityAuditLog(
        {
          event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_LOGOUT,
          outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
          actor_type: "worker",
          actor_worker_id: auth.account_id,
          actor_username: worker?.labor_code ?? null,
          actor_full_name: worker?.full_name ?? null,
          session_id: auth.session_id,
          ip_address: context.ip_address,
          user_agent: context.user_agent,
          request_id: context.request_id,
        },
        transaction
      );
    });

    return {
      message: "Logged out successfully.",
    };
  }

  const account = await accountRepository.findById(auth.account_id);

  await withTransaction(async (transaction) => {
    await sessionRepository.revoke(auth.session_id, transaction);

    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.AUTH_LOGOUT,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "admin",
        actor_account_id: auth.account_id,
        actor_username: account?.username ?? null,
        actor_full_name: account?.full_name ?? null,
        session_id: auth.session_id,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
      },
      transaction
    );
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

  if (auth.role === WORKER_ROLE) {
    const worker = await requireActiveWorkerById(
      auth.account_id,
      401,
      "INVALID_TOKEN",
      "Invalid or expired token."
    );

    return buildWorkerMeResponse(worker);
  }

  const account = await requireActiveAccountById(
    auth.account_id,
    401,
    "INVALID_TOKEN",
    "Invalid or expired token."
  );

  return buildAdminMeResponse(account, currentSession);
}

// Function จัดการ change own password ใน service flow — Admin เท่านั้น (route gate ด้วย
// roleMiddleware(["admin"])) เพราะ Worker password มาจาก telephone เสมอ ไม่มี password อิสระให้เปลี่ยน
export async function changeOwnPassword(
  auth: AccessTokenPayload | undefined,
  body: unknown,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
): Promise<{ message: string }> {
  if (!auth || !auth.account_id || !auth.session_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const { current_password: currentPassword, new_password: newPassword } =
    parseWithSchema(changeOwnPasswordBodySchema, body);
  const account = await requireActiveAccountById(
    auth.account_id,
    401,
    "INVALID_TOKEN",
    "Invalid or expired token."
  );

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
    const revokedSessionCount = await sessionRepository.revokeActiveByAccountIdExcept(
      account.id,
      auth.session_id,
      transaction
    );

    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.ACCOUNT_PASSWORD_CHANGED,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "admin",
        actor_account_id: account.id,
        actor_username: account.username,
        actor_full_name: account.full_name,
        session_id: auth.session_id,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
        metadata: { revokedSessionCount },
      },
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

  if (auth.role === WORKER_ROLE) {
    await requireActiveWorkerById(auth.account_id, 401, "INVALID_TOKEN", "Invalid or expired token.");
    const updatedWorker = await masterWorkerRepository.updateLang(auth.account_id, lang);

    return {
      message: "Language updated successfully.",
      lang: updatedWorker.lang,
    };
  }

  const account = await requireActiveAccountById(
    auth.account_id,
    401,
    "INVALID_TOKEN",
    "Invalid or expired token."
  );

  const updatedAccount = await accountRepository.updateLang(account.id, lang);

  return {
    message: "Language updated successfully.",
    lang: updatedAccount.lang,
  };
}

// Function จัดการ update own profile (full_name/email/phone) ใน service flow — Admin เท่านั้น
// (route gate ด้วย roleMiddleware(["admin"])) ใช้ buildAdminMeResponse เดิมเพื่อคืน profile ล่าสุด
// ในรูปแบบเดียวกันทุกประการ
export async function updateOwnProfile(
  auth: AccessTokenPayload | undefined,
  currentSession: SessionDto | undefined,
  body: unknown,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
): Promise<MeResponse> {
  if (!auth || !auth.account_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const input = parseWithSchema(updateOwnProfileBodySchema, body);
  const account = await requireActiveAccountById(
    auth.account_id,
    401,
    "INVALID_TOKEN",
    "Invalid or expired token."
  );
  // Snapshot ก่อนแก้ไขจริง กัน repository (โดยเฉพาะ mock ของ test) คืน object เดิมแทน fresh copy
  const accountBeforeUpdate = { ...account };

  return withTransaction(async (transaction) => {
    const updatedAccount = await accountRepository.updateProfile(
      account.id,
      {
        full_name: input.full_name,
        email: input.email,
        phone: input.phone,
      },
      transaction
    );
    const diff = diffChangedFields(accountBeforeUpdate, updatedAccount, [
      "full_name",
      "email",
      "phone",
    ]);

    if (diff) {
      await writeSecurityAuditLog(
        {
          event_type: SECURITY_AUDIT_EVENT_TYPE.ADMIN_PROFILE_UPDATED,
          outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
          actor_type: "admin",
          actor_account_id: account.id,
          actor_username: account.username,
          actor_full_name: updatedAccount.full_name,
          session_id: auth.session_id,
          ip_address: context.ip_address,
          user_agent: context.user_agent,
          request_id: context.request_id,
          metadata: {
            targetType: "admin_account",
            targetAccountId: account.id,
            before: diff.before,
            after: diff.after,
          },
        },
        transaction
      );
    }

    return buildAdminMeResponse(updatedAccount, currentSession);
  });
}

// Function จัดการ upload own profile image ใน service flow — Admin เท่านั้น (route gate ด้วย
// roleMiddleware(["admin"])) รูปของ Worker มาจาก MasterWorker.picture (sync จาก Master) เท่านั้น
export async function uploadOwnProfileImage(
  auth: AccessTokenPayload | undefined,
  imageUrl: string,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT
): Promise<{ message: string; image_url: string }> {
  if (!auth || !auth.account_id) {
    throw new ApiError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }

  const account = await requireActiveAccountById(
    auth.account_id,
    401,
    "INVALID_TOKEN",
    "Invalid or expired token."
  );
  const previousImageUrl = account.image_url;

  const result = await withTransaction(async (transaction) => {
    const updatedAccount = await accountRepository.updateProfile(
      account.id,
      { image_url: imageUrl },
      transaction
    );

    await writeSecurityAuditLog(
      {
        event_type: SECURITY_AUDIT_EVENT_TYPE.ADMIN_PROFILE_UPDATED,
        outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
        actor_type: "admin",
        actor_account_id: account.id,
        actor_username: account.username,
        actor_full_name: account.full_name,
        session_id: auth.session_id,
        ip_address: context.ip_address,
        user_agent: context.user_agent,
        request_id: context.request_id,
        metadata: {
          targetType: "admin_account",
          targetAccountId: account.id,
          changed: ["image_url"],
        },
      },
      transaction
    );

    return {
      message: "Profile image uploaded successfully.",
      image_url: updatedAccount.image_url ?? imageUrl,
    };
  });

  // ลบรูปเก่าออกจาก Spaces แบบ best-effort หลัง commit สำเร็จแล้วเท่านั้น (ไม่ทำให้ request หลักล้มเหลว
  // ถ้าลบไม่สำเร็จ) — no-op เงียบๆ ถ้า previousImageUrl เป็น path local เก่าก่อน migrate ไป Spaces
  if (previousImageUrl && previousImageUrl !== imageUrl) {
    await deleteAdminProfileImageByUrl(previousImageUrl).catch((error) => {
      logger.error("Failed to delete previous admin profile image from storage.", { error });
    });
  }

  return result;
}
