import * as Sentry from "@sentry/node";

/* -------------------------------------- Sentry Init -------------------------------------- */
// No-op ถ้าไม่ตั้ง SENTRY_DSN (dev/test/รอบยังไม่ subscribe) — Sentry.* ทุกตัวปลอดภัยที่จะเรียกโดยไม่ init
// เพราะ SDK ใช้ no-op client ภายในถ้ายังไม่ init

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // โปรเจกต์นี้รัน production environment เดียว (single instance, ไม่มี staging) จึงไม่ต้อง
    // แยก mode ตาม NODE_ENV — ตั้งใจ hardcode ค่าเดียวคงที่
    environment: "production",
    // Error tracking อย่างเดียว ไม่เก็บ performance trace เพื่อลด overhead/cost โดยไม่จำเป็น
    tracesSampleRate: 0,
  });
}

export { Sentry };
