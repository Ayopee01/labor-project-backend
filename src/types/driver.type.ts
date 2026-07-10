import type { VehicleJobDto } from "./worker.type";

// Type ส่วน DTO ของ table driver_sessions
export interface DriverSessionDto {
  id: number;
  vehicle_job_id: number;
  session_token: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

// Type ส่วน response หลัง Driver เปิด session จาก QR
export interface DriverSessionResponse {
  driver_session_token: string;
  expires_in: number;
  expires_at: string;
  vehicle_job: VehicleJobDto;
}
