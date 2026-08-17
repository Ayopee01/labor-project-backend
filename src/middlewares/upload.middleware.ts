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

// Config โฟลเดอร์เก็บรูป worker ที่อัปโหลดจาก multipart/form-data
const uploadRootDir = process.env.UPLOAD_DIR || "uploads";
const workerUploadDir = path.resolve(process.cwd(), uploadRootDir, "workers");

// Config MIME type รูปภาพที่อนุญาตให้อัปโหลด
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างโฟลเดอร์ upload เมื่อยังไม่มีอยู่
function ensureUploadDir() {
  fs.mkdirSync(workerUploadDir, { recursive: true });
}

// Config storage ของ multer สำหรับตั้ง path และชื่อไฟล์รูป worker
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    ensureUploadDir();
    callback(null, workerUploadDir);
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    callback(null, fileName);
  },
});

// Config middleware สำหรับรับรูป worker พร้อมจำกัดขนาดและชนิดไฟล์
export const uploadWorkerImage = multer({
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
