import type { VehicleJobAssignmentDto, VehicleJobDto } from "../types/worker.type";

export function buildWorkerAssignedPayload(
  assignment: VehicleJobAssignmentDto,
  vehicleJob: VehicleJobDto
) {
  return {
    vehicle_job_ref: vehicleJob.vehicle_job_ref,
    gate_transaction_ref: vehicleJob.gate_transaction_ref,
    worker_qr_token: vehicleJob.worker_qr_token,
    assignment: {
      created_at: assignment.created_at,
      accept_deadline_at: assignment.accept_deadline_at,
    },
  };
}
