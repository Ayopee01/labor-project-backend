// Import Dependencies
import { VEHICLE_JOB_STATUS } from "../constants/job-status";
import { mapDriverSession, mapVehicleJob } from "./shared/mappers";
import { client, createRandomToken, requireDto } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { DriverSessionDto } from "../types/driver.type";
import type { VehicleJobDto } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา vehicle job ตาม driver QR token จาก DB
export async function findVehicleJobByDriverQrToken(
  qrToken: string,
  connection?: DbConnection,
): Promise<VehicleJobDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      driverQrToken: qrToken,
    },
  });

  return mapVehicleJob(vehicleJob);
}

// Function สร้าง driver session จาก DB
export async function createDriverSession(
  vehicleJobId: number,
  expiresAt: Date,
  connection?: DbConnection,
): Promise<DriverSessionDto> {
  const db = client(connection);
  const session = await db.driverSession.create({
    data: {
      vehicleJobId,
      sessionToken: createRandomToken("driver_session"),
      expiresAt,
    },
  });

  return requireDto(mapDriverSession(session), "driver session create");
}

// Function เพิกถอน driver session ที่ยัง active ทั้งหมดของ vehicle job นี้ (เรียกตอนงานจบ/ถูกยกเลิก
// เพื่อลดอายุของ token ที่ไม่จำเป็นต้องใช้งานต่อ)
export async function revokeDriverSessionsByVehicleJobId(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<void> {
  const db = client(connection);

  await db.driverSession.updateMany({
    where: {
      vehicleJobId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

// Function ค้นหา active driver session ตาม token จาก DB
export async function findActiveDriverSessionByToken(
  sessionToken: string,
  now = new Date(),
  connection?: DbConnection,
): Promise<DriverSessionDto | null> {
  const db = client(connection);
  const session = await db.driverSession.findFirst({
    where: {
      sessionToken,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
    },
  });

  return mapDriverSession(session);
}

// Function อัปเดตสถานะ vehicle job ready จาก DB
export async function markVehicleJobReady(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleJobDto> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.update({
    where: {
      id: vehicleJobId,
    },
    data: {
      status: VEHICLE_JOB_STATUS.WORKING,
      // Caller (markDriverJobReady) รับประกันแล้วว่าเรียกได้เฉพาะตอน VehicleJob.status === WAIT
      // เท่านั้น ซึ่งเป็นไปได้แค่ทางเดียวคือ dispatchNow เคยเป็น false มาก่อน (Gate ตั้งไว้ตอนสร้าง
      // หรือ Admin สั่ง Dispatch:false ทีหลัง) — Driver กด Ready จึงเทียบเท่า Dispatch:true เสมอ ต้อง
      // sync dispatchNow ให้ตรงสถานะจริง ไม่งั้น Operations board จะค้างแสดง wait_unload ทั้งที่ทีม
      // กำลังทำงานจริงแล้ว (resolveVehicleOperationStatus เช็ค !dispatchNow ก่อน wait_worker/ready_now)
      dispatchNow: true,
      marketJobs: {
        updateMany: {
          where: {
            status: {
              in: [VEHICLE_JOB_STATUS.WAIT, VEHICLE_JOB_STATUS.WORKING],
            },
          },
          data: {
            status: VEHICLE_JOB_STATUS.WORKING,
          },
        },
      },
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job ready");
}
