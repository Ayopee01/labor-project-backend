// import Library
import type { Prisma } from "@prisma/client";
// import
import { withTransaction } from "../db/prisma";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import * as gateRepository from "../repositories/gate.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { publishNotification } from "./notifications.service";
// import Types
import type { GateVehicleJobBody, GateVehicleJobResponse, GateVehicleJobResult } from "../types/gate.type";
import type { VehicleJobDetailResponse } from "../types/worker.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { gateVehicleJobBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง response แบบย่อให้ Gate หลังสร้างหรือ replay งานรถ
function buildPublicGateVehicleJobResponse(
  detail: VehicleJobDetailResponse,
  message: string,
  result: GateVehicleJobResult
): GateVehicleJobResponse {
  return {
    result,
    message,
    vehicle_job: {
      vehicle_job_ref: detail.vehicle_job.vehicle_job_ref,
      gate_transaction_ref: detail.vehicle_job.gate_transaction_ref,
      license_plate: detail.vehicle_job.license_plate,
      status: detail.vehicle_job.status,
    },
    qr: {
      driver_qr_token: detail.vehicle_job.driver_qr_token,
      worker_qr_token: detail.vehicle_job.worker_qr_token,
    },
  };
}

// Function normalize JSON payload เพื่อเทียบ idempotency โดยไม่สนลำดับ key
function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, normalizeJson(entryValue)])
  );
}

// Function เทียบ payload เดิมกับ payload ใหม่ของ gate_transaction_ref
function arePayloadsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

// Function สร้าง replay response แบบย่อจาก snapshot เดิมที่อาจเคยเก็บ response เต็มไว้
function buildGateReplayResponse(
  response: GateVehicleJobResponse,
  gateTransactionRef: string
): GateVehicleJobResponse {
  return {
    result: "REPLAYED",
    message: "Gate request already processed. Returning cached response.",
    vehicle_job: {
      vehicle_job_ref: response.vehicle_job.vehicle_job_ref,
      gate_transaction_ref: gateTransactionRef,
      license_plate: response.vehicle_job.license_plate,
      status: response.vehicle_job.status,
    },
    qr: response.qr,
  };
}

// Function สร้าง response งานรถสำหรับ Gate พร้อม QR token
async function buildGateVehicleJobResponse(
  vehicleJobId: number,
  message: string,
  result: GateVehicleJobResult,
  connection?: Parameters<typeof workerApplicationRepository.getVehicleJobDetail>[1]
): Promise<GateVehicleJobResponse> {
  const detail = await workerApplicationRepository.getVehicleJobDetail(vehicleJobId, connection);

  if (!detail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return buildPublicGateVehicleJobResponse(detail, message, result);
}

// Function สร้างงานรถจาก Gate mock payload
export async function createVehicleJobFromGate(body: unknown): Promise<GateVehicleJobResponse> {
  const input = parseWithSchema<GateVehicleJobBody>(gateVehicleJobBodySchema, body);
  const existingGateRequest = await gateRepository.findGateRequestReplayByRef(
    input.gate_transaction_ref
  );

  if (existingGateRequest) {
    if (!arePayloadsEqual(existingGateRequest.payload_snapshot, input)) {
      console.warn("Gate request payload mismatch", {
        gate_transaction_ref: input.gate_transaction_ref,
        vehicle_job_ref: input.vehicle_job_ref,
      });

      throw new ApiError(
        409,
        "GATE_TRANSACTION_REF_PAYLOAD_MISMATCH",
        "gate_transaction_ref already exists with a different payload.",
        {
          duplicate_field: "gate_transaction_ref",
          gate_transaction_ref: input.gate_transaction_ref,
        }
      );
    }

    if (!existingGateRequest.response_snapshot) {
      throw new ApiError(
        409,
        "GATE_REQUEST_RESPONSE_NOT_READY",
        "Gate request already exists but its response snapshot is not ready.",
        {
          duplicate_field: "gate_transaction_ref",
          gate_transaction_ref: input.gate_transaction_ref,
        }
      );
    }

    console.info("Gate request replayed", {
      gate_transaction_ref: input.gate_transaction_ref,
      vehicle_job_ref: input.vehicle_job_ref,
    });

    return buildGateReplayResponse(
      existingGateRequest.response_snapshot,
      input.gate_transaction_ref
    );
  }

  const existingVehicleJob = await gateRepository.findVehicleJobByRef(
    input.vehicle_job_ref
  );

  if (existingVehicleJob) {
    console.warn("Gate vehicle job ref already exists", {
      gate_transaction_ref: input.gate_transaction_ref,
      vehicle_job_ref: input.vehicle_job_ref,
    });

    throw new ApiError(
      409,
      "VEHICLE_JOB_REF_ALREADY_EXISTS",
      "vehicle_job_ref already exists.",
      {
        duplicate_field: "vehicle_job_ref",
        vehicle_job_ref: input.vehicle_job_ref,
      }
    );
  }

  const response = await withTransaction(async (transaction) => {
    const vehicleJob = await gateRepository.createVehicleJobFromGate(
      input,
      input as unknown as Prisma.InputJsonValue,
      transaction
    );
    if (input.dispatch_now === true) {
      await dispatchReadyWorkers(transaction);
    }
    const response = await buildGateVehicleJobResponse(
      vehicleJob.id,
      input.dispatch_now === true
        ? "Vehicle job created and marked ready for dispatch."
        : "Vehicle job created successfully.",
      "CREATED",
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
      vehicle_job_ref: response.vehicle_job.vehicle_job_ref,
      gate_transaction_ref: response.vehicle_job.gate_transaction_ref,
      license_plate: response.vehicle_job.license_plate,
      status: response.vehicle_job.status,
      dispatch_now: input.dispatch_now === true,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return response;
}
