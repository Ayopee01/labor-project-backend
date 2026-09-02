import { Prisma } from "@prisma/client";

import { client } from "./repository-utils";

import type { DbConnection } from "../../types/shared/common.type";
import type { WorkerAssignmentEventWriteInput } from "../../types/shared/worker-assignment-event.type";

export async function createOnce(
  input: WorkerAssignmentEventWriteInput,
  connection?: DbConnection,
): Promise<void> {
  const db = client(connection);

  try {
    await db.workerAssignmentEvent.create({
      data: {
        assignmentId: input.assignment_id,
        workerId: input.worker_id,
        vehicleJobId: input.vehicle_job_id,
        eventType: input.event_type,
        occurredAt: input.occurred_at ?? new Date(),
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }

    throw error;
  }
}

export async function createManyOnce(
  inputs: WorkerAssignmentEventWriteInput[],
  connection?: DbConnection,
): Promise<void> {
  for (const input of inputs) {
    await createOnce(input, connection);
  }
}

// Function อ่าน metadata ของ WorkerAssignmentEvent ที่เคยบันทึกไว้
export async function findMetadataByAssignmentAndType(
  assignmentId: number,
  eventType: string,
  connection?: DbConnection,
): Promise<Record<string, unknown> | null> {
  const db = client(connection);
  const event = await db.workerAssignmentEvent.findUnique({
    where: {
      assignmentId_eventType: {
        assignmentId,
        eventType,
      },
    },
  });

  return (event?.metadata as Record<string, unknown> | null | undefined) ?? null;
}
