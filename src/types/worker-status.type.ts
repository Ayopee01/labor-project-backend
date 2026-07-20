export const WORKER_WORK_STATUSES = [
  "open_app",
  "ready",
  "assigned",
  "working",
  "break",
] as const;

export type WorkerWorkStatus = (typeof WORKER_WORK_STATUSES)[number];
