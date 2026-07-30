import type { VehicleJobDetailResponse, VehicleJobDto } from "./worker.type";
import type { VEHICLE_OPERATION_STATUS } from "../constants/job-status";

// Type ส่วน filter สำหรับรายการงานรถฝั่ง Admin
export interface VehicleJobListFilters {
  search?: string;
  status?: string;
  startAt?: Date;
  endAt?: Date;
  page?: number;
  limit?: number;
}

// Type value of operation_status filter for Admin vehicle operation board.
export type VehicleOperationStatus =
  (typeof VEHICLE_OPERATION_STATUS)[keyof typeof VEHICLE_OPERATION_STATUS];

// Type filter for Admin vehicle operation board, separated from history filters.
export interface VehicleJobOperationFilters {
  search?: string;
  operation_status?: VehicleOperationStatus;
  startAt?: Date;
  endAt?: Date;
  page?: number;
  limit?: number;
}

// Type ส่วนผลลัพธ์รายการงานรถพร้อมจำนวนทั้งหมด
export interface VehicleJobListResult {
  data: VehicleJobDetailResponse[];
  total?: number;
}

// Type ส่วน response งานรถแบบ public สำหรับ Admin Jobs
export interface AdminVehicleJobListItemResponse {
  ticketNo: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  ticket_created_at: string;
  booth_count: number;
  workers_required: number;
  dispatch_now: boolean;
  status: string;
}

export interface AdminVehicleJobResponse extends AdminVehicleJobListItemResponse {
  driver_qr_token: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
}

export interface AdminVehicleJobHistoryVehicleResponse extends AdminVehicleJobListItemResponse {
  created_at: string;
  updated_at: string;
}

// Type product row shown inside Admin vehicle job history and operation responses.
export interface AdminVehicleJobHistoryProductResponse {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
  confirmed_quantity: string | null;
}

// Type booth/ticket row shown inside Admin vehicle job history and operation responses.
export interface AdminVehicleJobHistoryTicketResponse {
  boothCode: string;
  boothName: string | null;
  vendor_line_id: string | null;
  reject_reason: string | null;
  status: string;
  confirmation_status: string;
  created_at: string;
  updated_at: string;
  products: AdminVehicleJobHistoryProductResponse[];
}

// Type market row that groups booth/ticket rows in Admin vehicle job history.
export interface AdminVehicleJobHistoryMarketResponse {
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  tickets: AdminVehicleJobHistoryTicketResponse[];
}

// Type response item for Admin vehicle job history.
export interface AdminVehicleJobHistoryItemResponse {
  vehicle_job: AdminVehicleJobHistoryVehicleResponse;
  markets: AdminVehicleJobHistoryMarketResponse[];
}

// Type status counts for the left list of Admin vehicle operation board.
export interface AdminVehicleJobOperationSummaryResponse {
  total: number;
  unload_now: number;
  waiting_unload: number;
  waiting_queue: number;
  driver_waiting_queue: number;
}

// Type worker assignment counts for one vehicle job in Admin operation board.
export interface AdminVehicleJobOperationWorkerSummaryResponse {
  required: number;
  assigned: number;
  active: number;
  accepted: number;
  scanned: number;
  working: number;
  delivered: number;
  rejected: number;
  completed: number;
  cancelled: number;
  timeout: number;
  missing: number;
}

// Type market/booth/product counts for one vehicle job in Admin operation board.
export interface AdminVehicleJobOperationMarketSummaryResponse {
  total: number;
  stalls: number;
  products: number;
  delivered: number;
  confirmed: number;
  rejected: number;
}

// Type worker row shown in one vehicle operation detail.
export interface AdminVehicleJobOperationWorkerResponse {
  worker_code: string | null;
  full_name: string;
  shirt_number: string | null;
  image_url: string | null;
  shift_name: string | null;
  assignment_status: string;
  worker_status: string;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type booth/ticket row with product count for Admin operation detail.
export interface AdminVehicleJobOperationTicketResponse
  extends AdminVehicleJobHistoryTicketResponse {
  product_count: number;
}

// Type market row with summary for Admin operation detail.
export interface AdminVehicleJobOperationMarketResponse
  extends AdminVehicleJobHistoryMarketResponse {
  summary: {
    stalls: number;
    products: number;
    delivered: number;
    confirmed: number;
    rejected: number;
  };
  tickets: AdminVehicleJobOperationTicketResponse[];
}

// Type full operation board item for one vehicle job.
export interface AdminVehicleJobOperationItemResponse {
  operation_status: VehicleOperationStatus;
  vehicle_job: AdminVehicleJobHistoryVehicleResponse & {
    dispatch_now: boolean;
  };
  worker_summary: AdminVehicleJobOperationWorkerSummaryResponse;
  market_summary: AdminVehicleJobOperationMarketSummaryResponse;
  scan_summary: {
    required: number;
    scanned: number;
    remaining: number;
  };
  timing: {
    gate_elapsed_seconds: number;
    working_elapsed_seconds: number | null;
  };
  workers: AdminVehicleJobOperationWorkerResponse[];
  markets: AdminVehicleJobOperationMarketResponse[];
}

// Type list response for Admin operation board.
export interface AdminVehicleJobOperationListResponse {
  server_time: string;
  summary: AdminVehicleJobOperationSummaryResponse;
  data: AdminVehicleJobOperationItemResponse[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// Type simple action response shared by Admin job mutations.
export interface AdminVehicleJobActionResponse {
  message: string;
  ticketNo: string;
  status: string;
}

// Type response สำหรับ endpoint ยกเลิกงานระดับรถ/ตลาด/แผงผ่าน endpoint เดียว
export type AdminJobCancelResponse =
  | AdminVehicleJobActionResponse
  | AdminCancelVehicleJobAndRequeueResponse
  | AdminMarketJobActionResponse
  | AdminStallJobActionResponse;

// Type ส่วน assignment หลังต่อเวลา scan deadline
export interface AdminScanDeadlineAssignmentResponse {
  worker_code: string | null;
  status: string;
  scan_deadline_at: string | null;
}

// Type ส่วน response ของ API ต่อเวลา scan deadline
export interface AdminExtendScanDeadlineResponse {
  message: string;
  ticketNo: string;
  worker_qr_token: string;
  assignments: AdminScanDeadlineAssignmentResponse[];
}

// Type ส่วน assignment ที่แสดงใน response ของ Admin assign workers
export interface AdminAssignmentResponse {
  ticketNo: string;
  worker_code: string | null;
  status: string;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน response ของ API assign worker เข้างานรถ
export interface AdminAssignWorkersResponse {
  message: string;
  ticketNo: string;
  assignments: AdminAssignmentResponse[];
}

// Type ส่วน response ของ API ยกเลิก assignment ราย worker
export interface AdminCancelAssignmentResponse {
  message: string;
  ticketNo: string | null;
  worker_code: string | null;
  status: string;
}

// Type ส่วน response ของ API ยกเลิกงานรถและคืน worker เข้า queue
export interface AdminCancelVehicleJobAndRequeueResponse {
  message: string;
  ticketNo: string;
  status: string;
  requeued_worker_codes: Array<string | null>;
}

// Type response after cancelling one market job.
export interface AdminMarketJobActionResponse {
  message: string;
  ticketNo: string | null;
  marketCode: string;
  status: string;
}

// Type response after cancelling one booth/ticket job.
export interface AdminStallJobActionResponse {
  message: string;
  ticketNo: string | null;
  marketCode: string | null;
  boothCode: string;
  status: string;
  confirmation_status: string;
}
