// import
import { withTransaction } from "../db/prisma";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { workScheduleRepository } from "../repositories/worker-application.repository";
import { getRuntimeSettings } from "../services/admin-settings.service";
import { publishNotification } from "../services/notifications.service";
import { enqueueWorker, getWorkerQueueStatus, markWorkerBusy, markWorkerOffline, popReadyWorkers, scheduleAssignmentTimeout, startAssignmentTimeoutWorker, startWorkerBreakReturnWorker } from "./worker-queue";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
// import Utils
import { isDateInWorkSchedule } from "../utils/shift";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างเวลา deadline จากเวลาปัจจุบัน
function buildDeadline(durationMs: number): Date {
  return new Date(Date.now() + durationMs);
}

// Function dispatch คนงานจาก FIFO ให้ทุกงานที่พร้อมเรียก
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

      for (const worker of readyWorkers) {
        if (!isWorkerSocketConnected(worker.account_id)) {
          const queue = await markWorkerOffline(worker.account_id);
          publishNotification({
            type: "WORKER_STATUS_CHANGED",
            title: "Worker offline",
            message: `Worker ${worker.account_id} was marked offline because WebSocket is not connected.`,
            payload: {
              worker_account_id: worker.account_id,
              queue,
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
        await markWorkerBusy(worker.account_id);
        await scheduleAssignmentTimeout(
          assignment.id,
          worker.account_id,
          acceptDeadlineMs
        );
        sendWorkerSocketEvent(worker.account_id, "WORKER_ASSIGNED", {
          assignment,
          vehicle_job: vehicleJob,
          accept_deadline_at: assignment.accept_deadline_at,
        });
        publishNotification({
          type: "WORKER_ASSIGNED",
          title: "Worker assigned",
          message: `Worker ${worker.account_id} was assigned to vehicle job ${vehicleJob.vehicle_job_ref}.`,
          payload: {
            assignment_id: assignment.id,
            vehicle_job_id: assignment.vehicle_job_id,
            vehicle_job_ref: vehicleJob.vehicle_job_ref,
            worker_account_id: worker.account_id,
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

// Function เริ่ม BullMQ worker สำหรับ assignment timeout และ break return
export function startAssignmentTimeoutProcessing(): void {
  startAssignmentTimeoutWorker(async ({ assignmentId, workerAccountId }) => {
    await withTransaction(async (transaction) => {
      const assignment = await workerApplicationRepository.findAssignmentById(
        assignmentId,
        transaction
      );

      if (!assignment || assignment.status !== "PENDING") {
        return;
      }

      await workerApplicationRepository.timeoutAssignment(assignment.id, transaction);
      if (isWorkerSocketConnected(workerAccountId)) {
        const queue = await enqueueWorker(workerAccountId);
        publishNotification({
          type: "WORKER_STATUS_CHANGED",
          title: "Worker returned to queue",
          message: `Worker ${workerAccountId} returned to queue after assignment timeout.`,
          payload: {
            worker_account_id: workerAccountId,
            queue,
            reason: "assignment_timeout_requeue",
          },
          audience: {
            roles: ["admin"],
          },
        });
      } else {
        const queue = await markWorkerOffline(workerAccountId);
        publishNotification({
          type: "WORKER_STATUS_CHANGED",
          title: "Worker offline",
          message: `Worker ${workerAccountId} was marked offline after assignment timeout.`,
          payload: {
            worker_account_id: workerAccountId,
            queue,
            reason: "assignment_timeout_socket_disconnected",
          },
          audience: {
            roles: ["admin"],
          },
        });
      }
      sendWorkerSocketEvent(workerAccountId, "ASSIGNMENT_TIMEOUT", {
        assignment_id: assignment.id,
        vehicle_job_id: assignment.vehicle_job_id,
      });
      publishNotification({
        type: "ASSIGNMENT_TIMEOUT",
        title: "Assignment timed out",
        message: `Assignment ${assignment.id} timed out.`,
        payload: {
          assignment_id: assignment.id,
          vehicle_job_id: assignment.vehicle_job_id,
          worker_account_id: workerAccountId,
          status: "TIMEOUT",
        },
        audience: {
          roles: ["admin"],
        },
      });
      await dispatchReadyWorkers(transaction);
    });
  });

  startWorkerBreakReturnWorker(async ({ accountId, scheduleId }) => {
    const queueEntry = await getWorkerQueueStatus(accountId);

    if (!queueEntry || queueEntry.status !== "break") {
      return;
    }

    const [currentSchedule, currentAssignment] = await Promise.all([
      workScheduleRepository.findCurrentByAccountId(accountId),
      workerApplicationRepository.findCurrentAssignmentByWorker(accountId),
    ]);

    if (
      currentSchedule &&
      currentSchedule.id === scheduleId &&
      isDateInWorkSchedule(currentSchedule) &&
      !currentAssignment
    ) {
      const queue = await enqueueWorker(accountId);
      publishNotification({
        type: "WORKER_STATUS_CHANGED",
        title: "Worker break finished",
        message: `Worker ${accountId} returned to queue after break.`,
        payload: {
          worker_account_id: accountId,
          queue,
          reason: "break_finished_requeue",
        },
        audience: {
          roles: ["admin"],
        },
      });
      await dispatchReadyWorkers();
      return;
    }

    const queue = await markWorkerOffline(accountId);
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker offline",
      message: `Worker ${accountId} was marked offline after break.`,
      payload: {
        worker_account_id: accountId,
        queue,
        reason: "break_finished_not_available",
      },
      audience: {
        roles: ["admin"],
      },
    });
  });
}
