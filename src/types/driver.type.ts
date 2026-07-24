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
  ticketNo: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  ticket_created_at: string;
  booth_count: number;
  workers_required: number;
  status: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
}

// Type ส่วนสินค้าใน ticket ที่ส่งให้ Driver Flow
interface DriverTicketProductResponse {
  productCode: string;
  productName: string;
  packageCode: string;
  packageName: string;
  quantity: string;
}

// Type ส่วน ticket/แผงที่ส่งให้ Driver Flow
interface DriverTicketResponse {
  boothCode: string;
  boothName: string | null;
  status: string;
  confirmation_status: string;
  products: DriverTicketProductResponse[];
}

// Type ส่วนตลาดที่ส่งให้ Driver Flow
interface DriverMarketJobResponse {
  marketCode: string;
  marketName: string;
  status: string;
  tickets: DriverTicketResponse[];
}

// Type ส่วนรายละเอียดงานรถพร้อมตลาดและแผงสำหรับ Driver Flow
export interface DriverVehicleJobDetailResponse {
  vehicle_job: DriverVehicleJobResponse;
  markets: DriverMarketJobResponse[];
}

export interface DriverJobReadyResponse {
  ticketNo: string;
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
