// Type ส่วน DTO ของ driver session ใน database
export interface DriverSessionDto {
  id: number;
  vehicle_job_id: number;
  session_token: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วนงานรถที่ส่งให้ Driver Flow
export interface DriverVehicleJobResponse {
  vehicle_job_ref: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  workers_required: number;
  status: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
}

// Type ส่วนสินค้าใน ticket ที่ส่งให้ Driver Flow
interface DriverTicketProductResponse {
  product_ref: string;
  product_type: string | null;
  name: string;
  quantity: string;
  unit: string;
}

// Type ส่วน ticket/แผงที่ส่งให้ Driver Flow
interface DriverTicketResponse {
  stall_job_ref: string;
  ticket_no: string | null;
  stall_no: string | null;
  vendor_name: string | null;
  status: string;
  confirmation_status: string;
  products: DriverTicketProductResponse[];
}

// Type ส่วนตลาดที่ส่งให้ Driver Flow
interface DriverMarketJobResponse {
  market_job_ref: string;
  market_name: string;
  status: string;
  tickets: DriverTicketResponse[];
}

// Type ส่วนรายละเอียดงานรถพร้อมตลาดและแผงสำหรับ Driver Flow
export interface DriverVehicleJobDetailResponse {
  vehicle_job: DriverVehicleJobResponse;
  markets: DriverMarketJobResponse[];
}

export interface DriverJobReadyResponse {
  vehicle_job_ref: string;
  license_plate: string;
  status: string;
  worker_qr_token: string;
}

// Type ส่วน response หลังเปิด driver session จาก QR
export interface DriverSessionResponse {
  driver_session_token: string;
  expires_in: number;
  expires_at: string;
  vehicle_job: DriverVehicleJobResponse;
}
