// Import Library
import { createHash } from "crypto";
import { Prisma, type MasterMarket } from "@prisma/client";

// Import Dependencies
import { VEHICLE_OPERATION_STATUS } from "../constants/job-status";
import { withTransaction } from "../db/prisma";
import { enqueueLoggedLineMessage } from "../queues/notification-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import * as gateRepository from "../repositories/gate.repository";
import * as marketJobRepository from "../repositories/shared/market-job.repository";
import { publishNotification } from "./notifications.service";
import * as rateResolutionService from "./shared/rate-resolution.service";

// Import Types
import type { GateOptionsResponse, GateProductOption, GateVehicleJobBody, GateVehicleJobCreateInput, GateVehicleJobResponse, GateVehicleJobResponseStatus, GateVehicleJobResult } from "../types/gate.type";
import type { DbConnection } from "../types/shared/common.type";
import type { LineMessage } from "../types/line.type";
import type { MarketJobDto, VehicleJobDto } from "../types/worker.type";

// Import Validation
import { parseWithSchema } from "../validation/parser";
import { gateVehicleJobBodySchema } from "../validation/schemas";

// Import Utils
import ApiError from "../utils/api-error";
import { calculateRequiredWorkerCount, packageWeightToDecimal, parseMasterProductRange } from "../utils/labor-job-pricing";
import { logger } from "../utils/logger";

// Import Flex Message Builder
import { buildGateTicketCreatedFlexMessage } from "../utils/line-flex-message";

/* -------------------------------------- Types -------------------------------------- */

type LaborProductPreparation = {
  product: {
    id: number;

    productCode: string;
    productFullCode: string;
    productName: string;

    packageCode: string;
    packageName: string;

    quantity: number;
  };

  // จำนวน Worker จาก Master
  // ใช้ Dispatch เท่านั้น
  requiredWorkerCount: number;

  // Rate snapshot ณ ตอน Gate Create
  rateSnapshot: {
    rateId: number;
    sourceRateId: number;

    requestedMarketCode: string;
    appliedMarketCode: string;

    rateSource:
    | "MARKET_RATE"
    | "CENTRAL_RATE";

    packageWeight: Prisma.Decimal;

    weightRangeName: string;
    weightMin: Prisma.Decimal;
    weightMax: Prisma.Decimal;

    stallRate: Prisma.Decimal;
    laborRate: Prisma.Decimal;

    snapshotAt: Date;
  };
};

type LaborBoothPreparation = {
  boothCode: string;
  boothName: string;

  products: LaborProductPreparation[];
};

type LaborJobPreparation = {
  market: {
    marketCode: string;
    marketName: string;
  };

  booths: LaborBoothPreparation[];

  // จำนวน Worker สำหรับ Dispatch
  workerCount: number;
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
    typeof record.TicketNumber !== "string" ||
    typeof record.TicketNo !== "string" ||
    typeof record.TicketCreatedAt !== "string" ||
    typeof record.BoothCount !== "number" ||
    typeof record.MarketCode !== "string" ||
    typeof record.LicensePlate !== "string" ||
    typeof record.LicensePlateProvince !== "string" ||
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

// Function เตรียมข้อมูล Master สำหรับสร้างงานจาก Gate
//
// หน้าที่:
// - Validate Market / Booth
// - Validate Product / Package
// - หา Worker requirement จาก Gate Quantity
// - หา Rate ที่ใช้
// - Snapshot Rate
//
// Function นี้ยังไม่คำนวณเงินจริง
async function prepareLaborJob(
  input: GateVehicleJobBody,
  connection?: DbConnection
): Promise<LaborJobPreparation> {
  const booths: LaborBoothPreparation[] = [];
  const workerCounts: number[] = [];

  let marketName = "";

  // ให้ Product ทุกตัวใน request เดียวกัน
  // ใช้เวลา snapshot เดียวกัน
  const rateSnapshotAt = new Date();

  for (const boothInput of input.Booths) {
    const marketBooth =
      await findActiveMasterMarketBooth(
        input.MarketCode,
        boothInput.BoothCode,
        connection
      );

    if (!marketName) {
      marketName =
        marketBooth.marketName as string;
    }

    const products:
      LaborProductPreparation[] = [];

    for (
      const productInput
      of boothInput.Products
    ) {
      const product =
        await rateResolutionService.findActiveMasterProduct(
          productInput.ProductCode,
          productInput.PackageCode,
          connection
        );

      const parsedRange =
        parseMasterProductRange(
          product.range
        );

      // Gate Quantity ใช้ตรงนี้เท่านั้น
      // เพื่อหา Worker ที่ต้องเรียก
      const workerRequirement =
        calculateRequiredWorkerCount(
          productInput.Quantity,
          parsedRange.workerRanges
        );

      workerCounts.push(
        workerRequirement.requiredWorkerCount
      );

      const packageWeight =
        packageWeightToDecimal(
          product.packageWeight
        );

      // หา Rate ที่ใช้ ณ ตอนสร้างงาน
      const applicableRate =
        await rateResolutionService.findApplicableRate(
          input.MarketCode,
          packageWeight,
          connection
        );

      products.push({
        product: {
          id:
            product.id,

          productCode:
            product.productCode,

          productFullCode:
            product.productFullCode,

          productName:
            product.productName,

          packageCode:
            product.packageCode,

          packageName:
            product.packageName,

          quantity:
            productInput.Quantity,
        },

        requiredWorkerCount:
          workerRequirement
            .requiredWorkerCount,

        rateSnapshot: {
          rateId:
            applicableRate.rate.id,

          sourceRateId:
            applicableRate.rate
              .sourceRateId,

          requestedMarketCode:
            applicableRate
              .requestedMarketCode,

          appliedMarketCode:
            applicableRate
              .appliedMarketCode,

          rateSource:
            applicableRate.rateSource,

          packageWeight,

          weightRangeName:
            applicableRate.rate
              .weightRangeName,

          weightMin:
            applicableRate.rate
              .weightMin,

          weightMax:
            applicableRate.rate
              .weightMax,

          stallRate:
            applicableRate.rate
              .stallRate,

          laborRate:
            applicableRate.rate
              .laborRate,

          snapshotAt:
            rateSnapshotAt,
        },
      });
    }

    booths.push({
      boothCode:
        marketBooth.boothCode,

      boothName:
        marketBooth.boothName,

      products,
    });
  }

  if (workerCounts.length === 0) {
    throw new ApiError(
      409,
      "WORKER_REQUIREMENT_NOT_FOUND",
      "No worker requirement was calculated."
    );
  }

  // Worker requirement ของ Ticket หนึ่งใบ = MAX ของทุก Product ในทุกแผงภายใน Ticket นั้น (ไม่ใช่ SUM
  // แล้ว) เพราะแรงงานเรียกตามจำนวนสินค้าที่ใช้คนมากที่สุดในใบเดียวกัน ไม่ใช่บวกสะสมข้ามแผง — ระดับ
  // TicketNumber (ข้าม Ticket หลายใบ) ยังคง SUM เหมือนเดิม ดู gate.repository.ts createVehicleJobFromGate
  const workerCount = Math.max(...workerCounts);

  return {
    market: {
      marketCode:
        input.MarketCode,

      marketName,
    },

    booths,

    workerCount,
  };
}

// Function สร้าง response ที่คืนให้ Gate
//
// Response นี้เป็นข้อมูล Operation เท่านั้น
// ยังไม่มีเงินจริง
function buildPublicGateVehicleJobResponse(
  vehicleJob: VehicleJobDto,
  marketJob: MarketJobDto,
  input: GateVehicleJobBody,
  result: GateVehicleJobResult,
  preparation: LaborJobPreparation
): GateVehicleJobResponse {
  return {
    Result:
      result,

    TicketNumber:
      vehicleJob.ticket_number,

    Ticket: {
      TicketNo:
        marketJob.ticket_no,

      TicketCreatedAt:
        marketJob.ticket_created_at,

      BoothCount:
        marketJob.booth_count,

      LicensePlate:
        vehicleJob.license_plate,

      LicensePlateProvince:
        vehicleJob.license_plate_province,

      VehicleTypeCode:
        input.VehicleTypeCode,

      VehicleTypeName:
        vehicleJob.vehicle_type,

      Status:
        buildGateTicketResponseStatus(
          input.Dispatch
        ),
    },

    Market: {
      MarketCode:
        preparation.market.marketCode,

      MarketName:
        preparation.market.marketName,
    },

    Booths:
      preparation.booths.map(
        (booth) => ({
          BoothCode:
            booth.boothCode,

          BoothName:
            booth.boothName,

          Products:
            booth.products.map(
              (item) => ({
                ProductCode:
                  item.product
                    .productCode,

                ProductFullCode:
                  item.product
                    .productFullCode,

                ProductName:
                  item.product
                    .productName,

                PackageCode:
                  item.product
                    .packageCode,

                PackageName:
                  item.product
                    .packageName,

                Quantity:
                  item.product.quantity,

                // นี่คือ Master requirement
                // ไม่ใช่จำนวนสำหรับหารเงินจริง
                WorkerCount:
                  item.requiredWorkerCount,
              })
            ),
        })
      ),

    // จำนวน Worker รวมทุก Business Ticket ของ TicketNumber นี้ที่ใช้ Dispatch
    WorkerCount:
      vehicleJob.workers_required,

    Qr: {
      DriverQrToken:
        vehicleJob.driver_qr_token,
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
          ticketNumber:
            response.TicketNumber,

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
//
// Idempotency key มาจาก payload ทั้งก้อน (ไม่ใช่แค่ TicketNumber + TicketNo) เพื่อแยกแยะการส่ง
// TicketNumber+TicketNo เดิมซ้ำจริง (replay) ออกจากคำขอที่เนื้อหาต่างกันแต่บังเอิญใช้ TicketNo ซ้ำ
// หลังถูก Admin ยกเลิกไปแล้ว — กรณีหลังต้องถูกปฏิเสธด้วย GATE_TICKET_ALREADY_EXISTS ไม่ใช่ replay
function buildGateTransactionRef(
  input: GateVehicleJobBody
): string {
  const hash =
    createHash("sha256")
      .update(
        JSON.stringify(
          normalizeJson(input)
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
  preparation: LaborJobPreparation,
  existingMarketJobId?: number
): GateVehicleJobCreateInput {
  return {
    ticketNumber:
      input.TicketNumber,

    license_plate:
      input.LicensePlate,

    license_plate_province:
      input.LicensePlateProvince,

    vehicle_type:
      input.VehicleTypeName,

    dispatch_now:
      input.Dispatch,

    existingMarketJobId,

    markets: [
      {
        ticketNo:
          input.TicketNo,

        ticket_created_at:
          new Date(
            input.TicketCreatedAt
          ),

        booth_count:
          input.BoothCount,

        gate_transaction_ref:
          gateTransactionRef,

        workers_required:
          preparation.workerCount,

        marketCode:
          preparation.market
            .marketCode,

        marketName:
          preparation.market
            .marketName,

        booths:
          preparation.booths.map(
            (booth) => ({
              boothCode:
                booth.boothCode,

              boothName:
                booth.boothName,

              products:
                booth.products.map(
                  (item) => ({
                    productCode:
                      item.product
                        .productCode,

                    productName:
                      item.product
                        .productName,

                    productFullCode:
                      item.product
                        .productFullCode,

                    packageCode:
                      item.product
                        .packageCode,

                    packageName:
                      item.product
                        .packageName,

                    quantity:
                      item.product
                        .quantity,

                    packageWeightSnapshot:
                      item.rateSnapshot
                        .packageWeight
                        .toString(),

                    rateIdSnapshot:
                      item.rateSnapshot
                        .rateId,

                    sourceRateIdSnapshot:
                      item.rateSnapshot
                        .sourceRateId,

                    rateMarketCode:
                      item.rateSnapshot
                        .appliedMarketCode,

                    rateSource:
                      item.rateSnapshot
                        .rateSource,

                    weightRangeName:
                      item.rateSnapshot
                        .weightRangeName,

                    weightMinSnapshot:
                      item.rateSnapshot
                        .weightMin
                        .toString(),

                    weightMaxSnapshot:
                      item.rateSnapshot
                        .weightMax
                        .toString(),

                    stallRateSnapshot:
                      item.rateSnapshot
                        .stallRate
                        .toString(),

                    laborRateSnapshot:
                      item.rateSnapshot
                        .laborRate
                        .toString(),

                    rateSnapshotAt:
                      item.rateSnapshot
                        .snapshotAt,
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

          booths:
            await Promise.all(
              market.booths.map(
                async (booth) => {
                  const vendorLineTargets =
                    await gateRepository.findActiveVendorLineTargetsByStall(
                      market.marketCode,
                      booth.boothCode,
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
                          booth.boothCode,
                      }
                    );
                  }

                  return {
                    ...booth,

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

// TEST HELPER: ใช้สำหรับ Postman / Swagger / Gate integration testing
// Function ดึงตัวเลือก Market / Booth / Product / Package สำหรับช่วยสร้าง Gate request
export async function getGateOptions(
  query: unknown
): Promise<GateOptionsResponse> {
  const rawQuery = query as {
    MarketCode?: unknown;
  };

  const normalizedMarketCode =
    typeof rawQuery.MarketCode === "string"
      ? rawQuery.MarketCode.trim() || undefined
      : undefined;

  const [
    marketRows,
    boothOptions,
    productRows,
  ] = await Promise.all([
    gateRepository.listGateMarketOptions(
      normalizedMarketCode
    ),

    normalizedMarketCode
      ? gateRepository.listGateBoothOptionsByMarketCode(
        normalizedMarketCode
      )
      : Promise.resolve([]),

    normalizedMarketCode
      ? Promise.resolve([])
      : gateRepository.listGateProductPackageOptions(),
  ]);

  // จัด Market
  const Markets = marketRows.flatMap((market) =>
    market.marketName
      ? [
        {
          MarketCode: market.marketCode,
          MarketName: market.marketName,
        },
      ]
      : []
  );

  /*
   * นับ ProductCode + PackageCode ก่อน
   * เพราะ POST /api/gate/tickets จะ Reject
   * ถ้า ProductCode + PackageCode ตรงมากกว่า 1 record
   */
  const pairCounts = new Map<string, number>();

  for (const row of productRows) {
    const key =
      `${row.productCode}:${row.packageCode}`;

    pairCounts.set(
      key,
      (pairCounts.get(key) ?? 0) + 1
    );
  }

  // Group Product -> Packages
  const productMap =
    new Map<string, GateProductOption>();

  for (const row of productRows) {
    const pairKey =
      `${row.productCode}:${row.packageCode}`;

    // ไม่ส่ง Product + Package ที่ ambiguous
    if (pairCounts.get(pairKey) !== 1) {
      continue;
    }

    let product =
      productMap.get(row.productCode);

    if (!product) {
      product = {
        ProductCode: row.productCode,
        ProductName: row.productName,
        Packages: [],
      };

      productMap.set(
        row.productCode,
        product
      );
    }

    product.Packages.push({
      PackageCode: row.packageCode,
      PackageName: row.packageName,
      PackageWeight: row.packageWeight,
    });
  }

  return {
    Markets,
    Booths: boothOptions,
    Products: Array.from(
      productMap.values()
    ),
  };
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
      logger.warn(
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

  // TicketNumber เดิมที่มีอยู่แล้วไม่ได้แปลว่าต้องปฏิเสธ เพราะ TicketNumber เดียวมีหลาย Business
  // Ticket ได้ ถ้า TicketNo นี้มี Ticket ที่ยัง active อยู่จริงภายใต้ TicketNumber เดียวกัน (ด้วย
  // gate_transaction_ref อื่น เพราะ replay เดิมถูกจัดการไปแล้วด้านบน) มี 2 กรณี:
  // - MarketCode ตรงกับ Ticket เดิม -> append แผงชุดนี้เข้า Ticket เดิม (ดู existingMarketJobId ด้านล่าง)
  // - MarketCode ต่างจาก Ticket เดิม -> ปฏิเสธเสมอ (TicketNo ต้องไม่ซ้ำข้ามตลาด) ถ้า Ticket เดิมผิด
  //   ต้องให้ Admin ยกเลิกก่อน (status = CANCELLED) เมื่อยกเลิกแล้ว ticketNo เดิมจะว่างอีกครั้งให้ Gate
  //   สร้างใหม่ได้ทันที (findMarketJobByVehicleAndTicketNo กรอง CANCELLED ออกให้แล้ว)
  const existingVehicleJob =
    await gateRepository.findVehicleJobByRef(
      input.TicketNumber
    );

  let existingMarketJobId: number | undefined;

  if (existingVehicleJob) {
    const existingMarketJob =
      await marketJobRepository.findMarketJobByVehicleAndTicketNo(
        existingVehicleJob.id,
        input.TicketNo
      );

    if (existingMarketJob) {
      if (existingMarketJob.marketCode !== input.MarketCode) {
        throw new ApiError(
          409,
          "GATE_TICKET_ALREADY_EXISTS",
          "TicketNo already exists under this TicketNumber for a different market. Ask an Admin to cancel it first if this Ticket needs to be recreated.",
          {
            ticketNumber:
              input.TicketNumber,

            ticketNo:
              input.TicketNo,
          }
        );
      }

      if (existingMarketJob.worker_roster_locked_at) {
        throw new ApiError(
          409,
          "GATE_TICKET_ROSTER_LOCKED",
          "This Ticket's worker roster is already locked and can no longer accept new booths.",
          {
            ticketNumber:
              input.TicketNumber,

            ticketNo:
              input.TicketNo,
          }
        );
      }

      const existingBoothCodes =
        await gateRepository.findGateTicketBoothCodesByMarketJobId(
          existingMarketJob.id
        );
      const duplicateBoothCode = input.Booths.find((booth) =>
        existingBoothCodes.includes(booth.BoothCode)
      );

      if (duplicateBoothCode) {
        throw new ApiError(
          409,
          "GATE_BOOTH_ALREADY_EXISTS_IN_TICKET",
          `BoothCode ${duplicateBoothCode.BoothCode} already exists in this Ticket.`,
          {
            ticketNumber:
              input.TicketNumber,

            ticketNo:
              input.TicketNo,

            boothCode:
              duplicateBoothCode.BoothCode,
          }
        );
      }

      existingMarketJobId = existingMarketJob.id;
    }
  }

  const createResult =
    await withTransaction(
      async (transaction) => {
        // Resolve Master + Worker requirement
        // และ Snapshot Rate
        //
        // ยังไม่คำนวณเงินจริง
        const preparation =
          await prepareLaborJob(
            input,
            transaction
          );

        // สร้างข้อมูลสำหรับบันทึก DB
        const gateInput =
          buildGateCreateInput(
            input,
            gateTransactionRef,
            preparation,
            existingMarketJobId
          );

        // เติม LINE ID ของแต่ละแผง
        const gateInputWithVendorLineIds =
          await buildGateCreateInputWithVendorLineIds(
            gateInput,
            transaction
          );

        // สร้าง VehicleJob (ถ้ายังไม่มี) และ Business Ticket ใหม่
        const { vehicleJob, marketJob } =
          await gateRepository.createVehicleJobFromGate(
            gateInputWithVendorLineIds,
            input as unknown as Prisma.InputJsonValue,
            transaction
          );

        // สร้าง response จากผลการสร้างโดยตรง ไม่ต้อง reload
        const response =
          buildPublicGateVehicleJobResponse(
            vehicleJob,
            marketJob,
            input,
            "CREATED",
            preparation
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
      logger.error("Gate ticket was created but worker dispatch failed.", {
        error,
      });
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
      ticketNumber:
        response.TicketNumber,

      ticketNo:
        response.Ticket.TicketNo,

      gate_transaction_ref:
        gateTransactionRef,

      license_plate:
        response.Ticket.LicensePlate,

      license_plate_province:
        response.Ticket.LicensePlateProvince,

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
  // await notifyVendorGateTicketCreated(
  //   response
  // );

  // แจ้ง Vendor ของแต่ละแผง
  try {
    await notifyVendorGateTicketCreated(
      response
    );
  } catch (error) {
    logger.error("Gate ticket was created but vendor notification failed.", {
      error,
    });
  }

  return response;
}

