import { z } from "zod";

import { withTransaction } from "../db/prisma";
import { returnCompletedWorkersToQueue } from "../queues/worker-dispatch";
import { removeVendorConfirmationTimeout } from "../queues/worker-queue";
import * as lineRepository from "../repositories/line.repository";
import * as gateTicketRepository from "../repositories/shared/gate-ticket.repository";
import { TICKET_STATUS } from "../constants/job-status";
import type { LineDevCompletionResult, LineDevSubmissionItem, VendorTicketCompletionAction } from "../types/line.type";
import ApiError from "../utils/api-error";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { parseId, parseWithSchema } from "../validation/parser";
import { applyVendorTicketCompletionResult } from "./shared/ticket-completion.service";
import { publishRealtimeEvent } from "./shared/realtime-notification.service";

const LINE_DEV_RESOLVER_ID = "line-dev-tester";
const lineDevRejectBodySchema = z.object({
  reject_reason: z.string().trim().max(1000).optional(),
});

// Function ป้องกันไม่ให้หน้า LINE dev และ action ทดสอบเปิดใน production
export function assertLineDevEnabled(): void {
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(404, "NOT_FOUND", "Route not found.");
  }
}

// Function ดึง Submission ทั้งหมดสำหรับหน้า LINE dev tester
export async function listLineDevSubmissions(): Promise<{
  data: LineDevSubmissionItem[];
}> {
  assertLineDevEnabled();
  return {
    data: await lineRepository.listLineDevSubmissions(),
  };
}

// Function ยืนยันหรือปฏิเสธ Submission จากหน้า LINE dev โดยใช้ completion flow เดียวกับ LINE จริง
// แต่จงใจไม่ enqueue ข้อความ LINE เพื่อไม่ใช้ Messaging API quota
export async function processLineDevSubmission(
  submissionIdParam: unknown,
  action: VendorTicketCompletionAction,
  body: unknown = {},
): Promise<LineDevCompletionResult> {
  assertLineDevEnabled();
  const submissionId = parseId(submissionIdParam);
  const rejectInput = parseWithSchema(lineDevRejectBodySchema, body ?? {});

  const result = await withTransaction(async (transaction) => {
    const submission =
      await gateTicketRepository.findTicketCompletionSubmissionById(
        submissionId,
        transaction,
      );

    if (!submission) {
      throw new ApiError(
        404,
        "SUBMISSION_NOT_FOUND",
        "Ticket completion submission was not found.",
      );
    }

    const ticket = await gateTicketRepository.findGateTicketForCompletion(
      submission.ticket_id,
      transaction,
    );
    const waitingSubmission = ticket
      ? await gateTicketRepository.findWaitingTicketCompletionSubmission(
          ticket.id,
          transaction,
        )
      : null;

    if (
      !ticket ||
      ticket.status !== TICKET_STATUS.DELIVERED ||
      submission.status !== TICKET_STATUS.DELIVERED ||
      waitingSubmission?.id !== submission.id
    ) {
      throw new ApiError(
        409,
        "SUBMISSION_ALREADY_HANDLED",
        "This submission has already been confirmed, rejected, or superseded.",
      );
    }

    return applyVendorTicketCompletionResult({
      ticket,
      submission,
      action,
      rejectReason:
        action === "reject" ? rejectInput.reject_reason ?? null : null,
      resolvedByLineUserId: LINE_DEV_RESOLVER_ID,
      connection: transaction,
    });
  });

  await removeVendorConfirmationTimeout(result.ticket.id, result.submission.id);
  await returnCompletedWorkersToQueue(result.completedVehicleJob);

  const realtimePayload = buildWorkerTicketPayload(
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
      reason: "line_dev_tester",
    },
  );

  publishRealtimeEvent({
    type: "TICKET_COMPLETION_RESULT",
    title: result.title,
    message: `${result.message} (LINE dev tester)`,
    payload: realtimePayload,
    worker_payload: realtimePayload,
    admin: true,
    worker_account_ids: result.receiverAccountIds,
  });

  return {
    message:
      action === "confirm"
        ? "Confirmed from LINE dev tester without sending a LINE message."
        : "Rejected from LINE dev tester without sending a LINE message.",
    submission_id: result.submission.id,
    ticket_id: result.ticket.id,
    boothCode: result.ticket.boothCode,
    ticket_status: result.ticket.status,
    submission_status: result.submission.status,
    action,
    vehicle_job_status: result.completedVehicleJob?.vehicle_job.status ?? null,
  };
}
