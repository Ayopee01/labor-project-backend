// Config สถานะกลางของ assignment ที่ใช้กับ dispatch, scan QR, ส่งยอด และประวัติ
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

// Config สถานะกลางของงานรถ/ตลาดสำหรับ lifecycle ที่บันทึกลง DB
export const VEHICLE_JOB_STATUS = {
  WAIT: "WAIT",
  WORKING: "WORKING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

// Config สถานะ operation สำหรับบอร์ดจัดการรถฝั่ง Admin เท่านั้น
export const VEHICLE_OPERATION_STATUS = {
  UNLOAD_NOW: "unload_now",
  WAITING_UNLOAD: "waiting_unload",
  WAITING_QUEUE: "waiting_queue",
  DRIVER_WAITING_QUEUE: "driver_waiting_queue",
} as const;

// Config สถานะกลางของ ticket/booth สำหรับ flow ส่งยอดและ vendor ยืนยัน
export const TICKET_STATUS = {
  WAIT: "WAIT",
  WORKING: "WORKING",
  DELIVERED: "DELIVERED",
  REJECT: "REJECT",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

// Config สถานะ membership ของ Worker ภายใน Ticket/Booth 
export const TICKET_WORKER_STATUS = {
  WORKING: "WORKING", // Worker คนนี้ยังเป็นสมาชิกของ Booth และมีสิทธิ์ถูกนำไปคิดค่าแรง
  CANCELLED: "CANCELLED", // ถูกถอดออกก่อน Booth Complete จึงไม่มีสิทธิ์ได้เงิน Booth นี้
  COMPLETED: "COMPLETED", // เป็นสมาชิกที่ทำ Booth นี้เสร็จแล้ว และจะถูกใช้เป็นประวัติการจ่ายเงิน
} as const;

// Config สถานะ assignment ที่ยังล็อก worker ไว้กับงานรถ
export const ACTIVE_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
];

// Config สถานะ assignment ที่หมายถึง worker กำลังทำงานหรือรอผลส่งยอด
export const WORKING_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
];

// Config สถานะ assignment ที่นับว่า scan QR แล้วสำหรับเช็คความพร้อมของรถ
export const SCANNED_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
  ASSIGNMENT_STATUS.COMPLETED,
];

// Config สถานะ assignment ที่ยังเก็บไว้ในหน้าจบงานและประวัติหลัง dispatch สิ้นสุด
export const FINISHED_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
  ASSIGNMENT_STATUS.COMPLETED,
];

// Config สถานะ ticket ที่ทำให้ booth ไม่ถูกเลือกเป็นงานเปิดอยู่
export const TERMINAL_TICKET_STATUSES: string[] = [
  TICKET_STATUS.COMPLETED,
  TICKET_STATUS.CANCELLED,
];

// Config สถานะรถที่ทำให้ history/operation ไม่มองว่าเป็นงาน active
export const TERMINAL_JOB_STATUSES: string[] = [
  VEHICLE_JOB_STATUS.COMPLETED,
  VEHICLE_JOB_STATUS.CANCELLED,
];
