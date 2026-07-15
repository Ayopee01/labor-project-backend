// import
import { withTransaction } from "../db/prisma";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { workScheduleRepository } from "../repositories/worker-application.repository";
import { getRuntimeSettings } from "../services/admin-settings.service";
import { publishNotification } from "../services/notifications.service";
import { enqueueWorker, getWorkerQueueStatus, markWorkerBusy, markWorkerOffline, popReadyWorkers, scheduleAssignmentTimeout, startAssignmentTimeoutWorker, startWorkerBreakReturnWorker } from "./worker-queue";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
// import Utils
import { isTimeInWorkSchedule } from "../utils/shift";
import { buildDeadline } from "../utils/time";
import { buildWorkerAssignedPayload } from "../utils/worker-assignment-event";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึงรหัสพนักงาน worker จาก account id สำหรับ notification/event
async function getWorkerCode(accountId: number): Promise<string | null> {
  const profile = await workerApplicationRepository.profileRepository.findByAccountId(
    accountId
  );

  return profile?.worker_code ?? null;
}

async function getWorkerCodeMap(accountIds: number[]): Promise<Map<number, string>> {
  const profiles = await workerApplicationRepository.profileRepository.findByAccountIds(
    accountIds
  );

  return new Map(
    profiles.map((profile) => [profile.account_id, profile.worker_code])
  );
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
      const workerCodeMap = await getWorkerCodeMap(
        readyWorkers.map((worker) => worker.account_id)
      );

      for (const worker of readyWorkers) {
        const workerCode = workerCodeMap.get(worker.account_id) ?? null;

        if (!isWorkerSocketConnected(worker.account_id)) {
          const queue = await markWorkerOffline(worker.account_id);
          publishNotification({
            type: "WORKER_STATUS_CHANGED",
            title: "Worker offline",
            message: `Worker ${workerCode ?? worker.account_id} was marked offline because WebSocket is not connected.`,
            payload: {
              worker_code: workerCode,
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

      const vehicleJob = await workerApplicationRepository.findVehicleJobById(
        assignment.vehicle_job_id,
        transaction
      );
      const workerCode = await getWorkerCode(workerAccountId);

      await workerApplicationRepository.timeoutAssignment(assignment.id, transaction);
      if (isWorkerSocketConnected(workerAccountId)) {
        const queue = await enqueueWorker(workerAccountId);
        publishNotification({
          type: "WORKER_STATUS_CHANGED",
          title: "Worker returned to queue",
          message: `Worker ${workerCode ?? workerAccountId} returned to queue after assignment timeout.`,
          payload: {
            worker_code: workerCode,
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
          message: `Worker ${workerCode ?? workerAccountId} was marked offline after assignment timeout.`,
          payload: {
            worker_code: workerCode,
            queue,
            reason: "assignment_timeout_socket_disconnected",
          },
          audience: {
            roles: ["admin"],
          },
        });
      }
      sendWorkerSocketEvent(workerAccountId, "ASSIGNMENT_TIMEOUT", {
        vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
      });
      publishNotification({
        type: "ASSIGNMENT_TIMEOUT",
        title: "Assignment timed out",
        message: `Worker ${workerCode ?? workerAccountId} did not accept vehicle job ${vehicleJob?.vehicle_job_ref ?? "-"}.`,
        payload: {
          vehicle_job_ref: vehicleJob?.vehicle_job_ref ?? null,
          worker_code: workerCode,
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
      isTimeInWorkSchedule(currentSchedule) &&
      !currentAssignment &&
      isWorkerSocketConnected(accountId)
    ) {
      const queue = await enqueueWorker(accountId);
      const workerCode = await getWorkerCode(accountId);
      publishNotification({
        type: "WORKER_STATUS_CHANGED",
        title: "Worker break finished",
        message: `Worker ${workerCode ?? accountId} returned to queue after break.`,
        payload: {
          worker_code: workerCode,
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
    const workerCode = await getWorkerCode(accountId);
    publishNotification({
      type: "WORKER_STATUS_CHANGED",
      title: "Worker offline",
      message: `Worker ${workerCode ?? accountId} was marked offline after break.`,
      payload: {
        worker_code: workerCode,
        queue,
        reason: "break_finished_not_available",
      },
      audience: {
        roles: ["admin"],
      },
    });
  });
}
