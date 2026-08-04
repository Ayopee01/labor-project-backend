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

export type JobPaymentCalculationInput = {
  quantity: number;
  stallRate: Prisma.Decimal;
  laborRate: Prisma.Decimal;
  actualLaborCount: number;
};

export type JobPaymentCalculation = {
  quantity: number;
  stallRate: Prisma.Decimal;
  laborRate: Prisma.Decimal;
  stallFee: Prisma.Decimal;
  laborFee: Prisma.Decimal;
  rawTotalFee: Prisma.Decimal;
  totalFee: Prisma.Decimal;
  roundingAmount: Prisma.Decimal;
  actualLaborCount: number;
  workerRawPayEach: Prisma.Decimal;
  workerPayEach: Prisma.Decimal;
  workerPayRemainderEach: Prisma.Decimal;
  workerPayoutTotal: Prisma.Decimal;
  fundAmount: Prisma.Decimal;
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

// Function calculates stall charge and labor payout using Decimal arithmetic only.
export function calculateJobPayment(
  input: JobPaymentCalculationInput
): JobPaymentCalculation {
  assertPositiveInteger(input.quantity, "INVALID_QUANTITY", "Quantity must be a positive integer.");
  assertPositiveInteger(
    input.actualLaborCount,
    "ACTUAL_LABOR_COUNT_INVALID",
    "Actual labor count must be a positive integer."
  );

  const quantity = new Prisma.Decimal(input.quantity);
  const stallFee = quantity.mul(input.stallRate);
  const laborFee = quantity.mul(input.laborRate);
  const rawTotalFee = stallFee.plus(laborFee);
  const totalFee = rawTotalFee.ceil();
  const roundingAmount = totalFee.minus(rawTotalFee);
  const workerRawPayEach = laborFee.div(input.actualLaborCount);
  const workerPayEach = workerRawPayEach.floor();
  const workerPayRemainderEach = workerRawPayEach.minus(workerPayEach);
  const workerPayoutTotal = workerPayEach.mul(input.actualLaborCount);
  const fundAmount = laborFee.minus(workerPayoutTotal);

  if (
    fundAmount.isNegative() ||
    !workerPayoutTotal.plus(fundAmount).equals(laborFee)
  ) {
    throw new ApiError(
      500,
      "PAYMENT_CALCULATION_INVALID",
      "Labor payment calculation is invalid."
    );
  }

  return {
    quantity: input.quantity,
    stallRate: input.stallRate,
    laborRate: input.laborRate,
    stallFee,
    laborFee,
    rawTotalFee,
    totalFee,
    roundingAmount,
    actualLaborCount: input.actualLaborCount,
    workerRawPayEach,
    workerPayEach,
    workerPayRemainderEach,
    workerPayoutTotal,
    fundAmount,
  };
}
