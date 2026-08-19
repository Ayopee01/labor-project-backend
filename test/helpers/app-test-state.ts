import type {
  AccountRecord,
  AdminActionLogRecord,
  AssignmentRecord,
  GateClientRecord,
  GateRequestLogRecord,
  GateTicketRecord,
  LineActionTokenRecord,
  MarketJobRecord,
  MobileAppVersionRecord,
  MasterMarketRecord,
  MasterProductRecord,
  MasterRateRecord,
  TicketCompletionSubmissionRecord,
  TicketProductFinancialRecord,
  TicketProductRecord,
  TicketRatingRecord,
  TicketWorkerPaymentRecord,
  TicketWorkerRecord,
  VehicleJobRecord,
  WorkerAssignmentEventRecord,
  WorkerNotificationRecord,
  WorkerShiftAttendanceRecord,
} from "./app-test-harness.records";

/* -------------------------------------- Shared Test State -------------------------------------- */

export const state = {
  connectedWorkers: new Set<number>(),
  socketEvents: [] as Array<{
    accountId: number;
    event: string;
    payload: unknown;
  }>,
  notifications: [] as unknown[],
  realtimeEvents: [] as unknown[],
  lineMessages: [] as unknown[],
  workerPushTokens: [] as Array<{
    worker_code: string;
    session_id: number | null;
    device_id: string;
    platform: string;
    fcm_token: string;
    fcm_token_hash: string;
    is_active: boolean;
  }>,
  workerNotifications: [] as WorkerNotificationRecord[],
  workers: new Map<number, AccountRecord>(),
  schedules: new Map<number, unknown>(),
  vehicleJobs: [] as VehicleJobRecord[],
  marketJobs: [] as MarketJobRecord[],
  assignments: [] as AssignmentRecord[],
  workerAssignmentEvents: [] as WorkerAssignmentEventRecord[],
  gateTickets: [] as GateTicketRecord[],

  ticketProducts: [] as TicketProductRecord[],
  ticketWorkers: [] as TicketWorkerRecord[],
  ticketProductFinancials: [] as TicketProductFinancialRecord[],
  ticketWorkerPayments: [] as TicketWorkerPaymentRecord[],
  completionSubmissions: [] as TicketCompletionSubmissionRecord[],

  adminActionLogs: [] as AdminActionLogRecord[],
  ticketRatings: [] as TicketRatingRecord[],
  lineActionTokens: [] as LineActionTokenRecord[],
  gateRequestLogs: [] as GateRequestLogRecord[],
  masterMarkets: [] as MasterMarketRecord[],
  masterProducts: [] as MasterProductRecord[],
  masterRates: [] as MasterRateRecord[],
  gateClients: new Map<string, GateClientRecord>(),
  mobileAppVersions: [] as MobileAppVersionRecord[],
  shiftAttendances: [] as WorkerShiftAttendanceRecord[],
  authAccountsByUsername: new Map<string, AccountRecord>(),
  authAccountsById: new Map<number, AccountRecord>(),
  adminPermissions: new Map<number, string[]>(),
  profiles: new Map<number, unknown>(),
  authSchedules: new Map<number, unknown>(),
  sessions: new Map<number, Record<string, unknown>>(),
  queueJobs: new Map<
    string,
    Map<string, { data: unknown; removed: boolean }>
  >(),
  workerProcessors: new Map<
    string,
    (job: { data: unknown }) => Promise<void>
  >(),
  nextMarketJobId: 1,
  nextAssignmentId: 1,
  nextWorkerAssignmentEventId: 1,
  nextWorkerNotificationId: 1,
  nextSessionId: 1,
  nextTicketWorkerId: 1,
  nextTicketProductFinancialId: 1,
  nextTicketWorkerPaymentId: 1,
  nextSubmissionId: 1,
  nextRatingId: 1,
  nextLineActionTokenId: 1,
  nextGateClientId: 1,
  nextShiftAttendanceId: 1,
  nextAdminActionLogId: 1,
  nextMobileAppVersionId: 1,
};
