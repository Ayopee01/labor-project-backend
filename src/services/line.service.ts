// import Library
import crypto from "crypto";
// import
import { withTransaction } from "../db/prisma";
import { enqueueLineMessage } from "../queues/notification-queue";
import * as lineRepository from "../repositories/line.repository";
import * as workerApplicationRepository from "../repositories/worker-application.repository";
import { accountRepository } from "../repositories/worker-application.repository";
import { publishRealtimeEvent } from "./realtime.service";
// import Types
import type { LineWebhookEvent } from "../types/line.type";
import type { GateTicketDto } from "../types/worker.type";
// import Utils
import ApiError from "../utils/api-error";

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
  action: string | null;
  ticketId: number | null;
} {
  if (!data) {
    return {
      action: null,
      ticketId: null,
    };
  }

  const params = new URLSearchParams(data);
  const ticketId = Number(params.get("ticketId"));

  return {
    action: params.get("action"),
    ticketId: Number.isInteger(ticketId) && ticketId > 0 ? ticketId : null,
  };
}

// Function รับ LINE webhook จาก vendor เพื่อ confirm/reject ยอดปิดงาน
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
    const { action, ticketId } = parseLinePostback(event.postback?.data);

    if (
      event.type !== "postback" ||
      !event.source?.userId ||
      !ticketId ||
      !["vendor_confirm_completion", "vendor_reject_completion"].includes(action ?? "")
    ) {
      continue;
    }

    const result = await withTransaction(async (transaction) => {
      const ticket = await workerApplicationRepository.findGateTicketForCompletion(
        ticketId,
        transaction
      );

      if (!ticket || ticket.vendor_line_id !== event.source?.userId) {
        return null;
      }

      const submission = await workerApplicationRepository.findWaitingTicketCompletionSubmission(
        ticket.id,
        transaction
      );

      if (!submission) {
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
              transaction
            );
      const isConfirmed = action === "vendor_confirm_completion";
      const title = isConfirmed
        ? "Ticket completion confirmed"
        : "Ticket completion rejected";
      const notificationMessage = isConfirmed
        ? `Vendor confirmed ticket ${updated.ticket.ticket_no ?? updated.ticket.stall_job_ref}.`
        : `Vendor rejected ticket ${updated.ticket.ticket_no ?? updated.ticket.stall_job_ref}.`;
      const receiverAccountIds = await buildTicketResultAudience(
        updated.ticket,
        transaction
      );
      const products = await workerApplicationRepository.listTicketProducts(
        updated.ticket.id,
        transaction
      );

      return {
        ...updated,
        products,
        notificationEvent: {
          title,
          message: notificationMessage,
          receiverAccountIds,
        },
        vendorMessage: isConfirmed
          ? "Ticket completion confirmed. Thank you."
          : "Ticket completion rejected. Worker can resubmit the corrected quantities.",
      };
    });

    if (!result) {
      continue;
    }

    const lineLogId = await lineRepository.createMessageDeliveryLog(
      "LINE",
      "send_vendor_ticket_completion_result",
      {
        ticket_id: result.ticket.id,
        submission_id: result.submission.id,
        status: result.submission.status,
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
        ticket_id: result.ticket.id,
        vehicle_job_id: result.ticket.vehicle_job_id,
        status: result.ticket.status,
        confirmation_status: result.ticket.confirmation_status,
        submission_id: result.submission.id,
        submission_status: result.submission.status,
        items: result.products,
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
