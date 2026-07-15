import type { WorkerQueueEntryDto } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง payload ของ queue entry สำหรับ WebSocket/SSE โดยใช้ reference แทน id ภายใน
export function buildWorkerQueueSocketPayload(
  queueEntry: WorkerQueueEntryDto | null | undefined,
  workerCode: string | null
) {
  if (!queueEntry) {
    return null;
  }

  return {
    worker_code: workerCode,
    status: queueEntry.status,
    ...(queueEntry.ready_at ? { ready_at: queueEntry.ready_at } : {}),
    ...(queueEntry.break_until ? { break_until: queueEntry.break_until } : {}),
    created_at: queueEntry.created_at,
    updated_at: queueEntry.updated_at,
    ...(queueEntry.break_count_used !== undefined
      ? { break_count_used: queueEntry.break_count_used }
      : {}),
    ...(queueEntry.break_count_limit !== undefined
      ? { break_count_limit: queueEntry.break_count_limit }
      : {}),
  };
}
