// import Config
import { ADMIN_PERMISSION_LEVELS, canManagePermissionLevel } from "../config/permission.config";
import { RUNTIME_SETTING_KEYS } from "../config/runtime.config";
import type { RuntimeSettingKey } from "../config/runtime.config";
// import
import { withTransaction } from "../db/prisma";
import { accountRepository, listSettings, permissionRepository, sessionRepository, upsertSettings } from "../repositories/admin-settings.repository";
// import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { DbConnection } from "../types/common.type";
import type { AccountDto } from "../types/admin-workers.type";
import type { AccountPermissionsResponse, RuntimeSettingsResponse } from "../types/admin-settings.type";
// import Validation
import { parseId, parseWithSchema } from "../validation/parser";
import { createAdminAccountBodySchema, runtimeSettingsSchema, updateAccountPermissionsBodySchema, updateSystemSettingsBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";
import { hashPassword } from "../utils/password";

/* -------------------------------------- Config -------------------------------------- */

// Config ระยะเวลา cache runtime settings เพื่อลดการ query DB ซ้ำ
const SETTINGS_CACHE_TTL_MS = 30 * 1000;

let cachedSettings:
  | {
      expiresAt: number;
      value: RuntimeSettingsResponse;
    }
  | null = null;

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง id ของ admin ที่แก้ไขข้อมูล
function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
}

// Function ตรวจว่า admin ผู้แก้มีลำดับยศสูงกว่า target และระดับใหม่ที่จะกำหนด
async function assertCanManageAdminPermissions(
  targetAccount: AccountDto,
  nextPermissionLevel: string,
  auth?: AccessTokenPayload
): Promise<void> {
  const actorId = getActorId(auth);

  if (!actorId) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }

  const actorAccount = await accountRepository.findAdminById(actorId);

  if (!actorAccount) {
    throw new ApiError(403, "ADMIN_ACTOR_NOT_FOUND", "Admin actor not found.");
  }

  if (actorAccount.id === targetAccount.id) {
    throw new ApiError(
      403,
      "CANNOT_UPDATE_OWN_PERMISSIONS",
      "Admin cannot update their own permissions."
    );
  }

  if (!canManagePermissionLevel(actorAccount.permission_level, targetAccount.permission_level)) {
    throw new ApiError(
      403,
      "TARGET_PERMISSION_LEVEL_NOT_MANAGEABLE",
      "Admin cannot update permissions for an equal or higher permission level."
    );
  }

  if (!canManagePermissionLevel(actorAccount.permission_level, nextPermissionLevel)) {
    throw new ApiError(
      403,
      "NEW_PERMISSION_LEVEL_NOT_MANAGEABLE",
      "Admin cannot assign an equal or higher permission level."
    );
  }
}

// Function แปลง settings จาก DB แล้ว validate เป็น number โดยไม่ใช้ค่า fallback
// Function ตรวจว่า admin ผู้สร้างมี permission level สูงกว่า admin level ที่จะสร้าง
async function assertCanCreateAdminLevel(
  nextPermissionLevel: string,
  auth?: AccessTokenPayload
): Promise<void> {
  const actorId = getActorId(auth);

  if (!actorId) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }

  const actorAccount = await accountRepository.findAdminById(actorId);

  if (!actorAccount) {
    throw new ApiError(403, "ADMIN_ACTOR_NOT_FOUND", "Admin actor not found.");
  }

  if (!canManagePermissionLevel(actorAccount.permission_level, nextPermissionLevel)) {
    throw new ApiError(
      403,
      "NEW_PERMISSION_LEVEL_NOT_MANAGEABLE",
      "Admin cannot create an equal or higher permission level."
    );
  }
}

// Function ตรวจว่า username admin ยังไม่ถูกใช้ก่อนสร้าง account ใหม่
async function assertAdminUsernameAvailable(username: string): Promise<void> {
  const exists = await accountRepository.usernameExists(username);

  if (exists) {
    throw new ApiError(
      409,
      "USERNAME_ALREADY_EXISTS",
      "Username already exists."
    );
  }
}

function mergeRuntimeSettings(
  storedSettings: { key: string; value: string }[]
): RuntimeSettingsResponse {
  const rawSettings: Partial<Record<RuntimeSettingKey, unknown>> = {};

  for (const setting of storedSettings) {
    if (RUNTIME_SETTING_KEYS.includes(setting.key as RuntimeSettingKey)) {
      rawSettings[setting.key as RuntimeSettingKey] = setting.value;
    }
  }

  const missingKeys = RUNTIME_SETTING_KEYS.filter(
    (key) => rawSettings[key] === undefined
  );

  if (missingKeys.length > 0) {
    throw new ApiError(
      500,
      "SYSTEM_SETTINGS_NOT_CONFIGURED",
      "System settings are not fully configured.",
      {
        missing_settings: missingKeys,
      }
    );
  }

  return parseWithSchema(runtimeSettingsSchema, rawSettings);
}

// Function ล้าง cache settings หลัง admin แก้ค่า
export function clearRuntimeSettingsCache(): void {
  cachedSettings = null;
}

// Function ดึง runtime settings สำหรับ business flow
export async function getRuntimeSettings(): Promise<RuntimeSettingsResponse> {
  if (cachedSettings && cachedSettings.expiresAt > Date.now()) {
    return cachedSettings.value;
  }

  const settings = mergeRuntimeSettings(await listSettings());

  cachedSettings = {
    expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
    value: settings,
  };

  return settings;
}

// Function ดึง settings ทั้งหมดสำหรับ Admin
export async function listSystemSettings(): Promise<RuntimeSettingsResponse> {
  return getRuntimeSettings();
}

// Function แก้ settings ของระบบและ refresh cache
export async function updateSystemSettings(
  body: unknown,
  auth?: AccessTokenPayload
): Promise<RuntimeSettingsResponse> {
  const input = parseWithSchema(updateSystemSettingsBodySchema, body);
  const settingsToSave = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, String(value)])
  );

  await upsertSettings(settingsToSave, getActorId(auth));
  clearRuntimeSettingsCache();

  return getRuntimeSettings();
}

// Function ดึงรายการ role template สำหรับ Admin Web
export async function listRoles() {
  return {
    data: ADMIN_PERMISSION_LEVELS.map((level, index) => ({
      key: level,
      name: level
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
      order: index,
    })),
  };
}

// Function ดึง permissions จาก DB ของ account เท่านั้น
// Function สร้าง admin account ใหม่ผ่าน Settings/Permissions พร้อม permission level และ permissions เริ่มต้น
export async function createAdminAccount(
  body: unknown,
  auth?: AccessTokenPayload
) {
  const input = parseWithSchema(createAdminAccountBodySchema, body);
  const actorId = getActorId(auth);

  await assertCanCreateAdminLevel(input.permission_level, auth);
  await assertAdminUsernameAvailable(input.username);

  return withTransaction(async (transaction) => {
    const account = await accountRepository.createAdmin(
      {
        username: input.username,
        password_hash: await hashPassword(input.password),
        role: "admin",
        status: input.status,
        full_name: input.full_name,
        position: input.position ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        permission_level: input.permission_level,
        created_by: actorId,
      },
      transaction
    );

    await permissionRepository.replaceAccountPermissions(
      account.id,
      input.permissions,
      transaction
    );

    return {
      message: "Admin account created successfully.",
      account: accountRepository.sanitizeAccount(account),
      ...(await getAccountPermissions(account, transaction)),
    };
  });
}

export async function getAccountPermissions(
  account: AccountDto,
  connection?: DbConnection
): Promise<AccountPermissionsResponse> {
  return {
    account_id: account.id,
    role: account.role,
    permission_level: account.permission_level,
    permissions: await permissionRepository.listByAccountId(account.id, connection),
  };
}

// Function ดึง permissions ของ admin account รายคน
export async function getAdminUserPermissions(
  accountIdParam: unknown
): Promise<AccountPermissionsResponse> {
  const accountId = parseId(accountIdParam);
  const account = await accountRepository.findAdminById(accountId);

  if (!account) {
    throw new ApiError(404, "ADMIN_NOT_FOUND", "Admin account not found.");
  }

  return getAccountPermissions(account);
}

// Function แก้ permissions ของ admin account และ revoke sessions เดิม
export async function updateAdminUserPermissions(
  accountIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<AccountPermissionsResponse & { message: string }> {
  const accountId = parseId(accountIdParam);
  const input = parseWithSchema(updateAccountPermissionsBodySchema, body);
  const account = await accountRepository.findAdminById(accountId);

  if (!account) {
    throw new ApiError(404, "ADMIN_NOT_FOUND", "Admin account not found.");
  }

  await assertCanManageAdminPermissions(account, input.permission_level, auth);

  return withTransaction(async (transaction) => {
    const updatedAccount = await accountRepository.updatePermissionLevel(
      account.id,
      input.permission_level,
      transaction
    );

    await permissionRepository.replaceAccountPermissions(
      account.id,
      input.permissions,
      transaction
    );
    await sessionRepository.revokeActiveByAccountId(account.id, transaction);

    return {
      message: "Admin permissions updated successfully. Active sessions were revoked.",
      ...(await getAccountPermissions(updatedAccount, transaction)),
    };
  });
}
