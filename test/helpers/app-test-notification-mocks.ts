import { state } from "./app-test-state";

// Function จำลอง resolveTicketResultAudience จริงใน realtime-notification.service.ts — คืนเฉพาะ
// worker id เท่านั้น (Admin กระจายแยกผ่าน publishRealtimeEvent's admin:true เสมอ ไม่พึ่ง id list นี้
// — ดู comment ในไฟล์จริงเรื่องทำไมห้ามรวม Account.id กับ MasterWorker.id เข้าด้วยกัน)
async function resolveTicketResultAudience(ticket: { id: number; market_job_id?: number }) {
  const marketJobId =
    ticket.market_job_id ??
    state.gateTickets.find((item) => item.id === ticket.id)?.market_job_id;
  const ticketWorkerIds = state.ticketWorkers
    .filter((worker) => worker.market_job_id === marketJobId)
    .map((worker) => worker.worker_id);

  return [...new Set(ticketWorkerIds)];
}

export const notificationServiceMock = {
  publishNotification: (event: unknown) => state.notifications.push(event),
  publishRealtimeEvent: (event: { payload?: unknown; worker_payload?: unknown }) =>
    // เลียนแบบ fallback ของ publishRealtimeEvent จริงใน realtime-notification.service.ts
    // (worker_payload = input.worker_payload ?? payload) เพื่อให้ event ที่ mock บันทึกไว้ตรงกับสิ่งที่
    // worker ได้รับจริง แม้ caller จะไม่ได้ส่ง worker_payload มาแยกต่างหาก
    state.realtimeEvents.push({
      ...event,
      worker_payload: event.worker_payload ?? event.payload ?? {},
    }),
  buildWorkerNotification: (input: {
    type: string;
    lang?: string | null;
    notification_key?: string | null;
    fallbackTitle: string;
    fallbackMessage: string;
  }) => ({
    key: input.notification_key ?? input.type,
    lang: input.lang ?? "TH",
    title: input.fallbackTitle,
    message: input.fallbackMessage,
  }),
  persistWorkerNotification: (input: {
    worker_id: number;
    type: string;
    notification_key?: string | null;
    lang?: string | null;
    title: string;
    message: string;
    payload?: unknown;
  }) => {
    const now = new Date().toISOString();

    state.workerNotifications.push({
      id: state.nextWorkerNotificationId++,
      worker_id: input.worker_id,
      type: input.type,
      notification_key: input.notification_key ?? null,
      lang: input.lang ?? "TH",
      title: input.title,
      message: input.message,
      payload: input.payload ?? null,
      read_at: null,
      created_at: now,
      updated_at: now,
    });
  },
  persistWorkerNotifications: (
    inputs: Array<{
      worker_id: number;
      type: string;
      notification_key?: string | null;
      lang?: string | null;
      title: string;
      message: string;
      payload?: unknown;
    }>,
  ) => {
    for (const input of inputs) {
      notificationServiceMock.persistWorkerNotification(input);
    }
  },
  listWorkerNotifications: async (
    query: { page?: string; limit?: string },
    auth?: { account_id?: number; role?: string },
  ) => {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const filtered = state.workerNotifications
      .filter((item) => item.worker_id === auth?.account_id)
      .sort((left, right) =>
        right.created_at.localeCompare(left.created_at) || right.id - left.id
      );

    return {
      data: filtered.slice((page - 1) * limit, page * limit).map((item) => ({
        id: item.id,
        type: item.type,
        notification_key: item.notification_key,
        lang: item.lang,
        title: item.title,
        message: item.message,
        notification: {
          key: item.notification_key,
          lang: item.lang,
          title: item.title,
          message: item.message,
        },
        payload: item.payload,
        read_at: item.read_at,
        created_at: item.created_at,
      })),
      pagination: {
        page,
        limit,
        total: filtered.length,
        total_pages: Math.ceil(filtered.length / limit),
      },
    };
  },
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
  publishRealtimeEvent: (event: { payload?: unknown; worker_payload?: unknown }) =>
    // เลียนแบบ fallback ของ publishRealtimeEvent จริงใน realtime-notification.service.ts
    // (worker_payload = input.worker_payload ?? payload) เพื่อให้ event ที่ mock บันทึกไว้ตรงกับสิ่งที่
    // worker ได้รับจริง แม้ caller จะไม่ได้ส่ง worker_payload มาแยกต่างหาก
    state.realtimeEvents.push({
      ...event,
      worker_payload: event.worker_payload ?? event.payload ?? {},
    }),
  resolveTicketResultAudience,
};

export const workerSocketMock = {
  isWorkerSocketConnected: (workerId: number) =>
    state.connectedWorkers.has(workerId),
  sendWorkerSocketEvent: (
    workerId: number,
    event: string,
    payload: unknown,
  ) => {
    state.socketEvents.push({
      workerId,
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

export const MESSAGE_DELIVERY_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  FAILED: "FAILED",
} as const;

export const lineRepositoryMock = {
  MESSAGE_DELIVERY_STATUS,
  createMessageDeliveryLog: async (
    channel: string,
    jobName: string,
    payload: unknown,
    target?: string | null,
  ) => {
    const now = new Date().toISOString();
    const record = {
      id: state.nextMessageDeliveryLogId++,
      channel,
      job_name: jobName,
      target: target ?? null,
      status: MESSAGE_DELIVERY_STATUS.PENDING,
      sent_at: null,
      created_at: now,
      updated_at: now,
    };

    state.messageDeliveryLogs.push(record);
    return record.id;
  },
  updateMessageDeliveryLogStatus: async (
    id: number,
    status: string,
    _error?: string | null,
  ) => {
    const record = state.messageDeliveryLogs.find((item) => item.id === id);

    if (!record) {
      return;
    }

    record.status = status;
    record.updated_at = new Date().toISOString();

    if (status === MESSAGE_DELIVERY_STATUS.SENT) {
      record.sent_at = record.updated_at;
    }
  },
  listLineDevSubmissions: async () =>
    [...state.completionSubmissions]
      .sort(
        (left, right) =>
          (right.created_at ?? "").localeCompare(left.created_at ?? "") ||
          right.id - left.id,
      )
      .map((submission) => {
        const ticket = state.gateTickets.find(
          (item) => item.id === submission.ticket_id,
        )!;
        const market = state.marketJobs.find(
          (item) => item.id === ticket.market_job_id,
        )!;
        const vehicle = state.vehicleJobs.find(
          (item) => item.id === ticket.vehicle_job_id,
        )!;
        const submitterAccount = submission.submitted_by_account_id
          ? state.authAccountsById.get(submission.submitted_by_account_id)
          : undefined;
        const submitterWorker = submission.submitted_by_worker_id
          ? state.workers.get(submission.submitted_by_worker_id)
          : undefined;
        const submitterCode = submitterAccount?.username ?? submitterWorker?.labor_code ?? null;
        const submitterName = submitterAccount?.full_name ?? submitterWorker?.full_name ?? null;

        return {
          submission_id: submission.id,
          ticket_id: ticket.id,
          submission_status: submission.status,
          ticket_status: ticket.status,
          actionable:
            submission.status === "DELIVERED" && ticket.status === "DELIVERED",
          ticket_number: vehicle.ticket_number,
          ticket_no: market.ticket_no,
          license_plate: vehicle.license_plate,
          market_code: market.marketCode,
          market_name: market.marketName,
          boothCode: ticket.boothCode,
          boothName: ticket.boothName,
          submitted_by_code: submitterCode,
          submitted_by_name: submitterName,
          submitted_by_role: submission.submitted_by_role ?? "worker",
          submitted_at: submission.created_at ?? new Date().toISOString(),
          confirmed_at: submission.confirmed_at,
          rejected_at: submission.rejected_at,
          reject_reason: submission.reject_reason ?? null,
          products: state.ticketProducts
            .filter((product) => product.ticket_id === ticket.id)
            .map((product) => ({
              productCode: product.productCode,
              productName: product.productName,
              packageCode: product.packageCode,
              packageName: product.packageName,
              expected_quantity: product.quantity,
              submitted_quantity: product.confirmed_quantity,
            })),
        };
      }),
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
