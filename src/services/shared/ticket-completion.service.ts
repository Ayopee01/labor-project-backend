import * as profileRepository from "../../repositories/shared/profile.repository";
import * as assignmentRepository from "../../repositories/shared/vehicle-job-assignment.repository";
import * as gateTicketRepository from "../../repositories/shared/gate-ticket.repository";
import * as vehicleJobRepository from "../../repositories/shared/vehicle-job.repository";
import * as vehicleJobLifecycleService from "./vehicle-job-lifecycle.service";
import { finalizeTicketFinancials } from "./ticket-financial.service";
import { ASSIGNMENT_STATUS } from "../../constants/job-status";
import { resolveTicketResultAudience } from "./realtime-notification.service";

import type { DbConnection } from "../../types/shared/common.type";
import type {
  VendorTicketCompletionAction,
  VendorTicketCompletionFlowResult,
} from "../../types/line.type";
import type {
  GateTicketDto,
  TicketCompletionSubmissionDto,
} from "../../types/worker.type";

// Function ประมวลผล confirm/reject จาก vendor และเตรียม payload realtime กลาง
export async function applyVendorTicketCompletionResult(input: {
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
  action: VendorTicketCompletionAction;
  rejectReason?: string | null;
  resolvedByLineUserId?: string | null;
  connection: DbConnection;
}): Promise<VendorTicketCompletionFlowResult> {
  const isConfirmed = input.action === "confirm";
  const updated = isConfirmed
    ? await gateTicketRepository.confirmTicketCompletion(
        input.ticket.id,
        input.submission.id,
        input.connection,
        input.resolvedByLineUserId,
      )
    : await gateTicketRepository.rejectTicketCompletion(
        input.ticket.id,
        input.submission.id,
        input.rejectReason,
        input.connection,
        input.resolvedByLineUserId,
      );

  const financial = isConfirmed
    ? await finalizeTicketFinancials(updated.ticket.id, input.connection)
    : null;

  const completedVehicleJob = isConfirmed
    ? await vehicleJobLifecycleService.closeCompletedVehicleJobIfReady(
        updated.ticket.vehicle_job_id,
        input.connection,
      )
    : null;
  const nextTicket =
    isConfirmed && !completedVehicleJob
      ? await vehicleJobLifecycleService.activateNextTicketIfReady(
          updated.ticket.vehicle_job_id,
          input.connection,
        )
      : null;

  if (isConfirmed && !completedVehicleJob) {
    await assignmentRepository.markVehicleAssignmentsWorking(
      updated.ticket.vehicle_job_id,
      input.connection,
    );
  }

  if (!isConfirmed) {
    await assignmentRepository.markVehicleAssignmentsRejected(
      updated.ticket.vehicle_job_id,
      input.connection,
    );
  }

  const [receiverAccountIds, products, detail] = await Promise.all([
    resolveTicketResultAudience(updated.ticket, input.connection),
    gateTicketRepository.listTicketProducts(
      updated.ticket.id,
      input.connection,
    ),
    vehicleJobRepository.getVehicleJobDetail(
      updated.ticket.vehicle_job_id,
      input.connection,
    ),
  ]);
  const completedWorkerCodes = completedVehicleJob
    ? await profileRepository.findWorkerCodesByAccountIds(
        completedVehicleJob.completed_worker_account_ids,
        input.connection,
      )
    : [];
  const assignmentStatus = isConfirmed
    ? completedVehicleJob
      ? ASSIGNMENT_STATUS.COMPLETED
      : ASSIGNMENT_STATUS.WORKING
    : ASSIGNMENT_STATUS.REJECT;

  return {
    ...updated,
    products,
    detail,
    financial,
    completedVehicleJob,
    completedWorkerCodes,
    nextTicket,
    receiverAccountIds,
    assignmentStatus,
    isConfirmed,
    title: isConfirmed
      ? "Ticket completion confirmed"
      : "Ticket completion rejected",
    message: isConfirmed
      ? `Vendor confirmed ticket ${updated.ticket.boothCode}.`
      : `Vendor rejected ticket ${updated.ticket.boothCode}.`,
  };
}
