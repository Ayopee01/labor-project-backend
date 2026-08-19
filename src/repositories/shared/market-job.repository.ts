// Import Dependencies
import { mapMarketJob } from "./mappers";
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { MarketJobDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา Business Ticket (market job) ตาม TicketNumber (vehicleJobId) + TicketNo จาก DB
// ใช้ตรวจ conflict ก่อนสร้าง Business Ticket ใหม่ และใช้หา Business Ticket ที่ต้องการแก้ Roster
export async function findMarketJobByVehicleAndTicketNo(
  vehicleJobId: number,
  ticketNo: string,
  connection?: DbConnection
): Promise<MarketJobDto | null> {
  const db = client(connection);
  const marketJob = await db.marketJob.findUnique({
    where: {
      vehicleJobId_ticketNo: {
        vehicleJobId,
        ticketNo,
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
