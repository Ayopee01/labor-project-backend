// import Library
import type { Prisma } from "@prisma/client";
// import
import { withTransaction } from "../db/prisma";
import * as gateRepository from "../repositories/gate.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { publishNotification } from "./notifications.service";
// import Types
import type { GateVehicleJobBody, GateVehicleJobResponse } from "../types/gate.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { gateVehicleJobBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง response งานรถสำหรับ Gate พร้อม QR token
async function buildGateVehicleJobResponse(
  vehicleJobId: number,
  message: string,
  connection?: Parameters<typeof workerApplicationRepository.getVehicleJobDetail>[1]
): Promise<GateVehicleJobResponse> {
  const detail = await workerApplicationRepository.getVehicleJobDetail(vehicleJobId, connection);

  if (!detail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return {
    message,
    ...detail,
    qr: {
      driver_qr_token: detail.vehicle_job.driver_qr_token,
      worker_qr_token: detail.vehicle_job.worker_qr_token,
    },
  };
}

// Function สร้างงานรถจาก Gate mock payload
export async function createVehicleJobFromGate(body: unknown): Promise<GateVehicleJobResponse> {
  const input = parseWithSchema<GateVehicleJobBody>(gateVehicleJobBodySchema, body);
  const existingGateResponse = await gateRepository.findGateRequestResponseByRef(
    input.gate_transaction_ref
  );

  if (existingGateResponse) {
    return existingGateResponse;
  }

  const existingVehicleJob = await gateRepository.findVehicleJobByRef(
    input.vehicle_job_ref
  );

  if (existingVehicleJob) {
    return buildGateVehicleJobResponse(
      existingVehicleJob.id,
      "Vehicle job already exists."
    );
  }

  const response = await withTransaction(async (transaction) => {
    const vehicleJob = await gateRepository.createVehicleJobFromGate(
      input,
      input as unknown as Prisma.InputJsonValue,
      transaction
    );
    const response = await buildGateVehicleJobResponse(
      vehicleJob.id,
      "Vehicle job created successfully.",
      transaction
    );

    await gateRepository.updateGateRequestResponse(
      input.gate_transaction_ref,
      response as unknown as Prisma.InputJsonValue,
      transaction
    );

    return response;
  });

  publishNotification({
    type: "VEHICLE_JOB_CREATED",
    title: "Vehicle job created",
    message: `Vehicle job ${response.vehicle_job.vehicle_job_ref} was created from Gate.`,
    payload: {
      vehicle_job_id: response.vehicle_job.id,
      vehicle_job_ref: response.vehicle_job.vehicle_job_ref,
      gate_transaction_ref: response.vehicle_job.gate_transaction_ref,
      license_plate: response.vehicle_job.license_plate,
      status: response.vehicle_job.status,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return response;
}
