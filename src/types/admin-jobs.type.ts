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
// Worker Roster (ticketWorkers) อยู่ระดับ Business Ticket (marketJob) ส่วน Booth/Product
// ยังอยู่ระดับ tickets (GateTicket) เหมือนเดิม
export type AdminVehicleJobFinancialRecord = Prisma.VehicleJobGetPayload<{
  include: {
    marketJobs: {
      include: {
        ticketWorkers: {
          include: {
            worker: true;
            payments: true;
          };
        };
        tickets: {
          include: {
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
    };
  };
}>;

// Type record สำหรับอ่าน Work History แบบละเอียดของ VehicleJob จาก DB
//
// เป็น superset ของ AdminVehicleJobFinancialRecord โดยตั้งใจ (marketJobs.ticketWorkers,
// marketJobs.tickets.products.financial.workerPayments.ticketWorker.worker เหมือนกันทุก field)
// เพื่อให้ formatAdminFinancialBooth / formatAdminFinancialProduct ใช้ซ้ำได้ตรงๆ โดยไม่คำนวณเงินใหม่
// ส่วนที่เพิ่มมาคือ completionSubmissions (Rejection History) และ assignments.events (Timeline)
export type AdminVehicleJobHistoryRecord = Prisma.VehicleJobGetPayload<{
  include: {
    marketJobs: {
      include: {
        ticketWorkers: {
          include: {
            worker: true;
            payments: true;
          };
        };
        tickets: {
          include: {
            completionSubmissions: {
              include: {
                submittedByWorker: true;
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
    };
    assignments: {
      include: {
        worker: true;
        events: true;
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
  // Business Ticket (market job) ที่ Booth นี้สังกัดอยู่
  ticket_no: string;
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
    ticket_number: string;
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

export interface VehicleJobHistoryListResult {
  data: AdminVehicleJobHistoryRecord[];
  total?: number;
}

export interface AdminVehicleJobListItemResponse {
  ticket_number: string;
  license_plate: string;
  license_plate_province: string | null;
  vehicle_type: string | null;
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

// Type แถว Business Ticket (market job) ที่รวม booth ใน history งานรถของ Admin
interface AdminVehicleJobHistoryMarketResponse {
  ticket_no: string;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  booths: AdminVehicleJobHistoryTicketResponse[];
}

// ---- ส่วนขยายของ Work History (Workers / Timeline / Finance / Rejection History) ----
// แยกจาก AdminVehicleJobHistoryTicketResponse/MarketResponse โดยตั้งใจ เพราะสองอันนั้นถูก
// Operations board (admin-job-operations.formatter.ts) extend ใช้ต่อ การเพิ่ม field ที่นี่แทน
// ทำให้ Operations board ไม่ต้อง fetch ข้อมูล Finance/Roster ที่มันไม่ได้ใช้

// Type ประวัติการ Reject หนึ่งครั้งของ Booth (จาก TicketCompletionSubmission ที่ rejectedAt ไม่ null)
export interface AdminHistoryRejectionResponse {
  // ใช้ camelCase ตาม field เดิม "rejectedAt" ของ /assignments/history (TicketCompletionSubmission
  // concept เดียวกัน) เพื่อไม่ให้ PascalCase "RejectedAt" บน Wire ชนกันระหว่างสอง endpoint
  rejectedAt: string;
  reject_reason: string | null;
  corrected_by_worker_code: string | null;
}

// Type สินค้าใน Work History แบบละเอียด (มี Rate Snapshot + Financial ต่อ Worker) เหมือน /financials
export type AdminHistoryProductResponse = AdminFinancialProductResponse;

// Type Booth ใน Work History แบบละเอียด ต่อยอดจาก AdminFinancialBoothResponse ด้วยข้อมูล
// การส่งยอด/Reject ที่หน้าจอ Financial เดิมไม่ต้องใช้
export interface AdminHistoryBoothResponse extends AdminFinancialBoothResponse {
  vendor_line_id: string | null;
  reject_reason: string | null;
  submitted_worker_codes: string[];
  submitted_at: string | null;
  // ใช้ camelCase ตาม field เดิม "confirmedAt" ของ /assignments/history (TicketCompletionSubmission
  // concept เดียวกัน) เพื่อไม่ให้ PascalCase "ConfirmedAt" บน Wire ชนกันระหว่างสอง endpoint
  confirmedAt: string | null;
  rejection_history: AdminHistoryRejectionResponse[];
}

// Type แถว Business Ticket (market job) ใน Work History แบบละเอียด
export interface AdminHistoryMarketResponse {
  ticket_no: string;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  booths: AdminHistoryBoothResponse[];
}

// Type สรุปสถานะสุดท้ายของ Worker หนึ่งคนที่ถูก Dispatch เข้า VehicleJob นี้
export interface AdminHistoryWorkerCancellationResponse {
  cancelled_at: string | null;
  reason_code: string | null;
  reason_text: string | null;
}

export interface AdminHistoryWorkerResponse {
  worker_code: string | null;
  full_name: string;
  shirt_number: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  // ไม่มีสัญญาณ "เริ่มงาน" แยกจาก Scan ใน Data Model ปัจจุบัน จึงใช้ scanned_at เป็น started_at
  started_at: string | null;
  submitted_at: string | null;
  released_at: string | null;
  final_status: string;
  cancellation: AdminHistoryWorkerCancellationResponse | null;
}

// Type รายการ Timeline หนึ่งเหตุการณ์ของ VehicleJob
export interface AdminHistoryTimelineItemResponse {
  type: string;
  occurred_at: string;
  actor_type: "worker" | "admin" | "system";
  actor_name: string | null;
  description: string;
}

// Type สรุป Finance ระดับ VehicleJob ทั้งคัน (รวมทุก Business Ticket) — Reuse ค่าที่ Finalize แล้ว
// จาก TicketProductFinancial/TicketWorkerPayment ห้ามคำนวณสูตรใหม่
export interface AdminHistoryFinanceResponse {
  stall_fee_total: string;
  labor_fee_total: string;
  total_worker_share: string;
  fund_amount: string;
  // จำนวน Worker ที่ไม่ซ้ำกันซึ่งเคยอยู่ใน Roster ของ Business Ticket ใดใบหนึ่งของรถคันนี้
  worker_count: number;
}

// Type item ใน response history งานรถของ Admin
export interface AdminVehicleJobHistoryItemResponse {
  vehicle_job: AdminVehicleJobHistoryVehicleResponse & {
    work_start: string | null;
    submitted_complete_at: string | null;
    vendor_confirmed_complete_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
  };
  markets: AdminHistoryMarketResponse[];
  workers: AdminHistoryWorkerResponse[];
  timeline: AdminHistoryTimelineItemResponse[];
  finance: AdminHistoryFinanceResponse;
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
  booths: AdminVehicleJobOperationTicketResponse[];
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
  ticket_number: string;
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

// ไม่มี worker_qr_token เดี่ยวให้ส่งอีกต่อไป เพราะ QR check-in เป็นระดับ Business Ticket
export interface AdminExtendScanDeadlineResponse {
  message: string;
  ticket_number: string;
  assignments: AdminScanDeadlineAssignmentResponse[];
}

export interface AdminAssignmentResponse {
  ticket_number: string;
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
  ticket_number: string;
  assignments: AdminAssignmentResponse[];
}

export interface AdminCancelAssignmentResponse {
  message: string;
  ticket_number: string | null;
  worker_code: string | null;
  status: string;
}

export interface AdminCancelVehicleJobAndRequeueResponse {
  message: string;
  ticket_number: string;
  status: string;
  requeued_worker_codes: Array<string | null>;
}

// Type response หลังยกเลิกงาน market (Business Ticket) หนึ่งรายการ
export interface AdminMarketJobActionResponse {
  message: string;
  ticket_number: string | null;
  ticket_no: string;
  marketCode: string;
  status: string;
}

// Type response หลังยกเลิกงาน booth/ticket หนึ่งรายการ
export interface AdminStallJobActionResponse {
  message: string;
  ticket_number: string | null;
  ticket_no: string | null;
  marketCode: string | null;
  boothCode: string;
  status: string;
  confirmation_status: string;
}

// Type response หลังยกเลิก Worker หนึ่งคนออกจาก Business Ticket ใบเดียว (ไม่แตะ Assignment
// ระดับรถ ต่างจาก AdminCancelAssignmentResponse ที่ยกเลิกทั้ง TicketNumber)
export interface AdminCancelTicketWorkerResponse {
  message: string;
  ticket_number: string;
  ticket_no: string;
  worker_code: string;
  status: string;
}

// Type แถวสินค้าที่ Admin แก้/ส่งยอดแทน Worker หนึ่งรายการ
export interface AdminOverrideCountItemResponse {
  productCode: string;
  packageCode: string;
  previous_quantity: string | null;
  confirmed_quantity: string | null;
}

// Type response หลัง Admin แก้/ส่งยอดสินค้าแทน Worker ของ Booth หนึ่งใบ
export interface AdminOverrideCountResponse {
  message: string;
  ticket_number: string;
  boothCode: string;
  status: string;
  reason_code: string;
  reason_text: string | null;
  products: AdminOverrideCountItemResponse[];
}

// Type response หลัง Admin สั่งให้ VehicleJob กลับไปสถานะ WAIT
export interface AdminVehicleWaitResponse {
  message: string;
  ticket_number: string;
  status: string;
  reason_code: string;
  reason_text: string | null;
}

// Type response หลัง Admin ปล่อย Worker ทั้งทีมของ VehicleJob กลับคิวก่อนเวลา
export interface AdminReleaseWorkersResponse {
  message: string;
  ticket_number: string;
  released_worker_codes: Array<string | null>;
  reason_code: string;
  reason_text: string | null;
}

/* -------------------------------------- Daily Worker Income -------------------------------------- */

// Type record สำหรับอ่านรายได้ Worker รายวันจาก DB — หนึ่งแถว = สมาชิกภาพของ Worker หนึ่งคนใน
// Business Ticket (TicketWorker) หนึ่งใบ ใช้ final_earning_amount ที่ Finalize แล้วตรงๆ
// ห้ามคำนวณสูตรใหม่
export type DailyWorkerIncomeRecord = Prisma.TicketWorkerGetPayload<{
  include: {
    worker: true;
    marketJob: {
      include: {
        vehicleJob: {
          include: {
            assignments: {
              include: {
                worker: true;
              };
            };
          };
        };
        tickets: {
          include: {
            completionSubmissions: true;
          };
        };
      };
    };
  };
}>;

export interface DailyWorkerIncomeFilters {
  workerCode?: string;
  status?: string;
  shift?: number;
  startAt?: Date;
  endAt?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

export interface DailyWorkerIncomeWorkerResponse {
  code: string | null;
  name: string;
  shirt: string | null;
}

export interface DailyWorkerIncomeCancellationResponse {
  cancelled_at: string | null;
  reason_code: string | null;
  reason_text: string | null;
}

// Type แถวรายได้ Worker รายวันหนึ่งแถว (หนึ่ง Worker หนึ่ง Business Ticket)
export interface DailyWorkerIncomeItemResponse {
  id: string;
  business_date: string;
  shift: number | null;
  ticket_number: string;
  marketJobNo: string;
  plate: string;
  worker: DailyWorkerIncomeWorkerResponse;
  assigned_stalls: number;
  confirmed_stalls: number;
  collected: string;
  payable: string;
  status: string;
  accepted_at: string | null;
  scanned_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  // ใช้ camelCase ตาม field เดิม "confirmedAt" ของ /assignments/history เพื่อไม่ให้ PascalCase
  // "ConfirmedAt" บน Wire ชนกันระหว่างสอง endpoint
  confirmedAt: string | null;
  released_at: string | null;
  cancellation: DailyWorkerIncomeCancellationResponse | null;
}
