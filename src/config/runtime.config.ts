/* -------------------------------------- Config -------------------------------------- */

// Config key ของ runtime settings ที่ระบบต้องมีใน DB
export const RUNTIME_SETTING_KEYS = [
  "driver_session_ttl_hours",
  "worker_accept_deadline_seconds",
  "worker_accept_timeout_limit",
  "worker_scan_deadline_minutes",
  "worker_scan_warning_before_minutes",
  "worker_scan_team_remaining_minutes",
  "worker_break_duration_minutes",
  "worker_break_limit",
  "worker_break_count_ttl_hours",
  "worker_presence_stale_seconds",
  "vendor_confirm_timeout_hours",
  "vendor_reconfirm_timeout_hours",
] as const;

// Type key ของ runtime setting ที่ระบบรองรับ
export type RuntimeSettingKey = (typeof RUNTIME_SETTING_KEYS)[number];

// Type map ค่า runtime settings เป็น number พร้อมใช้งาน
export type RuntimeSettings = Record<RuntimeSettingKey, number>;
