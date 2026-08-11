// Import Library
import crypto from "crypto";
// Import Dependencies
import { withTransaction } from "../db/prisma";
import { enqueueLoggedLineMessage } from "../queues/notification-queue";
import { returnCompletedWorkersToQueue } from "../queues/worker-dispatch";
import { removeVendorConfirmationTimeout } from "../queues/worker-queue";
import * as lineRepository from "../repositories/line.repository";
import * as workerApplicationRepository from "../repositories/worker.repository";
import { publishRealtimeEvent } from "./notifications.service";
import { applyVendorTicketCompletionResult } from "./shared/ticket-completion.service";
import { TICKET_STATUS } from "../constants/job-status";
// Import Types
import type { LineMessage, LineWebhookEvent, VendorTicketAction, VendorTicketActionTokenPayload } from "../types/line.type";
import type { GateTicketDto, VehicleJobDetailResponse } from "../types/worker.type";
// Import Utils
import ApiError from "../utils/api-error";
import { buildVendorCompletionResultFlexMessage, buildVendorRatingPromptFlexMessage, buildVendorRatingResultFlexMessages } from "../utils/line-flex-message";
import { buildWorkerTicketPayload } from "../utils/ticket-payload";
import { verifyVendorTicketActionToken } from "../utils/vendor-action-token";

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจสอบ LINE signature ใน service flow
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

// Function อ่านค่า LINE postback ใน service flow
function parseLinePostback(data: string | undefined): {
  action: VendorTicketAction | null;
  token: string | null;
  rejectReason: string | null;
  score: number | null;
} {
  if (!data) {
    return {
      action: null,
      token: null,
      rejectReason: null,
      score: null,
    };
  }

  const params = new URLSearchParams(data);
  const action = params.get("action");
  const rawRejectReason =
    params.get("reject_reason") ?? params.get("reason") ?? null;
  const rejectReason = rawRejectReason?.trim() || null;
  const rawScore = params.get("score");
  const score =
    rawScore && /^\d+$/.test(rawScore) ? Number(rawScore) : null;

  return {
    action:
      action === "vendor_confirm_completion" ||
        action === "vendor_reject_completion" ||
        action === "vendor_rate_ticket"
        ? action
        : null,
    token: params.get("token"),
    rejectReason,
    score,
  };
}

// Function ตรวจว่า vendor ticket action ใน service flow
function isVendorTicketAction(value: unknown): value is VendorTicketAction {
  return (
    value === "vendor_confirm_completion" ||
    value === "vendor_reject_completion" ||
    value === "vendor_rate_ticket"
  );
}

// Function ตรวจสอบ LINE action token ใน service flow
async function verifyLineActionToken(
  token: string,
  expectedAction?: VendorTicketAction
): Promise<VendorTicketActionTokenPayload | null> {
  const storedToken = await lineRepository.findLineActionToken(token);

  if (storedToken) {
    if (
      !isVendorTicketAction(storedToken.action) ||
      (expectedAction && storedToken.action !== expectedAction) ||
      Date.parse(storedToken.expires_at) <= Date.now()
    ) {
      return null;
    }

    return {
      token_type: "vendor_ticket_action",
      action: storedToken.action,
      ticket_id: storedToken.ticket_id,
      submission_id: storedToken.submission_id,
      boothCode: storedToken.boothCode,
      iat: Math.floor(Date.parse(storedToken.created_at) / 1000),
      exp: Math.floor(Date.parse(storedToken.expires_at) / 1000),
    };
  }

  try {
    return verifyVendorTicketActionToken(token, expectedAction);
  } catch (error) {
    if (error instanceof ApiError) {
      return null;
    }

    throw error;
  }
}

// Function ดึง LINE user ID ใน service flow
function getLineUserId(event: LineWebhookEvent): string | null {
  return event.source?.userId ?? event.source?.user_id ?? null;
}

// Function ตรวจว่า valid rating score ใน service flow
function isValidRatingScore(score: number | null): score is number {
  return typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 5;
}

// Function อ่านยอดสุดท้ายของแผงหลัง Financialization
function requireFinalStallAmountBaht(ticket: GateTicketDto): number {
  if (ticket.final_stall_amount === null || ticket.financialized_at === null) {
    throw new ApiError(
      500,
      "TICKET_FINANCIAL_STATE_INVALID",
      "Completed ticket does not have finalized financial data."
    );
  }

  const amount = Number(ticket.final_stall_amount);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(
      500,
      "TICKET_FINAL_STALL_AMOUNT_INVALID",
      "Final stall amount is invalid."
    );
  }

  return amount;
}

// Function สร้าง vendor rating messages ใน service flow
async function buildVendorRatingMessages(
  ticket: GateTicketDto,
  submissionId: number,
  detail: VehicleJobDetailResponse | null
): Promise<LineMessage[]> {
  const ratingToken = await lineRepository.createLineActionToken({
    action: "vendor_rate_ticket",
    ticket_id: ticket.id,
    submission_id: submissionId,
    boothCode: ticket.boothCode,
  });

  return [
    buildVendorRatingPromptFlexMessage({
      ticket,
      detail,
      ratingToken: ratingToken.token,
    }),
  ];
}

// Function สร้าง vendor duplicate action messages ใน service flow
function buildVendorDuplicateActionMessages(): LineMessage[] {
  return [
    {
      type: "text",
      text: "รายการนี้ได้รับการดำเนินการเรียบร้อยแล้ว",
    },
  ];
}

// Function จัดการ handle LINE webhook ใน service flow
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
    const { action, token, rejectReason, score } = parseLinePostback(event.postback?.data);
    const lineUserId = getLineUserId(event);

    if (
      event.type !== "postback" ||
      !lineUserId ||
      !token
    ) {
      continue;
    }

    const tokenPayload = await verifyLineActionToken(token, action ?? undefined);
    const resolvedAction = action ?? tokenPayload?.action ?? null;

    if (!tokenPayload || !resolvedAction) {
      continue;
    }

    if (resolvedAction === "vendor_rate_ticket") {
      if (!isValidRatingScore(score)) {
        continue;
      }

      const ratingResult = await withTransaction(async (transaction) => {
        const ticket = await workerApplicationRepository.findGateTicketForCompletion(
          tokenPayload.ticket_id,
          transaction
        );
        const vendorLineTargets = ticket
          ? await workerApplicationRepository.listActiveVendorLineTargetsForTicket(
            ticket.id,
            transaction
          )
          : [];
        const vendorLineTarget = vendorLineTargets.find(
          (target) => target.line_user_id === lineUserId
        );

        if (
          !ticket ||
          !vendorLineTarget ||
          ticket.boothCode !== tokenPayload.boothCode ||
          ticket.status !== TICKET_STATUS.COMPLETED
        ) {
          return null;
        }

        const submission = await workerApplicationRepository.findTicketCompletionSubmissionById(
          tokenPayload.submission_id,
          transaction
        );

        if (
          !submission ||
          submission.ticket_id !== ticket.id ||
          submission.status !== TICKET_STATUS.COMPLETED
        ) {
          return null;
        }

        const [rating, products, detail] = await Promise.all([
          lineRepository.upsertTicketRating(
            {
              ticket_id: ticket.id,
              submission_id: submission.id,
              line_user_id: lineUserId,
              target_type: vendorLineTarget.target_type,
              score,
            },
            transaction
          ),
          workerApplicationRepository.listTicketProducts(ticket.id, transaction),
          workerApplicationRepository.getVehicleJobDetail(
            ticket.vehicle_job_id,
            transaction
          ),
        ]);

        return {
          ticket,
          submission,
          rating,
          products,
          detail,
        };
      });

      if (!ratingResult) {
        continue;
      }

      const stallAmountBaht = requireFinalStallAmountBaht(ratingResult.ticket);

      await enqueueLoggedLineMessage({
        jobName: "send-vendor-ticket-rating-result",
        action: "send_vendor_ticket_rating_result",
        targetLineUserId: lineUserId,
        payload: {
          ticket_id: ratingResult.ticket.id,
          submission_id: ratingResult.submission.id,
          line_user_id: lineUserId,
          score: ratingResult.rating.score,
          final_stall_amount: ratingResult.ticket.final_stall_amount,
        },
        messages: buildVendorRatingResultFlexMessages({
          ticket: ratingResult.ticket,
          detail: ratingResult.detail,
          score: ratingResult.rating.score,
          stallAmountBaht,
        }),
      });

      publishRealtimeEvent({
        type: "TICKET_RATED",
        title: "Ticket rated",
        message: `Vendor rated ticket ${ratingResult.ticket.boothCode} ${ratingResult.rating.score}/5.`,
        payload: {
          ...buildWorkerTicketPayload(
            ratingResult.ticket,
            ratingResult.detail,
            ratingResult.products,
            {
              submission_status: ratingResult.submission.status,
              rating_score: ratingResult.rating.score,
              line_target_type: ratingResult.rating.target_type,
            }
          ),
        },
        admin: true,
      });

      processed += 1;
      continue;
    }

    if (
      resolvedAction !== "vendor_confirm_completion" &&
      resolvedAction !== "vendor_reject_completion"
    ) {
      continue;
    }

    const result = await withTransaction(async (transaction) => {
      const ticket = await workerApplicationRepository.findGateTicketForCompletion(
        tokenPayload.ticket_id,
        transaction
      );
      const vendorLineTargets = ticket
        ? await workerApplicationRepository.listActiveVendorLineTargetsForTicket(
          ticket.id,
          transaction
        )
        : [];
      const vendorLineTarget = vendorLineTargets.find(
        (target) => target.line_user_id === lineUserId
      );

      if (
        !ticket ||
        !vendorLineTarget ||
        ticket.boothCode !== tokenPayload.boothCode
      ) {
        return null;
      }

      const submission = await workerApplicationRepository.findWaitingTicketCompletionSubmission(
        ticket.id,
        transaction
      );

      if (!submission || submission.id !== tokenPayload.submission_id) {
        const tokenSubmission =
          await workerApplicationRepository.findTicketCompletionSubmissionById(
            tokenPayload.submission_id,
            transaction
          );

        if (
          tokenSubmission &&
          tokenSubmission.ticket_id === ticket.id &&
          ([TICKET_STATUS.COMPLETED, TICKET_STATUS.REJECT] as string[]).includes(tokenSubmission.status)
        ) {
          const detail = await workerApplicationRepository.getVehicleJobDetail(
            ticket.vehicle_job_id,
            transaction
          );

          return {
            kind: "already_handled" as const,
            ticket,
            submission: tokenSubmission,
            detail,
            vendorLineTarget,
          };
        }

        return null;
      }

      const completionResult = await applyVendorTicketCompletionResult({
        ticket,
        submission,
        action: resolvedAction === "vendor_confirm_completion" ? "confirm" : "reject",
        rejectReason,
        resolvedByLineUserId: lineUserId,
        connection: transaction,
      });

      return {
        kind: "processed" as const,
        ...completionResult,
        vendorLineTarget,
      };
    });

    if (!result) {
      continue;
    }

    if (result.kind === "already_handled") {
      await enqueueLoggedLineMessage({
        jobName: "send-vendor-ticket-already-handled",
        action: "send_vendor_ticket_already_handled",
        targetLineUserId: lineUserId,
        payload: {
          ticket_id: result.ticket.id,
          submission_id: result.submission.id,
          status: result.submission.status,
          line_user_id: lineUserId,
          previous_line_user_id: result.submission.resolved_by_line_user_id,
        },
        messages: buildVendorDuplicateActionMessages(),
      });
      processed += 1;
      continue;
    }

    await removeVendorConfirmationTimeout(result.ticket.id, result.submission.id);
    await returnCompletedWorkersToQueue(result.completedVehicleJob);

    await enqueueLoggedLineMessage({
      jobName: "send-vendor-ticket-completion-result",
      action: "send_vendor_ticket_completion_result",
      targetLineUserId: lineUserId,
      payload: {
        ticket_id: result.ticket.id,
        submission_id: result.submission.id,
        status: result.submission.status,
        reject_reason: result.ticket.reject_reason,
      },
      messages: [
        buildVendorCompletionResultFlexMessage({
          ticket: result.ticket,
          detail: result.detail,
          isConfirmed: result.isConfirmed,
        }),
      ],
    });

    if (result.isConfirmed) {
      const ratingMessages = await buildVendorRatingMessages(
        result.ticket,
        result.submission.id,
        result.detail
      );
      await enqueueLoggedLineMessage({
        jobName: "send-vendor-ticket-rating-prompt",
        action: "send_vendor_ticket_rating_prompt",
        targetLineUserId: lineUserId,
        payload: {
          ticket_id: result.ticket.id,
          submission_id: result.submission.id,
          line_user_id: lineUserId,
          line_target_type: result.vendorLineTarget.target_type,
        },
        messages: ratingMessages,
      });
    }

    publishRealtimeEvent({
      type: "TICKET_COMPLETION_RESULT",
      title: result.title,
      message: result.message,
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
      worker_account_ids: result.receiverAccountIds,
    });

    processed += 1;
  }

  return {
    message: "LINE webhook processed.",
    processed,
  };
}
