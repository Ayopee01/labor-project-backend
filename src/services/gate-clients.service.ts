import { randomBytes } from "crypto";

import * as gateClientRepository from "../repositories/gate-client.repository";

import type { AccessTokenPayload } from "../types/auth.type";
import type { GateClientDto, GateClientListResponse, GateClientMutationResponse, GateClientSecretResponse, PublicGateClient } from "../types/gate-client.type";

import { parseWithSchema } from "../validation/parser";
import { createGateClientBodySchema, updateGateClientBodySchema } from "../validation/schemas";

import ApiError from "../utils/api-error";
import { hashPassword, verifyPassword } from "../utils/password";

/* -------------------------------------- Config -------------------------------------- */

// Config prefix for generated Gate secrets so real credentials are recognizable.
const GATE_SECRET_PREFIX = "gate_live_";

// Config generation size for Gate client ids and secrets.
const GENERATED_CLIENT_ID_PREFIX = "gate_";
const GENERATED_CLIENT_ID_BYTES = 8;
const GENERATED_SECRET_BYTES = 32;

/* -------------------------------------- Functions -------------------------------------- */

// Function reads the current admin account id for created_by/updated_by audit fields.
function getActorId(auth?: AccessTokenPayload): number | null {
  return auth?.account_id ?? null;
}

// Function generates a random client_id when Admin does not provide one.
function generateGateClientId(): string {
  return `${GENERATED_CLIENT_ID_PREFIX}${randomBytes(GENERATED_CLIENT_ID_BYTES).toString("hex")}`;
}

// Function generates the plaintext secret shown only once after create/rotate.
function generateGateClientSecret(): string {
  return `${GATE_SECRET_PREFIX}${randomBytes(GENERATED_SECRET_BYTES).toString("base64url")}`;
}

// Function parses client_id from path params and returns a standard API error when missing.
function parseClientId(value: unknown): string {
  const clientId = String(value ?? "").trim();

  if (!clientId) {
    throw new ApiError(400, "INVALID_GATE_CLIENT_ID", "Gate client id is required.");
  }

  return clientId;
}

// Function removes secret_hash before returning Gate client data to Admin.
function toPublicGateClient(client: GateClientDto): PublicGateClient {
  const { secret_hash: _secretHash, ...publicClient } = client;

  return publicClient;
}

// Function retries random client_id generation to avoid rare collisions.
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

// Function loads a Gate client or throws 404 for Admin mutation endpoints.
async function requireGateClient(clientIdParam: unknown): Promise<GateClientDto> {
  const clientId = parseClientId(clientIdParam);
  const client = await gateClientRepository.findByClientId(clientId);

  if (!client) {
    throw new ApiError(404, "GATE_CLIENT_NOT_FOUND", "Gate client not found.");
  }

  return client;
}

// Function lists Gate client credentials for Admin Settings without exposing secrets.
export async function listGateClients(): Promise<GateClientListResponse> {
  const clients = await gateClientRepository.listGateClients();

  return {
    data: clients.map(toPublicGateClient),
  };
}

// Function creates a Gate client and returns plaintext secret once for the Gate system to save.
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

// Function updates visible Gate client metadata such as name or active/inactive status.
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

// Function rotates a Gate client secret by replacing the hash and returning the new plaintext once.
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

// Function verifies Basic Auth client_id/client_secret for Gate API requests.
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
