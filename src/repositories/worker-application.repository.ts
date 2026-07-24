// import
import * as accountRepository from "./shared/account.repository";
import * as profileRepository from "./shared/profile.repository";
import * as workScheduleRepository from "./shared/work-schedule.repository";
import { ACTIVE_ASSIGNMENT_STATUSES, FINISHED_ASSIGNMENT_STATUSES, SCANNED_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_STATUS, VEHICLE_JOB_STATUS, WORKING_ASSIGNMENT_STATUSES } from "../constants/job-status";
import { mapGateTicket, mapTicketCompletionSubmission, mapTicketProduct, mapTicketWorker, mapVehicleJob, mapVehicleJobAssignment } from "./shared/mappers";
import { client, requireDto } from "./shared/repository-utils";
export { findVehicleJobById, findVehicleJobByRef, getVehicleJobDetail } from "./shared/vehicle-job.repository";
export { countActiveAssignments, createAssignment, findAssignmentById, findCurrentAssignmentByWorker } from "./shared/vehicle-job-assignment.repository";
export { listTicketWorkers } from "./shared/ticket-worker.repository";

// import Types
import type { DbConnection } from "../types/common.type";
import type { CurrentTicketProgressDto, GateTicketDto, TicketCompletionSubmissionDto, TicketProductConfirmationInput, TicketProductDto, TicketWorkerDto, VehicleJobAssignmentDto, VehicleJobDto, VehicleWorkReadinessDto, WorkerAssignmentHistoryItemDto, WorkerAssignmentTeamMemberDto } from "../types/worker.type";

export { accountRepository, profileRepository, workScheduleRepository };

/* -------------------------------------- Functions -------------------------------------- */

// Function เน€เธเธฅเธตเนเธขเธเธเธฒเธเธฃเธ–เน€เธเนเธเน€เธฃเธดเนเธกเธ—เธณเธเธฒเธเธซเธฅเธฑเธเธเธเธเธฒเธ scan เธเธฃเธ
export async function markVehicleJobInProgress(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<VehicleJobDto> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.update({
    where: {
      id: vehicleJobId,
    },
    data: {
      status: VEHICLE_JOB_STATUS.WORKING,
    },
  });

  await activateNextTicketIfReady(vehicleJobId, connection);

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job progress");
}

// Find the first non-terminal ticket by gate creation order.
export async function findCurrentOpenTicketByVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<CurrentTicketProgressDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
    },
    include: {
      marketJobs: {
        orderBy: {
          id: "asc",
        },
        include: {
          tickets: {
            orderBy: {
              id: "asc",
            },
          },
        },
      },
    },
  });

  if (!vehicleJob) {
    return null;
  }

  for (const market of vehicleJob.marketJobs) {
    const ticket = market.tickets.find(
      (candidate) => !TERMINAL_TICKET_STATUSES.includes(candidate.status)
    );

    if (!ticket) {
      continue;
    }

    return {
      ticket: requireDto(mapGateTicket(ticket), "current gate ticket"),
      marketCode: market.marketCode,
      marketName: market.marketName,
    };
  }

  return null;
}

export async function getVehicleWorkReadiness(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<VehicleWorkReadinessDto> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
    },
    select: {
      workersRequired: true,
    },
  });
  const workersRequired = vehicleJob?.workersRequired ?? 0;
  const checkedInCount = await countScannedAssignments(vehicleJobId, connection);
  const remainingCount = Math.max(0, workersRequired - checkedInCount);

  return {
    workers_required: workersRequired,
    checked_in_count: checkedInCount,
    remaining_count: remainingCount,
    is_ready: workersRequired > 0 && checkedInCount >= workersRequired,
  };
}

export async function activateNextTicketIfReady(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<CurrentTicketProgressDto | null> {
  const db = client(connection);
  const current = await findCurrentOpenTicketByVehicleJob(vehicleJobId, connection);

  if (!current) {
    return null;
  }

  await db.marketJob.update({
    where: {
      id: current.ticket.market_job_id,
    },
    data: {
      status: VEHICLE_JOB_STATUS.WORKING,
    },
  });

  const activatableTicketStatuses: string[] = [TICKET_STATUS.WAIT];

  if (!activatableTicketStatuses.includes(current.ticket.status)) {
    return current;
  }

  const ticket = await db.gateTicket.update({
    where: {
      id: current.ticket.id,
    },
    data: {
      status: TICKET_STATUS.WORKING,
    },
  });

  return {
    ...current,
    ticket: requireDto(mapGateTicket(ticket), "activated gate ticket"),
  };
}

// Function เธ”เธถเธ assignment เธ—เธตเนเธซเธกเธ”เน€เธงเธฅเธฒเธฃเธฑเธเธเธฒเธเนเธฅเนเธง
// Function เธ”เธถเธเธเธฒเธเธฃเธ–เธ—เธตเนเธเธฃเนเธญเธก dispatch เธ•เธฒเธกเธฅเธณเธ”เธฑเธเธเธฒเธฃเธชเธฃเนเธฒเธ
export async function listDispatchableVehicleJobs(
  connection?: DbConnection
): Promise<VehicleJobDto[]> {
  const db = client(connection);
  const vehicleJobs = await db.vehicleJob.findMany({
    where: {
      status: VEHICLE_JOB_STATUS.WORKING,
    },
    orderBy: {
      id: "asc",
    },
  });

  return vehicleJobs
    .map((vehicleJob) => mapVehicleJob(vehicleJob))
    .filter((vehicleJob): vehicleJob is VehicleJobDto => vehicleJob !== null);
}

// Function เธเธฑเธ assignment เธ—เธตเน scan เนเธฅเนเธงเธเธญเธเธเธฒเธเธฃเธ–
export async function countScannedAssignments(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  return db.vehicleJobAssignment.count({
    where: {
      vehicleJobId,
      status: {
        in: SCANNED_ASSIGNMENT_STATUSES,
      },
    },
  });
}

// Function เนเธเธฅเธเธชเธ–เธฒเธเธฐ scan เธเธญเธ assignment เน€เธเนเธเธเนเธฒเธ—เธตเน UI เนเธเนเนเธชเธ”เธเธ—เธตเธกเนเธเธเธฒเธเธฃเธ–
function buildAssignmentScanStatus(assignment: VehicleJobAssignmentDto): string {
  if (assignment.status === "COMPLETED" || assignment.completed_at) {
    return "completed";
  }

  if (WORKING_ASSIGNMENT_STATUSES.includes(assignment.status) || assignment.scanned_at) {
    return "scanned";
  }

  if (assignment.status === "ACCEPTED" || assignment.accepted_at) {
    return "accepted";
  }

  return "pending";
}

// Function เธ”เธถเธเธฃเธฒเธขเธเธทเนเธญเธ—เธตเธก worker เนเธเธเธฒเธเธฃเธ–เธเธฃเนเธญเธกเธชเธ–เธฒเธเธฐ scan
export async function listVehicleJobAssignmentTeam(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<WorkerAssignmentTeamMemberDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: FINISHED_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "asc",
    },
    include: {
      worker: {
        include: {
          profile: true,
        },
      },
    },
  });

  return assignments.map((assignment) => {
    const assignmentDto = requireDto(
      mapVehicleJobAssignment(assignment),
      "vehicle job assignment"
    );

    return {
      full_name: assignment.worker.fullName,
      worker_code: assignment.worker.username,
      image_url: assignment.worker.profile?.imageUrl ?? null,
      scan_status: buildAssignmentScanStatus(assignmentDto),
    };
  });
}

// Function เธ”เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธเธเธญเธ worker เธ•เธฒเธกเธเนเธงเธเธงเธฑเธเธ—เธตเนเธ—เธตเนเธฃเธฐเธเธธ
export async function listWorkerAssignmentHistoryByDate(
  workerAccountId: number,
  startAt: Date,
  endAt: Date,
  connection?: DbConnection
): Promise<WorkerAssignmentHistoryItemDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      workerAccountId,
      createdAt: {
        gte: startAt,
        lt: endAt,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      vehicleJob: true,
    },
  });

  return assignments.map((assignment) => ({
    assignment: requireDto(mapVehicleJobAssignment(assignment), "assignment"),
    vehicle_job: requireDto(mapVehicleJob(assignment.vehicleJob), "vehicle job"),
  }));
}

// Function เธซเธฒ assignment เธเธฒเธ id เนเธฅเธฐ worker
export async function findAssignmentByIdAndWorker(
  assignmentId: number,
  workerAccountId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      id: assignmentId,
      workerAccountId,
    },
  });

  return mapVehicleJobAssignment(assignment);
}

// Function เธซเธฒ assignment เธเธฑเธเธเธธเธเธฑเธเธเธญเธ worker เธ”เนเธงเธข ticketNo
export async function findCurrentAssignmentByVehicleJobRefAndWorker(
  ticketNo: string,
  workerAccountId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      workerAccountId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
      vehicleJob: {
        ticketNo,
      },
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapVehicleJobAssignment(assignment);
}

// Function เน€เธเธฅเธตเนเธขเธ assignment เน€เธเนเธเธฃเธฑเธเธเธฒเธเนเธฅเนเธงเนเธฅเธฐเธเธณเธซเธเธ”เน€เธงเธฅเธฒ scan QR
export async function acceptAssignment(
  assignmentId: number,
  scanDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      scanDeadlineAt,
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment accept");
}

// Function เน€เธเธฅเธตเนเธขเธ assignment เน€เธเนเธเธซเธกเธ”เน€เธงเธฅเธฒเธฃเธฑเธเธเธฒเธ
export async function listAcceptedAssignmentsByVehicleJob(
  vehicleJobId: number,
  excludedAssignmentId?: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: "ACCEPTED",
      ...(excludedAssignmentId
        ? {
            id: {
              not: excludedAssignmentId,
            },
          }
        : {}),
    },
    orderBy: {
      id: "asc",
    },
  });

  return assignments
    .map((assignment) => mapVehicleJobAssignment(assignment))
    .filter((assignment): assignment is VehicleJobAssignmentDto => assignment !== null);
}

export async function updateAssignmentScanDeadline(
  assignmentId: number,
  scanDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      scanDeadlineAt,
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment scan deadline");
}

export async function timeoutAssignment(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: "TIMEOUT",
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment timeout");
}

// Function เน€เธเธฅเธตเนเธขเธ assignment เน€เธเนเธ scan เธชเธณเน€เธฃเนเธ
export async function scanAssignment(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: "SCANNED",
      scannedAt: new Date(),
    },
  });

  return requireDto(mapVehicleJobAssignment(assignment), "assignment scan");
}

// Function เธ”เธถเธ gate ticket เธเธฃเนเธญเธกเธเนเธญเธกเธนเธฅ vendor เธชเธณเธซเธฃเธฑเธ flow เธเธดเธ”เธเธฒเธ
export async function findGateTicketForCompletion(
  ticketId: number,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findUnique({
    where: {
      id: ticketId,
    },
  });

  return mapGateTicket(ticket);
}

// Function เธซเธฒ gate ticket เธ”เนเธงเธข boothCode เธซเธฃเธทเธญ ticketNo เธชเธณเธซเธฃเธฑเธ worker เธเธดเธ”เธเธฒเธ
export async function findGateTicketForCompletionByReference(
  reference: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      boothCode: reference,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapGateTicket(ticket);
}

// Function เธ”เธถเธเธฃเธฒเธขเธเธฒเธฃเธชเธดเธเธเนเธฒเนเธ ticket เธ•เธฒเธกเธฅเธณเธ”เธฑเธเธ—เธตเนเธชเธฃเนเธฒเธ
export async function listTicketProducts(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketProductDto[]> {
  const db = client(connection);
  const products = await db.ticketProduct.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return products
    .map((product) => mapTicketProduct(product))
    .filter((product): product is TicketProductDto => product !== null);
}

// Function เธชเธฃเนเธฒเธ ticket workers เธเธฒเธ assignment เธเธญเธเธฃเธ– เธ–เนเธฒเธขเธฑเธเนเธกเนเธกเธต mapping เธฃเธฐเธ”เธฑเธ ticket
export async function updateTicketProductConfirmations(
  ticketId: number,
  items: TicketProductConfirmationInput[],
  connection?: DbConnection
): Promise<TicketProductDto[]> {
  const db = client(connection);

  for (const item of items) {
    const result = await db.ticketProduct.updateMany({
      where: {
        ticketId,
        productCode: item.productCode,
      },
      data: {
        confirmedQuantity: item.confirmed_quantity,
      },
    });

    if (result.count !== 1) {
      throw new Error("Ticket product confirmation did not update a product.");
    }
  }

  return listTicketProducts(ticketId, connection);
}

// Function เธชเธฃเนเธฒเธ ticket worker เธเธฒเธ assignment เธเธญเธเธเธฒเธเธฃเธ–เน€เธกเธทเนเธญเธขเธฑเธเนเธกเนเธกเธต mapping เธฃเธฐเธ”เธฑเธ ticket
export async function ensureTicketWorkersFromVehicleAssignments(
  ticketId: number,
  vehicleJobId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const existingWorkers = await db.ticketWorker.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  if (existingWorkers.length > 0) {
    return existingWorkers
      .map((worker) => mapTicketWorker(worker))
      .filter((worker): worker is TicketWorkerDto => worker !== null);
  }

  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: SCANNED_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  if (assignments.length === 0) {
    return [];
  }

  await db.ticketWorker.createMany({
    data: assignments.map((assignment) => ({
      ticketId,
      workerAccountId: assignment.workerAccountId,
      status: "WORKING",
    })),
    skipDuplicates: true,
  });

  const workers = await db.ticketWorker.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return workers
    .map((worker) => mapTicketWorker(worker))
    .filter((worker): worker is TicketWorkerDto => worker !== null);
}

// Function เน€เธเธฅเธตเนเธขเธ ticket เน€เธเนเธเธฃเธญ vendor เธ•เธฃเธงเธ เนเธ”เธขเธเธฑเธเธเธฒเธฃเธชเนเธเธขเธญเธ”เธเนเธณเธเธฒเธเธซเธฅเธฒเธข worker
export async function markTicketDelivered(
  ticketId: number,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const result = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: {
        in: [TICKET_STATUS.WAIT, TICKET_STATUS.WORKING, TICKET_STATUS.REJECT],
      },
    },
    data: {
      status: "DELIVERED",
      confirmationStatus: "DELIVERED",
      rejectReason: null,
    },
  });

  return result.count === 1;
}

// Function เธชเธฃเนเธฒเธ submission เธเธฒเธฃเธชเนเธเธขเธญเธ”เธเธดเธ”เธเธฒเธเธเธญเธ ticket
export async function createTicketCompletionSubmission(
  ticketId: number,
  workerAccountId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.create({
    data: {
      ticketId,
      submittedByWorkerAccountId: workerAccountId,
      status: "DELIVERED",
    },
  });

  return requireDto(
    mapTicketCompletionSubmission(submission),
    "ticket completion submission create"
  );
}

// Function เธ”เธถเธ submission เธฅเนเธฒเธชเธธเธ”เธ—เธตเนเธฃเธญ vendor confirm/reject
export async function markVehicleAssignmentsDelivered(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: WORKING_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: "DELIVERED",
    },
  });

  return result.count;
}

export async function markVehicleAssignmentsRejected(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: WORKING_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: "REJECT",
    },
  });

  return result.count;
}

export async function markVehicleAssignmentsWorking(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      vehicleJobId,
      status: {
        in: WORKING_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: "WORKING",
    },
  });

  return result.count;
}

export async function findWaitingTicketCompletionSubmission(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto | null> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.findFirst({
    where: {
      ticketId,
      status: "DELIVERED",
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapTicketCompletionSubmission(submission);
}

// Function เธขเธทเธเธขเธฑเธเธเธฒเธฃเธเธดเธ” ticket เธเธฒเธ vendor
export async function confirmTicketCompletion(
  ticketId: number,
  submissionId: number,
  connection?: DbConnection
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: "DELIVERED",
    },
    data: {
      status: "COMPLETED",
      confirmationStatus: "COMPLETED",
    },
  });

  if (updateResult.count !== 1) {
    throw new Error("Ticket confirm did not update a waiting ticket.");
  }

  await db.ticketWorker.updateMany({
    where: {
      ticketId,
    },
    data: {
      status: "COMPLETED",
    },
  });

  const [ticket, submission] = await Promise.all([
    db.gateTicket.findUnique({
      where: {
        id: ticketId,
      },
    }),
    db.ticketCompletionSubmission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: "COMPLETED",
        confirmedAt: new Date(),
      },
    }),
  ]);

  return {
    ticket: requireDto(mapGateTicket(ticket), "ticket confirm"),
    submission: requireDto(
      mapTicketCompletionSubmission(submission),
      "ticket submission confirm"
    ),
  };
}

// Function reject เธเธฒเธฃเธเธดเธ” ticket เธเธฒเธ vendor เน€เธเธทเนเธญเนเธซเน worker เธชเนเธเธขเธญเธ”เนเธซเธกเนเนเธ”เน
export async function closeCompletedVehicleJobIfReady(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<{
  vehicle_job: VehicleJobDto;
  completed_assignment_ids: number[];
  completed_worker_account_ids: number[];
} | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
    },
    include: {
      marketJobs: {
        include: {
          tickets: true,
        },
      },
    },
  });

  if (!vehicleJob) {
    return null;
  }

  for (const market of vehicleJob.marketJobs) {
    const allTicketsTerminal =
      market.tickets.length > 0 &&
      market.tickets.every((ticket) =>
        TERMINAL_TICKET_STATUSES.includes(ticket.status)
      );

    if (allTicketsTerminal && !TERMINAL_JOB_STATUSES.includes(market.status)) {
      const marketStatus = market.tickets.every(
        (ticket) => ticket.status === "CANCELLED"
      )
        ? "CANCELLED"
        : "COMPLETED";

      await db.marketJob.update({
        where: {
          id: market.id,
        },
        data: {
          status: marketStatus,
        },
      });
    }
  }

  const refreshedVehicleJob = await db.vehicleJob.findUnique({
    where: {
      id: vehicleJobId,
    },
    include: {
      marketJobs: {
        include: {
          tickets: true,
        },
      },
      assignments: true,
    },
  });

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
          TERMINAL_TICKET_STATUSES.includes(ticket.status)
        )
    );

  if (!isVehicleComplete) {
    return null;
  }

  const vehicleStatus = refreshedVehicleJob.marketJobs.every(
    (market) => market.status === "CANCELLED"
  )
    ? "CANCELLED"
    : "COMPLETED";

  const updatedVehicleJob = TERMINAL_JOB_STATUSES.includes(refreshedVehicleJob.status)
    ? refreshedVehicleJob
    : await db.vehicleJob.update({
        where: {
          id: vehicleJobId,
        },
        data: {
          status: vehicleStatus,
        },
      });
  const activeAssignments = refreshedVehicleJob.assignments.filter((assignment) =>
    ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)
  );
  const completedAssignmentIds = activeAssignments.map((assignment) => assignment.id);
  const completedWorkerAccountIds = activeAssignments.map(
    (assignment) => assignment.workerAccountId
  );

  if (completedAssignmentIds.length > 0) {
    await db.vehicleJobAssignment.updateMany({
      where: {
        id: {
          in: completedAssignmentIds,
        },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  return {
    vehicle_job: requireDto(mapVehicleJob(updatedVehicleJob), "vehicle job close"),
    completed_assignment_ids: completedAssignmentIds,
    completed_worker_account_ids: completedWorkerAccountIds,
  };
}

// Function reject เธขเธญเธ”เธเธดเธ”เธเธฒเธเธเธฒเธ vendor เนเธฅเธฐเน€เธเธดเธ” ticket เนเธซเน worker เธชเนเธเธขเธญเธ”เนเธซเธกเน
export async function rejectTicketCompletion(
  ticketId: number,
  submissionId: number,
  rejectReason?: string | null,
  connection?: DbConnection
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: "DELIVERED",
    },
    data: {
      status: "REJECT",
      confirmationStatus: "REJECT",
      rejectReason: rejectReason ?? null,
    },
  });

  if (updateResult.count !== 1) {
    throw new Error("Ticket reject did not update a waiting ticket.");
  }

  await db.ticketWorker.updateMany({
    where: {
      ticketId,
    },
    data: {
      status: "REJECT",
    },
  });

  const [ticket, submission] = await Promise.all([
    db.gateTicket.findUnique({
      where: {
        id: ticketId,
      },
    }),
    db.ticketCompletionSubmission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: "REJECT",
        rejectedAt: new Date(),
      },
    }),
  ]);

  return {
    ticket: requireDto(mapGateTicket(ticket), "ticket reject"),
    submission: requireDto(
      mapTicketCompletionSubmission(submission),
      "ticket submission reject"
    ),
  };
}

