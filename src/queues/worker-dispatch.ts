import { withTransaction } from "../db/prisma";
import * as workScheduleRepository from "../repositories/shared/work-schedule.repository";
import * as marketJobRepository from "../repositories/shared/market-job.repository";
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
import { sendMobileAppForceUpdateNotification, sendMobileAppReleaseNotification } from "../services/shared/mobile-app-version.service";
import { enqueueWorker, getWorkerQueueStatus, markWorkerAssigned, markWorkerOpenApp, popReadyWorkers, removeScanWarning, scheduleAssignmentTimeout, scheduleScanTimeout, scheduleScanWarning, scheduleWorkerShiftEnd, startAssignmentTimeoutWorker, startWorkerBreakReturnWorker } from "./worker-queue";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import type { DbConnection } from "../types/shared/common.type";
import type { AssignmentAcceptTimeoutResult, CompletedWorkerQueueResult, VehicleJobAssignmentDto } from "../types/worker.type";
import type { WorkScheduleDto } from "../types/admin-workers.type";
import { buildWorkScheduleShiftInstanceKey, getWorkScheduleShiftEndDelayMs, isTimeInWorkSchedule } from "../utils/shift";
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
    await dispatchReadyWorkersForVehicleJob(vehicleJob, acceptDeadlineMs, connection);
  }
}

// Function จ่าย Worker ให้ VehicleJob คันเดียวภายใต้ lock
async function dispatchReadyWorkersForVehicleJob(
  vehicleJob: Awaited<ReturnType<typeof vehicleJobRepository.listDispatchableVehicleJobs>>[number],
  acceptDeadlineMs: number,
  connection?: DbConnection
): Promise<void> {
  if (!connection) {
    return withTransaction((transaction) =>
      dispatchReadyWorkersForVehicleJob(vehicleJob, acceptDeadlineMs, transaction)
    );
  }

  await connection.$queryRaw`SELECT id FROM vehicle_jobs WHERE id = ${vehicleJob.id} FOR UPDATE`;

  const activeAssignments = await assignmentRepository.countActiveAssignments(
    vehicleJob.id,
    connection
  );
  let workersNeeded = vehicleJob.workers_required - activeAssignments;

  if (workersNeeded <= 0) {
    return;
  }

  while (workersNeeded > 0) {
    const readyWorkers = await popReadyWorkers(workersNeeded);

    if (readyWorkers.length === 0) {
      break;
    }
    const workerCodeMap = await profileRepository.findWorkerCodeMapByAccountIds(
      readyWorkers.map((worker) => worker.worker_id),
      connection
    );

    for (const worker of readyWorkers) {
      const workerCode = workerCodeMap.get(worker.worker_id) ?? null;

      // Function ดีด Worker นอกกะออกจากคิวก่อน dispatch
      const workerSchedule = await workScheduleRepository.findCurrentByAccountId(
        worker.worker_id,
        connection
      );

      if (!workerSchedule || !isTimeInWorkSchedule(workerSchedule)) {
        if (workerSchedule) {
          await ejectWorkerForShiftEnd(worker.worker_id, workerSchedule);
        } else {
          await markWorkerOpenApp(worker.worker_id);
        }

        continue;
      }

      let assignment: VehicleJobAssignmentDto;

      try {
        assignment = await assignmentRepository.createAssignment(
          vehicleJob.id,
          worker.worker_id,
          buildDeadline(acceptDeadlineMs),
          connection
        );
        await markWorkerAssigned(worker.worker_id);
        await scheduleAssignmentTimeout(
          assignment.id,
          worker.worker_id,
          acceptDeadlineMs
        );
      } catch (error) {
        // Function คืน Worker เข้า FIFO เมื่อสร้าง assignment ล้มเหลว
        await enqueueWorker(worker.worker_id);
        continue;
      }

      const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
        vehicleJob.id,
        connection
      );

      sendWorkerSocketEvent(
        worker.worker_id,
        "WORKER_ASSIGNED",
        buildWorkerAssignedPayload(assignment, vehicleJob, ticketNos)
      );
      publishNotification({
        type: "WORKER_ASSIGNED",
        title: "Worker assigned",
        message: `Worker ${workerCode ?? worker.worker_id} was assigned to vehicle job ${vehicleJob.ticket_number}.`,
        payload: {
          ticketNumber: vehicleJob.ticket_number,
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

/* -------------------------------------- Timeout Handlers -------------------------------------- */

// Function จัดการ assignment accept timeout แบบกัน race
export async function handleAssignmentAcceptTimeout(input: {
  assignment: VehicleJobAssignmentDto;
  workerId: number;
  connection?: DbConnection;
}): Promise<AssignmentAcceptTimeoutResult | null> {
  const timedOutAssignment = await assignmentRepository.timeoutAssignment(
    input.assignment.id,
    WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPT_TIMEOUT,
    input.connection
  );

  if (!timedOutAssignment) {
    return null;
  }

  const settings = await getRuntimeSettings();
  const currentSchedule = await workScheduleRepository.findCurrentByAccountId(
    input.workerId,
    input.connection
  );
  const hasActiveSchedule =
    currentSchedule !== null && isTimeInWorkSchedule(currentSchedule);
  let timeoutCount = 1;
  let queue: AssignmentAcceptTimeoutResult["queue"];
  let reason = "assignment_timeout_requeue";
  let closedShift = false;

  if (hasActiveSchedule) {
    const shiftInstanceKey = buildWorkScheduleShiftInstanceKey(currentSchedule);
    const workerCode = await profileRepository.findWorkerCodeByAccountId(
      input.workerId,
      input.connection
    );
    const attendance = await workerShiftAttendanceRepository.incrementAcceptTimeoutStreak(
      {
        worker_id: input.workerId,
        worker_code: workerCode ?? String(input.workerId),
        schedule: currentSchedule,
        shift_instance_key: shiftInstanceKey,
      },
      input.connection
    );
    timeoutCount = attendance.acceptTimeoutStreak;

    if (timeoutCount >= settings.worker_accept_timeout_limit) {
      await workerShiftAttendanceRepository.closeWorkerShift(
        {
          worker_id: input.workerId,
          worker_code: workerCode ?? String(input.workerId),
          schedule: currentSchedule,
          shift_instance_key: shiftInstanceKey,
          reason: "assignment_timeout_limit_reached",
        },
        input.connection
      );
      queue = await markWorkerOpenApp(input.workerId);
      reason = "assignment_timeout_limit_reached";
      closedShift = true;
    } else {
      queue = await enqueueWorker(input.workerId);
    }
  } else {
    queue = await markWorkerOpenApp(input.workerId);
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
  workerId: number;
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
        input.assignment.worker_id,
        remainingDelayMs
      ),
      scheduleScanWarning(
        input.assignment.id,
        input.assignment.worker_id,
        input.assignment.scan_deadline_at
      ),
    ]);
    return;
  }

  const timedOutAssignment = await assignmentRepository.timeoutAssignment(
    input.assignment.id,
    WORKER_ASSIGNMENT_EVENT_TYPE.SCAN_TIMEOUT,
    input.connection
  );

  if (!timedOutAssignment) {
    // แพ้ race ให้ worker scan สำเร็จไปแล้วหรือถูก Admin cancel พร้อมกัน — ไม่ต้องแจ้งเตือน
    // timeout ที่จริงๆ ไม่ได้เกิดขึ้น
    return;
  }

  const vehicleJob = await vehicleJobRepository.findVehicleJobById(
    input.assignment.vehicle_job_id,
    input.connection
  );
  const workerCode = await profileRepository.findWorkerCodeByAccountId(input.workerId);
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
  const queue = await markWorkerOpenApp(input.workerId);
  await dispatchReadyWorkers(input.connection);
  const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
    input.assignment.vehicle_job_id,
    input.connection,
  );

  sendWorkerSocketEvent(input.workerId, "ASSIGNMENT_TIMEOUT", {
    ticketNumber: vehicleJob?.ticket_number ?? null,
    ticketNos,
    reason: "scan_timeout",
    status: WORKER_WORK_STATUS.OPEN_APP,
  });
  publishAdminWorkerStatusChanged({
    title: "Worker returned to open app",
    message: `Worker ${workerCode ?? input.workerId} missed QR check-in and returned to open app.`,
    workerCode,
    queue,
    reason: "scan_timeout_open_app",
  });
  publishNotification({
    type: "ASSIGNMENT_TIMEOUT",
    title: "Assignment scan timed out",
    message: `Worker ${workerCode ?? input.workerId} did not scan QR for vehicle job ${vehicleJob?.ticket_number ?? "-"}.`,
    payload: {
      ticketNumber: vehicleJob?.ticket_number ?? null,
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
  workerId: number;
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
      input.assignment.worker_id,
      input.assignment.scan_deadline_at
    );
    return;
  }

  const [vehicleJob, workerCode] = await Promise.all([
    vehicleJobRepository.findVehicleJobById(
      input.assignment.vehicle_job_id,
      input.connection
    ),
    profileRepository.findWorkerCodeByAccountId(input.workerId),
  ]);
  const remainingSeconds = Math.ceil(remainingDelayMs / 1000);

  publishNotification({
    type: "ASSIGNMENT_SCAN_DEADLINE_WARNING",
    title: "Worker has not checked in",
    message: `Worker ${workerCode ?? input.workerId} has not checked in and the scan deadline is near.`,
    payload: {
      ticketNumber: vehicleJob?.ticket_number ?? null,
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
  if (!input || input.completed_worker_ids.length === 0) {
    return [];
  }

  const requeuedWorkerCodes: Array<string | null> = [];
  const workerCodeMap = await profileRepository.findWorkerCodeMapByAccountIds(
    input.completed_worker_ids
  );

  for (const workerId of input.completed_worker_ids) {
    const workerCode = workerCodeMap.get(workerId) ?? null;
    const [currentSchedule, currentAssignment] = await Promise.all([
      workScheduleRepository.findCurrentByAccountId(workerId),
      assignmentRepository.findCurrentAssignmentByWorker(workerId),
    ]);

    if (currentAssignment) {
      continue;
    }

    const canReturnToQueue =
      currentSchedule &&
      isTimeInWorkSchedule(currentSchedule);

    if (canReturnToQueue) {
      const queue = await enqueueWorker(workerId);
      requeuedWorkerCodes.push(workerCode);
      sendWorkerSocketEvent(workerId, "WORKER_STATUS_CHANGED", {
        queue: buildWorkerQueueSocketPayload(queue, workerCode),
      });
      publishAdminWorkerStatusChanged({
        title: "Worker returned to queue",
        message: `Worker ${workerCode ?? workerId} returned to queue after vehicle job completion.`,
        workerCode,
        queue,
        reason: "vehicle_job_completed_requeue",
        extraPayload: {
          ticketNumber: input.vehicle_job.ticket_number,
        },
      });
      continue;
    }

    const queue = await markWorkerOpenApp(workerId);
    if (isWorkerSocketConnected(workerId)) {
      sendWorkerSocketEvent(workerId, "WORKER_STATUS_CHANGED", {
        queue: buildWorkerQueueSocketPayload(queue, workerCode),
      });
    }
    publishAdminWorkerStatusChanged({
      title: "Worker moved to open_app",
      message: `Worker ${workerCode ?? workerId} moved to open_app after vehicle job completion.`,
      workerCode,
      queue,
      reason: "vehicle_job_completed_not_available",
      extraPayload: {
        ticketNumber: input.vehicle_job.ticket_number,
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
          confirmed_at: result.submission.confirmed_at,
          rejected_at: result.submission.rejected_at,
          vehicle_job_status: result.completedVehicleJob?.vehicle_job.status,
          completed_worker_codes: result.completedWorkerCodes,
          ticket_completed_at:
            result.completedVehicleJob?.vehicle_job.updated_at ?? null,
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
          confirmed_at: result.submission.confirmed_at,
          rejected_at: result.submission.rejected_at,
          vehicle_job_status: result.completedVehicleJob?.vehicle_job.status,
          completed_worker_codes: result.completedWorkerCodes,
          ticket_completed_at:
            result.completedVehicleJob?.vehicle_job.updated_at ?? null,
          nextMarketCode: result.nextTicket?.marketCode ?? null,
          nextBoothCode: result.nextTicket?.ticket.boothCode ?? null,
          next_ticket_status: result.nextTicket?.ticket.status ?? null,
          assignment_status: result.assignmentStatus,
          reason: "vendor_confirm_timeout",
        }
      ),
    },
    admin: true,
    worker_ids: result.receiverAccountIds,
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
  workerId: number;
  scheduleId: number;
  shiftInstanceKey?: string;
}): Promise<void> {
  const schedule = await workScheduleRepository.findById(input.scheduleId);

  if (!schedule || schedule.worker_id !== input.workerId) {
    return;
  }

  // Function อ่าน schedule สดก่อนปิดกะจาก delayed job
  if (isTimeInWorkSchedule(schedule)) {
    await scheduleWorkerShiftEnd(
      input.workerId,
      input.scheduleId,
      getWorkScheduleShiftEndDelayMs(schedule),
      input.shiftInstanceKey
    );

    return;
  }

  await ejectWorkerForShiftEnd(input.workerId, schedule, input.shiftInstanceKey);
}

// Function ปิด attendance ของกะที่จบแล้วและคืน Worker เป็น open_app
async function ejectWorkerForShiftEnd(
  workerId: number,
  schedule: WorkScheduleDto,
  shiftInstanceKeyInput?: string
): Promise<void> {
  const shiftInstanceKey =
    shiftInstanceKeyInput ?? buildWorkScheduleShiftInstanceKey(schedule);
  const workerCode = await profileRepository.findWorkerCodeByAccountId(workerId);

  await workerShiftAttendanceRepository.closeWorkerShift(
    {
      worker_id: workerId,
      worker_code: workerCode ?? String(workerId),
      schedule,
      shift_instance_key: shiftInstanceKey,
      reason: "shift_ended",
    }
  );

  const currentAssignment = await assignmentRepository.findCurrentAssignmentByWorker(
    workerId
  );

  if (currentAssignment) {
    return;
  }

  const queue = await markWorkerOpenApp(workerId);

  if (isWorkerSocketConnected(workerId)) {
    sendWorkerSocketEvent(workerId, "WORKER_STATUS_CHANGED", {
      queue: buildWorkerQueueSocketPayload(queue, workerCode),
      reason: "shift_ended",
    });
  }
  publishAdminWorkerStatusChanged({
    title: "Worker shift closed",
    message: `Worker ${workerCode ?? workerId} moved to open_app because the shift ended.`,
    workerCode,
    queue,
    reason: "shift_ended",
  });
}

// Function พา worker กลับจาก break เข้าคิว หรือกลับ open_app ถ้า socket/กะ/assignment ไม่พร้อม
async function handleWorkerBreakReturn(input: {
  workerId: number;
  scheduleId: number;
}): Promise<void> {
  const queueEntry = await getWorkerQueueStatus(input.workerId);

  if (!queueEntry || queueEntry.status !== WORKER_WORK_STATUS.BREAK) {
    return;
  }

  const [currentSchedule, currentAssignment] = await Promise.all([
    workScheduleRepository.findCurrentByAccountId(input.workerId),
    assignmentRepository.findCurrentAssignmentByWorker(input.workerId),
  ]);

  if (
    currentSchedule &&
    currentSchedule.id === input.scheduleId &&
    isTimeInWorkSchedule(currentSchedule) &&
    !currentAssignment &&
    isWorkerSocketConnected(input.workerId)
  ) {
    const queue = await enqueueWorker(input.workerId);
    const workerCode = await profileRepository.findWorkerCodeByAccountId(input.workerId);
    publishAdminWorkerStatusChanged({
      title: "Worker break finished",
      message: `Worker ${workerCode ?? input.workerId} returned to queue after break.`,
      workerCode,
      queue,
      reason: "break_finished_requeue",
    });
    await dispatchReadyWorkers();
    return;
  }

  const queue = await markWorkerOpenApp(input.workerId);
  const workerCode = await profileRepository.findWorkerCodeByAccountId(input.workerId);
  publishAdminWorkerStatusChanged({
    title: "Worker moved to open_app",
    message: `Worker ${workerCode ?? input.workerId} moved to open_app after break.`,
    workerCode,
    queue,
    reason: "break_finished_not_available",
  });
}

// Function เริ่ม BullMQ worker กลางสำหรับงาน timeout, accept, scan, warning, vendor และกะงาน
export function startAssignmentTimeoutProcessing(): void {
  startAssignmentTimeoutWorker(async ({ assignmentId, workerId, ticketId, submissionId, mobileAppVersionId, kind }) => {
    if (kind === "mobile_app_release_notification") {
      if (mobileAppVersionId) {
        await sendMobileAppReleaseNotification(mobileAppVersionId);
      }
      return;
    }

    if (kind === "mobile_app_force_update_notification") {
      if (mobileAppVersionId) {
        await sendMobileAppForceUpdateNotification(mobileAppVersionId);
      }
      return;
    }

    if (kind === "vendor_confirm") {
      await handleVendorConfirmationTimeout({ ticketId, submissionId });
      return;
    }

    if (!assignmentId || !workerId) {
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
          workerId,
          connection: transaction,
        });
        return;
      }

      if (kind === "scan_warning") {
        await handleAssignmentScanWarning({
          assignment,
          workerId,
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
      const workerCode = await profileRepository.findWorkerCodeByAccountId(workerId);
      const timeoutResult = await handleAssignmentAcceptTimeout({
        assignment,
        workerId,
        connection: transaction,
      });

      if (!timeoutResult) {
        // Function ข้าม timeout notification เมื่อแพ้ race
        return;
      }

      const ticketNos = await marketJobRepository.listActiveTicketNosByVehicleJobId(
        assignment.vehicle_job_id,
        transaction,
      );

      sendWorkerSocketEvent(workerId, "ASSIGNMENT_TIMEOUT", {
        ticketNumber: vehicleJob?.ticket_number ?? null,
        ticketNos,
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
          ? `Worker ${workerCode ?? workerId} moved to open_app after reaching the assignment timeout limit.`
          : timeoutResult.reason === "assignment_timeout_requeue"
            ? `Worker ${workerCode ?? workerId} returned to queue after assignment timeout.`
            : `Worker ${workerCode ?? workerId} moved to open_app after assignment timeout.`,
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
        message: `Worker ${workerCode ?? workerId} did not accept vehicle job ${vehicleJob?.ticket_number ?? "-"}.`,
        payload: {
          ticketNumber: vehicleJob?.ticket_number ?? null,
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

  startWorkerBreakReturnWorker(async ({ workerId, scheduleId, shiftInstanceKey, kind }) => {
    if (kind === "shift_end") {
      await handleWorkerShiftEnd({ workerId, scheduleId, shiftInstanceKey });
      return;
    }

    await handleWorkerBreakReturn({ workerId, scheduleId });
  });
}
