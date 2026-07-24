// import Library
import crypto from "crypto";
// import
import { withTransaction } from "../db/prisma";
import { enqueueLineMessage } from "../queues/notification-queue";
import { dispatchReadyWorkers } from "../queues/worker-dispatch";
import { enqueueWorker, markWorkerOpenApp, removeVendorConfirmationTimeout } from "../queues/worker-queue";
import * as lineRepository from "../repositories/line.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { accountRepository, profileRepository, workScheduleRepository } from "../repositories/worker-application.repository";
import { isWorkerSocketConnected, sendWorkerSocketEvent } from "../websockets/worker.socket";
import { publishNotification } from "./notifications.service";
import { publishRealtimeEvent } from "./realtime.service";
// import Types
import type { LineWebhookEvent, VendorTicketAction, VendorTicketActionTokenPayload } from "../types/line.type";
import type { GateTicketDto, VehicleJobDto } from "../types/worker.type";
// import Utils
import ApiError from "../utils/api-error";
import { isTimeInWorkSchedule } from "../utils/shift";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { verifyVendorTicketActionToken } from "../utils/vendor-action-token";
import { buildWorkerQueueSocketPayload } from "../utils/worker-queue-payload";

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจ LINE signature เมื่อมีการตั้งค่า LINE_CHANNEL_SECRET
function verifyLineSignature(rawBody: string | undefined, signature: unknown): void {
  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!secret) {
    return;
  }

  if (!rawBody || typeof signature !== "string") {
    throw new ApiError(401, "INVALID_LINE_SIGNATURE", "LINE signature is required.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new ApiError(401, "INVALID_LINE_SIGNATURE", "LINE signature is invalid.");
  }
}

// Function หา receiver ของ event ปิดงาน เพื่อส่ง SSE ให้ worker ใน ticket และ admin ทุกคน
async function buildTicketResultAudience(
  ticket: GateTicketDto,
  connection?: Parameters<typeof workerApplicationRepository.listTicketWorkers>[1]
): Promise<number[]> {
  const [ticketWorkers, admins] = await Promise.all([
    workerApplicationRepository.listTicketWorkers(ticket.id, connection),
    accountRepository.listAdmins(connection),
  ]);
  const receiverIds = new Set<number>();

  ticketWorkers.forEach((worker) => receiverIds.add(worker.worker_account_id));
  admins.forEach((admin) => receiverIds.add(admin.id));

  return Array.from(receiverIds);
}

// Function อ่าน postback จาก LINE เป็น action และ ticket id
function parseLinePostback(data: string | undefined): {
  action: VendorTicketAction | null;
  token: string | null;
  rejectReason: string | null;
} {
  if (!data) {
    return {
      action: null,
      token: null,
      rejectReason: null,
    };
  }

  const params = new URLSearchParams(data);
  const action = params.get("action");
  const rawRejectReason =
    params.get("reject_reason") ?? params.get("reason") ?? null;
  const rejectReason = rawRejectReason?.trim() || null;

  return {
    action:
      action === "vendor_confirm_completion" ||
      action === "vendor_reject_completion"
        ? action
        : null,
    token: params.get("token"),
    rejectReason,
  };
}

// Function แปลงรายการสินค้าใน ticket เป็น payload สำหรับ Worker/Admin realtime
// Function หา market ของ ticket จากรายละเอียดงานรถเพื่อเติมข้อมูลใน realtime payload
// Function สร้าง payload ผลการปิด ticket สำหรับ Worker/Admin โดยใช้ reference แทน id ภายใน
// Function แปลง account id ของ worker เป็นรหัสพนักงานสำหรับ response/event
async function getWorkerCodesByAccountIds(
  workerAccountIds: number[]
): Promise<Array<string | null>> {
  const profiles = await profileRepository.findByAccountIds(workerAccountIds);
  const profileMap = new Map(
    profiles.map((profile) => [profile.account_id, profile.worker_code])
  );

  return workerAccountIds.map((accountId) => profileMap.get(accountId) ?? null);
}

// Function ดึงรหัสพนักงาน worker รายคนจาก profile
// Function สร้าง payload สถานะคิวสำหรับส่งเข้า Worker WebSocket
// Function คืน worker ที่จบงานแล้วเข้า queue หรือ open_app ตามสถานะ WebSocket และกะงาน
async function returnCompletedWorkersToQueue(input: {
  vehicle_job: VehicleJobDto;
  completed_worker_account_ids: number[];
} | null): Promise<Array<string | null>> {
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
          ticketNo: input.vehicle_job.ticketNo,
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
          ticketNo: input.vehicle_job.ticketNo,
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

// Function ตรวจ token ของ LINE postback และคืน payload เมื่อ action ตรงกัน
function verifyLineActionToken(
  action: VendorTicketAction,
  token: string
): VendorTicketActionTokenPayload | null {
  try {
    return verifyVendorTicketActionToken(token, action);
  } catch (error) {
    if (error instanceof ApiError) {
      return null;
    }

    throw error;
  }
}

// Function ประมวลผล LINE webhook สำหรับ vendor confirm/reject งานแผง
export async function handleLineWebhook(
  body: unknown,
  signature?: unknown,
  rawBody?: string
): Promise<{
  message: string;
  processed: number;
}> {
  verifyLineSignature(rawBody, signature);

  const events = Array.isArray((body as { events?: unknown }).events)
    ? ((body as { events: LineWebhookEvent[] }).events)
    : [];
  let processed = 0;

  for (const event of events) {
    const { action, token, rejectReason } = parseLinePostback(event.postback?.data);

    if (
      event.type !== "postback" ||
      !event.source?.userId ||
      !action ||
      !token
    ) {
      continue;
    }

    const tokenPayload = verifyLineActionToken(action, token);

    if (!tokenPayload) {
      continue;
    }

    const result = await withTransaction(async (transaction) => {
      const ticket = await workerApplicationRepository.findGateTicketForCompletion(
        tokenPayload.ticket_id,
        transaction
      );

      if (
        !ticket ||
        ticket.vendor_line_id !== event.source?.userId ||
        ticket.boothCode !== tokenPayload.boothCode
      ) {
        return null;
      }

      const submission = await workerApplicationRepository.findWaitingTicketCompletionSubmission(
        ticket.id,
        transaction
      );

      if (!submission || submission.id !== tokenPayload.submission_id) {
        return null;
      }

      const updated =
        action === "vendor_confirm_completion"
          ? await workerApplicationRepository.confirmTicketCompletion(
              ticket.id,
              submission.id,
              transaction
            )
          : await workerApplicationRepository.rejectTicketCompletion(
              ticket.id,
              submission.id,
              rejectReason,
              transaction
            );
      const isConfirmed = action === "vendor_confirm_completion";
      const completedVehicleJob = isConfirmed
        ? await workerApplicationRepository.closeCompletedVehicleJobIfReady(
            updated.ticket.vehicle_job_id,
            transaction
          )
        : null;
      const nextTicket = isConfirmed && !completedVehicleJob
        ? await workerApplicationRepository.activateNextTicketIfReady(
            updated.ticket.vehicle_job_id,
            transaction
          )
        : null;
      if (isConfirmed && !completedVehicleJob) {
        await workerApplicationRepository.markVehicleAssignmentsWorking(
          updated.ticket.vehicle_job_id,
          transaction
        );
      }
      if (!isConfirmed) {
        await workerApplicationRepository.markVehicleAssignmentsRejected(
          updated.ticket.vehicle_job_id,
          transaction
        );
      }
      const title = isConfirmed
        ? "Ticket completion confirmed"
        : "Ticket completion rejected";
      const notificationMessage = isConfirmed
        ? `Vendor confirmed ticket ${updated.ticket.boothCode}.`
        : `Vendor rejected ticket ${updated.ticket.boothCode}.`;
      const receiverAccountIds = await buildTicketResultAudience(
        updated.ticket,
        transaction
      );
      const products = await workerApplicationRepository.listTicketProducts(
        updated.ticket.id,
        transaction
      );
      const detail = await workerApplicationRepository.getVehicleJobDetail(
        updated.ticket.vehicle_job_id,
        transaction
      );

      const completedWorkerCodes = completedVehicleJob
        ? await getWorkerCodesByAccountIds(
            completedVehicleJob.completed_worker_account_ids
          )
        : [];
      const assignmentStatus = isConfirmed
        ? completedVehicleJob
          ? "COMPLETED"
          : "WORKING"
        : "REJECT";

      return {
        ...updated,
        products,
        detail,
        notificationEvent: {
          title,
          message: notificationMessage,
          receiverAccountIds,
        },
        completedVehicleJob,
        completedWorkerCodes,
        nextTicket,
        assignmentStatus,
        vendorMessage: isConfirmed
          ? "Ticket completion confirmed. Thank you."
          : "Ticket completion rejected. Worker can resubmit the corrected quantities.",
      };
    });

    if (!result) {
      continue;
    }

    await removeVendorConfirmationTimeout(result.ticket.id, result.submission.id);
    await returnCompletedWorkersToQueue(result.completedVehicleJob);

    const lineLogId = await lineRepository.createMessageDeliveryLog(
      "LINE",
      "send_vendor_ticket_completion_result",
      {
        ticket_id: result.ticket.id,
        submission_id: result.submission.id,
            status: result.submission.status,
            reject_reason: result.ticket.reject_reason,
          },
      event.source.userId
    );
    await enqueueLineMessage("send-vendor-ticket-completion-result", {
      log_id: lineLogId,
      to: event.source.userId,
      messages: [
        {
          type: "text",
          text: result.vendorMessage,
        },
      ],
    });

    publishRealtimeEvent({
      type: "TICKET_COMPLETION_RESULT",
      title: result.notificationEvent.title,
      message: result.notificationEvent.message,
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
          }
        ),
      },
      admin: true,
      worker_account_ids: result.notificationEvent.receiverAccountIds,
    });

    processed += 1;
  }

  return {
    message: "LINE webhook processed.",
    processed,
  };
}
