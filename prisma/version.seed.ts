import { PrismaClient } from "@prisma/client";

/**
 * Seed ค่าเริ่มต้นของ mobile_app_versions ให้มี Version แรก/Build แรกไว้เสมอ กัน DB ว่าง (null) ตอน
 * เพิ่งตั้งค่าระบบใหม่ ทำให้ GET /api/workers/app-version/check ตอบ NO_VERSION_CONFIGURED ตลอด และ
 * ทดสอบ flow ของแอพไม่ได้ — ไม่มี ForceUpdateAt จึงมีผลใช้งานทันที (Current) ตั้งแต่ CreateDate เลย
 * ไม่ใช่ Scheduled (ดู resolveActivationTime ใน mobile-app-version.service.ts)
 */

const FIRST_VERSION_SEED = {
  version: "1.0.0",
  buildNumber: 1,
  androidDownloadUrl: "https://www.android.com/intl/th_th/",
  iosDownloadUrl: "https://www.apple.com/",
  releaseMessage: "First release.",
  releaseNotes: "Initial release of the app.",
} as const;

// Function seed ข้อมูล mobile_app_versions เริ่มต้น (Version แรก/Build แรก) ลง DB
export async function seedMobileAppVersion(
  prisma: PrismaClient,
  adminId: number | null,
): Promise<void> {
  const now = new Date();

  await prisma.mobileAppVersion.upsert({
    where: {
      buildNumber: FIRST_VERSION_SEED.buildNumber,
    },
    // Format repeat seed updates display fields only
    update: {
      androidDownloadUrl: FIRST_VERSION_SEED.androidDownloadUrl,
      iosDownloadUrl: FIRST_VERSION_SEED.iosDownloadUrl,
    },
    create: {
      version: FIRST_VERSION_SEED.version,
      buildNumber: FIRST_VERSION_SEED.buildNumber,
      androidDownloadUrl: FIRST_VERSION_SEED.androidDownloadUrl,
      iosDownloadUrl: FIRST_VERSION_SEED.iosDownloadUrl,
      releaseMessage: FIRST_VERSION_SEED.releaseMessage,
      releaseNotes: FIRST_VERSION_SEED.releaseNotes,
      // Format initial seed as already release-notified
      releaseNotificationSentAt: now,
      createdBy: adminId,
      updatedBy: adminId,
    },
  });

  console.log(
    `Seeded mobile_app_versions: ${FIRST_VERSION_SEED.version} (build ${FIRST_VERSION_SEED.buildNumber}).`,
  );
}
