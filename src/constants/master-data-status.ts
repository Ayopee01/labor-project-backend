// Config ค่าสถานะ "ใช้งานได้" ของ master data ฝั่ง Gate — master_market ใช้ "Normal" (ทั้ง boothStatus
// และ marketStatus), master_owner_stall/master_member_stall ใช้ "active" คนละ field/table แต่ concept
// เดียวกัน ใช้ร่วมกันระหว่าง gate.repository.ts และ shared/gate-ticket.repository.ts กันพิมพ์ผิด
export const MASTER_MARKET_ACTIVE_STATUS = "Normal";
export const MASTER_OWNER_STALL_ACTIVE_STATUS = "active";
