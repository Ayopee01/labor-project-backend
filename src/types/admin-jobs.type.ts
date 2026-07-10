import type { VehicleJobDto } from "./worker.type";

// Type ส่วน filter สำหรับ Admin query รายการงานรถ
export interface VehicleJobListFilters {
  search?: string;
  status?: string;
  startAt?: Date;
  endAt?: Date;
  page?: number;
  limit?: number;
}

// Type ส่วน result รายการงานรถสำหรับ Admin
export interface VehicleJobListResult {
  data: VehicleJobDto[];
  total?: number;
}
