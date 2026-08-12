import {
  ACTIVE_ASSIGNMENT_STATUSES,
  TERMINAL_JOB_STATUSES,
  TERMINAL_TICKET_STATUSES,
  TICKET_STATUS,
  VEHICLE_JOB_STATUS,
} from "../../constants/job-status";
import { withTransaction } from "../../db/prisma";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../../types/shared/worker-assignment-event.type";
import * as ticketWorkerRepository from "../../repositories/shared/ticket-worker.repository";
import * as assignmentRepository from "../../repositories/shared/vehicle-job-assignment.repository";
import * as vehicleJobRepository from "../../repositories/shared/vehicle-job.repository";
import * as workerAssignmentEventRepository from "../../repositories/shared/worker-assignment-event.repository";

import type { DbConnection } from "../../types/shared/common.type";
import type {
  CompletedVehicleJobResult,
  CurrentTicketProgressDto,
  VehicleJobDto,
} from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

export async function activateNextTicketIfReady(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<CurrentTicketProgressDto | null> {
  const current = await vehicleJobRepository.findCurrentOpenTicketByVehicleJob(
    vehicleJobId,
    connection,
  );

  if (!current) {
    return null;
  }

  await vehicleJobRepository.updateMarketJobStatus(
    current.ticket.market_job_id,
    VEHICLE_JOB_STATUS.WORKING,
    connection,
  );

  const activatableTicketStatuses: string[] = [TICKET_STATUS.WAIT];

  if (!activatableTicketStatuses.includes(current.ticket.status)) {
    await ticketWorkerRepository.syncTicketWorkersFromVehicleAssignments(
      current.ticket.id,
      vehicleJobId,
      connection,
    );

    return current;
  }

  const ticket = await vehicleJobRepository.updateGateTicketStatus(
    current.ticket.id,
    TICKET_STATUS.WORKING,
    connection,
  );

  await ticketWorkerRepository.syncTicketWorkersFromVehicleAssignments(
    ticket.id,
    vehicleJobId,
    connection,
  );

  return {
    ...current,
    ticket,
  };
}

export async function markVehicleJobInProgress(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleJobDto> {
  const vehicleJob = await vehicleJobRepository.markVehicleJobInProgress(
    vehicleJobId,
    connection,
  );

  await activateNextTicketIfReady(vehicleJobId, connection);

  return vehicleJob;
}

export async function closeCompletedVehicleJobIfReady(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<CompletedVehicleJobResult | null> {
  if (!connection) {
    return withTransaction((transaction) =>
      closeCompletedVehicleJobIfReady(vehicleJobId, transaction),
    );
  }

  const vehicleJob = await vehicleJobRepository.findVehicleJobLifecycleState(
    vehicleJobId,
    connection,
  );

  if (!vehicleJob) {
    return null;
  }

  for (const market of vehicleJob.marketJobs) {
    const allTicketsTerminal =
      market.tickets.length > 0 &&
      market.tickets.every((ticket) =>
        TERMINAL_TICKET_STATUSES.includes(ticket.status),
      );

    if (allTicketsTerminal && !TERMINAL_JOB_STATUSES.includes(market.status)) {
      const marketStatus = market.tickets.every(
        (ticket) => ticket.status === TICKET_STATUS.CANCELLED,
      )
        ? VEHICLE_JOB_STATUS.CANCELLED
        : VEHICLE_JOB_STATUS.COMPLETED;

      await vehicleJobRepository.updateMarketJobStatus(
        market.id,
        marketStatus,
        connection,
      );
    }
  }

  const refreshedVehicleJob =
    await vehicleJobRepository.findVehicleJobLifecycleState(
      vehicleJobId,
      connection,
    );

  if (!refreshedVehicleJob) {
    return null;
  }

  const isVehicleComplete =
    refreshedVehicleJob.marketJobs.length > 0 &&
    refreshedVehicleJob.marketJobs.every(
      (market) =>
        TERMINAL_JOB_STATUSES.includes(market.status) &&
        market.tickets.length > 0 &&
        market.tickets.every((ticket) =>
          TERMINAL_TICKET_STATUSES.includes(ticket.status),
        ),
    );

  if (!isVehicleComplete) {
    return null;
  }

  const vehicleStatus = refreshedVehicleJob.marketJobs.every(
    (market) => market.status === VEHICLE_JOB_STATUS.CANCELLED,
  )
    ? VEHICLE_JOB_STATUS.CANCELLED
    : VEHICLE_JOB_STATUS.COMPLETED;
  const vehicleJobDto = TERMINAL_JOB_STATUSES.includes(
    refreshedVehicleJob.status,
  )
    ? await vehicleJobRepository.findVehicleJobById(vehicleJobId, connection)
    : await vehicleJobRepository.updateVehicleJobStatus(
        vehicleJobId,
        vehicleStatus,
        connection,
      );
  const activeAssignments = refreshedVehicleJob.assignments.filter(
    (assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
  );
  const completedAssignmentIds = activeAssignments.map(
    (assignment) => assignment.id,
  );
  const completedWorkerAccountIds = activeAssignments.map(
    (assignment) => assignment.workerAccountId,
  );

  if (completedAssignmentIds.length > 0) {
    const completedAt = new Date();

    await assignmentRepository.completeAssignments(
      completedAssignmentIds,
      completedAt,
      connection,
    );
    await workerAssignmentEventRepository.createManyOnce(
      activeAssignments.map((assignment) => ({
        assignment_id: assignment.id,
        worker_account_id: assignment.workerAccountId,
        vehicle_job_id: assignment.vehicleJobId,
        event_type: WORKER_ASSIGNMENT_EVENT_TYPE.COMPLETED,
        occurred_at: completedAt,
      })),
      connection,
    );
  }

  return vehicleJobDto
    ? {
        vehicle_job: vehicleJobDto,
        completed_assignment_ids: completedAssignmentIds,
        completed_worker_account_ids: completedWorkerAccountIds,
      }
    : null;
}
