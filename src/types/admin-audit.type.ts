export const WORKER_ASSIGNMENT_EVENT_TYPE = {
  ASSIGNED: "ASSIGNED",
  ACCEPTED: "ACCEPTED",
  ACCEPT_TIMEOUT: "ACCEPT_TIMEOUT",
  SCANNED: "SCANNED",
  SCAN_TIMEOUT: "SCAN_TIMEOUT",
  COMPLETED: "COMPLETED",
  ADMIN_CANCELLED: "ADMIN_CANCELLED",
} as const;

export type WorkerAssignmentEventType =
  (typeof WORKER_ASSIGNMENT_EVENT_TYPE)[keyof typeof WORKER_ASSIGNMENT_EVENT_TYPE];

export interface WorkerAssignmentEventWriteInput {
  assignment_id: number;
  worker_account_id: number;
  vehicle_job_id: number;
  event_type: WorkerAssignmentEventType;
  occurred_at?: Date;
  metadata?: Record<string, unknown> | null;
}

export interface AdminAuditWorkerPerformanceQuery {
  worker_code?: string;
  date_from?: string;
  date_to?: string;
  page: number;
  limit: number;
  sort_by?:
    | "accept_rate"
    | "total_assigned"
    | "accepted"
    | "accept_timeout"
    | "scan_timeout"
    | "completed"
    | "admin_cancelled"
    | "worker_code";
  sort_order?: "asc" | "desc";
}

export interface AdminAuditWorkerPerformanceRecord {
  worker_code: string;
  full_name: string;
  total_assigned_job_count: number;
  accepted_job_count: number;
  accept_timeout_job_count: number;
  scan_timeout_job_count: number;
  completed_job_count: number;
  admin_cancelled_job_count: number;
  accept_rate: string | null;
}

export interface AdminAuditWorkerPerformanceResponse {
  period: {
    date_from: string;
    date_to: string;
    timezone: "Asia/Bangkok";
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  data: AdminAuditWorkerPerformanceRecord[];
}
