// Import Dependencies
import { ACCEPTED_ASSIGNMENT_STATUSES, ACTIVE_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS, FINISHED_ASSIGNMENT_STATUSES, RELEASABLE_ASSIGNMENT_STATUSES, SCANNED_ASSIGNMENT_STATUSES, WORKING_ASSIGNMENT_STATUSES } from "../../constants/status";
import { withTransaction } from "../../db/prisma";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../../types/shared/worker-assignment-event.type";
import * as workerAssignmentEventRepository from "./worker-assignment-event.repository";
import { mapVehicleJobAssignment } from "./mappers";
import { client, requireDto } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { WorkerAssignmentEventType } from "../../types/shared/worker-assignment-event.type";
import type { VehicleJobAssignmentDto, VehicleWorkReadinessDto, WorkerAssignmentTeamRawMemberDto } from "../../types/worker.type";

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

// Function นับจำนวนงานของ worker ในวันที่ระบุ (ไม่นับ TIMEOUT) และจำนวนที่ทำเสร็จแล้ว
export async function getWorkerDailyAssignmentCounts(
  workerId: number,
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
        workerId,
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
        workerId,
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
  workerId: number,
  acceptDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto> {
  if (!connection) {
    return withTransaction((transaction) =>
      createAssignment(vehicleJobId, workerId, acceptDeadlineAt, transaction)
    );
  }

  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.create({
    data: {
      vehicleJobId,
      workerId,
      status: ASSIGNMENT_STATUS.PENDING,
      acceptDeadlineAt,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_id: assignment.workerId,
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
  workerId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      workerId,
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

// Function นับ scanned assignments จาก DB
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

// Function นับ assignment ที่ worker กด Accept งานแล้ว (ไม่ว่าจะ scan ต่อหรือยัง)
export async function countAcceptedAssignments(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<number> {
  const db = client(connection);
  return db.vehicleJobAssignment.count({
    where: {
      vehicleJobId,
      status: {
        in: ACCEPTED_ASSIGNMENT_STATUSES,
      },
    },
  });
}

// Function ตรวจความพร้อมของทีมงาน (scan ครบตามจำนวนที่ต้องการหรือยัง) ของ VehicleJob
export async function getVehicleJobTeamScanReadiness(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleWorkReadinessDto> {
  const db = client(connection);
  // เทียบกับ workersRequired ไม่ใช่จำนวน assignment ที่สร้างจริง กันเข้าใจผิดว่าทีมพร้อมทั้งที่ dispatch ยังหา worker ไม่ครบ
  const [vehicleJob, checkedInCount] = await Promise.all([
    db.vehicleJob.findUnique({
      where: {
        id: vehicleJobId,
      },
      select: {
        workersRequired: true,
      },
    }),
    db.vehicleJobAssignment.count({
      where: {
        vehicleJobId,
        status: {
          in: SCANNED_ASSIGNMENT_STATUSES,
        },
      },
    }),
  ]);
  const workersRequired = vehicleJob?.workersRequired ?? 0;
  const remainingCount = Math.max(0, workersRequired - checkedInCount);

  return {
    workers_required: workersRequired,
    checked_in_count: checkedInCount,
    remaining_count: remainingCount,
    is_ready: workersRequired > 0 && checkedInCount >= workersRequired,
  };
}

// Function ดึงทีม assignment ของ VehicleJob จาก DB ดิบๆ ไม่คำนวณ scan_status ที่นี่ (ดู buildAssignmentScanStatus ใน worker.service.ts)
export async function listVehicleJobAssignmentTeam(
  vehicleJobId: number,
  connection?: DbConnection
): Promise<WorkerAssignmentTeamRawMemberDto[]> {
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
      worker_id: assignment.workerId,
      full_name: assignment.worker.fullName ?? assignment.worker.name ?? assignment.worker.laborCode,
      worker_code: assignment.worker.laborCode,
      coat_no: assignment.worker.coatNo ?? null,
      image_url: assignment.worker.imageUrl,
      status: assignmentDto.status,
      completed_at: assignmentDto.completed_at,
      accepted_at: assignmentDto.accepted_at,
      scanned_at: assignmentDto.scanned_at,
    };
  });
}

// Function ค้นหา current assignment ของ worker ใน VehicleJob ตาม TicketNumber จาก DB
export async function findCurrentAssignmentByVehicleJobRefAndWorker(
  ticketNumber: string,
  workerId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      workerId,
      status: {
        in: ACTIVE_ASSIGNMENT_STATUSES,
      },
      vehicleJob: {
        ticketNumber,
      },
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapVehicleJobAssignment(assignment);
}

// Function หา assignment ปัจจุบันของ worker ด้วย vehicleJobId ตรงๆ (ไม่ผ่าน ticketNumber) ใช้ตอน resolve TicketCompletionSubmission.assignmentId
export async function findCurrentAssignmentByVehicleJobIdAndWorker(
  vehicleJobId: number,
  workerId: number,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  const db = client(connection);
  const assignment = await db.vehicleJobAssignment.findFirst({
    where: {
      vehicleJobId,
      workerId,
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

// Function เปลี่ยน assignment เป็น ACCEPTED แบบกัน race
export async function acceptAssignment(
  assignmentId: number,
  scanDeadlineAt: Date,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  if (!connection) {
    return withTransaction((transaction) =>
      acceptAssignment(assignmentId, scanDeadlineAt, transaction)
    );
  }

  const db = client(connection);
  const acceptedAt = new Date();
  const updateResult = await db.vehicleJobAssignment.updateMany({
    where: {
      id: assignmentId,
      status: ASSIGNMENT_STATUS.PENDING,
    },
    data: {
      status: ASSIGNMENT_STATUS.ACCEPTED,
      acceptedAt,
      scanDeadlineAt,
    },
  });

  if (updateResult.count === 0) {
    return null;
  }

  const assignment = await db.vehicleJobAssignment.findUniqueOrThrow({
    where: {
      id: assignmentId,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_id: assignment.workerId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPTED,
      occurred_at: acceptedAt,
    },
    connection
  );

  return requireDto(mapVehicleJobAssignment(assignment), "assignment accept");
}

// Function ดึงรายการ assignment ที่สถานะเป็น ACCEPTED ของ VehicleJob นี้ (ยกเว้น id ที่ระบุถ้ามี)
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

// Function อัปเดต scan deadline ของ assignment
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

// Function เปลี่ยน assignment เป็น TIMEOUT แบบกัน race
export async function timeoutAssignment(
  assignmentId: number,
  eventType: Extract<
    WorkerAssignmentEventType,
    "ACCEPT_TIMEOUT" | "SCAN_TIMEOUT"
  >,
  connection?: DbConnection
): Promise<VehicleJobAssignmentDto | null> {
  if (!connection) {
    return withTransaction((transaction) =>
      timeoutAssignment(assignmentId, eventType, transaction)
    );
  }

  const db = client(connection);
  const occurredAt = new Date();
  const expectedStatus =
    eventType === WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPT_TIMEOUT
      ? ASSIGNMENT_STATUS.PENDING
      : ASSIGNMENT_STATUS.ACCEPTED;
  const updateResult = await db.vehicleJobAssignment.updateMany({
    where: {
      id: assignmentId,
      status: expectedStatus,
    },
    data: {
      status: ASSIGNMENT_STATUS.TIMEOUT,
    },
  });

  if (updateResult.count === 0) {
    return null;
  }

  const assignment = await db.vehicleJobAssignment.findUniqueOrThrow({
    where: {
      id: assignmentId,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_id: assignment.workerId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: eventType,
      occurred_at: occurredAt,
    },
    connection
  );

  return requireDto(mapVehicleJobAssignment(assignment), "assignment timeout");
}

// Function เปลี่ยน assignment เป็น SCANNED แบบมีเงื่อนไข (ต้องเป็น ACCEPTED อยู่ก่อน) กัน race กับ scan-timeout job ที่อาจแย่งเปลี่ยนสถานะเดียวกัน คืน null ถ้าแพ้ race
export async function scanAssignment(
  assignmentId: number,
  metadata?: Record<string, unknown> | null,
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto | null> {
  if (!connection) {
    return withTransaction((transaction) => scanAssignment(assignmentId, metadata, transaction));
  }

  const db = client(connection);
  const scannedAt = new Date();
  const updateResult = await db.vehicleJobAssignment.updateMany({
    where: {
      id: assignmentId,
      status: ASSIGNMENT_STATUS.ACCEPTED,
    },
    data: {
      status: ASSIGNMENT_STATUS.SCANNED,
      scannedAt,
    },
  });

  if (updateResult.count === 0) {
    return null;
  }

  const assignment = await db.vehicleJobAssignment.findUniqueOrThrow({
    where: {
      id: assignmentId,
    },
  });
  await workerAssignmentEventRepository.createOnce(
    {
      assignment_id: assignment.id,
      worker_id: assignment.workerId,
      vehicle_job_id: assignment.vehicleJobId,
      event_type: WORKER_ASSIGNMENT_EVENT_TYPE.SCANNED,
      occurred_at: scannedAt,
      metadata: metadata ?? null,
    },
    connection
  );

  return requireDto(mapVehicleJobAssignment(assignment), "assignment scan");
}

// Function เปลี่ยนสถานะ assignment ทุกใบของรถที่ยัง WORKING_ASSIGNMENT_STATUSES ให้เป็น toStatus เดียวกัน ใช้ตอน Vendor confirm/reject ซึ่งกระทบทั้งทีม
export async function setVehicleAssignmentsStatus(
  vehicleJobId: number,
  toStatus: (typeof ASSIGNMENT_STATUS)[keyof typeof ASSIGNMENT_STATUS],
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
      status: toStatus,
    },
  });

  return result.count;
}

// Function เปลี่ยนสถานะ assignment หลายใบเป็น COMPLETED พร้อมกัน
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

// Function ค้นหา assignment ของ VehicleJob ที่ Admin ปล่อยกลับคิวก่อนเวลาได้จาก DB
export async function listReleasableAssignmentsByVehicleJob(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleJobAssignmentDto[]> {
  const db = client(connection);
  const assignments = await db.vehicleJobAssignment.findMany({
    where: {
      vehicleJobId,
      status: {
        in: RELEASABLE_ASSIGNMENT_STATUSES,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return assignments
    .map((assignment) => mapVehicleJobAssignment(assignment))
    .filter((assignment): assignment is VehicleJobAssignmentDto => assignment !== null);
}

// Function ปล่อย assignment กลับคิวก่อนเวลาโดย Admin ใน DB (ไม่รอทั้ง TicketNumber จบ)
export async function releaseAssignments(
  assignmentIds: number[],
  releasedAt: Date,
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
      status: {
        in: RELEASABLE_ASSIGNMENT_STATUSES,
      },
    },
    data: {
      status: ASSIGNMENT_STATUS.RELEASED,
      releasedAt,
    },
  });

  return result.count;
}
