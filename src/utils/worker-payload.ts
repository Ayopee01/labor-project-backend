import type { VehicleJobAssignmentDto, VehicleJobDto, WorkerQueueEntryDto } from "../types/worker.type";
import { resolveWorkerWorkStatus } from "./worker-status";
import { toUnixMs } from "./time";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง worker assigned payload สำหรับ helper กลาง
//
// ไม่มี worker_qr_token เดี่ยวให้ส่งอีกต่อไป เพราะ QR check-in เป็นระดับ Business Ticket
// (หลายใบ) ไม่ใช่ระดับ TicketNumber แล้ว — client ต้อง re-fetch current job detail เอง
export function buildWorkerAssignedPayload(
  assignment: VehicleJobAssignmentDto,
  vehicleJob: VehicleJobDto
) {
  return {
    ticketNumber: vehicleJob.ticket_number,
    assignment: {
      created_at: assignment.created_at,
      accept_deadline_at: assignment.accept_deadline_at,
      accept_deadline_unix_ms: toUnixMs(assignment.accept_deadline_at),
    },
  };
}

// Function สร้าง worker queue socket payload สำหรับ helper กลาง
export function buildWorkerQueueSocketPayload(
  queueEntry: WorkerQueueEntryDto | null | undefined,
  workerCode: string | null,
  assignment: VehicleJobAssignmentDto | null = null
) {
  if (!queueEntry) {
    return null;
  }

  return {
    worker_code: workerCode,
    status: resolveWorkerWorkStatus(queueEntry, assignment),
    ...(queueEntry.ready_at ? { ready_at: queueEntry.ready_at } : {}),
    ...(queueEntry.break_until
      ? {
        break_until: queueEntry.break_until,
        break_until_unix_ms: toUnixMs(queueEntry.break_until),
      }
      : {}),
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
