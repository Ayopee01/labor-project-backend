// Config สถานะการทำงานของ worker ที่ใช้ร่วมกันระหว่าง Mobile และบอร์ดคิว Admin
export const WORKER_WORK_STATUSES = [
  "open_app",
  "ready",
  "assigned",
  "working",
  "break",
] as const;

export const WORKER_WORK_STATUS = {
  OPEN_APP: "open_app",
  READY: "ready",
  ASSIGNED: "assigned",
  WORKING: "working",
  BREAK: "break",
} as const;

// Type ค่า 5 สถานะการทำงานของ worker ที่ใช้ทั้ง project
export type WorkerWorkStatus = (typeof WORKER_WORK_STATUSES)[number];
