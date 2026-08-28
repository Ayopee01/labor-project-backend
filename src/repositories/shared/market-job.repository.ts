// Import Dependencies
import { VEHICLE_JOB_STATUS } from "../../constants/job-status";
import { mapMarketJob } from "./mappers";
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { MarketJobDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา Business Ticket ที่ยัง active ตาม VehicleJob และ TicketNo
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

// Function ดึง TicketNo ที่ยัง active ทั้งหมดของ VehicleJob
export async function listActiveTicketNosByVehicleJobId(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<string[]> {
  const db = client(connection);
  const marketJobs = await db.marketJob.findMany({
    where: {
      vehicleJobId,
      status: {
        not: VEHICLE_JOB_STATUS.CANCELLED,
      },
    },
    orderBy: {
      id: "asc",
    },
    select: {
      ticketNo: true,
    },
  });

  return marketJobs.map((marketJob) => marketJob.ticketNo);
}
