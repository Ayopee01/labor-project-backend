// Import Dependencies
import type { ShiftWaitInfo, WorkScheduleDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import ApiError from "./api-error";

/* -------------------------------------- Config -------------------------------------- */

const MORNING_SHIFT = "Morning shift";

const NIGHT_SHIFT = "Evening shift";

const SHIFT_PRESETS = {
  1: {
    shift_no: 1,
    shift_start_time: "08:00",
    shift_end_time: "18:00",
    shift_name: MORNING_SHIFT,
  },
  2: {
    shift_no: 2,
    shift_start_time: "18:00",
    shift_end_time: "08:00",
    shift_name: NIGHT_SHIFT,
  },
} as const;

const BANGKOK_TIME_ZONE = "Asia/Bangkok";

const bangkokTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANGKOK_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const bangkokDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANGKOK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/* -------------------------------------- Functions -------------------------------------- */

// Function อ่านค่า time เป็น minutes สำหรับ helper กลาง
function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return hours * 60 + minutes;
}

// Function ดึง bangkok time เป็น minutes สำหรับ helper กลาง
function getBangkokTimeToMinutes(value: Date): number {
  const parts = bangkokTimeFormatter.formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  return hour * 60 + minute;
}

// Function ดึง bangkok date string สำหรับ helper กลาง
function getBangkokDateString(value: Date): string {
  const parts = bangkokDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

// Function จัดการ add days เป็น date string สำหรับ helper กลาง
function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return [
    String(next.getUTCFullYear()),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

// Function สร้าง work schedule shift instance key สำหรับ helper กลาง
export function buildWorkScheduleShiftInstanceKey(
  schedule: WorkScheduleDto,
  value: Date = new Date()
): string {
  const { startMinutes, endMinutes } = parseScheduleTimeRange(schedule);
  const currentMinutes = getBangkokTimeToMinutes(value);
  const currentDate = getBangkokDateString(value);
  const shiftStartDate =
    endMinutes <= startMinutes && currentMinutes < endMinutes
      ? addDaysToDateString(currentDate, -1)
      : currentDate;

  return `${shiftStartDate}:${schedule.shift_start_time}-${schedule.shift_end_time}`;
}

// Function ดึง work schedule shift end at สำหรับ helper กลาง
function getWorkScheduleShiftEndAt(
  schedule: WorkScheduleDto,
  value: Date = new Date()
): Date {
  const { startMinutes, endMinutes } = parseScheduleTimeRange(schedule);
  const currentMinutes = getBangkokTimeToMinutes(value);
  const currentDate = getBangkokDateString(value);
  const shiftStartDate =
    endMinutes <= startMinutes && currentMinutes < endMinutes
      ? addDaysToDateString(currentDate, -1)
      : currentDate;
  const shiftEndDate =
    endMinutes <= startMinutes
      ? addDaysToDateString(shiftStartDate, 1)
      : shiftStartDate;

  return new Date(`${shiftEndDate}T${schedule.shift_end_time}:00.000+07:00`);
}

// Function ดึง work schedule shift end delay ms สำหรับ helper กลาง
export function getWorkScheduleShiftEndDelayMs(
  schedule: WorkScheduleDto,
  value: Date = new Date()
): number {
  return Math.max(0, getWorkScheduleShiftEndAt(schedule, value).getTime() - value.getTime());
}

// Function จัดรูปแบบ remaining time สำหรับ helper กลาง
function formatRemainingTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const textParts = [];

  if (hours > 0) {
    textParts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }

  if (minutes > 0 || textParts.length === 0) {
    textParts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }

  return textParts.join(" ");
}

// Function อ่านค่า schedule time range สำหรับ helper กลาง
function parseScheduleTimeRange(schedule: WorkScheduleDto): {
  startMinutes: number;
  endMinutes: number;
} {
  const startMinutes = parseTimeToMinutes(schedule.shift_start_time);
  const endMinutes = parseTimeToMinutes(schedule.shift_end_time);

  if (startMinutes === null || endMinutes === null) {
    throw new ApiError(
      400,
      "INVALID_SHIFT_TIME",
      "Shift time must use HH:mm format."
    );
  }

  return {
    startMinutes,
    endMinutes,
  };
}

// Function จัดการ calculate shift name สำหรับ helper กลาง
export function calculateShiftName(
  shiftStartTime: string,
  shiftEndTime?: string
): string {
  const startMinutes = parseTimeToMinutes(shiftStartTime);

  if (startMinutes === null) {
    throw new ApiError(
      400,
      "INVALID_SHIFT_TIME",
      "Shift start time must use HH:mm format."
    );
  }

  if (shiftEndTime !== undefined) {
    const endMinutes = parseTimeToMinutes(shiftEndTime);

    if (endMinutes === null) {
      throw new ApiError(
        400,
        "INVALID_SHIFT_TIME",
        "Shift end time must use HH:mm format."
      );
    }

  }

  if (startMinutes >= 18 * 60) {
    return NIGHT_SHIFT;
  }

  return MORNING_SHIFT;
}

// Function ค้นหาหรือตัดสิน shift no จาก start time สำหรับ helper กลาง
export function resolveShiftNoFromStartTime(shiftStartTime: string): 1 | 2 {
  const startMinutes = parseTimeToMinutes(shiftStartTime);

  if (startMinutes === null) {
    throw new ApiError(
      400,
      "INVALID_SHIFT_TIME",
      "Shift start time must use HH:mm format."
    );
  }

  return startMinutes >= 18 * 60 ? 2 : 1;
}

// Function ค้นหาหรือตัดสิน shift preset สำหรับ helper กลาง
export function resolveShiftPreset(shiftNo: number): {
  shift_no: 1 | 2;
  shift_start_time: string;
  shift_end_time: string;
  shift_name: string;
} {
  if (shiftNo !== 1 && shiftNo !== 2) {
    throw new ApiError(
      400,
      "INVALID_SHIFT_NO",
      "ShiftNo must be 1 or 2."
    );
  }

  return SHIFT_PRESETS[shiftNo];
}

// Function จัดรูปแบบ schedule พร้อม shift สำหรับ helper กลาง
export function formatScheduleWithShift(
  schedule: WorkScheduleDto | null
): WorkScheduleWithShiftDto | null {
  if (!schedule) {
    return null;
  }

  return {
    ...schedule,
    shift_name: calculateShiftName(
      schedule.shift_start_time,
      schedule.shift_end_time
    ),
  };
}

// Function ตรวจว่า time ใน work schedule สำหรับ helper กลาง
export function isTimeInWorkSchedule(
  schedule: WorkScheduleDto,
  value: Date = new Date()
): boolean {
  const { startMinutes, endMinutes } = parseScheduleTimeRange(schedule);
  const currentMinutes = getBangkokTimeToMinutes(value);

  if (endMinutes <= startMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

// Function ค้นหา active work schedule สำหรับ helper กลาง
export function findActiveWorkSchedule(
  schedules: WorkScheduleDto[],
  value: Date = new Date()
): WorkScheduleDto | null {
  return schedules.find((schedule) => isTimeInWorkSchedule(schedule, value)) ?? null;
}

// Function ค้นหา next work schedule สำหรับ helper กลาง
export function findNextWorkSchedule(
  schedules: WorkScheduleDto[],
  value: Date = new Date()
): WorkScheduleDto | null {
  if (schedules.length === 0) {
    return null;
  }

  const currentMinutes = getBangkokTimeToMinutes(value);

  return [...schedules].sort((first, second) => {
    const firstStart = parseScheduleTimeRange(first).startMinutes;
    const secondStart = parseScheduleTimeRange(second).startMinutes;
    const firstWait = (firstStart - currentMinutes + 24 * 60) % (24 * 60);
    const secondWait = (secondStart - currentMinutes + 24 * 60) % (24 * 60);

    return firstWait - secondWait;
  })[0];
}

// Function สร้าง shift wait info สำหรับ helper กลาง
export function buildShiftWaitInfo(
  schedule: WorkScheduleDto,
  value: Date = new Date()
): ShiftWaitInfo {
  const { startMinutes } = parseScheduleTimeRange(schedule);
  const currentMinutes = getBangkokTimeToMinutes(value);
  let minutesUntilShiftStart = startMinutes - currentMinutes;

  if (minutesUntilShiftStart <= 0) {
    minutesUntilShiftStart += 24 * 60;
  }

  return {
    shift: {
      name: calculateShiftName(
        schedule.shift_start_time,
        schedule.shift_end_time
      ),
      start_time: schedule.shift_start_time,
      end_time: schedule.shift_end_time,
    },
    remaining_time: formatRemainingTime(minutesUntilShiftStart),
  };
}
