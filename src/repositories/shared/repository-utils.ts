// import Library
import { randomBytes } from "crypto";

// import
import { prisma } from "../../db/prisma";

// import Types
import type { DbConnection } from "../../types/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
export function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง id จาก path/body ให้เป็น number ก่อนส่งเข้า Prisma
export function toId(id: number | string): number {
  return Number(id);
}

// Function ตรวจผลลัพธ์หลัง map DTO เพื่อให้ error pattern ของ repository เหมือนกัน
export function requireMapped<T>(
  record: T | null | undefined,
  subject: string,
  action: string
): T {
  if (!record) {
    throw new Error(`${subject} ${action} did not return a record.`);
  }

  return record;
}

// Function สร้าง token แบบสุ่มสำหรับ QR และ session
export function createRandomToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

// Function ตรวจว่า mapper คืนค่า DTO หลังอ่านข้อมูลที่ต้องมี
export function requireDto<TDto>(value: TDto | null, name: string): TDto {
  if (!value) {
    throw new Error(`${name} did not return a record.`);
  }

  return value;
}

// Function สร้างข้อมูลสำหรับ revoke session ให้ใช้ logic เดียวกันทุก repository
export function buildRevokeData(): {
  isActive: false;
  revokedAt: Date;
  updatedAt: Date;
} {
  const revokedAt = new Date();

  return {
    isActive: false,
    revokedAt,
    updatedAt: revokedAt,
  };
}
