import { Prisma } from "@prisma/client";

import { client } from "./repository-utils";

import type { WorkerShiftAttendance } from "@prisma/client";
import type { DbConnection } from "../../types/shared/common.type";
import type {
  WorkerShiftAttendanceKeyInput,
  WorkerShiftAttendanceWriteInput,
  WorkerShiftCloseReason,
} from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

function buildShiftSnapshot(input: WorkerShiftAttendanceWriteInput) {
  return {
    workerCode: input.worker_code,
    shiftNo: input.schedule.shift_no,
    shiftStartTime: input.schedule.shift_start_time,
    shiftEndTime: input.schedule.shift_end_time,
  };
}

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

export async function incrementAcceptTimeoutStreak(
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
      acceptTimeoutStreak: 1,
      lastAcceptTimeoutAt: now,
    },
    update: {
      ...shiftSnapshot,
      acceptTimeoutStreak: {
        increment: 1,
      },
      lastAcceptTimeoutAt: now,
    },
  });
}

export async function resetAcceptTimeoutStreak(
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
      acceptTimeoutStreak: 0,
      lastAcceptTimeoutAt: null,
    },
    update: {
      ...shiftSnapshot,
      acceptTimeoutStreak: 0,
      lastAcceptTimeoutAt: null,
    },
  });
}

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
