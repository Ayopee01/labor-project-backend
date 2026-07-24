// Type ส่วน input สินค้าที่ Gate ส่งมาในแต่ละตั๋ว/แผง
interface GateProductCreateInput {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: number;
}

// Type ส่วน input ตั๋วระดับแผงที่ Gate ส่งมา
interface GateTicketCreateInput {
  boothCode: string;
  boothName?: string;
  vendor_line_id?: string;
  reject_reason?: string;
  products: GateProductCreateInput[];
}

// Type ส่วน input งานระดับตลาดที่ Gate ส่งมา
interface GateMarketCreateInput {
  marketCode: string;
  marketName: string;
  dropoff_point?: string;
  tickets: GateTicketCreateInput[];
}

// Type ส่วน input งานระดับรถที่ Gate ส่งมา
export interface GateVehicleJobCreateInput {
  gate_transaction_ref: string;
  ticketNo: string;
  ticket_created_at: Date;
  booth_count: number;
  license_plate: string;
  vehicle_type?: string;
  dispatch_now?: boolean;
  markets: GateMarketCreateInput[];
}

// Type ส่วน body ใหม่จาก Gate: 1 request ต่อ 1 ใบ/1 แผง/1 รายการสินค้า
export interface GateVehicleJobBody {
  TicketNo: string;
  TicketCreatedAt: string;
  BoothCount: number;
  MarketCode: string;
  MarketName: string;
  BoothCode: string;
  BoothName: string;
  LicensePlate: string;
  VehicleTypeCode: string;
  VehicleTypeName: string;
  ProductCode: string;
  ProductName: string;
  PackageCode: string;
  PackageName: string;
  Quantity: number;
  Dispatch: boolean;
}

interface GateVehicleJobResponseTicket {
  TicketNo: string;
  TicketCreatedAt: string;
  BoothCount: number;
  LicensePlate: string;
  VehicleTypeCode: string | null;
  VehicleTypeName: string | null;
  WorkersRequired: number;
  Status: GateVehicleJobResponseStatus;
}

interface GateVehicleJobResponseMarket {
  MarketCode: string;
  MarketName: string;
}

interface GateVehicleJobResponseBooth {
  BoothCode: string;
  BoothName: string | null;
}

interface GateVehicleJobResponseProduct {
  ProductCode: string;
  ProductName: string;
  PackageCode: string;
  PackageName: string;
  Quantity: number;
}

// Type ส่วนผลลัพธ์ของ Gate create/replay
export type GateVehicleJobResult = "CREATED" | "REPLAYED";
export type GateVehicleJobResponseStatus = "unload_now" | "waiting_unload";

// Type ส่วน response แบบย่อหลัง Gate สร้างหรือ replay งานรถ
export interface GateVehicleJobResponse {
  Result: GateVehicleJobResult;
  Ticket: GateVehicleJobResponseTicket;
  Market: GateVehicleJobResponseMarket;
  Booth: GateVehicleJobResponseBooth;
  Product: GateVehicleJobResponseProduct;
  Qr: {
    DriverQrToken: string;
    WorkerQrToken: string;
  };
}

// Type ส่วน record สำหรับตรวจ replay/idempotency ของ Gate request
export interface GateRequestReplayRecord {
  gate_transaction_ref: string;
  payload_snapshot: unknown;
  response_snapshot: GateVehicleJobResponse | null;
}
