// Type ส่วน Value ของ status งานรถและงานตลาด
import type { WorkerWorkStatus } from "./worker-status.type";

type JobStatus = string;

// Type ส่วน Value ของ status ตั๋วหรือแผง
type TicketStatus = string;

// Type ส่วน Value ของ status queue คนงาน
type WorkerQueueStatus = WorkerWorkStatus;

// Type ส่วน Value ของ status assignment คนงาน
type AssignmentStatus = string;

// Type ส่วน DTO ของ table vehicle_jobs
export interface VehicleJobDto {
  id: number;
  ticketNo: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  ticket_created_at: string;
  booth_count: number;
  workers_required: number;
  dispatch_now: boolean;
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
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ table gate_tickets
export interface GateTicketDto {
  id: number;
  vehicle_job_id: number;
  market_job_id: number;
  boothCode: string;
  boothName: string | null;
  vendor_line_id: string | null;
  reject_reason: string | null;
  status: TicketStatus;
  confirmation_status: string;
  created_at: string;
  updated_at: string;
}

// Type ส่วน DTO ของ table ticket_products
export interface CurrentTicketProgressDto {
  ticket: GateTicketDto;
  marketCode: string;
  marketName: string;
}

export interface VehicleWorkReadinessDto {
  workers_required: number;
  checked_in_count: number;
  remaining_count: number;
  is_ready: boolean;
}

export interface TicketProductDto {
  id: number;
  ticket_id: number;
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
  confirmed_quantity: string | null;
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

// Type ส่วน response หลัง worker online/open_app พร้อมสรุปงานและจำนวนพักในกะ
export interface WorkerOnlineResponse {
  full_name: string;
  worker_code: string | null;
  status: WorkerWorkStatus;
  today_job_count: number;
  break_count_used: number;
  completed_job_count: number;
}

// Type ส่วน response หลัง worker กดพัก
export interface WorkerBreakResponse {
  full_name: string;
  worker_code: string | null;
  status: WorkerWorkStatus;
  break_count_used: number;
  break_count_limit: number;
}

// Type ส่วน shift ที่แสดงใน status ของ worker
interface WorkerStatusShift {
  name: string;
  start_time: string;
  end_time: string;
}

// Type ส่วนเวลาพักที่เหลือเมื่อ worker อยู่สถานะ break
interface WorkerStatusRemainingBreakTime {
  total_seconds: number;
  minutes: number;
  seconds: number;
  text: string;
}

// Type ส่วน response ของ GET /api/workers/me/status
export interface WorkerStatusResponse {
  full_name: string;
  worker_code: string | null;
  image_url: string | null;
  status: WorkerWorkStatus;
  nationality: string | null;
  work_start_date: string | null;
  phone: string | null;
  shift: WorkerStatusShift | null;
  break_until?: string;
  remaining_break_time?: WorkerStatusRemainingBreakTime;
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

// Type ส่วน item response ประวัติงาน worker
export interface WorkerAssignmentHistoryItemResponse {
  ticketNo: string;
  gate_transaction_ref: string;
  license_plate: string;
  status: AssignmentStatus;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  completed_at: string | null;
  timeout_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน response รายละเอียดงานรถพร้อมตลาด ตั๋ว และสินค้า
export interface WorkerAssignmentTeamMemberDto {
  full_name: string;
  worker_code: string | null;
  image_url: string | null;
  scan_status: string;
}

// Type ส่วนสินค้าใน response หลัง worker รับงาน
interface WorkerAssignmentProductDto {
  productCode: string;
  productName: string;
  quantity: string;
  packageName: string;
}

// Type ส่วนแผงใน response หลัง worker รับงาน
interface WorkerAssignmentStallDto {
  boothCode: string;
  boothName: string | null;
  product_count: number;
  products: WorkerAssignmentProductDto[];
}

// Type ส่วนตลาดใน response หลัง worker รับงาน
interface WorkerAssignmentMarketDto {
  marketName: string;
  stall_count: number;
  stalls: WorkerAssignmentStallDto[];
}

// Type ส่วน response หลัง worker รับ assignment
export interface WorkerAssignmentAcceptResponse {
  license_plate: string;
  team: WorkerAssignmentTeamMemberDto[];
  markets: WorkerAssignmentMarketDto[];
}

// Type ส่วน response หลัง worker check-in ด้วย QR สำเร็จ
export interface WorkerAssignmentCheckInResponse {
  status: AssignmentStatus;
  worker_code: string | null;
  ticketNo: string;
  worker_qr_token: string;
}

// Type ส่วนรายละเอียดงานรถพร้อมตลาด แผง และสินค้า
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
  ticketNo: string | null;
  marketCode: string | null;
  marketName: string | null;
  boothCode: string;
  boothName: string | null;
  status: TicketStatus;
  confirmation_status: string;
  submission_status: string;
  assignment_status: AssignmentStatus;
  items: Array<{
    productCode: string;
    productName: string;
    packageCode: string;
    packageName: string;
    quantity: string;
    confirmed_quantity: string | null;
  }>;
  debug_line_postback?: {
    confirm: string;
    reject: string;
  };
}

// Type ส่วน input รายการสินค้าที่ worker ยืนยันยอดตอนปิดงาน
export interface TicketProductConfirmationInput {
  productCode: string;
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
  | "ASSIGNMENT_SCAN_DEADLINE_SHORTENED"
  | "TICKET_COMPLETION_SUBMITTED"
  | "TICKET_COMPLETION_RESULT"
  | "STALL_JOB_CANCELLED"
  | "MARKET_JOB_CANCELLED"
  | "VEHICLE_JOB_CANCELLED"
  | "WORKER_STATUS_CHANGED";

// Type ส่วน Event ที่ WebSocket ส่งให้ Worker Mobile
export interface WorkerSocketEvent<TPayload = Record<string, unknown>> {
  Type: WorkerSocketEventType;
  Payload: TPayload;
  OccurredAt: string;
}
