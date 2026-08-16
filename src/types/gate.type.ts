/* -------------------------------------- Gate Options -------------------------------------- */

// Type ตัวเลือกตลาดสำหรับหน้า Gate UI
export interface GateMarketOption {
  MarketCode: string;
  MarketName: string;
}

// Type ตัวเลือกแผงค้าสำหรับหน้า Gate UI
export interface GateBoothOption {
  BoothCode: string;
  BoothName: string;
}

// Type ตัวเลือกแพ็กเกจของสินค้า
export interface GatePackageOption {
  PackageCode: string;
  PackageName: string;
  PackageWeight: number;
}

// Type ตัวเลือกสินค้าพร้อมแพ็กเกจ
export interface GateProductOption {
  ProductCode: string;
  ProductName: string;
  Packages: GatePackageOption[];
}

// Type response สำหรับ Dropdown/Select ของ Gate UI
export interface GateOptionsResponse {
  Markets: GateMarketOption[];
  Booths: GateBoothOption[];
  Products: GateProductOption[];
}

/* -------------------------------------- Gate Create Input -------------------------------------- */

// Type ข้อมูลสินค้าก่อนบันทึกจาก Gate
//
// quantity:
// - เป็นจำนวนที่ Gate ส่งมา
// - ใช้สำหรับคำนวณจำนวน Worker ที่ต้อง Dispatch จาก Master
// - ยังไม่ใช่จำนวนที่ใช้คิดเงินจริง
//
// Rate Snapshot:
// - Snapshot ตอน Gate Create
// - จะถูกนำกลับมาใช้ตอน Ticket/Booth COMPLETE
// - ตอน COMPLETE จะใช้ confirmedQuantity แทน quantity
interface GateProductCreateInput {
  productCode: string;
  productFullCode: string;
  productName: string;

  packageCode: string;
  packageName: string;

  quantity: number;

  packageWeightSnapshot: string;

  rateIdSnapshot: number;
  sourceRateIdSnapshot: number;

  // MarketCode ของ Rate ที่ถูกใช้จริง
  // อาจเป็นตลาดที่ร้องขอ หรือ "0000" กรณีใช้ Central Rate
  rateMarketCode: string;

  rateSource:
  | "MARKET_RATE"
  | "CENTRAL_RATE";

  weightRangeName: string;
  weightMinSnapshot: string;
  weightMaxSnapshot: string;

  // PackagePrice
  stallRateSnapshot: string;

  // PackageRate
  laborRateSnapshot: string;

  // เวลาที่ Snapshot Rate
  rateSnapshotAt: Date;
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
  license_plate_province: string;
  vehicle_type?: string;

  // จำนวน Worker ที่ Master กำหนด
  // ใช้สำหรับ Dispatch เท่านั้น
  //
  // ห้ามใช้เป็นจำนวน Worker สำหรับหารเงินจริง
  // เพราะ Financial จะใช้ Worker จริงที่อยู่ใน Booth ตอน COMPLETE
  workers_required: number;

  dispatch_now?: boolean;

  markets: GateMarketCreateInput[];
}

/* -------------------------------------- Gate Request -------------------------------------- */

// Type สินค้าที่ Gate ส่งมา
export interface GateVehicleJobProductBody {
  ProductCode: string;
  PackageCode: string;

  // จำนวนจาก Gate
  // ใช้หา Worker requirement จาก Master
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
  LicensePlateProvince: string;

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
  LicensePlateProvince: string | null;

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
//
// ไม่มีข้อมูลเงินจริงในขั้นตอน Gate Create
// เพราะยังไม่มี confirmedQuantity และยังไม่มี Worker จริง ณ ตอน Complete
interface GateVehicleJobResponseProduct {
  ProductCode: string;
  ProductFullCode: string;
  ProductName: string;

  PackageCode: string;
  PackageName: string;

  // จำนวนที่ Gate ส่งเข้ามา
  Quantity: number;

  // จำนวน Worker ที่ Master กำหนดสำหรับ Product นี้
  // ใช้ด้าน Operation / Dispatch เท่านั้น
  WorkerCount: number;
}

// Type ข้อมูล Booth ที่คืนให้ Gate
//
// ไม่มี StallPayment / WorkerPayment ในขั้นตอนนี้
interface GateVehicleJobResponseBooth {
  BoothCode: string;
  BoothName: string | null;

  Products: GateVehicleJobResponseProduct[];
}

// Type response หลักของ Gate
//
// Gate Create จะคืนเฉพาะข้อมูล Operation
// ยังไม่มี:
// - StallPayment
// - WorkerPayment
// - OrderRemainder
// - Fund
//
// Financial จะเกิดภายหลังเมื่อ Booth/Ticket COMPLETE
export interface GateVehicleJobResponse {
  Result: GateVehicleJobResult;

  Ticket: GateVehicleJobResponseTicket;

  Market: GateVehicleJobResponseMarket;

  Booths: GateVehicleJobResponseBooth[];

  // จำนวน Worker ที่ระบบต้อง Dispatch
  // มาจาก Master Worker Range
  //
  // ไม่ใช่จำนวน Worker ที่ใช้หารเงินจริง
  WorkerCount: number;

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

  response_snapshot:
  GateVehicleJobResponse | null;
}

/* -------------------------------------- Vendor LINE -------------------------------------- */

// Type LINE ปลายทางของ Vendor
export interface GateVendorLineTargetDto {
  line_user_id: string;

  target_type:
  | "owner"
  | "member";
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
