// Config status values for Gate client credentials.
export const GATE_CLIENT_STATUSES = ["active", "inactive"] as const;

// Type value of Gate client status.
export type GateClientStatus = (typeof GATE_CLIENT_STATUSES)[number];

// Type DTO of table gate_clients including hashed secret for server-side verification.
export interface GateClientDto {
  id: number;
  client_id: string;
  name: string;
  secret_hash: string;
  status: GateClientStatus;
  last_used_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

// Type public Gate client DTO that never exposes secret_hash.
export type PublicGateClient = Omit<GateClientDto, "secret_hash">;

// Type response of Admin Settings Gate client list.
export interface GateClientListResponse {
  data: PublicGateClient[];
}

// Type response after updating visible Gate client metadata.
export interface GateClientMutationResponse extends PublicGateClient {
  message: string;
}

// Type response after creating or rotating a Gate client secret.
export interface GateClientSecretResponse extends GateClientMutationResponse {
  client_secret: string;
}

// Type repository input for creating a Gate client credential.
export interface GateClientCreateInput {
  client_id: string;
  name: string;
  secret_hash: string;
  status?: GateClientStatus;
  created_by?: number | null;
  updated_by?: number | null;
}

// Type repository input for updating Gate client metadata without changing the secret.
export interface GateClientUpdateInput {
  name?: string;
  status?: GateClientStatus;
  updated_by?: number | null;
}
