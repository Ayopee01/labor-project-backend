import { randomBytes } from "crypto";

import * as gateClientRepository from "../repositories/gate-client.repository";

import type { AccessTokenPayload } from "../types/auth.type";
import type { GateClientDto, GateClientListResponse, GateClientMutationResponse, GateClientSecretResponse, PublicGateClient } from "../types/gate-client.type";

import { parseWithSchema } from "../validation/parser";
import { createGateClientBodySchema, updateGateClientBodySchema } from "../validation/schemas";

import ApiError from "../utils/api-error";
import { hashPassword, verifyPassword } from "../utils/password";

const GATE_SECRET_PREFIX = "gate_live_";
const GENERATED_CLIENT_ID_PREFIX = "gate_";
const GENERATED_CLIENT_ID_BYTES = 8;
const GENERATED_SECRET_BYTES = 32;

function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
}

function generateGateClientId(): string {
  return `${GENERATED_CLIENT_ID_PREFIX}${randomBytes(GENERATED_CLIENT_ID_BYTES).toString("hex")}`;
}

function generateGateClientSecret(): string {
  return `${GATE_SECRET_PREFIX}${randomBytes(GENERATED_SECRET_BYTES).toString("base64url")}`;
}

function parseClientId(value: unknown): string {
  const clientId = String(value ?? "").trim();

  if (!clientId) {
    throw new ApiError(400, "INVALID_GATE_CLIENT_ID", "Gate client id is required.");
  }

  return clientId;
}

function toPublicGateClient(client: GateClientDto): PublicGateClient {
  const { secret_hash: _secretHash, ...publicClient } = client;

  return publicClient;
}

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

async function requireGateClient(clientIdParam: unknown): Promise<GateClientDto> {
  const clientId = parseClientId(clientIdParam);
  const client = await gateClientRepository.findByClientId(clientId);

  if (!client) {
    throw new ApiError(404, "GATE_CLIENT_NOT_FOUND", "Gate client not found.");
  }

  return client;
}

export async function listGateClients(): Promise<GateClientListResponse> {
  const clients = await gateClientRepository.listGateClients();

  return {
    data: clients.map(toPublicGateClient),
  };
}

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
