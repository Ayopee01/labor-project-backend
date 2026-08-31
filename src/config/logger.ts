import pino from "pino";

/* -------------------------------------- Pino Instance -------------------------------------- */
// Pino ทำหน้าที่แค่ output layer (format/level/destination) — redact logic ยังใช้ของเดิมใน
// src/utils/logger.ts (ผ่าน test แล้วและครอบคลุมกว่า pino redact.paths ทั่วไป เช่น scan ค่าที่ตรงกับ
// env secret) เรียกก่อนส่งเข้า pino เสมอ ไม่ได้พึ่ง pino redact option โดยตรง

const isDevelopment = process.env.NODE_ENV === "development";

const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || "info",
  // ตัด pid/hostname ออก (ไม่ใช้), คง key เดิม message/timestamp ให้ตรงกับ log shape เดิมของโปรเจกต์
  base: null,
  messageKey: "message",
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => ({ level: label }),
  },
};

// Function สร้าง pino instance สำหรับ logger กลางของโปรเจกต์
function buildPinoLogger(): pino.Logger {
  if (isDevelopment) {
    return pino({
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
        },
      },
    });
  }

  // ส่ง process.stdout ตรงๆ เป็น destination (ไม่ใช้ pino.destination() ที่เขียนผ่าน raw fd ตรง
  // bypass process.stdout.write ทำให้ intercept ใน test ไม่ได้) — ยังคงไม่ block caller ด้วย await
  // ใดๆ เหมือนเดิม (call site logger.info/warn/error ทั้งหมดเป็น synchronous function call, pino
  // จัดการ backpressure ของ stream เองถ้า buffer เต็ม)
  return pino(baseOptions, process.stdout);
}

export const pinoLogger = buildPinoLogger();
