const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const DAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างเวลา deadline จากเวลาปัจจุบัน
export function buildDeadline(durationMs: number, baseTime = Date.now()): Date {
  return new Date(baseTime + durationMs);
}

// Function สร้างช่วงเวลาของวันที่ไทยเพื่อใช้ query ประวัติงานรายวัน
export function buildBangkokDateRange(date: string): { startAt: Date; endAt: Date } {
  const startAt = new Date(`${date}T00:00:00.000+07:00`);
  const endAt = new Date(startAt.getTime() + DAY_MS);

  return {
    startAt,
    endAt,
  };
}

// Function format วันที่ปัจจุบันตามเขตเวลา Bangkok เป็น YYYY-MM-DD
export function formatBangkokDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

