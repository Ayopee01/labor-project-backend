/* -------------------------------------- Gate Create Input -------------------------------------- */

// Type ข้อมูลสินค้าก่อนบันทึกจาก Gate
interface GateProductCreateInput {
  productCode: string;
  productName: string;
  productFullCode: string;
  packageCode: string;
  packageName: string;
  quantity: number;
}

// Type ข้อมูลแผงก่อนบันทึกจาก Gate
interface GateTicketCreateInput {
  boothCode: string;
  boothName: string;
  vendor_line_id?: string;
  reject_reason?: string;
  products: GateProductCreateInput[];
}

// Type ข้อมูลตลาดก่อนบันทึกจาก Gate
interface GateMarketCreateInput {
  marketCode: string;
  marketName: string;
  dropoff_point?: string;
  tickets: GateTicketCreateInput[];
}

// Type ข้อมูลสำหรับสร้าง VehicleJob จาก Gate
export interface GateVehicleJobCreateInput {
  gate_transaction_ref: string;
  ticketNo: string;
  ticket_created_at: Date;
  booth_count: number;
  license_plate: string;
  vehicle_type?: string;
  workers_required: number;
  dispatch_now?: boolean;
  markets: GateMarketCreateInput[];
}

/* -------------------------------------- Gate Request -------------------------------------- */

// Type สินค้าที่ Gate ส่งมา
export interface GateVehicleJobProductBody {
  ProductCode: string;
  PackageCode: string;
  Quantity: number;
}

// Type แผงและสินค้าที่ Gate ส่งมา
export interface GateVehicleJobBoothBody {
  BoothCode: string;
  Products: GateVehicleJobProductBody[];
}

// Type request หลักจาก Gate
export interface GateVehicleJobBody {
  TicketNo: string;
  TicketCreatedAt: string;
  BoothCount: number;

  MarketCode: string;

  LicensePlate: string;
  VehicleTypeCode: string;
  VehicleTypeName: string;

  Booths: GateVehicleJobBoothBody[];

  Dispatch: boolean;
}

/* -------------------------------------- Gate Response -------------------------------------- */

// Type สถานะผลการสร้าง Gate ticket
export type GateVehicleJobResult =
  | "CREATED"
  | "REPLAYED";

// Type สถานะงานที่คืนให้ Gate
export type GateVehicleJobResponseStatus =
  | "unload_now"
  | "waiting_unload";

// Type ข้อมูล Ticket ที่คืนให้ Gate
interface GateVehicleJobResponseTicket {
  TicketNo: string;
  TicketCreatedAt: string;
  BoothCount: number;
  LicensePlate: string;
  VehicleTypeCode: string | null;
  VehicleTypeName: string | null;
  Status: GateVehicleJobResponseStatus;
}

// Type ข้อมูล Market ที่คืนให้ Gate
interface GateVehicleJobResponseMarket {
  MarketCode: string;
  MarketName: string;
}

// Type ข้อมูล Product ที่คืนให้ Gate
interface GateVehicleJobResponseProduct {
  ProductCode: string;
  ProductFullCode: string;
  ProductName: string;
  PackageCode: string;
  PackageName: string;
  Quantity: number;
}

// Type ยอดเงินของแผง
interface GateVehicleJobResponseStallPayment {
  Amount: string;
  RoundingAmount: string;
}

// Type ข้อมูล Booth ที่คืนให้ Gate
interface GateVehicleJobResponseBooth {
  BoothCode: string;
  BoothName: string | null;

  Products: GateVehicleJobResponseProduct[];

  StallPayment: GateVehicleJobResponseStallPayment;
}

// Type เงินที่จ่ายให้ Worker
interface GateVehicleJobResponseWorkerPayment {
  AmountPerWorker: string;
  WorkerCount: number;
  TotalAmount: string;
  DeductedRemainder: string;
}

// Type ยอดเศษรวมของ Order
interface GateVehicleJobResponseOrderRemainder {
  StallRoundingAmount: string;
  WorkerDeductedAmount: string;
  TotalAmount: string;
}

// Type response หลักของ Gate
export interface GateVehicleJobResponse {
  Result: GateVehicleJobResult;

  Ticket: GateVehicleJobResponseTicket;

  Market: GateVehicleJobResponseMarket;

  Booths: GateVehicleJobResponseBooth[];

  WorkerCount: number;

  WorkerPayment: GateVehicleJobResponseWorkerPayment;

  OrderRemainder: GateVehicleJobResponseOrderRemainder;

  Qr: {
    DriverQrToken: string;
    WorkerQrToken: string;
  };
}

/* -------------------------------------- Gate Replay -------------------------------------- */

// Type ข้อมูล Gate request สำหรับ replay
export interface GateRequestReplayRecord {
  gate_transaction_ref: string;
  payload_snapshot: unknown;
  response_snapshot: GateVehicleJobResponse | null;
}

/* -------------------------------------- Vendor LINE -------------------------------------- */

// Type LINE ปลายทางของ Vendor
export interface GateVendorLineTargetDto {
  line_user_id: string;
  target_type: "owner" | "member";
}

/* -------------------------------------- Gate Append -------------------------------------- */

// Type สถานะการเพิ่มแผงใน Ticket เดิม
export interface GateTicketAppendStateDto {
  vehicle_job_id: number;
  booth_count: number;
  existing_booth_count: number;

  duplicate_booth: {
    boothCode: string;
    marketCode: string;
  } | null;
}