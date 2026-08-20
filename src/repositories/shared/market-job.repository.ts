// Import Dependencies
import { VEHICLE_JOB_STATUS } from "../../constants/job-status";
import { mapMarketJob } from "./mappers";
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { MarketJobDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา Business Ticket (market job) ที่ยัง active (ไม่ใช่ CANCELLED) ตาม TicketNumber
// (vehicleJobId) + TicketNo จาก DB — ใช้ตรวจ conflict ก่อนสร้าง Business Ticket ใหม่, หา Business
// Ticket ที่ต้องการแก้ Roster, และหา Ticket จาก QR ตอน Worker check-in
//
// ตั้งใจไม่รวมแถวที่ถูก Admin ยกเลิกไปแล้ว (status = CANCELLED) เพราะ ticketNo เดิมสามารถถูกใช้ซ้ำ
// ได้หลังยกเลิก (unique constraint จริงที่ DB เป็น partial unique เฉพาะแถว active เท่านั้น ดู
// migration 20260820090000) แถวที่ถูกยกเลิกไปแล้วไม่ควรถูกนับเป็น "Ticket นี้" อีกต่อไปในทุกจุดที่ใช้
// ฟังก์ชันนี้ — ต้องหาแถว active ตัวเดียวที่ถูกต้องเท่านั้น
export async function findMarketJobByVehicleAndTicketNo(
  vehicleJobId: number,
  ticketNo: string,
  connection?: DbConnection
): Promise<MarketJobDto | null> {
  const db = client(connection);
  const marketJob = await db.marketJob.findFirst({
    where: {
      vehicleJobId,
      ticketNo,
      status: {
        not: VEHICLE_JOB_STATUS.CANCELLED,
      },
    },
  });

  return mapMarketJob(marketJob);
}

// Function ค้นหา Business Ticket (market job) ตาม id — ใช้หา marketCode ตอน Worker
// เปลี่ยน PackageCode ระหว่างส่งยอด (ต้องรู้ตลาดเพื่อหา Rate ใหม่ให้ถูกต้อง)
export async function findMarketJobById(
  id: number,
  connection?: DbConnection
): Promise<MarketJobDto | null> {
  const db = client(connection);
  const marketJob = await db.marketJob.findUnique({
    where: {
      id,
    },
  });

  return mapMarketJob(marketJob);
}
