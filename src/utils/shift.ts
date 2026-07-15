// import
import type { WorkScheduleDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import ApiError from "./api-error";

/* -------------------------------------- Config -------------------------------------- */

// Config ชื่อกะสำหรับช่วงเช้า
const MORNING_SHIFT = "กะเช้า";

// Config ชื่อกะสำหรับช่วงกลางคืน
const NIGHT_SHIFT = "กะกลางคืน";

// Config timezone กลางที่ใช้คำนวณกะงานและเวลา server
const BANGKOK_TIME_ZONE = "Asia/Bangkok";

// Config formatter เวลา Bangkok แบบ HH:mm
const bangkokTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANGKOK_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Config formatter วันที่ Bangkok แบบ YYYY-MM-DD
const bangkokDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANGKOK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Type ส่วนข้อมูลที่ส่งกลับเมื่อ worker ยังไม่ถึงเวลาเข้ากะ
export type ShiftWaitInfo = {
  shift: {
    name: string;
    start_time: string;
    end_time: string;
  };
  remaining_time: string;
};

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลงเวลา HH:mm เป็นจำนวนนาทีตั้งแต่ 00:00 และคืน null ถ้าเวลาไม่ถูกต้อง
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

// Function แปลงเวลา Date เป็นจำนวนนาทีตั้งแต่ 00:00 ของเวลาในเขตเวลา Bangkok
function getBangkokTimeToMinutes(value: Date): number {
  const parts = bangkokTimeFormatter.formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  return hour * 60 + minute;
}

// Function format วันที่ตามเขตเวลา Bangkok เป็น YYYY-MM-DD
function getBangkokDateString(value: Date): string {
  const parts = bangkokDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

// Function บวก/ลบวันจาก date string แบบ YYYY-MM-DD
function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return [
    String(next.getUTCFullYear()),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

// Function สร้าง key ของกะงานเพื่อใช้ reset counter ตามกะจริงแม้กะข้ามวัน
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

// Function แปลงจำนวนนาทีที่เหลือเป็นข้อความภาษาไทย
function formatRemainingTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const textParts = [];

  if (hours > 0) {
    textParts.push(`${hours} ชม.`);
  }

  if (minutes > 0 || textParts.length === 0) {
    textParts.push(`${minutes} นาที`);
  }

  return textParts.join(" ");
}

// Function แปลง WorkScheduleDto เป็น object ที่มี startMinutes และ endMinutes
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

// Function คำนวณชื่อกะจากเวลาเริ่มงาน
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

  if (startMinutes >= 17 * 60) {
    return NIGHT_SHIFT;
  }

  return MORNING_SHIFT;
}

// Function จัดรูป work schedule พร้อมชื่อกะจากเวลาเริ่มและจบงาน
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

// Function ตรวจว่าเวลาที่ส่งมาอยู่ในช่วงกะของ schedule หรือไม่ รองรับกะข้ามวัน
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

// Function alias เดิมสำหรับตรวจวันที่ใน schedule โดยใช้ logic เดียวกับเวลากะ
export const isDateInWorkSchedule = isTimeInWorkSchedule;

// Function สร้าง response ย่อเมื่อ worker online นอกเวลางาน พร้อมชื่อกะและเวลาที่เหลือ
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
