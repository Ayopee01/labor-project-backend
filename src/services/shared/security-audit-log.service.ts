import * as securityAuditLogRepository from "../../repositories/shared/security-audit-log.repository";
import { SECURITY_AUDIT_LOG_RETENTION_DAYS } from "../../config/security-audit-log.config";
import { logger } from "../../utils/logger";

import type { DbConnection } from "../../types/shared/common.type";
import type { SecurityAuditLogWriteInput } from "../../types/shared/security-audit-log.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function เขียน Security Audit event ของ mutation ที่สำเร็จ — ต้องเรียกภายใน transaction เดียวกับ
// การเปลี่ยนข้อมูลจริงเสมอ (ส่ง connection ของ transaction นั้นเข้ามา) ตั้งใจไม่ catch error ที่นี่:
// ถ้าเขียน log ไม่สำเร็จ ต้องการให้ทั้ง transaction rollback ไปด้วย ดีกว่าปล่อยให้เกิด mutation ที่
// สำเร็จแต่ไม่มีหลักฐานใน audit log (ตามข้อกำหนด 27.12 ข้อ 3)
export async function writeSecurityAuditLog(
  input: SecurityAuditLogWriteInput,
  connection: DbConnection
): Promise<void> {
  await securityAuditLogRepository.create(input, connection);
}

// Function เขียน Security Audit event แบบ best-effort สำหรับกรณีที่ไม่มี mutation อื่นให้ผูก
// atomicity ด้วย (เช่น auth_login_failed — request ถูกปฏิเสธ ไม่มีข้อมูลอะไรถูกเปลี่ยน) จึง await
// แต่ catch error เอง กัน DB เขียน log สะดุดแล้วทำให้ response ที่ถูกต้องอยู่แล้ว (เช่น 401) กลาย
// เป็น 500 โดยไม่จำเป็น
export async function writeSecurityAuditLogBestEffort(
  input: SecurityAuditLogWriteInput
): Promise<void> {
  try {
    await securityAuditLogRepository.create(input);
  } catch (error) {
    logger.error("Failed to persist security audit log.", {
      error,
      event_type: input.event_type,
    });
  }
}

// Function เทียบ field ที่ระบุระหว่าง before/after แล้วคืนเฉพาะ field ที่ค่าเปลี่ยนจริง (ไม่ snapshot
// ทั้ง record) ตามข้อกำหนด 27.12/27.13 ข้อ before/after — คืน null เมื่อไม่มี field ไหนเปลี่ยนเลย
// (เช่น update request ที่ไม่ได้ส่ง field ใดมาจริง) เพื่อไม่ให้เขียน event ที่ before === after ทุก field
export function diffChangedFields<T extends object>(
  before: T,
  after: T,
  fields: ReadonlyArray<keyof T & string>
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  let hasChange = false;

  for (const field of fields) {
    if (beforeRecord[field] !== afterRecord[field]) {
      beforeDiff[field] = beforeRecord[field] ?? null;
      afterDiff[field] = afterRecord[field] ?? null;
      hasChange = true;
    }
  }

  return hasChange ? { before: beforeDiff, after: afterDiff } : null;
}

// Function ลบ SecurityAuditLog ที่เก่ากว่า SECURITY_AUDIT_LOG_RETENTION_DAYS วัน — เรียกโดย cleanup
// job รายวัน (ดู queues/security-audit-log-cleanup.ts) ไม่ throw ออกไปเอง เพื่อให้ worker แค่ log
// error แล้วรอรอบถัดไป ไม่ทำให้ process อื่นล้มไปด้วย
export async function runSecurityAuditLogRetentionCleanup(): Promise<number> {
  const cutoff = new Date(
    Date.now() - SECURITY_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const deletedCount = await securityAuditLogRepository.deleteOlderThan(cutoff);

  logger.info("Security audit log retention cleanup completed.", {
    deletedCount,
    cutoff: cutoff.toISOString(),
    retentionDays: SECURITY_AUDIT_LOG_RETENTION_DAYS,
  });

  return deletedCount;
}
