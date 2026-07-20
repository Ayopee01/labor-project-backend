import type { VehicleJobDetailResponse, VehicleJobDto } from "./worker.type";

// Type ส่วน filter สำหรับรายการงานรถฝั่ง Admin
export interface VehicleJobListFilters {
  search?: string;
  status?: string;
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
  vehicle_job_ref: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  workers_required: number;
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

export interface AdminVehicleJobHistoryProductResponse {
  product_ref: string;
  product_type: string | null;
  name: string;
  quantity: string;
  confirmed_quantity: string | null;
  unit: string;
}

export interface AdminVehicleJobHistoryTicketResponse {
  stall_job_ref: string;
  ticket_no: string | null;
  stall_no: string | null;
  vendor_name: string | null;
  vendor_line_id: string | null;
  status: string;
  confirmation_status: string;
  created_at: string;
  updated_at: string;
  products: AdminVehicleJobHistoryProductResponse[];
}

export interface AdminVehicleJobHistoryMarketResponse {
  market_job_ref: string;
  market_name: string;
  status: string;
  created_at: string;
  updated_at: string;
  tickets: AdminVehicleJobHistoryTicketResponse[];
}

export interface AdminVehicleJobHistoryItemResponse {
  vehicle_job: AdminVehicleJobHistoryVehicleResponse;
  markets: AdminVehicleJobHistoryMarketResponse[];
}

export interface AdminVehicleJobActionResponse {
  message: string;
  vehicle_job_ref: string;
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
  vehicle_job_ref: string;
  worker_qr_token: string;
  assignments: AdminScanDeadlineAssignmentResponse[];
}

// Type ส่วน assignment ที่แสดงใน response ของ Admin assign workers
export interface AdminAssignmentResponse {
  vehicle_job_ref: string;
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
  vehicle_job_ref: string;
  assignments: AdminAssignmentResponse[];
}

// Type ส่วน response ของ API ยกเลิก assignment ราย worker
export interface AdminCancelAssignmentResponse {
  message: string;
  vehicle_job_ref: string | null;
  worker_code: string | null;
  status: string;
}

// Type ส่วน response ของ API ยกเลิกงานรถและคืน worker เข้า queue
export interface AdminCancelVehicleJobAndRequeueResponse {
  message: string;
  vehicle_job_ref: string;
  status: string;
  requeued_worker_codes: Array<string | null>;
}

export interface AdminMarketJobActionResponse {
  message: string;
  vehicle_job_ref: string | null;
  market_job_ref: string;
  status: string;
}

export interface AdminStallJobActionResponse {
  message: string;
  vehicle_job_ref: string | null;
  market_job_ref: string | null;
  stall_job_ref: string;
  ticket_no: string | null;
  status: string;
  confirmation_status: string;
}
