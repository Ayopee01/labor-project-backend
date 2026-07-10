// import
import { withTransaction } from "../db/prisma";
import * as driverRepository from "../repositories/driver.repository";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { getRuntimeSettings } from "./admin-settings.service";
import { publishNotification } from "./notifications.service";
// import Types
import type { DriverSessionDto, DriverSessionResponse } from "../types/driver.type";
import type { VehicleJobDetailResponse } from "../types/worker.type";
// import Validation
import { parseId, parseWithSchema } from "../validation/parser";
import { driverQrSessionBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function เปิด driver session จาก QR token
export async function createDriverSessionFromQr(
  body: unknown
): Promise<DriverSessionResponse> {
  const input = parseWithSchema(driverQrSessionBodySchema, body);
  const vehicleJob = await driverRepository.findVehicleJobByDriverQrToken(input.qr_token);

  if (!vehicleJob) {
    throw new ApiError(404, "INVALID_DRIVER_QR", "Driver QR token is invalid.");
  }

  if (vehicleJob.status === "COMPLETED" || vehicleJob.status === "CANCELLED") {
    throw new ApiError(409, "VEHICLE_JOB_CLOSED", "Vehicle job is already closed.");
  }

  const settings = await getRuntimeSettings();
  const driverSessionTtlMs = settings.driver_session_ttl_hours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + driverSessionTtlMs);
  const session = await driverRepository.createDriverSession(vehicleJob.id, expiresAt);

  return {
    driver_session_token: session.session_token,
    expires_in: driverSessionTtlMs / 1000,
    expires_at: session.expires_at,
    vehicle_job: vehicleJob,
  };
}

// Function ดึงงานปัจจุบันของ driver session
export async function getDriverCurrentJob(
  session?: DriverSessionDto
): Promise<VehicleJobDetailResponse> {
  if (!session) {
    throw new ApiError(401, "MISSING_DRIVER_SESSION", "Missing driver session.");
  }

  const detail = await driverRepository.getVehicleJobDetail(session.vehicle_job_id);

  if (!detail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return detail;
}

// Function ให้ driver กดพร้อมลงเพื่อเปลี่ยนสถานะและเรียก worker จาก queue
export async function markDriverJobReady(
  idParam: unknown,
  session?: DriverSessionDto
): Promise<VehicleJobDetailResponse> {
  if (!session) {
    throw new ApiError(401, "MISSING_DRIVER_SESSION", "Missing driver session.");
  }

  const vehicleJobId = parseId(idParam);

  if (session.vehicle_job_id !== vehicleJobId) {
    throw new ApiError(403, "DRIVER_JOB_FORBIDDEN", "Driver session cannot access this job.");
  }

  const detail = await withTransaction(async (transaction) => {
    const vehicleJob = await driverRepository.findVehicleJobById(vehicleJobId, transaction);

    if (!vehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    if (vehicleJob.status === "IN_PROGRESS" || vehicleJob.status === "COMPLETED" || vehicleJob.status === "CANCELLED") {
      throw new ApiError(409, "VEHICLE_JOB_NOT_READY", "Vehicle job cannot be marked ready.");
    }

    await driverRepository.markVehicleJobReady(vehicleJobId, transaction);
    await dispatchReadyWorkers(transaction);

    const detail = await driverRepository.getVehicleJobDetail(vehicleJobId, transaction);

    if (!detail) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    return detail;
  });

  publishNotification({
    type: "DRIVER_JOB_READY",
    title: "Driver job ready",
    message: `Driver marked vehicle job ${detail.vehicle_job.vehicle_job_ref} ready.`,
    payload: {
      vehicle_job_id: detail.vehicle_job.id,
      vehicle_job_ref: detail.vehicle_job.vehicle_job_ref,
      license_plate: detail.vehicle_job.license_plate,
      status: detail.vehicle_job.status,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return detail;
}
