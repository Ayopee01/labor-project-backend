// Import Queues
import { getWorkerBreakCount, scheduleWorkerShiftEnd } from "../../queues/worker-queue";

// Import Repositories
import * as workerApplicationRepository from "../../repositories/worker.repository";

// Import Types
import type { AccountDto, WorkScheduleDto } from "../../types/admin-workers.type";
import type { DbConnection } from "../../types/shared/common.type";
import type { WorkerShiftCloseReason, WorkerStatusResponse } from "../../types/worker.type";

// Import Config
import { ASSIGNMENT_STATUS } from "../../constants/job-status";

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
  connection?: Parameters<typeof workerApplicationRepository.listWorkerAssignmentHistoryByDate>[3]
): Promise<Pick<WorkerStatusResponse, "today_job_count" | "break_count_used" | "completed_job_count">> {
  const today = formatBangkokDate();
  const { startAt, endAt } = buildBangkokDateRange(today);
  const shiftInstanceKey = schedule ? buildWorkScheduleShiftInstanceKey(schedule) : null;
  const [assignmentHistory, breakCountUsed] = await Promise.all([
    workerApplicationRepository.listWorkerAssignmentHistoryByDate(
      accountId,
      startAt,
      endAt,
      connection
    ),
    shiftInstanceKey ? getWorkerBreakCount(accountId, shiftInstanceKey) : 0,
  ]);
  const completedJobCount = assignmentHistory.filter(({ assignment }) =>
    assignment.status === ASSIGNMENT_STATUS.COMPLETED || Boolean(assignment.completed_at)
  ).length;
  const todayJobCount = assignmentHistory.filter(
    ({ assignment }) => assignment.status !== ASSIGNMENT_STATUS.TIMEOUT
  ).length;

  return {
    today_job_count: todayJobCount,
    break_count_used: breakCountUsed,
    completed_job_count: completedJobCount,
  };
}

// Function ตั้ง job ปิดกะ worker เมื่อเวลาสิ้นสุดกะยังอยู่ในอนาคต
export async function scheduleWorkerShiftEndIfNeeded(
  accountId: number,
  schedule: WorkScheduleDto
): Promise<void> {
  const delayMs = getWorkScheduleShiftEndDelayMs(schedule);

  if (delayMs > 0) {
    await scheduleWorkerShiftEnd(
      accountId,
      schedule.id,
      delayMs,
      buildWorkScheduleShiftInstanceKey(schedule)
    );
  }
}

// Function บันทึกว่า worker online แล้วในกะปัจจุบัน
export async function markWorkerAttendanceOnline(
  account: AccountDto,
  schedule: WorkScheduleDto,
  shiftInstanceKey: string,
  connection?: DbConnection
): Promise<void> {
  await workerApplicationRepository.workerShiftAttendanceRepository.markWorkerShiftOnline(
    {
      account_id: account.id,
      worker_code: account.username,
      schedule,
      shift_instance_key: shiftInstanceKey,
    },
    connection
  );
}

// Function ปิด attendance ของกะ worker พร้อมเหตุผลที่ออกจากกะ
export async function closeWorkerAttendanceShift(
  account: AccountDto,
  schedule: WorkScheduleDto,
  shiftInstanceKey: string,
  reason: WorkerShiftCloseReason,
  connection?: DbConnection
): Promise<void> {
  await workerApplicationRepository.workerShiftAttendanceRepository.closeWorkerShift(
    {
      account_id: account.id,
      worker_code: account.username,
      schedule,
      shift_instance_key: shiftInstanceKey,
      reason,
    },
    connection
  );
}
