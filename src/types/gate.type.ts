// Type ส่วน input สินค้าที่ Gate ส่งมาในแต่ละตั๋ว/แผง
interface GateProductCreateInput {
  product_ref: string;
  product_type?: string;
  name: string;
  quantity: number;
  unit: string;
}

// Type ส่วน input ตั๋วระดับแผงที่ Gate ส่งมา
interface GateTicketCreateInput {
  stall_job_ref: string;
  ticket_no?: string;
  stall_no?: string;
  vendor_name?: string;
  vendor_line_id?: string;
  products: GateProductCreateInput[];
}

// Type ส่วน input งานระดับตลาดที่ Gate ส่งมา
interface GateMarketCreateInput {
  market_job_ref: string;
  market_name: string;
  tickets: GateTicketCreateInput[];
}

// Type ส่วน input งานระดับรถที่ Gate ส่งมา
export interface GateVehicleJobCreateInput {
  gate_transaction_ref: string;
  vehicle_job_ref: string;
  license_plate: string;
  vehicle_type?: string;
  workers_required: number;
  dispatch_now?: boolean;
  markets: GateMarketCreateInput[];
}

// Type ส่วน body ของ API Gate create vehicle job
export type GateVehicleJobBody = GateVehicleJobCreateInput;

// Type ส่วน vehicle_job แบบย่อใน response ของ Gate
interface GateVehicleJobResponseVehicle {
  vehicle_job_ref: string;
  gate_transaction_ref: string;
  license_plate: string;
  status: string;
}

// Type ส่วนผลลัพธ์ของ Gate create/replay
export type GateVehicleJobResult = "CREATED" | "REPLAYED";

// Type ส่วน response แบบย่อหลัง Gate สร้างหรือ replay งานรถ
export interface GateVehicleJobResponse {
  result: GateVehicleJobResult;
  message: string;
  vehicle_job: GateVehicleJobResponseVehicle;
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
