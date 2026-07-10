// import
import type { WorkScheduleDto, WorkScheduleWithShiftDto } from "../types/admin-workers.type";
import ApiError from "./api-error";

/* -------------------------------------- Config -------------------------------------- */

const MORNING_SHIFT = "กะเช้า";
const NIGHT_SHIFT = "กะกลางคืน";

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
export function isDateInWorkSchedule(
  schedule: WorkScheduleDto,
  value: Date = new Date()
): boolean {
  const startMinutes = parseTimeToMinutes(schedule.shift_start_time);
  const endMinutes = parseTimeToMinutes(schedule.shift_end_time);

  if (startMinutes === null || endMinutes === null) {
    throw new ApiError(
      400,
      "INVALID_SHIFT_TIME",
      "Shift time must use HH:mm format."
    );
  }

  const [year, month, day] = schedule.work_date.split("-").map(Number);
  const startAt = new Date(
    year,
    month - 1,
    day,
    Math.floor(startMinutes / 60),
    startMinutes % 60,
    0,
    0
  );
  const endAt = new Date(
    year,
    month - 1,
    day,
    Math.floor(endMinutes / 60),
    endMinutes % 60,
    0,
    0
  );

  if (endMinutes <= startMinutes) {
    endAt.setDate(endAt.getDate() + 1);
  }

  return value >= startAt && value < endAt;
}
