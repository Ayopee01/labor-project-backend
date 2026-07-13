// import
import type { WorkScheduleDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import ApiError from "./api-error";

/* -------------------------------------- Config -------------------------------------- */

const MORNING_SHIFT = "กะเช้า";
const NIGHT_SHIFT = "กะกลางคืน";
const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const bangkokTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANGKOK_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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

export function formatBangkokServerTime(value: Date = new Date()): string {
  return bangkokTimeFormatter.format(value);
}

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

// Function format work schedule with shift name
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

export const isDateInWorkSchedule = isTimeInWorkSchedule;

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
