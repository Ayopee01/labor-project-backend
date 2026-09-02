import crypto from "crypto";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import ApiError from "../utils/api-error";
import { imageExtensionByMimeType } from "../middlewares/upload.middleware";

let client: S3Client | null = null;

// Function สร้าง S3Client แบบ lazy (ครั้งแรกที่ต้องใช้จริงเท่านั้น) เพื่อไม่ให้ import module นี้
// พังตอนที่ SPACES_* ยังไม่ถูกตั้งค่า (เช่น environment ที่ยังไม่ setup DigitalOcean Spaces)
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.SPACES_ENDPOINT,
      region: process.env.SPACES_REGION,
      credentials: {
        accessKeyId: process.env.SPACES_ACCESS_KEY ?? "",
        secretAccessKey: process.env.SPACES_SECRET_KEY ?? "",
      },
    });
  }

  return client;
}

// Function เช็คว่า config ของ DigitalOcean Spaces (ใช้เก็บรูปโปรไฟล์ Admin) ครบหรือไม่ — fail closed
// เหมือน LINE webhook (line.service.ts) เพราะ endpoint นี้มีหน้าที่คุยกับ Spaces โดยตรงเป็นหลัก
function assertSpacesConfigured(): void {
  if (
    !process.env.SPACES_ENDPOINT ||
    !process.env.SPACES_REGION ||
    !process.env.SPACES_ACCESS_KEY ||
    !process.env.SPACES_SECRET_KEY ||
    !process.env.SPACES_ADMIN_BUCKET
  ) {
    throw new ApiError(
      503,
      "SPACES_NOT_CONFIGURED",
      "Object storage is not configured."
    );
  }
}

function buildPublicUrl(key: string): string {
  const bucket = process.env.SPACES_ADMIN_BUCKET;
  const host = (process.env.SPACES_ENDPOINT ?? "").replace(/^https?:\/\//, "");

  return `https://${bucket}.${host}/${key}`;
}

// Function ดึง object key กลับจาก public URL ที่เคยสร้างด้วย buildPublicUrl — คืน null เฉยๆ (ไม่ throw)
// ถ้า URL ไม่ตรง pattern ของ Spaces เช่น path เก่าที่เคยเก็บ local (/uploads/admins/...) ก่อน migrate
function extractKeyFromUrl(url: string): string | null {
  const bucket = process.env.SPACES_ADMIN_BUCKET;
  const host = (process.env.SPACES_ENDPOINT ?? "").replace(/^https?:\/\//, "");
  const prefix = `https://${bucket}.${host}/`;

  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

// Function อัปโหลดรูปโปรไฟล์ Admin ขึ้น DigitalOcean Spaces แล้วคืน public URL — เก็บใต้ prefix
// "admins/" ทั้งหมด (bucket นี้แยกจาก bucket backup ฐานข้อมูลใน scripts/backup-postgres.sh โดยตั้งใจ
// เพราะต้อง public-read ให้ client โหลดรูปได้ตรงๆ ต่างจาก backup ที่ต้อง private)
export async function uploadAdminProfileImage(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  assertSpacesConfigured();

  const extension = imageExtensionByMimeType[mimeType] ?? ".bin";
  const key = `admins/${Date.now()}-${crypto.randomUUID()}${extension}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.SPACES_ADMIN_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: "public-read",
    })
  );

  return buildPublicUrl(key);
}

// Function ลบรูปโปรไฟล์ Admin เก่าออกจาก Spaces ตอนอัปโหลดรูปใหม่ทับ (กันไฟล์กำพร้าสะสมค่าเก็บไปเรื่อยๆ)
// no-op เงียบๆ ถ้า URL ที่ส่งมาไม่ใช่ของ Spaces (เช่น path local เก่าก่อน migrate) — ผู้เรียกต้อง
// ดักจับ error เองถ้าต้องการ (เป็น best-effort ไม่ควรทำให้ request หลักล้มเหลว)
export async function deleteAdminProfileImageByUrl(url: string): Promise<void> {
  const key = extractKeyFromUrl(url);

  if (!key) {
    return;
  }

  await getClient().send(
    new DeleteObjectCommand({
      Bucket: process.env.SPACES_ADMIN_BUCKET,
      Key: key,
    })
  );
}
