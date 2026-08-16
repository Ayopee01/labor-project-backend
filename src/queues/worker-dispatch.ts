import { withTransaction } from "../db/prisma";
import * as workScheduleRepository from "../repositories/shared/work-schedule.repository";
import * as profileRepository from "../repositories/shared/profile.repository";
import * as assignmentRepository from "../repositories/shared/vehicle-job-assignment.repository";
import * as gateTicketRepository from "../repositories/shared/gate-ticket.repository";
import * as vehicleJobRepository from "../repositories/shared/vehicle-job.repository";
import * as workerShiftAttendanceRepository from "../repositories/shared/worker-shift-attendance.repository";
import { getRuntimeSettings } from "../services/shared/runtime-settings.service";
import * as vehicleJobLifecycleService from "../services/shared/vehicle-job-lifecycle.service";
import { publishAdminWorkerStatusChanged, publishNotification } from "../services/notifications.service";
import { publishRealtimeEvent } from "../services/shared/realtime-notification.service";
import { applyVendorTicketCompletionResult } from "../services/shared/ticket-completion.service";
import { enqueueWorker, getWorkerQueueStatus, markWorkerAssigned, markWorkerOpenApp, popReadyWorkers, removeScanWarning, scheduleAssignmentTimeout, scheduleScanTimeout, scheduleScanWarning, startAssignmentTimeoutWorker, startWorkerBreakReturnWorker } from "./worker-queue";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import type { DbConnection } from "../types/shared/common.type";
import type { AssignmentAcceptTimeoutResult, CompletedWorkerQueueResult, VehicleJobAssignmentDto } from "../types/worker.type";
import { buildWorkScheduleShiftInstanceKey, isTimeInWorkSchedule } from "../utils/shift";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { buildDeadline, getDelayUntil } from "../utils/time";
import { buildWorkerAssignedPayload, buildWorkerQueueSocketPayload } from "../utils/worker-payload";
import { ASSIGNMENT_STATUS, TICKET_STATUS } from "../constants/job-status";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../types/shared/worker-assignment-event.type";
import { WORKER_WORK_STATUS } from "../types/shared/worker-status.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function จ่าย worker สถานะ ready จากคิว Redis FIFO ไปยังงานรถที่ยังขาดแรงงาน
export async function dispatchReadyWorkers(
  connection?: Parameters<typeof vehicleJobRepository.listDispatchableVehicleJobs>[0],
  options: {
    vehicle_job_ids?: number[];
  } = {}
): Promise<void> {
  const settings = await getRuntimeSettings();
  const acceptDeadlineMs = settings.worker_accept_deadline_seconds * 1000;
  const allowedVehicleJobIds = options.vehicle_job_ids
    ? new Set(options.vehicle_job_ids)
    : null;
  const dispatchableJobs = (await vehicleJobRepository.listDispatchableVehicleJobs(connection))
    .filter((vehicleJob) => !allowedVehicleJobIds || allowedVehicleJobIds.has(vehicleJob.id));

  for (const vehicleJob of dispatchableJobs) {
    const activeAssignments = await assignmentRepository.countActiveAssignments(
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
      const workerCodeMap = await profileRepository.findWorkerCodeMapByAccountIds(
        readyWorkers.map((worker) => worker.account_id),
        connection
      );

      for (const worker of readyWorkers) {
        const workerCode = workerCodeMap.get(worker.account_id) ?? null;

        const assignment = await assignmentRepository.createAssignment(
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
          message: `Worker ${workerCode ?? worker.account_id} was assigned to vehicle job ${vehicleJob.ticketNo}.`,
          payload: {
            ticketNo: vehicleJob.ticketNo,
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

/* -------------------------------------- Timeout Handlers -------------------------------------- */

// Function จัดการกรณี worker ไม่ accept assignment ภายในเวลาจาก config
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

  await assignmentRepository.timeoutAssignment(
    input.assignment.id,
    WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPT_TIMEOUT,
    input.connection
  );

  if (hasActiveSchedule) {
    const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);
    const workerCode = await profileRepository.findWorkerCodeByAccountId(
      input.workerAccountId,
      input.connection
    );
    const attendance = await workerShiftAttendanceRepository.incrementAcceptTimeoutStreak(
      {
        account_id: input.workerAccountId,
        worker_code: workerCode ?? String(input.workerAccountId),
        schedule: currentSchedule,
        shift_instance_key: shiftInstanceKey,
      },
      input.connection
    );
    timeoutCount = attendance.acceptTimeoutStreak;

    if (timeoutCount >= settings.worker_accept_timeout_limit) {
      await workerShiftAttendanceRepository.closeWorkerShift(
        {
          account_id: input.workerAccountId,
          worker_code: workerCode ?? String(input.workerAccountId),
          schedule: currentSchedule,
          shift_instance_key: shiftInstanceKey,
          reason: "assignment_timeout_limit_reached",
        },
        input.connection
      );
      queue = await markWorkerOpenApp(input.workerAccountId);
      reason = "assignment_timeout_limit_reached";
      closedShift = true;
    } else {
      queue = await enqueueWorker(input.workerAccountId);
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

// Function จัดการกรณี worker accept งานแล้วไม่ scan QR ภายในเวลา
async function handleAssignmentScanTimeout(input: {
  assignment: VehicleJobAssignmentDto;
  workerAccountId: number;
  connection: DbConnection;
}): Promise<void> {
  if (input.assignment.status !== ASSIGNMENT_STATUS.ACCEPTED) {
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

  const vehicleJob = await vehicleJobRepository.findVehicleJobById(
    input.assignment.vehicle_job_id,
    input.connection
  );
  const workerCode = await profileRepository.findWorkerCodeByAccountId(input.workerAccountId);

  await assignmentRepository.timeoutAssignment(
    input.assignment.id,
    WORKER_ASSIGNMENT_EVENT_TYPE.SCAN_TIMEOUT,
    input.connection
  );
  const teamScan = await assignmentRepository.getVehicleJobTeamScanReadiness(
    input.assignment.vehicle_job_id,
    input.connection,
  );

  if (teamScan.is_ready) {
    await vehicleJobLifecycleService.markVehicleJobInProgress(
      input.assignment.vehicle_job_id,
      input.connection,
    );
  }
  await removeScanWarning(input.assignment.id);
  const queue = await markWorkerOpenApp(input.workerAccountId);
  await dispatchReadyWorkers(input.connection);

  sendWorkerSocketEvent(input.workerAccountId, "ASSIGNMENT_TIMEOUT", {
    ticketNo: vehicleJob?.ticketNo ?? null,
    reason: "scan_timeout",
    status: WORKER_WORK_STATUS.OPEN_APP,
  });
  publishAdminWorkerStatusChanged({
    title: "Worker returned to open app",
    message: `Worker ${workerCode ?? input.workerAccountId} missed QR check-in and returned to open app.`,
    workerCode,
    queue,
    reason: "scan_timeout_open_app",
  });
  publishNotification({
    type: "ASSIGNMENT_TIMEOUT",
    title: "Assignment scan timed out",
    message: `Worker ${workerCode ?? input.workerAccountId} did not scan QR for vehicle job ${vehicleJob?.ticketNo ?? "-"}.`,
    payload: {
      ticketNo: vehicleJob?.ticketNo ?? null,
      worker_code: workerCode,
      status: ASSIGNMENT_STATUS.TIMEOUT,
      reason: "scan_timeout",
    },
    audience: {
      roles: ["admin"],
    },
  });
}

// Function แจ้ง Admin เมื่อ assignment ที่ accept แล้วใกล้หมดเวลา scan QR
async function handleAssignmentScanWarning(input: {
  assignment: VehicleJobAssignmentDto;
  workerAccountId: number;
  connection: DbConnection;
}): Promise<void> {
  if (input.assignment.status !== ASSIGNMENT_STATUS.ACCEPTED) {
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
    vehicleJobRepository.findVehicleJobById(
      input.assignment.vehicle_job_id,
      input.connection
    ),
    profileRepository.findWorkerCodeByAccountId(input.workerAccountId),
  ]);
  const remainingSeconds = Math.ceil(remainingDelayMs / 1000);

  publishNotification({
    type: "ASSIGNMENT_SCAN_DEADLINE_WARNING",
    title: "Worker has not checked in",
    message: `Worker ${workerCode ?? input.workerAccountId} has not checked in and the scan deadline is near.`,
    payload: {
      ticketNo: vehicleJob?.ticketNo ?? null,
      worker_code: workerCode,
      assignment_status: input.assignment.status,
      worker_status: WORKER_WORK_STATUS.ASSIGNED,
      scan_deadline_at: input.assignment.scan_deadline_at,
      remaining_seconds: remainingSeconds,
      warning_before_minutes: settings.worker_scan_warning_before_minutes,
    },
    audience: {
      roles: ["admin"],
    },
  });
}

/* -------------------------------------- Completion Helpers -------------------------------------- */

// Function ส่ง worker ที่จบงานกลับเข้าคิวเมื่อกะยังทำงานต่อได้
export async function returnCompletedWorkersToQueue(
  input: CompletedWorkerQueueResult | null
): Promise<Array<string | null>> {
  if (!input || input.completed_worker_account_ids.length === 0) {
    return [];
  }

  const requeuedWorkerCodes: Array<string | null> = [];
  const workerCodeMap = await profileRepository.findWorkerCodeMapByAccountIds(
    input.completed_worker_account_ids
  );

  for (const workerAccountId of input.completed_worker_account_ids) {
    const workerCode = workerCodeMap.get(workerAccountId) ?? null;
    const [currentSchedule, currentAssignment] = await Promise.all([
      workScheduleRepository.findCurrentByAccountId(workerAccountId),
      assignmentRepository.findCurrentAssignmentByWorker(workerAccountId),
    ]);

    if (currentAssignment) {
      continue;
    }

    const canReturnToQueue =
      currentSchedule &&
      isTimeInWorkSchedule(currentSchedule);

    if (canReturnToQueue) {
      const queue = await enqueueWorker(workerAccountId);
      requeuedWorkerCodes.push(workerCode);
      sendWorkerSocketEvent(workerAccountId, "WORKER_STATUS_CHANGED", {
        queue: buildWorkerQueueSocketPayload(queue, workerCode),
      });
      publishAdminWorkerStatusChanged({
        title: "Worker returned to queue",
        message: `Worker ${workerCode ?? workerAccountId} returned to queue after vehicle job completion.`,
        workerCode,
        queue,
        reason: "vehicle_job_completed_requeue",
        extraPayload: {
          ticketNo: input.vehicle_job.ticketNo,
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
    publishAdminWorkerStatusChanged({
      title: "Worker moved to open_app",
      message: `Worker ${workerCode ?? workerAccountId} moved to open_app after vehicle job completion.`,
      workerCode,
      queue,
      reason: "vehicle_job_completed_not_available",
      extraPayload: {
        ticketNo: input.vehicle_job.ticketNo,
      },
    });
  }

  if (requeuedWorkerCodes.length > 0) {
    await dispatchReadyWorkers();
  }

  return requeuedWorkerCodes;
}

// Function ยืนยัน ticket อัตโนมัติเมื่อส่งยอดแล้วแต่ vendor ไม่ยืนยันภายในเวลาจาก config
async function handleVendorConfirmationTimeout(input: {
  ticketId?: number;
  submissionId?: number;
}): Promise<void> {
  if (!input.ticketId || !input.submissionId) {
    return;
  }

  const result = await withTransaction(async (transaction) => {
    const ticket = await gateTicketRepository.findGateTicketForCompletion(
      input.ticketId as number,
      transaction
    );

    if (!ticket || ticket.status !== TICKET_STATUS.DELIVERED) {
      return null;
    }

    const submission = await gateTicketRepository.findWaitingTicketCompletionSubmission(
      ticket.id,
      transaction
    );

    if (!submission || submission.id !== input.submissionId) {
      return null;
    }

    return applyVendorTicketCompletionResult({
      ticket,
      submission,
      action: "confirm",
      connection: transaction,
    });
  });

  if (!result) {
    return;
  }

  await returnCompletedWorkersToQueue(result.completedVehicleJob);

  publishRealtimeEvent({
    type: "TICKET_COMPLETION_RESULT",
    title: "Ticket completion auto-confirmed",
    message: `Ticket ${result.ticket.boothCode} was auto-confirmed after vendor timeout.`,
    payload: {
      ...buildWorkerTicketPayload(
        result.ticket,
        result.detail,
        result.products,
        {
          submission_status: result.submission.status,
          vehicle_job_status: result.completedVehicleJob?.vehicle_job.status,
          completed_worker_codes: result.completedWorkerCodes,
          nextMarketCode: result.nextTicket?.marketCode ?? null,
          nextBoothCode: result.nextTicket?.ticket.boothCode ?? null,
          next_ticket_status: result.nextTicket?.ticket.status ?? null,
          assignment_status: result.assignmentStatus,
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
          completed_worker_codes: result.completedWorkerCodes,
          nextMarketCode: result.nextTicket?.marketCode ?? null,
          nextBoothCode: result.nextTicket?.ticket.boothCode ?? null,
          next_ticket_status: result.nextTicket?.ticket.status ?? null,
          assignment_status: result.assignmentStatus,
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
    message: `Ticket ${result.ticket.boothCode} was auto-confirmed after vendor timeout.`,
    payload: {
      ticket_id: result.ticket.id,
      boothCode: result.ticket.boothCode,
      submission_id: result.submission.id,
      reason: "vendor_confirm_timeout",
    },
    audience: {
      roles: ["admin"],
    },
  });
}

/* -------------------------------------- Shift Handlers -------------------------------------- */

// Function ปิดกะ worker เมื่อถึงเวลาสิ้นสุด และย้าย worker ที่ว่างกลับ open_app
async function handleWorkerShiftEnd(input: {
  accountId: number;
  scheduleId: number;
  shiftInstanceKey?: string;
}): Promise<void> {
  const schedule = await workScheduleRepository.findById(input.scheduleId);

  if (!schedule || schedule.account_id !== input.accountId) {
    return;
  }

  const shiftInstanceKey =
    input.shiftInstanceKey ?? buildWorkScheduleShiftInstanceKey(schedule);
  const workerCode = await profileRepository.findWorkerCodeByAccountId(input.accountId);

  await workerShiftAttendanceRepository.closeWorkerShift(
    {
      account_id: input.accountId,
      worker_code: workerCode ?? String(input.accountId),
      schedule,
      shift_instance_key: shiftInstanceKey,
      reason: "shift_ended",
    }
  );

  const currentAssignment = await assignmentRepository.findCurrentAssignmentByWorker(
    input.accountId
  );

  if (currentAssignment) {
    return;
  }

  const queue = await markWorkerOpenApp(input.accountId);

  if (isWorkerSocketConnected(input.accountId)) {
    sendWorkerSocketEvent(input.accountId, "WORKER_STATUS_CHANGED", {
      queue: buildWorkerQueueSocketPayload(queue, workerCode),
      reason: "shift_ended",
    });
  }
  publishAdminWorkerStatusChanged({
    title: "Worker shift closed",
    message: `Worker ${workerCode ?? input.accountId} moved to open_app because the shift ended.`,
    workerCode,
    queue,
    reason: "shift_ended",
  });
}

// Function พา worker กลับจาก break เข้าคิว หรือกลับ open_app ถ้า socket/กะ/assignment ไม่พร้อม
async function handleWorkerBreakReturn(input: {
  accountId: number;
  scheduleId: number;
}): Promise<void> {
  const queueEntry = await getWorkerQueueStatus(input.accountId);

  if (!queueEntry || queueEntry.status !== WORKER_WORK_STATUS.BREAK) {
    return;
  }

  const [currentSchedule, currentAssignment] = await Promise.all([
    workScheduleRepository.findCurrentByAccountId(input.accountId),
    assignmentRepository.findCurrentAssignmentByWorker(input.accountId),
  ]);

  if (
    currentSchedule &&
    currentSchedule.id === input.scheduleId &&
    isTimeInWorkSchedule(currentSchedule) &&
    !currentAssignment &&
    isWorkerSocketConnected(input.accountId)
  ) {
    const queue = await enqueueWorker(input.accountId);
    const workerCode = await profileRepository.findWorkerCodeByAccountId(input.accountId);
    publishAdminWorkerStatusChanged({
      title: "Worker break finished",
      message: `Worker ${workerCode ?? input.accountId} returned to queue after break.`,
      workerCode,
      queue,
      reason: "break_finished_requeue",
    });
    await dispatchReadyWorkers();
    return;
  }

  const queue = await markWorkerOpenApp(input.accountId);
  const workerCode = await profileRepository.findWorkerCodeByAccountId(input.accountId);
  publishAdminWorkerStatusChanged({
    title: "Worker moved to open_app",
    message: `Worker ${workerCode ?? input.accountId} moved to open_app after break.`,
    workerCode,
    queue,
    reason: "break_finished_not_available",
  });
}

// Function เริ่ม BullMQ worker กลางสำหรับงาน timeout, accept, scan, warning, vendor และกะงาน
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
      const assignment = await assignmentRepository.findAssignmentById(
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

      if (assignment.status !== ASSIGNMENT_STATUS.PENDING) {
        return;
      }

      const vehicleJob = await vehicleJobRepository.findVehicleJobById(
        assignment.vehicle_job_id,
        transaction
      );
      const workerCode = await profileRepository.findWorkerCodeByAccountId(workerAccountId);
      const timeoutResult = await handleAssignmentAcceptTimeout({
        assignment,
        workerAccountId,
        connection: transaction,
      });

      sendWorkerSocketEvent(workerAccountId, "ASSIGNMENT_TIMEOUT", {
        ticketNo: vehicleJob?.ticketNo ?? null,
        reason: timeoutResult.reason,
        timeout_count: timeoutResult.timeout_count,
        timeout_limit: timeoutResult.timeout_limit,
      });
      publishAdminWorkerStatusChanged({
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
        workerCode,
        queue: timeoutResult.queue,
        reason: timeoutResult.reason,
        extraPayload: {
          timeout_count: timeoutResult.timeout_count,
          timeout_limit: timeoutResult.timeout_limit,
        },
      });
      publishNotification({
        type: "ASSIGNMENT_TIMEOUT",
        title: "Assignment timed out",
        message: `Worker ${workerCode ?? workerAccountId} did not accept vehicle job ${vehicleJob?.ticketNo ?? "-"}.`,
        payload: {
          ticketNo: vehicleJob?.ticketNo ?? null,
          worker_code: workerCode,
          status: ASSIGNMENT_STATUS.TIMEOUT,
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
