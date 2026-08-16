import type { Prisma } from "@prisma/client";
import type { VehicleJobDetailResponse } from "./worker.type";
import type { VEHICLE_OPERATION_STATUS } from "../constants/job-status";

// Type record สำหรับบอร์ด operation ของ VehicleJob
export type VehicleJobOperationRecord = Prisma.VehicleJobGetPayload<{
  include: {
    marketJobs: {
      include: {
        tickets: {
          include: {
            products: true;
          };
        };
      };
    };
    assignments: {
      include: {
        worker: true;
      };
    };
  };
}>;

// Type record สำหรับอ่าน Financial breakdown ของ VehicleJob จาก DB
export type AdminVehicleJobFinancialRecord = Prisma.VehicleJobGetPayload<{
  include: {
    tickets: {
      include: {
        marketJob: true;
        workers: {
          include: {
            worker: true;
            payments: true;
          };
        };
        products: {
          include: {
            financial: {
              include: {
                workerPayments: {
                  include: {
                    ticketWorker: {
                      include: {
                        worker: true;
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}>;

// Type สถานะ Financial ระดับ VehicleJob
export type AdminVehicleJobFinancialStatus =
  | "PENDING"
  | "PARTIAL"
  | "FINALIZED";

// Type snapshot rate ที่ใช้คำนวณเงินจริงของ Product
export interface AdminFinancialRateSnapshotResponse {
  package_weight_snapshot: string | null;
  rate_id_snapshot: number | null;
  source_rate_id_snapshot: number | null;
  rate_market_code: string | null;
  rate_source: string | null;
  weight_range_name: string | null;
  weight_min_snapshot: string | null;
  weight_max_snapshot: string | null;
  stall_rate_snapshot: string | null;
  labor_rate_snapshot: string | null;
  rate_snapshot_at: string | null;
}

// Typeยอดเงินจริงของ Worker ต่อ Product
export interface AdminFinancialWorkerPaymentResponse {
  ticket_worker_id: number;
  worker_code: string;
  full_name: string;
  membership_status: string;
  raw_amount: string;
  remainder_amount: string;
  final_amount: string;
}

// Type Financial ที่ persist แล้วต่อ Product
export interface AdminProductFinancialResponse {
  stall_fee_raw: string;
  stall_fee_rounded: string;
  labor_fee_raw: string;
  product_charge: string;
  worker_count: number;
  worker_payout_total: string;
  fund_amount: string;
  finalized_at: string;
}

// Type Product breakdown สำหรับ Admin
export interface AdminFinancialProductResponse {
  ticket_product_id: number;
  productCode: string;
  productFullCode: string | null;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
  confirmed_quantity: string | null;
  rate_snapshot: AdminFinancialRateSnapshotResponse;
  financial: AdminProductFinancialResponse | null;
  workers: AdminFinancialWorkerPaymentResponse[];
}

// Typeยอดรวม Worker ต่อ Booth
export interface AdminFinancialBoothWorkerResponse {
  ticket_worker_id: number;
  worker_code: string;
  full_name: string;
  membership_status: string;
  total_amount: string;
}

// Type Booth breakdown สำหรับ Admin
export interface AdminFinancialBoothResponse {
  ticket_id: number;
  marketCode: string;
  marketName: string;
  boothCode: string;
  boothName: string | null;
  status: string;
  financialized: boolean;
  final_stall_amount: string | null;
  completed_at: string | null;
  financialized_at: string | null;
  summary: {
    labor_fee_raw: string;
    worker_payout_total: string;
    fund_amount: string;
  };
  workers: AdminFinancialBoothWorkerResponse[];
  products: AdminFinancialProductResponse[];
}

// Type response Financial breakdown ระดับ VehicleJob
export interface AdminVehicleJobFinancialResponse {
  vehicle_job: {
    ticketNo: string;
    gate_transaction_ref: string;
    license_plate: string;
    license_plate_province: string | null;
    vehicle_type: string | null;
    status: string;
  };
  financial_status: AdminVehicleJobFinancialStatus;
  summary: {
    booth_count: number;
    financialized_booth_count: number;
    final_stall_amount: string;
    labor_fee_raw: string;
    worker_payout_total: string;
    fund_amount: string;
  };
  booths: AdminFinancialBoothResponse[];
}

export interface VehicleJobListFilters {
  search?: string;
  status?: string;
  startAt?: Date;
  endAt?: Date;
  page?: number;
  limit?: number;
}

// Type ค่า operation_status สำหรับ filter บอร์ด operation ของ Admin
export type VehicleOperationStatus =
  (typeof VEHICLE_OPERATION_STATUS)[keyof typeof VEHICLE_OPERATION_STATUS];

// Type filter สำหรับบอร์ด operation ของ Admin แยกจาก filter ของ history
export interface VehicleJobOperationFilters {
  search?: string;
  operation_status?: VehicleOperationStatus;
  startAt?: Date;
  endAt?: Date;
  page?: number;
  limit?: number;
}

export interface VehicleJobListResult {
  data: VehicleJobDetailResponse[];
  total?: number;
}

export interface AdminVehicleJobListItemResponse {
  ticketNo: string;
  gate_transaction_ref: string;
  license_plate: string;
  license_plate_province: string | null;
  vehicle_type: string | null;
  ticket_created_at: string;
  booth_count: number;
  workers_required: number;
  dispatch_now: boolean;
  status: string;
}

interface AdminVehicleJobHistoryVehicleResponse extends AdminVehicleJobListItemResponse {
  created_at: string;
  updated_at: string;
}

// Type แถวสินค้าใน response history และ operation ของ Admin
interface AdminVehicleJobHistoryProductResponse {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
  confirmed_quantity: string | null;
}

// Type แถว booth/ticket ที่แสดงใน response history และ operation ของ Admin
interface AdminVehicleJobHistoryTicketResponse {
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

// Type แถว market ที่รวม booth/ticket ใน history งานรถของ Admin
interface AdminVehicleJobHistoryMarketResponse {
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  tickets: AdminVehicleJobHistoryTicketResponse[];
}

// Type item ใน response history งานรถของ Admin
export interface AdminVehicleJobHistoryItemResponse {
  vehicle_job: AdminVehicleJobHistoryVehicleResponse;
  markets: AdminVehicleJobHistoryMarketResponse[];
}

// Type จำนวนสถานะสำหรับ list ด้านซ้ายของบอร์ด operation ฝั่ง Admin
export interface AdminVehicleJobOperationSummaryResponse {
  total: number;
  unload_now: number;
  waiting_unload: number;
  waiting_queue: number;
  driver_waiting_queue: number;
}

// Type จำนวน assignment ของ worker ในงานรถหนึ่งงานบนบอร์ด operation ของ Admin
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

// Type จำนวน market/booth/product ของงานรถหนึ่งงานบนบอร์ด operation ของ Admin
export interface AdminVehicleJobOperationMarketSummaryResponse {
  total: number;
  stalls: number;
  products: number;
  delivered: number;
  confirmed: number;
  rejected: number;
}

// Type แถว worker ที่แสดงในรายละเอียด operation ของรถหนึ่งงาน
interface AdminVehicleJobOperationWorkerResponse {
  worker_code: string | null;
  full_name: string;
  shirt_number: string | null;
  image_url: string | null;
  shift_name: string | null;
  assignment_status: string;
  worker_status: string;
  accept_deadline_at: string | null;
  accept_deadline_unix_ms?: number | null;
  scan_deadline_at: string | null;
  scan_deadline_unix_ms?: number | null;
  accepted_at: string | null;
  scanned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type แถว booth/ticket พร้อมจำนวนสินค้าในรายละเอียด operation ของ Admin
interface AdminVehicleJobOperationTicketResponse
  extends AdminVehicleJobHistoryTicketResponse {
  product_count: number;
}

// Type แถว market พร้อม summary ในรายละเอียด operation ของ Admin
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

// Type ข้อมูลเต็มของงานรถหนึ่งงานบนบอร์ด operation
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

// Type response แบบ list สำหรับบอร์ด operation ของ Admin
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

// Type response กลางแบบสั้นสำหรับ action ที่แก้งานฝั่ง Admin
export interface AdminVehicleJobActionResponse {
  message: string;
  ticketNo: string;
  status: string;
}

export type AdminJobCancelResponse =
  | AdminVehicleJobActionResponse
  | AdminCancelVehicleJobAndRequeueResponse
  | AdminMarketJobActionResponse
  | AdminStallJobActionResponse;

export interface AdminScanDeadlineAssignmentResponse {
  worker_code: string | null;
  status: string;
  scan_deadline_at: string | null;
  scan_deadline_unix_ms: number | null;
}

export interface AdminExtendScanDeadlineResponse {
  message: string;
  ticketNo: string;
  worker_qr_token: string;
  assignments: AdminScanDeadlineAssignmentResponse[];
}

export interface AdminAssignmentResponse {
  ticketNo: string;
  worker_code: string | null;
  status: string;
  accept_deadline_at: string | null;
  accept_deadline_unix_ms: number | null;
  scan_deadline_at: string | null;
  scan_deadline_unix_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAssignWorkersResponse {
  message: string;
  ticketNo: string;
  assignments: AdminAssignmentResponse[];
}

export interface AdminCancelAssignmentResponse {
  message: string;
  ticketNo: string | null;
  worker_code: string | null;
  status: string;
}

export interface AdminCancelVehicleJobAndRequeueResponse {
  message: string;
  ticketNo: string;
  status: string;
  requeued_worker_codes: Array<string | null>;
}

// Type response หลังยกเลิกงาน market หนึ่งรายการ
export interface AdminMarketJobActionResponse {
  message: string;
  ticketNo: string | null;
  marketCode: string;
  status: string;
}

// Type response หลังยกเลิกงาน booth/ticket หนึ่งรายการ
export interface AdminStallJobActionResponse {
  message: string;
  ticketNo: string | null;
  marketCode: string | null;
  boothCode: string;
  status: string;
  confirmation_status: string;
}
