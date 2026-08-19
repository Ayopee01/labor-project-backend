// Import Library
import { Prisma, type MasterProduct, type MasterRate } from "@prisma/client";

// Import Dependencies
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา master_product ที่ยังใช้งานอยู่จาก productCode + packageCode
// ใช้ทั้งตอน Gate สร้าง Ticket และตอน Worker เปลี่ยน PackageCode ระหว่างส่งยอด
export async function findActiveProductsByProductCodeAndPackageCode(
  productCode: string,
  packageCode: string,
  connection?: DbConnection
): Promise<MasterProduct[]> {
  const db = client(connection);

  return db.masterProduct.findMany({
    where: {
      productCode,
      packageCode,
      status: "ACTIVE",
    },
    orderBy: {
      id: "asc",
    },
  });
}

// Function ค้นหา master_rate ที่ตรง market และช่วงน้ำหนักที่ยังใช้งานอยู่
export async function findActiveRatesByMarketAndWeight(
  marketCode: string,
  packageWeight: Prisma.Decimal,
  connection?: DbConnection
): Promise<MasterRate[]> {
  const db = client(connection);

  return db.masterRate.findMany({
    where: {
      marketCode,
      status: 1,
      weightMin: {
        lt: packageWeight,
      },
      weightMax: {
        gte: packageWeight,
      },
    },
    orderBy: {
      id: "asc",
    },
  });
}

// Function ค้นหาแพ็กเกจที่ยังใช้งานอยู่ทั้งหมดของ productCode เดียว
// ใช้โดย Worker ตอนเลือก PackageCode ใหม่ให้ Product เดิมในแผงที่กำลังส่งยอด
export async function findActiveMasterProductPackagesByProductCode(
  productCode: string,
  connection?: DbConnection
) {
  const db = client(connection);

  return db.masterProduct.findMany({
    where: {
      productCode,
      status: "ACTIVE",
    },
    select: {
      productCode: true,
      productName: true,
      packageCode: true,
      packageName: true,
      packageWeight: true,
    },
    orderBy: {
      packageCode: "asc",
    },
  });
}
