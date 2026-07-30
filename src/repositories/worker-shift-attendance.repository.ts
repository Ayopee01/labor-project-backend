import type { Prisma, WorkerShiftAttendance } from "@prisma/client";

import type { WorkScheduleDto } from "../types/admin-workers.type";
import type { DbConnection } from "../types/common.type";
import { client } from "./shared/repository-utils";

/* -------------------------------------- Config -------------------------------------- */

// Config close reasons stored in worker_shift_attendances for daily/shift queue eligibility audit.
export const WORKER_SHIFT_CLOSE_REASONS = [
  "worker_offline",
  "shift_ended",
  "assignment_timeout_limit_reached",
  "ticket_delivered_after_shift_end",
] as const;

/* -------------------------------------- Types -------------------------------------- */

// Type value of close_reason for worker_shift_attendances.
export type WorkerShiftCloseReason = (typeof WORKER_SHIFT_CLOSE_REASONS)[number];

// Type unique key used to identify one worker in one concrete shift instance.
type WorkerShiftAttendanceKeyInput = {
  account_id: number;
  shift_instance_key: string;
};

// Type write input that includes the current schedule snapshot stored on attendance records.
type WorkerShiftAttendanceWriteInput = WorkerShiftAttendanceKeyInput & {
  worker_code: string;
  schedule: WorkScheduleDto;
};

/* -------------------------------------- Functions -------------------------------------- */

// Function builds a denormalized shift snapshot so history survives future schedule changes.
function buildShiftSnapshot(input: WorkerShiftAttendanceWriteInput) {
  return {
    workerCode: input.worker_code,
    shiftNo: input.schedule.shift_no,
    shiftStartTime: input.schedule.shift_start_time,
    shiftEndTime: input.schedule.shift_end_time,
  };
}

// Function finds one attendance record for a worker and shift instance.
export async function findByWorkerAndShift(
  input: WorkerShiftAttendanceKeyInput,
  connection?: DbConnection
): Promise<WorkerShiftAttendance | null> {
  const db = client(connection);

  return db.workerShiftAttendance.findUnique({
    where: {
      accountId_shiftInstanceKey: {
        accountId: input.account_id,
        shiftInstanceKey: input.shift_instance_key,
      },
    },
  });
}

// Function marks that a worker used their one allowed online entry for this shift.
export async function markWorkerShiftOnline(
  input: WorkerShiftAttendanceWriteInput,
  connection?: DbConnection
): Promise<WorkerShiftAttendance> {
  const db = client(connection);
  const now = new Date();
  const shiftSnapshot = buildShiftSnapshot(input);

  return db.workerShiftAttendance.upsert({
    where: {
      accountId_shiftInstanceKey: {
        accountId: input.account_id,
        shiftInstanceKey: input.shift_instance_key,
      },
    },
    create: {
      accountId: input.account_id,
      shiftInstanceKey: input.shift_instance_key,
      ...shiftSnapshot,
      firstOnlineAt: now,
      lastOnlineAt: now,
    },
    update: {
      ...shiftSnapshot,
      lastOnlineAt: now,
    },
  });
}

// Function closes a worker shift and creates an audit row if the worker never went online first.
export async function closeWorkerShift(
  input: WorkerShiftAttendanceWriteInput & {
    reason: WorkerShiftCloseReason;
  },
  connection?: DbConnection
): Promise<WorkerShiftAttendance> {
  const db = client(connection);
  const existing = await findByWorkerAndShift(input, connection);
  const now = new Date();
  const shiftSnapshot = buildShiftSnapshot(input);
  const closeData: Prisma.WorkerShiftAttendanceUncheckedUpdateInput = {
    ...shiftSnapshot,
    closedAt: now,
    closeReason: input.reason,
    offlineAt: now,
  };

  if (existing?.closedAt) {
    return existing;
  }

  if (existing) {
    return db.workerShiftAttendance.update({
      where: {
        id: existing.id,
      },
      data: closeData,
    });
  }

  return db.workerShiftAttendance.create({
    data: {
      accountId: input.account_id,
      shiftInstanceKey: input.shift_instance_key,
      ...shiftSnapshot,
      closedAt: now,
      closeReason: input.reason,
      offlineAt: now,
    },
  });
}
