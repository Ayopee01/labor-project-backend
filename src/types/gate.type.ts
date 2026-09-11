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
  rateMarketCode: string;
  rateSource:
  | "MARKET_RATE"
  | "CENTRAL_RATE";

  weightRangeName: string;
  weightMinSnapshot: string;
  weightMaxSnapshot: string;
  stallRateSnapshot: string;
  laborRateSnapshot: string;
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
interface GateMarketCreateInput {
  ticketNo: string;
  ticket_created_at: Date;
  booth_count: number;
  gate_transaction_ref: string;
  workers_required: number;
  marketCode: string;
  marketName: string;
  dropoff_point: string;
  booths: GateBoothCreateInput[];
}

// Type input สำหรับสร้างหรือ append Business Ticket ใต้ VehicleJob — ทุก field ที่นี่มาจาก
export interface GateVehicleJobCreateInput {
  ticketNumber: string;

  license_plate: string;
  license_plate_province: string;
  vehicle_type: string;
  dispatch_now: boolean;
  markets: GateMarketCreateInput[];
  existingMarketJobId?: number;
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
  TicketNumber: string;
  TicketNo: string;
  TicketCreatedAt: string;
  BoothCount: number;
  MarketCode: string;
  DropoffPoint: string;
  LicensePlate: string;
  LicensePlateProvince: string;
  VehicleTypeCode: string;
  VehicleTypeName: string;
  Booths: GateVehicleJobBoothBody[];
  Dispatch: boolean;
  IdempotencyKey?: string;
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
  Quantity: number;
  WorkerCount: number;
}

// Type ข้อมูล Booth ที่คืนให้ Gate
interface GateVehicleJobResponseBooth {
  BoothCode: string;
  BoothName: string | null;

  Products: GateVehicleJobResponseProduct[];
}

// Type response หลักของ Gate create
export interface GateVehicleJobResponse {
  Result: GateVehicleJobResult;
  TicketNumber: string;
  Ticket: GateVehicleJobResponseTicket;
  Market: GateVehicleJobResponseMarket;
  Booths: GateVehicleJobResponseBooth[];
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


