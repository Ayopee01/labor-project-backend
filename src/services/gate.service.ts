// Import Library
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
// Import Dependencies
import { VEHICLE_OPERATION_STATUS } from "../constants/job-status";
import { withTransaction } from "../db/prisma";
import { enqueueLoggedLineMessage } from "../queues/notification-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import * as gateRepository from "../repositories/gate.repository";
import * as workerApplicationRepository from "../repositories/worker.repository";
import { publishNotification } from "./notifications.service";
// Import Types
import type {
  GateVehicleJobBody,
  GateVehicleJobResponse,
  GateVehicleJobResponseStatus,
  GateVehicleJobResult,
} from "../types/gate.type";
import type { GateVehicleJobCreateInput } from "../types/gate.type";
import type { DbConnection } from "../types/shared/common.type";
import type { LineMessage } from "../types/line.type";
import type { VehicleJobDetailResponse } from "../types/worker.type";
// Import Validation
import { parseWithSchema } from "../validation/parser";
import { gateVehicleJobBodySchema } from "../validation/schemas";
// Import Utils
import ApiError from "../utils/api-error";
import { buildGateTicketCreatedFlexMessage } from "../utils/line-flex-message";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง Gate ticket response status ใน service flow
function buildGateTicketResponseStatus(dispatch: boolean): GateVehicleJobResponseStatus {
  return dispatch
    ? VEHICLE_OPERATION_STATUS.UNLOAD_NOW
    : VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;
}

// Function ตรวจว่า Gate ticket response status ใน service flow
function isGateTicketResponseStatus(value: unknown): value is GateVehicleJobResponseStatus {
  return value === VEHICLE_OPERATION_STATUS.UNLOAD_NOW ||
    value === VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;
}

// Function ค้นหา gate response product ใน service flow
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

// Function ตรวจว่า gate vehicle job body ใน service flow
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

// Function สร้าง public gate vehicle job response ใน service flow
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

// Function สร้าง Gate ticket created messages ใน service flow
function buildGateTicketCreatedMessages(
  response: GateVehicleJobResponse
): LineMessage[] {
  return [buildGateTicketCreatedFlexMessage(response)];
}

// Function จัดการ notify vendor Gate ticket created ใน service flow
async function notifyVendorGateTicketCreated(
  response: GateVehicleJobResponse
): Promise<void> {
  const vendorLineTargets = await gateRepository.findActiveVendorLineTargetsByStall(
    response.Market.MarketCode,
    response.Booth.BoothCode
  );

  if (vendorLineTargets.length === 0) {
    return;
  }

  const messages = buildGateTicketCreatedMessages(response);

  for (const target of vendorLineTargets) {
    await enqueueLoggedLineMessage({
      jobName: "send-gate-ticket-created",
      action: "send_gate_ticket_created",
      targetLineUserId: target.line_user_id,
      payload: {
        ticketNo: response.Ticket.TicketNo,
        marketCode: response.Market.MarketCode,
        boothCode: response.Booth.BoothCode,
        productCode: response.Product.ProductCode,
        vendor_line_id: target.line_user_id,
        vendor_line_target_type: target.target_type,
        status: response.Ticket.Status,
      },
      messages,
    });
  }
}

// Function แปลงให้เป็นรูปแบบกลาง json ใน service flow
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

// Function จัดการ are payloads equal ใน service flow
function arePayloadsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

// Function สร้าง gate transaction ref ใน service flow
function buildGateTransactionRef(input: GateVehicleJobBody): string {
  const idempotencyParts = {
    ticketNo: input.TicketNo,
    marketCode: input.MarketCode,
    boothCode: input.BoothCode,
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(normalizeJson(idempotencyParts)))
    .digest("hex")
    .slice(0, 24);

  return `GATE-${hash}`;
}

// Function สร้าง gate create input ใน service flow
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

// Function ตรวจสอบ Gate ticket append rules ใน service flow
async function validateGateTicketAppendRules(
  input: GateVehicleJobCreateInput,
  connection?: DbConnection
): Promise<void> {
  const market = input.markets[0];
  const ticket = market?.tickets[0];

  if (!market || !ticket) {
    return;
  }

  const appendState = await gateRepository.getGateTicketAppendState(
    input.ticketNo,
    ticket.boothCode,
    connection
  );

  if (!appendState) {
    return;
  }

  if (appendState.booth_count !== input.booth_count) {
    throw new ApiError(
      409,
      "GATE_TICKET_BOOTH_COUNT_MISMATCH",
      "TicketNo already exists with a different BoothCount.",
      {
        ticketNo: input.ticketNo,
        existing_booth_count_limit: appendState.booth_count,
        requested_booth_count: input.booth_count,
      }
    );
  }

  if (appendState.duplicate_booth) {
    throw new ApiError(
      409,
      "GATE_TICKET_BOOTH_ALREADY_EXISTS",
      "BoothCode already exists under this TicketNo.",
      {
        ticketNo: input.ticketNo,
        boothCode: ticket.boothCode,
        existing_marketCode: appendState.duplicate_booth.marketCode,
        requested_marketCode: market.marketCode,
      }
    );
  }

  if (appendState.existing_booth_count >= appendState.booth_count) {
    throw new ApiError(
      409,
      "GATE_TICKET_BOOTH_LIMIT_REACHED",
      "TicketNo already has the maximum number of booths allowed by BoothCount.",
      {
        ticketNo: input.ticketNo,
        booth_count_limit: appendState.booth_count,
        existing_booth_count: appendState.existing_booth_count,
        requested_boothCode: ticket.boothCode,
      }
    );
  }
}

// Function สร้าง gate create input พร้อม vendor LINE IDs ใน service flow
async function buildGateCreateInputWithVendorLineIds(
  input: GateVehicleJobCreateInput,
  connection?: DbConnection
): Promise<GateVehicleJobCreateInput> {
  const markets = await Promise.all(
    input.markets.map(async (market) => ({
      ...market,
      tickets: await Promise.all(
        market.tickets.map(async (ticket) => {
          const vendorLineTargets = await gateRepository.findActiveVendorLineTargetsByStall(
            market.marketCode,
            ticket.boothCode,
            connection
          );

          if (vendorLineTargets.length === 0) {
            throw new ApiError(
              409,
              "BOOTH_VENDOR_LINE_NOT_CONFIGURED",
              "Booth vendor LINE id is not configured in vendor master mapping.",
              {
                marketCode: market.marketCode,
                boothCode: ticket.boothCode,
              }
            );
          }

          return {
            ...ticket,
            vendor_line_id: vendorLineTargets[0].line_user_id,
          };
        })
      ),
    }))
  );

  return {
    ...input,
    markets,
  };
}

// Function สร้าง gate replay response ใน service flow
function buildGateReplayResponse(
  response: GateVehicleJobResponse,
  payloadSnapshot: unknown
): GateVehicleJobResponse {
  const responseRecord = response as unknown as Record<string, unknown>;

  if (
    !("Ticket" in responseRecord) ||
    !("Market" in responseRecord) ||
    !("Booth" in responseRecord) ||
    !("Product" in responseRecord)
  ) {
    throw new ApiError(
      409,
      "GATE_REQUEST_RESPONSE_NOT_READY",
      "Gate request already exists but its response snapshot is not ready."
    );
  }

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

// Function สร้าง gate vehicle job response ใน service flow
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

// Function สร้าง vehicle job จาก gate ใน service flow
export async function createVehicleJobFromGate(body: unknown): Promise<GateVehicleJobResponse> {
  const input = parseWithSchema<GateVehicleJobBody>(gateVehicleJobBodySchema, body);
  const gateInput = buildGateCreateInput(input);
  const existingGateRequest = await gateRepository.findGateRequestReplayByRef(
    gateInput.gate_transaction_ref
  );

  if (existingGateRequest) {
    if (!arePayloadsEqual(existingGateRequest.payload_snapshot, input)) {
      console.warn("Gate request payload mismatch", {
        gate_transaction_ref: existingGateRequest.gate_transaction_ref,
        ticketNo: gateInput.ticketNo,
      });

      throw new ApiError(
        409,
        "GATE_TRANSACTION_REF_PAYLOAD_MISMATCH",
        "gate_transaction_ref already exists with a different payload.",
        {
          duplicate_field: "gate_transaction_ref",
          gate_transaction_ref: existingGateRequest.gate_transaction_ref,
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
          gate_transaction_ref: existingGateRequest.gate_transaction_ref,
        }
      );
    }

    console.info("Gate request replayed", {
      gate_transaction_ref: existingGateRequest.gate_transaction_ref,
      ticketNo: gateInput.ticketNo,
    });

    return buildGateReplayResponse(existingGateRequest.response_snapshot, existingGateRequest.payload_snapshot);
  }

  const response = await withTransaction(async (transaction) => {
    await validateGateTicketAppendRules(gateInput, transaction);
    const gateInputWithVendorLineIds = await buildGateCreateInputWithVendorLineIds(
      gateInput,
      transaction
    );
    const vehicleJob = await gateRepository.createVehicleJobFromGate(
      gateInputWithVendorLineIds,
      input as unknown as Prisma.InputJsonValue,
      transaction
    );
    if (gateInputWithVendorLineIds.dispatch_now === true) {
      await dispatchReadyWorkers(transaction, {
        vehicle_job_ids: [vehicleJob.id],
      });
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

  await notifyVendorGateTicketCreated(response);

  return response;
}
