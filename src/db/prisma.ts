import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { TransactionCallback } from "../types/common.type";

dotenv.config({ quiet: true });

// Function เช็ค DATABASE_URL จาก .env
function getDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be configured before using Prisma.");
  }

  return process.env.DATABASE_URL;
}

// Function สร้าง PrismaClient ใหม่
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });

  return new PrismaClient({
    adapter,
    log:
      process.env.PRISMA_QUERY_LOG === "true"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });
}

// Function ดึง PrismaClient จาก global หรือสร้างใหม่ถ้าไม่มี
export function getPrisma(): PrismaClient {
  if (!global.prismaClient) {
    global.prismaClient = createPrismaClient();
  }

  return global.prismaClient;
}

// Proxy สำหรับ PrismaClient เพื่อให้สามารถเรียกใช้ได้เหมือน PrismaClient ปกติ
export const prisma = new Proxy({} as PrismaClient, {
  get(target, property, receiver) {
    return Reflect.get(getPrisma(), property, receiver ?? target);
  },
});

// Function สำหรับทำ Transaction โดยใช้ PrismaClient
export async function withTransaction<T>(
  callback: TransactionCallback<T>
): Promise<T> {
  return getPrisma().$transaction(callback);
}

// Function สำหรับปิด PrismaClient และตัดการเชื่อมต่อกับฐานข้อมูล
export async function closePrisma(): Promise<void> {
  if (!global.prismaClient) {
    return;
  }

  await global.prismaClient.$disconnect();
  global.prismaClient = null;
}
