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
interface GateBoothCreateInput {
  boothCode: string;
  boothName: string;

  vendor_line_id?: string;
  reject_reason?: string;

  products: GateProductCreateInput[];
}

// Type ข้อมูล Business Ticket (market job) ก่อนบันทึกจาก Gate
// หนึ่ง Business Ticket อยู่ได้เพียงหนึ่งตลาด แต่มีหลาย Booth ได้
interface GateMarketCreateInput {
  ticketNo: string;
  ticket_created_at: Date;

  booth_count: number;

  gate_transaction_ref: string;

  // Type จำนวน Worker สำหรับ dispatch ของ Business Ticket นี้
  workers_required: number;

  marketCode: string;
  marketName: string;

  dropoff_point?: string;

  booths: GateBoothCreateInput[];
}

// Type input สำหรับสร้างหรือ append Business Ticket ใต้ VehicleJob
export interface GateVehicleJobCreateInput {
  ticketNumber: string;

  license_plate: string;
  license_plate_province: string;
  vehicle_type?: string;

  dispatch_now?: boolean;

  // เสมอมีสมาชิกเดียวใน array นี้ต่อหนึ่ง Gate request (หนึ่ง request = หนึ่ง Business Ticket)
  markets: GateMarketCreateInput[];

  // ใส่ค่านี้เมื่อ TicketNo + MarketCode ของ request นี้ตรงกับ Business Ticket ที่ยัง active อยู่แล้ว
  // ภายใต้ TicketNumber เดียวกัน — บอก repository ให้เพิ่มแผงเข้า MarketJob เดิม (id นี้) แทนการสร้างใหม่
  existingMarketJobId?: number;
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
  // TicketNumber = ระดับรถ, อาจถูกส่งมาหลายครั้งพร้อม TicketNo ใหม่ทุกครั้งที่มี Business Ticket ใหม่
  TicketNumber: string;
  // Type TicketNo ของ Business Ticket ใต้ TicketNumber
  TicketNo: string;
  TicketCreatedAt: string;

  BoothCount: number;

  MarketCode: string;

  // จุดลงสินค้าของตลาดนี้ — บังคับส่งมาทุกครั้งคู่กับ MarketCode ตลาดเดียวกันส่งค่าซ้ำกันได้ปกติ (ไม่มี
  // การเช็ค unique ใดๆ) เก็บลง MarketJob.dropoffPoint ตรงๆ ต่อ Ticket
  DropoffPoint: string;

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
  DropoffPoint: string | null;
}

// Type Product response ตอน Gate create ยังไม่รวมข้อมูลเงินจริง
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

// Type response หลักของ Gate create
export interface GateVehicleJobResponse {
  Result: GateVehicleJobResult;

  // เลขงานใหญ่ระดับรถ (VehicleJob)
  TicketNumber: string;

  Ticket: GateVehicleJobResponseTicket;

  Market: GateVehicleJobResponseMarket;

  Booths: GateVehicleJobResponseBooth[];

  // Type จำนวน Worker รวมสำหรับ dispatch ทั้ง TicketNumber
  WorkerCount: number;

  Qr: {
    DriverQrToken: string;
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


