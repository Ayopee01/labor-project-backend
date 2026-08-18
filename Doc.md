# Doc.md — เอกสารอธิบายโปรเจกต์ Labor Project Backend

เอกสารนี้สรุปภาพรวมสถาปัตยกรรม แนวทางการเขียนโค้ด และ flow การทำงานจริงของระบบ ณ ปัจจุบัน สำหรับใช้เป็นจุดเริ่มต้นก่อนอ่านซอร์สโค้ดจริง

---

## 1. ภาพรวมระบบ

ระบบนี้เป็น **Backend ของระบบบริหารแรงงานขนถ่ายสินค้า (Labor Management)** ที่เชื่อมโยง 4 ฝั่งเข้าด้วยกัน:

1. **Gate** — จุดชั่ง/รับรถที่หน้างาน ยิง request สร้างงานเข้ามาเมื่อรถมาถึงและแจ้งรายการสินค้าที่ต้องขน
2. **Worker (คนงาน)** — แอปมือถือของคนงาน รับงาน สแกน QR เช็คอิน และส่งยอดสินค้าที่ขนจริง
3. **Vendor ผ่าน LINE** — เจ้าของบูธ/แผงยืนยันหรือปฏิเสธยอดที่คนงานส่งมา ผ่านปุ่มใน LINE Flex Message
4. **Admin (เจ้าหน้าที่)** — เว็บฝั่ง Admin จัดการ ควบคุม ตรวจสอบ และดูประวัติ/การเงินของงานทั้งหมด

### Stack เทคโนโลยีหลัก

| ส่วน | เทคโนโลยี |
|---|---|
| Language / Runtime | TypeScript, Node.js 22 (รันผ่าน `tsx`) |
| Web Framework | Express 5 |
| Database | PostgreSQL ผ่าน Prisma ORM 7 (`@prisma/adapter-pg`) |
| Cache / Queue store | Redis ผ่าน `ioredis` |
| Background Job | BullMQ (timeout ของการรับงาน/สแกน, ส่ง notification) |
| Auth | JWT (`jsonwebtoken`) + Session ใน DB, hash รหัสผ่านด้วย `argon2` |
| Validation | `zod` |
| Realtime | WebSocket (`ws`) ฝั่ง Worker, Server-Sent Events (SSE) ฝั่ง Admin |
| Push Notification | Firebase Admin (FCM) |
| API Docs | `swagger-jsdoc` + `swagger-ui-express` (ไฟล์ YAML แยกตาม domain ใน `src/docs/openapi/`) |
| Test | Node.js built-in test runner (`node --test`) ไม่ใช้ Jest/Mocha |

---

## 2. สถาปัตยกรรมโค้ด (Layered Architecture)

โค้ดฝั่ง backend แบ่งเป็นชั้นตายตัวและ **ทุก endpoint ไหลทิศทางเดียวกันเสมอ**:

```
Route (src/routes/*.routes.ts)
   → Middleware (auth / session / role / permission / validation)
   → Service (src/services/*.service.ts)              ← business logic ทั้งหมดอยู่ที่นี่
   → Repository (src/repositories/*.repository.ts)     ← เข้าถึง DB ผ่าน Prisma เท่านั้น
   → Prisma Client → PostgreSQL
```

กติกาเหล็กของโปรเจกต์:

- **Route ต้องบางที่สุด** — แค่รับ request, เรียก service, ส่ง response หรือส่งต่อ error ไม่มี logic ทางธุรกิจอยู่ใน route
- **Service เป็นที่เดียวที่มี business logic** — คำนวณ, ตรวจเงื่อนไข, ตัดสินใจ status, เขียน log/audit ล้วนอยู่ที่ service
- **Repository ห้ามมี business logic** — มีหน้าที่ query/insert/update ผ่าน Prisma เท่านั้น รับพารามิเตอร์ที่ service เตรียมมาให้แล้ว
- **ห้าม service เรียก Prisma ตรง ๆ** — ต้องผ่าน repository เสมอ เพื่อให้ mock repository ตอน test ได้ และเปลี่ยน storage ได้โดยไม่กระทบ service

### โครงสร้างโฟลเดอร์หลัก (`src/`)

```
config/        ค่าคงที่ config เช่น permission, auth, env
constants/     ค่าคงที่ status ต่าง ๆ (job-status.ts เป็นไฟล์ศูนย์กลางของทุก status)
db/            ตัว Prisma client + withTransaction helper
docs/          Swagger setup + ไฟล์ OpenAPI YAML แยกตาม domain
middlewares/   auth, session, role, permission, case-conversion, error, security, rate-limit
queues/        BullMQ job (worker-dispatch, worker-queue, notification-queue)
repositories/  เข้าถึง DB แยกตาม domain, มี shared/ สำหรับ repository ที่ใช้ร่วมหลาย service
routes/        Express router แยกตาม domain
services/      Business logic แยกตาม domain, มี shared/ สำหรับ logic ที่ใช้ร่วมหลาย service
types/         TypeScript type/DTO ของแต่ละ domain
utils/         Pure function ล้วน (jwt, password, pricing, shift, logger, ฯลฯ)
validation/    Zod schema ของทุก request body/query + ตัว parser กลาง
websockets/    WebSocket server ฝั่ง Worker
```

`test/` แยกเป็น `unit/` (pure function), `routes/` (ยิง HTTP จริงผ่าน Express app แต่ mock repository), `integration/database/` (ต่อ PostgreSQL/Redis จริง, รันเมื่อ `RUN_DB_TESTS=1`)

---

## 3. แนวคิดข้อมูลหลัก (Core Domain Model)

จุดที่สำคัญที่สุดที่ต้องเข้าใจก่อนอ่าน flow คือลำดับชั้นของ "งาน" หนึ่งงาน:

```
VehicleJob (TicketNumber)                 = "รถหนึ่งคัน" ที่เข้ามาที่ Gate
   └── MarketJob (Ticket / Business Ticket, มี TicketNo ของตัวเอง)
          = "ใบสั่งงานหนึ่งใบ" ของรถคันนั้น ไปตลาดเดียว
            รถคันเดียวมีได้หลาย MarketJob ทยอยเข้ามาไม่พร้อมกัน (Gate ยิงมาทีละใบ)
          └── GateTicket (Booth)          = "บูธ/แผง" หนึ่งบูธภายใน MarketJob นั้น
                 └── TicketProduct        = สินค้าหนึ่งรายการในบูธนั้น (จำนวนที่ Gate แจ้ง + จำนวนที่คนงานส่งยอดจริง)
                        └── TicketProductFinancial   = เงินที่คำนวณแล้วของสินค้ารายการนั้น (fix ตอน finalize)
                               └── TicketWorkerPayment = เงินที่แบ่งให้คนงานแต่ละคนสำหรับสินค้ารายการนั้น
```

**ทีมคนงาน (VehicleJobAssignment)** ผูกกับ `VehicleJob` (ระดับรถทั้งคัน) ไม่ใช่ระดับ MarketJob — คนงานทีมเดียวกันทำได้ทุก MarketJob ของรถคันนั้น

**สมาชิกภาพในงาน (TicketWorker)** ผูกกับ `MarketJob` (ระดับ Business Ticket) — ใช้ตัดสินว่าใครมีสิทธิ์ได้รับเงินจาก Business Ticket ใบนั้น เพราะคนงานอาจถูกถอดออกจากใบงานหนึ่งแต่ยังทำใบอื่นของรถเดิมต่อได้

### สถานะ (Status) ที่ต้องรู้จัก — อยู่รวมที่ `src/constants/job-status.ts` ไฟล์เดียว

| Entity | สถานะ | ความหมายคร่าว ๆ |
|---|---|---|
| `VehicleJob.status` | `WAIT → WORKING → COMPLETED` / `CANCELLED` | สถานะรวมของรถทั้งคัน |
| `MarketJob.status` / `GateTicket.status` (Ticket/Booth) | `WAIT → WORKING → DELIVERED → REJECT → COMPLETED` / `CANCELLED` | วงจรการส่งยอด-ยืนยันของ Business Ticket/บูธ |
| `VehicleJobAssignment.status` | `PENDING → ACCEPTED → SCANNED → WORKING → DELIVERED → (REJECT) → COMPLETED` หรือแยกเป็น `RELEASED` / `CANCELLED` / `TIMEOUT` | วงจรของ "คนงานหนึ่งคนถูก dispatch เข้ารถคันนี้" |
| `TicketWorker.status` | `WORKING → COMPLETED` หรือ `CANCELLED` | สมาชิกภาพของคนงานใน Business Ticket ใบหนึ่ง (มีสิทธิ์รับเงินหรือไม่) |

**หมายเหตุสำคัญ:** `COMPLETED` ของ `VehicleJobAssignment` แปลว่า **รถทั้งคันปิดงานแล้ว** ส่วน `RELEASED` (เพิ่มเข้ามาใหม่) แปลว่า **คนงานคนนั้นทำงานที่ตัวเองรับผิดชอบเสร็จและถูก Admin ปล่อยกลับคิวก่อนที่รถทั้งคันจะปิดงาน** — สองสถานะนี้ตั้งใจแยกกันชัดเจน ห้ามใช้ปนกัน

ทุกฟิลด์ status ในฐานข้อมูลเป็น `String` ธรรมดา (ไม่ใช้ Prisma enum) เพื่อให้เพิ่มค่าสถานะใหม่ได้โดยไม่ต้อง migrate schema

---

## 4. Flow การทำงานหลักแบบ end-to-end

### 4.1 Gate สร้างงาน

`POST /api/gate/tickets` (auth ด้วย HTTP Basic ผ่าน `gateClientId:gateClientSecret`, ตรวจใน `gate-client-auth.middleware.ts`)

1. Gate ส่งข้อมูลรถ + ตลาด + บูธ + รายการสินค้ามาเป็นก้อนเดียว
2. ถ้าเป็นรถคันใหม่ (TicketNumber ใหม่) → สร้าง `VehicleJob`
3. ถ้าเป็นรถที่มีอยู่แล้ว → ไม่สร้าง `VehicleJob` ซ้ำ แต่สร้าง `MarketJob` (Business Ticket) ใหม่เพิ่มเข้าไปในรถคันเดิม
4. สร้าง `GateTicket` (booth) + `TicketProduct` ตามรายการที่ Gate ส่งมา พร้อม snapshot อัตราค่าแรง/ค่าแผงจาก `MasterRate` ปัจจุบัน (กันปัญหาราคาที่เปลี่ยนภายหลังไปกระทบงานเก่า)
5. คำนวณ `VehicleJob.workersRequired` ใหม่เป็นผลรวม (`SUM`) ของทุก `MarketJob.workersRequired` ใต้รถคันนั้น แล้วสั่ง dispatch คนงานทันที (ถ้ามีคิวว่างพอ)
6. กันข้อมูลซ้ำด้วย `GateRequestLog` (unique ที่ `gate_transaction_ref`) — ถ้า Gate ยิงซ้ำด้วย ref เดิมจะได้ response เดิม ไม่สร้างงานซ้ำ

### 4.2 Dispatch คนงาน (Redis Queue + BullMQ)

- คนงานที่ว่างจะอยู่ใน **Redis FIFO queue** (`worker-queue.ts`)
- `dispatchReadyWorkers()` (`worker-dispatch.ts`) จะไล่ดึงคนงานจากคิวมาใส่ `VehicleJobAssignment` ทีละคนจนครบ `workers_required` ของแต่ละรถ ที่ยังขาดคน
- แต่ละ assignment มี deadline สองช่วง ควบคุมด้วย BullMQ delayed job:
  - **Accept deadline** — ถ้าคนงานไม่กดรับงานทันเวลา → `ASSIGNMENT_STATUS.TIMEOUT` แล้วเรียก dispatch ใหม่แทนที่
  - **Scan deadline** — คนงานรับงานแล้วแต่ไม่สแกน QR เช็คอินทันเวลา → timeout เช่นกัน
- คนงานเช็คอินด้วยการสแกน QR เฉพาะของแต่ละ `MarketJob` (`workerQrToken`) — สแกนใบใดใบหนึ่งของรถคันนั้นสำเร็จ ถือว่าทั้งทีมเช็คอินสำเร็จ (เพราะ dispatch ผูกที่ระดับรถ)
- แจ้งเตือนคนงานผ่าน **WebSocket** (`/ws/workers`) แบบ real-time (งานใหม่, ใกล้หมดเวลา, ถูกยกเลิก ฯลฯ) และสำรองด้วย **FCM push** เมื่อแอปปิดอยู่

### 4.3 คนงานทำงานและส่งยอด

`POST /api/workers/me/assignments/:ticketNumber/tickets/complete`

1. คนงานกรอกจำนวนสินค้าที่ขนจริงของบูธหนึ่งบูธ ระบบตรวจว่าคนงานคนนี้เป็นสมาชิก (`TicketWorker`) ที่ยัง active ของ Business Ticket นั้นจริง
2. บันทึกเป็น `TicketCompletionSubmission` หนึ่งแถวต่อการส่งยอดหนึ่งครั้ง (เก็บประวัติทุกครั้ง ไม่เขียนทับ)
3. บูธเปลี่ยนสถานะเป็น `DELIVERED` รอ vendor ยืนยัน และส่ง LINE Flex Message ไปหา vendor ของบูธนั้นพร้อมปุ่มยืนยัน/ปฏิเสธ

### 4.4 Vendor ยืนยัน/ปฏิเสธผ่าน LINE

`POST /api/line/webhook` (ตรวจลายเซ็นด้วย header `x-line-signature` เทียบกับ raw body)

- Vendor กดปุ่มใน LINE → LINE เรียก webhook พร้อม signed action token (`vendor-action-token.ts`) ที่ผูกกับ `ticket_id` + `submission_id` + `boothCode` เท่านั้น (ปลอมแปลงไม่ได้)
- **ยืนยัน (confirm):** บูธเปลี่ยนเป็น `COMPLETED` → เข้าสู่ flow finalize การเงิน
- **ปฏิเสธ (reject):** บูธเปลี่ยนเป็น `REJECT` พร้อมเหตุผล รอคนงานแก้ไขแล้วส่งยอดใหม่ (submission ใหม่จะถูกสร้างต่อท้าย ไม่ใช่แก้ของเดิม)
- มีระบบ **timeout อัตโนมัติ** (BullMQ) ถ้า vendor ไม่ตอบภายในเวลาที่กำหนด จะถือว่ายืนยันอัตโนมัติ (`vendor_confirm` timeout job)

### 4.5 Finalize การเงิน (คำนวณเงินจริง)

เกิดขึ้นเมื่อ **ทุกบูธของ Business Ticket ใบเดียวกัน** ปิดจบแล้ว (`COMPLETED` หรือ `CANCELLED` ทั้งหมด):

1. ล็อก roster ของ `MarketJob` นั้น (`workerRosterLockedAt`) — หลังจากนี้ห้ามเพิ่ม/ลบสมาชิกของใบนี้อีก
2. คำนวณเงินต่อสินค้าแต่ละรายการ (`src/utils/labor-job-pricing.ts` — สูตรเดียว ใช้ทุกที่ ห้ามมีสูตรคำนวณซ้ำที่อื่น) แบ่งเป็น:
   - ค่าแผง (stall fee) ตาม weight range ของสินค้า
   - ค่าแรง (labor fee) หารเท่า ๆ กันตามจำนวนคนงานที่ active บน Business Ticket นั้น ปัดเศษแล้วเก็บเศษที่เหลือเป็น `fund_amount`
3. บันทึกผลเป็น `TicketProductFinancial` (fix ค่าแล้ว อ่านซ้ำได้ไม่คำนวณใหม่) และ `TicketWorkerPayment` ต่อคนงานแต่ละคน
4. เขียน `TicketWorker.finalEarningAmount` เป็นยอดรวมที่คนงานคนนั้นได้จาก Business Ticket ใบนี้ — ค่านี้คือ **แหล่งความจริงเดียว (source of truth)** ของรายได้ ห้าม endpoint ไหนคำนวณใหม่ ต้องอ่านค่านี้ตรง ๆ เท่านั้น

### 4.6 ปิดงานทั้งคันและคืนคนงานเข้าคิว

รถคันหนึ่งจะถูกมองว่า "จบงานทั้งคัน" ต่อเมื่อครบ 2 เงื่อนไข:

1. ทุก Business Ticket ของรถคันนั้น terminal หมดแล้ว (`COMPLETED`/`CANCELLED`)
2. Gate ได้ "ปิดรับ Ticket เพิ่ม" แล้ว (`ticketsClosedAt` ถูกตั้งค่า — ผ่าน `POST /api/gate/vehicle-jobs/:ticketNumber/close` หรือถึงจำนวน `TicketCount` ที่ Gate แจ้งไว้ล่วงหน้า)

เมื่อครบทั้งสองเงื่อนไข: `VehicleJob.status = COMPLETED`, ทุก assignment เปลี่ยนเป็น `COMPLETED`, และคนงานถูกคืนเข้าคิว Redis (`returnCompletedWorkersToQueue`)

นอกจากนี้ **Admin ปล่อยคนงานกลับคิวก่อนเวลาได้** ผ่าน `POST /api/admin/vehicle-jobs/:ticketNumber/release-workers` โดยไม่ต้องรอให้รถทั้งคันปิดงาน — ใช้ได้เมื่อทุกบูธ terminal หมดแล้วเท่านั้น (ดูหัวข้อ 6)

---

## 5. Auth, Session และ Permission

### 5.1 การยืนยันตัวตนของแต่ละฝั่ง

| ฝั่ง | วิธียืนยันตัวตน |
|---|---|
| Admin / Worker | `POST /api/auth/login` → ได้ Access Token (JWT อายุสั้น) + Refresh Token (เก็บ hash ไว้ใน `UserSession`, ต่ออายุผ่าน `/api/auth/refresh`) |
| Gate | HTTP Basic Auth ด้วย `client_id:client_secret` (สร้าง/หมุน secret ผ่าน Admin Settings) |
| Driver | Session token แยกต่างหาก (`DriverSession`) ผูกกับ QR ของรถคันนั้นโดยเฉพาะ ไม่ใช้ JWT ปกติ |
| LINE Webhook | ตรวจลายเซ็น HMAC จาก LINE (`x-line-signature`) เทียบกับ raw body ไม่ใช้ token แบบ user |

### 5.2 Middleware chain ของ route ฝั่ง Admin (ตัวอย่างมาตรฐาน)

```ts
router.use(authMiddleware, sessionMiddleware, roleMiddleware(["admin"]));
router.post(
  "/vehicle-jobs/:ticketNumber/wait",
  permissionMiddleware(["jobs:wait"]),
  handler
);
```

- `authMiddleware` — ถอด Bearer token, verify ลายเซ็น JWT, ใส่ payload ไว้ที่ `req.auth`
- `sessionMiddleware` — เช็คว่า session ยังไม่ถูก revoke/logout จริงใน DB (กันกรณี token ยังไม่หมดอายุแต่ logout ไปแล้ว)
- `roleMiddleware(["admin"])` — เช็ค role หยาบ ๆ (admin/worker)
- `permissionMiddleware([...])` — เช็ค permission ละเอียดของ admin คนนั้น เทียบกับ permission ทั้งหมดที่กำหนดไว้ใน `ADMIN_PERMISSIONS` (`src/config/permission.config.ts`) เพิ่ม permission ใหม่ต้องประกาศไว้ที่ไฟล์นี้ก่อนเสมอ

Permission เป็นรูปแบบ `resource:action` เช่น `jobs:read`, `jobs:override_count`, `jobs:wait`, `jobs:release_workers` — ผูกกับ admin แต่ละคนผ่าน `AccountPermission` และมี "ระดับ admin" (`owner > manager > supervisor`) ที่ควบคุมว่า admin คนหนึ่งจัดการ admin อีกคนที่ระดับต่ำกว่าได้เท่านั้น

---

## 6. Flow ฝั่ง Admin (คุมงานที่กำลังทำอยู่)

Admin มี 2 มุมมองหลัก:

- **Operations board** (`GET /api/admin/vehicle-jobs/operations`) — ดูงานที่ **กำลังทำอยู่ตอนนี้** สรุปจำนวนรถ/คนงานตามสถานะ dispatch
- **History** (`GET /api/admin/vehicle-jobs/history`) — ดูงาน **ที่ผ่านมาแล้วหรือกำลังทำ** แบบละเอียดทุกชั้น (ดูหัวข้อ 7)

และมีชุด endpoint สำหรับ "เข้าไปแทรกแซง" งานที่กำลังทำอยู่ (เพิ่มใหม่ล่าสุด):

| Endpoint | ใช้เมื่อ |
|---|---|
| `POST /vehicle-jobs/:ticketNumber/stalls/:stallCode/override-count` | คนงานกรอกยอดผิด/ลืมกรอก → Admin กรอก/แก้แทนได้ ก่อนบูธนั้นปิดงานหรือคิดเงินเสร็จ |
| `POST /vehicle-jobs/:ticketNumber/wait` | รถยังไม่พร้อมเข้าจุดลงสินค้า สั่งกลับไปสถานะ `WAIT` ได้เฉพาะตอนที่ยังไม่มีบูธไหนเริ่มงาน |
| `POST /vehicle-jobs/:ticketNumber/release-workers` | คนงานส่งยอดครบทุกบูธแล้ว ไม่ต้องรอปิดงานทั้งคัน ปล่อยกลับคิวได้เลย |

ทั้ง 3 endpoint นี้เขียน log ลงตาราง **`AdminActionLog`** เสมอ (เก็บ `vehicle_job_id`, `action_type`, `reason_code`, `reason_text`, `actor_account_id`) — เป็น audit table กลางตัวเดียวที่ใช้ร่วมกันทั้งสาม endpoint แทนการเติมคอลัมน์ `*_by`/`*_reason` กระจายไปตามตารางต่าง ๆ และถูกดึงมาแสดงใน Timeline ของ History โดยตรง (event type `ADMIN_ACTION`)

---

## 7. Work History — มุมมองเจาะลึกที่สุดของหนึ่งงานรถ

`GET /api/admin/vehicle-jobs/history` เป็น endpoint ที่ข้อมูลครบที่สุด ประกอบด้วย 4 ส่วนต่อหนึ่งรายการ:

1. **`vehicle_job`** — ข้อมูลรถ + timestamp ที่ derive มาจากข้อมูลจริง (ไม่มีการเก็บซ้ำ): `work_start` (สแกนแรกสุด), `submitted_complete_at`, `vendor_confirmed_complete_at`, `completed_at`, `duration_seconds`
2. **`markets[].booths[]`** — รายละเอียดเงินต่อบูธ/สินค้า (**reuse ฟังก์ชันเดียวกับหน้า `/financials` ตรง ๆ ไม่คำนวณสูตรใหม่**) บวกข้อมูลการส่งยอด/reject (`submitted_worker_codes`, `submitted_at`, `confirmedAt`, `rejection_history`)
3. **`workers[]`** — ทุกคนงานที่เคยถูก dispatch เข้ารถคันนี้ พร้อม timeline ส่วนตัว (`accepted_at`/`scanned_at`/`submitted_at`/`released_at`/`final_status`)
4. **`timeline[]`** — เหตุการณ์ทั้งหมดของรถคันนี้เรียงตามเวลาจริง รวมจาก 3 แหล่ง: `WorkerAssignmentEvent` (เหตุการณ์ของคนงาน), `TicketCompletionSubmission` (ส่งยอด/reject/confirm), `AdminActionLog` (การกระทำของ admin)
5. **`finance`** — สรุปเงินรวมทั้งคัน รวมจากค่าที่คำนวณไว้แล้วของทุกบูธ (ไม่คำนวณสูตรใหม่เช่นกัน)

**Daily Worker Income** — `GET /api/admin/vehicle-jobs/history/daily-worker-income` ต่อยอดจากแนวคิดเดียวกัน แสดง **หนึ่งแถวต่อคนงานหนึ่งคนต่อ Business Ticket หนึ่งใบ** พร้อมยอดเงินที่ต้องจ่าย (`payable` = `TicketWorker.finalEarningAmount` ตรง ๆ) ตั้งใจฝังไว้ใต้ namespace `/vehicle-jobs/history` เดิมแทนที่จะสร้าง root ใหม่ เพราะข้อมูลมาจากแหล่งเดียวกัน และรองรับ query แบบ alias (`from`/`to`/`workerCode`/`keyword`/`pageSize`) ให้ตรงกับ convention เดิมของ History (`date_from`/`date_to`/`search`/`limit`) โดยไม่ทำให้ contract เดิมพัง

---

## 8. Convention การแปลง Casing ของ Request/Response (สำคัญมาก)

นี่คือกลไกที่ทำให้โค้ดภายในเขียนแบบ `snake_case`/`camelCase` ผสมกันได้ตามความเหมาะสม แต่ **API ที่ยิงออกไปจริงเป็น PascalCase เสมอ** — ควบคุมที่ `src/middlewares/api-case.middleware.ts` สองทิศทาง:

```
Client (Frontend/Postman)  --[PascalCase JSON]-->  normalizeApiRequestBody (req.body เท่านั้น)
                                                        → แปลงเป็น internal casing ก่อนเข้า route/service
Service คืน DTO ภายใน (snake_case/camelCase ตามธรรมชาติของฟิลด์)
                            --[toPascalCasePayload]--> pascalCaseApiResponse ครอบ res.json
                                                        → ลูกค้าเห็นเป็น PascalCase เสมอ
```

- แปลง key ทั่วไปด้วยอัลกอริทึมอัตโนมัติ (`snake_case` ↔ `PascalCase`)
- ฟิลด์ที่ตั้งใจให้เป็น `camelCase` ล้วน (เช่น `marketCode`, `boothCode`, `productCode` — เป็น business identifier ที่มาจากระบบภายนอก) และฟิลด์หลายคำที่กำกวม ต้องประกาศไว้ใน `requestKeyMap` dictionary ตรง ๆ มิฉะนั้นจะถูกเดาแบบ camelCase อัตโนมัติ (ค่า default เมื่อไม่พบใน dictionary)
- **ข้อควรระวังเวลาเพิ่มฟิลด์ใหม่:** ต้องเช็คว่า PascalCase key ที่ได้ไปชนกับฟิลด์ชื่อเดียวกันจาก endpoint อื่นหรือไม่ เพราะ dictionary นี้ map แบบ **1 key ต่อ 1 ทิศทางกลับเสมอ ไม่แยกตาม endpoint** (เคยเกิดปัญหานี้จริงตอนเพิ่ม `confirmedAt`/`rejectedAt` ให้ Work History แล้วไปชนกับ endpoint `assignments/history` ที่มีอยู่ก่อน แก้โดยตั้งชื่อฟิลด์ใหม่ให้ตรงกับ convention เดิมแทนที่จะเปลี่ยน dictionary)
- Query string (`req.query`) **ไม่ผ่าน**การแปลงนี้ — ต้อง handle เอง (ปกติ backend ออกแบบให้ query เป็น `snake_case`/`lowerCamel` ตรงไปตรงมาอยู่แล้ว, ใช้ zod `.transform()` ทำ alias ตอนต้องรองรับหลายชื่อ)

---

## 9. Response Type และรูปแบบ Error

### 9.1 Success response

ไม่มี wrapper กลางตายตัว (ไม่ใช่ `{success, data}` เสมอไป) — แต่ละ endpoint คืนรูปร่างของตัวเอง ปกติแบ่งเป็น 2 แบบหลัก:

- **Single resource** — คืน object ตรง ๆ (เช่น response ของ `login`, ของ mutation อย่าง `wait`/`release-workers`)
- **List resource** — คืน `{ Data: [...], Pagination?: {...} }` โดย `Pagination` เป็น `null`/ไม่มีเมื่อ endpoint นั้นไม่ได้ query แบบมี `page`

Type ของทุก response ประกาศไว้ที่ `src/types/*.type.ts` แยกตาม domain (เช่น `admin-jobs.type.ts`, `worker.type.ts`, `gate.type.ts`) — ชื่อ type ลงท้ายด้วย `Response` เสมอสำหรับ shape ที่ส่งออก, ลงท้ายด้วย `Dto`/`Record` สำหรับ shape ภายใน

### 9.2 Error response

ทุก error ไหลผ่าน `ApiError` (`src/utils/api-error.ts`) → จับที่ `errorHandler` กลาง (`src/middlewares/error.middleware.ts`) คืนรูปแบบเดียวกันเสมอ:

```json
{
  "StatusCode": 409,
  "Code": "VEHICLE_JOB_ALREADY_STARTED",
  "Message": "Vehicle job already has a booth in progress and can no longer be changed to wait."
}
```

- Validation error จาก zod จะแนบ `ValidationErrors: [{ Field, Message }, ...]` เพิ่มเข้ามาใน response ผ่าน `parseWithSchema` (`src/validation/parser.ts`)
- error 5xx จะไม่โชว์รายละเอียดจริงใน production (`shouldIncludeErrorDetails`) กันข้อมูล internal รั่ว มีแต่ `StatusCode`/`Code`/ข้อความกลาง ๆ

---

## 10. Realtime และ Background Job

| กลไก | ใช้กับใคร | ใช้ทำอะไร |
|---|---|---|
| WebSocket `/ws/workers` | คนงาน | แจ้งงานใหม่, ใกล้หมดเวลารับ/สแกน, ถูกยกเลิก, ถูกปล่อยกลับคิว แบบ real-time ระหว่างแอปเปิดอยู่ |
| Server-Sent Events `GET /api/admin/events` | Admin | สตรีมเหตุการณ์ของบอร์ด operation แบบ real-time (งานใหม่เข้า, สถานะเปลี่ยน) |
| FCM Push (Firebase) | คนงาน | สำรองเมื่อแอปปิด/ไม่ได้เปิด WebSocket ไว้ ส่งเฉพาะ event สำคัญ |
| BullMQ delayed job | ระบบ | accept timeout, scan timeout, vendor-confirm timeout, worker break auto-return |

---

## 11. แนวทางการทดสอบ (Testing)

โปรเจกต์นี้ **ไม่ใช้ mock business logic เพื่อให้ test ผ่าน** — Service รันจริงทั้งหมด สิ่งที่ mock มีแค่ repository (ชั้นเข้าถึง DB) เท่านั้น:

- `test/unit/` — ทดสอบ pure function (pricing, shift, jwt, permission config ฯลฯ) ไม่แตะ HTTP/DB
- `test/routes/` — บูตแอป Express จริงทั้งตัว ยิง HTTP จริงผ่าน `fetch` แต่สลับ repository เป็น in-memory mock ด้วย module-loader monkey-patch (`test/helpers/app-test-harness.ts`) — ทำให้ทดสอบ flow เต็มรูปแบบ (Gate → Dispatch → Worker → Vendor → Finalize) ได้เร็วโดยไม่ต้องมี DB จริง
- `test/integration/database/` — ต่อ PostgreSQL/Redis จริง รันเมื่อ `RUN_DB_TESTS=1` เท่านั้น (ทดสอบ query ที่ซับซ้อนหรือพึ่งพา DB จริง)

รันชุดทดสอบหลัก:

```bash
npm run test:unit          # unit test
npm run test:routes        # route test (mock repository) ทีละไฟล์ตามลำดับ
npm run test:integration   # ต้องมี PostgreSQL/Redis จริง และ RUN_DB_TESTS=1
npm run test:all           # ทั้งหมดต่อกัน
```

---

## 12. แนวทางจัดการฐานข้อมูล (Prisma & Migration)

- Schema กลางอยู่ที่ `prisma/schema.prisma` ทุกคอลัมน์ map เป็น `snake_case` จริงใน DB ผ่าน `@map`/`@@map` แต่ตัว Prisma Client ใช้ `camelCase` ในโค้ด TypeScript
- Field ที่เป็น "status" ทุกตัวเป็น `String` ธรรมดา ไม่ใช้ Prisma `enum` — เพิ่มค่าสถานะใหม่ (เช่น `RELEASED`) ทำได้โดยไม่ต้อง migrate schema เลย
- Migration ทุกตัวอยู่ที่ `prisma/migrations/<timestamp>_<ชื่อสื่อความหมาย>/migration.sql` **ห้ามลบของเก่า ห้าม reset ข้อมูล** เพิ่มคอลัมน์ใหม่เฉพาะตอนที่ข้อมูลนั้น derive จากของเดิมไม่ได้จริง ๆ เท่านั้น
- คำสั่งที่ต้องรันคู่กันเสมอเวลาที่ schema เปลี่ยน: `npx prisma validate` → `npx prisma generate` → เขียน/รัน migration → `npm run build`

---

## 13. สรุปรายการ Endpoint ปัจจุบัน (แยกตาม Domain)

| Domain | Prefix | ตัวอย่าง |
|---|---|---|
| Auth | `/api/auth` | login, refresh, logout, me |
| Admin Workers | `/api/admin/users` | list/create/update คนงาน, permission |
| Admin Jobs | `/api/admin/vehicle-jobs`, `/api/admin/jobs` | operations, history, daily-worker-income, override-count, wait, release-workers, assign-workers, cancel ต่าง ๆ |
| Admin Audit | `/api/admin/audit` | สถิติผลงานคนงาน |
| Admin Settings | `/api/admin/settings`, `/api/admin/gate-clients` | ตั้งค่าระบบ, จัดการ Gate client |
| Admin Realtime | `/api/admin/events` | SSE stream |
| Gate | `/api/gate` | สร้างตั๋ว, ปิดรับตั๋วของรถ, ตัวเลือก market/booth/product |
| Driver | `/api/driver` | สแกน QR คนขับ, ดูงานปัจจุบัน |
| Worker Application | `/api/workers/me` | online/offline/break, รับงาน, สแกน QR, ส่งยอด, ประวัติ, รายได้ |
| LINE | `/api/line/webhook` | vendor confirm/reject/rating |

รายละเอียด request/response ทุก field ดูได้ที่ Swagger UI: รันเซิร์ฟเวอร์แล้วเปิด `/api-docs` (ไฟล์ต้นทางอยู่ที่ `src/docs/openapi/*.yaml`) หรือดู collection ทดสอบสำเร็จรูปที่ `Postman_Collection.json` ที่ root โปรเจกต์

---

## 14. ฟีเจอร์ที่เพิ่มล่าสุด (บริบทของงานรอบนี้)

รอบล่าสุดเพิ่ม 6 ความสามารถฝั่ง Admin โดยยึดแนวทาง "reuse logic เดิมให้มากที่สุด ไม่ duplicate สูตรคำนวณ ไม่ reset ข้อมูล":

1. `POST /vehicle-jobs/:ticketNumber/stalls/:stallCode/override-count` — Admin กรอก/แก้ยอดสินค้าแทนคนงาน
2. `POST /vehicle-jobs/:ticketNumber/wait` — สั่งรถกลับสถานะ `WAIT`
3. `POST /vehicle-jobs/:ticketNumber/release-workers` — ปล่อยทีมคนงานกลับคิวก่อนปิดงานทั้งคัน (เพิ่มสถานะใหม่ `RELEASED` แยกจาก `COMPLETED` อย่างชัดเจน)
4. `GET /api/admin/users` — เพิ่มฟิลด์ `Phone` (ไม่ migrate schema เพราะ column มีอยู่แล้ว แค่ propagate ไม่ครบ)
5. ขยาย `GET /vehicle-jobs/history` เดิม ให้มี `Workers[]` / `Timeline[]` / `Finance` / timestamp ระดับงาน (derive ทั้งหมด ไม่เพิ่มคอลัมน์ใหม่ที่ไม่จำเป็น ยกเว้นตาราง audit กลาง `AdminActionLog` ที่จำเป็นจริง)
6. `GET /vehicle-jobs/history/daily-worker-income` — รายได้คนงานรายวัน ต่อยอดจาก TicketWorker ที่ finalize แล้ว

Migration ที่เพิ่มเข้ามาในรอบนี้: `20260818130000_admin_actions_and_worker_release` (เพิ่มตาราง `AdminActionLog` + คอลัมน์ `VehicleJobAssignment.releasedAt`)

Swagger docs (`src/docs/openapi/admin-jobs.yaml`, `components.yaml`) และ `Postman_Collection.json` ถูกอัปเดตให้ตรงกับทั้ง 6 ฟีเจอร์นี้แล้ว
