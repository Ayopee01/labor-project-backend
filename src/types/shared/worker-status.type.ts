// Config สถานะการทำงานของ worker ที่ใช้ร่วมกันระหว่าง Mobile และบอร์ดคิว Admin
export const WORKER_WORK_STATUS = {
  OPEN_APP: "open_app",
  READY: "ready",
  ASSIGNED: "assigned",
  WAITING_TEAM: "waiting_team",
  WORKING: "working",
  BREAK: "break",
} as const;

// Config รายการสถานะการทำงานของ worker ทั้งหมด (derive จาก WORKER_WORK_STATUS ด้านบนเพียงจุดเดียว
// กันสองรายการเพี้ยนไม่ตรงกัน)
export const WORKER_WORK_STATUSES = Object.values(WORKER_WORK_STATUS);

// Type ค่า 6 สถานะการทำงานของ worker ที่ใช้ทั้ง project
export type WorkerWorkStatus = (typeof WORKER_WORK_STATUS)[keyof typeof WORKER_WORK_STATUS];
