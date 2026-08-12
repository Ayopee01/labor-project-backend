// Import Queues
import {
  getWorkerBreakCount,
  scheduleWorkerShiftEnd,
} from "../../queues/worker-queue";

// Import Repositories
import * as assignmentRepository from "../../repositories/shared/vehicle-job-assignment.repository";
import * as workerShiftAttendanceRepository from "../../repositories/shared/worker-shift-attendance.repository";

// Import Types
import type {
  AccountDto,
  WorkScheduleDto,
} from "../../types/admin-workers.type";
import type { DbConnection } from "../../types/shared/common.type";
import type {
  WorkerShiftCloseReason,
  WorkerStatusResponse,
} from "../../types/worker.type";

// Import Utils
import {
  buildWorkScheduleShiftInstanceKey,
  getWorkScheduleShiftEndDelayMs,
} from "../../utils/shift";
import { buildBangkokDateRange, formatBangkokDate } from "../../utils/time";

/* -------------------------------------- Functions -------------------------------------- */

// Function รวมยอดงานวันนี้ จำนวนพัก และจำนวนงานที่จบแล้วของ Worker
export async function buildWorkerDailySummary(
  accountId: number,
  schedule: WorkScheduleDto | null,
  connection?: Parameters<
    typeof assignmentRepository.getWorkerDailyAssignmentCounts
  >[3],
): Promise<
  Pick<
    WorkerStatusResponse,
    "today_job_count" | "break_count_used" | "completed_job_count"
  >
> {
  const today = formatBangkokDate();
  const { startAt, endAt } = buildBangkokDateRange(today);
  const shiftInstanceKey = schedule
    ? buildWorkScheduleShiftInstanceKey(schedule)
    : null;
  const [assignmentCounts, breakCountUsed] = await Promise.all([
    assignmentRepository.getWorkerDailyAssignmentCounts(
      accountId,
      startAt,
      endAt,
      connection,
    ),
    shiftInstanceKey ? getWorkerBreakCount(accountId, shiftInstanceKey) : 0,
  ]);

  return {
    today_job_count: assignmentCounts.today_job_count,
    break_count_used: breakCountUsed,
    completed_job_count: assignmentCounts.completed_job_count,
  };
}

// Function ตั้ง job ปิดกะ worker เมื่อเวลาสิ้นสุดกะยังอยู่ในอนาคต
export async function scheduleWorkerShiftEndIfNeeded(
  accountId: number,
  schedule: WorkScheduleDto,
): Promise<void> {
  const delayMs = getWorkScheduleShiftEndDelayMs(schedule);

  if (delayMs > 0) {
    await scheduleWorkerShiftEnd(
      accountId,
      schedule.id,
      delayMs,
      buildWorkScheduleShiftInstanceKey(schedule),
    );
  }
}

// Function บันทึกว่า worker online แล้วในกะปัจจุบัน
export async function markWorkerAttendanceOnline(
  account: AccountDto,
  schedule: WorkScheduleDto,
  shiftInstanceKey: string,
  connection?: DbConnection,
): Promise<void> {
  await workerShiftAttendanceRepository.markWorkerShiftOnline(
    {
      account_id: account.id,
      worker_code: account.username,
      schedule,
      shift_instance_key: shiftInstanceKey,
    },
    connection,
  );
}

// Function ปิด attendance ของกะ worker พร้อมเหตุผลที่ออกจากกะ
export async function closeWorkerAttendanceShift(
  account: AccountDto,
  schedule: WorkScheduleDto,
  shiftInstanceKey: string,
  reason: WorkerShiftCloseReason,
  connection?: DbConnection,
): Promise<void> {
  await workerShiftAttendanceRepository.closeWorkerShift(
    {
      account_id: account.id,
      worker_code: account.username,
      schedule,
      shift_instance_key: shiftInstanceKey,
      reason,
    },
    connection,
  );
}
