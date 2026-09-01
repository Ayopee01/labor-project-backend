// Import Dependencies
import * as mobileAppVersionRepository from "../../repositories/shared/mobile-app-version.repository";
import { sendWorkerPushNotificationToAllActive } from "./worker-push.service";
import { removeMobileAppForceUpdateNotification, removeMobileAppReleaseNotification, scheduleMobileAppForceUpdateNotification, scheduleMobileAppReleaseNotification } from "../../queues/worker-queue";
import { diffChangedFields, writeSecurityAuditLogBestEffort } from "./security-audit-log.service";
import { SECURITY_AUDIT_EVENT_TYPE, SECURITY_AUDIT_OUTCOME } from "../../types/shared/security-audit-log.type";

// Import Types
import type { MobileAppVersionCreateInput, MobileAppVersionDto, MobileAppVersionStatus, MobileAppVersionUpdateInput } from "../../types/shared/mobile-app-version.type";
import type { SecurityAuditRequestContext } from "../../types/shared/security-audit-log.type";

const EMPTY_SECURITY_AUDIT_CONTEXT: SecurityAuditRequestContext = {
  ip_address: null,
  user_agent: null,
  request_id: null,
};

// Type actor snapshot ที่ caller (admin-settings.service.ts) resolve มาให้แล้ว — ไฟล์นี้ไม่มี
// accountRepository ของตัวเองและตั้งใจไม่เพิ่ม เพื่อไม่ให้ shared service ผูกกับ Account model โดยตรง
export interface SecurityAuditActorSnapshot {
  actor_account_id: number | null;
  username: string | null;
  full_name: string | null;
}

const EMPTY_ACTOR_SNAPSHOT: SecurityAuditActorSnapshot = {
  actor_account_id: null,
  username: null,
  full_name: null,
};

// Import Validation
import { parseId, parseWithSchema } from "../../validation/parser";
import { createMobileAppVersionBodySchema, mobileAppVersionCheckQuerySchema, updateMobileAppVersionBodySchema } from "../../validation/schemas";

// Import Utils
import ApiError from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { formatBangkokDisplayDateTime } from "../../utils/time";

/* -------------------------------------- Types -------------------------------------- */

export interface AdminMobileAppVersionSummary extends MobileAppVersionDto {
  status: MobileAppVersionStatus;
}

export interface AdminMobileAppVersionOverviewResponse {
  current: AdminMobileAppVersionSummary | null;
  scheduled: AdminMobileAppVersionSummary | null;
  history: AdminMobileAppVersionSummary[];
}

export type MobileAppVersionCheckStatus =
  | "UP_TO_DATE"
  | "UPDATE_AVAILABLE"
  | "UPDATE_REQUIRED"
  | "NO_VERSION_CONFIGURED";

export interface MobileAppVersionCheckResponse {
  status: MobileAppVersionCheckStatus;
  update_available: boolean;
  force_update: boolean;
  can_skip: boolean;
  latest: {
    version: string;
    build_number: number;
    download_url: string | null;
  } | null;
  policy: {
    force_update_at: string | null;
  } | null;
  release_message: {
    message: string | null;
    release_notes: string | null;
  } | null;
}

/* -------------------------------------- Functions -------------------------------------- */

// Function หาเวลาที่ Version หนึ่งเริ่มมีผลใช้งานจริง — ถ้ามี ForceUpdateAt ใช้ค่านั้น, ถ้าไม่มี
// (ไม่บังคับ) ถือว่ามีผลทันทีตั้งแต่ตอนสร้าง (CreatedAt) — ไม่เกี่ยวกับ Release/Force-Update
// Notification เลย (ดูหัวข้อ Notification ด้านล่างสำหรับเรื่องแจ้งเตือนแยกต่างหาก)
function resolveActivationTime(version: MobileAppVersionDto): number {
  const base = version.force_update_at ?? version.created_at;

  return new Date(base).getTime();
}

// Function กลาง หา Effective Version ณ เวลาหนึ่ง (Single Source of Truth ของ Admin GET, Mobile
// Version Check, และ FCM Worker — ห้าม duplicate logic นี้ที่จุดอื่น)
//
// Concept: หา Version ที่ถึงเวลาใช้งานแล้ว (ActivationTime <= now) แล้วเลือกตัวที่ BuildNumber
// สูงสุดในกลุ่มนั้น — Version ที่ ActivationTime ยังไม่ถึง (Scheduled) ต้องไม่ถูกเลือกเด็ดขาด
// Activation ไม่พึ่ง BullMQ เลย เป็นการเทียบเวลา server สดๆ ทุกครั้งที่เรียกฟังก์ชันนี้
function resolveEffectiveMobileAppVersion(
  versions: MobileAppVersionDto[],
  now: Date,
): MobileAppVersionDto | null {
  const nowMs = now.getTime();
  const activated = versions.filter((version) => resolveActivationTime(version) <= nowMs);

  if (activated.length === 0) {
    return null;
  }

  return activated.reduce((best, version) =>
    version.build_number > best.build_number ? version : best,
  );
}

// Function จัดกลุ่ม Version ทั้งหมดเป็น current/scheduled/history ตามเวลาปัจจุบัน — derive ล้วนๆ
// ไม่มี status column เพราะเวลาผ่านไปแล้วไม่มีใครมา sync จะทำให้ status ค้างผิดได้
function classifyMobileAppVersions(
  versions: MobileAppVersionDto[],
  now: Date,
): {
  current: MobileAppVersionDto | null;
  scheduled: MobileAppVersionDto | null;
  history: MobileAppVersionDto[];
} {
  const current = resolveEffectiveMobileAppVersion(versions, now);
  const nowMs = now.getTime();
  const notActivated = versions.filter((version) => resolveActivationTime(version) > nowMs);
  // Scheduled ที่แสดงบนบอร์ด Admin คือตัวที่ใกล้ถึงเวลาที่สุด (Version ถัดไปที่จะมีผล)
  const scheduled =
    notActivated.length > 0
      ? notActivated.reduce((soonest, version) =>
          resolveActivationTime(version) < resolveActivationTime(soonest) ? version : soonest,
        )
      : null;
  const history = versions
    .filter((version) => version.id !== current?.id && version.id !== scheduled?.id)
    .sort((left, right) => right.build_number - left.build_number);

  return { current, scheduled, history };
}

function resolveMobileAppVersionStatus(
  versionId: number,
  classified: ReturnType<typeof classifyMobileAppVersions>,
): MobileAppVersionStatus {
  if (classified.current?.id === versionId) {
    return "current";
  }

  if (classified.scheduled?.id === versionId) {
    return "scheduled";
  }

  return "history";
}

function toAdminSummary(
  version: MobileAppVersionDto,
  status: MobileAppVersionStatus,
): AdminMobileAppVersionSummary {
  return {
    ...version,
    status,
  };
}

/* -------------------------------------- Notification Shared Helpers -------------------------------------- */

// Function สร้าง params วันที่/เวลาแบบไทย (Asia/Bangkok) ของ ForceUpdateAt ไว้ใส่ใน Release
// Notification (แจ้งล่วงหน้าว่าจะเริ่มบังคับเมื่อไหร่) — ถ้าไม่มี ForceUpdateAt คืน object ว่าง
function buildForceUpdateDisplayParams(
  forceUpdateAt: string | null,
): { force_update_date?: string; force_update_time?: string } {
  if (!forceUpdateAt) {
    return {};
  }

  const display = formatBangkokDisplayDateTime(forceUpdateAt);
  const [datePart, timePart] = display.split(" ");

  return {
    force_update_date: datePart,
    force_update_time: timePart?.slice(0, 5),
  };
}

/* -------------------------------------- Release Notification (แจ้งเตือนล่วงหน้า) -------------------------------------- */

// Function ประกอบและส่ง FCM Release Notification (แจ้งล่วงหน้าว่ามี Version ใหม่) — Title/Message
// หลักมาจาก Pattern มาตรฐานของระบบผ่าน notification-localization (แปลตามภาษาของแต่ละ Worker) แล้ว
// ต่อท้ายด้วย ReleaseMessage ที่ Admin พิมพ์เอง (free text ไม่ผ่าน localization)
async function sendReleaseNotificationFcm(version: MobileAppVersionDto): Promise<void> {
  const timingParams = buildForceUpdateDisplayParams(version.force_update_at);

  try {
    await sendWorkerPushNotificationToAllActive({
      type: "APP_VERSION_UPDATE",
      notification_params: {
        version: version.version,
        ...timingParams,
      },
      fallbackTitle: "New app version available",
      fallbackMessage: timingParams.force_update_date
        ? `Version ${version.version} is ready to update, and will be required starting ${timingParams.force_update_date} at ${timingParams.force_update_time}.`
        : `Version ${version.version} is ready to update.`,
      appendMessage: version.release_message,
      payload: {
        version: version.version,
        build_number: String(version.build_number),
        action: "CHECK_APP_VERSION",
      },
    });
  } catch (error) {
    logger.error("Failed to send mobile app version release FCM notification.", { error });
  }
}

// Function ส่ง Release Notification "ทันที" — claim ReleaseNotificationSentAt แบบ atomic ก่อนส่ง
// จริงเสมอ กัน race ที่มีมากกว่าหนึ่งจุดพยายามส่งพร้อมกัน ถ้า claim ไม่สำเร็จ (คนอื่นส่งไปแล้ว) จะ
// ไม่ส่งซ้ำ
async function sendReleaseNotificationNow(
  version: MobileAppVersionDto,
): Promise<MobileAppVersionDto> {
  const claimed = await mobileAppVersionRepository.claimReleaseNotificationSent(version.id);

  if (claimed) {
    await sendReleaseNotificationFcm(version);
  }

  return (
    (await mobileAppVersionRepository.findMobileAppVersionById(version.id)) ?? version
  );
}

// Function sync สถานะ Release Notification ให้ตรงกับ ReleaseNotificationAt ปัจจุบันของ Version —
// ลบ delayed job เดิมเสมอก่อน แล้วค่อยตัดสินใหม่: ReleaseNotificationAt เป็น null ให้ส่งทันที,
// มีค่าให้ schedule ใหม่ตามเวลานั้น ไม่ทำอะไรเลยถ้าส่งไปแล้ว (ReleaseNotificationSentAt ไม่ null)
async function syncReleaseNotification(
  version: MobileAppVersionDto,
): Promise<MobileAppVersionDto> {
  await removeMobileAppReleaseNotification(version.id);

  if (version.release_notification_sent_at) {
    return version;
  }

  if (!version.release_notification_at) {
    return sendReleaseNotificationNow(version);
  }

  const delayMs = Math.max(
    0,
    new Date(version.release_notification_at).getTime() - Date.now(),
  );

  await scheduleMobileAppReleaseNotification(version.id, delayMs);

  return version;
}

// Function ที่ BullMQ delayed job เรียกตอนถึง ReleaseNotificationAt — ห้ามเชื่อ payload ของ job
// เกินกว่า id เพราะ Admin อาจ PATCH เปลี่ยน/ยกเลิกไปแล้วก่อนถึงเวลาจริง จึงต้องโหลด record ล่าสุด
// จาก DB มาตรวจซ้ำทุกครั้งก่อนส่งจริง
export async function sendMobileAppReleaseNotification(
  mobileAppVersionId: number,
): Promise<void> {
  const version = await mobileAppVersionRepository.findMobileAppVersionById(
    mobileAppVersionId,
  );

  if (!version || version.release_notification_sent_at) {
    return;
  }

  // ป้องกัน race ที่ 2 PATCH พร้อมกันแย่งกัน schedule ด้วย jobId เดียวกัน (deterministic ต่อ id)
  // จนอีก PATCH ที่ตั้งใจเลื่อนเวลาออกไปหลุดไป (BullMQ เพิกเฉย job ที่ jobId ซ้ำ) — เช็คเวลาจริงซ้ำ
  // จาก DB ก่อนส่งเสมอ ถ้า release_notification_at ล่าสุดยังไม่ถึง (ถูกเลื่อนออกไปทีหลัง) ให้
  // reschedule ใหม่ตามเวลาล่าสุดแทนที่จะส่งเร็วไปตามเวลาเก่าที่ job รอบนี้ถืออยู่
  if (
    version.release_notification_at &&
    new Date(version.release_notification_at).getTime() > Date.now()
  ) {
    await syncReleaseNotification(version);
    return;
  }

  await sendReleaseNotificationNow(version);
}

/* -------------------------------------- Force-Update Notification (บังคับอัปเดตแล้ว) -------------------------------------- */

// Function ประกอบและส่ง FCM บังคับอัปเดต — ข้อความมาตรฐานของระบบล้วนๆ ("ถึงเวลาบังคับอัปเดตแล้ว")
// ไม่ต่อท้ายด้วย ReleaseMessage เพราะไม่ต้องให้ Admin ตั้งค่าอะไรสำหรับแจ้งเตือนนี้
async function sendForceUpdateNotificationFcm(version: MobileAppVersionDto): Promise<void> {
  try {
    await sendWorkerPushNotificationToAllActive({
      type: "APP_VERSION_FORCE_UPDATE",
      notification_params: {
        version: version.version,
      },
      fallbackTitle: "Update is now required",
      fallbackMessage: `A new app version ${version.version} is now available. Please update to continue.`,
      payload: {
        version: version.version,
        build_number: String(version.build_number),
        action: "CHECK_APP_VERSION",
      },
    });
  } catch (error) {
    logger.error("Failed to send mobile app version force-update FCM notification.", { error });
  }
}

// Function ส่ง Force-Update Notification จริง — claim ForceUpdateNotificationSentAt แบบ atomic
// ก่อนส่งเสมอ (คนละ tracker กับ Release Notification เพราะเป็นคนละข้อความคนละเวลากัน)
async function sendForceUpdateNotificationNow(
  version: MobileAppVersionDto,
): Promise<MobileAppVersionDto> {
  const claimed = await mobileAppVersionRepository.claimForceUpdateNotificationSent(
    version.id,
  );

  if (claimed) {
    await sendForceUpdateNotificationFcm(version);
  }

  return (
    (await mobileAppVersionRepository.findMobileAppVersionById(version.id)) ?? version
  );
}

// Function sync สถานะ Force-Update Notification ให้ตรงกับ ForceUpdateAt ปัจจุบัน — ลบ delayed job
// เดิมเสมอก่อน แล้ว schedule ใหม่ตาม ForceUpdateAt ถ้ายังตั้งไว้ (ไม่มี ForceUpdateAt = ไม่บังคับ =
// ไม่ต้องมีแจ้งเตือนนี้เลย) ไม่ทำอะไรถ้าส่งไปแล้ว
async function syncForceUpdateNotification(
  version: MobileAppVersionDto,
): Promise<MobileAppVersionDto> {
  await removeMobileAppForceUpdateNotification(version.id);

  if (version.force_update_notification_sent_at) {
    return version;
  }

  if (!version.force_update_at) {
    return version;
  }

  const delayMs = Math.max(0, new Date(version.force_update_at).getTime() - Date.now());

  await scheduleMobileAppForceUpdateNotification(version.id, delayMs);

  return version;
}

// Function ที่ BullMQ delayed job เรียกตอนถึง ForceUpdateAt — โหลด record ล่าสุดเสมอ (เหตุผล
// เดียวกับ Release Notification: Admin อาจ PATCH เปลี่ยน/ถอด ForceUpdateAt ไปแล้วก่อนถึงเวลาจริง)
// ยิงคู่ขนานกับ Version Activation ซึ่งเกิดจากการเทียบเวลาเองอยู่แล้ว ไม่ได้พึ่ง job นี้
export async function sendMobileAppForceUpdateNotification(
  mobileAppVersionId: number,
): Promise<void> {
  const version = await mobileAppVersionRepository.findMobileAppVersionById(
    mobileAppVersionId,
  );

  if (!version || !version.force_update_at || version.force_update_notification_sent_at) {
    return;
  }

  // ป้องกัน race ชนิดเดียวกับ Release Notification ด้านบน — เช็คเวลาจริงซ้ำจาก DB ก่อนส่งเสมอ
  if (new Date(version.force_update_at).getTime() > Date.now()) {
    await syncForceUpdateNotification(version);
    return;
  }

  await sendForceUpdateNotificationNow(version);
}

/* -------------------------------------- Admin Functions -------------------------------------- */

// Function ดึง Current/Scheduled/History ทั้งหมดสำหรับหน้า Admin Settings > Mobile Application
export async function getAdminMobileAppVersionOverview(): Promise<AdminMobileAppVersionOverviewResponse> {
  const versions = await mobileAppVersionRepository.listMobileAppVersions();
  const classified = classifyMobileAppVersions(versions, new Date());

  return {
    current: classified.current ? toAdminSummary(classified.current, "current") : null,
    scheduled: classified.scheduled ? toAdminSummary(classified.scheduled, "scheduled") : null,
    history: classified.history.map((version) => toAdminSummary(version, "history")),
  };
}

// Function สร้าง Mobile App Version ใหม่ — ถ้ามี ForceUpdateAt ในอนาคต จะเป็น Scheduled ทันที ไม่
// กระทบ Worker จนกว่าจะถึงเวลา (ไม่มี Publish endpoint แยก) Release/Force-Update Notification เป็น
// คนละเรื่องกับการ Activate Version โดยสิ้นเชิง ไม่ทำให้ Version Active เร็วขึ้นเลย
export async function createMobileAppVersion(
  body: unknown,
  actorId: number | null,
  actorSnapshot: SecurityAuditActorSnapshot = EMPTY_ACTOR_SNAPSHOT,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT,
): Promise<AdminMobileAppVersionSummary> {
  const input = parseWithSchema(createMobileAppVersionBodySchema, body);
  const conflict = await mobileAppVersionRepository.findMobileAppVersionByBuildNumber(
    input.build_number,
  );

  if (conflict) {
    throw new ApiError(
      409,
      "BUILD_NUMBER_ALREADY_EXISTS",
      "BuildNumber already exists.",
    );
  }

  const createInput: MobileAppVersionCreateInput = {
    version: input.version,
    build_number: input.build_number,
    release_at: input.release_at ?? null,
    android_download_url: input.android_download_url ?? null,
    ios_download_url: input.ios_download_url ?? null,
    force_update_at: input.force_update_at ?? null,
    release_notification_at: input.release_notification_at ?? null,
    release_message: input.release_message ?? null,
    release_notes: input.release_notes ?? null,
    created_by: actorId,
    updated_by: actorId,
  };
  const created = await mobileAppVersionRepository.createMobileAppVersion(createInput);

  // Best-effort เหมือน sync notification ด้านล่าง — flow นี้ไม่มี transaction ห่ออยู่แล้วแต่เดิม
  // (create + sync notification เป็นคนละ statement กันมาตั้งแต่แรก) จึงไม่ยกระดับความเข้มงวดของ
  // audit write ให้เกินกว่า mutation เดิมที่มันกำกับอยู่
  void writeSecurityAuditLogBestEffort({
    event_type: SECURITY_AUDIT_EVENT_TYPE.MOBILE_APP_VERSION_CREATED,
    outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
    actor_type: "admin",
    actor_account_id: actorSnapshot.actor_account_id,
    actor_username: actorSnapshot.username,
    actor_full_name: actorSnapshot.full_name,
    ip_address: context.ip_address,
    user_agent: context.user_agent,
    request_id: context.request_id,
    metadata: {
      targetType: "mobile_app_version",
      targetVersionId: created.id,
      after: {
        version: created.version,
        build_number: created.build_number,
        force_update_at: created.force_update_at,
      },
    },
  });

  await syncReleaseNotification(created);
  await syncForceUpdateNotification(created);

  const afterSync =
    (await mobileAppVersionRepository.findMobileAppVersionById(created.id)) ?? created;
  const versions = await mobileAppVersionRepository.listMobileAppVersions();
  const classified = classifyMobileAppVersions(versions, new Date());

  return toAdminSummary(afterSync, resolveMobileAppVersionStatus(created.id, classified));
}

// Function แก้ไข Mobile App Version — Version/BuildNumber แก้ได้เฉพาะตอนยัง Scheduled เท่านั้น
// (ยังไม่กลายเป็น Current/History) กันไม่ให้ History ผิดเพี้ยนย้อนหลัง
export async function updateMobileAppVersion(
  idParam: unknown,
  body: unknown,
  actorId: number | null,
  actorSnapshot: SecurityAuditActorSnapshot = EMPTY_ACTOR_SNAPSHOT,
  context: SecurityAuditRequestContext = EMPTY_SECURITY_AUDIT_CONTEXT,
): Promise<AdminMobileAppVersionSummary> {
  const id = parseId(idParam);
  const existing = await mobileAppVersionRepository.findMobileAppVersionById(id);

  if (!existing) {
    throw new ApiError(404, "MOBILE_APP_VERSION_NOT_FOUND", "Mobile app version not found.");
  }

  // Snapshot ก่อนแก้ไขจริง กัน repository (โดยเฉพาะ mock ของ test) คืน object เดิมแทน fresh copy
  const existingBeforeUpdate = { ...existing };
  const input = parseWithSchema(updateMobileAppVersionBodySchema, body);
  const versionsBeforeUpdate = await mobileAppVersionRepository.listMobileAppVersions();
  const statusBeforeUpdate = resolveMobileAppVersionStatus(
    id,
    classifyMobileAppVersions(versionsBeforeUpdate, new Date()),
  );
  const changesIdentity =
    input.version !== undefined || input.build_number !== undefined;

  if (changesIdentity && statusBeforeUpdate !== "scheduled") {
    throw new ApiError(
      409,
      "MOBILE_APP_VERSION_LOCKED",
      "Version and BuildNumber can only be changed while the version is still scheduled.",
    );
  }

  // เช็คบน merged state (ของเดิม + ค่าที่ patch มา) เพราะ PATCH อาจแก้แค่ฝั่งใดฝั่งหนึ่งของคู่นี้
  // โดยพึ่งค่าที่ตั้งไว้แล้วจาก request ก่อนหน้า
  const mergedForceUpdateAt =
    input.force_update_at !== undefined ? input.force_update_at : existing.force_update_at;
  const mergedNotificationAt =
    input.release_notification_at !== undefined
      ? input.release_notification_at
      : existing.release_notification_at;

  if (
    mergedNotificationAt &&
    mergedForceUpdateAt &&
    new Date(mergedNotificationAt).getTime() > new Date(mergedForceUpdateAt).getTime()
  ) {
    throw new ApiError(
      400,
      "RELEASE_NOTIFICATION_AT_AFTER_FORCE_UPDATE_AT",
      "release_notification_at must not be later than force_update_at.",
    );
  }

  if (input.build_number !== undefined && input.build_number !== existing.build_number) {
    const conflict = await mobileAppVersionRepository.findMobileAppVersionByBuildNumber(
      input.build_number,
    );

    if (conflict && conflict.id !== id) {
      throw new ApiError(
        409,
        "BUILD_NUMBER_ALREADY_EXISTS",
        "BuildNumber already exists.",
      );
    }
  }

  const updateInput: MobileAppVersionUpdateInput = {
    version: input.version,
    build_number: input.build_number,
    release_at: input.release_at,
    android_download_url: input.android_download_url,
    ios_download_url: input.ios_download_url,
    force_update_at: input.force_update_at,
    release_notification_at: input.release_notification_at,
    release_message: input.release_message,
    release_notes: input.release_notes,
    updated_by: actorId,
  };

  const updated = await mobileAppVersionRepository.updateMobileAppVersion(id, updateInput);

  // ReleaseNotificationAt เปลี่ยน: sync ใหม่ถ้ายังไม่เคยส่ง, หรือแค่เคลียร์ job ค้างถ้าส่งไปแล้ว
  // (ห้ามส่งซ้ำอัตโนมัติ)
  if (input.release_notification_at !== undefined) {
    if (updated.release_notification_sent_at) {
      await removeMobileAppReleaseNotification(id);
    } else {
      await syncReleaseNotification(updated);
    }
  }

  // ForceUpdateAt เปลี่ยน: sync Force-Update Notification ใหม่ด้วยเหตุผลเดียวกัน
  if (input.force_update_at !== undefined) {
    const latest =
      (await mobileAppVersionRepository.findMobileAppVersionById(id)) ?? updated;

    if (latest.force_update_notification_sent_at) {
      await removeMobileAppForceUpdateNotification(id);
    } else {
      await syncForceUpdateNotification(latest);
    }
  }

  const finalVersion =
    (await mobileAppVersionRepository.findMobileAppVersionById(id)) ?? updated;
  const versionsAfterUpdate = await mobileAppVersionRepository.listMobileAppVersions();
  const classifiedAfterUpdate = classifyMobileAppVersions(versionsAfterUpdate, new Date());
  const diff = diffChangedFields(existingBeforeUpdate, finalVersion, [
    "version",
    "build_number",
    "release_at",
    "android_download_url",
    "ios_download_url",
    "force_update_at",
    "release_notification_at",
    "release_message",
    "release_notes",
  ]);

  if (diff) {
    void writeSecurityAuditLogBestEffort({
      event_type: SECURITY_AUDIT_EVENT_TYPE.MOBILE_APP_VERSION_UPDATED,
      outcome: SECURITY_AUDIT_OUTCOME.SUCCESS,
      actor_type: "admin",
      actor_account_id: actorSnapshot.actor_account_id,
      actor_username: actorSnapshot.username,
      actor_full_name: actorSnapshot.full_name,
      ip_address: context.ip_address,
      user_agent: context.user_agent,
      request_id: context.request_id,
      metadata: {
        targetType: "mobile_app_version",
        targetVersionId: id,
        before: diff.before,
        after: diff.after,
      },
    });
  }

  return toAdminSummary(finalVersion, resolveMobileAppVersionStatus(id, classifiedAfterUpdate));
}

/* -------------------------------------- Mobile Functions -------------------------------------- */

// Function ตรวจ Version สำหรับ Worker Mobile Application ตอนเปิด App — Public, ไม่ต้อง Login
// Backend เป็น Source of Truth ของเวลาเสมอ (new Date()) ห้าม Mobile ใช้เวลาเครื่องตัดสิน — resolve
// จาก ForceUpdateAt เท่านั้น ไม่เกี่ยวกับ Notification ถูกส่งไปแล้วหรือยัง
export async function checkMobileAppVersionForClient(
  query: unknown,
): Promise<MobileAppVersionCheckResponse> {
  const input = parseWithSchema(mobileAppVersionCheckQuerySchema, query);
  const versions = await mobileAppVersionRepository.listMobileAppVersions();
  const effective = resolveEffectiveMobileAppVersion(versions, new Date());

  if (!effective) {
    return {
      status: "NO_VERSION_CONFIGURED",
      update_available: false,
      force_update: false,
      can_skip: true,
      latest: null,
      policy: null,
      release_message: null,
    };
  }

  const downloadUrl =
    input.platform === "android"
      ? effective.android_download_url
      : input.platform === "ios"
        ? effective.ios_download_url
        : null;
  const latest = {
    version: effective.version,
    build_number: effective.build_number,
    download_url: downloadUrl,
  };
  const policy = effective.force_update_at
    ? { force_update_at: effective.force_update_at }
    : null;
  const releaseMessage =
    effective.release_message || effective.release_notes
      ? {
          message: effective.release_message,
          release_notes: effective.release_notes,
        }
      : null;

  // ClientBuild ที่สูงกว่าหรือเท่ากับ Effective ถือว่าล่าสุดแล้วเสมอ ห้าม downgrade แม้ Client
  // จะ Build สูงกว่า Server ก็ตาม
  const clientBuildNumber = input.build_number ?? 0;

  if (clientBuildNumber >= effective.build_number) {
    return {
      status: "UP_TO_DATE",
      update_available: false,
      force_update: false,
      can_skip: true,
      latest,
      policy,
      release_message: releaseMessage,
    };
  }

  // มี ForceUpdateAt ตั้งไว้ = Version นี้บังคับ Update — และ ServerTime >= ForceUpdateAt แล้วเสมอ
  // ที่จุดนี้ เพราะ resolveEffectiveMobileAppVersion เลือกได้ก็ต่อเมื่อ ActivationTime (=
  // ForceUpdateAt เมื่อมีค่า) ผ่านไปแล้วเท่านั้น — ไม่ต้องเช็คเวลาซ้ำอีกชั้น
  const forceUpdateRequired = effective.force_update_at !== null;

  return {
    status: forceUpdateRequired ? "UPDATE_REQUIRED" : "UPDATE_AVAILABLE",
    update_available: true,
    force_update: forceUpdateRequired,
    can_skip: !forceUpdateRequired,
    latest,
    policy,
    release_message: releaseMessage,
  };
}
