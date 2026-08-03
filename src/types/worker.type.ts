// Import Types
import type { WorkerWorkStatus } from "./shared/worker-status.type";
import type { WebSocket } from "ws";
import type { WorkScheduleDto } from "./admin-workers.type";

/* -------------------------------------- Types -------------------------------------- */

// Type payload ของ delayed job สำหรับ assignment timeout และ vendor auto-confirm
export type AssignmentTimeoutJobData = {
  assignmentId?: number;
  workerAccountId?: number;
  ticketId?: number;
  submissionId?: number;
  kind?: "accept" | "scan" | "scan_warning" | "vendor_confirm";
};

// Type payload ของ delayed job สำหรับพักและจบกะ worker
export type WorkerScheduleJobData = {
  accountId: number;
  scheduleId: number;
  shiftInstanceKey?: string;
  kind?: "break_return" | "shift_end";
};

// Type ผลลัพธ์เมื่อ worker ไม่ accept งานจน timeout
export type AssignmentAcceptTimeoutResult = {
  queue: WorkerQueueEntryDto;
  reason: string;
  timeout_count: number;
  timeout_limit: number;
  closed_shift: boolean;
};

// Type ผลลัพธ์เมื่อ worker จบงานและอาจกลับเข้าคิวได้
export type CompletedWorkerQueueResult = {
  vehicle_job: Pick<VehicleJobDto, "ticketNo">;
  completed_worker_account_ids: number[];
};

// Type ผลลัพธ์เมื่องานรถจบครบทั้งคัน
export type CompletedVehicleJobResult = {
  vehicle_job: VehicleJobDto;
  completed_assignment_ids: number[];
  completed_worker_account_ids: number[];
};

// Type WebSocket ของ worker พร้อมข้อมูล account ที่ผูกไว้
export type WorkerSocket = WebSocket & {
  accountId?: number;
  isAlive?: boolean;
};

// Type payload ทั่วไปที่ส่งผ่าน Worker WebSocket
export type WorkerSocketPayload = Record<string, unknown>;

// Type option สำหรับกำหนดว่าจะส่ง FCM push คู่กับ WebSocket หรือไม่
export type WorkerSocketEventOptions = {
  push?: boolean;
  pushTitle?: string;
  pushMessage?: string;
};

// Type ค่า reason สำหรับปิด attendance ของ worker
export type WorkerShiftCloseReason =
  | "worker_offline"
  | "shift_ended"
  | "assignment_timeout_limit_reached"
  | "ticket_delivered_after_shift_end";

// Type key หลักสำหรับหา attendance ของ worker ในหนึ่งกะ
export type WorkerShiftAttendanceKeyInput = {
  account_id: number;
  shift_instance_key: string;
};

// Type input สำหรับบันทึก attendance ของ worker ในหนึ่งกะ
export type WorkerShiftAttendanceWriteInput = WorkerShiftAttendanceKeyInput & {
  worker_code: string;
  schedule: WorkScheduleDto;
};

// Type DTO ของ vehicle_jobs ที่ใช้ใน Worker flow
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
  status: string;
  driver_qr_token: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
}

// Type DTO ของ market_jobs ที่อยู่ใต้ vehicle job
export interface MarketJobDto {
  id: number;
  vehicle_job_id: number;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// Type DTO ของ ticket/booth ที่อยู่ใต้ market job
export interface GateTicketDto {
  id: number;
  vehicle_job_id: number;
  market_job_id: number;
  boothCode: string;
  boothName: string | null;
  vendor_line_id: string | null;
  reject_reason: string | null;
  status: string;
  confirmation_status: string;
  created_at: string;
  updated_at: string;
}

// Type LINE target ของเจ้าของแผงหรือสมาชิกแผงที่ต้องรับแจ้งเตือน
export interface VendorLineTargetDto {
  line_user_id: string;
  target_type: "owner" | "member";
}

// Type ticket ปัจจุบันที่ worker ต้องส่งยอดต่อ
export interface CurrentTicketProgressDto {
  ticket: GateTicketDto;
  marketCode: string;
  marketName: string;
}

// Type สรุปความพร้อมของ worker หลัง scan QR
export interface VehicleWorkReadinessDto {
  workers_required: number;
  checked_in_count: number;
  remaining_count: number;
  is_ready: boolean;
}

// Type DTO ของสินค้าภายใต้ ticket
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

// Type DTO ความสัมพันธ์ระหว่าง ticket กับ worker
export interface TicketWorkerDto {
  id: number;
  ticket_id: number;
  worker_account_id: number;
  status: string;
  created_at: string;
  updated_at: string;
}

// Type DTO การส่งยอดของ worker ที่รอ vendor confirm/reject
export interface TicketCompletionSubmissionDto {
  id: number;
  ticket_id: number;
  submitted_by_worker_account_id: number;
  status: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  resolved_by_line_user_id: string | null;
  created_at: string;
  updated_at: string;
}

// Type DTO สถานะคิวของ worker
export interface WorkerQueueEntryDto {
  id: number;
  account_id: number;
  status: WorkerWorkStatus;
  ready_at: string | null;
  break_until: string | null;
  break_count_used?: number;
  break_count_limit?: number;
  created_at: string;
  updated_at: string;
}

// Type response แบบสั้นของการ online/offline worker
export interface WorkerOnlineResponse {
  statusCode: number;
  code: string;
  message: string;
}

// Type response เมื่อ worker เข้าพักสำเร็จ
export interface WorkerBreakResponse {
  full_name: string;
  worker_code: string | null;
  status: WorkerWorkStatus;
  break_count_used: number;
  break_count_limit: number;
}

// Type ข้อมูลกะใน response status ของ worker
interface WorkerStatusShift {
  name: string;
  start_time: string;
  end_time: string;
}

// Type เวลาพักที่เหลือใน response status ของ worker
interface WorkerStatusRemainingBreakTime {
  total_seconds: number;
  minutes: number;
  seconds: number;
  text: string;
}

// Type response ปัจจุบันของ worker สำหรับหน้า status
export interface WorkerStatusResponse {
  full_name: string;
  worker_code: string | null;
  image_url: string | null;
  status: WorkerWorkStatus;
  today_job_count: number;
  break_count_used: number;
  completed_job_count: number;
  nationality: string | null;
  work_start_date: string | null;
  phone: string | null;
  shift: WorkerStatusShift | null;
  break_until?: string;
  remaining_break_time?: WorkerStatusRemainingBreakTime;
}

// Type สถานะการเชื่อมต่อ socket ของ worker สำหรับ Admin
export interface WorkerPresenceDto {
  is_online: boolean;
  last_seen_at: string | null;
  stale_after_seconds: number;
}

// Type DTO assignment ของ worker ต่อ vehicle job
export interface VehicleJobAssignmentDto {
  id: number;
  vehicle_job_id: number;
  worker_account_id: number;
  status: string;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type DTO ประวัติ assignment พร้อมข้อมูลงานรถ
export interface WorkerAssignmentHistoryItemDto {
  assignment: VehicleJobAssignmentDto;
  vehicle_job: VehicleJobDto;
}

// Type response ประวัติ assignment ที่ส่งให้ Worker Mobile
export interface WorkerAssignmentHistoryItemResponse {
  ticketNo: string;
  gate_transaction_ref: string;
  license_plate: string;
  status: string;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  completed_at: string | null;
  timeout_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Type สมาชิกทีมที่แสดงตอน worker รับงาน
export interface WorkerAssignmentTeamMemberDto {
  full_name: string;
  worker_code: string | null;
  image_url: string | null;
  scan_status: string;
}

// Type สินค้าใน assignment ที่ worker ต้องเห็น
interface WorkerAssignmentProductDto {
  productCode: string;
  productName: string;
  quantity: string;
  packageName: string;
}

// Type แผงใน assignment ที่ worker ต้องไปส่งยอด
interface WorkerAssignmentStallDto {
  boothCode: string;
  boothName: string | null;
  product_count: number;
  products: WorkerAssignmentProductDto[];
}

// Type ตลาดใน assignment ที่รวมแผงของตลาดนั้น
interface WorkerAssignmentMarketDto {
  marketName: string;
  stall_count: number;
  stalls: WorkerAssignmentStallDto[];
}

// Type response หลัง worker accept งาน
export interface WorkerAssignmentAcceptResponse {
  license_plate: string;
  team: WorkerAssignmentTeamMemberDto[];
  markets: WorkerAssignmentMarketDto[];
}

// Type response หลัง worker scan QR check-in
export interface WorkerAssignmentCheckInResponse {
  status: string;
  worker_code: string | null;
  ticketNo: string;
  worker_qr_token: string;
}

// Type response รายละเอียดงานรถพร้อมตลาด แผง และสินค้า
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

// Type response หลัง worker ส่งยอดให้ vendor ตรวจสอบ
export interface TicketCompletionResponse {
  message: string;
  ticketNo: string | null;
  marketCode: string | null;
  marketName: string | null;
  boothCode: string;
  boothName: string | null;
  status: string;
  confirmation_status: string;
  submission_status: string;
  assignment_status: string;
  items: Array<{
    productCode: string;
    productName: string;
    packageCode: string;
    packageName: string;
    quantity: string;
    confirmed_quantity: string | null;
  }>;
}

// Type input รายการสินค้าที่ worker ยืนยันจำนวนตอนส่งยอด
export interface TicketProductConfirmationInput {
  productCode: string;
  confirmed_quantity: number;
}

// Type event ที่ Worker WebSocket ส่งให้ Mobile ได้
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

// Type payload มาตรฐานของ Worker WebSocket event
