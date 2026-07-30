import type { NextFunction, Request, Response } from "express";

/* -------------------------------------- Types -------------------------------------- */

// Type plain object used by recursive request/response key conversion.
type PlainObject = Record<string, unknown>;

/* -------------------------------------- Config -------------------------------------- */

// Config explicit PascalCase -> internal key mapping for API fields that cannot be inferred safely.
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
  DebugLinePostback: "debug_line_postback",
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
  WorkSchedules: "work_schedules",
  WorkStartDate: "work_start_date",
};

/* -------------------------------------- Functions -------------------------------------- */

// Function checks for plain JSON objects before recursively transforming keys.
function isPlainObject(value: unknown): value is PlainObject {
  return Object.prototype.toString.call(value) === "[object Object]";
}

// Function lowercases only the first letter for simple PascalCase body keys.
function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

// Function uppercases only the first letter when building PascalCase response keys.
function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Function converts snake_case, kebab-case, spaced, or camelCase keys to PascalCase for API responses.
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

// Function converts public request keys to internal service/repository keys.
function normalizeRequestKey(key: string): string {
  if (requestKeyMap[key]) {
    return requestKeyMap[key];
  }

  if (/^[A-Z]/.test(key)) {
    return lowerFirst(key);
  }

  return key;
}

// Function recursively transforms object keys while preserving arrays, Date, and scalar values.
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

// Function converts request bodies from public API casing to internal casing.
export function normalizeApiRequestPayload(value: unknown): unknown {
  return transformObjectKeys(value, normalizeRequestKey);
}

// Function converts service response payloads to public PascalCase API casing.
export function toPascalCasePayload(value: unknown): unknown {
  return transformObjectKeys(value, toPascalCaseKey);
}

// Function skips casing middleware for Swagger/static upload routes.
function shouldSkipCaseMiddleware(req: Request): boolean {
  return req.path.startsWith("/api-docs") || req.path.startsWith("/uploads");
}

// Function normalizes incoming JSON bodies before routes/services parse validation schemas.
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

// Function wraps res.json so API responses use PascalCase without changing internal DTOs.
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
