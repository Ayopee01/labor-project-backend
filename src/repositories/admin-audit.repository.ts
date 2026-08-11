import { Prisma } from "@prisma/client";

import { ASSIGNMENT_STATUS } from "../constants/job-status";
import { client } from "./shared/repository-utils";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/admin-audit.type";

import type { DbConnection } from "../types/shared/common.type";
import type {
  WorkerAssignmentEventType,
  WorkerAssignmentEventWriteInput,
} from "../types/admin-audit.type";

export interface WorkerPerformanceAssignmentRow {
  assignment_id: number;
  worker_account_id: number;
  worker_code: string;
  full_name: string;
  status: string;
  accepted_at: Date | null;
  scanned_at: Date | null;
  event_types: WorkerAssignmentEventType[];
}

export async function createWorkerAssignmentEventOnce(
  input: WorkerAssignmentEventWriteInput,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  try {
    await db.workerAssignmentEvent.create({
      data: {
        assignmentId: input.assignment_id,
        workerAccountId: input.worker_account_id,
        vehicleJobId: input.vehicle_job_id,
        eventType: input.event_type,
        occurredAt: input.occurred_at ?? new Date(),
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }

    throw error;
  }
}

export async function createWorkerAssignmentEventsOnce(
  inputs: WorkerAssignmentEventWriteInput[],
  connection?: DbConnection
): Promise<void> {
  for (const input of inputs) {
    await createWorkerAssignmentEventOnce(input, connection);
  }
}

export async function listWorkerPerformanceAssignmentRows(
  filters: {
    startAt: Date;
    endAt: Date;
    worker_code?: string;
  },
  connection?: DbConnection
): Promise<WorkerPerformanceAssignmentRow[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      createdAt: {
        gte: filters.startAt,
        lt: filters.endAt,
      },
      ...(filters.worker_code && {
        worker: {
          username: filters.worker_code,
        },
      }),
    },
    orderBy: [
      {
        worker: {
          username: "asc",
        },
      },
      {
        id: "asc",
      },
    ],
    include: {
      worker: true,
      events: {
        select: {
          eventType: true,
        },
      },
    },
  });

  return assignments.map((assignment) => ({
    assignment_id: assignment.id,
    worker_account_id: assignment.workerAccountId,
    worker_code: assignment.worker.username,
    full_name: assignment.worker.fullName,
    status: assignment.status,
    accepted_at: assignment.acceptedAt,
    scanned_at: assignment.scannedAt,
    event_types: assignment.events
      .map((event) => event.eventType)
      .filter((eventType): eventType is WorkerAssignmentEventType =>
        Object.values(WORKER_ASSIGNMENT_EVENT_TYPE).includes(
          eventType as WorkerAssignmentEventType
        )
      ),
  }));
}

export function classifyHistoricalAcceptTimeout(row: Pick<WorkerPerformanceAssignmentRow, "status" | "accepted_at">): boolean {
  return row.status === ASSIGNMENT_STATUS.TIMEOUT && row.accepted_at === null;
}

export function classifyHistoricalScanTimeout(
  row: Pick<WorkerPerformanceAssignmentRow, "status" | "accepted_at" | "scanned_at">
): boolean {
  return (
    row.status === ASSIGNMENT_STATUS.TIMEOUT &&
    row.accepted_at !== null &&
    row.scanned_at === null
  );
}
