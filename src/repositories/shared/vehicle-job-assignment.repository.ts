// Import Dependencies
import { ACTIVE_ASSIGNMENT_STATUSES } from "../../constants/job-status";
import { mapVehicleJobAssignment } from "./mappers";
import { client, requireDto } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { VehicleJobAssignmentDto } from "../../types/worker.type";

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

// Function สร้าง assignment จาก DB
export async function createAssignment(
  vehicleJobId: number,
  workerAccountId: number,
  acceptDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.create({
    data: {
      vehicleJobId,
      workerAccountId,
      status: "PENDING",
      acceptDeadlineAt,
    },
  });

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
