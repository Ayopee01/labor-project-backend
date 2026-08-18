// Config ประเภท Admin action ที่บันทึกลง admin_action_logs สำหรับ Audit + Work History Timeline
export const ADMIN_ACTION_TYPE = {
  OVERRIDE_COUNT: "OVERRIDE_COUNT",
  VEHICLE_WAIT: "VEHICLE_WAIT",
  WORKERS_RELEASED: "WORKERS_RELEASED",
} as const;

export type AdminActionType =
  (typeof ADMIN_ACTION_TYPE)[keyof typeof ADMIN_ACTION_TYPE];

export interface AdminActionLogDto {
  id: number;
  vehicle_job_id: number;
  gate_ticket_id: number | null;
  action_type: AdminActionType;
  reason_code: string | null;
  reason_text: string | null;
  actor_account_id: number;
  actor_worker_code: string | null;
  actor_full_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminActionLogWriteInput {
  vehicle_job_id: number;
  gate_ticket_id?: number | null;
  action_type: AdminActionType;
  reason_code?: string | null;
  reason_text?: string | null;
  actor_account_id: number;
  metadata?: Record<string, unknown> | null;
}
