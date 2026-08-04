// Import Library
import { createHash } from "crypto";
import { Prisma, type MasterMarket, type MasterProduct, type MasterRate } from "@prisma/client";

// Import Dependencies
import { VEHICLE_OPERATION_STATUS } from "../constants/job-status";
import { withTransaction } from "../db/prisma";
import { enqueueLoggedLineMessage } from "../queues/notification-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import * as gateRepository from "../repositories/gate.repository";
import * as workerApplicationRepository from "../repositories/worker.repository";
import { publishNotification } from "./notifications.service";

// Import Types
import type { GateVehicleJobBody, GateVehicleJobCreateInput, GateVehicleJobResponse, GateVehicleJobResponseStatus, GateVehicleJobResult } from "../types/gate.type";
import type { DbConnection } from "../types/shared/common.type";
import type { LineMessage } from "../types/line.type";
import type { VehicleJobDetailResponse } from "../types/worker.type";

// Import Validation
import { parseWithSchema } from "../validation/parser";
import { gateVehicleJobBodySchema } from "../validation/schemas";

// Import Utils
import ApiError from "../utils/api-error";
import { calculateRequiredWorkerCount, decimalToMoneyString, decimalToWeightString, packageWeightToDecimal, parseMasterProductRange } from "../utils/labor-job-pricing";

// Import Flex Message Builder
import { buildGateTicketCreatedFlexMessage } from "../utils/line-flex-message";

/* -------------------------------------- Types -------------------------------------- */

type LaborProductPricing = {
  product: {
    id: number;
    productCode: string;
    productFullCode: string;
    productName: string;
    packageCode: string;
    packageName: string;
    packageWeight: string;
    quantity: number;
  };

  requiredWorkerCount: number;

  appliedRate: {
    rateId: number;
    sourceRateId: number;
    requestedMarketCode: string;
    appliedMarketCode: string;
    rateSource: "MARKET_RATE" | "CENTRAL_RATE";
    packageWeight: string;
    weightRangeName: string;
    weightMin: string;
    weightMax: string;
    stallRate: Prisma.Decimal;
    laborRate: Prisma.Decimal;
  };

  stallFee: Prisma.Decimal;
  laborFee: Prisma.Decimal;
  rawTotalFee: Prisma.Decimal;
};

type LaborBoothPricing = {
  boothCode: string;
  boothName: string;
  products: LaborProductPricing[];

  rawTotalFee: Prisma.Decimal;
  totalFee: Prisma.Decimal;
  roundingAmount: Prisma.Decimal;
};

type LaborJobPricing = {
  market: {
    marketCode: string;
    marketName: string;
  };

  booths: LaborBoothPricing[];

  workerCount: number;

  totalLaborFee: Prisma.Decimal;
  stallRoundingTotal: Prisma.Decimal;
};

type WorkerPaymentCalculation = {
  amountPerWorker: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  deductedRemainder: Prisma.Decimal;
};

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง status ที่คืนให้ Gate
function buildGateTicketResponseStatus(
  dispatch: boolean
): GateVehicleJobResponseStatus {
  return dispatch
    ? VEHICLE_OPERATION_STATUS.UNLOAD_NOW
    : VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;
}

// Function ตรวจว่าเป็น Gate response status หรือไม่
function isGateTicketResponseStatus(
  value: unknown
): value is GateVehicleJobResponseStatus {
  return (
    value === VEHICLE_OPERATION_STATUS.UNLOAD_NOW ||
    value === VEHICLE_OPERATION_STATUS.WAITING_UNLOAD
  );
}

// Function ตรวจ Gate body สำหรับ replay
function isGateVehicleJobBody(
  value: unknown
): value is GateVehicleJobBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.TicketNo !== "string" ||
    typeof record.TicketCreatedAt !== "string" ||
    typeof record.BoothCount !== "number" ||
    typeof record.MarketCode !== "string" ||
    typeof record.LicensePlate !== "string" ||
    typeof record.VehicleTypeCode !== "string" ||
    typeof record.VehicleTypeName !== "string" ||
    !Array.isArray(record.Booths) ||
    typeof record.Dispatch !== "boolean"
  ) {
    return false;
  }

  return record.Booths.every((boothValue) => {
    if (!boothValue || typeof boothValue !== "object") {
      return false;
    }

    const booth = boothValue as Record<string, unknown>;

    if (
      typeof booth.BoothCode !== "string" ||
      !Array.isArray(booth.Products)
    ) {
      return false;
    }

    return booth.Products.every((productValue) => {
      if (!productValue || typeof productValue !== "object") {
        return false;
      }

      const product = productValue as Record<string, unknown>;

      return (
        typeof product.ProductCode === "string" &&
        typeof product.PackageCode === "string" &&
        typeof product.Quantity === "number"
      );
    });
  });
}

// Function รวมค่า Decimal หลายรายการ
function sumDecimals(
  values: Prisma.Decimal[]
): Prisma.Decimal {
  return values.reduce(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0)
  );
}

// Function หา Market + Booth จาก master
async function findActiveMasterMarketBooth(
  marketCode: string,
  boothCode: string,
  connection?: DbConnection
): Promise<MasterMarket> {
  const marketBooth =
    await gateRepository.findActiveMarketBoothByCodes(
      marketCode,
      boothCode,
      connection
    );

  if (!marketBooth) {
    throw new ApiError(
      409,
      "MARKET_BOOTH_NOT_FOUND",
      "Active MarketCode + BoothCode mapping was not found in master_market.",
      {
        marketCode,
        boothCode,
      }
    );
  }

  if (!marketBooth.marketName) {
    throw new ApiError(
      409,
      "MARKET_NAME_NOT_CONFIGURED",
      "Master market name is not configured.",
      {
        marketCode,
        boothCode,
      }
    );
  }

  return marketBooth;
}

// Function หา Product + Package จาก master
async function findActiveMasterProduct(
  productCode: string,
  packageCode: string,
  connection?: DbConnection
): Promise<MasterProduct> {
  const products =
    await gateRepository.findActiveProductsByProductCodeAndPackageCode(
      productCode,
      packageCode,
      connection
    );

  if (products.length === 0) {
    throw new ApiError(
      409,
      "PRODUCT_PACKAGE_NOT_FOUND",
      "Active product package was not found.",
      {
        productCode,
        packageCode,
      }
    );
  }

  if (products.length > 1) {
    throw new ApiError(
      409,
      "AMBIGUOUS_PRODUCT_PACKAGE",
      "ProductCode + PackageCode matched more than one active product.",
      {
        productCode,
        packageCode,
        matched_count: products.length,
      }
    );
  }

  return products[0];
}

// Function หา rate ตามตลาดและน้ำหนักสินค้า
async function findApplicableRate(
  marketCode: string,
  packageWeight: Prisma.Decimal,
  connection?: DbConnection
): Promise<{
  rate: MasterRate;
  requestedMarketCode: string;
  appliedMarketCode: string;
  rateSource: "MARKET_RATE" | "CENTRAL_RATE";
}> {
  const marketRates =
    await gateRepository.findActiveRatesByMarketAndWeight(
      marketCode,
      packageWeight,
      connection
    );

  if (marketRates.length > 1) {
    throw new ApiError(
      409,
      "DUPLICATE_RATE_CONFIGURATION",
      "More than one active rate matched this market and package weight.",
      {
        marketCode,
        packageWeight: decimalToWeightString(packageWeight),
      }
    );
  }

  if (marketRates.length === 1) {
    return {
      rate: marketRates[0],
      requestedMarketCode: marketCode,
      appliedMarketCode: marketRates[0].marketCode,
      rateSource: "MARKET_RATE",
    };
  }

  const centralRates =
    await gateRepository.findActiveRatesByMarketAndWeight(
      "0000",
      packageWeight,
      connection
    );

  if (centralRates.length > 1) {
    throw new ApiError(
      409,
      "DUPLICATE_RATE_CONFIGURATION",
      "More than one active central rate matched this package weight.",
      {
        marketCode: "0000",
        packageWeight: decimalToWeightString(packageWeight),
      }
    );
  }

  if (centralRates.length === 0) {
    throw new ApiError(
      409,
      "RATE_NOT_FOUND",
      "No active rate matched this market or central rate.",
      {
        requestedMarketCode: marketCode,
        fallbackMarketCode: "0000",
        packageWeight: decimalToWeightString(packageWeight),
      }
    );
  }

  return {
    rate: centralRates[0],
    requestedMarketCode: marketCode,
    appliedMarketCode: centralRates[0].marketCode,
    rateSource: "CENTRAL_RATE",
  };
}

// Function คิดเงิน Worker จากค่าแรงรวม
function calculateWorkerPayment(
  totalLaborFee: Prisma.Decimal,
  workerCount: number
): WorkerPaymentCalculation {
  if (!Number.isInteger(workerCount) || workerCount <= 0) {
    throw new ApiError(
      500,
      "WORKER_COUNT_INVALID",
      "Worker count must be greater than zero."
    );
  }

  const amountPerWorker = totalLaborFee
    .div(workerCount)
    .floor();

  const totalAmount = amountPerWorker.mul(workerCount);

  const deductedRemainder =
    totalLaborFee.minus(totalAmount);

  if (
    deductedRemainder.isNegative() ||
    !totalAmount.plus(deductedRemainder).equals(totalLaborFee)
  ) {
    throw new ApiError(
      500,
      "PAYMENT_CALCULATION_INVALID",
      "Worker payment calculation is invalid."
    );
  }

  return {
    amountPerWorker,
    totalAmount,
    deductedRemainder,
  };
}

// Function คำนวณแรงงานและราคาทุกแผงทุกสินค้า
async function calculateLaborJobPricing(
  input: GateVehicleJobBody,
  connection?: DbConnection
): Promise<LaborJobPricing> {
  const booths: LaborBoothPricing[] = [];
  const workerCounts: number[] = [];
  const laborFees: Prisma.Decimal[] = [];

  let marketName = "";

  for (const boothInput of input.Booths) {
    const marketBooth =
      await findActiveMasterMarketBooth(
        input.MarketCode,
        boothInput.BoothCode,
        connection
      );

    if (!marketName) {
      marketName = marketBooth.marketName as string;
    }

    const products: LaborProductPricing[] = [];

    for (const productInput of boothInput.Products) {
      const product =
        await findActiveMasterProduct(
          productInput.ProductCode,
          productInput.PackageCode,
          connection
        );

      const parsedRange =
        parseMasterProductRange(product.range);

      const workerRequirement =
        calculateRequiredWorkerCount(
          productInput.Quantity,
          parsedRange.workerRanges
        );

      workerCounts.push(
        workerRequirement.requiredWorkerCount
      );

      const packageWeight =
        packageWeightToDecimal(product.packageWeight);

      const applicableRate =
        await findApplicableRate(
          input.MarketCode,
          packageWeight,
          connection
        );

      const quantity =
        new Prisma.Decimal(productInput.Quantity);

      const stallFee =
        quantity.mul(applicableRate.rate.stallRate);

      const laborFee =
        quantity.mul(applicableRate.rate.laborRate);

      const rawTotalFee =
        stallFee.plus(laborFee);

      laborFees.push(laborFee);

      products.push({
        product: {
          id: product.id,
          productCode: product.productCode,
          productFullCode: product.productFullCode,
          productName: product.productName,
          packageCode: product.packageCode,
          packageName: product.packageName,
          packageWeight: String(product.packageWeight),
          quantity: productInput.Quantity,
        },

        requiredWorkerCount:
          workerRequirement.requiredWorkerCount,

        appliedRate: {
          rateId: applicableRate.rate.id,
          sourceRateId: applicableRate.rate.sourceRateId,
          requestedMarketCode:
            applicableRate.requestedMarketCode,
          appliedMarketCode:
            applicableRate.appliedMarketCode,
          rateSource:
            applicableRate.rateSource,
          packageWeight:
            decimalToWeightString(packageWeight),
          weightRangeName:
            applicableRate.rate.weightRangeName,
          weightMin:
            decimalToWeightString(applicableRate.rate.weightMin),
          weightMax:
            decimalToWeightString(applicableRate.rate.weightMax),
          stallRate:
            applicableRate.rate.stallRate,
          laborRate:
            applicableRate.rate.laborRate,
        },

        stallFee,
        laborFee,
        rawTotalFee,
      });
    }

    // รวมยอดสินค้าของแผงก่อนปัดขึ้น
    const rawTotalFee =
      sumDecimals(
        products.map(
          (product) => product.rawTotalFee
        )
      );

    const totalFee =
      rawTotalFee.ceil();

    const roundingAmount =
      totalFee.minus(rawTotalFee);

    booths.push({
      boothCode: marketBooth.boothCode,
      boothName: marketBooth.boothName,
      products,
      rawTotalFee,
      totalFee,
      roundingAmount,
    });
  }

  if (workerCounts.length === 0) {
    throw new ApiError(
      409,
      "WORKER_REQUIREMENT_NOT_FOUND",
      "No worker requirement was calculated."
    );
  }

  // ใช้จำนวน Worker สูงสุดจากสินค้าทั้งหมด
  const workerCount =
    Math.max(...workerCounts);

  // รวมค่าแรงสินค้าทั้ง Order
  const totalLaborFee =
    sumDecimals(laborFees);

  // รวมเศษการปัดขึ้นของทุกแผง
  const stallRoundingTotal =
    sumDecimals(
      booths.map(
        (booth) => booth.roundingAmount
      )
    );

  return {
    market: {
      marketCode: input.MarketCode,
      marketName,
    },

    booths,

    workerCount,

    totalLaborFee,

    stallRoundingTotal,
  };
}

// Function สร้าง response ที่คืนให้ Gate
function buildPublicGateVehicleJobResponse(
  detail: VehicleJobDetailResponse,
  input: GateVehicleJobBody,
  result: GateVehicleJobResult,
  pricing: LaborJobPricing
): GateVehicleJobResponse {
  const actualWorkerCount =
    detail.vehicle_job.workers_required;

  const workerPayment =
    calculateWorkerPayment(
      pricing.totalLaborFee,
      actualWorkerCount
    );

  const totalRemainder =
    pricing.stallRoundingTotal.plus(
      workerPayment.deductedRemainder
    );

  return {
    Result: result,

    Ticket: {
      TicketNo:
        detail.vehicle_job.ticketNo,

      TicketCreatedAt:
        detail.vehicle_job.ticket_created_at,

      BoothCount:
        detail.vehicle_job.booth_count,

      LicensePlate:
        detail.vehicle_job.license_plate,

      VehicleTypeCode:
        input.VehicleTypeCode,

      VehicleTypeName:
        detail.vehicle_job.vehicle_type,

      Status:
        buildGateTicketResponseStatus(
          input.Dispatch
        ),
    },

    Market: {
      MarketCode:
        pricing.market.marketCode,

      MarketName:
        pricing.market.marketName,
    },

    Booths:
      pricing.booths.map((booth) => ({
        BoothCode:
          booth.boothCode,

        BoothName:
          booth.boothName,

        Products:
          booth.products.map((item) => ({
            ProductCode:
              item.product.productCode,

            ProductFullCode:
              item.product.productFullCode,

            ProductName:
              item.product.productName,

            PackageCode:
              item.product.packageCode,

            PackageName:
              item.product.packageName,

            Quantity:
              item.product.quantity,
          })),

        StallPayment: {
          Amount:
            decimalToMoneyString(
              booth.totalFee
            ),

          RoundingAmount:
            decimalToMoneyString(
              booth.roundingAmount
            ),
        },
      })),

    WorkerCount:
      actualWorkerCount,

    WorkerPayment: {
      AmountPerWorker:
        decimalToMoneyString(
          workerPayment.amountPerWorker
        ),

      WorkerCount:
        actualWorkerCount,

      TotalAmount:
        decimalToMoneyString(
          workerPayment.totalAmount
        ),

      DeductedRemainder:
        decimalToMoneyString(
          workerPayment.deductedRemainder
        ),
    },

    OrderRemainder: {
      StallRoundingAmount:
        decimalToMoneyString(
          pricing.stallRoundingTotal
        ),

      WorkerDeductedAmount:
        decimalToMoneyString(
          workerPayment.deductedRemainder
        ),

      TotalAmount:
        decimalToMoneyString(
          totalRemainder
        ),
    },

    Qr: {
      DriverQrToken:
        detail.vehicle_job.driver_qr_token,

      WorkerQrToken:
        detail.vehicle_job.worker_qr_token,
    },
  };
}

// Function สร้างข้อความ LINE ของแต่ละแผง
function buildGateTicketCreatedMessages(
  response: GateVehicleJobResponse,
  booth: GateVehicleJobResponse["Booths"][number]
): LineMessage[] {
  return [
    buildGateTicketCreatedFlexMessage(
      response,
      booth
    ),
  ];
}

// Function แจ้ง Vendor แยกตามแผง
async function notifyVendorGateTicketCreated(
  response: GateVehicleJobResponse
): Promise<void> {
  for (const booth of response.Booths) {
    const vendorLineTargets =
      await gateRepository.findActiveVendorLineTargetsByStall(
        response.Market.MarketCode,
        booth.BoothCode
      );

    if (vendorLineTargets.length === 0) {
      continue;
    }

    const messages =
      buildGateTicketCreatedMessages(
        response,
        booth
      );

    const firstProduct =
      booth.Products[0];

    for (const target of vendorLineTargets) {
      await enqueueLoggedLineMessage({
        jobName:
          "send-gate-ticket-created",

        action:
          "send_gate_ticket_created",

        targetLineUserId:
          target.line_user_id,

        payload: {
          ticketNo:
            response.Ticket.TicketNo,

          marketCode:
            response.Market.MarketCode,

          boothCode:
            booth.BoothCode,

          productCode:
            firstProduct?.ProductCode ?? "",

          vendor_line_id:
            target.line_user_id,

          vendor_line_target_type:
            target.target_type,

          status:
            response.Ticket.Status,
        },

        messages,
      });
    }
  }
}

// Function จัดรูปแบบ JSON ก่อน compare
function normalizeJson(
  value: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      normalizeJson(item)
    );
  }

  if (
    !value ||
    typeof value !== "object"
  ) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(
      value as Record<string, unknown>
    )
      .filter(
        ([, entryValue]) =>
          entryValue !== undefined
      )
      .sort(
        ([leftKey], [rightKey]) =>
          leftKey.localeCompare(rightKey)
      )
      .map(
        ([key, entryValue]) => [
          key,
          normalizeJson(entryValue),
        ]
      )
  );
}

// Function เปรียบเทียบ payload
function arePayloadsEqual(
  left: unknown,
  right: unknown
): boolean {
  return (
    JSON.stringify(normalizeJson(left)) ===
    JSON.stringify(normalizeJson(right))
  );
}

// Function สร้าง transaction ref ของ Gate
function buildGateTransactionRef(
  input: GateVehicleJobBody
): string {
  const idempotencyParts = {
    ticketNo:
      input.TicketNo,

    marketCode:
      input.MarketCode,
  };

  const hash =
    createHash("sha256")
      .update(
        JSON.stringify(
          normalizeJson(idempotencyParts)
        )
      )
      .digest("hex")
      .slice(0, 24);

  return `GATE-${hash}`;
}

// Function สร้างข้อมูลก่อนบันทึก VehicleJob
function buildGateCreateInput(
  input: GateVehicleJobBody,
  gateTransactionRef: string,
  pricing: LaborJobPricing
): GateVehicleJobCreateInput {
  return {
    gate_transaction_ref:
      gateTransactionRef,

    ticketNo:
      input.TicketNo,

    ticket_created_at:
      new Date(input.TicketCreatedAt),

    booth_count:
      input.BoothCount,

    license_plate:
      input.LicensePlate,

    vehicle_type:
      input.VehicleTypeName,

    workers_required:
      pricing.workerCount,

    dispatch_now:
      input.Dispatch,

    markets: [
      {
        marketCode:
          pricing.market.marketCode,

        marketName:
          pricing.market.marketName,

        tickets:
          pricing.booths.map(
            (booth) => ({
              boothCode:
                booth.boothCode,

              boothName:
                booth.boothName,

              products:
                booth.products.map(
                  (item) => ({
                    productCode:
                      item.product.productCode,

                    productName:
                      item.product.productName,

                    productFullCode:
                      item.product.productFullCode,

                    packageCode:
                      item.product.packageCode,

                    packageName:
                      item.product.packageName,

                    quantity:
                      item.product.quantity,
                  })
                ),
            })
          ),
      },
    ],
  };
}

// Function เติม Vendor LINE ID ให้แต่ละแผง
async function buildGateCreateInputWithVendorLineIds(
  input: GateVehicleJobCreateInput,
  connection?: DbConnection
): Promise<GateVehicleJobCreateInput> {
  const markets =
    await Promise.all(
      input.markets.map(
        async (market) => ({
          ...market,

          tickets:
            await Promise.all(
              market.tickets.map(
                async (ticket) => {
                  const vendorLineTargets =
                    await gateRepository.findActiveVendorLineTargetsByStall(
                      market.marketCode,
                      ticket.boothCode,
                      connection
                    );

                  if (
                    vendorLineTargets.length === 0
                  ) {
                    throw new ApiError(
                      409,
                      "BOOTH_VENDOR_LINE_NOT_CONFIGURED",
                      "Booth vendor LINE id is not configured in vendor master mapping.",
                      {
                        marketCode:
                          market.marketCode,

                        boothCode:
                          ticket.boothCode,
                      }
                    );
                  }

                  return {
                    ...ticket,

                    vendor_line_id:
                      vendorLineTargets[0]
                        .line_user_id,
                  };
                }
              )
            ),
        })
      )
    );

  return {
    ...input,
    markets,
  };
}

// Function สร้าง response เมื่อ Gate ส่ง request เดิม
function buildGateReplayResponse(
  response: GateVehicleJobResponse,
  payloadSnapshot: unknown
): GateVehicleJobResponse {
  const responseRecord =
    response as unknown as Record<
      string,
      unknown
    >;

  if (
    !("Ticket" in responseRecord) ||
    !("Market" in responseRecord) ||
    !("Booths" in responseRecord)
  ) {
    throw new ApiError(
      409,
      "GATE_REQUEST_RESPONSE_NOT_READY",
      "Gate request already exists but its response snapshot is not ready."
    );
  }

  const status =
    isGateVehicleJobBody(payloadSnapshot)
      ? buildGateTicketResponseStatus(
        payloadSnapshot.Dispatch
      )
      : isGateTicketResponseStatus(
        response.Ticket.Status
      )
        ? response.Ticket.Status
        : VEHICLE_OPERATION_STATUS.WAITING_UNLOAD;

  return {
    ...response,

    Result:
      "REPLAYED",

    Ticket: {
      ...response.Ticket,
      Status: status,
    },
  };
}

// Function สร้าง Gate response จาก VehicleJob
async function buildGateVehicleJobResponse(
  vehicleJobId: number,
  input: GateVehicleJobBody,
  result: GateVehicleJobResult,
  pricing: LaborJobPricing,
  connection?: Parameters<
    typeof workerApplicationRepository.getVehicleJobDetail
  >[1]
): Promise<GateVehicleJobResponse> {
  const detail =
    await workerApplicationRepository.getVehicleJobDetail(
      vehicleJobId,
      connection
    );

  if (!detail) {
    throw new ApiError(
      404,
      "VEHICLE_JOB_NOT_FOUND",
      "Vehicle job not found."
    );
  }

  return buildPublicGateVehicleJobResponse(
    detail,
    input,
    result,
    pricing
  );
}

// Function สร้าง VehicleJob จาก Gate
export async function createVehicleJobFromGate(
  body: unknown
): Promise<GateVehicleJobResponse> {
  const input =
    parseWithSchema<GateVehicleJobBody>(
      gateVehicleJobBodySchema,
      body
    );

  const gateTransactionRef =
    buildGateTransactionRef(input);

  const existingGateRequest =
    await gateRepository.findGateRequestReplayByRef(
      gateTransactionRef
    );

  // คืน response เดิมเมื่อ Request เดิมถูกส่งซ้ำ
  if (existingGateRequest) {
    if (
      !arePayloadsEqual(
        existingGateRequest.payload_snapshot,
        input
      )
    ) {
      console.warn(
        "Gate request payload mismatch",
        {
          gate_transaction_ref:
            existingGateRequest
              .gate_transaction_ref,

          ticketNo:
            input.TicketNo,
        }
      );

      throw new ApiError(
        409,
        "GATE_TRANSACTION_REF_PAYLOAD_MISMATCH",
        "gate_transaction_ref already exists with a different payload.",
        {
          duplicate_field:
            "gate_transaction_ref",

          gate_transaction_ref:
            existingGateRequest
              .gate_transaction_ref,
        }
      );
    }

    if (
      !existingGateRequest.response_snapshot
    ) {
      throw new ApiError(
        409,
        "GATE_REQUEST_RESPONSE_NOT_READY",
        "Gate request already exists but its response snapshot is not ready.",
        {
          duplicate_field:
            "gate_transaction_ref",

          gate_transaction_ref:
            existingGateRequest
              .gate_transaction_ref,
        }
      );
    }

    console.info(
      "Gate request replayed",
      {
        gate_transaction_ref:
          existingGateRequest
            .gate_transaction_ref,

        ticketNo:
          input.TicketNo,
      }
    );

    return buildGateReplayResponse(
      existingGateRequest.response_snapshot,
      existingGateRequest.payload_snapshot
    );
  }

  // ป้องกัน TicketNo เดิมถูกสร้างซ้ำ
  const existingVehicleJob =
    await gateRepository.findVehicleJobByRef(
      input.TicketNo
    );

  if (existingVehicleJob) {
    throw new ApiError(
      409,
      "GATE_TICKET_ALREADY_EXISTS",
      "TicketNo already exists.",
      {
        ticketNo:
          input.TicketNo,
      }
    );
  }

  const createResult =
    await withTransaction(
      async (transaction) => {
        // คำนวณสินค้า แรงงาน และราคา
        const pricing =
          await calculateLaborJobPricing(
            input,
            transaction
          );

        // สร้างข้อมูลสำหรับบันทึก DB
        const gateInput =
          buildGateCreateInput(
            input,
            gateTransactionRef,
            pricing
          );

        // เติม LINE ID ของแต่ละแผง
        const gateInputWithVendorLineIds =
          await buildGateCreateInputWithVendorLineIds(
            gateInput,
            transaction
          );

        // สร้าง VehicleJob
        const vehicleJob =
          await gateRepository.createVehicleJobFromGate(
            gateInputWithVendorLineIds,
            input as unknown as Prisma.InputJsonValue,
            transaction
          );

        // สร้าง response
        const response =
          await buildGateVehicleJobResponse(
            vehicleJob.id,
            input,
            "CREATED",
            pricing,
            transaction
          );

        // เก็บ response สำหรับ replay
        await gateRepository.updateGateRequestResponse(
          gateTransactionRef,
          response as unknown as Prisma.InputJsonValue,
          transaction
        );

        return {
          dispatch_vehicle_job_id:
            gateInputWithVendorLineIds
              .dispatch_now === true
              ? vehicleJob.id
              : null,

          response,
        };
      }
    );

  const response =
    createResult.response;

  // เรียก Worker เมื่อ Dispatch = true
  if (
    createResult.dispatch_vehicle_job_id !==
    null
  ) {
    try {
      await dispatchReadyWorkers(
        undefined,
        {
          vehicle_job_ids: [
            createResult
              .dispatch_vehicle_job_id,
          ],
        }
      );
    } catch (error) {
      console.error(
        "Gate ticket was created but worker dispatch failed.",
        error
      );
    }
  }

  // แจ้ง Admin ว่ามีงานใหม่
  publishNotification({
    type:
      "VEHICLE_JOB_CREATED",

    title:
      "Vehicle job created",

    message:
      `Vehicle job ${response.Ticket.TicketNo} was created from Gate.`,

    payload: {
      ticketNo:
        response.Ticket.TicketNo,

      gate_transaction_ref:
        gateTransactionRef,

      license_plate:
        response.Ticket.LicensePlate,

      status:
        response.Ticket.Status,

      dispatch_now:
        input.Dispatch === true,
    },

    audience: {
      roles: ["admin"],
    },
  });

  // แจ้ง Vendor ของแต่ละแผง
  await notifyVendorGateTicketCreated(
    response
  );

  return response;
}