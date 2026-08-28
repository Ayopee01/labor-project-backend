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
  mobileAppVersionId?: number;
  kind?:
    | "accept"
    | "scan"
    | "scan_warning"
    | "vendor_confirm"
    | "mobile_app_release_notification"
    | "mobile_app_force_update_notification";
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
  vehicle_job: Pick<VehicleJobDto, "ticket_number">;
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
  notificationKey?: string | null;
  notificationParams?: Record<string, unknown>;
  fallbackTitle?: string;
  fallbackMessage?: string;
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

// Type DTO ของ vehicle_jobs (TicketNumber) ที่ใช้ใน Worker flow
export interface VehicleJobDto {
  id: number;
  ticket_number: string;
  license_plate: string;
  license_plate_province: string | null;
  vehicle_type: string | null;
  workers_required: number;
  dispatch_now: boolean;
  status: string;
  work_started_at: string | null;
  driver_qr_token: string;
  expected_ticket_count: number | null;
  tickets_closed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type DTO ของ market_jobs (Business Ticket) ที่อยู่ใต้ vehicle job
export interface MarketJobDto {
  id: number;
  vehicle_job_id: number;
  ticket_no: string;
  ticket_created_at: string;
  booth_count: number;
  gate_transaction_ref: string;
  workers_required: number;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: string;
  worker_roster_locked_at: string | null;
  final_stall_amount: string | null;
  financialized_at: string | null;
  completed_at: string | null;
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
  final_stall_amount: string | null;
  completed_at: string | null;
  financialized_at: string | null;
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

// Type response รายการ PackageCode ที่ยังใช้งานอยู่ของ ProductCode เดียว — ใช้ให้ Worker เลือก
// PackageCode ใหม่ตอนแก้ไขยอดส่ง (PackageName ไว้แสดงบน UI เท่านั้น ส่งจริงต้องใช้ PackageCode)
export interface WorkerProductPackageOptionsResponse {
  ProductCode: string;
  ProductName: string;
  Packages: Array<{
    PackageCode: string;
    PackageName: string;
    PackageWeight: number;
  }>;
}

// Type DTO ความสัมพันธ์ระหว่าง Business Ticket (market job) กับ worker
export interface TicketWorkerDto {
  id: number;
  market_job_id: number;
  worker_account_id: number;
  status: string;
  final_earning_amount: string | null;
  joined_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type DTO การส่งยอด (โดย Worker เองหรือ Admin ส่งแทน) ที่รอ vendor confirm/reject
export interface TicketCompletionSubmissionDto {
  id: number;
  ticket_id: number;
  submitted_by_account_id: number;
  // Snapshot ตอนส่งยอดจริง ("worker" | "admin" จาก TICKET_SUBMITTER_ROLE) ห้าม derive จาก
  // Account.role ตอนอ่าน — ดู field comment ใน prisma/schema.prisma
  submitted_by_role: string;
  status: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  resolved_by_line_user_id: string | null;
  // Count of WORKING TicketWorker rows at the moment this submission was created. Null for rows
  // created before this feature — never backfilled/derived from current data.
  worker_count_snapshot: number | null;
  // VehicleJobAssignment the submitting worker was actively working under at submit time. Null
  // for admin-submitted-on-behalf rows and for rows created before this feature.
  assignment_id: number | null;
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
  // Type flag บอกว่า Worker เข้าคิวได้ในกะปัจจุบัน
  shift_active: boolean;
  current_job?: WorkerCurrentJobResponse | null;
  break_until?: string;
  break_until_unix_ms?: number | null;
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
  // Set when Admin releases this worker back to the FIFO queue early, before the whole
  // TicketNumber closes. Distinct from completed_at (whole vehicle job finished).
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type DTO ประวัติ assignment พร้อมข้อมูลงานรถและรายได้จริง
export interface WorkerAssignmentHistoryItemDto {
  assignment: VehicleJobAssignmentDto;
  vehicle_job: VehicleJobDto;
  markets: WorkerAssignmentHistoryMarketDto[];
}

// Type response ประวัติ assignment ที่ส่งให้ Worker Mobile
export interface WorkerAssignmentHistoryItemResponse {
  ticket_number: string;
  ticket_completed_at: string | null;
  license_plate: string;
  license_plate_province: string | null;
  status: string;
  markets: WorkerAssignmentHistoryMarketDto[];
}

export interface WorkerAssignmentHistoryProductDto {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  confirmed_quantity: string | null;
}

export interface WorkerAssignmentHistoryBoothDto {
  boothCode: string;
  boothName: string | null;
  status: string;
  confirmation_status: string;
  completed_at: string | null;
  confirmed_at: string | null;
  products: WorkerAssignmentHistoryProductDto[];
  rating: number | null;
}

export interface WorkerAssignmentHistoryMarketDto {
  ticket_no: string;
  marketCode: string;
  marketName: string;
  booths: WorkerAssignmentHistoryBoothDto[];
}

export interface WorkerAssignmentHistoryResponse {
  date: string;
  summary: {
    job_count: number;
    accept_timeout_job_count: number;
    completed_job_count: number;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  data: WorkerAssignmentHistoryItemResponse[];
}

// Type สมาชิกทีมที่แสดงตอน worker รับงาน
export interface WorkerAssignmentTeamMemberDto {
  worker_account_id?: number;
  full_name: string;
  worker_code: string | null;
  shirt_number?: string | null;
  image_url: string | null;
  scan_status: string;
  accepted_at?: string | null;
  scanned_at?: string | null;
}

export interface WorkerCurrentJobProductResponse {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
}

export interface WorkerCurrentJobBoothResponse {
  boothCode: string;
  boothName: string | null;
  status: string;
  confirmation_status: string;
  completed_at: string | null;
  products: WorkerCurrentJobProductResponse[];
}

export interface WorkerCurrentJobMarketResponse {
  // Scan this Business Ticket's ticket_no (barcode on the Gate paper ticket) via
  // check-in-barcode to check in the whole team.
  ticket_no: string;
  marketCode: string;
  marketName: string;
  booths: WorkerCurrentJobBoothResponse[];
}

export interface WorkerCurrentJobTeamMemberResponse {
  shirt_number: string | null;
  full_name: string;
  scan_status: "scanned" | "not_scanned";
  scanned_at: string | null;
}

export interface WorkerCurrentJobTeamScanResponse {
  workers_required: number;
  checked_in_count: number;
  remaining_count: number;
  is_ready: boolean;
}

export interface WorkerCurrentJobResponse {
  // Type Business Ticket ที่ Worker คนนี้ scan เข้างานจริง
  scanned_ticket_no: string | null;
  ticket_number: string;
  license_plate: string;
  license_plate_province: string | null;
  // Set only while the assignment is still PENDING (worker has not pressed accept yet).
  accept_deadline_at: string | null;
  accept_deadline_unix_ms: number | null;
  // Set only once the assignment is ACCEPTED (worker is waiting to scan the QR check-in).
  scan_deadline_at: string | null;
  scan_deadline_unix_ms: number | null;
  // Set once the whole team has scanned in and the vehicle job's status becomes WORKING — null
  // until then, and never changes again once set (see markVehicleJobInProgress).
  work_started_at: string | null;
  work_started_at_unix_ms: number | null;
  vehicle_type: string | null;
  team_scan: WorkerCurrentJobTeamScanResponse;
  markets: WorkerCurrentJobMarketResponse[];
  team: WorkerCurrentJobTeamMemberResponse[];
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

// Type ตลาดใน assignment ที่รวมแผงของตลาดนั้น (หนึ่งรายการ = หนึ่ง Business Ticket)
interface WorkerAssignmentMarketDto {
  // Scan this Business Ticket's ticket_no (barcode on the Gate paper ticket) via
  // check-in-barcode to check in the whole team.
  ticket_no: string;
  marketName: string;
  stall_count: number;
  stalls: WorkerAssignmentStallDto[];
}

// Type response หลัง worker accept งาน
export interface WorkerAssignmentAcceptResponse {
  ticket_number: string;
  worker_code: string | null;
  shirt_number: string | null;
  accepted_at: string | null;
  license_plate: string;
  license_plate_province: string | null;
  scan_deadline_at: string | null;
  scan_deadline_unix_ms: number | null;
  team: WorkerAssignmentTeamMemberDto[];
  markets: WorkerAssignmentMarketDto[];
}

// Type response หลัง worker scan QR check-in
export interface WorkerAssignmentCheckInResponse {
  status: string;
  worker_status: WorkerWorkStatus;
  worker_code: string | null;
  ticket_number: string;
  // Business Ticket (market) whose barcode this worker actually scanned — never guessed, always
  // the one resolved from the ticket_no this request sent (see scanWorkerAssignment).
  ticket_no: string;
  team_scan: WorkerCurrentJobTeamScanResponse;
}

export interface WorkerEarningsSummaryResponse {
  period: {
    from_date: string;
    to_date: string;
    day_count: number;
  };
  total_earnings: string;
  daily: Array<{
    date: string;
    earnings: string;
  }>;
  // หนึ่งแถว = รายได้ของ Worker จาก Business Ticket หนึ่งใบ (รวมทุก Booth ภายใต้ Ticket นั้น)
  details: Array<{
    completed_at: string;
    ticket_number: string;
    ticket_no: string;
    license_plate: string;
    license_plate_province: string | null;
    booth_count: number;
    marketCode: string;
    marketName: string;
    earnings: string;
  }>;
}

// Type response รายละเอียดงานรถพร้อม Business Ticket, แผง และสินค้า
export interface VehicleJobDetailResponse {
  vehicle_job: VehicleJobDto;
  markets: Array<
    MarketJobDto & {
      booths: Array<
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
  ticket_number: string | null;
  ticket_no: string | null;
  ticketNos: string[];
  ticket_completed_at: string | null;
  marketCode: string | null;
  marketName: string | null;
  boothCode: string;
  boothName: string | null;
  status: string;
  confirmation_status: string;
  completed_at: string | null;
  confirmed_at: string | null;
  rejected_at: string | null;
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

// Type ค่า Rate Snapshot ใหม่ที่คำนวณจากการเปลี่ยน PackageCode ตอน Worker ส่งยอด — service layer
// เป็นคนคำนวณค่านี้จาก master data ก่อนส่งต่อให้ repository เขียนทับแถว TicketProduct เดิม
export interface TicketProductPackageSwitchSnapshot {
  packageName: string;
  packageWeightSnapshot: string;
  rateIdSnapshot: number;
  sourceRateIdSnapshot: number;
  rateMarketCode: string;
  rateSource: string;
  weightRangeName: string;
  weightMinSnapshot: string;
  weightMaxSnapshot: string;
  stallRateSnapshot: string;
  laborRateSnapshot: string;
  rateSnapshotAt: Date;
}

// Type input รายการสินค้าที่ worker ยืนยันจำนวนตอนส่งยอด
export interface TicketProductConfirmationInput {
  productCode: string;
  packageCode: string;
  confirmed_quantity: number;
  // ระบุเฉพาะตอน Worker เปลี่ยน PackageCode: original_package_code คือ PackageCode เดิมที่ Gate
  // เคยประกาศไว้ (ใช้หาแถว TicketProduct เดิม), package_switch คือ Rate Snapshot ใหม่ที่คำนวณแล้ว
  original_package_code?: string;
  package_switch?: TicketProductPackageSwitchSnapshot;
}

// Type event ที่ Worker WebSocket ส่งให้ Mobile ได้
export type WorkerSocketEventType =
  | "WORKER_CONNECTED"
  | "WORKER_ASSIGNED"
  | "ASSIGNMENT_TIMEOUT"
  | "ASSIGNMENT_CANCELLED"
  | "ASSIGNMENT_ACCEPTED"
  | "ASSIGNMENT_CHECKED_IN"
  | "ASSIGNMENT_TEAM_UPDATED"
  | "TEAM_READY"
  | "ASSIGNMENT_SCAN_DEADLINE_EXTENDED"
  | "ASSIGNMENT_SCAN_DEADLINE_SHORTENED"
  | "TICKET_COMPLETION_SUBMITTED"
  | "TICKET_COMPLETION_RESULT"
  | "STALL_JOB_CANCELLED"
  | "MARKET_JOB_CANCELLED"
  | "VEHICLE_JOB_CANCELLED"
  | "SESSION_REVOKED"
  | "WORKER_STATUS_CHANGED";

// Type payload มาตรฐานของ Worker WebSocket event
