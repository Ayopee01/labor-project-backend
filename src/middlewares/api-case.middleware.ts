import type { NextFunction, Request, Response } from "express";
import type { PlainObject } from "../types/shared/common.type";

/* -------------------------------------- Config -------------------------------------- */

// Config map key แบบ PascalCase เป็น key ภายในสำหรับ field ที่เดาอัตโนมัติแล้วเสี่ยงผิด
const requestKeyMap: Record<string, string> = {
  AccessToken: "access_token",
  AccountId: "account_id",
  ActiveDevice: "active_device",
  AdminCode: "admin_code",
  AcceptedAt: "accepted_at",
  AcceptDeadlineAt: "accept_deadline_at",
  AssignmentStatus: "assignment_status",
  BreakCountLimit: "break_count_limit",
  BreakCountUsed: "break_count_used",
  BreakUntil: "break_until",
  ClientId: "client_id",
  ClientSecret: "client_secret",
  CompletedAt: "completed_at",
  CompletedJobCount: "completed_job_count",
  ConfirmedQuantity: "confirmed_quantity",
  ConfirmationStatus: "confirmation_status",
  CurrentPassword: "current_password",
  DateFrom: "date_from",
  DateTo: "date_to",
  DeviceId: "device_id",
  DeviceName: "device_name",
  DriverQrToken: "driver_qr_token",
  DriverSessionToken: "driver_session_token",
  DriverSessionTtlHours: "driver_session_ttl_hours",
  DuplicateField: "duplicate_field",
  EmployeeCode: "employee_code",
  EndTime: "end_time",
  ExpiresAt: "expires_at",
  ExpiresIn: "expires_in",
  FcmToken: "fcm_token",
  FullName: "full_name",
  GateTransactionRef: "gate_transaction_ref",
  ImageUrl: "image_url",
  LatestActiveAt: "latest_active_at",
  LatestActivityAt: "latest_activity_at",
  LicensePlate: "license_plate",
  LoginChallengeToken: "login_challenge_token",
  MarketCode: "marketCode",
  MarketName: "marketName",
  NewPassword: "new_password",
  OperationStatus: "operation_status",
  PackageCode: "packageCode",
  PackageName: "packageName",
  PermissionLevel: "permission_level",
  ProductCode: "productCode",
  ProductFullCode: "productFullCode",
  ProductCount: "product_count",
  ProductName: "productName",
  QrToken: "qr_token",
  QueuePosition: "queue_position",
  RequeuedWorkerCodes: "requeued_worker_codes",
  RefreshToken: "refresh_token",
  RejectReason: "reject_reason",
  RemainingBreakTime: "remaining_break_time",
  ScanDeadlineAt: "scan_deadline_at",
  ScannedAt: "scanned_at",
  ScanStatus: "scan_status",
  ShirtNumber: "shirt_number",
  ShirtType: "shirt_type",
  ShiftEndTime: "shift_end_time",
  ShiftName: "shift_name",
  ShiftNo: "shift_no",
  ShiftStartTime: "shift_start_time",
  SocketConnected: "socket_connected",
  StartTime: "start_time",
  StatusCode: "statusCode",
  StallCount: "stall_count",
  SubmissionStatus: "submission_status",
  TargetRef: "target_ref",
  TargetType: "target_type",
  TodayJobCount: "today_job_count",
  TokenType: "token_type",
  TimeoutReason: "timeout_reason",
  TotalSeconds: "total_seconds",
  UpdatedAt: "updated_at",
  CreatedAt: "created_at",
  UserId: "user_id",
  VehicleJob: "vehicle_job",
  WorkerAction: "worker_action",
  WorkerAcceptDeadlineSeconds: "worker_accept_deadline_seconds",
  WorkerAcceptTimeoutLimit: "worker_accept_timeout_limit",
  WorkerBreakCountTtlHours: "worker_break_count_ttl_hours",
  WorkerBreakDurationMinutes: "worker_break_duration_minutes",
  WorkerBreakLimit: "worker_break_limit",
  WorkerCode: "worker_code",
  WorkerCodes: "worker_codes",
  WorkerPresenceStaleSeconds: "worker_presence_stale_seconds",
  WorkerQrToken: "worker_qr_token",
  WorkerScanDeadlineMinutes: "worker_scan_deadline_minutes",
  WorkerScanTeamRemainingMinutes: "worker_scan_team_remaining_minutes",
  WorkerScanWarningBeforeMinutes: "worker_scan_warning_before_minutes",
  WorkersRequired: "workers_required",
  CheckedInCount: "checked_in_count",
  VendorConfirmTimeoutHours: "vendor_confirm_timeout_hours",
  VendorReconfirmTimeoutHours: "vendor_reconfirm_timeout_hours",
  WorkDate: "work_date",
  WorkSchedule: "work_schedule",
  WorkStartDate: "work_start_date",
};

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจสอบ plain object ก่อนแปลง key แบบ recursive
function isPlainObject(value: unknown): value is PlainObject {
  return Object.prototype.toString.call(value) === "[object Object]";
}

// Function ลดตัวอักษรแรกเป็นพิมพ์เล็กสำหรับ key PascalCase แบบง่าย
function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

// Function เพิ่มตัวอักษรแรกเป็นพิมพ์ใหญ่ตอนสร้าง key response แบบ PascalCase
function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Function แปลง key แบบ snake_case, kebab-case, เว้นวรรค หรือ camelCase เป็น PascalCase สำหรับ response
export function toPascalCaseKey(key: string): string {
  if (!key.includes("_") && /^[A-Z]/.test(key)) {
    return key;
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => capitalize(part.toLowerCase()))
    .join("");
}

// Function แปลง key จาก public request เป็น key ภายใน service/repository
function normalizeRequestKey(key: string): string {
  if (requestKeyMap[key]) {
    return requestKeyMap[key];
  }

  if (/^[A-Z]/.test(key)) {
    return lowerFirst(key);
  }

  return key;
}

// Function แปลง key ของ object แบบ recursive โดยคง array, Date และ scalar value ไว้
function transformObjectKeys(
  value: unknown,
  keyTransformer: (key: string) => string
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformObjectKeys(item, keyTransformer));
  }

  if (value instanceof Date || !isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      keyTransformer(key),
      transformObjectKeys(entryValue, keyTransformer),
    ])
  );
}

// Function แปลง body จาก casing ของ public API เป็น casing ภายในระบบ
export function normalizeApiRequestPayload(value: unknown): unknown {
  return transformObjectKeys(value, normalizeRequestKey);
}

// Function แปลง response จาก service เป็น PascalCase สำหรับ public API
export function toPascalCasePayload(value: unknown): unknown {
  return transformObjectKeys(value, toPascalCaseKey);
}

// Function ข้าม casing middleware สำหรับ Swagger และ route static upload
function shouldSkipCaseMiddleware(req: Request): boolean {
  return req.path.startsWith("/api-docs") || req.path.startsWith("/uploads");
}

// Function ปรับรูปแบบ JSON body ที่รับเข้ามาก่อน route/service อ่าน schema
export function normalizeApiRequestBody(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const isGateTicketRequest =
    req.method === "POST" && req.path === "/api/gate/tickets";

  if (!isGateTicketRequest && !shouldSkipCaseMiddleware(req) && req.body !== undefined) {
    req.body = normalizeApiRequestPayload(req.body);
  }

  next();
}

// Function ครอบ res.json เพื่อให้ API response เป็น PascalCase โดยไม่เปลี่ยน DTO ภายใน
export function pascalCaseApiResponse(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (shouldSkipCaseMiddleware(req)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => originalJson(toPascalCasePayload(body))) as Response["json"];
  next();
}
