// Config ประเภท Admin action ที่บันทึกลง admin_action_logs สำหรับ Audit + Work History Timeline
export const ADMIN_ACTION_TYPE = {
  OVERRIDE_COUNT: "OVERRIDE_COUNT",
  VEHICLE_WAIT: "VEHICLE_WAIT",
  WORKERS_RELEASED: "WORKERS_RELEASED",
  ASSIGNMENT_CANCELLED: "ASSIGNMENT_CANCELLED",
  SCAN_DEADLINE_EXTENDED: "SCAN_DEADLINE_EXTENDED",
  MARKET_JOB_CANCELLED: "MARKET_JOB_CANCELLED",
  VEHICLE_JOB_CANCELLED: "VEHICLE_JOB_CANCELLED",
  STALL_JOB_CANCELLED: "STALL_JOB_CANCELLED",
  TICKET_WORKER_CANCELLED: "TICKET_WORKER_CANCELLED",
  TICKET_WORKER_CANCELLED_FROM_BOOTH: "TICKET_WORKER_CANCELLED_FROM_BOOTH",
  WORKER_STATUS_FORCED: "WORKER_STATUS_FORCED",
} as const;

export type AdminActionType =
  (typeof ADMIN_ACTION_TYPE)[keyof typeof ADMIN_ACTION_TYPE];

export interface AdminActionLogDto {
  id: number;
  // null สำหรับ action ที่ไม่มี VehicleJob เกี่ยวข้องเลย (เช่น WORKER_STATUS_FORCED ตอน worker
  // ยังว่างงานอยู่ ไม่มี VehicleJob ให้ผูก)
  vehicle_job_id: number | null;
  gate_ticket_id: number | null;
  market_job_id: number | null;
  action_type: AdminActionType;
  reason_code: string | null;
  reason_text: string | null;
  actor_account_id: number;
  actor_worker_code: string | null;
  actor_full_name: string | null;
  actor_role: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminActionLogWriteInput {
  vehicle_job_id?: number | null;
  gate_ticket_id?: number | null;
  market_job_id?: number | null;
  action_type: AdminActionType;
  reason_code?: string | null;
  reason_text?: string | null;
  actor_account_id: number;
  metadata?: Record<string, unknown> | null;
}
