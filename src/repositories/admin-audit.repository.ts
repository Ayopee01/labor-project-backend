import { client } from "./shared/repository-utils";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";

import type { DbConnection } from "../types/shared/common.type";
import type { WorkerAssignmentEventType } from "../types/shared/worker-assignment-event.type";

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
