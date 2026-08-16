// Import Library
import { z } from "zod";
import { ADMIN_PERMISSION_LEVELS, ADMIN_PERMISSIONS } from "../config/permission.config";
import { VEHICLE_OPERATION_STATUS } from "../constants/job-status";
import { ACCOUNT_ROLES } from "../types/admin-workers.type";
import { GATE_CLIENT_STATUSES } from "../types/shared/gate-client.type";
import { WORKER_WORK_STATUS } from "../types/shared/worker-status.type";
import { WORKER_NATIONALITIES, WORKER_SHIRT_TYPES } from "../utils/worker-code";

/* -------------------------------------- Formats -------------------------------------- */

const trimmedString = z.string().trim().min(1, "Required.");

// Format client id ของ Gate ที่ระบบสร้างให้หรือ Admin ระบุเองได้
const gateClientIdString = trimmedString.regex(
  /^[A-Za-z0-9_-]{3,100}$/,
  "Use 3-100 characters: letters, numbers, underscore, or dash."
);

const activeStatusSchema = z.enum(["active", "inactive"]);

const dateString = trimmedString.pipe(
  z.iso.date({ error: "Must use YYYY-MM-DD format." })
);

// Format วันเวลาแบบ ISO 8601 พร้อม timezone สำหรับ TicketCreatedAt จาก Gate
const dateTimeString = trimmedString.pipe(
  z.iso.datetime({ offset: true, error: "Must use ISO 8601 date-time format." })
);

// Format เวลาเฉพาะ HH:mm สำหรับกะประจำวันของ worker
const timeString = trimmedString.pipe(
  z.iso.time({ precision: -1, error: "Must use HH:mm format." })
);

// Format เลขกะมาตรฐานของ worker: 1 = กะเช้า, 2 = กะเย็น
const shiftNoSchema = z.coerce
  .number()
  .int()
  .refine((value) => value === 1 || value === 2, {
    message: "ShiftNo must be 1 or 2.",
  });

// Function แปลง empty string เป็น undefined ก่อน validate optional field
const emptyStringToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

const optionalDateString = z.preprocess(
  emptyStringToUndefined,
  dateString.optional()
);

function countInclusiveCalendarDays(dateFrom: string, dateTo: string): number {
  const startAt = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const endAt = Date.parse(`${dateTo}T00:00:00.000Z`);

  return Math.floor((endAt - startAt) / (24 * 60 * 60 * 1000)) + 1;
}

const optionalTrimmedString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().optional()
);

// Format client id ของ Gate แบบ optional สำหรับ body สร้างใหม่ ถ้าว่างให้ระบบสร้างให้
const optionalGateClientIdString = z.preprocess(
  emptyStringToUndefined,
  gateClientIdString.optional()
);

const defaultActiveStatusSchema = z.preprocess(
  emptyStringToUndefined,
  activeStatusSchema.default("active")
);

const optionalActiveStatusSchema = z.preprocess(
  emptyStringToUndefined,
  activeStatusSchema.optional()
);

// Format สถานะ Gate client จาก payload ของ Admin Settings
const gateClientStatusSchema = z.enum(GATE_CLIENT_STATUSES);

// Format สถานะ Gate client สำหรับ body สร้างใหม่ โดย default เป็น active
const defaultGateClientStatusSchema = z.preprocess(
  emptyStringToUndefined,
  gateClientStatusSchema.default("active")
);

// Format สถานะ Gate client แบบ optional สำหรับ body PATCH
const optionalGateClientStatusSchema = z.preprocess(
  emptyStringToUndefined,
  gateClientStatusSchema.optional()
);

// Format ค่าสัญชาติ worker ที่ใช้สร้างรหัส worker
const workerNationalitySchema = z.enum(WORKER_NATIONALITIES);

// Format ค่าสีเสื้อ worker ที่ใช้สร้างรหัส worker
const workerShirtTypeSchema = z.enum(WORKER_SHIRT_TYPES);

// Format สัญชาติ worker แบบ optional สำหรับ body PATCH/profile update
const optionalWorkerNationalitySchema = z.preprocess(
  emptyStringToUndefined,
  workerNationalitySchema.optional()
);

// Format สีเสื้อ worker แบบ optional สำหรับ body PATCH/profile update
const optionalWorkerShirtTypeSchema = z.preprocess(
  emptyStringToUndefined,
  workerShirtTypeSchema.optional()
);

const optionalLowercaseString = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .optional()
);

// Format platform ของ FCM ที่ Mobile ส่งมาตอน auth หรือ refresh push token
const pushPlatformSchema = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["android", "ios", "web", "unknown"]))
    .optional()
);

const optionalPageNumber = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).optional()
);

const optionalLimitNumber = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).max(100).optional()
);

/* -------------------------------------- Common Schemas -------------------------------------- */

export const idSchema = z.coerce.number().int().positive();

/* -------------------------------------- Auth Schemas -------------------------------------- */

export const loginBodySchema = z.object({
  username: trimmedString,
  password: trimmedString,
  device_id: optionalTrimmedString,
  device_name: optionalTrimmedString,
  fcm_token: optionalTrimmedString,
  platform: pushPlatformSchema,
});

export const confirmForceLoginBodySchema = z.object({
  login_challenge_token: trimmedString,
  device_id: trimmedString,
  device_name: trimmedString,
  fcm_token: optionalTrimmedString,
  platform: pushPlatformSchema,
});

// Schema body สำหรับ Worker Mobile ลงทะเบียนหรือ refresh FCM token นอกขั้นตอน login
export const workerPushTokenBodySchema = z.object({
  fcm_token: trimmedString,
  device_id: optionalTrimmedString,
  platform: pushPlatformSchema,
});

export const refreshBodySchema = z.object({
  refresh_token: trimmedString,
});

export const changeOwnPasswordBodySchema = z.object({
  current_password: trimmedString,
  new_password: trimmedString,
});

/* -------------------------------------- User Schemas -------------------------------------- */

const updateProfileInputSchema = z.object({
  image_url: optionalTrimmedString,
  nationality: optionalWorkerNationalitySchema,
  work_start_date: optionalDateString,
  shirt_type: optionalWorkerShirtTypeSchema,
  shirt_number: optionalTrimmedString,
});

export const createUserBodySchema = z
  .object({
    username: optionalTrimmedString,
    img: optionalTrimmedString,
    image_url: optionalTrimmedString,
    full_name: trimmedString,
    phone: trimmedString,
    nationality: workerNationalitySchema,
    shirt_type: workerShirtTypeSchema,
    shirt_number: trimmedString,
    work_start_date: optionalDateString,
    shift_no: shiftNoSchema,
    status: defaultActiveStatusSchema,
  });

export const updateUserBodySchema = z.object({
  worker_code: optionalTrimmedString,
  image_url: optionalTrimmedString,
  img: optionalTrimmedString,
  full_name: optionalTrimmedString,
  phone: optionalTrimmedString,
  nationality: optionalWorkerNationalitySchema,
  position: optionalTrimmedString,
  shirt_type: optionalWorkerShirtTypeSchema,
  shirt_number: optionalTrimmedString,
  work_start_date: optionalDateString,
  shift_no: z.never("ShiftNo cannot be updated. Send ShiftStartTime and ShiftEndTime instead.").optional(),
  shift_start_time: z.preprocess(emptyStringToUndefined, timeString.optional()),
  shift_end_time: z.preprocess(emptyStringToUndefined, timeString.optional()),
  profile: updateProfileInputSchema.optional(),
  status: optionalActiveStatusSchema,
});

export const resetPasswordBodySchema = z.object({
  new_password: trimmedString,
});

/* -------------------------------------- Job Flow Schemas -------------------------------------- */

// Schema สินค้าแต่ละรายการที่ Gate ส่งมา
const gateVehicleJobProductSchema = z.object({
  ProductCode: trimmedString,
  PackageCode: trimmedString,
  Quantity: z.coerce.number().int().positive(),
});

// Schema แผงและรายการสินค้าที่ Gate ส่งมา
const gateVehicleJobBoothSchema = z
  .object({
    BoothCode: trimmedString,
    Products: z.array(gateVehicleJobProductSchema).min(1),
  })
  .superRefine((input, context) => {
    const productKeys = new Set<string>();

    for (let index = 0; index < input.Products.length; index++) {
      const product = input.Products[index];
      const productKey = `${product.ProductCode}:${product.PackageCode}`;

      if (productKeys.has(productKey)) {
        context.addIssue({
          code: "custom",
          path: ["Products", index],
          message: "ProductCode + PackageCode must not be duplicated in the same booth.",
        });
      }

      productKeys.add(productKey);
    }
  });

// Schema request หลักสำหรับสร้างงานจาก Gate
export const gateVehicleJobBodySchema = z
  .object({
    TicketNo: trimmedString,
    TicketCreatedAt: dateTimeString,

    BoothCount: z.coerce.number().int().positive(),

    MarketCode: trimmedString,

    LicensePlate: trimmedString,
    LicensePlateProvince: trimmedString,
    VehicleTypeCode: trimmedString,
    VehicleTypeName: trimmedString,

    Booths: z.array(gateVehicleJobBoothSchema).min(1),

    Dispatch: z.boolean(),
  })
  .superRefine((input, context) => {
    // ตรวจ BoothCount ให้ตรงกับจำนวน Booth จริง
    if (input.BoothCount !== input.Booths.length) {
      context.addIssue({
        code: "custom",
        path: ["BoothCount"],
        message: "BoothCount must match Booths length.",
      });
    }

    // ตรวจ BoothCode ซ้ำใน Ticket เดียวกัน
    const boothCodes = new Set<string>();

    for (let index = 0; index < input.Booths.length; index++) {
      const booth = input.Booths[index];

      if (boothCodes.has(booth.BoothCode)) {
        context.addIssue({
          code: "custom",
          path: ["Booths", index, "BoothCode"],
          message: "BoothCode must not be duplicated.",
        });
      }

      boothCodes.add(booth.BoothCode);
    }
  });

export const driverQrSessionBodySchema = z.object({
  qr_token: trimmedString,
});

const workerTicketCompleteItemSchema = z.object({
  productCode: trimmedString,
  packageCode: trimmedString,
  confirmed_quantity: z.coerce.number().min(0),
});

export const workerTicketCompleteBodySchema = z.object({
  boothCode: trimmedString,
  items: z.array(workerTicketCompleteItemSchema).min(1),
});

export const workerAssignmentHistoryQuerySchema = z
  .object({
    date: optionalDateString,
    date_from: optionalDateString,
    date_to: optionalDateString,
  })
  .superRefine((input, context) => {
    const hasDate = Boolean(input.date);
    const hasDateFrom = Boolean(input.date_from);
    const hasDateTo = Boolean(input.date_to);

    if (!hasDate && !hasDateFrom && !hasDateTo) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: "date or date_from/date_to is required.",
      });
    }

    if (hasDate && (hasDateFrom || hasDateTo)) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: "date cannot be combined with date_from/date_to.",
      });
    }

    if (hasDateFrom !== hasDateTo) {
      context.addIssue({
        code: "custom",
        path: hasDateFrom ? ["date_to"] : ["date_from"],
        message: "date_from and date_to must be sent together.",
      });
    }

    if (input.date_from && input.date_to) {
      if (input.date_from > input.date_to) {
        context.addIssue({
          code: "custom",
          path: ["date_to"],
          message: "date_to must be greater than or equal to date_from.",
        });
        return;
      }

      if (countInclusiveCalendarDays(input.date_from, input.date_to) > 31) {
        context.addIssue({
          code: "custom",
          path: ["date_to"],
          message: "Date range must not exceed 31 calendar days.",
        });
      }
    }
  });

export const workerEarningsSummaryQuerySchema = z.object({}).strict();

export const adminVehicleJobListQuerySchema = z
  .object({
    date: optionalDateString,
    date_from: optionalDateString,
    date_to: optionalDateString,
    page: optionalPageNumber,
    limit: optionalLimitNumber,
    search: optionalLowercaseString,
    status: optionalTrimmedString,
  })
  .superRefine((input, context) => {
    if (
      input.date_from &&
      input.date_to &&
      input.date_from > input.date_to
    ) {
      context.addIssue({
        code: "custom",
        path: ["date_to"],
        message: "date_to must be greater than or equal to date_from.",
      });
    }
  });

const vehicleOperationStatusValues = [
  VEHICLE_OPERATION_STATUS.UNLOAD_NOW,
  VEHICLE_OPERATION_STATUS.WAITING_UNLOAD,
  VEHICLE_OPERATION_STATUS.WAITING_QUEUE,
  VEHICLE_OPERATION_STATUS.DRIVER_WAITING_QUEUE,
] as const;

export const adminVehicleJobOperationsQuerySchema = z
  .object({
    date: optionalDateString,
    date_from: optionalDateString,
    date_to: optionalDateString,
    page: optionalPageNumber,
    limit: optionalLimitNumber,
    search: optionalLowercaseString,
    operation_status: z.preprocess(
      emptyStringToUndefined,
      z.enum(vehicleOperationStatusValues).optional()
    ),
  })
  .superRefine((input, context) => {
    if (
      input.date_from &&
      input.date_to &&
      input.date_from > input.date_to
    ) {
      context.addIssue({
        code: "custom",
        path: ["date_to"],
        message: "date_to must be greater than or equal to date_from.",
      });
    }
  });

const adminAuditWorkerPerformanceSortByValues = [
  "accept_rate",
  "total_assigned",
  "accepted",
  "accept_timeout",
  "scan_timeout",
  "completed",
  "admin_cancelled",
  "worker_code",
] as const;

export const adminAuditWorkerPerformanceQuerySchema = z
  .object({
    worker_code: optionalTrimmedString,
    date_from: optionalDateString,
    date_to: optionalDateString,
    page: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(1).default(1)
    ),
    limit: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(1).max(100).default(20)
    ),
    sort_by: z.preprocess(
      emptyStringToUndefined,
      z.enum(adminAuditWorkerPerformanceSortByValues).optional()
    ),
    sort_order: z.preprocess(
      emptyStringToUndefined,
      z.enum(["asc", "desc"]).optional()
    ),
  })
  .strict()
  .superRefine((input, context) => {
    if (Boolean(input.date_from) !== Boolean(input.date_to)) {
      context.addIssue({
        code: "custom",
        path: input.date_from ? ["date_to"] : ["date_from"],
        message: "date_from and date_to must be sent together.",
      });
    }

    if (
      input.date_from &&
      input.date_to &&
      input.date_from > input.date_to
    ) {
      context.addIssue({
        code: "custom",
        path: ["date_to"],
        message: "date_to must be greater than or equal to date_from.",
      });
    }
  });

export const adminCancelBodySchema = z.object({
  reason: optionalTrimmedString,
});

export const adminJobCancelBodySchema = z
  .object({
    target_type: z.enum(["vehicle", "market", "stall"]),
    target_ref: trimmedString,
    worker_action: z.enum([WORKER_WORK_STATUS.OPEN_APP, "requeue", "none"]).optional(),
    reason: optionalTrimmedString,
  })
  .superRefine((input, context) => {
    if (input.target_type === "vehicle" && input.worker_action === "none") {
      context.addIssue({
        code: "custom",
        path: ["worker_action"],
        message: "Vehicle job cancellation must use open_app or requeue.",
      });
    }

    if (
      input.target_type !== "vehicle" &&
      input.worker_action !== undefined &&
      input.worker_action !== "none"
    ) {
      context.addIssue({
        code: "custom",
        path: ["worker_action"],
        message: "worker_action is only supported for vehicle job cancellation.",
      });
    }
  });

export const adminAssignWorkersBodySchema = z.object({
  worker_codes: z.array(trimmedString).min(1),
});

export const adminExtendScanDeadlineBodySchema = z.object({
  minutes: z.coerce.number().int().positive().max(240),
  worker_codes: z.array(trimmedString).min(1).optional(),
  reason: optionalTrimmedString,
});

export const adminForceWorkerStatusBodySchema = z.object({
  status: z.enum([
    WORKER_WORK_STATUS.OPEN_APP,
    WORKER_WORK_STATUS.READY,
    WORKER_WORK_STATUS.BREAK,
  ]),
  reason: optionalTrimmedString,
});

/* -------------------------------------- Settings Schemas -------------------------------------- */

export const createGateClientBodySchema = z.object({
  client_id: optionalGateClientIdString,
  name: trimmedString,
  status: defaultGateClientStatusSchema,
});

export const updateGateClientBodySchema = z
  .object({
    name: optionalTrimmedString,
    status: optionalGateClientStatusSchema,
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: "At least one field is required.",
  });

export const updateSystemSettingsBodySchema = z
  .object({
    driver_session_ttl_hours: z.coerce.number().int().positive().max(168).optional(),
    worker_accept_deadline_seconds: z.coerce.number().int().positive().max(600).optional(),
    worker_accept_timeout_limit: z.coerce.number().int().positive().optional(),
    worker_scan_deadline_minutes: z.coerce.number().int().positive().max(240).optional(),
    worker_scan_warning_before_minutes: z.coerce.number().int().positive().max(240).optional(),
    worker_scan_team_remaining_minutes: z.coerce.number().int().positive().max(240).optional(),
    worker_break_duration_minutes: z.coerce.number().int().positive().max(240).optional(),
    worker_break_limit: z.coerce.number().int().min(0).max(20).optional(),
    worker_break_count_ttl_hours: z.coerce.number().int().positive().max(168).optional(),
    worker_presence_stale_seconds: z.coerce.number().int().positive().max(3600).optional(),
    vendor_confirm_timeout_hours: z.coerce.number().int().positive().max(168).optional(),
    vendor_reconfirm_timeout_hours: z.coerce.number().int().positive().max(168).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required.",
  });

export const updateAccountPermissionsBodySchema = z.object({
  permission_level: z.enum(ADMIN_PERMISSION_LEVELS),
  status: optionalActiveStatusSchema,
  permissions: z
    .array(z.enum(ADMIN_PERMISSIONS))
    .default([]),
});

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

export const runtimeSettingsSchema = z.object({
  driver_session_ttl_hours: z.coerce
    .number()
    .int()
    .positive(),
  worker_accept_deadline_seconds: z.coerce
    .number()
    .int()
    .positive(),
  worker_accept_timeout_limit: z.coerce
    .number()
    .int()
    .positive(),
  worker_scan_deadline_minutes: z.coerce
    .number()
    .int()
    .positive(),
  worker_scan_warning_before_minutes: z.coerce
    .number()
    .int()
    .positive(),
  worker_scan_team_remaining_minutes: z.coerce
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
  vendor_confirm_timeout_hours: z.coerce
    .number()
    .int()
    .positive(),
  vendor_reconfirm_timeout_hours: z.coerce
    .number()
    .int()
    .positive(),
});

/* -------------------------------------- Query Schemas -------------------------------------- */

const pageQuerySchema = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).default(1)
);

const limitQuerySchema = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(1).max(100).default(20)
);

export const paginationQuerySchema = z.object({
  page: pageQuerySchema,
  limit: limitQuerySchema,
  search: optionalLowercaseString,
  status: optionalActiveStatusSchema,
});

/* -------------------------------------- Token Schemas -------------------------------------- */

const tokenTimestampsSchema = {
  iat: z.number().optional(),
  exp: z.number().optional(),
};

export const accessTokenPayloadSchema = z.object({
  account_id: z.number().int().positive(),
  role: z.enum(ACCOUNT_ROLES),
  permission_level: optionalTrimmedString.nullable(),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)).optional(),
  session_id: z.number().int().positive(),
  token_type: z.literal("access"),
  ...tokenTimestampsSchema,
});

export const refreshTokenPayloadSchema = z.object({
  account_id: z.number().int().positive(),
  session_id: z.number().int().positive(),
  token_type: z.literal("refresh"),
  ...tokenTimestampsSchema,
});

export const loginChallengeTokenPayloadSchema = z.object({
  account_id: z.number().int().positive(),
  role: z.enum(ACCOUNT_ROLES),
  old_session_id: z.number().int().positive(),
  new_device_id: trimmedString,
  token_type: z.literal("login_challenge"),
  ...tokenTimestampsSchema,
});
