// import
import { ACTIVE_ASSIGNMENT_STATUSES } from "../../constants/job-status";
import { mapVehicleJobAssignment } from "./mappers";
import { client, requireDto } from "./repository-utils";

// import Types
import type { DbConnection } from "../../types/common.type";
import type { VehicleJobAssignmentDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function นับ assignment ที่ยังถือว่า active ของงานรถ
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

// Function สร้าง assignment ให้คนงาน
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

// Function หา assignment ปัจจุบันของคนงาน
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

// Function หา assignment จาก id
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
