// Import library
import { z } from "zod";
import { ADMIN_PERMISSION_LEVELS, ADMIN_PERMISSIONS } from "../config/permission.config";
import { ACCOUNT_ROLES } from "../types/admin-workers.type";

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

// Format วันที่ optional ที่แปลง empty string เป็น undefined ก่อน validate
const optionalDateString = z.preprocess(
  emptyStringToUndefined,
  dateString.optional()
);

// Format ข้อความ optional ที่ trim ก่อนใช้งาน และมอง empty string เป็น undefined
const optionalTrimmedString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().optional()
);

// Format status ค่า default เป็น active เมื่อไม่ได้ส่งมา
const defaultActiveStatusSchema = z.preprocess(
  emptyStringToUndefined,
  activeStatusSchema.default("active")
);

// Format ค่าสถานะ optional สำหรับ body/query ที่อาจไม่ส่งมา
const optionalActiveStatusSchema = z.preprocess(
  emptyStringToUndefined,
  activeStatusSchema.optional()
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

// Format page แบบ optional จริง ถ้าไม่ส่งจะเป็น undefined เพื่อให้ endpoint เลือกดึงทั้งหมดได้
const optionalPageNumber = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).optional()
);

// Format limit แบบ optional จริง ถ้าไม่ส่งพร้อม page จะให้ service default เป็น 20
const optionalLimitNumber = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).max(100).optional()
);

/* -------------------------------------- Common Schemas -------------------------------------- */

// Schema แปลง id เป็น number และตรวจว่าเป็น integer บวก
export const idSchema = z.coerce.number().int().positive();

/* -------------------------------------- Auth Schemas -------------------------------------- */

// Schema body สำหรับเข้าสู่ระบบด้วย username/password และข้อมูลอุปกรณ์
export const loginBodySchema = z.object({
  username: trimmedString,
  password: trimmedString,
  device_id: optionalTrimmedString,
  device_name: optionalTrimmedString,
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
  image_url: optionalTrimmedString,
  nationality: optionalTrimmedString,
  nationality_code: trimmedString,
  nationality_name: trimmedString,
  work_start_date: dateString,
  phone: trimmedString,
  shirt_type: optionalTrimmedString,
  shirt_number: optionalTrimmedString,
});

// Schema ข้อมูล profile แบบ partial สำหรับ PATCH worker
const updateProfileInputSchema = z.object({
  worker_code: optionalTrimmedString,
  image_url: optionalTrimmedString,
  nationality: optionalTrimmedString,
  nationality_code: optionalTrimmedString,
  nationality_name: optionalTrimmedString,
  work_start_date: optionalDateString,
  phone: optionalTrimmedString,
  shirt_type: optionalTrimmedString,
  shirt_number: optionalTrimmedString,
});

// Schema ข้อมูลวันทำงานและช่วงเวลางานของ worker
export const workScheduleInputSchema = z.object({
  work_date: optionalDateString,
  shift_start_time: timeString,
  shift_end_time: timeString,
});

// Schema body สำหรับสร้าง worker พร้อม profile และ schedule เริ่มต้น
export const createUserBodySchema = z.object({
  username: optionalTrimmedString,
  password: optionalTrimmedString,
  img: optionalTrimmedString,
  image_url: optionalTrimmedString,
  full_name: trimmedString,
  phone: trimmedString,
  nationality: trimmedString,
  nationality_code: optionalTrimmedString,
  nationality_name: optionalTrimmedString,
  shirt_type: trimmedString,
  shirt_number: trimmedString,
  work_start_date: dateString,
  status: defaultActiveStatusSchema,
  work_schedule: workScheduleInputSchema,
});

// Schema body สำหรับแก้ไขข้อมูล worker ผ่านเส้นหลัก
export const updateUserBodySchema = z.object({
  worker_code: optionalTrimmedString,
  image_url: optionalTrimmedString,
  img: optionalTrimmedString,
  full_name: optionalTrimmedString,
  phone: optionalTrimmedString,
  position: optionalTrimmedString,
  shirt_type: optionalTrimmedString,
  shirt_number: optionalTrimmedString,
  work_start_date: optionalDateString,
  work_date: optionalDateString,
  shift_start_time: z.preprocess(emptyStringToUndefined, timeString.optional()),
  shift_end_time: z.preprocess(emptyStringToUndefined, timeString.optional()),
  profile: updateProfileInputSchema.optional(),
  status: optionalActiveStatusSchema,
  work_schedule: z.unknown().optional(),
});

// Schema body สำหรับ reset password ของ worker
export const resetPasswordBodySchema = z.object({
  new_password: trimmedString,
});

/* -------------------------------------- Job Flow Schemas -------------------------------------- */

// Schema สินค้าในตั๋วที่ Gate ส่งมา
const gateProductInputSchema = z.object({
  product_ref: trimmedString,
  product_type: optionalTrimmedString,
  name: trimmedString,
  quantity: z.coerce.number().positive(),
  unit: trimmedString,
});

// Schema ตั๋วหรือแผงที่ Gate ส่งมา
const gateTicketInputSchema = z.object({
  stall_job_ref: trimmedString,
  ticket_no: optionalTrimmedString,
  stall_no: optionalTrimmedString,
  vendor_name: optionalTrimmedString,
  vendor_line_id: optionalTrimmedString,
  products: z.array(gateProductInputSchema).min(1),
});

// Schema งานตลาดที่ Gate ส่งมา
const gateMarketInputSchema = z.object({
  market_job_ref: trimmedString,
  market_name: trimmedString,
  tickets: z.array(gateTicketInputSchema).min(1),
});

// Schema body สำหรับจำลอง Gate ส่งข้อมูลงานรถเข้าระบบ
export const gateVehicleJobBodySchema = z.object({
  gate_transaction_ref: trimmedString,
  vehicle_job_ref: trimmedString,
  license_plate: trimmedString,
  vehicle_type: optionalTrimmedString,
  workers_required: z.coerce.number().int().positive(),
  dispatch_now: z.boolean().optional(),
  markets: z.array(gateMarketInputSchema).min(1),
});

// Schema body สำหรับเปิด driver session จาก QR
export const driverQrSessionBodySchema = z.object({
  qr_token: trimmedString,
});

// Schema body สำหรับ worker scan QR เข้างาน
export const workerScanBodySchema = z.object({
  qr_token: trimmedString,
});

// Schema item สินค้าที่ worker ส่งยอดยืนยันตอนปิดงาน
const workerTicketCompleteItemSchema = z.object({
  product_ref: trimmedString,
  confirmed_quantity: z.coerce.number().min(0),
});

// Schema body สำหรับ worker ส่งยอดสินค้าที่นับจริงตอนปิดงาน
export const workerTicketCompleteBodySchema = z.object({
  items: z.array(workerTicketCompleteItemSchema).min(1),
});

// Schema query สำหรับดูประวัติงานของ worker ตามวันที่
export const workerAssignmentHistoryQuerySchema = z.object({
  date: dateString,
});

// Schema query สำหรับ Admin ดูรายการงานรถ
export const adminVehicleJobListQuerySchema = z.object({
  date: optionalDateString,
  page: optionalPageNumber,
  limit: optionalLimitNumber,
  search: optionalLowercaseString,
  status: optionalTrimmedString,
});

// Schema body สำหรับ Admin ยกเลิกงาน
export const adminCancelBodySchema = z.object({
  reason: optionalTrimmedString,
});

// Schema body สำหรับ Admin assign worker เข้างานรถแบบระบุรหัสพนักงาน
export const adminAssignWorkersBodySchema = z.object({
  worker_codes: z.array(trimmedString).min(1),
});

// Schema body สำหรับ Admin ต่อเวลา scan deadline แบบทั้งรถหรือราย worker
export const adminExtendScanDeadlineBodySchema = z.object({
  minutes: z.coerce.number().int().positive().max(240),
  worker_codes: z.array(trimmedString).min(1).optional(),
  reason: optionalTrimmedString,
});

// Schema body สำหรับ Admin force status worker
export const adminForceWorkerStatusBodySchema = z.object({
  status: z.enum(["ready", "waiting", "offline", "break"]),
  reason: optionalTrimmedString,
});

/* -------------------------------------- Settings Schemas -------------------------------------- */

// Schema body สำหรับ Admin แก้ runtime settings ของระบบ
export const updateSystemSettingsBodySchema = z
  .object({
    driver_session_ttl_hours: z.coerce.number().int().positive().max(168).optional(),
    worker_accept_deadline_seconds: z.coerce.number().int().positive().max(600).optional(),
    worker_scan_deadline_minutes: z.coerce.number().int().positive().max(240).optional(),
    worker_break_duration_minutes: z.coerce.number().int().positive().max(240).optional(),
    worker_break_limit: z.coerce.number().int().min(0).max(20).optional(),
    worker_break_count_ttl_hours: z.coerce.number().int().positive().max(168).optional(),
    worker_presence_stale_seconds: z.coerce.number().int().positive().max(3600).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required.",
  });

// Schema body สำหรับ Admin แก้ permissions ของ admin account
export const updateAccountPermissionsBodySchema = z.object({
  permission_level: z.enum(ADMIN_PERMISSION_LEVELS),
  permissions: z
    .array(z.enum(ADMIN_PERMISSIONS))
    .default([]),
});

// Schema body สำหรับ Admin สร้าง admin account ใหม่พร้อมกำหนด permission level และ permissions เริ่มต้น
export const createAdminAccountBodySchema = z.object({
  username: trimmedString,
  password: trimmedString,
  full_name: trimmedString,
  position: optionalTrimmedString,
  email: optionalTrimmedString,
  phone: optionalTrimmedString,
  status: defaultActiveStatusSchema,
  permission_level: z.enum(ADMIN_PERMISSION_LEVELS),
  permissions: z
    .array(z.enum(ADMIN_PERMISSIONS))
    .default([]),
});

// Schema runtime settings หลังอ่านค่าจาก DB และแปลงเป็น number พร้อมใช้งาน
export const runtimeSettingsSchema = z.object({
  driver_session_ttl_hours: z.coerce
    .number()
    .int()
    .positive(),
  worker_accept_deadline_seconds: z.coerce
    .number()
    .int()
    .positive(),
  worker_scan_deadline_minutes: z.coerce
    .number()
    .int()
    .positive(),
  worker_break_duration_minutes: z.coerce
    .number()
    .int()
    .positive(),
  worker_break_limit: z.coerce
    .number()
    .int()
    .min(0),
  worker_break_count_ttl_hours: z.coerce
    .number()
    .int()
    .positive(),
  worker_presence_stale_seconds: z.coerce
    .number()
    .int()
    .positive(),
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

// Schema query สำหรับ pagination, search และ status filter
export const paginationQuerySchema = z.object({
  page: pageQuerySchema,
  limit: limitQuerySchema,
  search: optionalLowercaseString,
  status: optionalActiveStatusSchema,
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
  role: z.enum(ACCOUNT_ROLES),
  permission_level: optionalTrimmedString.nullable(),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)).optional(),
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
  role: z.enum(ACCOUNT_ROLES),
  old_session_id: z.number().int().positive(),
  new_device_id: trimmedString,
  token_type: z.literal("login_challenge"),
  ...tokenTimestampsSchema,
});
