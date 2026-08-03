import type { VehicleJobAssignmentDto, VehicleJobDto } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้าง worker assigned payload สำหรับ helper กลาง
export function buildWorkerAssignedPayload(
  assignment: VehicleJobAssignmentDto,
  vehicleJob: VehicleJobDto
) {
  return {
    ticketNo: vehicleJob.ticketNo,
    gate_transaction_ref: vehicleJob.gate_transaction_ref,
    worker_qr_token: vehicleJob.worker_qr_token,
    assignment: {
      created_at: assignment.created_at,
      accept_deadline_at: assignment.accept_deadline_at,
    },
  };
}
