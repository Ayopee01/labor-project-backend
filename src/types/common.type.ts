import type { Prisma, PrismaClient } from "@prisma/client";

// Type ส่วน Database connection: ใช้ได้ทั้ง Prisma client ปกติและ transaction client
export type DbConnection = PrismaClient | Prisma.TransactionClient;

// Type ส่วน Transaction: callback ที่รันอยู่ใน Prisma transaction
export type TransactionCallback<T> = (
  transaction: Prisma.TransactionClient
) => Promise<T>;

// Type ส่วน Error middleware: error รูปแบบทั่วไปที่อาจถูกส่งเข้ามา
export interface ErrorLike {
  type?: string;
  statusCode?: number;
  code?: string;
  message?: string;
  details?: unknown;
}

// Type ส่วน Response ของ error middleware
export type ErrorResponse = {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
} & Record<string, unknown>;

// Type ส่วน Response ของ validation error ราย field
export interface ValidationIssueResponse {
  field: string | null;
  message: string;
}

// Type ส่วน Option ของ validation parser
export interface ParseOptions {
  statusCode?: number;
  code?: string;
  message?: string;
}

// Type ส่วน Global cache ของ Prisma client ตอน development
declare global {
  // eslint-disable-next-line no-var
  var prismaClient: PrismaClient | null | undefined;
}
