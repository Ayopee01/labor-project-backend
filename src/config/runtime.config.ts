/* -------------------------------------- Config -------------------------------------- */

// Config key ของ runtime settings ที่ระบบต้องมีใน DB
export const RUNTIME_SETTING_KEYS = [
  "driver_session_ttl_hours",
  "worker_accept_deadline_seconds",
  "worker_scan_deadline_minutes",
  "worker_break_duration_minutes",
  "worker_break_limit",
  "worker_break_count_ttl_hours",
  "worker_presence_stale_seconds",
] as const;

export type RuntimeSettingKey = (typeof RUNTIME_SETTING_KEYS)[number];
export type RuntimeSettings = Record<RuntimeSettingKey, number>;
