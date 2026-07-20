import { WORKING_ASSIGNMENT_STATUSES } from "../constants/job-status";
import type { VehicleJobAssignmentDto, WorkerQueueEntryDto } from "../types/worker.type";
import type { WorkerWorkStatus } from "../types/worker-status.type";

/* -------------------------------------- Functions -------------------------------------- */

// Map internal queue/assignment states to the 5 UI worker statuses.
export function resolveWorkerWorkStatus(
  queue: WorkerQueueEntryDto | null,
  assignment: VehicleJobAssignmentDto | null
): WorkerWorkStatus {
  if (queue?.status === "break") {
    return "break";
  }

  if (queue?.status === "ready" && assignment?.status === "DELIVERED") {
    return "ready";
  }

  if (assignment) {
    if (WORKING_ASSIGNMENT_STATUSES.includes(assignment.status)) {
      return "working";
    }

    return "assigned";
  }

  if (queue?.status === "ready") {
    return "ready";
  }

  if (queue?.status === "assigned" || queue?.status === "working") {
    return queue.status;
  }

  return "open_app";
}
