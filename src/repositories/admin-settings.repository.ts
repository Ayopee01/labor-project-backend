import * as accountRepository from "./shared/account.repository";
import { mapAccount } from "./shared/mappers";
import { client, requireMapped, toId } from "./shared/repository-utils";

import type { DbConnection } from "../types/shared/common.type";
import type {
  AccountCreateInput,
  AccountDto,
} from "../types/admin-workers.type";

/* -------------------------------------- Config -------------------------------------- */

const ADMIN_ROLE = "admin";

/* -------------------------------------- Functions -------------------------------------- */

async function findAdminById(
  id: number | string,
  connection?: DbConnection,
): Promise<AccountDto | null> {
  const db = client(connection);
  const account = await db.account.findFirst({
    where: {
      id: toId(id),
      role: ADMIN_ROLE,
    },
  });

  return mapAccount(account);
}

async function usernameExists(
  username: string,
  connection?: DbConnection,
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

async function createAdmin(
  account: AccountCreateInput,
  connection?: DbConnection,
): Promise<AccountDto> {
  const db = client(connection);
  const createdAccount = await db.account.create({
    data: buildAdminAccountCreateData(account),
  });

  return requireMapped(mapAccount(createdAccount), "Admin account", "create");
}

async function updatePermissionLevel(
  id: number | string,
  permissionLevel?: string | null,
  connection?: DbConnection,
): Promise<AccountDto> {
  const db = client(connection);
  const updatedAccount = await db.account.update({
    where: {
      id: toId(id),
    },
    data: {
      permissionLevel: permissionLevel ?? null,
    },
  });

  return requireMapped(
    mapAccount(updatedAccount),
    "Account",
    "permission level update",
  );
}

const adminSettingsAccountRepository = {
  ...accountRepository,
  createAdmin,
  findAdminById,
  usernameExists,
  updatePermissionLevel,
};

export { adminSettingsAccountRepository as accountRepository };
