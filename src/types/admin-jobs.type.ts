import type { Prisma } from "@prisma/client";
import type { DAILY_WORKER_INCOME_PAYMENT_STATUS, VEHICLE_OPERATION_STATUS } from "../constants/job-status";

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
                submittedByAccount: true;
                submittedByWorker: true;
                workerSnapshots: {
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

// Type business group ของ Work History — ALL คือ OR ของ COMPLETED/CANCELLED/REJECT_PENDING
// เท่านั้น ไม่ใช่ทุกสถานะในฐานข้อมูล (ดู buildHistoryStatusFilter)
export type HistoryStatusFilter = "ALL" | "COMPLETED" | "CANCELLED" | "REJECT_PENDING";

// Type ค่า HistoryStatus ที่ derive ต่อ record สำหรับ response — เหมือน HistoryStatusFilter แต่ไม่มี
// ALL และเป็น null เมื่อ VehicleJob ไม่เข้ากลุ่มใดเลย (เช่น WAIT/WORKING ที่ไม่มี Booth REJECT ค้าง —
// เกิดได้เมื่อไม่ได้ส่ง history_status มา default ยังคืนทุกสถานะเหมือนเดิม)
export type HistoryStatusValue = "COMPLETED" | "CANCELLED" | "REJECT_PENDING";

// Type เหตุการณ์สำคัญย้อนหลังของ VehicleJob — คนละความหมายกับ HistoryStatusValue (สถานะหลักปัจจุบัน)
// งานหนึ่งงานมีได้หลายค่าพร้อมกัน ยกเว้น VEHICLE_CANCELLED_AFTER_START/BEFORE_START ที่ mutually
// exclusive กันเอง (ดู deriveHistoryFlags) เรียงตามลำดับความสำคัญที่ deriveHistoryFlags ใช้คืนค่า
export const HISTORY_FLAG_VALUES = [
  "FINANCE_CALCULATED",
  "WORKERS_RELEASED",
  "BOOTH_REJECTED",
  "AUTO_CONFIRMED",
  "WORKER_CHANGED_DURING_JOB",
  "SUBMISSION_ROSTER_INCOMPLETE",
  "ADMIN_SUBMITTED_ON_BEHALF",
  "VEHICLE_CANCELLED_AFTER_START",
  "VEHICLE_CANCELLED_BEFORE_START",
] as const;

export type HistoryFlagValue = (typeof HISTORY_FLAG_VALUES)[number];

export interface VehicleJobListFilters {
  search?: string;
  status?: string;
  history_status?: HistoryStatusFilter;
  dropoff_point?: string;
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
  dropoff_point?: string;
  startAt?: Date;
  endAt?: Date;
  page?: number;
  limit?: number;
}

export interface VehicleJobHistoryListResult {
  data: AdminVehicleJobHistoryRecord[];
  total?: number;
  available_dropoff_points: string[];
}

export interface AdminVehicleJobListItemResponse {
  ticket_number: string;
  plate_no: string;
  plate_province: string | null;
  vehicle_type: string | null;
  workers_required: number;
  dispatch_now: boolean;
  status: string;
}

interface AdminVehicleJobTimestampedVehicleResponse extends AdminVehicleJobListItemResponse {
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
  // Current Master Owner ของ Booth นี้ (MasterOwnerStall ตาม marketCode+boothCode) ไม่ใช่
  // Historical Snapshot ณ เวลาที่ Reject เกิดขึ้น
  correction_owner: string | null;
  // ใครควรเป็นคนแก้ยอด — ประเมินจาก VehicleJob.status ปัจจุบัน (เหมือน correction_owner ข้างบน คือ
  // current state ไม่ใช่ historical snapshot ณ เวลา Reject): "worker" เมื่อ VehicleJob ยังไม่ถูก
  // Release (ทีมยังอยู่หน้างาน กลับไปแก้ยอดเองได้) "admin" เมื่อ VehicleJob ถูก Release แล้ว (ทีมกลับ
  // เข้าคิวไปแล้ว ต้อง Admin เป็นคนจัดการแทน)
  correction_owner_type: "worker" | "admin";
  // ผู้กด Reject จริงผ่าน LINE (resolve จาก resolvedByLineUserId) — null เมื่อเป็น Auto Timeout
  // Confirm หรือ resolve ไม่ได้
  rejected_by_type: "owner" | "member" | null;
  rejected_by_name: string | null;
}

export interface AdminHistorySubmissionWorkerResponse {
  worker_code: string | null;
  full_name: string;
}

// Type Product ใน Work History — เหมือน AdminFinancialProductResponse ทุกประการ ยกเว้นไม่มี
// ticket_product_id (internal PK ที่ /financials ต้องใช้ระบุแถวสำหรับ override แต่ Work History
// ไม่มีปุ่มแก้ไขจึงไม่ต้องเปิดเผย)
export type AdminHistoryProductResponse = Omit<AdminFinancialProductResponse, "ticket_product_id">;

// Type Booth ใน Work History แบบละเอียด ต่อยอดจาก AdminFinancialBoothResponse ด้วยข้อมูล
// การส่งยอด/Reject ที่หน้าจอ Financial เดิมไม่ต้องใช้ — ตัด ticket_id/ticket_no/marketCode/marketName
// ออกเพราะซ้ำกับข้อมูลที่มีอยู่แล้วระดับ Markets[] หนึ่งชั้นเหนือขึ้นไป
export interface AdminHistoryBoothResponse
  extends Omit<AdminFinancialBoothResponse, "ticket_id" | "ticket_no" | "marketCode" | "marketName" | "products"> {
  products: AdminHistoryProductResponse[];
  vendor_line_id: string | null;
  // De-duped Account codes (Worker or Admin) that submitted counts for this Booth, across all
  // submissions — renamed from submitted_worker_codes since an Admin submitting on behalf now
  // also appears here.
  submitted_by_codes: string[];
  submitted_by_role: "worker" | "admin" | null;
  // Account (Worker หรือ Admin) ที่ส่งยอดรอบล่าสุดจริง — คนละอันกับ submitted_by_codes ที่เป็น set
  // รวมทุกคนที่เคยส่งทุกรอบ ไม่บอกว่าใครคือคนล่าสุด
  latest_submitted_by_code: string | null;
  latest_submitted_by_name: string | null;
  // Worker roster ที่ยัง WORKING ณ เวลา Submit จริง (SubmissionWorkerSnapshot ของ submission ล่าสุด)
  // ต่างจาก GateTicketWorkerSnapshot (roster ตอน Confirm) ถ้าทีมเปลี่ยนระหว่าง Submit กับ Confirm สอง
  // อันนี้จะให้ผลไม่เหมือนกัน — field นี้ต้องเป็น roster ตอน Submit เท่านั้น ห้ามใช้แทน divisor การเงิน
  submission_worker_snapshot: AdminHistorySubmissionWorkerResponse[];
  submitted_at: string | null;
  // ใช้ camelCase ตาม field เดิม "confirmedAt" ของ /assignments/history (TicketCompletionSubmission
  // concept เดียวกัน) เพื่อไม่ให้ PascalCase "ConfirmedAt" บน Wire ชนกันระหว่างสอง endpoint
  confirmedAt: string | null;
  // ประเภทของการ Confirm ล่าสุด — "vendor" เมื่อ Vendor กดยืนยันเองผ่าน LINE (resolved_by_line_user_id
  // มีค่า), "timeout" เมื่อ Auto-confirm จาก BullMQ Timeout (resolved_by_line_user_id เป็น null แต่
  // confirmedAt ยังมีค่าจริงเสมอทั้งสองกรณี), null เมื่อยังไม่เคย Confirm เลย
  confirmed_by_type: "vendor" | "timeout" | null;
  rejection_history: AdminHistoryRejectionResponse[];
  // (fund_amount / labor_fee_raw) * 100 จาก Finalized Financial Snapshot เดิม — "0.00" เมื่อ
  // labor_fee_raw เป็น 0
  company_share_rate: string;
  // จำนวน Worker WORKING ณ ตอน Submission ล่าสุดของ Booth นี้ (TicketCompletionSubmission.
  // worker_count_snapshot) ไม่ใช่ Roster ปัจจุบัน ไม่ใช่ GateTicketWorkerSnapshot (Confirm-time)
  // และไม่ใช่ Financial worker_count — null เมื่อไม่มี Submission หรือเป็น Submission เก่าก่อน
  // Feature นี้ (ไม่ fallback ไปนับ Worker ปัจจุบัน)
  worker_count: number | null;
  // ข้อมูลการยกเลิกระดับแผงนี้โดยตรง (STALL_JOB_CANCELLED) — null เมื่อ status ไม่ใช่ CANCELLED ถ้า
  // แผงนี้ถูกยกเลิกทางอ้อมจากการยกเลิกทั้งตลาดหรือทั้งคัน (ไม่มี Log ระดับแผงเอง) จะ fallback ไปที่ Log
  // ของระดับที่เป็นสาเหตุจริงแทน (ดู findBoothCancelLog)
  cancellation: AdminHistoryCancellationResponse | null;
}

// Type แถว Business Ticket (market job) ใน Work History แบบละเอียด
export interface AdminHistoryMarketResponse {
  ticket_no: string;
  marketCode: string;
  marketName: string;
  dropoff_point: string | null;
  status: string;
  // ข้อมูลการยกเลิกระดับตลาดนี้โดยตรง (MARKET_JOB_CANCELLED) — null เมื่อ status ไม่ใช่ CANCELLED ถ้า
  // ตลาดนี้ถูกยกเลิกทางอ้อมจากการยกเลิกทั้งคัน (ไม่มี Log ระดับตลาดเอง) จะ fallback ไปที่ Log ระดับรถ
  // แทน (ดู findMarketCancelLog)
  cancellation: AdminHistoryCancellationResponse | null;
  booths: AdminHistoryBoothResponse[];
}

// Type ข้อมูลการยกเลิกหนึ่งรายการ — ใช้ร่วมกันทุกระดับที่มี Status = CANCELLED ได้ (VehicleJob,
// MarketJob/ตลาด, GateTicket/แผง, และ Worker คนเดียวที่ถูกถอดออกจากทีม) null ทั้งก้อนเมื่อระดับนั้น
// ไม่ได้ถูกยกเลิก ส่วน sub-field เป็น null ได้เองถ้าหา AdminActionLog ที่ตรงกันไม่เจอ
export interface AdminHistoryCancellationResponse {
  cancelled_at: string | null;
  reason_code: string | null;
  reason_text: string | null;
  // role ของ Actor จริงที่กด Cancel (AdminActionLog.actor_role) — null เมื่อไม่มี Log ที่ตรงกัน
  cancelled_by_type: string | null;
  cancelled_by_name: string | null;
}

export interface AdminHistoryWorkerResponse {
  // Stable identity สำหรับ join กับ finance.workers[] และรายงานอื่น — ห้าม join ด้วยชื่อ/เบอร์เสื้อ
  worker_id: number;
  // Accepted assignment ที่ถูกเลือกมาแสดงแถวนี้ (ดู selectLatestAcceptedAssignmentPerWorker)
  assignment_id: number;
  worker_code: string | null;
  full_name: string;
  labor_color: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  // Business Definition: Worker ถือว่าเริ่มงานตั้งแต่กด Accept Assignment จึงใช้ accepted_at เป็น started_at
  started_at: string | null;
  submitted_at: string | null;
  released_at: string | null;
  final_status: string;
  cancellation: AdminHistoryCancellationResponse | null;
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
  // จำนวน Worker ที่ไม่ซ้ำกันซึ่งกดรับงานจริง — ชุดเดียวกับ workers[] ด้านล่างและกับ
  // vehicle_job history workers[] (formatAdminHistoryWorkers) เป๊ะ
  worker_count: number;
  // เงินจริงต่อ Worker แต่ละคน รวมทุก Business Ticket ของ VehicleJob นี้ — ห้ามหารเฉลี่ย (SUM ของ
  // TicketWorker.finalEarningAmount ต่อ workerId) ชุด Worker คือคนที่กดรับงานจริงและไม่ซ้ำ
  // ต่อคน (เดียวกับ vehicle_job history workers[]) — "0.00" เมื่อกดรับแล้วแต่ยังไม่มีรายได้จริง
  workers: Array<{
    worker_id: number;
    worker_code: string | null;
    full_name: string;
    total_amount: string;
  }>;
}

// Type item ใน response history งานรถของ Admin
export interface AdminVehicleJobHistoryItemResponse {
  vehicle_job: AdminVehicleJobListItemResponse & {
    ticket_created_at: string | null;
    work_started_at: string | null;
    submitted_complete_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
    // Business group ของ Work History (CANCELLED > COMPLETED > REJECT_PENDING ตามลำดับความสำคัญ) —
    // null เมื่อไม่เข้ากลุ่มใดเลย ให้ Frontend แสดงป้ายสถานะได้โดยไม่ต้อง derive ซ้ำจาก markets/booths
    history_status: HistoryStatusValue | null;
    // เหตุการณ์สำคัญย้อนหลังที่เคยเกิดขึ้นกับงานนี้ — คนละความหมายกับ history_status (สถานะหลัก
    // ปัจจุบัน) เรียงตามลำดับใน HISTORY_FLAG_VALUES ไม่ซ้ำ ไม่เป็น null (เป็น [] เมื่อไม่พบเหตุการณ์ใด)
    history_flags: HistoryFlagValue[];
    // ข้อมูลการยกเลิกทั้งคันโดยตรง (VEHICLE_JOB_CANCELLED) — null เมื่อ status ไม่ใช่ CANCELLED เป็น
    // ระดับบนสุดจึงไม่มี fallback ไปที่ระดับอื่น (ต่างจาก markets[].cancellation/booths[].cancellation)
    cancellation: AdminHistoryCancellationResponse | null;
  };
  markets: AdminHistoryMarketResponse[];
  workers: AdminHistoryWorkerResponse[];
  timeline: AdminHistoryTimelineItemResponse[];
  finance: AdminHistoryFinanceResponse;
}

// Type จำนวนสถานะสำหรับ list ด้านซ้ายของบอร์ด operation ฝั่ง Admin
export interface AdminVehicleJobOperationSummaryResponse {
  total: number;
  ready_now: number;
  wait_unload: number;
  wait_worker: number;
  working: number;
  completed: number;
  cancelled: number;
  reject: number;
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
  labor_color: string | null;
  shirt_number: string | null;
  picture: string | null;
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
  released_at: string | null;
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
  vehicle_job: AdminVehicleJobTimestampedVehicleResponse & {
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
  // ทุก dropoff_point ที่มีจริงภายใต้ filter อื่น (date range/search) ไม่รวม dropoff_point เอง — ให้
  // Frontend ใช้สร้าง dropdown ได้ครบทุกตัวเลือกเสมอ ไม่ว่าจะกำลัง paginate/กรองอยู่หรือไม่ก็ตาม
  available_dropoff_points: string[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface AdminScanDeadlineAssignmentResponse {
  worker_code: string | null;
  status: string;
  scan_deadline_at: string | null;
  scan_deadline_unix_ms: number | null;
}

// ไม่มี QR/barcode เดี่ยวให้ส่งเพราะ check-in เป็นระดับ Business Ticket (scan ticket_no ใบไหนก็ได้)
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

// Type response หลังถอด Worker หนึ่งคนออกจากแค่ Booth เดียว (ไม่แตะ TicketWorker.status — worker
// ยังเป็นสมาชิก WORKING ของ Business Ticket ตามปกติ ยังทำ Booth อื่นในใบเดียวกันต่อได้) ต่างจาก
// AdminCancelTicketWorkerResponse ที่ถอดออกทั้ง Business Ticket
export interface AdminCancelTicketWorkerFromBoothResponse {
  message: string;
  ticket_number: string;
  ticket_no: string;
  boothCode: string;
  worker_code: string;
  status: string;
}

// Type response ของเส้นยกเลิกรวม (POST /vehicle-jobs/assignment/cancel) — shape จริงขึ้นกับ scope ที่
// caller ระบุมา (ดู adminVehicleJobAssignmentCancelBodySchema/cancelVehicleJobAssignment)
export type AdminVehicleJobAssignmentCancelResponse =
  | AdminCancelVehicleJobAndRequeueResponse
  | AdminMarketJobActionResponse
  | AdminStallJobActionResponse
  | AdminCancelAssignmentResponse
  | AdminCancelTicketWorkerResponse
  | AdminCancelTicketWorkerFromBoothResponse;

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
  dispatch_now: boolean;
  // Workers pulled off this vehicle job and put back at the front of the FIFO queue. Only
  // populated when dispatch was switched to false; always empty when switched to true.
  requeued_worker_codes: Array<string | null>;
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
            adminActionLogs: {
              include: {
                actor: true;
              };
            };
          };
        };
        tickets: {
          include: {
            completionSubmissions: true;
            adminActionLogs: {
              include: {
                actor: true;
              };
            };
          };
        };
        adminActionLogs: {
          include: {
            actor: true;
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
  // Actor ที่ยกเลิก ticket_no นี้ (จาก admin_action_logs) — มีค่าเฉพาะตอน payment_status = cancel
  // เท่านั้น (การถอด worker คนเดียวออกจาก roster โดยที่ ticket_no ยังไม่ถูกยกเลิกทั้งใบ ยังไม่มี Audit
  // Log ผูกอยู่ จึงเป็น null)
  cancelled_by_type: string | null;
  cancelled_by_name: string | null;
}

export type DailyWorkerIncomePaymentStatus =
  (typeof DAILY_WORKER_INCOME_PAYMENT_STATUS)[keyof typeof DAILY_WORKER_INCOME_PAYMENT_STATUS];

// Type แถวรายได้ Worker รายวันหนึ่งแถว (หนึ่ง Worker หนึ่ง Business Ticket) — เฉพาะแถวที่มี
// payment_status ตรงกับ 5 สถานะที่ UI ต้องการเท่านั้น แถวที่ไม่เข้าเงื่อนไขไหนเลย (เช่นยัง WORKING
// อยู่เฉยๆ ไม่มี reject ค้าง) จะถูกกรองออกทั้งแถวตั้งแต่ใน service layer ไม่ถึง type นี้เลย
export interface DailyWorkerIncomeItemResponse {
  worker: DailyWorkerIncomeWorkerResponse;
  accepted_at: string | null;
  shift: number | null;
  ticket_no: string;
  plate: string;
  // ยอดรวมที่ worker คนนี้ได้จาก ticket_no ใบนี้เท่านั้น (TicketWorker.final_earning_amount
  // ผูกกับ marketJobId+workerId อยู่แล้ว จึงไม่ต้องรวมข้าม ticket_no อื่น แม้จะเป็น
  // ticket_number/รถคันเดียวกัน)
  payable: string;
  scanned_at: string | null;
  // ทุกแถวของ worker บนรถคันเดียวกันใช้ค่าเดียวกัน (VehicleJob.workStartedAt) — เวลาที่ทีมทั้งหมด
  // scan เข้างานครบ ไม่ใช่เวลา scan ของ worker คนนั้นเอง (ต่างจาก scanned_at)
  started_at: string | null;
  // เวลาส่งยอดล่าสุดของ booth ล่าสุดใน ticket_no นี้ ไม่ว่า worker คนไหนในทีมเป็นคนกดส่ง (ทุกแถวของ
  // ticket_no เดียวกันใช้ค่าเดียวกัน เหมือน confirmedAt)
  submitted_at: string | null;
  // ใช้ camelCase ตาม field เดิม "confirmedAt" ของ /assignments/history เพื่อไม่ให้ PascalCase
  // "ConfirmedAt" บน Wire ชนกันระหว่างสอง endpoint
  confirmedAt: string | null;
  released_at: string | null;
  payment_status: DailyWorkerIncomePaymentStatus;
  cancellation: DailyWorkerIncomeCancellationResponse | null;
  riskText: string;
}

/* -------------------------------------- Daily Stall Fee -------------------------------------- */

// Type record สำหรับอ่านรายงานค่าลงสินค้าแผงค้ารายวันจาก DB — หนึ่งแถว = หนึ่ง TicketProductFinancial
// ที่ finalize แล้ว join ตามสาย TicketProductFinancial -> TicketProduct -> GateTicket -> MarketJob ->
// VehicleJob ตาม docs/backend-missing-apis-spec V8.md ข้อ 28.2 — ห้ามอ่านชื่อ/ราคาสินค้าจาก master
// ปัจจุบัน ใช้ snapshot ใน TicketProduct เท่านั้น
export type DailyStallFeeRecord = Prisma.TicketProductFinancialGetPayload<{
  include: {
    product: {
      include: {
        ticket: {
          include: {
            marketJob: {
              include: {
                vehicleJob: true;
              };
            };
          };
        };
      };
    };
  };
}>;

export interface DailyStallFeeFilters {
  startAt: Date;
  endAt: Date;
  search?: string;
  productCode?: string;
  packageCode?: string;
  page: number;
  limit: number;
}

export interface DailyStallFeeSummary {
  row_count: number;
  stall_count: number;
  confirmed_quantity_total: Prisma.Decimal;
  stall_fee_total: Prisma.Decimal;
}

export interface DailyStallFeeProductOption {
  product_code: string;
  product_name: string;
}

export interface DailyStallFeePackageOption {
  package_code: string;
  package_name: string;
}

// Type ผลลัพธ์ดิบจาก repository — service เป็นคนแปลง Decimal/Date เป็น string ตาม response contract
export interface DailyStallFeeQueryResult {
  data: DailyStallFeeRecord[];
  total: number;
  summary: DailyStallFeeSummary;
  available_products: DailyStallFeeProductOption[];
  available_packages: DailyStallFeePackageOption[];
}

export interface DailyStallFeeItemResponse {
  id: number;
  business_date: string;
  finalized_at: string;
  booth_code: string;
  plate: string;
  plate_province: string | null;
  ticket_no: string;
  market_code: string;
  market_name: string;
  product_code: string;
  product_full_code: string | null;
  product_name: string;
  package_code: string;
  package_name: string;
  confirmed_quantity: string;
  stall_fee_rounded: string;
}

export interface DailyStallFeeListResponse {
  data: DailyStallFeeItemResponse[];
  summary: {
    row_count: number;
    stall_count: number;
    confirmed_quantity_total: string;
    stall_fee_total: string;
  };
  available_products: DailyStallFeeProductOption[];
  available_packages: DailyStallFeePackageOption[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
