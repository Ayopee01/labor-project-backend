// Import Config
import { randomBytes } from "crypto";
import { ADMIN_PERMISSION_LEVELS, canManagePermissionLevel } from "../config/permission.config";
import { RUNTIME_SETTING_KEYS } from "../config/runtime.config";
import type { RuntimeSettingKey } from "../config/runtime.config";
// Import Dependencies
import { withTransaction } from "../db/prisma";
import { accountRepository, gateClientRepository, listSettings, permissionRepository, sessionRepository, upsertSettings } from "../repositories/admin-settings.repository";
// Import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { DbConnection } from "../types/shared/common.type";
import type { AccountDto } from "../types/admin-workers.type";
import type { AccountPermissionsResponse, AdminRoleListResponse, RuntimeSettingsResponse } from "../types/admin-settings.type";
import type { GateClientDto, GateClientListResponse, GateClientMutationResponse, GateClientSecretResponse, PublicGateClient } from "../types/admin-settings.type";
// Import Validation
import { parseId, parseWithSchema } from "../validation/parser";
import { createAdminAccountBodySchema, createGateClientBodySchema, runtimeSettingsSchema, updateAccountPermissionsBodySchema, updateGateClientBodySchema, updateSystemSettingsBodySchema } from "../validation/schemas";
// Import Utils
import ApiError from "../utils/api-error";
import { hashPassword, verifyPassword } from "../utils/password";

/* -------------------------------------- Config -------------------------------------- */

const SETTINGS_CACHE_TTL_MS = 30 * 1000;
const GATE_SECRET_PREFIX = "gate_live_";
const GENERATED_CLIENT_ID_PREFIX = "gate_";
const GENERATED_CLIENT_ID_BYTES = 8;
const GENERATED_SECRET_BYTES = 32;

let cachedSettings:
  | {
      expiresAt: number;
      value: RuntimeSettingsResponse;
    }
  | null = null;

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึง actor ID ใน service flow
function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
}

// Function จัดการ generate Gate client ID ใน service flow
function generateGateClientId(): string {
  return `${GENERATED_CLIENT_ID_PREFIX}${randomBytes(GENERATED_CLIENT_ID_BYTES).toString("hex")}`;
}

// Function จัดการ generate Gate client secret ใน service flow
function generateGateClientSecret(): string {
  return `${GATE_SECRET_PREFIX}${randomBytes(GENERATED_SECRET_BYTES).toString("base64url")}`;
}

// Function อ่านค่า client ID ใน service flow
function parseClientId(value: unknown): string {
  const clientId = String(value ?? "").trim();

  if (!clientId) {
    throw new ApiError(400, "INVALID_GATE_CLIENT_ID", "Gate client id is required.");
  }

  return clientId;
}

// Function จัดการ เป็น public Gate client ใน service flow
function toPublicGateClient(client: GateClientDto): PublicGateClient {
  const { secret_hash: _secretHash, ...publicClient } = client;

  return publicClient;
}

// Function จัดการ generate unique client ID ใน service flow
async function generateUniqueClientId(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clientId = generateGateClientId();

    if (!(await gateClientRepository.clientIdExists(clientId))) {
      return clientId;
    }
  }

  throw new ApiError(
    500,
    "GATE_CLIENT_ID_GENERATION_FAILED",
    "Unable to generate a unique Gate client id."
  );
}

// Function ตรวจสอบและดึง Gate client ใน service flow
async function requireGateClient(clientIdParam: unknown): Promise<GateClientDto> {
  const clientId = parseClientId(clientIdParam);
  const client = await gateClientRepository.findByClientId(clientId);

  if (!client) {
    throw new ApiError(404, "GATE_CLIENT_NOT_FOUND", "Gate client not found.");
  }

  return client;
}

// Function ตรวจสอบเงื่อนไข can manage admin permissions ใน service flow
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

// Function ตรวจสอบเงื่อนไข can create admin level ใน service flow
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

// Function ตรวจสอบเงื่อนไข admin username available ใน service flow
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

// Function ตรวจสอบเงื่อนไข can read admin permissions ใน service flow
async function assertCanReadAdminPermissions(
  targetAccount: AccountDto,
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
      "CANNOT_READ_OWN_PERMISSIONS",
      "Admin cannot read their own permissions through this endpoint. Use /api/auth/me."
    );
  }

  if (!canManagePermissionLevel(actorAccount.permission_level, targetAccount.permission_level)) {
    throw new ApiError(
      403,
      "TARGET_PERMISSION_LEVEL_NOT_READABLE",
      "Admin cannot read permissions for an equal or higher permission level."
    );
  }
}

// Function จัดการ merge runtime settings ใน service flow
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

// Function จัดการ clear runtime settings cache ใน service flow
function clearRuntimeSettingsCache(): void {
  cachedSettings = null;
}

// Function ดึง runtime settings ใน service flow
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

// Function ดึงรายการ system settings ใน service flow
export async function listSystemSettings(): Promise<RuntimeSettingsResponse> {
  return getRuntimeSettings();
}

// Function อัปเดต system settings ใน service flow
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

// Function ดึงรายการ Gate clients ใน service flow
export async function listGateClients(): Promise<GateClientListResponse> {
  const clients = await gateClientRepository.listGateClients();

  return {
    data: clients.map(toPublicGateClient),
  };
}

// Function สร้าง Gate client ใน service flow
export async function createGateClient(
  body: unknown,
  auth?: AccessTokenPayload
): Promise<GateClientSecretResponse> {
  const input = parseWithSchema(createGateClientBodySchema, body);
  const clientId = input.client_id ?? (await generateUniqueClientId());

  if (await gateClientRepository.clientIdExists(clientId)) {
    throw new ApiError(
      409,
      "GATE_CLIENT_ID_ALREADY_EXISTS",
      "Gate client id already exists."
    );
  }

  const clientSecret = generateGateClientSecret();
  const client = await gateClientRepository.createGateClient({
    client_id: clientId,
    name: input.name,
    secret_hash: await hashPassword(clientSecret),
    status: input.status,
    created_by: getActorId(auth),
    updated_by: getActorId(auth),
  });

  return {
    message: "Gate client created successfully. Save client_secret now because it will not be shown again.",
    ...toPublicGateClient(client),
    client_secret: clientSecret,
  };
}

// Function อัปเดต Gate client ใน service flow
export async function updateGateClient(
  clientIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<GateClientMutationResponse> {
  const existingClient = await requireGateClient(clientIdParam);
  const input = parseWithSchema(updateGateClientBodySchema, body);
  const client = await gateClientRepository.updateGateClient(
    existingClient.client_id,
    {
      name: input.name,
      status: input.status,
      updated_by: getActorId(auth),
    }
  );

  return {
    message: "Gate client updated successfully.",
    ...toPublicGateClient(client),
  };
}

// Function จัดการ rotate Gate client secret ใน service flow
export async function rotateGateClientSecret(
  clientIdParam: unknown,
  auth?: AccessTokenPayload
): Promise<GateClientSecretResponse> {
  const existingClient = await requireGateClient(clientIdParam);
  const clientSecret = generateGateClientSecret();
  const client = await gateClientRepository.updateGateClientSecret(
    existingClient.client_id,
    await hashPassword(clientSecret),
    getActorId(auth)
  );

  return {
    message: "Gate client secret rotated successfully. Save client_secret now because it will not be shown again.",
    ...toPublicGateClient(client),
    client_secret: clientSecret,
  };
}

// Function ตรวจสอบ Gate client credentials ใน service flow
export async function verifyGateClientCredentials(
  clientId: string,
  clientSecret: string
): Promise<PublicGateClient | null> {
  const client = await gateClientRepository.findByClientId(clientId);

  if (!client || client.status !== "active") {
    return null;
  }

  if (!(await verifyPassword(clientSecret, client.secret_hash))) {
    return null;
  }

  await gateClientRepository.updateLastUsedAt(client.client_id);

  return toPublicGateClient({
    ...client,
    last_used_at: new Date().toISOString(),
  });
}

// Function ดึงรายการ roles ใน service flow
export async function listRoles(): Promise<AdminRoleListResponse> {
  const admins = await accountRepository.listAdmins();

  return {
    data: ADMIN_PERMISSION_LEVELS.map((level, index) => ({
      key: level,
      name: level
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
      order: index,
      admins: admins
        .filter((account) => account.permission_level === level)
        .map((account) => ({
          id: account.id,
          username: account.username,
          full_name: account.full_name,
          position: account.position,
          status: account.status,
          email: account.email,
          phone: account.phone,
          created_at: account.created_at,
          updated_at: account.updated_at,
        })),
    })),
  };
}

// Function สร้าง admin account ใน service flow
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

// Function ดึง account permissions ใน service flow
export async function getAccountPermissions(
  account: AccountDto,
  connection?: DbConnection
): Promise<AccountPermissionsResponse> {
  return {
    account_id: account.id,
    role: account.role,
    status: account.status,
    permission_level: account.permission_level,
    permissions: await permissionRepository.listByAccountId(account.id, connection),
  };
}

// Function ดึง admin user permissions ใน service flow
export async function getAdminUserPermissions(
  accountIdParam: unknown,
  auth?: AccessTokenPayload
): Promise<AccountPermissionsResponse> {
  const accountId = parseId(accountIdParam);
  const account = await accountRepository.findAdminById(accountId);

  if (!account) {
    throw new ApiError(404, "ADMIN_NOT_FOUND", "Admin account not found.");
  }

  await assertCanReadAdminPermissions(account, auth);

  return getAccountPermissions(account);
}

// Function อัปเดต admin user permissions ใน service flow
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
    let updatedAccount = await accountRepository.updatePermissionLevel(
      account.id,
      input.permission_level,
      transaction
    );

    if (input.status !== undefined) {
      updatedAccount = await accountRepository.updateStatus(
        account.id,
        input.status,
        transaction
      );
    }

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
