/* -------------------------------------- Config -------------------------------------- */

// Config จำนวนวันที่เก็บ security_audit_logs ก่อนถูกลบโดย cleanup job รายวัน (27.12 ข้อ 5 —
// "retention/rate limit ที่เหมาะสม") ตั้งใจไม่ผูกกับระบบ system_settings ที่ Admin แก้ผ่าน UI ได้ตาม
// runtime-settings.service.ts เพราะ RUNTIME_SETTING_KEYS ทุกตัวเป็น required — เพิ่ม key ใหม่ที่นั่น
// จะทำให้ getRuntimeSettings() throw SYSTEM_SETTINGS_NOT_CONFIGURED ทันทีสำหรับทุก deployment ที่ยังไม่
// ได้ seed ค่านี้ ความเสี่ยงไม่คุ้มกับ setting ที่ไม่ต้องเปลี่ยนบ่อย จึงใช้ env var ธรรมดาที่มี default แทน
const DEFAULT_RETENTION_DAYS = 180;

export const SECURITY_AUDIT_LOG_RETENTION_DAYS = (() => {
  const parsed = Number(process.env.SECURITY_AUDIT_LOG_RETENTION_DAYS);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
})();
