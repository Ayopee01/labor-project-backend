// Import Dependencies
import { mapMarketJob } from "./mappers";
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { MarketJobDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา Business Ticket (market job) จาก QR token ที่ worker สแกน
export async function findMarketJobByWorkerQrToken(
  workerQrToken: string,
  connection?: DbConnection
): Promise<MarketJobDto | null> {
  const db = client(connection);
  const marketJob = await db.marketJob.findUnique({
    where: {
      workerQrToken,
    },
  });

  return mapMarketJob(marketJob);
}

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
