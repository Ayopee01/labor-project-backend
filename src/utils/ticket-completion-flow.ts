import * as workerApplicationRepository from "../repositories/worker.repository";
import { finalizeTicketFinancials } from "../services/ticket-financial.service";
import { ASSIGNMENT_STATUS } from "../constants/job-status";
import { buildTicketResultAudience } from "./ticket-audience";
import { getWorkerCodesByAccountIds } from "./worker-identity";

import type { DbConnection } from "../types/shared/common.type";
import type { VendorTicketCompletionAction, VendorTicketCompletionFlowResult } from "../types/line.type";
import type {
  GateTicketDto,
  TicketCompletionSubmissionDto,
} from "../types/worker.type";

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
    ? await workerApplicationRepository.confirmTicketCompletion(
      input.ticket.id,
      input.submission.id,
      input.connection,
      input.resolvedByLineUserId
    )
    : await workerApplicationRepository.rejectTicketCompletion(
      input.ticket.id,
      input.submission.id,
      input.rejectReason,
      input.connection,
      input.resolvedByLineUserId
    );

  const financial = isConfirmed
    ? await finalizeTicketFinancials(
      updated.ticket.id,
      input.connection
    )
    : null;

  const completedVehicleJob = isConfirmed
    ? await workerApplicationRepository.closeCompletedVehicleJobIfReady(
      updated.ticket.vehicle_job_id,
      input.connection
    )
    : null;
  const nextTicket = isConfirmed && !completedVehicleJob
    ? await workerApplicationRepository.activateNextTicketIfReady(
      updated.ticket.vehicle_job_id,
      input.connection
    )
    : null;

  if (isConfirmed && !completedVehicleJob) {
    await workerApplicationRepository.markVehicleAssignmentsWorking(
      updated.ticket.vehicle_job_id,
      input.connection
    );
  }

  if (!isConfirmed) {
    await workerApplicationRepository.markVehicleAssignmentsRejected(
      updated.ticket.vehicle_job_id,
      input.connection
    );
  }

  const [receiverAccountIds, products, detail] = await Promise.all([
    buildTicketResultAudience(updated.ticket, input.connection),
    workerApplicationRepository.listTicketProducts(updated.ticket.id, input.connection),
    workerApplicationRepository.getVehicleJobDetail(
      updated.ticket.vehicle_job_id,
      input.connection
    ),
  ]);
  const completedWorkerCodes = completedVehicleJob
    ? await getWorkerCodesByAccountIds(
      completedVehicleJob.completed_worker_account_ids,
      input.connection
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
