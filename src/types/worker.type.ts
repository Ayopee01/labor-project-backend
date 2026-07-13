// Type ส่วน Value ของ status งานรถและงานตลาด
export type JobStatus = string;

// Type ส่วน Value ของ status ตั๋วหรือแผง
export type TicketStatus = string;

// Type ส่วน Value ของ status queue คนงาน
export type WorkerQueueStatus = string;

// Type ส่วน Value ของ status assignment คนงาน
export type AssignmentStatus = string;

// Type ส่วน DTO ของ table vehicle_jobs
export interface VehicleJobDto {
  id: number;
  vehicle_job_ref: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  workers_required: number;
  status: JobStatus;
  driver_qr_token: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ table market_jobs
export interface MarketJobDto {
  id: number;
  vehicle_job_id: number;
  market_job_ref: string;
  market_name: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ table gate_tickets
export interface GateTicketDto {
  id: number;
  vehicle_job_id: number;
  market_job_id: number;
  stall_job_ref: string;
  ticket_no: string | null;
  stall_no: string | null;
  vendor_name: string | null;
  vendor_line_id: string | null;
  status: TicketStatus;
  confirmation_status: string;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ table ticket_products
export interface TicketProductDto {
  id: number;
  ticket_id: number;
  product_type: string | null;
  name: string;
  quantity: string;
  confirmed_quantity: string | null;
  unit: string;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ table ticket_workers
export interface TicketWorkerDto {
  id: number;
  ticket_id: number;
  worker_account_id: number;
  status: string;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ table ticket_completion_submissions
export interface TicketCompletionSubmissionDto {
  id: number;
  ticket_id: number;
  submitted_by_worker_account_id: number;
  status: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของสถานะคิว worker จาก Redis
export interface WorkerQueueEntryDto {
  id: number;
  account_id: number;
  status: WorkerQueueStatus;
  ready_at: string | null;
  break_until: string | null;
  break_count_used?: number;
  break_count_limit?: number;
  created_at: string;
  updated_at: string;
}

export interface WorkerOnlineResponse {
  full_name: string;
  worker_code: string | null;
  status: WorkerQueueStatus;
  today_job_count: number;
  break_count_used: number;
  completed_job_count: number;
}

export interface WorkerStatusShift {
  name: string;
  start_time: string;
  end_time: string;
}

export interface WorkerStatusResponse {
  full_name: string;
  worker_code: string | null;
  image_url: string | null;
  nationality: string | null;
  work_start_date: string | null;
  phone: string | null;
  shift: WorkerStatusShift | null;
}

// Type ส่วน DTO ของ heartbeat/presence worker จาก Redis
export interface WorkerPresenceDto {
  is_online: boolean;
  last_seen_at: string | null;
  stale_after_seconds: number;
}

// Type ส่วน DTO ของ table vehicle_job_assignments
export interface VehicleJobAssignmentDto {
  id: number;
  vehicle_job_id: number;
  worker_account_id: number;
  status: AssignmentStatus;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน response ประวัติงานของ worker พร้อมข้อมูลงานรถที่เกี่ยวข้อง
export interface WorkerAssignmentHistoryItemDto {
  assignment: VehicleJobAssignmentDto;
  vehicle_job: VehicleJobDto;
}

// Type ส่วน response รายละเอียดงานรถพร้อมตลาด ตั๋ว และสินค้า
export interface WorkerAssignmentTeamMemberDto {
  full_name: string;
  worker_code: string | null;
  image_url: string | null;
  scan_status: string;
}

export interface WorkerAssignmentProductDto {
  name: string;
  quantity: string;
  unit: string;
}

export interface WorkerAssignmentStallDto {
  stall_code: string | null;
  stall_name: string | null;
  product_count: number;
  products: WorkerAssignmentProductDto[];
}

export interface WorkerAssignmentMarketDto {
  market_name: string;
  stall_count: number;
  stalls: WorkerAssignmentStallDto[];
}

export interface WorkerAssignmentAcceptResponse {
  license_plate: string;
  team: WorkerAssignmentTeamMemberDto[];
  markets: WorkerAssignmentMarketDto[];
}

export interface VehicleJobDetailResponse {
  vehicle_job: VehicleJobDto;
  markets: Array<
    MarketJobDto & {
      tickets: Array<
        GateTicketDto & {
          products: TicketProductDto[];
        }
      >;
    }
  >;
}

// Type ส่วน response หลัง worker ส่งยอดปิดงานระดับตั๋ว/แผง
export interface TicketCompletionResponse {
  message: string;
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
  products: TicketProductDto[];
}

// Type ส่วน input รายการสินค้าที่ worker ยืนยันยอดตอนปิดงาน
export interface TicketProductConfirmationInput {
  ticket_product_id: number;
  confirmed_quantity: number;
}

// Type ส่วน Event name ที่ WebSocket ส่งให้ Worker Mobile
export type WorkerSocketEventType =
  | "WORKER_CONNECTED"
  | "WORKER_DISCONNECTED"
  | "WORKER_ASSIGNED"
  | "ASSIGNMENT_TIMEOUT"
  | "ASSIGNMENT_CANCELLED"
  | "ASSIGNMENT_ACCEPTED"
  | "ASSIGNMENT_CHECKED_IN"
  | "ASSIGNMENT_SCAN_DEADLINE_EXTENDED"
  | "TICKET_COMPLETION_SUBMITTED"
  | "TICKET_COMPLETION_RESULT"
  | "STALL_JOB_REOPENED"
  | "STALL_JOB_CANCELLED"
  | "MARKET_JOB_CANCELLED"
  | "VEHICLE_JOB_CANCELLED"
  | "WORKER_STATUS_CHANGED";

// Type ส่วน Event ที่ WebSocket ส่งให้ Worker Mobile
export interface WorkerSocketEvent<TPayload = Record<string, unknown>> {
  type: WorkerSocketEventType;
  payload: TPayload;
  occurred_at: string;
}
