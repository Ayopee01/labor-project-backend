// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import ApiError from "./api-error";

/* -------------------------------------- Types -------------------------------------- */

export type WorkerRanges = {
  range1To50: number;
  range51To100: number;
  range101To200: number;
  range201To400: number;
  range401To600: number;
  rangeOver600: number;
};

export type MasterProductRange = {
  workerRanges: WorkerRanges;
};

export type WorkerRangeCode =
  | "RANGE_1_TO_50"
  | "RANGE_51_TO_100"
  | "RANGE_101_TO_200"
  | "RANGE_201_TO_400"
  | "RANGE_401_TO_600"
  | "RANGE_OVER_600";

export type WorkerRequirementCalculation = {
  rangeCode: WorkerRangeCode;
  requiredWorkerCount: number;
};

export type ProductStallChargeCalculationInput = {
  quantity: Prisma.Decimal;
  stallRate: Prisma.Decimal;
  laborRate: Prisma.Decimal;
};

export type ProductStallChargeCalculation = {
  quantity: Prisma.Decimal;

  stallRate: Prisma.Decimal;
  laborRate: Prisma.Decimal;
  stallFeeRaw: Prisma.Decimal;// Quantity × PackagePrice
  stallFeeRounded: Prisma.Decimal;// CEIL(stallFeeRaw)
  laborFeeRaw: Prisma.Decimal;// Quantity × PackageRate
  productCharge: Prisma.Decimal;// CEIL(stallFeeRounded + laborFeeRaw)
};

export type ProductWorkerPaymentCalculationInput = {
  laborFeeRaw: Prisma.Decimal;
  actualWorkerCount: number;
};

export type ProductWorkerPaymentCalculation = {
  laborFeeRaw: Prisma.Decimal;
  actualWorkerCount: number;
  rawAmountPerWorker: Prisma.Decimal;  // ค่าแรงเต็ม ÷ Worker
  finalAmountPerWorker: Prisma.Decimal;  // เงินเต็มที่ Worker ได้จริง
  remainderAmountPerWorker: Prisma.Decimal;  // เศษของ Worker 1 คน
  workerPayoutTotal: Prisma.Decimal;  // เงินที่ Worker ทุกคนได้รับจริงรวมกัน
  fundAmount: Prisma.Decimal;  // เศษทั้งหมดของ Product ที่เข้ากองทุน
};

/* -------------------------------------- Config -------------------------------------- */

const WORKER_RANGE_KEYS = [
  "range1To50",
  "range51To100",
  "range101To200",
  "range201To400",
  "range401To600",
  "rangeOver600",
] as const;

/* -------------------------------------- Functions -------------------------------------- */

// Function checks that a JSON value is a plain object before reading master range data.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Function throws a consistent API error for invalid integer inputs.
function assertPositiveInteger(value: number, code: string, message: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, code, message);
  }
}

// Function validates that a Decimal value is finite and greater than zero.
function assertPositiveDecimal(
  value: Prisma.Decimal,
  code: string,
  message: string
): void {
  if (!value.isFinite() || value.lte(0)) {
    throw new ApiError(400, code, message);
  }
}

// Function validates that a Decimal value is finite and not negative.
function assertNonNegativeDecimal(
  value: Prisma.Decimal,
  code: string,
  message: string
): void {
  if (!value.isFinite() || value.isNegative()) {
    throw new ApiError(400, code, message);
  }
}

// Function converts money Decimal values to stable 2-decimal strings for JSON response.
export function decimalToMoneyString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

// Function converts weight Decimal values to stable 2-decimal strings for JSON response.
export function decimalToWeightString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

// Function validates and parses the workerRanges JSON from master_product.
export function parseMasterProductRange(value: Prisma.JsonValue): MasterProductRange {
  if (!isPlainRecord(value)) {
    throw new ApiError(
      409,
      "MASTER_PRODUCT_RANGE_INVALID",
      "Master product range must be an object."
    );
  }

  const workerRanges = value.workerRanges;

  if (!isPlainRecord(workerRanges)) {
    throw new ApiError(
      409,
      "MASTER_PRODUCT_RANGE_INVALID",
      "Master product range.workerRanges must be an object."
    );
  }

  const parsedRanges = {} as WorkerRanges;

  for (const key of WORKER_RANGE_KEYS) {
    const rangeValue: unknown = workerRanges[key];

    if (
      typeof rangeValue !== "number" ||
      !Number.isInteger(rangeValue) ||
      rangeValue < 0
    ) {
      throw new ApiError(
        409,
        "MASTER_PRODUCT_RANGE_INVALID",
        `Master product worker range ${key} must be a non-negative integer.`
      );
    }

    parsedRanges[key] = rangeValue;
  }

  return {
    workerRanges: parsedRanges,
  };
}

// Function calculates required workers from quantity and configured master product ranges.
export function calculateRequiredWorkerCount(
  quantity: number,
  ranges: WorkerRanges
): WorkerRequirementCalculation {
  assertPositiveInteger(quantity, "INVALID_QUANTITY", "Quantity must be a positive integer.");

  const selected =
    quantity <= 50
      ? { rangeCode: "RANGE_1_TO_50" as const, requiredWorkerCount: ranges.range1To50 }
      : quantity <= 100
        ? { rangeCode: "RANGE_51_TO_100" as const, requiredWorkerCount: ranges.range51To100 }
        : quantity <= 200
          ? { rangeCode: "RANGE_101_TO_200" as const, requiredWorkerCount: ranges.range101To200 }
          : quantity <= 400
            ? { rangeCode: "RANGE_201_TO_400" as const, requiredWorkerCount: ranges.range201To400 }
            : quantity <= 600
              ? { rangeCode: "RANGE_401_TO_600" as const, requiredWorkerCount: ranges.range401To600 }
              : { rangeCode: "RANGE_OVER_600" as const, requiredWorkerCount: ranges.rangeOver600 };

  if (selected.requiredWorkerCount <= 0) {
    throw new ApiError(
      409,
      "WORKER_RANGE_NOT_CONFIGURED",
      "Worker range is not configured for this product quantity.",
      {
        range_code: selected.rangeCode,
      }
    );
  }

  return selected;
}

// Function converts master_product packageWeight from Float to Decimal through String.
export function packageWeightToDecimal(packageWeight: number): Prisma.Decimal {
  if (!Number.isFinite(packageWeight) || packageWeight <= 0) {
    throw new ApiError(
      409,
      "INVALID_PACKAGE_WEIGHT",
      "Master product package weight must be greater than zero."
    );
  }

  return new Prisma.Decimal(String(packageWeight));
}

// Function calculates the final stall charge for one product using Method A.
//
// Method A:
// 1. stallFeeRaw     = quantity × stallRate
// 2. stallFeeRounded = CEIL(stallFeeRaw)
// 3. laborFeeRaw     = quantity × laborRate
// 4. productCharge   = CEIL(stallFeeRounded + laborFeeRaw)
//
// Each product must be calculated and rounded independently
// before productCharge values are summed into the booth total.
export function calculateProductStallCharge(
  input: ProductStallChargeCalculationInput
): ProductStallChargeCalculation {
  assertPositiveDecimal(
    input.quantity,
    "INVALID_QUANTITY",
    "Quantity must be greater than zero."
  );

  assertNonNegativeDecimal(
    input.stallRate,
    "INVALID_STALL_RATE",
    "Stall rate must not be negative."
  );

  assertNonNegativeDecimal(
    input.laborRate,
    "INVALID_LABOR_RATE",
    "Labor rate must not be negative."
  );

  const stallFeeRaw =
    input.quantity.mul(input.stallRate);

  // Method A:
  // ปัดส่วนแผงขึ้นก่อน
  const stallFeeRounded =
    stallFeeRaw.ceil();

  // ค่าแรงยังไม่ปัด
  const laborFeeRaw =
    input.quantity.mul(input.laborRate);

  // เอายอดแผงที่ปัดแล้ว + ค่าแรง
  // แล้วปัดขึ้นอีกครั้งเป็นยอด Product สุดท้าย
  const productCharge =
    stallFeeRounded
      .plus(laborFeeRaw)
      .ceil();

  if (
    stallFeeRounded.lt(stallFeeRaw) ||
    productCharge.lt(
      stallFeeRounded.plus(laborFeeRaw)
    )
  ) {
    throw new ApiError(
      500,
      "STALL_PAYMENT_CALCULATION_INVALID",
      "Stall payment calculation is invalid."
    );
  }

  return {
    quantity: input.quantity,

    stallRate: input.stallRate,
    laborRate: input.laborRate,

    stallFeeRaw,
    stallFeeRounded,
    laborFeeRaw,
    productCharge,
  };
}

// Function splits one product's labor fee equally among
// the workers who belong to the booth when the ticket completes.
//
// Worker receives whole baht only.
// The fractional remainder from every worker is retained as fund.
export function calculateProductWorkerPayment(
  input: ProductWorkerPaymentCalculationInput
): ProductWorkerPaymentCalculation {
  assertNonNegativeDecimal(
    input.laborFeeRaw,
    "INVALID_LABOR_FEE",
    "Labor fee must not be negative."
  );

  assertPositiveInteger(
    input.actualWorkerCount,
    "ACTUAL_WORKER_COUNT_INVALID",
    "Actual worker count must be a positive integer."
  );

  // ค่าแรงเต็มของ Product ÷ Worker จริงในแผง
  const rawAmountPerWorker =
    input.laborFeeRaw.div(
      input.actualWorkerCount
    );

  // Worker รับเฉพาะจำนวนบาทเต็ม
  const finalAmountPerWorker =
    rawAmountPerWorker.floor();

  // เศษของ Worker คนนี้
  const remainderAmountPerWorker =
    rawAmountPerWorker.minus(
      finalAmountPerWorker
    );

  // จำนวนเงิน Worker ทุกคนได้รับจริง
  const workerPayoutTotal =
    finalAmountPerWorker.mul(
      input.actualWorkerCount
    );

  // Fund ต้องคำนวณจากก้อนจริง
  //
  // ห้ามใช้:
  // remainderAmountPerWorker × workerCount
  //
  // เพราะเลขหารไม่ลงตัวอาจมีปัญหา precision
  const fundAmount =
    input.laborFeeRaw.minus(
      workerPayoutTotal
    );

  if (
    fundAmount.isNegative() ||
    remainderAmountPerWorker.isNegative() ||
    !workerPayoutTotal
      .plus(fundAmount)
      .equals(input.laborFeeRaw)
  ) {
    throw new ApiError(
      500,
      "WORKER_PAYMENT_CALCULATION_INVALID",
      "Worker payment calculation is invalid."
    );
  }

  return {
    laborFeeRaw:
      input.laborFeeRaw,

    actualWorkerCount:
      input.actualWorkerCount,

    rawAmountPerWorker,
    finalAmountPerWorker,
    remainderAmountPerWorker,

    workerPayoutTotal,
    fundAmount,
  };
}