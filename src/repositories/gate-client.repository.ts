import { client, requireMapped } from "./shared/repository-utils";

import type { DbConnection } from "../types/common.type";
import type { GateClientCreateInput, GateClientDto, GateClientUpdateInput } from "../types/gate-client.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function converts Date fields from Prisma records to API-safe ISO strings.
function toIsoString(value: Date | string | null): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

// Function maps table gate_clients to GateClientDto and normalizes unknown status to active.
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
    last_used_at: toIsoString(record.lastUsedAt),
    created_by: record.createdBy,
    updated_by: record.updatedBy,
    created_at: toIsoString(record.createdAt) as string,
    updated_at: toIsoString(record.updatedAt) as string,
  };
}

// Function lists Gate client credentials for Admin Settings without filtering by status.
export async function listGateClients(
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

// Function finds one Gate client by client_id for auth verification or Admin mutation.
export async function findByClientId(
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

// Function checks client_id uniqueness before creating generated or custom credentials.
export async function clientIdExists(
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

// Function creates a Gate client credential with a hashed secret only.
export async function createGateClient(
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

// Function updates Gate client name/status while keeping the existing secret hash.
export async function updateGateClient(
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

// Function replaces the stored secret hash when Admin rotates a Gate client secret.
export async function updateGateClientSecret(
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

// Function records the last successful Basic Auth verification time.
export async function updateLastUsedAt(
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
