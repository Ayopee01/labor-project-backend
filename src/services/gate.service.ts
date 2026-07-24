// import Library
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
// import
import { VEHICLE_OPERATION_STATUS } from "../constants/job-status";
import { withTransaction } from "../db/prisma";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import * as gateRepository from "../repositories/gate.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { publishNotification } from "./notifications.service";
// import Types
import type {
  GateVehicleJobBody,
  GateVehicleJobResponse,
  GateVehicleJobResponseStatus,
  GateVehicleJobResult,
} from "../types/gate.type";
import type { GateVehicleJobCreateInput } from "../types/gate.type";
import type { VehicleJobDetailResponse } from "../types/worker.type";
// import Validation
import { parseWithSchema } from "../validation/parser";
import { gateVehicleJobBodySchema } from "../validation/schemas";
// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

function buildGateTicketResponseStatus(dispatch: boolean): GateVehicleJobResponseStatus {
  return dispatch
    ? VEHICLE_OPERATION_STATUS.UNLOAD_NOW
    : VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;
}

function isGateTicketResponseStatus(value: unknown): value is GateVehicleJobResponseStatus {
  return value === VEHICLE_OPERATION_STATUS.UNLOAD_NOW ||
    value === VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;
}

function findGateResponseProduct(
  detail: VehicleJobDetailResponse,
  input: GateVehicleJobBody
) {
  const market = detail.markets.find(
    (candidate) => candidate.marketCode === input.MarketCode
  );

  if (!market) {
    throw new ApiError(500, "GATE_RESPONSE_MARKET_NOT_FOUND", "Gate market response was not found.");
  }

  const booth = market.tickets.find(
    (candidate) => candidate.boothCode === input.BoothCode
  );

  if (!booth) {
    throw new ApiError(500, "GATE_RESPONSE_BOOTH_NOT_FOUND", "Gate booth response was not found.");
  }

  const product = booth.products.find(
    (candidate) => candidate.productCode === input.ProductCode
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
    typeof record.TicketNo === "string" &&
    typeof record.TicketCreatedAt === "string" &&
    typeof record.BoothCount === "number" &&
    typeof record.MarketCode === "string" &&
    typeof record.MarketName === "string" &&
    typeof record.BoothCode === "string" &&
    typeof record.BoothName === "string" &&
    typeof record.LicensePlate === "string" &&
    typeof record.VehicleTypeCode === "string" &&
    typeof record.VehicleTypeName === "string" &&
    typeof record.ProductCode === "string" &&
    typeof record.ProductName === "string" &&
    typeof record.PackageCode === "string" &&
    typeof record.PackageName === "string" &&
    typeof record.Quantity === "number" &&
    typeof record.Dispatch === "boolean"
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
    Result: result,
    Ticket: {
      TicketNo: detail.vehicle_job.ticketNo,
      TicketCreatedAt: detail.vehicle_job.ticket_created_at,
      BoothCount: detail.vehicle_job.booth_count,
      LicensePlate: detail.vehicle_job.license_plate,
      VehicleTypeCode: input.VehicleTypeCode,
      VehicleTypeName: detail.vehicle_job.vehicle_type,
      WorkersRequired: 1,
      Status: buildGateTicketResponseStatus(input.Dispatch),
    },
    Market: {
      MarketCode: market.marketCode,
      MarketName: market.marketName,
    },
    Booth: {
      BoothCode: booth.boothCode,
      BoothName: booth.boothName,
    },
    Product: {
      ProductCode: product.productCode,
      ProductName: product.productName,
      PackageCode: product.packageCode,
      PackageName: product.packageName,
      Quantity: Number(product.quantity),
    },
    Qr: {
      DriverQrToken: detail.vehicle_job.driver_qr_token,
      WorkerQrToken: detail.vehicle_job.worker_qr_token,
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
    ticketNo: input.TicketNo,
    marketCode: input.MarketCode,
    boothCode: input.BoothCode,
    productCode: input.ProductCode,
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
    ticketNo: input.TicketNo,
    ticket_created_at: new Date(input.TicketCreatedAt),
    booth_count: input.BoothCount,
    license_plate: input.LicensePlate,
    vehicle_type: input.VehicleTypeName,
    dispatch_now: input.Dispatch,
    markets: [
      {
        marketCode: input.MarketCode,
        marketName: input.MarketName,
        tickets: [
          {
            boothCode: input.BoothCode,
            boothName: input.BoothName,
            products: [
              {
                productCode: input.ProductCode,
                productName: input.ProductName,
                packageCode: input.PackageCode,
                packageName: input.PackageName,
                quantity: input.Quantity,
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
  const responseRecord = response as unknown as Record<string, unknown>;

  if ("Ticket" in responseRecord && "Market" in responseRecord && "Booth" in responseRecord && "Product" in responseRecord) {
    const pascalResponse = response as GateVehicleJobResponse;
    const status = isGateVehicleJobBody(payloadSnapshot)
      ? buildGateTicketResponseStatus(payloadSnapshot.Dispatch)
      : isGateTicketResponseStatus(pascalResponse.Ticket.Status)
        ? pascalResponse.Ticket.Status
        : VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;

    return {
      ...pascalResponse,
      Result: "REPLAYED",
      Ticket: {
        ...pascalResponse.Ticket,
        WorkersRequired: 1,
        Status: status,
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
    ticket?: {
      ticketNo?: string;
      ticketCreatedAt?: string;
      boothCount?: number;
      licensePlate?: string;
      vehicleTypeCode?: string | null;
      vehicleTypeName?: string | null;
      workers_required?: number;
      status?: string;
    };
    market?: {
      marketCode?: string;
      marketName?: string;
    };
    booth?: {
      boothCode?: string;
      boothName?: string | null;
    };
    product?: {
      productCode?: string;
      productName?: string;
      packageCode?: string;
      packageName?: string;
      quantity?: number;
    };
    qr?: {
      driver_qr_token?: string;
      worker_qr_token?: string;
    };
    vehicle_job?: {
      ticketNo?: string;
      license_plate?: string;
      vehicleTypeName?: string | null;
      status?: string;
    };
  };
  const ticketCreatedAt =
    legacyResponse.ticket?.ticketCreatedAt ?? payloadSnapshot.TicketCreatedAt;

  return {
    Result: "REPLAYED",
    Ticket: {
      TicketNo: legacyResponse.ticket?.ticketNo ?? legacyResponse.vehicle_job?.ticketNo ?? payloadSnapshot.TicketNo,
      TicketCreatedAt: ticketCreatedAt,
      BoothCount: legacyResponse.ticket?.boothCount ?? payloadSnapshot.BoothCount,
      LicensePlate: legacyResponse.ticket?.licensePlate ?? legacyResponse.vehicle_job?.license_plate ?? payloadSnapshot.LicensePlate,
      VehicleTypeCode: legacyResponse.ticket?.vehicleTypeCode ?? payloadSnapshot.VehicleTypeCode,
      VehicleTypeName: legacyResponse.ticket?.vehicleTypeName ?? legacyResponse.vehicle_job?.vehicleTypeName ?? payloadSnapshot.VehicleTypeName,
      WorkersRequired: 1,
      Status: buildGateTicketResponseStatus(payloadSnapshot.Dispatch),
    },
    Market: {
      MarketCode: legacyResponse.market?.marketCode ?? payloadSnapshot.MarketCode,
      MarketName: legacyResponse.market?.marketName ?? payloadSnapshot.MarketName,
    },
    Booth: {
      BoothCode: legacyResponse.booth?.boothCode ?? payloadSnapshot.BoothCode,
      BoothName: legacyResponse.booth?.boothName ?? payloadSnapshot.BoothName,
    },
    Product: {
      ProductCode: legacyResponse.product?.productCode ?? payloadSnapshot.ProductCode,
      ProductName: legacyResponse.product?.productName ?? payloadSnapshot.ProductName,
      PackageCode: legacyResponse.product?.packageCode ?? payloadSnapshot.PackageCode,
      PackageName: legacyResponse.product?.packageName ?? payloadSnapshot.PackageName,
      Quantity: legacyResponse.product?.quantity ?? payloadSnapshot.Quantity,
    },
    Qr: {
      DriverQrToken: legacyResponse.qr?.driver_qr_token ?? "",
      WorkerQrToken: legacyResponse.qr?.worker_qr_token ?? payloadSnapshot.TicketNo,
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
    message: `Vehicle job ${response.Ticket.TicketNo} was created from Gate.`,
    payload: {
      ticketNo: response.Ticket.TicketNo,
      gate_transaction_ref: gateInput.gate_transaction_ref,
      license_plate: response.Ticket.LicensePlate,
      status: response.Ticket.Status,
      dispatch_now: gateInput.dispatch_now === true,
    },
    audience: {
      roles: ["admin"],
    },
  });

  return response;
}
