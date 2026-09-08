// Config ค่า default page size ที่ใช้ร่วมกันทั้ง validation schema (เมื่อ query ไม่ส่ง limit มา) และ
// repository/service ที่ query schema ปล่อย limit เป็น undefined-by-default (ให้ผู้เรียกกำหนด fallback เอง)
export const DEFAULT_PAGE_LIMIT = 20;
