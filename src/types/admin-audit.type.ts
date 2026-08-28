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
