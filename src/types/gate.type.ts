interface GateProductCreateInput {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: number;
}

interface GateTicketCreateInput {
  boothCode: string;
  boothName?: string;
  vendor_line_id?: string;
  reject_reason?: string;
  products: GateProductCreateInput[];
}

interface GateMarketCreateInput {
  marketCode: string;
  marketName: string;
  dropoff_point?: string;
  tickets: GateTicketCreateInput[];
}

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

// Type object Ticket ที่ส่งกลับให้ Gate หลังสร้างหรือ replay
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

// Type object Market ที่ส่งกลับให้ Gate หลังสร้างหรือ replay
interface GateVehicleJobResponseMarket {
  MarketCode: string;
  MarketName: string;
}

// Type object Booth ที่ส่งกลับให้ Gate หลังสร้างหรือ replay
interface GateVehicleJobResponseBooth {
  BoothCode: string;
  BoothName: string | null;
}

// Type object Product ที่ส่งกลับให้ Gate หลังสร้างหรือ replay
interface GateVehicleJobResponseProduct {
  ProductCode: string;
  ProductName: string;
  PackageCode: string;
  PackageName: string;
  Quantity: number;
}

export type GateVehicleJobResult = "CREATED" | "REPLAYED";
export type GateVehicleJobResponseStatus = "unload_now" | "waiting_unload";

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

export interface GateRequestReplayRecord {
  gate_transaction_ref: string;
  payload_snapshot: unknown;
  response_snapshot: GateVehicleJobResponse | null;
}

export interface GateVendorLineTargetDto {
  line_user_id: string;
  target_type: "owner" | "member";
}

export interface GateTicketAppendStateDto {
  vehicle_job_id: number;
  booth_count: number;
  existing_booth_count: number;
  duplicate_booth: {
    boothCode: string;
    marketCode: string;
  } | null;
}
