import { Prisma } from "@prisma/client";

export type AccountRecord = {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "worker";
  status: string;
  full_name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  permission_level?: string | null;
  shirt_number?: string | null;
  shift_no?: number | null;
  lang: string;
  created_at?: string;
  updated_at?: string;
};

export type WorkerNotificationRecord = {
  id: number;
  worker_account_id: number;
  type: string;
  notification_key: string | null;
  lang: string;
  title: string;
  message: string;
  payload: unknown;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GateClientRecord = {
  id: number;
  client_id: string;
  name: string;
  secret_hash: string;
  status: "active" | "inactive";
  last_used_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentRecord = {
  id: number;
  vehicle_job_id: number;
  worker_account_id: number;
  status: string;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at?: string | null;
  scanned_at?: string | null;
  completed_at?: string | null;
  released_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WorkerAssignmentEventRecord = {
  id: number;
  assignment_id: number;
  worker_account_id: number;
  vehicle_job_id: number;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type VehicleJobRecord = {
  id: number;
  ticket_number: string;
  license_plate: string;
  license_plate_province: string | null;
  vehicle_type: string | null;
  workers_required: number;
  dispatch_now: boolean;
  status: string;
  driver_qr_token: string;
  expected_ticket_count?: number | null;
  tickets_closed_at?: string | null;
  created_at: string;
  updated_at: string;
};

// Business Ticket (repurposed MarketJob) — หนึ่งใบอยู่ได้ตลาดเดียว แต่ TicketNumber
// (VehicleJobRecord) เดียวมีได้หลาย MarketJobRecord
export type MarketJobRecord = {
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
  worker_qr_token: string;
  worker_roster_locked_at: string | null;
  final_stall_amount: string | null;
  financialized_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GateTicketRecord = {
  id: number;
  vehicle_job_id: number;
  market_job_id: number;
  marketCode?: string;
  marketName?: string;
  dropoff_point?: string | null;
  boothCode: string;
  boothName: string | null;
  vendor_line_id: string | null;
  reject_reason: string | null;
  status: string;
  confirmation_status: string | null;
  final_stall_amount?: string | null;
  completed_at?: string | null;
  financialized_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WorkerShiftAttendanceRecord = {
  id: number;
  accountId: number;
  workerCode: string;
  shiftInstanceKey: string;
  shiftNo: number;
  shiftStartTime: string;
  shiftEndTime: string;
  firstOnlineAt: string | null;
  lastOnlineAt: string | null;
  offlineAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  acceptTimeoutStreak: number;
  lastAcceptTimeoutAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TicketProductRecord = {
  id: number;
  ticket_id: number;
  productCode: string;
  productFullCode: string | null;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
  confirmed_quantity: string | null;
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
  created_at?: string;
  updated_at?: string;
};

// Worker Roster ของ Business Ticket (market job) — ไม่ใช่ระดับ Booth อีกต่อไป
export type TicketWorkerRecord = {
  id: number;
  market_job_id: number;
  worker_account_id: number;
  status: string;
  final_earning_amount?: string | null;
  joined_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
};

export type TicketProductFinancialRecord = {
  id: number;
  ticket_product_id: number;
  confirmed_quantity: string;
  stall_fee_raw: string;
  stall_fee_rounded: string;
  labor_fee_raw: string;
  product_charge: string;
  worker_count: number;
  worker_payout_total: string;
  fund_amount: string;
  finalized_at: string;
};

export type TicketWorkerPaymentRecord = {
  id: number;
  ticket_product_financial_id: number;
  ticket_worker_id: number;
  raw_amount: string;
  remainder_amount: string;
  final_amount: string;
};

export type TicketCompletionSubmissionRecord = {
  id: number;
  ticket_id: number;
  submitted_by_worker_account_id: number;
  status: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  resolved_by_line_user_id: string | null;
  created_at?: string;
};

export type TicketRatingRecord = {
  id: number;
  ticket_id: number;
  submission_id: number;
  line_user_id: string;
  target_type: string | null;
  score: number;
  rated_at: string;
  created_at: string;
  updated_at: string;
};

export type LineActionTokenRecord = {
  id: number;
  token: string;
  action: string;
  ticket_id: number;
  submission_id: number;
  boothCode: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GateRequestLogRecord = {
  gate_transaction_ref: string;
  vehicle_job_id: number | null;
  market_job_id: number | null;
  payload_snapshot: unknown;
  response_snapshot: unknown | null;
};

export type MasterProductRecord = {
  id: number;
  productCode: string;
  productFullCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  packageWeight: number;
  range: unknown;
  status: string;
};

export type MasterRateRecord = {
  id: number;
  sourceRateId: number;
  marketCode: string;
  weightRangeName: string;
  weightMin: Prisma.Decimal;
  weightMax: Prisma.Decimal;
  stallRate: Prisma.Decimal;
  laborRate: Prisma.Decimal;
  status: number;
};

export type MasterMarketRecord = {
  id: number;
  marketCode: string;
  marketName: string | null;
  boothCode: string;
  boothName: string;
  marketStatus: string | null;
  boothStatus: string;
};

export type AdminActionLogRecord = {
  id: number;
  vehicle_job_id: number;
  gate_ticket_id: number | null;
  action_type: string;
  reason_code: string | null;
  reason_text: string | null;
  actor_account_id: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
