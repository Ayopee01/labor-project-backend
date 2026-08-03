// Import Library
import type { NextFunction, Request, Response } from "express";
// Import Dependencies
import type { ErrorLike, ErrorResponse } from "../types/shared/common.type";
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function จัดการ not found handler สำหรับ Express middleware
export function notFoundHandler(
  _req: Request,
  _res: Response,
  next: NextFunction
): void {
  next(new ApiError(404, "NOT_FOUND", "Route not found."));
}

// Function ตรวจว่า value เป็น plain object ก่อนแปลง key
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Function ตรวจว่า error like สำหรับ Express middleware
function isErrorLike(error: unknown): error is ErrorLike {
  return Boolean(error && typeof error === "object");
}

// Function แปลงให้เป็นรูปแบบกลาง error สำหรับ Express middleware
function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!isErrorLike(error)) {
    return new ApiError(
      500,
      "INTERNAL_SERVER_ERROR",
      "Unexpected server error."
    );
  }

  if (error.type === "entity.parse.failed") {
    return new ApiError(400, "VALIDATION_ERROR", "Invalid JSON body.");
  }

  if (error.statusCode && error.code && error.message) {
    return new ApiError(
      error.statusCode,
      error.code,
      error.message,
      error.details
    );
  }

  return new ApiError(
    500,
    "INTERNAL_SERVER_ERROR",
    "Unexpected server error."
  );
}

// Function สร้าง error response สำหรับ Express middleware
function buildErrorResponse(error: ApiError): ErrorResponse {
  const response: ErrorResponse = {
    statusCode: error.statusCode,
    code: error.code,
    message: error.message,
  };

  if (!error.details) {
    return response;
  }

  if (isPlainObject(error.details)) {
    Object.assign(response, error.details);
    return response;
  }

  response.details = error.details;
  return response;
}

// Function จัดการ error handler สำหรับ Express middleware
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const normalized = normalizeError(error);
  const response = buildErrorResponse(normalized);

  if (normalized.statusCode >= 500) {
    console.error(error);
  }

  res.status(normalized.statusCode).json(response);
}
