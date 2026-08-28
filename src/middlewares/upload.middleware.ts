// Import Library
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

// Import Middleware
import { normalizeApiRequestPayload } from "./api-case.middleware";

// Import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Config -------------------------------------- */

// Config root directory เก็บรูปที่อัปโหลดจาก multipart/form-data
const uploadRootDir = process.env.UPLOAD_DIR || "uploads";

// Config MIME type รูปภาพที่อนุญาตให้อัปโหลด
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Config extension ไฟล์ต้อง derive จาก MIME type ที่ผ่าน validation แล้ว
const imageExtensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง multer instance สำหรับรับรูปภาพเก็บที่ uploads/<subdir> พร้อมจำกัดขนาดและชนิดไฟล์
// ใช้ร่วมกันทั้งรูป worker (uploads/workers) และรูป admin (uploads/admins)
function createImageUpload(subdir: string) {
  const targetDir = path.resolve(process.cwd(), uploadRootDir, subdir);

  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(targetDir, { recursive: true });
      callback(null, targetDir);
    },
    filename: (_req, file, callback) => {
      // fileFilter รันก่อน storage เสมอ ณ จุดนี้ file.mimetype การันตีว่าเป็นหนึ่งใน
      // allowedImageMimeTypes แล้ว — fallback ".bin" ไว้เผื่อกรณีไม่คาดคิดเท่านั้น
      const extension = imageExtensionByMimeType[file.mimetype] ?? ".bin";
      const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
      callback(null, fileName);
    },
  });

  return multer({
    storage,
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
}

// Config middleware สำหรับรับรูป worker พร้อมจำกัดขนาดและชนิดไฟล์
export const uploadWorkerImage = createImageUpload("workers");

// Config middleware สำหรับรับรูปโปรไฟล์ admin พร้อมจำกัดขนาดและชนิดไฟล์
export const uploadAdminImage = createImageUpload("admins");

// Function ดึงไฟล์รูป worker จากรูปแบบ req.file หรือ req.files ที่ multer คืนมา
function getWorkerImageFile(req: Request): Express.Multer.File | undefined {
  if (req.file) {
    return req.file;
  }

  if (Array.isArray(req.files)) {
    return req.files[0];
  }

  return req.files?.image?.[0] ?? req.files?.Image?.[0];
}

// Function normalize body แบบ multipart ให้ใช้ key ภายในเหมือน JSON body ปกติ
export function normalizeCreateUserMultipartBody(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }

  const body = normalizeApiRequestPayload({ ...req.body }) as Record<string, unknown>;
  const file = getWorkerImageFile(req);

  if (file) {
    body.image_url = `/uploads/workers/${file.filename}`;
  }

  req.body = body;
  next();
}
