// Config สถานะกลางของ assignment ที่ใช้กับ dispatch, scan QR, ส่งยอด และประวัติ
export const ASSIGNMENT_STATUS = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  SCANNED: "SCANNED",
  WORKING: "WORKING",
  DELIVERED: "DELIVERED",
  REJECT: "REJECT",
  COMPLETED: "COMPLETED",
  // Admin released this worker back to the FIFO queue early (all their booths submitted,
  // no unresolved reject) without waiting for the whole TicketNumber to close. Distinct
  // from COMPLETED, which means the whole vehicle job finished.
  RELEASED: "RELEASED",
  CANCELLED: "CANCELLED",
  TIMEOUT: "TIMEOUT",
} as const;

// Config สถานะกลางของงานรถ/ตลาดสำหรับ lifecycle ที่บันทึกลง DB
export const VEHICLE_JOB_STATUS = {
  WAIT: "WAIT",
  WORKING: "WORKING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  // Admin release-workers ตั้งไว้เมื่อทุก booth ที่มีตอนนี้ส่งยอดครบแล้วและทีมถูกปล่อยกลับคิวก่อนที่
  // TicketNumber จะปิดจริง (รอ Vendor ยืนยัน/timeout เท่านั้น) ไม่ใช่สถานะ terminal — ตั้งใจแยกออกจาก
  // WORKING เพื่อกัน listDispatchableVehicleJobs ดึง worker ใหม่กลับเข้างานนี้ซ้ำ ไม่ว่าจะเกิดจากการ
  // release เอง หรือ event อื่นภายหลัง (เช่น Vendor Reject) — Gate เพิ่ม booth ใหม่ให้ TicketNumber นี้
  // ทีหลังได้ตามปกติ ซึ่งจะเปิด dispatch กลับมาเองเหมือนตอน WAIT
  RELEASED: "RELEASED",
} as const;

// Config สถานะ operation สำหรับบอร์ดจัดการรถฝั่ง Admin เท่านั้น — mutually exclusive ทุกคันตกอยู่
// ค่าใดค่าหนึ่งเท่านั้น ตัดสินตามลำดับความสำคัญใน resolveVehicleOperationStatus (formatter)
export const VEHICLE_OPERATION_STATUS = {
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  // มี Booth อย่างน้อยหนึ่งใบสถานะ REJECT ค้างอยู่ (ยังไม่ได้แก้ไข/ส่งยอดใหม่) — มีสิทธิ์ก่อนเสมอ
  // เพราะเกิดขึ้นได้แม้หลัง release-workers ไปแล้ว (Worker/Admin ส่งยอดใหม่แล้ว Vendor reject ซ้ำ)
  REJECT: "reject",
  // dispatchNow = false ไม่ว่าจะเกิดจาก Gate ตั้งไว้ตอนสร้าง หรือ Admin เปลี่ยนจาก true เป็น false ทีหลัง
  WAIT_UNLOAD: "wait_unload",
  // dispatchNow = true แต่ worker active ยังไม่ครบ workers_required — ระบบกำลังดึงจากคิว FIFO อัตโนมัติ
  WAIT_WORKER: "wait_worker",
  // ทีมครบ + dispatchNow = true แต่ workStartedAt ยังเป็น null (ยังไม่มีใคร scan เข้างานครบทั้งทีม)
  READY_NOW: "ready_now",
  // workStartedAt ถูกตั้งแล้ว (ทีมทั้งหมด scan เข้างานครบ) — กำลังทำงานจริง
  WORKING: "working",
} as const;

// Config สถานะเงินสำหรับ Daily Worker Income เท่านั้น — แถวที่ไม่เข้าเงื่อนไขไหนเลย (เช่น TicketNo
// ยัง WORKING อยู่ ไม่มี reject ค้าง ไม่ถูกยกเลิก) จะไม่ถูกนับมาแสดงในรายงานนี้ ไม่ใช่แค่ปล่อยว่าง
export const DAILY_WORKER_INCOME_PAYMENT_STATUS = {
  // ticket_no (MarketJob) status = COMPLETED และ worker คนนี้ทำจนจบไม่เคยถูกยกเลิก
  SUCCESS: "success",
  // ticket_no status = COMPLETED แต่ worker คนนี้ถูกถอดออกจาก roster ก่อน ticket_no ปิดงาน
  // (ยังมีรายได้บางส่วนจาก booth ที่ confirm ไปแล้วก่อนถูกถอด)
  PARTIALLY_PAID: "partially_paid",
  // ticket_no ถูก Admin ยกเลิกไปทั้งใบ
  CANCEL: "cancel",
  // มี booth REJECT ค้างอยู่ใน ticket_no นี้ และ worker ถูก Admin release กลับคิวไปแล้วก่อนหน้า reject
  // นี้เกิดขึ้น (ระบบห้าม release ถ้ายังมี reject ค้างอยู่ ดังนั้น reject นี้ต้องเกิดหลัง release เสมอ)
  ADMIN_REJECT: "admin_reject",
  // มี booth REJECT ค้างอยู่ใน ticket_no นี้ ขณะที่ worker ยังไม่ถูก release (ยัง active อยู่กับงาน)
  WORKER_REJECT: "worker_reject",
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

// Config บทบาทของ Account ที่ส่งยอด Ticket Completion — Worker ส่งเอง หรือ Admin ส่งแทน (ต้อง
// snapshot ค่านี้ตอนสร้าง TicketCompletionSubmission เสมอ ห้าม derive จาก Account.role ตอนอ่าน
// เพราะ role ของ account เปลี่ยนได้ภายหลัง (เช่น Admin ถูกลดสิทธิ์) จะทำให้ประวัติเก่าผิดเพี้ยน
export const TICKET_SUBMITTER_ROLE = {
  WORKER: "worker",
  ADMIN: "admin",
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

// Config สถานะ assignment ที่นับว่า scan QR แล้วสำหรับเช็คความพร้อมของรถ — ต้องมี RELEASED คู่กับ
// FINISHED_ASSIGNMENT_STATUSES เสมอ (ทั้งคู่คือ "เคย scan เข้างานแล้ว") ไม่งั้น countScannedAssignments/
// getVehicleWorkReadiness/getVehicleJobTeamScanReadiness จะนับ worker ที่ release ไปแล้วว่า "ยังไม่
// scan" ทำให้ readiness ผิด (ค้าง WORKERS_NOT_CHECKED_IN ทั้งที่ทำงานจนส่งยอดครบและถูกปล่อยกลับคิวไปแล้ว)
// และ syncTicketWorkersFromVehicleAssignments จะมองว่า worker หลุดจากทีม แล้วไป Cancel สมาชิก
// TicketWorker ของเขาทิ้งผิดๆ ตอนแผงอื่นในตลาดเดียวกัน sync roster ซ้ำ (เช่น ตอน Vendor ยืนยันแผงอื่น)
export const SCANNED_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
  ASSIGNMENT_STATUS.REJECT,
  ASSIGNMENT_STATUS.COMPLETED,
  ASSIGNMENT_STATUS.RELEASED,
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
  ASSIGNMENT_STATUS.RELEASED,
];

// Config สถานะ assignment ที่ Admin ปล่อย Worker กลับคิวก่อนเวลาได้ (ทำงานอยู่ ยังไม่จบทั้งคัน)
export const RELEASABLE_ASSIGNMENT_STATUSES: string[] = [
  ASSIGNMENT_STATUS.SCANNED,
  ASSIGNMENT_STATUS.WORKING,
  ASSIGNMENT_STATUS.DELIVERED,
];

// Config สถานะ ticket ที่ทำให้ booth ไม่ถูกเลือกเป็นงานเปิดอยู่
export const TERMINAL_TICKET_STATUSES: string[] = [
  TICKET_STATUS.COMPLETED,
  TICKET_STATUS.CANCELLED,
];

// Config สถานะ ticket ที่แปลว่า Worker ไม่มีอะไรต้องทำที่ booth นี้อีกแล้ว (ส่งยอดแล้วรอ Vendor
// ยืนยัน, Vendor ยืนยันแล้ว, หรือถูกยกเลิกไปแล้ว) ใช้เป็นเงื่อนไข release-workers — ต่างจาก
// TERMINAL_TICKET_STATUSES ตรงที่รวม DELIVERED (ส่งยอดแล้ว ยังไม่ยืนยัน) ด้วย เพราะงานทางกาย
// ของ Worker จบตั้งแต่ส่งยอด ไม่ต้องรอ Vendor คลิกยืนยันถึงจะปล่อยกลับคิวได้ — REJECT ไม่รวม
// เพราะยังมี "unresolved rejection" ที่ Worker ต้องแก้ไขและส่งยอดใหม่
export const SUBMITTED_TICKET_STATUSES: string[] = [
  TICKET_STATUS.DELIVERED,
  TICKET_STATUS.COMPLETED,
  TICKET_STATUS.CANCELLED,
];

// Config สถานะรถที่ทำให้ history/operation ไม่มองว่าเป็นงาน active
export const TERMINAL_JOB_STATUSES: string[] = [
  VEHICLE_JOB_STATUS.COMPLETED,
  VEHICLE_JOB_STATUS.CANCELLED,
];
