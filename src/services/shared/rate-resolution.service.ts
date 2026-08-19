// Import Library
import { Prisma, type MasterProduct, type MasterRate } from "@prisma/client";

// Import Dependencies
import * as masterDataRepository from "../../repositories/shared/master-data.repository";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";

// Import Utils
import ApiError from "../../utils/api-error";
import { decimalToWeightString } from "../../utils/labor-job-pricing";

/* -------------------------------------- Functions -------------------------------------- */

// Function หา Product + Package จาก master
// ใช้ทั้งตอน Gate สร้าง Ticket และตอน Worker เปลี่ยน PackageCode ระหว่างส่งยอด
export async function findActiveMasterProduct(
  productCode: string,
  packageCode: string,
  connection?: DbConnection
): Promise<MasterProduct> {
  const products =
    await masterDataRepository.findActiveProductsByProductCodeAndPackageCode(
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
export async function findApplicableRate(
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
    await masterDataRepository.findActiveRatesByMarketAndWeight(
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
    await masterDataRepository.findActiveRatesByMarketAndWeight(
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
