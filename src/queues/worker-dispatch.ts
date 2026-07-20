import { withTransaction } from "../db/prisma";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { profileRepository, workScheduleRepository } from "../repositories/worker-application.repository";
import { getRuntimeSettings } from "../services/admin-settings.service";
import { publishNotification } from "../services/notifications.service";
import { publishRealtimeEvent } from "../services/realtime.service";
import { enqueueWorker, getWorkerQueueStatus, incrementWorkerAcceptTimeoutCount, markWorkerAssigned, markWorkerOpenApp, markWorkerShiftClosed, popReadyWorkers, removeScanWarning, scheduleAssignmentTimeout, scheduleScanTimeout, scheduleScanWarning, startAssignmentTimeoutWorker, startWorkerBreakReturnWorker } from "./worker-queue";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import type { DbConnection } from "../types/common.type";
import type { VehicleJobAssignmentDto } from "../types/worker.type";
import { buildWorkScheduleShiftInstanceKey, isTimeInWorkSchedule } from "../utils/shift";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { buildDeadline, getDelayUntil } from "../utils/time";
import { buildWorkerAssignedPayload } from "../utils/worker-assignment-event";
import { buildWorkerQueueSocketPayload } from "../utils/worker-queue-payload";

async function getWorkerCode(accountId: number): Promise<string | null> {
  const profile = await workerApplicationRepository.profileRepository.findByAccountId(
    accountId
  );

  return profile?.worker_code ?? null;
}

async function getWorkerCodeMap(accountIds: number[]): Promise<Map<number, string | null>> {
  const profiles = await workerApplicationRepository.profileRepository.findByAccountIds(
    accountIds
  );

  return new Map(
    profiles.map((profile) => [profile.account_id, profile.worker_code])
  );
}

export async function dispatchReadyWorkers(
  connection?: Parameters<typeof workerApplicationRepository.listDispatchableVehicleJobs>[0]
): Promise<void> {
  const settings = await getRuntimeSettings();
  const acceptDeadlineMs = settings.worker_accept_deadline_seconds * 1000;
  const dispatchableJobs = await workerApplicationRepository.listDispatchableVehicleJobs(connection);

  for (const vehicleJob of dispatchableJobs) {
    const activeAssignments = await workerApplicationRepository.countActiveAssignments(
      vehicleJob.id,
      connection
    );
    let workersNeeded = vehicleJob.workers_required - activeAssignments;

    if (workersNeeded <= 0) {
      continue;
    }

    while (workersNeeded > 0) {
      const readyWorkers = await popReadyWorkers(workersNeeded);

      if (readyWorkers.length === 0) {
        break;
      }
      const workerCodeMap = await getWorkerCodeMap(
        readyWorkers.map((worker) => worker.account_id)
      );

      for (const worker of readyWorkers) {
        const workerCode = workerCodeMap.get(worker.account_id) ?? null;

        if (!isWorkerSocketConnected(worker.account_id)) {
          const queue = await markWorkerOpenApp(worker.account_id);
          publishNotification({
            type: "WORKER_STATUS_CHANGED",
            title: "Worker moved to open_app",
            message: `Worker ${workerCode ?? worker.account_id} moved to open_app because WebSocket is not connected.`,
            payload: {
              worker_code: workerCode,
              queue: buildWorkerQueueSocketPayload(queue, workerCode),
              reason: "socket_not_connected_during_dispatch",
            },
            audience: {
              roles: ["admin"],
            },
          });
          continue;
        }

        const assignment = await workerApplicationRepository.createAssignment(
          vehicleJob.id,
          worker.account_id,
          buildDeadline(acceptDeadlineMs),
          connection
        );
        await markWorkerAssigned(worker.account_id);
        await scheduleAssignmentTimeout(
          assignment.id,
          worker.account_id,
          acceptDeadlineMs
        );
        sendWorkerSocketEvent(
          worker.account_id,
          "WORKER_ASSIGNED",
          buildWorkerAssignedPayload(assignment, vehicleJob)
        );
        publishNotification({
          type: "WORKER_ASSIGNED",
          title: "Worker assigned",
          message: `Worker ${workerCode ?? worker.account_id} was assigned to vehicle job ${vehicleJob.vehicle_job_ref}.`,
          payload: {
            vehicle_job_ref: vehicleJob.vehicle_job_ref,
            worker_code: workerCode,
            status: assignment.status,
            accept_deadline_at: assignment.accept_deadline_at,
          },
          audience: {
            roles: ["admin"],
          },
        });
        workersNeeded -= 1;
      }
    }
  }
}

type AssignmentAcceptTimeoutResult = {
  queue: Awaited<ReturnType<typeof markWorkerOpenApp>>;
  reason: string;
  timeout_count: number;
  timeout_limit: number;
  closed_shift: boolean;
};

type CompletedVehicleJobResult = NonNullable<
  Awaited<ReturnType<typeof workerApplicationRepository.closeCompletedVehicleJobIfReady>>
>;

export async function handleAssignmentAcceptTimeout(input: {
  assignment: VehicleJobAssignmentDto;
  workerAccountId: number;
  connection?: DbConnection;
}): Promise<AssignmentAcceptTimeoutResult> {
  const settings = await getRuntimeSettings();
  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
    input.workerAccountId,
    input.connection
  );
  const hasActiveSchedule =
    currentSchedule !== null && isTimeInWorkSchedule(currentSchedule);
  let timeoutCount = 1;
  let queue: AssignmentAcceptTimeoutResult["queue"];
  let reason = "assignment_timeout_requeue";
  let closedShift = false;

  await workerApplicationRepository.timeoutAssignment(
    input.assignment.id,
    input.connection
  );

  if (hasActiveSchedule) {
    const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);
    timeoutCount = await incrementWorkerAcceptTimeoutCount(
      input.workerAccountId,
      shiftInstanceKey
    );

    if (timeoutCount >= settings.worker_accept_timeout_limit) {
      await markWorkerShiftClosed(input.workerAccountId, shiftInstanceKey);
      queue = await markWorkerOpenApp(input.workerAccountId);
      reason = "assignment_timeout_limit_reached";
      closedShift = true;
    } else if (isWorkerSocketConnected(input.workerAccountId)) {
      queue = await enqueueWorker(input.workerAccountId);
    } else {
      queue = await markWorkerOpenApp(input.workerAccountId);
      reason = "assignment_timeout_socket_disconnected";
    }
  } else {
    queue = await markWorkerOpenApp(input.workerAccountId);
    reason = "assignment_timeout_shift_unavailable";
  }

  await dispatchReadyWorkers(input.connection);

  return {
    queue,
    reason,
    timeout_count: timeoutCount,
    timeout_limit: settings.worker_accept_timeout_limit,
    closed_shift: closedShift,
  };
}

async function handleAssignmentScanTimeout(input: {
  assignment: VehicleJobAssignmentDto;
  workerAccountId: number;
  connection: DbConnection;
}): Promise<void> {
  if (input.assignment.status !== "ACCEPTED") {
    return;
  }

  const remainingDelayMs = getDelayUntil(input.assignment.scan_deadline_at);

  if (remainingDelayMs > 0) {
    await Promise.all([
      scheduleScanTimeout(
        input.assignment.id,
        input.assignment.worker_account_id,
        remainingDelayMs
      ),
      scheduleScanWarning(
        input.assignment.id,
        input.assignment.worker_account_id,
        input.assignment.scan_deadline_at
      ),
    ]);
    return;
  }

  const vehicleJob = await workerApplicationRepository.findVehicleJobById(
    input.assignment.vehicle_job_id,
    input.connection
  );
  const workerCode = await getWorkerCode(input.workerAccountId);

  await workerApplicationRepository.timeoutAssignment(
    input.assignment.id,
    input.connection
  );
  await removeScanWarning(input.assignment.id);
  const queue = await markWorkerOpenApp(input.workerAccountId);

  sendWorkerSocketEvent(input.workerAccountId, "ASSIGNMENT_TIMEOUT", {
    vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
    reason: "scan_timeout",
    status: "open_app",
  });
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker returned to open app",
    message: `Worker ${workerCode ?? input.workerAccountId} missed QR check-in and returned to open app.`,
    payload: {
      worker_code: workerCode,
      queue: buildWorkerQueueSocketPayload(queue, workerCode),
      reason: "scan_timeout_open_app",
    },
    audience: {
      roles: ["admin"],
    },
  });
  publishNotification({
    type: "ASSIGNMENT_TIMEOUT",
    title: "Assignment scan timed out",
    message: `Worker ${workerCode ?? input.workerAccountId} did not scan QR for vehicle job ${vehicleJob?.vehicle_job_ref ?? "-"}.`,
    payload: {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
      worker_code: workerCode,
      status: "TIMEOUT",
      reason: "scan_timeout",
    },
    audience: {
      roles: ["admin"],
    },
  });
}

async function handleAssignmentScanWarning(input: {
  assignment: VehicleJobAssignmentDto;
  workerAccountId: number;
  connection: DbConnection;
}): Promise<void> {
  if (input.assignment.status !== "ACCEPTED") {
    return;
  }

  const settings = await getRuntimeSettings();
  const remainingDelayMs = getDelayUntil(input.assignment.scan_deadline_at);
  const warningBeforeMs = settings.worker_scan_warning_before_minutes * 60 * 1000;

  if (remainingDelayMs <= 0) {
    return;
  }

  if (remainingDelayMs > warningBeforeMs) {
    await scheduleScanWarning(
      input.assignment.id,
      input.assignment.worker_account_id,
      input.assignment.scan_deadline_at
    );
    return;
  }

  const [vehicleJob, workerCode] = await Promise.all([
    workerApplicationRepository.findVehicleJobById(
      input.assignment.vehicle_job_id,
      input.connection
    ),
    getWorkerCode(input.workerAccountId),
  ]);
  const remainingSeconds = Math.ceil(remainingDelayMs / 1000);

  publishNotification({
    type: "ASSIGNMENT_SCAN_DEADLINE_WARNING",
    title: "Worker has not checked in",
    message: `Worker ${workerCode ?? input.workerAccountId} has not checked in and the scan deadline is near.`,
    payload: {
      vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
      worker_code: workerCode,
      assignment_status: input.assignment.status,
      worker_status: "assigned",
      scan_deadline_at: input.assignment.scan_deadline_at,
      remaining_seconds: remainingSeconds,
      warning_before_minutes: settings.worker_scan_warning_before_minutes,
    },
    audience: {
      roles: ["admin"],
    },
  });
}

async function returnCompletedWorkersToQueue(
  input: CompletedVehicleJobResult | null
): Promise<Array<string | null>> {
  if (!input || input.completed_worker_account_ids.length === 0) {
    return [];
  }

  const requeuedWorkerCodes: Array<string | null> = [];
  const workerCodeMap = new Map(
    (await profileRepository.findByAccountIds(input.completed_worker_account_ids)).map(
      (profile) => [profile.account_id, profile.worker_code]
    )
  );

  for (const workerAccountId of input.completed_worker_account_ids) {
    const workerCode = workerCodeMap.get(workerAccountId) ?? null;
    const [currentSchedule, currentAssignment] = await Promise.all([
      workScheduleRepository.findCurrentByAccountId(workerAccountId),
      workerApplicationRepository.findCurrentAssignmentByWorker(workerAccountId),
    ]);

    if (currentAssignment) {
      continue;
    }

    const canReturnToQueue =
      currentSchedule &&
      isTimeInWorkSchedule(currentSchedule) &&
      isWorkerSocketConnected(workerAccountId);

    if (canReturnToQueue) {
      const queue = await enqueueWorker(workerAccountId);
      requeuedWorkerCodes.push(workerCode);
      sendWorkerSocketEvent(workerAccountId, "WORKER_STATUS_CHANGED", {
        queue: buildWorkerQueueSocketPayload(queue, workerCode),
      });
      publishNotification({
        type: "WORKER_STATUS_CHANGED",
        title: "Worker returned to queue",
        message: `Worker ${workerCode ?? workerAccountId} returned to queue after vehicle job completion.`,
        payload: {
          worker_code: workerCode,
          vehicle_job_ref: input.vehicle_job.vehicle_job_ref,
          queue: buildWorkerQueueSocketPayload(queue, workerCode),
          reason: "vehicle_job_completed_requeue",
        },
        audience: {
          roles: ["admin"],
        },
      });
      continue;
    }

    const queue = await markWorkerOpenApp(workerAccountId);
    if (isWorkerSocketConnected(workerAccountId)) {
      sendWorkerSocketEvent(workerAccountId, "WORKER_STATUS_CHANGED", {
        queue: buildWorkerQueueSocketPayload(queue, workerCode),
      });
    }
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker moved to open_app",
      message: `Worker ${workerCode ?? workerAccountId} moved to open_app after vehicle job completion.`,
        payload: {
          worker_code: workerCode,
          vehicle_job_ref: input.vehicle_job.vehicle_job_ref,
          queue: buildWorkerQueueSocketPayload(queue, workerCode),
          reason: "vehicle_job_completed_not_available",
        },
      audience: {
        roles: ["admin"],
      },
    });
  }

  if (requeuedWorkerCodes.length > 0) {
    await dispatchReadyWorkers();
  }

  return requeuedWorkerCodes;
}

async function handleVendorConfirmationTimeout(input: {
  ticketId?: number;
  submissionId?: number;
}): Promise<void> {
  if (!input.ticketId || !input.submissionId) {
    return;
  }

  const result = await withTransaction(async (transaction) => {
    const ticket = await workerApplicationRepository.findGateTicketForCompletion(
      input.ticketId as number,
      transaction
    );

    if (!ticket || ticket.status !== "DELIVERED") {
      return null;
    }

    const submission = await workerApplicationRepository.findWaitingTicketCompletionSubmission(
      ticket.id,
      transaction
    );

    if (!submission || submission.id !== input.submissionId) {
      return null;
    }

    const updated = await workerApplicationRepository.confirmTicketCompletion(
      ticket.id,
      submission.id,
      transaction
    );
    const completedVehicleJob = await workerApplicationRepository.closeCompletedVehicleJobIfReady(
      updated.ticket.vehicle_job_id,
      transaction
    );
    const nextTicket = !completedVehicleJob
      ? await workerApplicationRepository.activateNextTicketIfReady(
          updated.ticket.vehicle_job_id,
          transaction
        )
      : null;

    if (!completedVehicleJob) {
      await workerApplicationRepository.markVehicleAssignmentsWorking(
        updated.ticket.vehicle_job_id,
        transaction
      );
    }

    const [ticketWorkers, admins, products, detail] = await Promise.all([
      workerApplicationRepository.listTicketWorkers(updated.ticket.id, transaction),
      workerApplicationRepository.accountRepository.listAdmins(transaction),
      workerApplicationRepository.listTicketProducts(updated.ticket.id, transaction),
      workerApplicationRepository.getVehicleJobDetail(
        updated.ticket.vehicle_job_id,
        transaction
      ),
    ]);
    const receiverIds = new Set<number>();
    ticketWorkers.forEach((worker) => receiverIds.add(worker.worker_account_id));
    admins.forEach((admin) => receiverIds.add(admin.id));

    return {
      ...updated,
      products,
      detail,
      completedVehicleJob,
      nextTicket,
      receiverAccountIds: Array.from(receiverIds),
    };
  });

  if (!result) {
    return;
  }

  await returnCompletedWorkersToQueue(result.completedVehicleJob);

  const completedWorkerCodes: Array<string | null> = [];
  if (result.completedVehicleJob) {
    const workerCodeMap = await getWorkerCodeMap(
      result.completedVehicleJob.completed_worker_account_ids
    );
    completedWorkerCodes.push(
      ...result.completedVehicleJob.completed_worker_account_ids.map(
        (accountId) => workerCodeMap.get(accountId) ?? null
      )
    );
  }

  publishRealtimeEvent({
    type: "TICKET_COMPLETION_RESULT",
    title: "Ticket completion auto-confirmed",
    message: `Ticket ${result.ticket.ticket_no ?? result.ticket.stall_job_ref} was auto-confirmed after vendor timeout.`,
    payload: {
      ...buildWorkerTicketPayload(
        result.ticket,
        result.detail,
        result.products,
        {
          submission_status: result.submission.status,
          vehicle_job_status: result.completedVehicleJob?.vehicle_job.status,
          completed_worker_codes: completedWorkerCodes,
          next_market_job_ref: result.nextTicket?.market_job_ref ?? null,
          next_stall_job_ref: result.nextTicket?.ticket.stall_job_ref ?? null,
          next_ticket_status: result.nextTicket?.ticket.status ?? null,
          assignment_status: result.completedVehicleJob ? "COMPLETED" : "WORKING",
          reason: "vendor_confirm_timeout",
        }
      ),
    },
    worker_payload: {
      ...buildWorkerTicketPayload(
        result.ticket,
        result.detail,
        result.products,
        {
          submission_status: result.submission.status,
          vehicle_job_status: result.completedVehicleJob?.vehicle_job.status,
          completed_worker_codes: completedWorkerCodes,
          next_market_job_ref: result.nextTicket?.market_job_ref ?? null,
          next_stall_job_ref: result.nextTicket?.ticket.stall_job_ref ?? null,
          next_ticket_status: result.nextTicket?.ticket.status ?? null,
          assignment_status: result.completedVehicleJob ? "COMPLETED" : "WORKING",
          reason: "vendor_confirm_timeout",
        }
      ),
    },
    admin: true,
    worker_account_ids: result.receiverAccountIds,
  });
  publishNotification({
    type: "TICKET_COMPLETION_RESULT",
    title: "Ticket completion auto-confirmed",
    message: `Ticket ${result.ticket.ticket_no ?? result.ticket.stall_job_ref} was auto-confirmed after vendor timeout.`,
    payload: {
      ticket_id: result.ticket.id,
      stall_job_ref: result.ticket.stall_job_ref,
      submission_id: result.submission.id,
      reason: "vendor_confirm_timeout",
    },
    audience: {
      roles: ["admin"],
    },
  });
}

async function handleWorkerShiftEnd(input: {
  accountId: number;
  scheduleId: number;
  shiftInstanceKey?: string;
}): Promise<void> {
  const schedule = await workScheduleRepository.findById(input.scheduleId);

  if (!schedule || schedule.account_id !== input.accountId) {
    return;
  }

  await markWorkerShiftClosed(
    input.accountId,
    input.shiftInstanceKey ?? buildWorkScheduleShiftInstanceKey(schedule)
  );

  const currentAssignment = await workerApplicationRepository.findCurrentAssignmentByWorker(
    input.accountId
  );

  if (currentAssignment) {
    return;
  }

  const workerCode = await getWorkerCode(input.accountId);
  const queue = await markWorkerOpenApp(input.accountId);

  if (isWorkerSocketConnected(input.accountId)) {
    sendWorkerSocketEvent(input.accountId, "WORKER_STATUS_CHANGED", {
      queue: buildWorkerQueueSocketPayload(queue, workerCode),
      reason: "shift_ended",
    });
  }
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker shift closed",
    message: `Worker ${workerCode ?? input.accountId} moved to open_app because the shift ended.`,
    payload: {
      worker_code: workerCode,
      queue: buildWorkerQueueSocketPayload(queue, workerCode),
      reason: "shift_ended",
    },
    audience: {
      roles: ["admin"],
    },
  });
}

async function handleWorkerBreakReturn(input: {
  accountId: number;
  scheduleId: number;
}): Promise<void> {
  const queueEntry = await getWorkerQueueStatus(input.accountId);

  if (!queueEntry || queueEntry.status !== "break") {
    return;
  }

  const [currentSchedule, currentAssignment] = await Promise.all([
    workScheduleRepository.findCurrentByAccountId(input.accountId),
    workerApplicationRepository.findCurrentAssignmentByWorker(input.accountId),
  ]);

  if (
    currentSchedule &&
    currentSchedule.id === input.scheduleId &&
    isTimeInWorkSchedule(currentSchedule) &&
    !currentAssignment &&
    isWorkerSocketConnected(input.accountId)
  ) {
    const queue = await enqueueWorker(input.accountId);
    const workerCode = await getWorkerCode(input.accountId);
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker break finished",
      message: `Worker ${workerCode ?? input.accountId} returned to queue after break.`,
      payload: {
        worker_code: workerCode,
        queue: buildWorkerQueueSocketPayload(queue, workerCode),
        reason: "break_finished_requeue",
      },
      audience: {
        roles: ["admin"],
      },
    });
    await dispatchReadyWorkers();
    return;
  }

  const queue = await markWorkerOpenApp(input.accountId);
  const workerCode = await getWorkerCode(input.accountId);
  publishNotification({
    type: "WORKER_STATUS_CHANGED",
    title: "Worker moved to open_app",
    message: `Worker ${workerCode ?? input.accountId} moved to open_app after break.`,
    payload: {
      worker_code: workerCode,
      queue: buildWorkerQueueSocketPayload(queue, workerCode),
      reason: "break_finished_not_available",
    },
    audience: {
      roles: ["admin"],
    },
  });
}

export function startAssignmentTimeoutProcessing(): void {
  startAssignmentTimeoutWorker(async ({ assignmentId, workerAccountId, ticketId, submissionId, kind }) => {
    if (kind === "vendor_confirm") {
      await handleVendorConfirmationTimeout({ ticketId, submissionId });
      return;
    }

    if (!assignmentId || !workerAccountId) {
      return;
    }

    await withTransaction(async (transaction) => {
      const assignment = await workerApplicationRepository.findAssignmentById(
        assignmentId,
        transaction
      );

      if (!assignment) {
        return;
      }

      if (kind === "scan") {
        await handleAssignmentScanTimeout({
          assignment,
          workerAccountId,
          connection: transaction,
        });
        return;
      }

      if (kind === "scan_warning") {
        await handleAssignmentScanWarning({
          assignment,
          workerAccountId,
          connection: transaction,
        });
        return;
      }

      if (assignment.status !== "PENDING") {
        return;
      }

      const vehicleJob = await workerApplicationRepository.findVehicleJobById(
        assignment.vehicle_job_id,
        transaction
      );
      const workerCode = await getWorkerCode(workerAccountId);
      const timeoutResult = await handleAssignmentAcceptTimeout({
        assignment,
        workerAccountId,
        connection: transaction,
      });

      sendWorkerSocketEvent(workerAccountId, "ASSIGNMENT_TIMEOUT", {
        vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
        reason: timeoutResult.reason,
        timeout_count: timeoutResult.timeout_count,
        timeout_limit: timeoutResult.timeout_limit,
      });
      publishNotification({
        type: "WORKER_STATUS_CHANGED",
        title: timeoutResult.closed_shift
          ? "Worker shift closed"
          : timeoutResult.reason === "assignment_timeout_requeue"
            ? "Worker returned to queue"
            : "Worker moved to open_app",
        message: timeoutResult.closed_shift
          ? `Worker ${workerCode ?? workerAccountId} moved to open_app after reaching the assignment timeout limit.`
          : timeoutResult.reason === "assignment_timeout_requeue"
            ? `Worker ${workerCode ?? workerAccountId} returned to queue after assignment timeout.`
            : `Worker ${workerCode ?? workerAccountId} moved to open_app after assignment timeout.`,
        payload: {
          worker_code: workerCode,
          queue: buildWorkerQueueSocketPayload(timeoutResult.queue, workerCode),
          reason: timeoutResult.reason,
          timeout_count: timeoutResult.timeout_count,
          timeout_limit: timeoutResult.timeout_limit,
        },
        audience: {
          roles: ["admin"],
        },
      });
      publishNotification({
        type: "ASSIGNMENT_TIMEOUT",
        title: "Assignment timed out",
        message: `Worker ${workerCode ?? workerAccountId} did not accept vehicle job ${vehicleJob?.vehicle_job_ref ?? "-"}.`,
        payload: {
          vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
          worker_code: workerCode,
          status: "TIMEOUT",
          reason: timeoutResult.reason,
          timeout_count: timeoutResult.timeout_count,
          timeout_limit: timeoutResult.timeout_limit,
        },
        audience: {
          roles: ["admin"],
        },
      });
    });
  });

  startWorkerBreakReturnWorker(async ({ accountId, scheduleId, shiftInstanceKey, kind }) => {
    if (kind === "shift_end") {
      await handleWorkerShiftEnd({ accountId, scheduleId, shiftInstanceKey });
      return;
    }

    await handleWorkerBreakReturn({ accountId, scheduleId });
  });
}
