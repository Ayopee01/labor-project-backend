import * as accountRepository from "./shared/account.repository";
import * as permissionRepository from "./shared/permission.repository";
import * as sessionRepository from "./shared/session.repository";
import { mapAccount } from "./shared/mappers";
import { client, requireMapped, toId } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { SystemSettingDto } from "../types/admin-settings.type";
import type { AccountCreateInput, AccountDto } from "../types/admin-workers.type";
import type { GateClientCreateInput, GateClientDto, GateClientUpdateInput } from "../types/admin-settings.type";

export { permissionRepository, sessionRepository };

/* -------------------------------------- Config -------------------------------------- */

const ADMIN_ROLE = "admin";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลง id เป็น account id แบบ number สำหรับ query DB
function toAccountId(id: number | string): number {
  return toId(id);
}

// Function ค้นหา admin ตาม ID จาก DB
async function findAdminById(
  id: number | string,
  connection?: DbConnection
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      id: toAccountId(id),
      role: ADMIN_ROLE,
    },
  });

  return mapAccount(account);
}

// Function จัดการ username exists จาก DB
async function usernameExists(
  username: string,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const account = await db.account.findUnique({
    where: {
      username,
    },
    select: {
      id: true,
    },
  });

  return Boolean(account);
}

// Function สร้าง admin account create data จาก DB
function buildAdminAccountCreateData(account: AccountCreateInput) {
  return {
    username: account.username,
    passwordHash: account.password_hash,
    role: ADMIN_ROLE,
    status: account.status ?? "active",
    fullName: account.full_name,
    position: account.position ?? null,
    email: account.email ?? null,
    phone: account.phone ?? null,
    source: account.source ?? "internal",
    masterWorkerId: account.master_worker_id ?? null,
    masterUpdatedAt: account.master_updated_at ?? null,
    syncedAt: account.synced_at ?? null,
    permissionLevel: account.permission_level ?? null,
    createdBy: account.created_by ?? null,
  };
}

// Function สร้าง admin จาก DB
async function createAdmin(
  account: AccountCreateInput,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);
  const createdAccount = await db.account.create({
    data: buildAdminAccountCreateData(account),
  });

  return requireMapped(mapAccount(createdAccount), "Admin account", "create");
}

// Function อัปเดต permission level จาก DB
async function updatePermissionLevel(
  id: number | string,
  permissionLevel?: string | null,
  connection?: DbConnection
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toAccountId(id),
    },
    data: {
      permissionLevel: permissionLevel ?? null,
    },
  });

  return requireMapped(mapAccount(updatedAccount), "Account", "permission level update");
}

const adminSettingsAccountRepository = {
  ...accountRepository,
  createAdmin,
  findAdminById,
  usernameExists,
  updatePermissionLevel,
};

export { adminSettingsAccountRepository as accountRepository };

// Function จัดการ เป็น Gate client ISO string จาก DB
function toGateClientIsoString(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

// Function แปลง Gate client จาก DB
function mapGateClient(record: {
  id: number;
  clientId: string;
  name: string;
  secretHash: string;
  status: string;
  lastUsedAt: Date | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
} | null): GateClientDto | null {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    client_id: record.clientId,
    name: record.name,
    secret_hash: record.secretHash,
    status: record.status === "inactive" ? "inactive" : "active",
    last_used_at: toGateClientIsoString(record.lastUsedAt),
    created_by: record.createdBy,
    updated_by: record.updatedBy,
    created_at: toGateClientIsoString(record.createdAt) as string,
    updated_at: toGateClientIsoString(record.updatedAt) as string,
  };
}

// Function ดึงรายการ Gate clients จาก DB
async function listGateClients(
  connection?: DbConnection
): Promise<GateClientDto[]> {
  const records = await client(connection).gateClient.findMany({
    orderBy: {
      id: "asc",
    },
  });

  return records
    .map((record) => mapGateClient(record))
    .filter((record): record is GateClientDto => record !== null);
}

// Function ค้นหา Gate client ตาม client ID จาก DB
async function findGateClientByClientId(
  clientId: string,
  connection?: DbConnection
): Promise<GateClientDto | null> {
  const record = await client(connection).gateClient.findUnique({
    where: {
      clientId,
    },
  });

  return mapGateClient(record);
}

// Function จัดการ Gate client ID exists จาก DB
async function gateClientIdExists(
  clientId: string,
  connection?: DbConnection
): Promise<boolean> {
  const record = await client(connection).gateClient.findUnique({
    where: {
      clientId,
    },
    select: {
      id: true,
    },
  });

  return Boolean(record);
}

// Function สร้าง Gate client จาก DB
async function createGateClient(
  input: GateClientCreateInput,
  connection?: DbConnection
): Promise<GateClientDto> {
  const record = await client(connection).gateClient.create({
    data: {
      clientId: input.client_id,
      name: input.name,
      secretHash: input.secret_hash,
      status: input.status ?? "active",
      createdBy: input.created_by ?? null,
      updatedBy: input.updated_by ?? null,
    },
  });

  return requireMapped(mapGateClient(record), "Gate client", "create");
}

// Function อัปเดต Gate client จาก DB
async function updateGateClient(
  clientId: string,
  input: GateClientUpdateInput,
  connection?: DbConnection
): Promise<GateClientDto> {
  const record = await client(connection).gateClient.update({
    where: {
      clientId,
    },
    data: {
      name: input.name,
      status: input.status,
      updatedBy: input.updated_by ?? null,
    },
  });

  return requireMapped(mapGateClient(record), "Gate client", "update");
}

// Function อัปเดต Gate client secret จาก DB
async function updateGateClientSecret(
  clientId: string,
  secretHash: string,
  updatedBy?: number | null,
  connection?: DbConnection
): Promise<GateClientDto> {
  const record = await client(connection).gateClient.update({
    where: {
      clientId,
    },
    data: {
      secretHash,
      updatedBy: updatedBy ?? null,
    },
  });

  return requireMapped(mapGateClient(record), "Gate client", "secret update");
}

// Function อัปเดต Gate client last used at จาก DB
async function updateGateClientLastUsedAt(
  clientId: string,
  connection?: DbConnection
): Promise<void> {
  await client(connection).gateClient.update({
    where: {
      clientId,
    },
    data: {
      lastUsedAt: new Date(),
    },
  });
}

const adminSettingsGateClientRepository = {
  listGateClients,
  findByClientId: findGateClientByClientId,
  clientIdExists: gateClientIdExists,
  createGateClient,
  updateGateClient,
  updateGateClientSecret,
  updateLastUsedAt: updateGateClientLastUsedAt,
};

export { adminSettingsGateClientRepository as gateClientRepository };

// Function แปลง system setting จาก DB
function mapSystemSetting(record: {
  key: string;
  value: string;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}): SystemSettingDto {
  return {
    key: record.key,
    value: record.value,
    updated_by: record.updatedBy,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

// Function ดึงรายการ settings จาก DB
export async function listSettings(
  connection?: DbConnection
): Promise<SystemSettingDto[]> {
  const db = client(connection);
  const settings = await db.systemSetting.findMany({
    orderBy: {
      key: "asc",
    },
  });

  return settings.map(mapSystemSetting);
}

// Function สร้างหรืออัปเดต settings จาก DB
export async function upsertSettings(
  settings: Record<string, string>,
  updatedBy?: number | null,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  for (const [key, value] of Object.entries(settings)) {
    await db.systemSetting.upsert({
      where: {
        key,
      },
      update: {
        value,
        updatedBy: updatedBy ?? null,
      },
      create: {
        key,
        value,
        updatedBy: updatedBy ?? null,
      },
    });
  }
}
