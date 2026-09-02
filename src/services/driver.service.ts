// Import Dependencies
import { withTransaction } from "../db/prisma";
import { VEHICLE_JOB_STATUS } from "../constants/job-status";
import * as driverRepository from "../repositories/driver.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { getRuntimeSettings } from "./shared/runtime-settings.service";
import { publishNotification } from "./notifications.service";
// Import Types
import type { DriverJobReadyResponse, DriverSessionDto, DriverSessionResponse, DriverVehicleJobDetailResponse, DriverVehicleJobResponse } from "../types/driver.type";
import type { VehicleJobDetailResponse, VehicleJobDto } from "../types/worker.type";
// Import Validation
import { parseWithSchema } from "../validation/parser";
import { driverQrSessionBodySchema } from "../validation/schemas";
// Import Utils
import ApiError from "../utils/api-error";
import { logger } from "../utils/logger";

/* -------------------------------------- Functions -------------------------------------- */

// Function อ่านค่า reference ใน service flow
function parseReference(value: unknown): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(
      400,
      "INVALID_VEHICLE_JOB_REF",
      "Vehicle job ref is invalid.",
    );
  }

  return reference;
}

// Function จัดรูปแบบ driver vehicle job ใน service flow
function formatDriverVehicleJob(
  vehicleJob: VehicleJobDto,
): DriverVehicleJobResponse {
  return {
    ticket_number: vehicleJob.ticket_number,
    license_plate: vehicleJob.license_plate,
    license_plate_province: vehicleJob.license_plate_province,
    vehicle_type: vehicleJob.vehicle_type,
    workers_required: vehicleJob.workers_required,
    status: vehicleJob.status,
    created_at: vehicleJob.created_at,
    updated_at: vehicleJob.updated_at,
  };
}

// Function จัดรูปแบบ driver vehicle job detail ใน service flow
function formatDriverVehicleJobDetail(
  detail: VehicleJobDetailResponse,
): DriverVehicleJobDetailResponse {
  return {
    vehicle_job: formatDriverVehicleJob(detail.vehicle_job),
    markets: detail.markets.map((market) => ({
      ticket_no: market.ticket_no,
      boothCount: market.booth_count,
      marketCode: market.marketCode,
      marketName: market.marketName,
      status: market.status,
      booths: market.booths.map((ticket) => ({
        boothCode: ticket.boothCode,
        boothName: ticket.boothName,
        status: ticket.status,
        confirmation_status: ticket.confirmation_status,
        products: ticket.products.map((product) => ({
          productCode: product.productCode,
          productName: product.productName,
          packageCode: product.packageCode,
          packageName: product.packageName,
          quantity: product.quantity,
        })),
      })),
    })),
  };
}

// Function สร้าง driver session จาก QR ใน service flow
export async function createDriverSessionFromQr(
  body: unknown,
): Promise<DriverSessionResponse> {
  const input = parseWithSchema(driverQrSessionBodySchema, body);
  const vehicleJob = await driverRepository.findVehicleJobByDriverQrToken(
    input.qr_token,
  );

  if (!vehicleJob) {
    throw new ApiError(404, "INVALID_DRIVER_QR", "Driver QR token is invalid.");
  }

  if (
    vehicleJob.status === VEHICLE_JOB_STATUS.COMPLETED ||
    vehicleJob.status === VEHICLE_JOB_STATUS.CANCELLED
  ) {
    throw new ApiError(
      409,
      "VEHICLE_JOB_CLOSED",
      "Vehicle job is already closed.",
    );
  }

  const settings = await getRuntimeSettings();
  const driverSessionTtlMs = settings.driver_session_ttl_hours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + driverSessionTtlMs);
  const session = await driverRepository.createDriverSession(
    vehicleJob.id,
    expiresAt,
  );

  return {
    driver_session_token: session.session_token,
    expires_in: driverSessionTtlMs / 1000,
    expires_at: session.expires_at,
    vehicle_job: formatDriverVehicleJob(vehicleJob),
  };
}

// Function ดึง driver current job ใน service flow
export async function getDriverCurrentJob(
  session?: DriverSessionDto,
): Promise<DriverVehicleJobDetailResponse> {
  if (!session) {
    throw new ApiError(
      401,
      "MISSING_DRIVER_SESSION",
      "Missing driver session.",
    );
  }

  const detail = await vehicleJobRepository.getVehicleJobDetail(
    session.vehicle_job_id,
  );

  if (!detail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return formatDriverVehicleJobDetail(detail);
}

// Function อัปเดตสถานะ driver job ready ใน service flow
export async function markDriverJobReady(
  idParam: unknown,
  session?: DriverSessionDto,
): Promise<DriverJobReadyResponse> {
  if (!session) {
    throw new ApiError(
      401,
      "MISSING_DRIVER_SESSION",
      "Missing driver session.",
    );
  }

  const ticketNumber = parseReference(idParam);
  const requestedVehicleJob =
    await vehicleJobRepository.findVehicleJobByRef(ticketNumber);

  if (!requestedVehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  if (session.vehicle_job_id !== requestedVehicleJob.id) {
    throw new ApiError(
      403,
      "DRIVER_JOB_FORBIDDEN",
      "Driver session cannot access this job.",
    );
  }

  const vehicleJobId = await withTransaction(async (transaction) => {
    const vehicleJob = await vehicleJobRepository.findVehicleJobByRef(
      ticketNumber,
      transaction,
    );

    if (!vehicleJob) {
      throw new ApiError(
        404,
        "VEHICLE_JOB_NOT_FOUND",
        "Vehicle job not found.",
      );
    }

    if (vehicleJob.status !== VEHICLE_JOB_STATUS.WAIT) {
      // ยอมให้ mark ready ได้เฉพาะตอน WAIT เท่านั้น (ครอบคลุม WORKING/COMPLETED/CANCELLED เดิม
      // และ RELEASED ด้วย) กันงานที่ release-workers ปล่อยทีมกลับคิวไปแล้วถูกดึงกลับมา WORKING และ
      // เรียก dispatch ซ้ำผ่านทางนี้
      throw new ApiError(
        409,
        "VEHICLE_JOB_NOT_READY",
        "Vehicle job cannot be marked ready.",
      );
    }

    await driverRepository.markVehicleJobReady(vehicleJob.id, transaction);

    return vehicleJob.id;
  });

  // dispatchReadyWorkers เรียกแยกหลัง transaction ข้างบน commit แล้วเท่านั้น (ไม่ใช้ transaction เดิม
  // ต่อ) เพราะ dispatch จริงเขียนทั้ง DB (ในทรานแซกชันของตัวเอง) และ Redis/BullMQ ให้ worker ที่ถูกจ่าย
  // งาน — ถ้ายังอยู่ใน transaction เดิมแล้ว getVehicleJobDetail ด้านล่าง throw (เช่น race กับ Admin
  // cancel) transaction จะ rollback ฝั่ง DB ของ worker ที่เพิ่งถูก dispatch แต่ Redis/BullMQ ของเขา
  // ไม่ rollback ตาม ทำให้ติดค้างสถานะ ASSIGNED โดยไม่มี assignment จริง
  try {
    await dispatchReadyWorkers(undefined, {
      vehicle_job_ids: [vehicleJobId],
    });
  } catch (error) {
    logger.error("Dispatch after driver marked job ready failed.", {
      vehicleJobId,
      error,
    });
  }

  const detail = await vehicleJobRepository.getVehicleJobDetail(vehicleJobId);

  if (!detail) {
    throw new ApiError(
      404,
      "VEHICLE_JOB_NOT_FOUND",
      "Vehicle job not found.",
    );
  }

  publishNotification({
    type: "DRIVER_JOB_READY",
    title: "Driver job ready",
    message: `Driver marked vehicle job ${detail.vehicle_job.ticket_number} ready.`,
    payload: {
      ticketNumber: detail.vehicle_job.ticket_number,
      license_plate: detail.vehicle_job.license_plate,
      license_plate_province: detail.vehicle_job.license_plate_province,
      status: detail.vehicle_job.status,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    ticket_number: detail.vehicle_job.ticket_number,
    license_plate: detail.vehicle_job.license_plate,
    license_plate_province: detail.vehicle_job.license_plate_province,
    status: detail.vehicle_job.status,
  };
}
