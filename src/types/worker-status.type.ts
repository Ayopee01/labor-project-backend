// Config worker work statuses shared by Worker Mobile and Admin queue board.
export const WORKER_WORK_STATUSES = [
  "open_app",
  "ready",
  "assigned",
  "working",
  "break",
] as const;

// Type value of the 5 worker work statuses used across the project.
export type WorkerWorkStatus = (typeof WORKER_WORK_STATUSES)[number];
