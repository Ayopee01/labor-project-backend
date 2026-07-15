import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import ApiError from "../utils/api-error";

// Config path สำหรับเก็บรูป worker ที่ upload เข้ามา
const workerUploadDir = path.resolve(process.cwd(), "uploads", "workers");

// Config MIME type รูป worker ที่อนุญาตให้อัปโหลด
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Function สร้างโฟลเดอร์ uploads/workers หากยังไม่มีอยู่จริง
function ensureUploadDir() {
  fs.mkdirSync(workerUploadDir, { recursive: true });
}

// Config storage ของ multer สำหรับบันทึกรูป worker ลง uploads/workers
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

// Middleware รับรูป worker และตรวจชนิดไฟล์/ขนาดก่อนบันทึกลง uploads
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

// Function แปลง field string ที่เป็น JSON ใน multipart/form-data กลับเป็น object
function parseJsonField(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Function แปลง multipart/form-data ให้เป็น body รูปแบบเดียวกับ JSON API เดิม
export function normalizeCreateUserMultipartBody(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }

  const body = { ...req.body };
  const file = req.file;

  if (file) {
    body.image_url = `/uploads/workers/${file.filename}`;
  }

  if (body.work_schedule) {
    body.work_schedule = parseJsonField(body.work_schedule);
  } else if (
    body.work_date ||
    body.shift_start_time ||
    body.shift_end_time
  ) {
    body.work_schedule = {
      work_date: body.work_date,
      shift_start_time: body.shift_start_time,
      shift_end_time: body.shift_end_time,
    };
  }

  delete body.work_date;
  delete body.shift_start_time;
  delete body.shift_end_time;

  req.body = body;
  next();
}
