// import
import { withTransaction } from "../db/prisma";
import * as driverRepository from "../repositories/driver.repository";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { getRuntimeSettings } from "./admin-settings.service";
import { publishNotification } from "./notifications.service";
// import Types
import type { DriverJobReadyResponse, DriverSessionDto, DriverSessionResponse, DriverVehicleJobDetailResponse, DriverVehicleJobResponse } from "../types/driver.type";
import type { VehicleJobDetailResponse, VehicleJobDto } from "../types/worker.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { driverQrSessionBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function อ่าน vehicle_job_ref จาก path param และโยน error ถ้าค่าว่าง
function parseReference(value: unknown): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(400, "INVALID_VEHICLE_JOB_REF", "Vehicle job ref is invalid.");
  }

  return reference;
}

// Function จัดรูปงานรถสำหรับ Driver Flow โดยไม่ส่ง id ภายใน
function formatDriverVehicleJob(vehicleJob: VehicleJobDto): DriverVehicleJobResponse {
  return {
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    gate_transaction_ref: vehicleJob.gate_transaction_ref,
    license_plate: vehicleJob.license_plate,
    vehicle_type: vehicleJob.vehicle_type,
    workers_required: vehicleJob.workers_required,
    status: vehicleJob.status,
    worker_qr_token: vehicleJob.worker_qr_token,
    created_at: vehicleJob.created_at,
    updated_at: vehicleJob.updated_at,
  };
}

// Function จัดรูปงานรถพร้อมตลาด แผง และสินค้า สำหรับ Driver Flow
function formatDriverVehicleJobDetail(
  detail: VehicleJobDetailResponse
): DriverVehicleJobDetailResponse {
  return {
    vehicle_job: formatDriverVehicleJob(detail.vehicle_job),
    markets: detail.markets.map((market) => ({
      market_job_ref: market.market_job_ref,
      market_name: market.market_name,
      status: market.status,
      tickets: market.tickets.map((ticket) => ({
        stall_job_ref: ticket.stall_job_ref,
        ticket_no: ticket.ticket_no,
        stall_no: ticket.stall_no,
        vendor_name: ticket.vendor_name,
        status: ticket.status,
        confirmation_status: ticket.confirmation_status,
        products: ticket.products.map((product) => ({
          product_ref: product.product_ref,
          product_type: product.product_type,
          name: product.name,
          quantity: product.quantity,
          unit: product.unit,
        })),
      })),
    })),
  };
}

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
    vehicle_job: formatDriverVehicleJob(vehicleJob),
  };
}

// Function ดึงงานปัจจุบันของ driver session
export async function getDriverCurrentJob(
  session?: DriverSessionDto
): Promise<DriverVehicleJobDetailResponse> {
  if (!session) {
    throw new ApiError(401, "MISSING_DRIVER_SESSION", "Missing driver session.");
  }

  const detail = await driverRepository.getVehicleJobDetail(session.vehicle_job_id);

  if (!detail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return formatDriverVehicleJobDetail(detail);
}

// Function ให้ driver กดพร้อมลงเพื่อเปลี่ยนสถานะและเรียก worker จาก queue
export async function markDriverJobReady(
  idParam: unknown,
  session?: DriverSessionDto
): Promise<DriverJobReadyResponse> {
  if (!session) {
    throw new ApiError(401, "MISSING_DRIVER_SESSION", "Missing driver session.");
  }

  const vehicleJobRef = parseReference(idParam);
  const requestedVehicleJob = await driverRepository.findVehicleJobByRef(vehicleJobRef);

  if (!requestedVehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  if (session.vehicle_job_id !== requestedVehicleJob.id) {
    throw new ApiError(403, "DRIVER_JOB_FORBIDDEN", "Driver session cannot access this job.");
  }

  const detail = await withTransaction(async (transaction) => {
    const vehicleJob = await driverRepository.findVehicleJobByRef(vehicleJobRef, transaction);

    if (!vehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    if (vehicleJob.status === "IN_PROGRESS" || vehicleJob.status === "COMPLETED" || vehicleJob.status === "CANCELLED") {
      throw new ApiError(409, "VEHICLE_JOB_NOT_READY", "Vehicle job cannot be marked ready.");
    }

    await driverRepository.markVehicleJobReady(vehicleJob.id, transaction);
    await dispatchReadyWorkers(transaction);

    const detail = await driverRepository.getVehicleJobDetail(vehicleJob.id, transaction);

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
      vehicle_job_ref: detail.vehicle_job.vehicle_job_ref,
      license_plate: detail.vehicle_job.license_plate,
      status: detail.vehicle_job.status,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    vehicle_job_ref: detail.vehicle_job.vehicle_job_ref,
    license_plate: detail.vehicle_job.license_plate,
    status: detail.vehicle_job.status,
    worker_qr_token: detail.vehicle_job.worker_qr_token,
  };
}
