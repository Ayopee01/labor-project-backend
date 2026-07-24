// import
import { withTransaction } from "../db/prisma";
import { VEHICLE_JOB_STATUS } from "../constants/job-status";
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

// Function เธญเนเธฒเธ ticketNo เธเธฒเธ path param เนเธฅเธฐเนเธขเธ error เธ–เนเธฒเธเนเธฒเธงเนเธฒเธ
function parseReference(value: unknown): string {
  const reference = String(value ?? "").trim();

  if (!reference) {
    throw new ApiError(400, "INVALID_VEHICLE_JOB_REF", "Vehicle job ref is invalid.");
  }

  return reference;
}

// Function เธเธฑเธ”เธฃเธนเธเธเธฒเธเธฃเธ–เธชเธณเธซเธฃเธฑเธ Driver Flow เนเธ”เธขเนเธกเนเธชเนเธ id เธ เธฒเธขเนเธ
function formatDriverVehicleJob(vehicleJob: VehicleJobDto): DriverVehicleJobResponse {
  return {
    ticketNo: vehicleJob.ticketNo,
    gate_transaction_ref: vehicleJob.gate_transaction_ref,
    license_plate: vehicleJob.license_plate,
    vehicle_type: vehicleJob.vehicle_type,
    ticket_created_at: vehicleJob.ticket_created_at,
    booth_count: vehicleJob.booth_count,
    workers_required: vehicleJob.workers_required,
    status: vehicleJob.status,
    worker_qr_token: vehicleJob.worker_qr_token,
    created_at: vehicleJob.created_at,
    updated_at: vehicleJob.updated_at,
  };
}

// Function เธเธฑเธ”เธฃเธนเธเธเธฒเธเธฃเธ–เธเธฃเนเธญเธกเธ•เธฅเธฒเธ” เนเธเธ เนเธฅเธฐเธชเธดเธเธเนเธฒ เธชเธณเธซเธฃเธฑเธ Driver Flow
function formatDriverVehicleJobDetail(
  detail: VehicleJobDetailResponse
): DriverVehicleJobDetailResponse {
  return {
    vehicle_job: formatDriverVehicleJob(detail.vehicle_job),
    markets: detail.markets.map((market) => ({
      marketCode: market.marketCode,
      marketName: market.marketName,
      status: market.status,
      tickets: market.tickets.map((ticket) => ({
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

// Function เน€เธเธดเธ” driver session เธเธฒเธ QR token
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

// Function เธ”เธถเธเธเธฒเธเธเธฑเธเธเธธเธเธฑเธเธเธญเธ driver session
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

// Function เนเธซเน driver เธเธ”เธเธฃเนเธญเธกเธฅเธเน€เธเธทเนเธญเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเนเธฅเธฐเน€เธฃเธตเธขเธ worker เธเธฒเธ queue
export async function markDriverJobReady(
  idParam: unknown,
  session?: DriverSessionDto
): Promise<DriverJobReadyResponse> {
  if (!session) {
    throw new ApiError(401, "MISSING_DRIVER_SESSION", "Missing driver session.");
  }

  const ticketNo = parseReference(idParam);
  const requestedVehicleJob = await driverRepository.findVehicleJobByRef(ticketNo);

  if (!requestedVehicleJob) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  if (session.vehicle_job_id !== requestedVehicleJob.id) {
    throw new ApiError(403, "DRIVER_JOB_FORBIDDEN", "Driver session cannot access this job.");
  }

  const detail = await withTransaction(async (transaction) => {
    const vehicleJob = await driverRepository.findVehicleJobByRef(ticketNo, transaction);

    if (!vehicleJob) {
      throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
    }

    if (
      vehicleJob.status === VEHICLE_JOB_STATUS.WORKING ||
      vehicleJob.status === VEHICLE_JOB_STATUS.COMPLETED ||
      vehicleJob.status === VEHICLE_JOB_STATUS.CANCELLED
    ) {
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
    message: `Driver marked vehicle job ${detail.vehicle_job.ticketNo} ready.`,
    payload: {
      ticketNo: detail.vehicle_job.ticketNo,
      license_plate: detail.vehicle_job.license_plate,
      status: detail.vehicle_job.status,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return {
    ticketNo: detail.vehicle_job.ticketNo,
    license_plate: detail.vehicle_job.license_plate,
    status: detail.vehicle_job.status,
    worker_qr_token: detail.vehicle_job.worker_qr_token,
  };
}

