// Import Dependencies
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS,
  FINISHED_ASSIGNMENT_STATUSES,
  SCANNED_ASSIGNMENT_STATUSES,
  WORKING_ASSIGNMENT_STATUSES,
} from "../../constants/job-status";
import { withTransaction } from "../../db/prisma";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../../types/shared/worker-assignment-event.type";
import * as workerAssignmentEventRepository from "./worker-assignment-event.repository";
import { mapVehicleJobAssignment } from "./mappers";
import { client, requireDto } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { WorkerAssignmentEventType } from "../../types/shared/worker-assignment-event.type";
import type {
  VehicleJobAssignmentDto,
  WorkerAssignmentTeamMemberDto,
} from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function นับ active assignments จาก DB
export async function countActiveAssignments(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  return db.vehicleJobAssignment.count({
    where: {
      vehicleJobId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
    },
  });
}

export async function getWorkerDailyAssignmentCounts(
  workerAccountId: number,
  startAt: Date,
  endAt: Date,
  connection?: DbConnection,
): Promise<{
  today_job_count: number;
  completed_job_count: number;
}> {
  const db = client(connection);
  const [todayJobCount, completedJobCount] = await Promise.all([
    db.vehicleJobAssignment.count({
      where: {
        workerAccountId,
        createdAt: {
          gte: startAt,
          lt: endAt,
        },
        status: {
          not: ASSIGNMENT_STATUS.TIMEOUT,
        },
      },
    }),
    db.vehicleJobAssignment.count({
      where: {
        workerAccountId,
        createdAt: {
          gte: startAt,
          lt: endAt,
        },
        OR: [
          {
            status: ASSIGNMENT_STATUS.COMPLETED,
          },
          {
            completedAt: {
              not: null,
            },
          },
        ],
      },
    }),
  ]);

  return {
    today_job_count: todayJobCount,
    completed_job_count: completedJobCount,
  };
}

// Function สร้าง assignment จาก DB
export async function createAssignment(
  vehicleJobId: number,
  workerAccountId: number,
  acceptDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  if (!connection) {
    return withTransaction((transaction) =>
      createAssignment(vehicleJobId, workerAccountId, acceptDeadlineAt, transaction)
    );
  }

  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.create({
    data: {
      vehicleJobId,
      workerAccountId,
      status: "PENDING",
      acceptDeadlineAt,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_account_id: assignment.workerAccountId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.ASSIGNED,
      occurred_at: assignment.createdAt,
    },
    connection
  );

  return requireDto(mapVehicleJobAssignment(assignment), "assignment create");
}

// Function ค้นหา current assignment ตาม worker จาก DB
export async function findCurrentAssignmentByWorker(
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
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapVehicleJobAssignment(assignment);
}

// Function ค้นหา assignment ตาม ID จาก DB
export async function findAssignmentById(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findUnique({
    where: {
      id: assignmentId,
    },
  });

  return mapVehicleJobAssignment(assignment);
}

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

function buildAssignmentScanStatus(assignment: VehicleJobAssignmentDto): string {
  if (assignment.status === ASSIGNMENT_STATUS.COMPLETED || assignment.completed_at) {
    return "completed";
  }

  if (WORKING_ASSIGNMENT_STATUSES.includes(assignment.status) || assignment.scanned_at) {
    return "scanned";
  }

  if (assignment.status === ASSIGNMENT_STATUS.ACCEPTED || assignment.accepted_at) {
    return "accepted";
  }

  return "pending";
}

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
      worker: true,
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
      shirt_number: assignment.worker.shirtNumber ?? null,
      image_url: assignment.worker.imageUrl ?? null,
      scan_status: buildAssignmentScanStatus(assignmentDto),
      scanned_at: assignmentDto.scanned_at,
    };
  });
}

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

export async function acceptAssignment(
  assignmentId: number,
  scanDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  if (!connection) {
    return withTransaction((transaction) =>
      acceptAssignment(assignmentId, scanDeadlineAt, transaction)
    );
  }

  const db = client(connection);
  const acceptedAt = new Date();
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: ASSIGNMENT_STATUS.ACCEPTED,
      acceptedAt,
      scanDeadlineAt,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_account_id: assignment.workerAccountId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPTED,
      occurred_at: acceptedAt,
    },
    connection
  );

  return requireDto(mapVehicleJobAssignment(assignment), "assignment accept");
}

export async function listAcceptedAssignmentsByVehicleJob(
  vehicleJobId: number,
  excludedAssignmentId?: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: ASSIGNMENT_STATUS.ACCEPTED,
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
  eventType: Extract<
    WorkerAssignmentEventType,
    "ACCEPT_TIMEOUT" | "SCAN_TIMEOUT"
  >,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  if (!connection) {
    return withTransaction((transaction) =>
      timeoutAssignment(assignmentId, eventType, transaction)
    );
  }

  const db = client(connection);
  const occurredAt = new Date();
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: ASSIGNMENT_STATUS.TIMEOUT,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_account_id: assignment.workerAccountId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: eventType,
      occurred_at: occurredAt,
    },
    connection
  );

  return requireDto(mapVehicleJobAssignment(assignment), "assignment timeout");
}

export async function scanAssignment(
  assignmentId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  if (!connection) {
    return withTransaction((transaction) => scanAssignment(assignmentId, transaction));
  }

  const db = client(connection);
  const scannedAt = new Date();
  const assignment = await db.vehicleJobAssignment.update({
    where: {
      id: assignmentId,
    },
    data: {
      status: ASSIGNMENT_STATUS.SCANNED,
      scannedAt,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_account_id: assignment.workerAccountId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.SCANNED,
      occurred_at: scannedAt,
    },
    connection
  );

  return requireDto(mapVehicleJobAssignment(assignment), "assignment scan");
}

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
      status: ASSIGNMENT_STATUS.DELIVERED,
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
      status: ASSIGNMENT_STATUS.REJECT,
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
      status: ASSIGNMENT_STATUS.WORKING,
    },
  });

  return result.count;
}

export async function completeAssignments(
  assignmentIds: number[],
  completedAt: Date,
  connection?: DbConnection,
): Promise<number> {
  if (assignmentIds.length === 0) {
    return 0;
  }

  const db = client(connection);
  const result = await db.vehicleJobAssignment.updateMany({
    where: {
      id: {
        in: assignmentIds,
      },
    },
    data: {
      status: ASSIGNMENT_STATUS.COMPLETED,
      completedAt,
    },
  });

  return result.count;
}
