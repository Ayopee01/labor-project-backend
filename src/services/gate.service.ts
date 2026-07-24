// import Library
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
// import
import { withTransaction } from "../db/prisma";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import * as gateRepository from "../repositories/gate.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { publishNotification } from "./notifications.service";
// import Types
import type { GateVehicleJobBody, GateVehicleJobResponse, GateVehicleJobResult } from "../types/gate.type";
import type { GateVehicleJobCreateInput } from "../types/gate.type";
import type { VehicleJobDetailResponse } from "../types/worker.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { gateVehicleJobBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

function findGateResponseProduct(
  detail: VehicleJobDetailResponse,
  input: GateVehicleJobBody
) {
  const market = detail.markets.find(
    (candidate) => candidate.marketCode === input.marketCode
  );

  if (!market) {
    throw new ApiError(500, "GATE_RESPONSE_MARKET_NOT_FOUND", "Gate market response was not found.");
  }

  const booth = market.tickets.find(
    (candidate) => candidate.boothCode === input.boothCode
  );

  if (!booth) {
    throw new ApiError(500, "GATE_RESPONSE_BOOTH_NOT_FOUND", "Gate booth response was not found.");
  }

  const product = booth.products.find(
    (candidate) => candidate.productCode === input.productCode
  );

  if (!product) {
    throw new ApiError(500, "GATE_RESPONSE_PRODUCT_NOT_FOUND", "Gate product response was not found.");
  }

  return {
    market,
    booth,
    product,
  };
}

function isGateVehicleJobBody(value: unknown): value is GateVehicleJobBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<Record<keyof GateVehicleJobBody, unknown>>;
  return (
    typeof record.ticketNo === "string" &&
    typeof record.marketCode === "string" &&
    typeof record.marketName === "string" &&
    typeof record.boothCode === "string" &&
    typeof record.boothName === "string" &&
    typeof record.licensePlate === "string" &&
    typeof record.vehicleTypeName === "string" &&
    typeof record.productCode === "string" &&
    typeof record.productName === "string" &&
    typeof record.packageCode === "string" &&
    typeof record.packageName === "string" &&
    typeof record.quantity === "number"
  );
}

// Function สร้าง response แบบย่อให้ Gate หลังสร้างหรือ replay งานรถ
function buildPublicGateVehicleJobResponse(
  detail: VehicleJobDetailResponse,
  input: GateVehicleJobBody,
  result: GateVehicleJobResult
): GateVehicleJobResponse {
  const { market, booth, product } = findGateResponseProduct(detail, input);

  return {
    result,
    ticket: {
      ticketNo: detail.vehicle_job.ticketNo,
      licensePlate: detail.vehicle_job.license_plate,
      vehicleTypeCode: input.vehicleTypeCode ?? null,
      vehicleTypeName: detail.vehicle_job.vehicle_type,
      workers_required: 1,
      status: detail.vehicle_job.status,
    },
    market: {
      marketCode: market.marketCode,
      marketName: market.marketName,
    },
    booth: {
      boothCode: booth.boothCode,
      boothName: booth.boothName,
    },
    product: {
      productCode: product.productCode,
      productName: product.productName,
      packageCode: product.packageCode,
      packageName: product.packageName,
      quantity: Number(product.quantity),
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

function buildGateTransactionRef(input: GateVehicleJobBody): string {
  const idempotencyParts = {
    ticketNo: input.ticketNo,
    marketCode: input.marketCode,
    boothCode: input.boothCode,
    productCode: input.productCode,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(normalizeJson(idempotencyParts)))
    .digest("hex")
    .slice(0, 24);

  return `GATE-${hash}`;
}

function buildGateCreateInput(input: GateVehicleJobBody): GateVehicleJobCreateInput {
  return {
    gate_transaction_ref: buildGateTransactionRef(input),
    ticketNo: input.ticketNo,
    license_plate: input.licensePlate,
    vehicle_type: input.vehicleTypeName,
    dispatch_now: input.dispatch_now,
    markets: [
      {
        marketCode: input.marketCode,
        marketName: input.marketName,
        tickets: [
          {
            boothCode: input.boothCode,
            boothName: input.boothName,
            products: [
              {
                productCode: input.productCode,
                productName: input.productName,
                packageCode: input.packageCode,
                packageName: input.packageName,
                quantity: input.quantity,
              },
            ],
          },
        ],
      },
    ],
  };
}

// Function สร้าง replay response แบบย่อจาก snapshot เดิมที่อาจเคยเก็บ response เต็มไว้
function buildGateReplayResponse(
  response: GateVehicleJobResponse,
  payloadSnapshot: unknown
): GateVehicleJobResponse {
  if ("ticket" in response && "market" in response && "booth" in response && "product" in response) {
    return {
      ...response,
      result: "REPLAYED",
      ticket: {
        ...response.ticket,
        workers_required: 1,
      },
    };
  }

  if (!isGateVehicleJobBody(payloadSnapshot)) {
    throw new ApiError(
      409,
      "GATE_REQUEST_RESPONSE_NOT_READY",
      "Gate request already exists but its response snapshot is not ready."
    );
  }

  const legacyResponse = response as unknown as {
    vehicle_job?: {
      ticketNo?: string;
      license_plate?: string;
      vehicleTypeName?: string | null;
      status?: string;
    };
    qr?: GateVehicleJobResponse["qr"];
  };

  return {
    result: "REPLAYED",
    ticket: {
      ticketNo: legacyResponse.vehicle_job?.ticketNo ?? payloadSnapshot.ticketNo,
      licensePlate: legacyResponse.vehicle_job?.license_plate ?? payloadSnapshot.licensePlate,
      vehicleTypeCode: payloadSnapshot.vehicleTypeCode ?? null,
      vehicleTypeName: legacyResponse.vehicle_job?.vehicleTypeName ?? payloadSnapshot.vehicleTypeName,
      workers_required: 1,
      status: legacyResponse.vehicle_job?.status ?? "WAIT",
    },
    market: {
      marketCode: payloadSnapshot.marketCode,
      marketName: payloadSnapshot.marketName,
    },
    booth: {
      boothCode: payloadSnapshot.boothCode,
      boothName: payloadSnapshot.boothName,
    },
    product: {
      productCode: payloadSnapshot.productCode,
      productName: payloadSnapshot.productName,
      packageCode: payloadSnapshot.packageCode,
      packageName: payloadSnapshot.packageName,
      quantity: payloadSnapshot.quantity,
    },
    qr: legacyResponse.qr ?? {
      driver_qr_token: "",
      worker_qr_token: payloadSnapshot.ticketNo,
    },
  };
}

// Function สร้าง response งานรถสำหรับ Gate พร้อม QR token
async function buildGateVehicleJobResponse(
  vehicleJobId: number,
  input: GateVehicleJobBody,
  result: GateVehicleJobResult,
  connection?: Parameters<typeof workerApplicationRepository.getVehicleJobDetail>[1]
): Promise<GateVehicleJobResponse> {
  const detail = await workerApplicationRepository.getVehicleJobDetail(vehicleJobId, connection);

  if (!detail) {
    throw new ApiError(404, "VEHICLE_JOB_NOT_FOUND", "Vehicle job not found.");
  }

  return buildPublicGateVehicleJobResponse(detail, input, result);
}

// Function สร้างงานรถจาก Gate mock payload
export async function createVehicleJobFromGate(body: unknown): Promise<GateVehicleJobResponse> {
  const input = parseWithSchema<GateVehicleJobBody>(gateVehicleJobBodySchema, body);
  const gateInput = buildGateCreateInput(input);
  const existingGateRequest = await gateRepository.findGateRequestReplayByRef(
    gateInput.gate_transaction_ref
  );

  if (existingGateRequest) {
    if (!arePayloadsEqual(existingGateRequest.payload_snapshot, input)) {
      console.warn("Gate request payload mismatch", {
        gate_transaction_ref: gateInput.gate_transaction_ref,
        ticketNo: gateInput.ticketNo,
      });

      throw new ApiError(
        409,
        "GATE_TRANSACTION_REF_PAYLOAD_MISMATCH",
        "gate_transaction_ref already exists with a different payload.",
        {
          duplicate_field: "gate_transaction_ref",
          gate_transaction_ref: gateInput.gate_transaction_ref,
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
          gate_transaction_ref: gateInput.gate_transaction_ref,
        }
      );
    }

    console.info("Gate request replayed", {
      gate_transaction_ref: gateInput.gate_transaction_ref,
      ticketNo: gateInput.ticketNo,
    });

    return buildGateReplayResponse(existingGateRequest.response_snapshot, existingGateRequest.payload_snapshot);
  }

  const response = await withTransaction(async (transaction) => {
    const vehicleJob = await gateRepository.createVehicleJobFromGate(
      gateInput,
      input as unknown as Prisma.InputJsonValue,
      transaction
    );
    if (gateInput.dispatch_now === true) {
      await dispatchReadyWorkers(transaction);
    }
    const response = await buildGateVehicleJobResponse(
      vehicleJob.id,
      input,
      "CREATED",
      transaction
    );

    await gateRepository.updateGateRequestResponse(
      gateInput.gate_transaction_ref,
      response as unknown as Prisma.InputJsonValue,
      transaction
    );

    return response;
  });

  publishNotification({
    type: "VEHICLE_JOB_CREATED",
    title: "Vehicle job created",
    message: `Vehicle job ${response.ticket.ticketNo} was created from Gate.`,
    payload: {
      ticketNo: response.ticket.ticketNo,
      gate_transaction_ref: gateInput.gate_transaction_ref,
      license_plate: response.ticket.licensePlate,
      status: response.ticket.status,
      dispatch_now: gateInput.dispatch_now === true,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return response;
}
