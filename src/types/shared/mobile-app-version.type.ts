// Type ผลลัพธ์การจัดกลุ่ม Mobile App Version ตามเวลา server: current/scheduled/history ไม่ใช่
// ค่าที่ persist ใน DB — derive จาก build_number + force_update_at เทียบกับเวลา ณ ตอน query
export const MOBILE_APP_VERSION_STATUSES = [
  "current",
  "scheduled",
  "history",
] as const;

export type MobileAppVersionStatus = (typeof MOBILE_APP_VERSION_STATUSES)[number];

export interface MobileAppVersionDto {
  id: number;
  version: string;
  build_number: number;
  // Metadata เท่านั้น ไว้แสดงบน UI/History ไม่ใช่ตัว trigger ส่ง FCM หรือ activate version
  release_at: string | null;
  android_download_url: string | null;
  ios_download_url: string | null;
  // มีค่า = Version นี้บังคับ Update ทั้งเวลา Activate และเวลาส่ง FCM บังคับอัตโนมัติ (ไม่มี field
  // boolean แยกต่างหากแล้ว เพื่อไม่ให้ขัดแย้งกับตัวมันเอง) ไม่มีค่า = มีผลทันทีแบบ Optional Update
  force_update_at: string | null;
  // null = ส่ง FCM แจ้งเตือนล่วงหน้าทันทีตอน POST/PATCH, มีค่า = ตั้งเวลาส่งผ่าน BullMQ
  release_notification_at: string | null;
  release_notification_sent_at: string | null;
  // FCM บังคับอัปเดตอัตโนมัติที่ยิงตอนถึง force_update_at พอดี (มาตรฐาน ไม่ต้องตั้งค่า) — ส่งแล้ว
  // หรือยัง แยกอิสระจาก release_notification_sent_at เพราะเป็นคนละข้อความคนละเวลากัน
  force_update_notification_sent_at: string | null;
  release_message: string | null;
  release_notes: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MobileAppVersionCreateInput {
  version: string;
  build_number: number;
  release_at?: string | null;
  android_download_url?: string | null;
  ios_download_url?: string | null;
  force_update_at?: string | null;
  release_notification_at?: string | null;
  release_message?: string | null;
  release_notes?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
}

export interface MobileAppVersionUpdateInput {
  version?: string;
  build_number?: number;
  release_at?: string | null;
  android_download_url?: string | null;
  ios_download_url?: string | null;
  force_update_at?: string | null;
  release_notification_at?: string | null;
  release_notification_sent_at?: string | null;
  force_update_notification_sent_at?: string | null;
  release_message?: string | null;
  release_notes?: string | null;
  updated_by?: number | null;
}
