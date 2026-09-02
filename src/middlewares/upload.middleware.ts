import multer from "multer";

// Import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Config -------------------------------------- */

// Config MIME type รูปภาพที่อนุญาตให้อัปโหลด
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Config extension ไฟล์ต้อง derive จาก MIME type ที่ผ่าน validation แล้ว — export ไว้ให้
// src/config/spaces.ts ใช้ตอนตั้งชื่อ object key บน Spaces ด้วย (ที่เดียวกัน ไม่ duplicate mapping)
export const imageExtensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/* -------------------------------------- Middleware -------------------------------------- */

// Config middleware รับรูปโปรไฟล์ Admin เข้า memory (buffer) แทน disk — อัปโหลดขึ้น DigitalOcean
// Spaces ต่อใน route handler เอง (ดู src/config/spaces.ts) ไม่มีการเขียนไฟล์ลง local disk อีกแล้ว
export const uploadAdminImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageMimeTypes.has(file.mimetype)) {
      callback(
        new ApiError(
          400,
          "INVALID_IMAGE_TYPE",
          "Only jpg, png, and webp images are allowed."
        )
      );
      return;
    }

    callback(null, true);
  },
});
