ช่วย refactor โครงสร้าง Worker ของโปรเจกต์นี้ใหม่ โดยให้ตรวจสอบโค้ดและ Prisma schema ปัจจุบันก่อนแก้จริง แล้วดำเนินการตาม requirement ด้านล่าง

## เป้าหมายหลัก

ปัจจุบันระบบใช้ตาราง User / Account เดิมเก็บทั้ง Admin และ Worker แต่แนวทางใหม่จะเปลี่ยนเป็น:

* ตาราง User / Account เดิม **ไม่ใช้เก็บ Worker อีกต่อไป**
* ตาราง User / Account เดิมให้เหลือไว้สำหรับ **Admin / ผู้ใช้งานหลังบ้านที่ต้อง login เข้าระบบ**
* Worker ให้ย้ายออกมาเป็น Master Data แยกต่างหาก
* สร้าง Prisma model ใหม่ชื่อ:

```prisma
MasterWorker
```

* Worker ทั้งหมดในระบบต้องอ้างอิง `MasterWorker` แทน User / Account เดิม
* สร้าง Seed ของ `MasterWorker` จากไฟล์:

```text
Worker(1).csv
```

* เอาเฉพาะข้อมูลที่จำเป็นตามรายการด้านล่าง
* ไม่ต้องเก็บข้อมูล HR / Card / Market ที่เราไม่ได้ใช้
* ลบ schema/table/field/relationship เก่าที่ไม่จำเป็นแล้ว
* Cleanup code เก่าที่เกี่ยวข้องด้วย อย่าทิ้ง dead code หรือ compatibility logic ที่ไม่มีการใช้งาน

---

# 1. ตรวจสอบระบบเดิมก่อน

ก่อนแก้ code ให้ตรวจสอบ:

* `prisma/schema.prisma`
* migrations ปัจจุบัน
* seed ปัจจุบัน
* Account/User model
* Worker-related models
* relations ที่ปัจจุบันชี้ไป Account/User
* worker repository
* worker service
* worker controller
* worker routes
* queue logic
* assignment logic
* Redis worker queue
* BullMQ jobs ที่เกี่ยวข้องกับ worker
* authentication / authorization
* admin seed
* tests ที่เกี่ยวข้อง

ให้เข้าใจก่อนว่า field ไหนของ Account/User ใช้สำหรับ Admin และ field ไหนเคยมีไว้สำหรับ Worker

จากนั้นค่อย refactor

**ห้ามลบ table แบบเดาสุ่ม**

ถ้า table ใดยังถูกใช้โดย assignment/job/history/queue หรือระบบสำคัญอื่น ให้ migrate relation ไปหา `MasterWorker` ก่อน แล้วจึงลบของเก่า

---

# 2. Account / User ให้เหลือเฉพาะ Admin

Account/User เดิมไม่ใช่ Worker Master อีกต่อไป

ให้ปรับ model เดิมให้เหลือข้อมูลที่จำเป็นสำหรับ:

* Admin login
* authentication
* password
* permissions
* roles
* sessions
* admin profile

Worker ไม่ต้องมี Account/User record อีกต่อไป เว้นแต่มีเหตุผลทางระบบที่จำเป็นจริง ๆ

ให้เอา worker-specific fields ออกจาก Account/User เช่น field ประเภท:

```text
nationality
work_start_date
shirt_type
shirt_number
shift_no
shift_start_time
shift_end_time
master_worker_id
master_updated_at
synced_at
```

หรือ field worker-specific อื่นที่พบใน schema ปัจจุบัน

แต่ก่อนลบให้ค้น usage ทั้ง repository ก่อน

หาก field ใดใช้เฉพาะ Worker ให้ย้ายไป `MasterWorker`

---

# 3. สร้าง Model `MasterWorker`

ใช้ field ตาม Master ให้มากที่สุด ไม่ต้อง rename เป็นชื่อของระบบเดิมโดยไม่จำเป็น

ข้อมูลที่ต้องการเก็บมีดังนี้:

```text
LaborId
LaborCode

Prefix
Name
FullName

LaborStatus
Status
WorkCode

Nationality
Telephone
WorkStartDate

LaborColor
LaborCoat
CoatNo

TimeWork
TimeIn
TimeOut

Picture

UpdateDate
```

ไม่ต้องสร้าง field:

```text
Active
```

เพราะให้ใช้:

```text
Status
```

เป็นตัวบอก active/inactive โดยตรง

ตัวอย่าง:

```text
Status = 1
```

หมายถึง Worker ยัง Active

ส่วน:

```text
WorkCode
```

ให้เก็บแยกตามข้อมูล Master เดิม ห้ามเอา `WorkCode` ไปใช้แทน `Status`

---

# 4. Naming

สำหรับ Prisma field ให้ใช้ naming convention ของ project ปัจจุบัน

ถ้า project ใช้ camelCase ใน Prisma และ map database เป็น snake_case ให้ทำตาม convention เดิม เช่น:

```prisma
model MasterWorker {
  id Int @id @default(autoincrement())

  laborId   Int
  laborCode String

  prefix   String?
  name     String?
  fullName String?

  laborStatus String?
  status      Int?
  workCode    Int?

  nationality  String?
  telephone    String?
  workStartDate DateTime?

  laborColor String?
  laborCoat  String?
  coatNo     String?

  timeWork String?
  timeIn   ...
  timeOut  ...

  picture Bytes?

  updateDate DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("master_worker")
}
```

ตัวอย่างนี้เป็น guideline เท่านั้น

ให้เลือก datatype จากข้อมูลจริงใน `Worker(1).csv` และ convention ของ project

---

# 5. Primary / Unique Key

`id` ให้เป็น internal database primary key ของเรา

เช่น:

```prisma
id Int @id @default(autoincrement())
```

ส่วน Master identifier ให้เก็บ:

```text
LaborId
```

และควร unique เพราะใช้ identify record จาก Master

```text
LaborCode
```

ก็ควรตรวจข้อมูลก่อนว่า unique หลัง deduplicate หรือไม่

ถ้าข้อมูลยืนยันว่า unique ให้ใส่ unique constraint

หลักในการ Sync ต้องใช้ `LaborId` เป็น identifier หลัก

เช่น concept:

```ts
where: {
  laborId: master.LaborId
}
```

ไม่ใช้ CoatNo หรือ LaborCoat เป็น identifier ของ Worker

---

# 6. `Name` และ `FullName` ต้องเก็บแยกกัน

ห้าม merge สอง field นี้

จาก Master ข้อมูลสองตัวนี้มีความหมายไม่เหมือนกัน เช่น:

```text
Name     = SAVOEURT NHEAN
FullName = นายเวิร์ท เนียนสวอน
```

ดังนั้น:

```text
Name     -> name
FullName -> fullName
```

เก็บทั้งคู่

---

# 7. `LaborColor`

ของเดิมในระบบอาจใช้:

```text
shirt_type
```

เลิกใช้ชื่อดังกล่าว

เปลี่ยนมาใช้ชื่อที่ตรงกับ Master:

```text
LaborColor
```

Prisma:

```text
laborColor
```

Database column ถ้า project ใช้ snake_case:

```text
labor_color
```

และให้เก็บ value ตาม Master ตรง ๆ

เช่น:

```text
NAVY
```

ไม่ต้อง normalize เป็น:

```text
Navy
```

---

# 8. `LaborCoat` และ `CoatNo`

เก็บแยกทั้งคู่

ตัวอย่าง:

```text
LaborCoat = N0118
CoatNo    = 118
```

อย่า generate `LaborCode` จาก `LaborColor`, `LaborCoat` หรือ `CoatNo`

Master เป็น source of truth ของ:

```text
LaborCode
```

ดังนั้นห้ามใช้ worker-code generator เดิมกับ MasterWorker

ถ้ามี function เช่น:

```text
buildWorkerCode()
generateWorkerCode()
```

ที่ถูกใช้สำหรับ Worker เดิม ให้ตรวจสอบและลบ/ปรับ usage ที่ไม่จำเป็น

---

# 9. `Status`

ใช้ field:

```text
Status
```

จาก Master โดยตรง

แนวคิด:

```text
Status = 1 -> Active
Status = 0 -> Inactive
```

ไม่ต้องสร้าง:

```text
active
isActive
```

ซ้ำอีกตัว หากไม่จำเป็น

ทุก logic ที่ต้องตรวจว่า Worker ใช้งานได้หรือไม่ ให้เปลี่ยนมาอ่านจาก:

```text
MasterWorker.status
```

แทน status ของ Account/User เดิม

---

# 10. `LaborStatus`

`LaborStatus` เป็นคนละ field กับ `Status`

ให้เก็บ raw value ตาม Master เช่น:

```text
Working
Resign
```

แต่ business logic active หลักให้ใช้:

```text
Status
```

ตาม requirement ล่าสุด

อย่า derive Status ใหม่จาก LaborStatus ถ้า CSV มี Status มาอยู่แล้ว

---

# 11. `WorkCode`

เก็บ:

```text
WorkCode
```

แยกต่างหาก

ยังไม่ต้องผูก business logic กับมัน

ห้ามถือว่า:

```text
WorkCode = 1
```

แปลว่า Active

Active ให้ดูจาก:

```text
Status
```

เท่านั้น

WorkCode เก็บไว้เพื่อรองรับ requirement ในอนาคต

---

# 12. `Picture`

ให้ใช้ชื่อ:

```text
Picture
```

ตาม Master

ไม่ใช้:

```text
image_url
avatar
profile_image
```

สำหรับ MasterWorker

ถ้าข้อมูลต้นทางเป็น binary / hexadecimal representation ของรูป ให้เลือก datatype ใน PostgreSQL/Prisma ที่เหมาะสม

prefer:

```prisma
picture Bytes?
```

หากข้อมูลสามารถ convert เป็น binary ที่สมบูรณ์ได้

Frontend จะเป็นผู้เอาข้อมูลจาก API ไปสร้าง Base64/Data URL สำหรับแสดงรูป

Backend ไม่ต้อง upload รูปไป storage และไม่ต้องสร้าง image URL

อย่างไรก็ตามให้ตรวจไฟล์ CSV จริงก่อน import

ถ้า value เป็น hex เช่น:

```text
0xFFD8FFE0...
```

ให้ convert hex เป็น bytes ก่อน insert

แต่หากข้อมูลใน CSV ถูก truncate หรือไม่ใช่ binary ที่สมบูรณ์:

* ห้ามทำ seed crash
* ให้ `Picture = null` สำหรับ record นั้น
* comment อธิบายเหตุผลไว้ใน seed
* อย่าสร้าง binary ปลอมขึ้นมาเอง

---

# 13. `UpdateDate`

ต้องมี:

```text
UpdateDate
```

ใน `MasterWorker`

วัตถุประสงค์คือใช้จำว่า record ฝั่งเรา sync Master version ไหนมาแล้ว เพื่อเอาไว้ compare กับ Master DB ตอนทำ update/sync ในอนาคต

ตัวอย่าง concept:

```ts
if (master.UpdateDate > local.updateDate) {
  // update local MasterWorker
}
```

ดังนั้น `UpdateDate` ใน MasterWorker หมายถึง:

> UpdateDate ล่าสุดจาก Master ที่เราเคย sync

ไม่ใช่ตัวเดียวกับ Prisma:

```text
updatedAt
```

ควรมีทั้งคู่

```text
updateDate
updatedAt
```

โดย:

```text
updateDate
= วันที่เปลี่ยนข้อมูลจาก Master

updatedAt
= วันที่ record ใน database ของเราถูก update
```

สำหรับ CSV ถ้าเจอค่า invalid เช่น:

```text
###############
```

หรือ parse ไม่ได้ ให้:

```text
updateDate = null
```

อย่าสร้างวันที่เดาเอง

---

# 14. Field ที่ไม่ต้องเอามา

ไม่ต้องสร้างใน `MasterWorker`:

```text
LaborCardId
IssuedDate
ExpiredDate

Market
ReferMarket

DaysOfWeek
```

และไม่ต้อง seed ข้อมูลเหล่านี้

รวมถึง field HR อื่นที่ไม่อยู่ในรายการ required fields ด้านบน เช่น:

```text
Address
Province
District
Subdistrict
PostCode

BirthDate
DateOfBirth
Age
Race
MaritalStatus
Religion
Weight
Height

BankCode
BankName
BankAccountName
BankAccountNo

ReferName
ReferTel
ReferShop
ReferShopAll

RegisterDate
ResignDate

CreateBy
UpdateBy

PicDefault
```

ถ้าไม่ได้ถูกใช้โดย requirement อื่นของระบบ ให้ไม่ต้องนำเข้า MasterWorker

---

# 15. Seed จาก `Worker(1).csv`

สร้าง seed ใหม่สำหรับ:

```text
MasterWorker
```

โดยใช้:

```text
Worker(1).csv
```

ให้ตรวจโครงสร้างไฟล์จริงก่อน implement parser

ไฟล์นี้เป็น export จาก Master DB และไม่ได้เป็น CSV ธรรมดาที่ header อยู่บรรทัดแรกแบบตรง ๆ

โครงสร้างช่วงต้นมีลักษณะ:

```text
[LMSDB].[dbo].[LaborMaster]
LaborId,LaborCode,...
58,CG000085,...
```

ดังนั้นต้องหา actual header row ให้ถูกต้อง

อย่า hard-code ว่า row แรกคือ header โดยไม่ตรวจ

---

# 16. CSV มีข้อมูลจากมากกว่า 1 ชุดที่ถูก Join มา

ใน `Worker(1).csv` มี field บางตัวซ้ำ เช่น:

```text
LaborCode
CreateDate
UpdateDate
```

เพราะไฟล์ export รวมข้อมูล LaborMaster กับข้อมูลอีกส่วนหนึ่งเข้าด้วยกัน

ให้ map field ตามนี้

จากส่วน `LaborMaster` ด้านซ้าย ให้เอา:

```text
LaborId
LaborCode
LaborStatus
Prefix
Name
WorkStartDate
Telephone
Nationality
LaborColor
LaborCoat
CoatNo
TimeWork
TimeIn
TimeOut
```

ส่วนข้อมูลด้านขวาที่ join มา ให้ใช้:

```text
Status
FullName
WorkCode
Picture
```

สำหรับ:

```text
UpdateDate
```

ให้ใช้ `UpdateDate` ของ LaborMaster เป็นหลักสำหรับ MasterWorker sync

อย่าเผลอใช้ `UpdateDate` ของข้อมูล Card/record ด้านขวา

---

# 17. ต้อง Deduplicate ก่อน Seed

CSV มี worker ซ้ำได้ เพราะ Worker คนเดียวอาจมีข้อมูล Card มากกว่า 1 record

แต่เราไม่เก็บ:

```text
LaborCardId
```

ดังนั้น MasterWorker ต้องเป็น:

```text
1 LaborId = 1 MasterWorker
```

ก่อน insert ให้ deduplicate ด้วย:

```text
LaborId
```

เป็นหลัก

fallback:

```text
LaborCode
```

เฉพาะกรณีจำเป็น

ห้ามสร้าง Worker ซ้ำเพียงเพราะมีหลาย LaborCardId

ถ้ามีหลาย row สำหรับ LaborId เดียวกัน:

1. รวมข้อมูลของ Worker ให้เหลือ record เดียว
2. เลือกข้อมูล Master Worker ที่เหมาะสม
3. สำหรับ field ด้านขวา เช่น `Status`, `FullName`, `WorkCode`, `Picture` ให้เลือกค่าที่ไม่เป็น null และตรงกับ LaborCode ของ Worker
4. ห้ามใช้ LaborCardId เป็น identity
5. Seed ต้อง deterministic รันซ้ำแล้วได้ผลเหมือนเดิม

---

# 18. Seed ต้องใช้ Upsert

ห้ามใช้ create อย่างเดียว

ให้ใช้:

```ts
prisma.masterWorker.upsert(...)
```

โดย preferably ใช้:

```text
LaborId
```

เป็น unique key

เพื่อให้:

```bash
npx prisma db seed
```

สามารถรันซ้ำได้โดยไม่ duplicate

---

# 19. Relation ของ Worker ในระบบ

ค้นหาทั้ง project ว่าปัจจุบันมี relation ที่ชี้ Worker ผ่าน Account/User ที่ไหนบ้าง เช่น:

```text
assignments
worker assignments
assignment history
worker status
worker queue
break state
job worker
attendance/check-in
QR check-in
worker history
```

ถ้า relation เหล่านี้หมายถึง Worker จริง ให้เปลี่ยน foreign key ให้ชี้:

```text
MasterWorker.id
```

แทน:

```text
Account.id
User.id
```

ตัวอย่าง concept:

จาก:

```prisma
workerId Int
worker   Account @relation(...)
```

เป็น:

```prisma
workerId Int
worker   MasterWorker @relation(...)
```

แต่ให้ดู schema จริงก่อนแก้

อย่าเปลี่ยน relation ที่หมายถึง Admin เช่น:

```text
createdBy
updatedBy
assignedBy
cancelledBy
adminId
```

relation เหล่านั้นยังควรชี้ Account/User ฝั่ง Admin ตามเดิม

ต้องแยกให้ชัดระหว่าง:

```text
workerId -> MasterWorker
adminId  -> Account/User
```

---

# 20. Worker Authentication

ตรวจสอบระบบปัจจุบันว่า Worker login ด้วย Account/User หรือไม่

หาก Worker login flow ปัจจุบันผูกกับ Account:

* refactor ให้สอดคล้องกับ architecture ใหม่
* `MasterWorker` คือ source ของข้อมูล Worker
* อย่า duplicate worker profile กลับไป Account เพียงเพื่อ compatibility

ถ้าจำเป็นต้องมี authentication identity แยกจาก MasterWorker จริง ๆ ให้แยก concern ชัดเจน และอธิบายก่อน implement

แต่ default architecture รอบนี้คือ:

```text
Account/User
└── Admin only

MasterWorker
└── Worker master data
```

อย่าสร้าง Account 1 record ต่อ MasterWorker แบบเดิม

---

# 21. Redis / Queue

Worker queue ใน Redis ต้องใช้ identifier ที่ stable

ตรวจสอบว่าปัจจุบัน queue เก็บ:

```text
accountId
userId
workerId
```

อะไรอยู่

หลัง refactor ให้ใช้:

```text
MasterWorker.id
```

หรือถ้าระบบเหมาะกับ external master identifier ให้ใช้:

```text
LaborId
```

แต่ต้องเลือกแบบเดียวให้ consistent ทั้งระบบ

Prefer internal relational ID:

```text
MasterWorker.id
```

และเก็บ `LaborId` สำหรับ Master sync

---

# 22. Clean Schema

หลังสร้าง MasterWorker แล้ว ให้ตรวจ schema ทั้งหมด

ลบ:

* worker table เก่าที่ซ้ำกับ MasterWorker
* profile table ที่มีไว้เฉพาะ Worker และไม่จำเป็นแล้ว
* worker schedule table ที่ถูกแทนด้วยข้อมูล MasterWorker ถ้าไม่มีเหตุผลอื่นต้องใช้
* worker-specific fields ใน Account
* relations เก่า
* indexes เก่าที่ไม่ถูกใช้
* enums ที่ไม่มี usage
* mapping/helper เก่า
* worker code generator ที่ไม่ถูกใช้
* legacy compatibility logic

แต่ **ห้ามลบ table ธุรกิจที่ยังจำเป็น** เช่น assignment/history/job เพียงเพราะมีคำว่า worker

ให้เปลี่ยน relation ของ table เหล่านั้นมาใช้ MasterWorker แทน

---

# 23. Migration

สร้าง Prisma migration สำหรับการเปลี่ยน schema

ชื่อ migration ให้สื่อความหมาย เช่น:

```text
refactor_worker_to_master_worker
```

หรือชื่อที่เหมาะสมกับ convention ของ project

ถ้า project นี้ยังเป็น development environment และ migration history เดิมมี legacy schema เยอะมาก ให้ตรวจ pattern ของ repository ก่อนว่าจะ:

* สร้าง migration ใหม่
* หรือ reset/rebuild schema

อย่าลบ migration history โดยพลการ

---

# 24. Seed Structure

ทำ seed ให้เป็น pattern เดียวกับ seed อื่นใน project

ตัวอย่าง:

```text
prisma/
  seeds/
    master-worker.seed.ts
```

และให้ main:

```text
prisma/seed.ts
```

เรียก:

```ts
await seedMasterWorkers();
```

รักษารูปแบบเดียวกับ:

```text
master-product
master-rate
master-market
```

ที่มีอยู่ใน project

---

# 25. CSV Location

อย่าให้ production application runtime dependency กับ CSV นี้

CSV ใช้เฉพาะ:

```text
development/test seed
```

เท่านั้น

หลัง seed แล้ว runtime code ต้องอ่านจาก PostgreSQL ผ่าน Prisma

ไม่อ่าน CSV ทุกครั้งที่ application start

---

# 26. Repository / Service

ถ้ามี Worker repository/service ปัจจุบันที่ query Account/User ให้เปลี่ยนมาใช้:

```ts
prisma.masterWorker
```

ตัวอย่าง:

```ts
findMasterWorkerById()
findMasterWorkerByLaborId()
findMasterWorkerByLaborCode()
findActiveMasterWorkers()
```

แต่ไม่จำเป็นต้องเปลี่ยนชื่อ public API `/workers` หาก frontend/API contract ยังต้องการชื่อ Worker

ภายใน database/domain ให้ใช้ MasterWorker

ภายนอก API ยังสามารถเป็น:

```text
/api/workers
```

ได้ตามเดิม

---

# 27. Status Query

เวลาหา Worker ที่ใช้งานได้ ให้ใช้:

```ts
where: {
  status: 1
}
```

ไม่ใช้:

```text
LaborStatus == "Working"
WorkCode == 1
Account.status
```

เว้นแต่ business rule อื่นกำหนดเพิ่มเติม

---

# 28. API Response

API ที่คืน worker สามารถ map จาก MasterWorker ได้ เช่น:

```json
{
  "LaborId": 58,
  "LaborCode": "CG000085",
  "Prefix": "นาย",
  "Name": "SAVOEURT NHEAN",
  "FullName": "นายเวิร์ท เนียนสวอน",
  "LaborStatus": "Working",
  "Status": 1,
  "WorkCode": 1,
  "Nationality": "Cambodia",
  "Telephone": "0973310585",
  "WorkStartDate": "2025-02-21",
  "LaborColor": "NAVY",
  "LaborCoat": "N0118",
  "CoatNo": "118",
  "TimeWork": "Morning",
  "TimeIn": "06:00",
  "TimeOut": "18:00",
  "Picture": "...",
  "UpdateDate": null
}
```

ให้รักษา API contract ปัจจุบันเท่าที่จำเป็น แต่ไม่ต้องรักษา legacy fields ที่เราเลิกใช้ เช่น:

```text
shirt_type
shirt_number
```

ถ้าไม่มี requirement frontend จริง

---

# 29. Picture API serialization

ถ้า Prisma เก็บ:

```prisma
picture Bytes?
```

อย่าส่ง Node Buffer object ออก JSON ตรง ๆ เช่น:

```json
{
  "type": "Buffer",
  "data": [...]
}
```

ให้ mapper แปลงเป็น Base64 string ก่อน response

เช่น concept:

```ts
Picture: worker.picture
  ? Buffer.from(worker.picture).toString("base64")
  : null
```

Frontend จะเป็นคนสร้าง:

```ts
data:image/...;base64,...
```

เอง

Backend ไม่ต้องใส่ Data URL prefix ถ้า contract จะส่ง raw base64

---

# 30. Date / Time

ตรวจข้อมูลจริงก่อนเลือก datatype

`WorkStartDate`

ให้ parse วันที่จาก CSV อย่างถูกต้อง

`TimeIn` / `TimeOut`

ข้อมูล Master มี datetime ที่มีวันที่ประกอบ แต่สิ่งที่ worker scheduling ใช้จริงคือเวลา

ถ้า project ปัจจุบันใช้:

```text
HH:mm
```

ให้ normalize เป็น:

```text
06:00
18:00
```

และเก็บ datatype ให้เหมาะกับระบบเดิม

อย่าผูก business logic กับ dummy date เช่น:

```text
2026-01-01
2026-12-01
```

ถ้าวันที่ดังกล่าวไม่มีความหมายด้าน business

---

# 31. สิ่งที่ไม่ต้องทำ

ไม่ต้อง:

* ทำ Swagger/OpenAPI
* เพิ่ม table สำหรับ LaborCard
* เพิ่ม Market relation จาก CSV
* เพิ่ม DaysOfWeek
* เพิ่ม payroll/bank information
* เพิ่ม address
* เพิ่ม employee HR profile
* upload Picture ไป cloud/storage
* generate LaborCode
* generate LaborCoat
* derive Status จาก WorkCode
* เก็บ Worker ซ้ำใน Account
* ทำ compatibility layer สำหรับ schema เก่าที่ไม่มีใครใช้

---

# 32. Tests

หลังแก้ให้ update test ที่ได้รับผลกระทบ

อย่างน้อยตรวจ:

### MasterWorker Seed

* CSV parser อ่าน header ถูก
* deduplicate worker ถูก
* 1 LaborId มี MasterWorker เดียว
* seed รันซ้ำไม่ duplicate
* Status ถูกเก็บ
* WorkCode ถูกเก็บแยก
* Name/FullName ไม่ถูก merge
* LaborColor/LaborCoat ถูกเก็บ
* invalid UpdateDate ไม่ทำ seed fail
* invalid/truncated Picture ไม่ทำ seed fail

### Worker Logic

* active worker query ใช้ `Status = 1`
* assignment relation ชี้ MasterWorker
* worker queue ใช้ MasterWorker identifier
* Admin account ยังทำงานได้
* Admin authentication ไม่พัง

---

# 33. Validation หลังแก้

รันอย่างน้อย:

```bash
npx prisma format
npx prisma validate
npx prisma generate
```

จากนั้น migration/seed ตาม workflow ของ project

และรัน:

```bash
npm test
```

หรือ test command จริงที่ระบุใน `package.json`

รวมถึง:

```bash
npm run build
```

ถ้ามี

แก้ TypeScript errors ที่เกิดจาก schema refactor ให้หมด

---

# 34. Clean Code

งานนี้เป็น refactor จริง ไม่ใช่แค่เพิ่ม MasterWorker แล้วปล่อยของเก่าไว้

หลังแก้:

* ไม่มี Worker data duplicate ระหว่าง Account กับ MasterWorker
* ไม่มี dead worker fields ใน Account
* ไม่มี repository เก่าที่ยัง query Account เพื่อหา Worker
* ไม่มี unused mapper
* ไม่มี unused types
* ไม่มี unused schema
* ไม่มี unused relation
* ไม่มี legacy code ที่ถูกแทนแล้ว
* ไม่มี comment ที่อธิบาย behavior เก่า
* ไม่มี TODO ที่สามารถแก้ได้ใน scope นี้

รักษา architecture ของ project:

```text
routes
→ controllers
→ services
→ repositories
→ Prisma
```

อย่า query Prisma โดยตรงใน controller หาก project ใช้ repository pattern อยู่แล้ว

---

# 35. ข้อควรระวัง

อย่าทำ destructive change กับ:

* Admin
* authentication
* permissions
* roles
* assignment history
* job history

โดยไม่ตรวจ dependency ก่อน

หลักคือ:

```text
Admin identity
→ Account/User

Worker identity
→ MasterWorker
```

ถ้ามี table ที่มีทั้ง Admin FK และ Worker FK ต้องแยก relation ให้ถูก

ตัวอย่าง:

```text
assignedById
→ Account/Admin

workerId
→ MasterWorker
```

---

# 36. Output ที่ต้องการจากงานนี้

เมื่อทำเสร็จ ให้สรุปให้ผมเป็นหัวข้อ:

1. `Schema Changes`
2. `Tables Removed`
3. `Fields Removed from Account/User`
4. `MasterWorker Fields`
5. `Relations Migrated to MasterWorker`
6. `Seed Implementation`
7. `CSV Deduplication Strategy`
8. `Picture Handling`
9. `Status / WorkCode Logic`
10. `Files Changed`
11. `Migration Created`
12. `Tests Updated`
13. `Validation Results`
14. `Remaining Risks`

พร้อมแจ้งจำนวน Worker ที่:

```text
CSV rows
Deduplicated workers
Status = 1
Status != 1
Picture imported
Picture skipped/null
Invalid UpdateDate
```

จากไฟล์ `Worker(1).csv` จริง

---

## สำคัญ

อย่าเริ่มจากการเพิ่ม field อย่างเดียว

ให้มองงานนี้เป็นการเปลี่ยน architecture จาก:

```text
Account/User
├── Admin
└── Worker
```

เป็น:

```text
Account/User
└── Admin

MasterWorker
└── Worker Master Data
```

แล้ว refactor relation และ code ที่เกี่ยวข้องให้สอดคล้องกันทั้งหมด

ใช้ข้อมูลจาก `Worker.csv` จริงเป็น source สำหรับ seed และ **เอาเฉพาะ field ที่ระบุใน prompt นี้เท่านั้น**

หากเจอ schema/table เก่าที่ไม่จำเป็นหลัง refactor ให้ลบออกได้ แต่ต้องค้น references ทั้ง project ก่อนทุกครั้ง เพื่อไม่ให้ assignment, queue, history หรือ Admin flow พัง