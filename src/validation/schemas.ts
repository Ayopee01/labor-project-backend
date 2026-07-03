// Import library
import { z } from "zod";

/* -------------------------------------- Formats -------------------------------------- */

// Format ข้อความที่ถูก trim และต้องไม่เป็นค่าว่าง ใช้กับ field string ทั่วไป
const trimmedString = z.string().trim().min(1, "Required.");

// Format ค่า Status บัญชีที่ระบบยอมรับ
const activeStatusSchema = z.enum(["active", "inactive"]);

// Format วันที่แบบ YYYY-MM-DD และต้องเป็นวันที่มีอยู่จริง
const dateString = trimmedString.pipe(
  z.iso.date({ error: "Must use YYYY-MM-DD format." })
);

// Format เวลาแบบ HH:mm เท่านั้น ไม่รับวินาทีหรือ millisecond
const timeString = trimmedString.pipe(
  z.iso.time({ precision: -1, error: "Must use HH:mm format." })
);

// Function แปลง empty string จาก query/body ให้เป็น undefined เพื่อให้ optional/default schema ทำงานถูกต้อง
const emptyStringToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

// Format ข้อความ optional ที่ trim ก่อนใช้งาน และมอง empty string เป็น undefined
const optionalTrimmedString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().optional()
);

// Format ข้อความ optional ที่ trim แล้วแปลงเป็น lowercase เหมาะกับ search/filter
const optionalLowercaseString = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .optional()
);

/* -------------------------------------- Common Schemas -------------------------------------- */

// Schema แปลง id เป็น number และตรวจว่าเป็น integer บวก
export const idSchema = z.coerce.number().int().positive();

/* -------------------------------------- Auth Schemas -------------------------------------- */

// Schema body สำหรับเข้าสู่ระบบด้วย username/password และข้อมูลอุปกรณ์
export const loginBodySchema = z.object({
  username: trimmedString,
  password: trimmedString,
  device_id: trimmedString,
  device_name: trimmedString,
});

// Schema body สำหรับยืนยัน force login ด้วย challenge token และอุปกรณ์ใหม่
export const confirmForceLoginBodySchema = z.object({
  login_challenge_token: trimmedString,
  device_id: trimmedString,
  device_name: trimmedString,
});

// Schema body สำหรับขอ access token ใหม่ด้วย refresh token
export const refreshBodySchema = z.object({
  refresh_token: trimmedString,
});

/* -------------------------------------- User Schemas -------------------------------------- */

// Schema ข้อมูล profile ของ worker ที่ผูกกับ user account
export const profileInputSchema = z.object({
  worker_code: trimmedString,
  nationality_code: trimmedString,
  nationality_name: trimmedString,
  work_start_date: dateString,
  phone: trimmedString,
});

// Schema ข้อมูลวันทำงานและช่วงเวลางานของ worker
export const workScheduleInputSchema = z.object({
  work_date: dateString,
  shift_start_time: timeString,
  shift_end_time: timeString,
});

// Schema body สำหรับสร้าง worker พร้อม profile และ schedule เริ่มต้น
export const createUserBodySchema = z.object({
  username: trimmedString,
  password: trimmedString,
  full_name: trimmedString,
  profile: profileInputSchema,
  work_schedule: workScheduleInputSchema.nullish(),
});

// Schema body สำหรับแก้ไขชื่อและ profile ของ worker
export const updateUserBodySchema = z.object({
  full_name: optionalTrimmedString,
  profile: profileInputSchema.optional(),
});

// Schema body สำหรับ reset password ของ worker
export const resetPasswordBodySchema = z.object({
  new_password: trimmedString,
});

// Schema body สำหรับเปลี่ยนสถานะ active/inactive ของ worker
export const updateStatusBodySchema = z.object({
  status: activeStatusSchema,
});

/* -------------------------------------- Query Schemas -------------------------------------- */

// Schema query page แบบ optional ถ้าไม่ส่งมาจะใช้ default เป็น 1
const pageQuerySchema = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).default(1)
);

// Schema query limit แบบ optional ถ้าไม่ส่งมาจะใช้ default เป็น 20 และไม่เกิน 100
const limitQuerySchema = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).max(100).default(20)
);

// Schema query status แบบ optional ที่รับเฉพาะ active/inactive
const optionalStatusSchema = z.preprocess(
  emptyStringToUndefined,
  activeStatusSchema.optional()
);

// Schema query สำหรับ pagination, search และ status filter
export const paginationQuerySchema = z.object({
  page: pageQuerySchema,
  limit: limitQuerySchema,
  search: optionalLowercaseString,
  status: optionalStatusSchema,
});

/* -------------------------------------- Token Schemas -------------------------------------- */

// Schema Fragment timestamp มาตรฐานที่ JWT library ใส่มาใน payload
const tokenTimestampsSchema = {
  iat: z.number().optional(),
  exp: z.number().optional(),
};

// Schema payload ของ access token สำหรับยืนยันผู้ใช้และ session
export const accessTokenPayloadSchema = z.object({
  account_id: z.number().int().positive(),
  role: trimmedString,
  session_id: z.number().int().positive(),
  token_type: z.literal("access"),
  ...tokenTimestampsSchema,
});

// Schema payload ของ refresh token สำหรับออก token ชุดใหม่
export const refreshTokenPayloadSchema = z.object({
  account_id: z.number().int().positive(),
  session_id: z.number().int().positive(),
  token_type: z.literal("refresh"),
  ...tokenTimestampsSchema,
});

// Schema payload ของ token ที่ใช้ยืนยันการ force login จากอุปกรณ์ใหม่
export const loginChallengeTokenPayloadSchema = z.object({
  account_id: z.number().int().positive(),
  role: trimmedString,
  old_session_id: z.number().int().positive(),
  new_device_id: trimmedString,
  token_type: z.literal("login_challenge"),
  ...tokenTimestampsSchema,
});
