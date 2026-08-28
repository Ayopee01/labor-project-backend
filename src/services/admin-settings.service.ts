// Import Config
import { randomBytes } from "crypto";
import { ADMIN_PERMISSION_DEPENDENCIES, ADMIN_PERMISSION_LEVELS, OWNER_ONLY_PERMISSIONS, canManagePermissionLevel } from "../config/permission.config";
import type { AdminPermission } from "../config/permission.config";
// Import Dependencies
import { withTransaction } from "../db/prisma";
import { accountRepository } from "../repositories/admin-settings.repository";
import * as gateClientRepository from "../repositories/shared/gate-client.repository";
import * as permissionRepository from "../repositories/shared/permission.repository";
import * as sessionRepository from "../repositories/shared/session.repository";
import { upsertSettings } from "../repositories/shared/system-setting.repository";
import { publishRuntimeSettingsInvalidation } from "../queues/runtime-settings-sync";
import { getAccountPermissions } from "./shared/account-permission.service";
import { clearRuntimeSettingsCache, getRuntimeSettings } from "./shared/runtime-settings.service";
import * as mobileAppVersionService from "./shared/mobile-app-version.service";
// Import Types
import type { AccessTokenPayload } from "../types/auth.type";
import type { AccountDto } from "../types/admin-workers.type";
import type { DbConnection } from "../types/shared/common.type";
import type { AccountPermissionsResponse } from "../types/shared/account-permission.type";
import type { AdminRoleListResponse, RuntimeSettingsResponse } from "../types/admin-settings.type";
import type { GateClientDto, PublicGateClient } from "../types/shared/gate-client.type";
import type { GateClientListResponse, GateClientMutationResponse, GateClientSecretResponse } from "../types/admin-settings.type";
// Import Validation
import { parseId, parseWithSchema } from "../validation/parser";
import { createAdminAccountBodySchema, createGateClientBodySchema, resetPasswordBodySchema, updateAccountPermissionsBodySchema, updateAdminAccountBodySchema, updateGateClientBodySchema, updateSystemSettingsBodySchema } from "../validation/schemas";
// Import Utils
import { getActorId } from "../utils/actor";
import ApiError from "../utils/api-error";
import { hashPassword } from "../utils/password";

/* -------------------------------------- Config -------------------------------------- */

const GATE_SECRET_PREFIX = "gate_live_";
const GENERATED_CLIENT_ID_PREFIX = "gate_";
const GENERATED_CLIENT_ID_BYTES = 8;
const GENERATED_SECRET_BYTES = 32;

/* -------------------------------------- Functions -------------------------------------- */

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

// Function ดึง admin actor ที่ auth ผ่านแล้ว (401 ไม่มี auth / 403 ไม่ใช่ admin) ใน service flow —
// จุดเดียวที่ทุก assertCan* ด้านล่างใช้ร่วมกันก่อนเช็คเงื่อนไขเฉพาะของตัวเอง
async function requireAdminActor(auth?: AccessTokenPayload): Promise<AccountDto> {
  const actorId = getActorId(auth);

  if (!actorId) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }

  const actorAccount = await accountRepository.findAdminById(actorId);

  if (!actorAccount) {
    throw new ApiError(403, "ADMIN_ACTOR_NOT_FOUND", "Admin actor not found.");
  }

  return actorAccount;
}

// Function ตรวจสอบเงื่อนไข can manage admin permissions ใน service flow — คืน actorAccount กลับไป
// ให้ caller ใช้ต่อ (เช่นเช็ค assertPermissionsGrantable) โดยไม่ต้อง query ซ้ำ
async function assertCanManageAdminPermissions(
  targetAccount: AccountDto,
  nextPermissionLevel: string,
  auth?: AccessTokenPayload
): Promise<AccountDto> {
  const actorAccount = await requireAdminActor(auth);

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

  return actorAccount;
}

// Function ตรวจสอบเงื่อนไข can manage admin account (update basic info / reset password) ใน service
// flow — ใช้ hierarchy check เดียวกับ assertCanManageAdminPermissions โดยไม่มี "next permission
// level" check เพราะ endpoint นี้ไม่ได้แก้ permission_level
async function assertCanManageAdminAccount(
  targetAccount: AccountDto,
  auth?: AccessTokenPayload
): Promise<void> {
  const actorAccount = await requireAdminActor(auth);

  if (actorAccount.id === targetAccount.id) {
    throw new ApiError(
      403,
      "CANNOT_MANAGE_OWN_ACCOUNT",
      "Admin cannot manage their own account through this endpoint. Use PATCH /api/auth/me instead."
    );
  }

  if (!canManagePermissionLevel(actorAccount.permission_level, targetAccount.permission_level)) {
    throw new ApiError(
      403,
      "TARGET_PERMISSION_LEVEL_NOT_MANAGEABLE",
      "Admin cannot manage an account with an equal or higher permission level."
    );
  }
}

// Function ตรวจสอบว่า permissions ที่จะมอบให้บัญชีอื่น (ตอนสร้างหรือแก้ไข) เป็นสิ่งที่ actor เอง
// มีอยู่จริงหรือไม่ ใน service flow — permission_level เป็นแค่ตัวกำหนด "จัดการใครได้" ไม่ได้กำหนด
// ว่า "แจกสิทธิ์ใดได้บ้าง" ถ้าไม่เช็คส่วนนี้ Admin ระดับล่างที่มี permission แคบๆ จะมอบสิทธิ์ที่ตัวเอง
// ไม่มีให้บัญชีที่ตนสร้าง/แก้ไขได้ (Privilege Escalation ผ่านบัญชีลูกที่ตนควบคุม)
async function assertPermissionsGrantable(
  actorAccount: AccountDto,
  requestedPermissions: AdminPermission[],
  connection?: DbConnection
): Promise<void> {
  const actorPermissions = new Set(
    await permissionRepository.listByAccountId(actorAccount.id, connection)
  );
  const ungrantable = requestedPermissions.filter(
    (permission) => !actorPermissions.has(permission)
  );

  if (ungrantable.length > 0) {
    throw new ApiError(
      403,
      "PERMISSIONS_NOT_GRANTABLE",
      `Admin cannot grant permissions they do not have: ${ungrantable.join(", ")}`
    );
  }
}

// Function ตรวจสอบว่า permission set ที่จะบันทึก (ตอนสร้างหรือแก้ไข) เคารพ dependency ที่ประกาศไว้ใน
// ADMIN_PERMISSION_DEPENDENCIES ใน service flow — เช่น mobile_app_versions:create ต้องมาพร้อม
// mobile_app_versions:read เสมอ ไม่งั้นจะแก้ข้อมูลได้โดยไม่มีสิทธิ์ดูข้อมูลตัวเอง ตรวจกับ requested
// set เองล้วนๆ ไม่ต้อง query DB เพิ่ม
function assertPermissionDependenciesSatisfied(
  requestedPermissions: AdminPermission[]
): void {
  const requested = new Set(requestedPermissions);
  const missing = new Set<AdminPermission>();

  for (const permission of requestedPermissions) {
    const dependencies = ADMIN_PERMISSION_DEPENDENCIES[permission] ?? [];

    for (const dependency of dependencies) {
      if (!requested.has(dependency)) {
        missing.add(dependency);
      }
    }
  }

  if (missing.size > 0) {
    throw new ApiError(
      400,
      "PERMISSION_DEPENDENCY_NOT_SATISFIED",
      `Missing required permissions: ${[...missing].join(", ")}`
    );
  }
}

// Function ดึงเฉพาะ permission ในกลุ่ม OWNER_ONLY_PERMISSIONS ออกมาเป็น Set ใน service flow
function ownerOnlyPermissionSubset(
  permissions: readonly AdminPermission[]
): Set<AdminPermission> {
  return new Set(
    permissions.filter((permission) =>
      (OWNER_ONLY_PERMISSIONS as readonly AdminPermission[]).includes(permission)
    )
  );
}

// Function ตรวจสอบว่า permission ในกลุ่ม OWNER_ONLY_PERMISSIONS (เช่น mobile_app_versions:*) ไม่ถูก
// grant/revoke โดย actor ที่ไม่ใช่ owner ใน service flow — เข้มงวดเฉพาะตอนที่ชุด permission กลุ่มนี้
// "เปลี่ยนแปลงจริง" เท่านั้น ถ้า manager แก้ permission อื่นของ target โดยไม่ได้แตะกลุ่มนี้เลย (resubmit
// ค่าเดิมของกลุ่มนี้กลับมาเหมือนเดิมเพราะ endpoint เป็น full replace ของทั้ง array) ต้องผ่านได้ปกติ
// currentPermissions ว่างเปล่าสำหรับบัญชีที่เพิ่งสร้างใหม่ (createAdminAccount) จึงตรวจ "grant ครั้งแรก"
// ได้เหมือนกันโดยอัตโนมัติ ไม่ต้องแยกเคส
function assertOwnerOnlyPermissionsUnchanged(
  actorAccount: AccountDto,
  currentPermissions: readonly AdminPermission[],
  requestedPermissions: readonly AdminPermission[]
): void {
  if (actorAccount.permission_level === "owner") {
    return;
  }

  const current = ownerOnlyPermissionSubset(currentPermissions);
  const requested = ownerOnlyPermissionSubset(requestedPermissions);
  const isUnchanged =
    current.size === requested.size &&
    [...current].every((permission) => requested.has(permission));

  if (!isUnchanged) {
    throw new ApiError(
      403,
      "OWNER_ONLY_PERMISSIONS",
      `Only an owner-level admin can grant or revoke: ${OWNER_ONLY_PERMISSIONS.join(", ")}`
    );
  }
}

// Function ตรวจสอบเงื่อนไข can create admin level ใน service flow — คืน actorAccount กลับไปให้
// caller ใช้ต่อ (เช่นเช็ค assertPermissionsGrantable) โดยไม่ต้อง query ซ้ำ
async function assertCanCreateAdminLevel(
  nextPermissionLevel: string,
  auth?: AccessTokenPayload
): Promise<AccountDto> {
  const actorAccount = await requireAdminActor(auth);

  if (!canManagePermissionLevel(actorAccount.permission_level, nextPermissionLevel)) {
    throw new ApiError(
      403,
      "NEW_PERMISSION_LEVEL_NOT_MANAGEABLE",
      "Admin cannot create an equal or higher permission level."
    );
  }

  return actorAccount;
}

// Function โหลดแอดมินเป้าหมายจาก DB ตาม id หรือ 404 ใน service flow — จุดเดียวที่ทุก endpoint ด้านล่าง
// ที่แก้ไข/อ่านแอดมินอีกคนหนึ่งใช้ร่วมกันก่อนเช็คสิทธิ์เฉพาะของตัวเอง
async function requireAdminAccount(accountIdParam: unknown): Promise<AccountDto> {
  const accountId = parseId(accountIdParam);
  const account = await accountRepository.findAdminById(accountId);

  if (!account) {
    throw new ApiError(404, "ADMIN_NOT_FOUND", "Admin account not found.");
  }

  return account;
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
  const actorAccount = await requireAdminActor(auth);

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
  // แจ้ง instance อื่น (ถ้ามี) ให้ล้าง cache ของตัวเองด้วย — วันนี้รันอยู่ instance เดียวจึงยังไม่มีผล
  // อะไรเพิ่ม แต่พร้อมรองรับตอน scale หลาย instance โดยไม่ต้องแก้โค้ดตรงนี้อีก
  await publishRuntimeSettingsInvalidation();

  return getRuntimeSettings();
}

// Function ดึง Current/Scheduled/History ของ Mobile App Version ใน service flow
export async function listMobileAppVersions() {
  return mobileAppVersionService.getAdminMobileAppVersionOverview();
}

// Function สร้าง Mobile App Version ใหม่ใน service flow
export async function createMobileAppVersion(body: unknown, auth?: AccessTokenPayload) {
  return mobileAppVersionService.createMobileAppVersion(body, getActorId(auth));
}

// Function แก้ไข Mobile App Version ใน service flow
export async function updateMobileAppVersion(
  idParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
) {
  return mobileAppVersionService.updateMobileAppVersion(idParam, body, getActorId(auth));
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

  const actorAccount = await assertCanCreateAdminLevel(
    input.permission_level,
    auth
  );
  await assertPermissionsGrantable(actorAccount, input.permissions);
  assertPermissionDependenciesSatisfied(input.permissions);
  // บัญชีใหม่ยังไม่มี permission เดิมเลย (current = []) จึงเท่ากับตรวจ "grant ครั้งแรก" ของกลุ่ม
  // owner-only โดยอัตโนมัติ
  assertOwnerOnlyPermissionsUnchanged(actorAccount, [], input.permissions);
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

// Function ดึง admin user permissions ใน service flow
export async function getAdminUserPermissions(
  accountIdParam: unknown,
  auth?: AccessTokenPayload
): Promise<AccountPermissionsResponse> {
  const account = await requireAdminAccount(accountIdParam);

  await assertCanReadAdminPermissions(account, auth);

  return getAccountPermissions(account);
}

// Function อัปเดต admin user permissions ใน service flow
export async function updateAdminUserPermissions(
  accountIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<AccountPermissionsResponse & { message: string }> {
  const input = parseWithSchema(updateAccountPermissionsBodySchema, body);
  const account = await requireAdminAccount(accountIdParam);

  const actorAccount = await assertCanManageAdminPermissions(
    account,
    input.permission_level,
    auth
  );
  await assertPermissionsGrantable(actorAccount, input.permissions);
  assertPermissionDependenciesSatisfied(input.permissions);

  return withTransaction(async (transaction) => {
    // Lock แถว target account นี้ไว้ก่อน re-check hierarchy แล้วเขียนจริง กัน Race เมื่อ 2 admin
    // แก้ target คนเดียวกันพร้อมกัน (เช่น Owner ลด target ให้เป็น manager ไปพร้อมกับที่อีก manager
    // คนหนึ่งกำลังจะแก้ target คนเดียวกันโดยเช็ค hierarchy จาก state เก่าก่อนที่ target จะเปลี่ยน
    // ระดับ) — fetch ใหม่หลัง lock เพื่อเช็คกฎ "ห้ามจัดการระดับเท่ากันหรือสูงกว่า" จากข้อมูลล่าสุด
    await transaction.$queryRaw`SELECT id FROM accounts WHERE id = ${account.id} FOR UPDATE`;

    const freshTarget = await accountRepository.findAdminById(account.id, transaction);

    if (!freshTarget) {
      throw new ApiError(404, "ADMIN_NOT_FOUND", "Admin account not found.");
    }

    if (
      !canManagePermissionLevel(
        actorAccount.permission_level,
        freshTarget.permission_level
      )
    ) {
      throw new ApiError(
        403,
        "TARGET_PERMISSION_LEVEL_NOT_MANAGEABLE",
        "Admin cannot update permissions for an equal or higher permission level."
      );
    }

    // เช็คหลัง Lock ด้วยชุด permission ปัจจุบันล่าสุดของ target เพื่อกัน Race เดียวกับข้างบน — ต้อง
    // เข้มงวดเฉพาะตอนชุด owner-only เปลี่ยนแปลงจริงเท่านั้น (ดู comment ของฟังก์ชัน)
    const currentPermissions = await permissionRepository.listByAccountId(
      account.id,
      transaction
    );

    assertOwnerOnlyPermissionsUnchanged(
      actorAccount,
      currentPermissions,
      input.permissions
    );

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

// Function อัปเดตข้อมูลพื้นฐาน (full_name/position/email/phone) ของแอดมินอีกคนหนึ่ง ใน service flow
// — permission_level/permissions ยังคงแก้ผ่าน updateAdminUserPermissions ด้านบนเท่านั้น
export async function updateAdminAccount(
  accountIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
) {
  const input = parseWithSchema(updateAdminAccountBodySchema, body);
  const account = await requireAdminAccount(accountIdParam);

  await assertCanManageAdminAccount(account, auth);

  const updatedAccount = await accountRepository.updateAdminAccount(account.id, {
    full_name: input.full_name,
    position: input.position,
    email: input.email,
    phone: input.phone,
  });

  return {
    message: "Admin account updated successfully.",
    account: accountRepository.sanitizeAccount(updatedAccount),
  };
}

// Function รีเซ็ตรหัสผ่านของแอดมินอีกคนหนึ่ง ใน service flow — revoke active session ทั้งหมดของ
// เป้าหมายเหมือนกับ resetPassword ของ Worker (admin-workers.service.ts)
export async function resetAdminPassword(
  accountIdParam: unknown,
  body: unknown,
  auth?: AccessTokenPayload
): Promise<{ message: string }> {
  const { new_password: newPassword } = parseWithSchema(
    resetPasswordBodySchema,
    body
  );
  const account = await requireAdminAccount(accountIdParam);

  await assertCanManageAdminAccount(account, auth);

  return withTransaction(async (transaction) => {
    await accountRepository.updatePassword(
      account.id,
      await hashPassword(newPassword),
      transaction
    );
    await sessionRepository.revokeActiveByAccountId(account.id, transaction);

    return {
      message: "Admin password reset successfully. Active sessions were revoked.",
    };
  });
}
