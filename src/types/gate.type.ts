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
  license_plate: string;
  vehicle_type?: string;
  dispatch_now?: boolean;
  markets: GateMarketCreateInput[];
}

// Type ส่วน body ใหม่จาก Gate: 1 request ต่อ 1 ใบ/1 แผง/1 รายการสินค้า
export interface GateVehicleJobBody {
  ticketNo: string;
  marketCode: string;
  marketName: string;
  boothCode: string;
  boothName: string;
  licensePlate: string;
  vehicleTypeCode?: string;
  vehicleTypeName: string;
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: number;
  dispatch_now?: boolean;
}

interface GateVehicleJobResponseTicket {
  ticketNo: string;
  licensePlate: string;
  vehicleTypeCode: string | null;
  vehicleTypeName: string | null;
  workers_required: number;
  status: string;
}

interface GateVehicleJobResponseMarket {
  marketCode: string;
  marketName: string;
}

interface GateVehicleJobResponseBooth {
  boothCode: string;
  boothName: string | null;
}

interface GateVehicleJobResponseProduct {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: number;
}

// Type ส่วนผลลัพธ์ของ Gate create/replay
export type GateVehicleJobResult = "CREATED" | "REPLAYED";

// Type ส่วน response แบบย่อหลัง Gate สร้างหรือ replay งานรถ
export interface GateVehicleJobResponse {
  result: GateVehicleJobResult;
  ticket: GateVehicleJobResponseTicket;
  market: GateVehicleJobResponseMarket;
  booth: GateVehicleJobResponseBooth;
  product: GateVehicleJobResponseProduct;
  qr: {
    driver_qr_token: string;
    worker_qr_token: string;
  };
}

// Type ส่วน record สำหรับตรวจ replay/idempotency ของ Gate request
export interface GateRequestReplayRecord {
  gate_transaction_ref: string;
  payload_snapshot: unknown;
  response_snapshot: GateVehicleJobResponse | null;
}
