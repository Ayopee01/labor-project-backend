## 28. รายงานค่าลงสินค้าแผงค้ารายวัน (Daily Stall Fee Report) **(⚠️ Backend ยังไม่มี; Frontend ใช้ Mock Data)**

**Feature:** Work History — แถบ “รายงานค่าลงสินค้าแผงค้ารายวัน”  
**Frontend Component:** `src/features/work-history/components/DailyStallFeeReport.tsx`  
**Mock Data:** `src/features/work-history/data/mockDailyStallFees.ts`  
**Backend Path ใหม่:** `GET /api/admin/vehicle-jobs/history/daily-stall-fees`  
**Permission:** `jobs:read`  
**ขอบเขตเอกสาร:** เฉพาะรายงานรายวัน ส่วนรายงานรายเดือนอยู่ในข้อ 29

### 28.1 ผลการตรวจสอบ Frontend และ Backend ปัจจุบัน

Frontend แสดงหนึ่งแถวต่อสินค้าในตั๋ว โดยต้องใช้ข้อมูลต่อไปนี้:

1. เลขที่แผงค้า
2. วันที่รับรู้ค่าลงสินค้า
3. ทะเบียนรถ
4. เลขที่ตั๋ว
5. สินค้า
6. จำนวนที่ยืนยันแล้ว
7. บรรจุภัณฑ์
8. ค่าลงสินค้า

Backend มีข้อมูลการเงินจริงอยู่แล้วใน `TicketProductFinancial` แต่ยังไม่มี list API สำหรับรายงานนี้ หน้าเว็บจึงยังใช้ mock และเปลี่ยน `businessDate` ของ mock ให้ตรงกับช่วงวันที่ที่เลือกเพื่อให้มีข้อมูลแสดงเสมอ

ห้ามแก้ปัญหาโดยเรียก `GET /api/admin/vehicle-jobs/{ticketNumber}/financials` ทีละคัน เพราะจะเกิด N+1 requests, ทำ pagination/summary ไม่ถูกต้อง และไม่สามารถค้นหาข้ามงานได้อย่างมีประสิทธิภาพ ต้องสร้าง endpoint รายงานใหม่ตาม contract นี้

### 28.2 แหล่งข้อมูลและ Source of Truth

หนึ่งแถวในรายงานเท่ากับหนึ่ง `TicketProductFinancial` ที่ finalize แล้ว โดย join ตามสายข้อมูล:

`TicketProductFinancial -> TicketProduct -> GateTicket -> MarketJob -> VehicleJob`

กติกาการเลือกข้อมูล:

| ข้อมูลในรายงาน | Source of truth | หมายเหตุ |
|---|---|---|
| `id` | `TicketProductFinancial.id` | Stable unique key ของแถว ห้ามใช้ index ของ array |
| `business_date` | วันที่ของ `TicketProductFinancial.finalizedAt` ใน timezone `Asia/Bangkok` | ดูกติกาในข้อ 28.3 |
| `finalized_at` | `TicketProductFinancial.finalizedAt` | ส่ง ISO-8601 timestamp เพื่อ trace/audit |
| `booth_code` | `GateTicket.boothCode` | Frontend แสดงเป็น “เลขที่แผงค้า” |
| `plate` | `VehicleJob.licensePlate` | ใช้ค่าจากงานรถคันนั้น |
| `ticket_no` | `MarketJob.ticketNo` | Business Ticket ที่ผู้ใช้เห็นในหน้า Work History |
| ข้อมูลสินค้า/บรรจุภัณฑ์ | snapshot ใน `TicketProduct` | ห้ามอ่านชื่อ/ราคาใหม่จาก master ปัจจุบัน |
| `confirmed_quantity` | `TicketProductFinancial.confirmedQuantity` | จำนวนที่ถูกใช้ตอน finalize การเงิน; ใช้ชื่อเดียวกับ Financial response เดิมของ Backend |
| `stall_fee_rounded` | `TicketProductFinancial.stallFeeRounded` | ค่าลงสินค้าที่บันทึกจริง; ใช้ชื่อเดียวกับ Financial response เดิมและห้ามคำนวณใหม่จาก rate ปัจจุบัน |

ข้อกำหนดเพิ่มเติม:

1. แสดงเฉพาะรายการที่มี `TicketProductFinancial` แล้วเท่านั้น
2. งานที่ถูกยกเลิก, ยังไม่ยืนยัน, หรือการเงินอยู่ `ON_HOLD` และยังไม่มี financial record ต้องไม่สร้างแถวค่าประมาณหรือแถว `0`
3. ถ้ารายการ finalize แล้วและค่าจริงเป็น `0.00` ต้องแสดงตามจริง
4. `ticketProductId` เป็น unique ใน `TicketProductFinancial` อยู่แล้ว Backend ต้องไม่ส่งรายการซ้ำเมื่อมี retry/idempotent finalize
5. ชื่อสินค้าและบรรจุภัณฑ์ต้องเป็น snapshot ตอนสร้างตั๋ว เพื่อให้รายงานย้อนหลังไม่เปลี่ยนเมื่อแก้ master data

### 28.3 นิยาม “รายวัน” และ Timezone

รายงานนี้รับรู้รายการตามวันที่ finalize การเงินของสินค้านั้น:

`business_date = DATE(TicketProductFinancial.finalizedAt AT TIME ZONE 'Asia/Bangkok')`

เหตุผลคือค่าลงสินค้ายังไม่เป็นยอดจริงจนกว่าจะ finalize การเงิน ดังนั้นห้ามใช้วันที่รถเข้า, วันที่สร้างตั๋ว, วันที่เริ่มงาน หรือสถานะล่าสุดของรถแทน

Backend ต้องแปลงช่วงวันที่เป็น timestamp แบบ inclusive start / exclusive end:

- `date_from=2026-08-01` = `2026-08-01 00:00:00 Asia/Bangkok`
- `date_to=2026-08-31` = ก่อน `2026-09-01 00:00:00 Asia/Bangkok`

ถ้า finalize หลังเที่ยงคืน รายการต้องอยู่ในวันที่ finalize จริงตามเวลาไทย แม้งานรถจะเริ่มในวันก่อนหน้า

### 28.4 Request Contract

```http
GET /api/admin/vehicle-jobs/history/daily-stall-fees
Authorization: Bearer <access-token>
```

Query parameters:

| Parameter | Type | Required | Default | Validation / ความหมาย |
|---|---:|---:|---:|---|
| `date_from` | `YYYY-MM-DD` | ✅ | - | วันเริ่มต้นตาม `Asia/Bangkok` |
| `date_to` | `YYYY-MM-DD` | ✅ | - | วันสิ้นสุดแบบรวมวันนั้น |
| `search` | string | ❌ | - | ค้นหาเลขแผง, ทะเบียนรถ, เลขตั๋ว, รหัส/ชื่อสินค้า และรหัส/ชื่อบรรจุภัณฑ์ |
| `product_code` | string | ❌ | - | exact match โดยใช้ stable code |
| `package_code` | string | ❌ | - | exact match โดยใช้ stable code |
| `page` | integer | ❌ | `1` | ค่าต่ำสุด `1` |
| `limit` | integer | ❌ | `20` | `1-100` |

Validation:

1. ต้องส่ง `date_from` และ `date_to` มาคู่กัน
2. `date_from` ต้องไม่มากกว่า `date_to`
3. ช่วงวันที่สูงสุด 31 วันปฏิทิน เพื่อให้ตรงกับ date-range control ของหน้า Work History
4. trim query string ทุกตัว และค่าที่เป็น empty string ให้ถือว่าไม่ได้ส่ง
5. `search` ให้แบ่ง token ด้วยช่องว่างหรือ comma; ทุก token ต้อง match อย่างน้อยหนึ่ง searchable field แบบ case-insensitive (`AND` ระหว่าง token, `OR` ระหว่าง field) เพื่อให้ตรงกับพฤติกรรมค้นหาปัจจุบันของ Frontend
6. `product_code` และ `package_code` ใช้ exact match; ห้ามใช้ชื่อเป็น primary filter เพราะชื่อแก้ไขหรือซ้ำกันได้

ตัวอย่าง:

```http
GET /api/admin/vehicle-jobs/history/daily-stall-fees?date_from=2026-08-01&date_to=2026-08-31&search=กข%201234%20กะหล่ำ&product_code=VEG-CAB&page=1&limit=20
```

### 28.5 Response Contract

Backend service ส่ง canonical JSON เป็น `snake_case` ตาม convention ปัจจุบัน และ API case middleware จะแปลงเป็น `PascalCase` ให้ `web-app` โดยอัตโนมัติ

```json
{
  "data": [
    {
      "id": 9812,
      "business_date": "2026-08-31",
      "finalized_at": "2026-08-31T08:42:10.125Z",
      "booth_code": "IV4/19",
      "plate": "กข 1234",
      "plate_province": "กรุงเทพมหานคร",
      "ticket_no": "20260831000142",
      "market_code": "MKT-01",
      "market_name": "ตลาดสี่มุมเมือง",
      "product_code": "VEG-CAB",
      "product_full_code": "VEG-CAB-BAG",
      "product_name": "กะหล่ำปลี",
      "package_code": "BAG",
      "package_name": "กระสอบ",
      "confirmed_quantity": "7.00",
      "stall_fee_rounded": "28.00"
    }
  ],
  "summary": {
    "row_count": 18,
    "stall_count": 12,
    "confirmed_quantity_total": "146.50",
    "stall_fee_total": "1160.00"
  },
  "available_products": [
    {
      "product_code": "VEG-CAB",
      "product_name": "กะหล่ำปลี"
    }
  ],
  "available_packages": [
    {
      "package_code": "BAG",
      "package_name": "กระสอบ"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 18,
    "total_pages": 1
  }
}
```

Response rules:

1. `confirmed_quantity`, `stall_fee_rounded`, `confirmed_quantity_total` และ `stall_fee_total` ต้องส่งเป็น decimal string เพื่อไม่เสีย precision ระหว่าง serialize JSON
2. `business_date` ต้องเป็น `YYYY-MM-DD` ตามเวลาไทย ไม่ใช่วันที่ UTC จากการตัด string
3. `finalized_at` ต้องเป็น ISO-8601 UTC timestamp
4. `market_code`, `market_name`, `plate_province` ส่งเพื่อรองรับการตรวจสอบย้อนหลัง แม้ UI รุ่นแรกยังไม่แสดง
5. ถ้าไม่พบข้อมูลให้ตอบ `200` พร้อม `data: []`, `row_count/stall_count = 0`, ยอด decimal เป็น `"0.00"` และ pagination ที่ total เป็น `0`; ไม่ตอบ `404`
6. ลำดับ default คือ `finalized_at DESC, id DESC` เพื่อให้ pagination คงที่ หากเวลาซ้ำกัน

หมายเหตุสำหรับ Frontend หลังผ่าน case middleware:

- `data` -> `Data`
- `business_date` -> `BusinessDate`
- `booth_code` -> `BoothCode`
- `confirmed_quantity` -> `ConfirmedQuantity`
- `stall_fee_rounded` -> `StallFeeRounded`
- `summary.stall_fee_total` -> `Summary.StallFeeTotal`
- `available_products` -> `AvailableProducts`
- `pagination.total_pages` -> `Pagination.TotalPages`

### 28.6 กติกา Summary และตัวเลือก Filter

Summary ต้องเป็นยอดของข้อมูลทั้งหมดที่ผ่าน `date range + search + product_code + package_code` ก่อน pagination ไม่ใช่เฉพาะแถวในหน้าปัจจุบัน:

| Field | วิธีคำนวณ |
|---|---|
| `row_count` | จำนวน `TicketProductFinancial` ที่ผ่าน filter |
| `stall_count` | `COUNT(DISTINCT GateTicket.id)` ที่ผ่าน filter |
| `confirmed_quantity_total` | `SUM(TicketProductFinancial.confirmedQuantity)` |
| `stall_fee_total` | `SUM(TicketProductFinancial.stallFeeRounded)` |

`available_products` และ `available_packages` ใช้สำหรับสร้าง dropdown โดย Backend ต้อง:

1. คำนวณจากฐานข้อมูลที่ผ่าน `date range + search`
2. ไม่ใช้ `product_code` และ `package_code` มาจำกัด option เพื่อให้รายการ dropdown ไม่หายหลังผู้ใช้เลือก filter
3. ตัดค่าซ้ำด้วย stable code และเรียงด้วยชื่อภาษาไทย จากนั้นตามด้วย code
4. ส่งเฉพาะ option ที่มี financial row จริงในช่วงวันที่นั้น

### 28.7 งานที่ Backend ต้องเพิ่ม

#### 28.7.1 Validation

เพิ่ม schema เช่น `adminDailyStallFeeQuerySchema` สำหรับ query ในข้อ 28.4 และใช้ timezone helper กลางที่รองรับ `Asia/Bangkok` ห้าม parse `YYYY-MM-DD` ด้วย UTC โดยตรง

#### 28.7.2 Repository

เพิ่ม repository query สำหรับ:

1. ดึงแถวรายงานด้วย join เดียวและใช้ filter ที่ฐานข้อมูล
2. นับ `total` ก่อน pagination
3. คำนวณ summary จาก filtered dataset เดียวกัน
4. ดึง product/package options ตามกติกาข้อ 28.6

ต้องเลือกเฉพาะ field ที่ใช้ หลีกเลี่ยง N+1 query และไม่ load worker payments เพราะรายงานนี้ไม่ใช้รายได้แรงงาน

#### 28.7.3 Service

เพิ่ม method เช่น `adminJobsService.listDailyStallFees(req.query)` ทำหน้าที่:

1. validate และ normalize query
2. สร้าง Bangkok date range
3. เรียก repository
4. format วันและ decimal โดยไม่คำนวณ fee ใหม่
5. คืน response shape ตามข้อ 28.5

#### 28.7.4 Route

เพิ่ม route ใหม่ใน `backend/src/routes/admin-jobs.routes.ts`:

```ts
router.get(
  "/vehicle-jobs/history/daily-stall-fees",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.listDailyStallFees(req.query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);
```

Route นี้ต้องอยู่ใน admin router เดิม จึงได้รับ `authMiddleware`, `sessionMiddleware` และ admin role middleware ที่ router ใช้อยู่แล้ว

#### 28.7.5 OpenAPI และ Automated Tests

เพิ่ม path/schema ใน `backend/src/docs/openapi/admin-jobs.yaml` และอย่างน้อยต้องมี test ต่อไปนี้:

1. ไม่มี token -> `401`
2. ไม่มี `jobs:read` -> `403`
3. วันที่ไม่ครบคู่, format ผิด, วันเริ่มมากกว่าวันสิ้นสุด และช่วงเกิน 31 วัน -> `400`
4. ตรวจ boundary ก่อน/หลังเที่ยงคืนตาม `Asia/Bangkok`
5. financial ที่ finalize แล้วแสดงหนึ่งครั้ง; รายการที่ยังไม่มี financial ไม่แสดง
6. ใช้ `confirmedQuantity` และ `stallFeeRounded` ที่ persisted แม้ master rate ถูกแก้ภายหลัง
7. search แบบหลาย token และ product/package exact filter
8. summary เป็นยอดทั้ง filtered set และไม่เปลี่ยนตาม `page/limit`
9. pagination หน้าแรก/หน้าสุดท้าย ไม่มีข้อมูลซ้ำหรือขาดเมื่อ timestamp เท่ากัน
10. empty result คืน `200` พร้อม zero summary

### 28.8 Error Contract

ใช้ error envelope กลางของ Backend โดย error validation ควรมีโครงสร้างอย่างน้อย:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Invalid query data.",
  "requestId": "req-01J...",
  "validation_errors": [
    {
      "field": "date_to",
      "message": "date_from and date_to are required and must not exceed 31 days"
    }
  ]
}
```

ห้ามคืนข้อมูลบางส่วนแบบ `200` เมื่อ query ผิด และห้ามกลืน database error แล้วคืน empty result

### 28.9 งานเชื่อม Frontend หลัง Backend พร้อม

1. เพิ่ม `fetchDailyStallFees` ใน `src/features/work-history/services/workHistoryService.ts` ให้เรียก endpoint ใหม่
2. ส่ง `date_from/date_to`, `search`, `product_code`, `package_code`, `page`, `limit`
3. map `BoothCode` เป็น `stallNo`, `TicketNo` เป็น `ticketNo`, `ConfirmedQuantity` เป็น `quantity`, `StallFeeRounded` เป็น `fee` และแปลง decimal string เป็น number เฉพาะชั้นแสดงผล
4. ใช้ `Summary` จาก Backend สำหรับการ์ดสรุป และใช้ `AvailableProducts/AvailablePackages` สำหรับ dropdown
5. ใช้ server-side pagination สำหรับตาราง; ตอน Export CSV ให้ไล่ดึงทุกหน้าของ filtered result หรือเพิ่ม export endpoint แยกใน requirement รอบถัดไป
6. ลบการผูก runtime กับ `mockDailyStallFees`; mock เก็บไว้ได้เฉพาะ Storybook/test fixture
7. เมื่อ request ล้มเหลวต้องแสดง error/retry state แยกจาก empty state

### 28.10 Acceptance Criteria

ถือว่างาน Backend พร้อมให้ Frontend เชื่อมเมื่อครบทุกข้อ:

1. Endpoint ใหม่ตอบข้อมูลจริงตามช่วงวันที่และ permission ข้างต้น
2. ทุกแถว trace กลับไปยัง `TicketProductFinancial.id` ได้
3. จำนวนและค่าลงสินค้าเท่ากับ snapshot ที่ใช้ finalize จริง ไม่มีการคำนวณจาก master ปัจจุบัน
4. วันที่และ boundary ถูกต้องตาม `Asia/Bangkok`
5. Search, product/package filter, summary และ pagination ใช้ filtered dataset เดียวกัน
6. Summary ครบทั้งผลลัพธ์ ไม่ขึ้นกับหน้าปัจจุบัน
7. OpenAPI, validation, permission test, timezone test และ financial source-of-truth test ผ่าน
8. Frontend สามารถถอด mock แล้วแสดงตาราง การ์ดสรุป dropdown และ CSV ด้วยข้อมูลจาก endpoint นี้ได้โดยไม่เรียก financial API รายคัน

---

## 29. รายงานค่าลงสินค้าแผงค้ารายเดือน (Monthly Stall Fee Report) **(⚠️ Backend ยังไม่มี; Frontend ปรับ UX แล้วแต่ยังใช้ Mock Data)**

**Feature:** Work History — แถบ “รายงานค่าลงสินค้าแผงค้ารายเดือน”  
**Frontend Component:** `src/features/work-history/components/MonthlyStallFeeReport.tsx`  
**Mock Data:** `src/features/work-history/data/mockMonthlyStallFees.ts`  
**Backend Path ใหม่:** `GET /api/admin/vehicle-jobs/history/monthly-stall-fees`  
**Permission:** `jobs:read`

### 29.1 ผลการตรวจสอบหน้า Frontend ปัจจุบัน

หน้าเว็บปัจจุบันสร้างรายงานจาก mock และแสดงหนึ่งแถวต่อกลุ่ม:

`รอบเดือน + ตลาด + แผงค้า + สีเสื้อ`

คอลัมน์ที่แสดงมี:

1. วันที่ลงบัญชี
2. เลขที่แผงค้า
3. รายละเอียด เช่น “ค่าลงสินค้าเสื้อน้ำเงิน เดือน ส.ค.”
4. วันครบกำหนดชำระ
5. ยอดเรียกเก็บ

การ์ดสรุปประกอบด้วยจำนวนแถว, จำนวนแผง, รอบรายงาน และยอดเรียกเก็บรวม ส่วนตัวกรองรายการมีตลาด, เลขแผงค้า และสีเสื้อ โดยรายการแผงจะจำกัดตามตลาดที่เลือก

พฤติกรรม mock ปัจจุบัน:

1. ใช้วันที่ท้ายของ date range ด้านบนเป็นเดือนรายงาน
2. เปลี่ยน mock ทุกแถวให้เป็นรอบเดือนที่เลือก
3. กำหนด `postingDate` เป็นวันที่ 1 ของเดือนถัดไป
4. กำหนด `dueDate` เป็นวันที่ 25 ของเดือนถัดไป
5. ยอด `debitAmount` เป็นตัวเลข mock ไม่ได้ aggregate จาก `TicketProductFinancial`
6. สีเสื้อใน mock ไม่ได้เชื่อมกับ worker snapshot หรือข้อมูลการเงินจริง

ดังนั้น Frontend ยังไม่สามารถถอด mock ด้วย API รายวันเพียงอย่างเดียว เพราะรายเดือนต้อง aggregate ที่ Backend และต้องมีกติกา snapshot สีเสื้อที่ไม่ทำให้รายงานย้อนหลังเปลี่ยนตาม Master Worker ปัจจุบัน

Frontend ปรับพฤติกรรมเวลาเป็น **เลือกเพียงหนึ่ง `report_month`** แล้ว โดย:

1. เปลี่ยนวันที่เริ่มต้น/สิ้นสุดเป็น month picker หนึ่งค่าเมื่ออยู่แท็บรายเดือน
2. แสดงวันที่ลงบัญชีและวันครบกำหนดจาก `BillingCycle` แบบ read-only
3. ไม่นำวันที่ลงบัญชีและวันครบกำหนดมาเป็นตัวกรองของรายงานเดือนเดียว

### 29.2 ขอบเขตของ API รอบแรก: BillingCycle-backed Monthly Report

Endpoint นี้เป็น **รายงานสรุปจาก financial records ที่ finalize แล้วและผูกกับ `BillingCycle` หนึ่งรอบต่อหนึ่งเดือน** ไม่ใช่ระบบ Invoice/Accounts Receivable และไม่ได้ยืนยันว่ามีการลงบัญชีหรือสร้างหนี้ในระบบบัญชีภายนอกแล้ว

Backend ต้องเพิ่ม `BillingPolicy` และ `BillingCycle` ตามข้อ 29.4 โดยมีหลักการ:

1. หนึ่ง `report_month` มี `BillingCycle` ได้หนึ่งรายการเท่านั้น
2. `posting_date` และ `due_date` เป็น snapshot ของ policy ตอนสร้างรอบ ไม่คำนวณใหม่ทุกครั้งที่อ่านรายงาน
3. การเปลี่ยน `BillingPolicy` มีผลเฉพาะ `BillingCycle` ที่ยังไม่ถูกสร้างตาม `effective_from_month` และห้ามเปลี่ยนรอบย้อนหลังแบบเงียบ ๆ
4. วันที่ใน `BillingCycle` เป็นวันที่ตามรอบเรียกเก็บภายในระบบนี้ แต่ยังไม่ใช่หลักฐานว่าเกิด posting transaction ในระบบบัญชีภายนอกแล้ว
5. ห้ามแสดงสถานะ “ลงบัญชีแล้ว”, “ชำระแล้ว” หรือ “ค้างชำระ” จนกว่าจะมี posting/payment ledger จริง
6. API รายงานรับ `report_month` เพียงเดือนเดียว ห้ามรับ arbitrary date range หรือค้นหาหลายเดือนใน endpoint นี้
7. ถ้าภายหลังต้องการหลายรอบต่อเดือน, manual override รายรอบ, เลข invoice, วันหยุด, payment status หรือค้นหาข้ามเดือน ให้แยก requirement และ API ใหม่ ห้ามขยายความหมายของ endpoint นี้โดยไม่แก้ contract

### 29.3 แหล่งข้อมูลและกติกาการรวมยอด

ฐานข้อมูลรายการเงินใช้ชุดเดียวกับรายงานรายวัน:

`TicketProductFinancial -> TicketProduct -> GateTicket -> MarketJob -> VehicleJob`

และ resolve รอบรายงานด้วย:

`BillingCycle.reportMonth -> periodStart/periodEnd/postingDate/dueDate/policyVersion`

กติกา:

1. เลือกเฉพาะ `TicketProductFinancial` ที่ `finalizedAt` อยู่ในเดือนรายงานตาม `Asia/Bangkok`
2. ยอดของแต่ละแถวต้องเป็น `SUM(TicketProductFinancial.stallFeeRounded)` ห้าม sum `stallFeeRaw` แล้วค่อยปัด และห้ามคำนวณใหม่จาก master rate
3. Group ด้วย `MarketJob.marketCode + GateTicket.boothCode + shirt_color`
4. `boothCode` ไม่ unique ข้ามตลาด จึงห้าม group ด้วยเลขแผงเพียงค่าเดียว
5. หนึ่งแผงที่มีหลาย Business Ticket หรือหลายสินค้าในเดือนเดียวกันต้องรวมเป็นแถวเดียว เมื่อ market และสีเสื้อเดียวกัน
6. ถ้าแผงเดียวกันมีคนละสีเสื้อในเดือนเดียวกัน ให้แยกคนละแถว เพื่อให้ตัวกรองและคำอธิบายตรงกับข้อมูล
7. ยอดรวมรายเดือนก่อนกรองสีเสื้อ/แผงต้อง reconcile กับ `SUM(fee)` ของ Daily Stall Fee API ในข้อ 28 สำหรับทุกวันของเดือนเดียวกัน

ตัวระบุแถวต้องเป็น deterministic composite key เช่น:

`2026-08|MKT-01|GV5/6|NAVY`

ห้ามใช้ลำดับ array หรือ hash ที่เปลี่ยนทุก request

### 29.4 BillingPolicy, BillingCycle และกติกาวันที่

Request รายงานใช้ `report_month` รูปแบบ `YYYY-MM` เพียงค่าเดียว ไม่ใช้ arbitrary `date_from/date_to` เพราะผลลัพธ์มีความหมายหนึ่งรอบเดือนเต็มเสมอ

#### 29.4.1 BillingPolicy

Backend ต้องมี versioned policy สำหรับกำหนดค่าเริ่มต้นของรอบเดือนอย่างน้อย:

| Field | Default | กติกา |
|---|---:|---|
| `posting_day` | `1` | วันที่ลงบัญชีของเดือนถัดจาก `report_month` |
| `due_day` | `25` | วันครบกำหนดของเดือนถัดจาก `report_month` |
| `timezone` | `Asia/Bangkok` | คงที่ในรอบแรก ห้ามรับ timezone จาก client |
| `effective_from_month` | - | เดือนแรกที่ policy version นี้ใช้สร้างรอบใหม่ |
| `version` | - | เพิ่มทุกครั้งที่แก้ policy |

กติกา validation และผลกระทบ:

1. `posting_day` และ `due_day` รับจำนวนเต็ม `1-31`
2. ถ้าเดือนไม่มีวันที่ที่กำหนด ให้ clamp เป็นวันสุดท้ายของเดือน เช่น day `31` ในเดือนกุมภาพันธ์เป็นวันสุดท้ายของกุมภาพันธ์
3. วันที่จริงที่คำนวณได้ต้องมี `due_date >= posting_date`; ถ้าไม่ผ่านให้ตอบ `400 VALIDATION_ERROR`
4. รอบแรกยังไม่เลื่อนวันเมื่อชนวันหยุดหรือวันหยุดธนาคาร
5. การแก้ policy ต้องสร้าง version ใหม่ ห้าม update ทับ version เดิม
6. `effective_from_month` ต้องไม่ครอบคลุม `BillingCycle` ที่สร้างแล้ว การแก้ config ห้ามเปลี่ยนวันที่ของรอบเดิมย้อนหลัง
7. ค่าเริ่มต้นของระบบคือ `posting_day=1` และ `due_day=25`

สิทธิ์การอ่านและแก้ไข:

1. ใช้ permission ใหม่ `billing_policy:read` และ `billing_policy:update`
2. `OWNER` มี `billing_policy:update` โดยอัตโนมัติและเป็นผู้ให้/ถอน delegation นี้แก่ `MANAGER`
3. `MANAGER` แก้ policy ได้เฉพาะเมื่อมี delegation `billing_policy:update` ที่ยัง active จาก `OWNER`
4. `SUPERVISOR` ไม่มีสิทธิ์แก้และห้ามรับ delegation `billing_policy:update`; explicit deny นี้ต้องชนะ permission ที่ส่งมาจาก client หรือข้อมูล role ที่ผิดพลาด
5. การให้สิทธิ์, ถอนสิทธิ์ และเปลี่ยน policy ต้องบันทึก audit ที่มี actor, before, after, effective month, เวลา และ reason
6. Backend ต้องตรวจ role/permission จาก authenticated session ห้ามเชื่อ role หรือ permission ใน request body

#### 29.4.2 BillingCycle

Backend ต้องเก็บหนึ่ง snapshot ต่อหนึ่งเดือน โดยมี unique constraint ที่ `reportMonth` และอย่างน้อยประกอบด้วย:

```prisma
model BillingCycle {
  id            String   @id @default(uuid())
  reportMonth   String   @unique @map("report_month") @db.VarChar(7)
  periodStart   DateTime @map("period_start") @db.Date
  periodEnd     DateTime @map("period_end") @db.Date
  postingDate   DateTime @map("posting_date") @db.Date
  dueDate       DateTime @map("due_date") @db.Date
  policyVersion Int      @map("policy_version")
  createdAt     DateTime @default(now()) @map("created_at")

  @@map("billing_cycles")
}
```

ชื่อ model/ชนิดข้อมูลปรับให้ตรง convention ของ Backend ได้ แต่ invariant ต้องคงเดิม:

1. หนึ่ง `report_month` มีหนึ่ง cycle เท่านั้น
2. Cycle snapshot `postingDate`, `dueDate` และ `policyVersion` ตอนสร้าง และไม่เปลี่ยนเมื่อแก้ policy ในอนาคต
3. Backend ต้องมี idempotent `ensureBillingCycle(reportMonth)` ใน write-side flow และเรียกก่อน commit financial record แรกของเดือนนั้น เพื่อรับประกันว่าเดือนที่มี `TicketProductFinancial` ต้องมี cycle เสมอ
4. Scheduler อาจ pre-create รอบปัจจุบัน/รอบถัดไปได้ แต่ unique constraint และ transaction ต้องป้องกันรอบซ้ำ
5. Migration ต้อง backfill cycle สำหรับทุกเดือนที่มี `TicketProductFinancial.finalizedAt` อยู่แล้ว โดยใช้ default `1/25`, `Asia/Bangkok` และ policy version สำหรับ migration ที่ระบุชัด
6. รอบแรกยังไม่มีการแก้วันเป็นราย cycle; วันที่มาจาก policy snapshot เท่านั้น หากต้องการ override รายรอบให้เพิ่ม mutation, lifecycle และ audit ใน requirement แยก

#### 29.4.3 ตัวอย่างรอบและขอบเขตเวลา

สำหรับ `report_month=2026-08` และ policy default:

| Field | ค่า | กติกา |
|---|---|---|
| `period_start` | `2026-08-01` | วันแรกของเดือนตาม `Asia/Bangkok` |
| `period_end` | `2026-08-31` | วันสุดท้ายของเดือนตาม `Asia/Bangkok` |
| `posting_date` | `2026-09-01` | snapshot จาก `posting_day=1` |
| `due_date` | `2026-09-25` | snapshot จาก `due_day=25` |

การเลือก financial record ใช้ timestamp range แบบ inclusive start / exclusive end:

`[2026-08-01 00:00 Asia/Bangkok, 2026-09-01 00:00 Asia/Bangkok)`

API ต้องอ่าน `posting_date` และ `due_date` จาก `BillingCycle` ของ `report_month` ห้ามคำนวณใหม่จาก policy ปัจจุบันตอนอ่านรายงาน

### 29.5 ช่องว่างสำคัญ: Historical Shirt Color Snapshot

Backend ปัจจุบันมี `MasterWorker.laborColor` แต่ค่านี้เป็น master data ที่เปลี่ยนได้ และ `TicketWorkerPayment`/`GateTicketWorkerSnapshot` ยังไม่ได้เก็บสีเสื้อ ณ เวลาที่ finalize การเงิน จึงห้ามใช้สีปัจจุบันจาก `MasterWorker` เพื่ออ้างว่าเป็นสีในอดีตโดยไม่ระบุแหล่งที่มา

Backend ต้องเพิ่ม nullable snapshot field ใน `TicketWorkerPayment`:

```prisma
shirtColorSnapshot String? @map("shirt_color_snapshot") @db.VarChar(50)
```

เมื่อสร้าง `TicketWorkerPayment` ใหม่ ให้ normalize `MasterWorker.laborColor` แล้วบันทึก canonical color ลง snapshot ใน financialization transaction เดียวกัน และห้ามแก้ snapshot นี้เมื่อ master worker เปลี่ยนภายหลัง

การจัดประเภทสีของหนึ่ง `TicketProductFinancial`:

1. ถ้า payment snapshots ทุกคนมี canonical color เดียวกัน ให้ใช้สีนั้น
2. ถ้ามีมากกว่าหนึ่งสี ให้ใช้ `MIXED` และนับค่าลงสินค้าก้อนนั้นเพียงครั้งเดียว ห้าม duplicate เต็มยอดให้ทุกสี
3. ถ้าไม่มี payment หรือ snapshot ทุกค่าเป็น null ให้ใช้ `UNKNOWN`
4. ค่า null บางคนร่วมกับสีเดียวที่ทราบ ให้ใช้ `UNKNOWN` เพื่อไม่อ้างว่าทั้งทีมเป็นสีนั้น
5. ข้อมูลเก่าก่อน migration ให้เป็น `UNKNOWN`; ห้าม backfill ด้วยสีปัจจุบันแบบเงียบ ๆ เพราะทำให้รายงานย้อนหลังดูแม่นยำเกินข้อมูลจริง

Canonical API enum:

- `NAVY`
- `BLUE`
- `GREEN`
- `MIXED`
- `UNKNOWN`

กติกา normalize ค่าสีจาก Backend ปัจจุบันก่อนเขียน `shirtColorSnapshot`:

| ค่า `MasterWorker.laborColor` ที่อ่านได้ | ค่า snapshot |
|---|---|
| `Navy` หรือ `NAVY` (case-insensitive หลัง trim) | `NAVY` |
| `Blue` หรือ `BLUE` (case-insensitive หลัง trim) | `BLUE` |
| `Green` หรือ `GREEN` (case-insensitive หลัง trim) | `GREEN` |
| `null`, empty string หรือค่าที่ไม่รองรับ | `null` |

`MIXED` และ `UNKNOWN` เป็นค่าที่ derive ตอนสร้างรายงานระดับ `TicketProductFinancial` เท่านั้น ห้ามบันทึกสองค่านี้เป็นสีของ worker แต่ละคน หากพบค่าสีที่ไม่รองรับให้เก็บ snapshot เป็น `null` และบันทึก warning/monitoring เพื่อให้ตรวจแก้ master data ได้

ค่า “เสื้อแดง” ที่อยู่ใน `mockMonthlyStallFees.ts` เป็นข้อมูลตัวอย่างเท่านั้น ขณะที่ Backend ปัจจุบันกำหนด `WORKER_SHIRT_TYPES` เป็น `Navy`, `Blue`, `Green` และไม่มี `Red` จึงห้ามเพิ่ม `RED` ใน API จาก mock โดยไม่มีการเปลี่ยน business master/validation อย่างเป็นทางการ

Frontend เป็นผู้ map enum เป็นข้อความภาษาไทย เช่น `NAVY -> เสื้อน้ำเงิน` ตามคำศัพท์ที่ Product Owner อนุมัติ Backend ไม่ควรเก็บคำแปลไทยลง snapshot

> หมายเหตุ: ถ้า Product Owner ยืนยันว่ารายงานนี้ไม่ควรแยกตามสีเสื้อ ให้ถอด `shirt_color` ออกจาก grouping/filter/UI แทนการเดาความหมายจาก worker master แต่ contract ปัจจุบันคงสีเสื้อไว้เพื่อรองรับ UX/UI ที่ได้รับมา

### 29.6 Request Contract

```http
GET /api/admin/vehicle-jobs/history/monthly-stall-fees
Authorization: Bearer <access-token>
```

Query parameters:

| Parameter | Type | Required | Default | Validation / ความหมาย |
|---|---:|---:|---:|---|
| `report_month` | `YYYY-MM` | ✅ | - | เดือนรายงานตาม `Asia/Bangkok` |
| `market_code` | string | ❌ | - | exact match ตลาด; แนะนำให้ใช้ร่วมกับแผงเพราะเลขแผงอาจซ้ำข้ามตลาด |
| `booth_search` | string | ❌ | - | partial case-insensitive search ที่ `boothCode`/`boothName` |
| `shirt_color` | enum | ❌ | - | `NAVY`, `BLUE`, `GREEN`, `MIXED`, `UNKNOWN` |
| `page` | integer | ❌ | `1` | ค่าต่ำสุด `1` |
| `limit` | integer | ❌ | `10` | `1-100` |

Validation rules:

1. `report_month` ต้องเป็นเดือนปฏิทินที่ถูกต้อง เช่น `2026-02`; ไม่รับ `2026-13`
2. trim string ทุกตัว และ empty string ให้ถือว่าไม่ได้ส่ง
3. ไม่รับ `date_from`, `date_to`, `posting_date` หรือ `due_date`; ถ้าส่ง field เหล่านี้ให้ตอบ `400 VALIDATION_ERROR` เพื่อป้องกัน contract กำกวม
4. ไม่รับชื่อสีภาษาไทยเป็น query value เพื่อไม่ผูก API กับภาษา UI
5. จำกัดความยาว `market_code`/`booth_search` ตาม validation string กลางและ escape wildcard ตาม ORM/SQL ที่ใช้

ตัวอย่าง:

```http
GET /api/admin/vehicle-jobs/history/monthly-stall-fees?report_month=2026-08&market_code=MKT-01&booth_search=GV5&shirt_color=NAVY&page=1&limit=10
```

### 29.7 Response Contract

Backend service ส่ง canonical JSON เป็น `snake_case`; API case middleware แปลงเป็น `PascalCase` ให้ `web-app` ตาม convention ปัจจุบัน

```json
{
  "data": [
    {
      "id": "2026-08|MKT-01|GV5/6|NAVY",
      "report_month": "2026-08",
      "period_start": "2026-08-01",
      "period_end": "2026-08-31",
      "posting_date": "2026-09-01",
      "due_date": "2026-09-25",
      "market_code": "MKT-01",
      "market_name": "ตลาดสี่มุมเมือง",
      "booth_code": "GV5/6",
      "booth_name": "ร้านตัวอย่าง",
      "shirt_color": "NAVY",
      "financial_item_count": 14,
      "debit_amount": "228.00"
    }
  ],
  "period": {
    "billing_cycle_id": "bc-2026-08",
    "report_month": "2026-08",
    "period_start": "2026-08-01",
    "period_end": "2026-08-31",
    "posting_date": "2026-09-01",
    "due_date": "2026-09-25",
    "policy_version": 1,
    "date_policy": "BILLING_POLICY_SNAPSHOT",
    "report_mode": "BILLING_CYCLE"
  },
  "summary": {
    "row_count": 18,
    "stall_count": 17,
    "financial_item_count": 164,
    "debit_amount_total": "19119.00"
  },
  "available_markets": [
    {
      "market_code": "MKT-01",
      "market_name": "ตลาดสี่มุมเมือง"
    }
  ],
  "available_stalls": [
    {
      "market_code": "MKT-01",
      "market_name": "ตลาดสี่มุมเมือง",
      "booth_code": "GV5/6",
      "booth_name": "ร้านตัวอย่าง"
    }
  ],
  "available_shirt_colors": ["NAVY", "BLUE", "GREEN", "MIXED", "UNKNOWN"],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 18,
    "total_pages": 2
  }
}
```

Response rules:

1. `debit_amount` และ `debit_amount_total` ต้องเป็น decimal string
2. `financial_item_count` คือจำนวน `TicketProductFinancial` ที่ถูกรวมในแถว/ผลสรุป ใช้ตรวจสอบ reconciliation
3. วันที่ทุก field ส่งเป็น Gregorian ISO date; Frontend แปลงเป็น พ.ศ. เพื่อแสดงผลเอง
4. ห้ามส่ง `description` ภาษาไทยจาก Backend ให้ Frontend สร้างจาก `shirt_color + report_month` เพื่อรองรับ localization
5. `period` ต้องมาจาก `BillingCycle` และส่งแม้ `data` ว่าง เพื่อให้ UI แสดงรอบรายงาน, posting date และ due date แบบ read-only ได้
6. เมื่อพบ `BillingCycle` แต่ไม่มีรายการหรือ filter แล้วว่าง ให้ตอบ `200`, `data: []`, summary เป็นศูนย์ และ pagination total เป็น `0`
7. เรียง default ด้วย `market_code ASC, booth_code ASC, shirt_color ASC` และใช้ composite `id` เป็น tie-breaker เพื่อให้ pagination คงที่
8. เดือนที่มี financial record แต่ไม่มี `BillingCycle` ถือเป็น data-integrity error ห้าม fallback ไปคำนวณวันที่จาก policy ปัจจุบันแบบเงียบ ๆ
9. ถ้าไม่พบทั้ง `BillingCycle` และ financial record ของ `report_month` ให้ตอบ `404 BILLING_CYCLE_NOT_FOUND`; GET report ห้ามสร้าง cycle เป็น side effect

หลังผ่าน case middleware Frontend จะอ่านเป็น `Data`, `Period`, `Summary`, `AvailableMarkets`, `AvailableStalls`, `AvailableShirtColors` และ `Pagination`

### 29.8 กติกา Summary, Filter Options และ Pagination

Summary ต้องคำนวณจาก grouped rows ที่ผ่าน `report_month + market_code + booth_search + shirt_color` ก่อน pagination:

| Field | วิธีคำนวณ |
|---|---|
| `row_count` | จำนวนกลุ่ม `market + booth + shirt_color` ที่ผ่าน filter |
| `stall_count` | จำนวน distinct `market_code + booth_code` ที่ผ่าน filter |
| `financial_item_count` | จำนวน financial product rows ต้นทางทั้งหมดที่ผ่าน filter |
| `debit_amount_total` | ผลรวม `stallFeeRounded` ของ financial product rows ต้นทาง |

ตัวเลือก filter:

1. `available_markets`, `available_stalls` และ `available_shirt_colors` คำนวณจาก `report_month` เท่านั้น
2. ไม่ใช้ market/booth/shirt filter มาจำกัด options เพื่อไม่ให้ dropdown หายหลังเลือกค่า
3. `available_stalls` ต้องแยกตลาดด้วย แม้หน้า UI จะแสดงเลขแผงเป็น label หลัก
4. ส่งเฉพาะสีที่พบจริงในเดือนนั้น; `MIXED`/`UNKNOWN` ส่งเมื่อมีข้อมูลประเภทนั้นจริง
5. Summary และ `pagination.total` ต้องไม่ขึ้นกับ `page/limit`
6. `posting_date` และ `due_date` เป็นข้อมูลระดับ cycle จึงไม่ใช้กรอง grouped rows ของรายงานเดือนเดียว

### 29.9 งานที่ Backend ต้องเพิ่ม

#### 29.9.1 Database Migration และ Financial Snapshot

1. เพิ่ม versioned `BillingPolicy` สำหรับ `postingDay`, `dueDay`, `effectiveFromMonth`, timezone, actor และ audit metadata โดย seed version แรกเป็น `1/25`
2. เพิ่ม `BillingCycle` พร้อม unique `reportMonth` และ snapshot `periodStart`, `periodEnd`, `postingDate`, `dueDate`, `policyVersion`
3. Backfill `BillingCycle` สำหรับทุกเดือนประวัติศาสตร์ที่มี financial record ตามกติกาข้อ 29.4.2
4. เพิ่ม `TicketWorkerPayment.shirtColorSnapshot` แบบ nullable เพื่อไม่ทำ migration ข้อมูลสีเดิมแบบเดา
5. แก้ financialization transaction ให้บันทึก canonical color ทุกครั้งที่สร้าง worker payment และ ensure cycle ของเดือน `finalizedAt` แบบ idempotent
6. เพิ่ม permission `billing_policy:read`/`billing_policy:update` ใน permission config, role template, session payload และ owner delegation guard โดย `SUPERVISOR` ต้องรับ `update` ไม่ได้
7. เพิ่ม test ยืนยันว่าแก้ `MasterWorker.laborColor` หรือ `BillingPolicy` หลัง finalize/สร้าง cycle แล้ว monthly report เดิมไม่เปลี่ยน
8. ประเมิน index สำหรับ `TicketProductFinancial.finalizedAt`, `BillingCycle.reportMonth` และ join indexes ที่ใช้ aggregate; เพิ่มเฉพาะเมื่อ query plan แสดงว่าจำเป็น

#### 29.9.2 Validation

1. เพิ่ม schema เช่น `adminMonthlyStallFeeQuerySchema` สำหรับ contract ข้อ 29.6 พร้อม normalize `shirt_color` เป็น canonical enum และ reject date filter ที่ถูกถอดจาก contract
2. เพิ่ม schema สำหรับอ่าน/แก้ `BillingPolicy`; request แก้ไขรับ `posting_day`, `due_day`, `effective_from_month` และ `reason`
3. ตรวจ day `1-31`, clamp rule, due date chronology, future effective month, policy version conflict และ role/delegation ฝั่ง Backend

#### 29.9.3 Repository

เพิ่ม aggregate query ที่:

1. ใช้ Bangkok month timestamp range ที่ฐานข้อมูล
2. resolve `BillingCycle` ด้วย `report_month` และใช้วันที่ snapshot จาก cycle เท่านั้น
3. เลือก financial records และจำแนกสีโดยไม่ duplicate `stallFeeRounded`
4. group ตาม market + booth + color
5. คำนวณ filtered summary, total groups และ options รวม `available_markets`
6. ทำ pagination หลัง aggregation

ห้ามดึง Daily API ทุกวันมารวมใน Node.js และห้าม load financial records ทั้งเดือนขึ้น memory แล้วค่อย group หากฐานข้อมูลสามารถ aggregate ได้

#### 29.9.4 Service และ Route

เพิ่ม method เช่น `adminJobsService.listMonthlyStallFees(req.query)` และ route รายงาน:

```ts
router.get(
  "/vehicle-jobs/history/monthly-stall-fees",
  permissionMiddleware(["jobs:read"]),
  async (req, res, next) => {
    try {
      const result = await adminJobsService.listMonthlyStallFees(req.query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);
```

Route อยู่ใน admin router เดิมและได้รับ auth/session/admin role middleware กลางเหมือน Daily Stall Fee API

เพิ่ม Backend API สำหรับ policy โดยยังไม่ต้องเชื่อม Frontend ในรอบนี้:

```http
GET   /api/admin/settings/billing-policy
PATCH /api/admin/settings/billing-policy
```

Permission contract:

- `GET /api/admin/settings/billing-policy` → `billing_policy:read`
- `PATCH /api/admin/settings/billing-policy` → `billing_policy:update` และ role/delegation guard ตามข้อ 29.4.1

ตัวอย่าง request แก้ policy:

```json
{
  "posting_day": 1,
  "due_day": 25,
  "effective_from_month": "2026-10",
  "reason": "กำหนดรอบเรียกเก็บมาตรฐาน"
}
```

ใช้ flow จัดการ permission ของบัญชี Admin ที่มีอยู่แล้วในการ grant/revoke `billing_policy:update` โดยเพิ่ม owner-only guard ที่อนุญาต target เฉพาะ `MANAGER`; ห้าม `OWNER` grant permission นี้ให้ `SUPERVISOR` และห้าม `MANAGER` ส่งต่อสิทธิ์

#### 29.9.5 OpenAPI และ Automated Tests

เพิ่ม path/schema ใน `backend/src/docs/openapi/admin-jobs.yaml` พร้อม tests อย่างน้อย:

1. ไม่มี token -> `401`; ไม่มี `jobs:read` -> `403`
2. `report_month` หายหรือ format/เดือนผิด -> `400 VALIDATION_ERROR`
3. `date_from`, `date_to`, `posting_date`, `due_date` ถูก reject และ API รับหนึ่งเดือนต่อ request
4. timezone boundary ของวันแรกและวันแรกเดือนถัดไปตาม `Asia/Bangkok`
5. หลาย product/หลาย ticket ของ market+booth+color เดียวกันถูกรวมเป็นแถวเดียว
6. booth code เดียวกันคนละตลาดไม่ถูกรวมกัน
7. สีเดียว, หลายสี, snapshot บางส่วนหาย และ snapshot หายทั้งหมด ได้ `NAVY/BLUE/GREEN`, `MIXED`, `UNKNOWN` ตามกติกาโดยไม่ duplicate ยอด
8. แก้สีใน Master Worker หลัง finalize แล้วผลย้อนหลังไม่เปลี่ยน
9. `SUM(monthly.debit_amount)` reconcile กับ Daily Stall Fee API ของเดือนเดียวกัน
10. policy default `1/25`, custom day, last-day clamp และ leap-year month ถูกต้อง
11. เปลี่ยน policy แล้ว cycle ที่สร้างแล้วไม่เปลี่ยน แต่ cycle ใหม่ตาม effective month ใช้ version ใหม่
12. `OWNER` แก้และ grant/revoke ให้ `MANAGER` ได้; `MANAGER` ที่ไม่ได้รับสิทธิ์แก้ไม่ได้; `MANAGER` ที่ได้รับสิทธิ์แก้ได้; `SUPERVISOR` แก้หรือรับ delegation ไม่ได้
13. policy/delegation mutation บันทึก audit และ revoke/refresh session ตาม permission flow กลาง
14. filter, summary, options และ pagination ถูกต้องและ stable
15. cycle ที่มีอยู่แต่ filtered result ว่างคืน `200` พร้อม period metadata และ zero summary
16. ไม่พบ cycle/ข้อมูลคืน `404 BILLING_CYCLE_NOT_FOUND`; data-integrity error ไม่ถูกกลืนเป็น empty report

### 29.10 Error Contract

ใช้ error envelope กลางเหมือนข้อ 28:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Invalid query data.",
  "requestId": "req-01J...",
  "validation_errors": [
    {
      "field": "report_month",
      "message": "report_month must use YYYY-MM format"
    }
  ]
}
```

ห้ามคืนข้อมูลบางส่วนแบบ `200` เมื่อ query ผิด และห้ามเปลี่ยน database error เป็น empty report

เมื่อไม่พบรอบที่ร้องขอและเดือนนั้นไม่มี financial record ให้ตอบ:

```json
{
  "statusCode": 404,
  "code": "BILLING_CYCLE_NOT_FOUND",
  "message": "Billing cycle was not found for report_month.",
  "requestId": "req-01J..."
}
```

ถ้าพบ financial record แต่ไม่พบ cycle ให้ตอบ data-integrity error และแจ้ง monitoring/alert เพราะขัด invariant ของระบบ ห้ามสร้างวันที่ชั่วคราวจาก policy ปัจจุบันใน read API

### 29.11 งานเชื่อม Frontend **(⚠️ UX ปรับแล้ว; รอ Backend API เพื่อถอด Mock)**

1. **รอ Backend:** เพิ่ม `fetchMonthlyStallFees` ใน `src/features/work-history/services/workHistoryService.ts`
2. **ทำแล้ว:** เมื่อเข้าแท็บรายเดือน ให้ซ่อน/แทนที่ global start-end date range ด้วย month picker หนึ่งค่า และเตรียมส่ง `report_month` เพียงค่าเดียว
3. **ทำบางส่วน:** `MonthlyStallFeeRow` รองรับตลาดแล้ว; เมื่อเชื่อม API ต้องเพิ่ม canonical `ShirtColor`, `FinancialItemCount` และ decimal string ตาม response จริง
4. Frontend สร้าง `description` จาก `ShirtColor + ReportMonth` และ map สีเป็นคำไทย ห้ามใช้ข้อความ mock เป็น source
5. **UX ทำแล้ว / รอข้อมูลจริง:** แสดง `period_start`, `period_end`, `posting_date` และ `due_date` แบบ read-only; เมื่อเชื่อม API ให้ใช้ค่าจาก `Period`/`BillingCycle` และแสดง policy version ตามความเหมาะสม
6. **รอ Backend:** ใช้ server-side pagination; Export CSV ให้ไล่ดึงทุกหน้าของ filtered result หรือแยก export endpoint ใน requirement รอบถัดไป
7. **รอ Backend:** ลบ badge “ข้อมูลตัวอย่าง” และการผูก runtime กับ `mockMonthlyStallFees`; mock เก็บไว้เฉพาะ test fixture
8. แสดง `MIXED` และ `UNKNOWN` อย่างชัดเจน เช่น “หลายสี” และ “ไม่พบ snapshot สีเสื้อ” ห้ามซ่อนแถวเหล่านี้ เพราะจะทำให้ยอดรวมไม่ครบ
9. แยก loading, error/retry และ empty states
10. **ทำแล้ว:** ตัวกรองรายการคงเฉพาะตลาด, แผงค้า และสีเสื้อ; ถอด `posting_date`/`due_date` filter ออกจาก UI
11. **ทำแล้วในแท็บรายเดือน:** แสดงวันที่ด้วย locale ไทย/พ.ศ. และ month picker แสดงชื่อเดือนแทน date range
12. วันที่ลงบัญชี/ครบกำหนดใน UI ต้องสื่อว่าเป็น “ตามรอบเรียกเก็บ” และไม่ใช้ข้อความ “ลงบัญชีแล้ว/ค้างชำระ” จนกว่าจะมี ledger จริง
13. หน้าแก้ `BillingPolicy` สำหรับ Owner/Manager ที่ได้รับ delegation เป็นงาน Frontend แยกจากหน้ารายงาน และยังไม่อยู่ในขอบเขตการแก้รอบนี้

### 29.12 Acceptance Criteria

ถือว่างานพร้อมเชื่อมเมื่อครบทุกข้อ:

1. Endpoint ใหม่คืนหนึ่งแถวต่อเดือน+ตลาด+แผง+สี ตามข้อมูล financial จริง
2. ยอดทุกแถวเกิดจากผลรวม persisted `stallFeeRounded` และตรวจย้อนกลับด้วย `financial_item_count` ได้
3. ยอดรวมรายเดือน reconcile กับรายงานรายวันสำหรับเดือนเดียวกัน
4. สีเสื้อของข้อมูลใหม่เป็น immutable snapshot; ข้อมูลเก่าที่พิสูจน์สีไม่ได้เป็น `UNKNOWN`
5. รายการ mixed color ไม่ทำให้ยอดค่าลงสินค้าถูกนับซ้ำ
6. รอบเดือนและ timezone boundary ถูกต้อง รวมเดือนกุมภาพันธ์ปีอธิกสุรทิน
7. มีหนึ่ง `BillingCycle` ต่อหนึ่ง `report_month`; response อ่าน posting/due จาก cycle snapshot และระบุ `report_mode=BILLING_CYCLE`
8. `BillingPolicy` default `1/25` เป็น versioned config และมีผลเฉพาะ cycle ใหม่ตาม effective month
9. สิทธิ์แก้ policy เป็น Owner โดยอัตโนมัติ, Manager เฉพาะที่ Owner delegate และ Supervisor ไม่มีสิทธิ์/รับ delegation ไม่ได้
10. API รายงานรับหนึ่ง `report_month` และไม่รับ start/end/posting/due date filter
11. Search/filter ใช้ market/booth/shirt เท่านั้น และ summary, options, pagination ใช้ grouped dataset ที่สอดคล้องกัน
12. OpenAPI, validation, permission, audit, cycle snapshot, aggregation, reconciliation และ timezone tests ผ่าน
13. Frontend มี month picker, market/booth/shirt filter และ read-only dates แล้ว; หลัง Backend พร้อมต้องถอด mock และเชื่อม API ตามข้อ 29.11
