// import Library
import { z, type ZodError, type ZodType } from "zod";
// import
import type { ParseOptions, ValidationIssueResponse } from "../types/common.type";
import ApiError from "../utils/api-error";
import { idSchema, workScheduleInputSchema } from "./schemas";

/* -------------------------------------- Error Helpers -------------------------------------- */

// Function แปลง ZodError เป็น validation_errors ที่ API response ใช้งานได้
function formatZodIssues(error: ZodError): ValidationIssueResponse[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : null,
    message: issue.message,
  }));
}

// Functionสร้าง ApiError มาตรฐานของระบบจาก ZodError และ options ที่ส่งเข้ามา
function createValidationError(error: ZodError, options: ParseOptions = {}): ApiError {
  return new ApiError(
    options.statusCode ?? 400,
    options.code ?? "VALIDATION_ERROR",
    options.message ?? "Invalid request data.",
    {
      validation_errors: formatZodIssues(error),
    }
  );
}

/* -------------------------------------- Parsers -------------------------------------- */

// Function ตรวจ input ด้วย Zod schema แล้วคืน data ที่ถูก parse หรือ throw ApiError ถ้าไม่ผ่าน
export function parseWithSchema<T>(
  schema: ZodType<T>,
  input: unknown,
  options?: ParseOptions
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw createValidationError(result.error, options);
  }

  return result.data;
}

// Function แปลง id จาก route params เป็น number และคืน error message เฉพาะ id
export function parseId(value: unknown): number {
  return parseWithSchema(idSchema, value, {
    code: "VALIDATION_ERROR",
    message: "Invalid id.",
  });
}

// Function ตรวจ work schedule body และคืน INVALID_SHIFT_TIME เมื่อเวลาเริ่ม/เลิกงานผิด format
export function parseWorkScheduleInput(
  input: unknown
): z.infer<typeof workScheduleInputSchema> {
  const result = workScheduleInputSchema.safeParse(input);

  if (!result.success) {
    const hasShiftTimeError = result.error.issues.some((issue) => {
      const field = issue.path[0];

      return (
        (field === "shift_start_time" || field === "shift_end_time") &&
        issue.code === "invalid_format"
      );
    });

    throw createValidationError(result.error, {
      code: hasShiftTimeError ? "INVALID_SHIFT_TIME" : "VALIDATION_ERROR",
      message: hasShiftTimeError
        ? "Shift time must use HH:mm format."
        : "Invalid request data.",
    });
  }

  return result.data;
}

export function parseWorkScheduleInputs(
  input: unknown
): Array<z.infer<typeof workScheduleInputSchema>> {
  const result = z.array(workScheduleInputSchema).min(1).max(2).safeParse(input);

  if (!result.success) {
    const hasShiftTimeError = result.error.issues.some((issue) =>
      issue.path.includes("shift_start_time") || issue.path.includes("shift_end_time")
    );

    throw createValidationError(result.error, {
      code: hasShiftTimeError ? "INVALID_SHIFT_TIME" : "VALIDATION_ERROR",
      message: hasShiftTimeError
        ? "Shift time must use HH:mm format."
        : "Invalid request data.",
    });
  }

  return result.data;
}
