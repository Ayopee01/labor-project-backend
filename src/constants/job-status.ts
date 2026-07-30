// Config central assignment statuses used by worker dispatch, QR scan, delivery, and history flows.
export const ASSIGNMENT_STATUS = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  SCANNED: "SCANNED",
  WORKING: "WORKING",
  DELIVERED: "DELIVERED",
  REJECT: "REJECT",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  TIMEOUT: "TIMEOUT",
} as const;

// Config central vehicle/market job statuses for persisted job lifecycle.
export const VEHICLE_JOB_STATUS = {
  WAIT: "WAIT",
  WORKING: "WORKING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

// Config operational statuses for the Admin vehicle operation board only.
export const VEHICLE_OPERATION_STATUS = {
  UNLOAD_NOW: "unload_now",
  WAITING_UNLOAD: "waiting_unload",
  WAITING_QUEUE: "waiting_queue",
  DRIVER_WAITING_QUEUE: "driver_waiting_queue",
} as const;

// Config central ticket/booth statuses for delivery and vendor confirmation flows.
export const TICKET_STATUS = {
  WAIT: "WAIT",
  WORKING: "WORKING",
  DELIVERED: "DELIVERED",
  REJECT: "REJECT",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

// Config assignment statuses that still reserve a worker for a vehicle job.
export const ACTIVE_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
];

// Config assignment statuses that mean the worker is already doing or waiting on delivery work.
export const WORKING_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
];

// Config assignment statuses that count as QR checked-in for vehicle readiness.
export const SCANNED_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
  ASSIGNMENT_STATUS.COMPLETED,
];

// Config assignment statuses kept in finished/history views after dispatch has ended.
export const FINISHED_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
  ASSIGNMENT_STATUS.COMPLETED,
];

// Config ticket statuses that stop the booth from being picked as the current open ticket.
export const TERMINAL_TICKET_STATUSES: string[] = [
  TICKET_STATUS.COMPLETED,
  TICKET_STATUS.CANCELLED,
];

// Config vehicle statuses that stop history/operation flows from treating the job as active.
export const TERMINAL_JOB_STATUSES: string[] = [
  VEHICLE_JOB_STATUS.COMPLETED,
  VEHICLE_JOB_STATUS.CANCELLED,
];
