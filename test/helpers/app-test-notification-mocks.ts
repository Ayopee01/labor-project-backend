import { state } from "./app-test-state";

async function resolveTicketResultAudience(ticket: { id: number }) {
  const ticketWorkerIds = state.ticketWorkers
    .filter((worker) => worker.ticket_id === ticket.id)
    .map((worker) => worker.worker_account_id);
  const adminIds = Array.from(state.authAccountsById.values())
    .filter((account) => account.role === "admin")
    .map((account) => account.id);

  return [...new Set([...ticketWorkerIds, ...adminIds])];
}

export const notificationServiceMock = {
  publishNotification: (event: unknown) => state.notifications.push(event),
  publishRealtimeEvent: (event: unknown) => state.realtimeEvents.push(event),
  resolveTicketResultAudience,
  publishAdminWorkerStatusChanged: (event: {
    title: string;
    message: string;
    workerCode: string | null;
    queue: unknown;
    reason: string;
    extraPayload?: Record<string, unknown>;
  }) =>
    state.notifications.push({
      type: "WORKER_STATUS_CHANGED",
      title: event.title,
      message: event.message,
      payload: {
        worker_code: event.workerCode,
        queue: event.queue,
        reason: event.reason,
        ...(event.extraPayload ?? {}),
      },
      audience: {
        roles: ["admin"],
      },
    }),
};

export const realtimeNotificationServiceMock = {
  publishRealtimeEvent: (event: unknown) => state.realtimeEvents.push(event),
  resolveTicketResultAudience,
};

export const workerSocketMock = {
  isWorkerSocketConnected: (accountId: number) =>
    state.connectedWorkers.has(accountId),
  sendWorkerSocketEvent: (
    accountId: number,
    event: string,
    payload: unknown,
  ) => {
    state.socketEvents.push({
      accountId,
      event,
      payload,
    });
  },
};

export const notificationQueueMock = {
  enqueueLineMessage: async (name: string, data: unknown) => {
    state.lineMessages.push({
      name,
      data,
    });
  },
  enqueueLoggedLineMessage: async (input: {
    jobName: string;
    targetLineUserId: string;
    messages: unknown;
  }) => {
    state.lineMessages.push({
      name: input.jobName,
      data: {
        log_id: 1,
        to: input.targetLineUserId,
        messages: input.messages,
      },
    });
    return 1;
  },
};

export const lineRepositoryMock = {
  createMessageDeliveryLog: async () => 1,
  createLineActionToken: async (input: {
    action: string;
    ticket_id: number;
    submission_id: number;
    boothCode: string;
    expires_at?: Date;
  }) => {
    const now = new Date();
    const id = state.nextLineActionTokenId++;
    const record = {
      id,
      token: `line-action-token-${id}`,
      action: input.action,
      ticket_id: input.ticket_id,
      submission_id: input.submission_id,
      boothCode: input.boothCode,
      expires_at:
        input.expires_at?.toISOString() ??
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      used_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    state.lineActionTokens.push(record);
    return record;
  },
  findLineActionToken: async (token: string) =>
    state.lineActionTokens.find((record) => record.token === token) ?? null,
  upsertTicketRating: async (input: {
    ticket_id: number;
    submission_id: number;
    line_user_id: string;
    target_type?: string | null;
    score: number;
  }) => {
    const now = new Date().toISOString();
    const rating = state.ticketRatings.find(
      (item) => item.ticket_id === input.ticket_id,
    );

    if (!rating) {
      const newRating = {
        id: state.nextRatingId++,
        ticket_id: input.ticket_id,
        submission_id: input.submission_id,
        line_user_id: input.line_user_id,
        target_type: input.target_type ?? null,
        score: input.score,
        rated_at: now,
        created_at: now,
        updated_at: now,
      };
      state.ticketRatings.push(newRating);
      return newRating;
    }

    return rating;
  },
};
