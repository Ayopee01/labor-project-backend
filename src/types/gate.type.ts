import type { VehicleJobDetailResponse } from "./worker.type";

// Type ส่วน input สินค้าที่ Gate ส่งมาในแต่ละตั๋ว/แผง
export interface GateProductCreateInput {
  product_type?: string;
  name: string;
  quantity: number;
  unit: string;
}

// Type ส่วน input ตั๋วระดับแผงที่ Gate ส่งมา
export interface GateTicketCreateInput {
  stall_job_ref: string;
  ticket_no?: string;
  stall_no?: string;
  vendor_name?: string;
  vendor_line_id?: string;
  products: GateProductCreateInput[];
}

// Type ส่วน input งานระดับตลาดที่ Gate ส่งมา
export interface GateMarketCreateInput {
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
  markets: GateMarketCreateInput[];
}

// Type ส่วน body ของ API Gate create vehicle job
export type GateVehicleJobBody = GateVehicleJobCreateInput;

// Type ส่วน response หลัง Gate สร้างหรือ replay งานรถ
export interface GateVehicleJobResponse extends VehicleJobDetailResponse {
  message: string;
  qr: {
    driver_qr_token: string;
    worker_qr_token: string;
  };
}
