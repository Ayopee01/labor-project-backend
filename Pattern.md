# Project Coding Pattern

เอกสารนี้ใช้เป็นแนวทางให้ AI Agent หรือผู้พัฒนาคนถัดไปเขียนโค้ดให้เข้ากับ pattern ของ project นี้

## วิธีวิเคราะห์ก่อนแก้โค้ด

1. อ่านไฟล์ที่เกี่ยวข้องก่อนแก้เสมอ อย่าแก้จากชื่อไฟล์อย่างเดียว
2. ดูว่า logic ควรอยู่ layer ไหนก่อนเพิ่มโค้ดใหม่
3. ถ้ามี helper เดิมใน project ให้ใช้ของเดิมก่อนสร้างใหม่
4. ถ้า type ใช้แค่ใน schema และไม่มีใคร import ไม่ต้องแยก type เพิ่ม
5. ถ้า config ใช้หลายไฟล์หรืออ่านจาก `.env` ให้แยกไว้ใน `src/config`
6. ถ้าค่า constant ใช้เฉพาะไฟล์เดียว ให้วางไว้ในไฟล์นั้นได้
7. หลังแก้ logic หรือ type ให้รัน `npm run build`
8. ถ้าแก้ behavior ให้รัน `npm test`

## โครงสร้าง Layer

### routes

Route มีหน้าที่รับ request และส่งต่อให้ service เท่านั้น

- ไม่ใส่ business logic ใน route
- ไม่ query database ใน route
- ใช้ `try/catch` แล้วส่ง error ไปที่ `next(error)`
- ส่ง `req.body`, `req.query`, `req.params`, `req.auth` ไปให้ service ตามจำเป็น

ตัวอย่าง pattern ที่ OK:

```ts
router.post("/", async (req, res, next) => {
  try {
    const result = await userService.createUser(req.body, req.auth);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
```

### services

Service เป็น logic หลักของ feature

- validate input ผ่าน `parseWithSchema` หรือ parser เฉพาะทาง
- ตรวจ business rule เช่น duplicate username, inactive account, force login
- เรียก repository เพื่ออ่าน/เขียน database
- รวม response shape ที่ API ต้องส่งกลับ
- ใช้ `withTransaction` เมื่อมีการเขียนหลาย table ใน workflow เดียว
- โยน error ด้วย `ApiError`

ตัวอย่าง comment:

```ts
// Function สร้าง user พร้อม profile และ schedule เริ่มต้น
export async function createUser(body: unknown, auth?: AccessTokenPayload) {
  ...
}
```

### repositories

Repository เป็นชั้นติดต่อ database ผ่าน Prisma

- 1 repository ควรอิง table หลักหรือกลุ่ม query ของ table นั้น
- ไม่ใส่ business rule ของ API ใน repository
- รับ `connection?: DbConnection` เพื่อใช้ได้ทั้ง Prisma client ปกติและ transaction client
- แปลง Prisma record เป็น DTO ผ่าน mapper
- ถ้าต้องสร้าง Prisma `where` หรือ `data` ที่ซับซ้อน ให้แยก helper ในไฟล์เดียวกัน

ตัวอย่าง pattern ที่ OK:

```ts
// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}
```

### mapper

Mapper มีหน้าที่แปลง field จาก Prisma model เป็น DTO ที่ project ใช้

- แปลง camelCase จาก Prisma เป็น snake_case ใน DTO
- ตัดข้อมูล sensitive เช่น `password_hash` ด้วย `sanitizeAccount`
- ไม่ใส่ query หรือ business logic

### validation

Validation ใช้ Zod เป็นหลัก

- `schemas.ts` เก็บ schema และ format พื้นฐาน
- `parser.ts` เก็บ function parse และแปลง error เป็น `ApiError`
- ถ้ามี error code เฉพาะ เช่น `INVALID_SHIFT_TIME` ให้แยก parser เฉพาะทางได้
- ไม่จำเป็นต้องสร้าง type จาก `z.infer` ถ้าไม่มีการ import ใช้งานจริง

ตัวอย่าง comment:

```ts
// Schema body สำหรับเข้าสู่ระบบด้วย username/password และข้อมูลอุปกรณ์
export const loginBodySchema = z.object({
  ...
});
```

### types

Types แยกตาม route/feature ที่เรียกใช้จริง

- `auth.type.ts` สำหรับ token, session, auth response
- `users.type.ts` สำหรับ user DTO, profile DTO, work schedule DTO, user response
- `common.type.ts` สำหรับ type กลาง เช่น DB connection, error response, parser option
- `express.d.ts` สำหรับ extend `Express.Request`
- ไม่สร้าง type เผื่อไว้ถ้ายังไม่มีคนใช้
- Type body/query ที่ Zod parse แล้วใช้เฉพาะใน service ไม่จำเป็นต้องแยกออกมา

ตัวอย่าง comment:

```ts
// Type ส่วน Response ของ API auth login / confirm-force-login
export interface AuthSuccessResponse {
  ...
}
```

### utils

Utils ใช้สำหรับ logic ที่ reusable หรือแยกแล้วช่วยให้อ่านง่ายขึ้น

- ใช้กับ logic ที่มีโอกาสเรียกซ้ำ เช่น JWT, password, refresh token hash, shift
- ถ้า helper ใช้แค่ไฟล์เดียวและทำให้ตาม code ยากขึ้น ให้เก็บไว้ในไฟล์นั้น
- Utils ไม่ควรรู้ business flow ของ service มากเกินไป

### config

Config ใช้กับค่าที่เป็น configuration จริง

- ค่า default ที่ใช้หลายไฟล์ ให้วางใน `src/config`
- ค่าที่อ่านจาก `.env` และใช้หลายจุด ให้วางใน `src/config`
- ค่าเฉพาะไฟล์เดียว เช่น role filter ใน repository วางในไฟล์นั้นได้

ตัวอย่าง comment:

```ts
// Config ค่า default ของ token และ session ในระบบ auth
export const AUTH_DEFAULTS = {
  ...
} as const;
```

## Import Pattern

ใช้ import แบบเรียงกลุ่มจากบนลงล่าง:

1. library
2. config/db/repository/service
3. types
4. validation
5. utils

ใน project นี้นิยมเขียน import type แบบบรรทัดเดียวถ้าไม่ยาวเกินไป:

```ts
import type { AccessTokenPayload, AccountResponse, AuthSuccessResponse } from "../types/auth.type";
```

ถ้าบรรทัดยาวมากจนอ่านยาก ให้ยอมขึ้นบรรทัดใหม่ได้ แต่ควรรักษาความอ่านง่ายก่อน

## Section Comment Pattern

ใช้ section divider เมื่อไฟล์มีหลายกลุ่มหน้าที่:

```ts
/* -------------------------------------- Config -------------------------------------- */

/* -------------------------------------- Functions -------------------------------------- */
```

ชื่อ section ที่ใช้บ่อย:

- `Config`
- `Formats`
- `Common Schemas`
- `Auth Schemas`
- `User Schemas`
- `Query Schemas`
- `Token Schemas`
- `Error Helpers`
- `Parsers`
- `Functions`

## Comment Pattern

Comment ของ project นี้ใช้ภาษาไทยแบบสั้น ชัด และขึ้นต้นด้วยชนิดของสิ่งนั้น

### Function

ใช้เมื่อประกาศ function หรือ exported function:

```ts
// Function ตรวจสอบ refresh token และออก token ชุดใหม่
export async function refresh(body: unknown) {
  ...
}
```

### Config

ใช้กับ constant/config ที่ควบคุม behavior:

```ts
// Config status เริ่มต้นของ account
const DEFAULT_ACCOUNT_STATUS = "active";
```

### Format

ใช้กับ Zod format หรือ schema ชิ้นเล็กที่เป็น reusable format:

```ts
// Format เวลาแบบ HH:mm เท่านั้น ไม่รับวินาทีหรือ millisecond
const timeString = trimmedString.pipe(...);
```

### Schema

ใช้กับ Zod schema ที่ validate request หรือ payload:

```ts
// Schema body สำหรับ reset password ของ worker
export const resetPasswordBodySchema = z.object({
  ...
});
```

### Type

ใช้กับ type/interface โดยระบุว่าเป็นส่วนไหน:

```ts
// Type ส่วน DTO ของ table accounts
export interface AccountDto {
  ...
}

// Type ส่วน Response ของ API user detail
export interface UserDetailResponse {
  ...
}

// Type ส่วน Repository input สำหรับสร้าง account
export interface AccountCreateInput {
  ...
}
```

### Import Comment

ใช้ได้เมื่อไฟล์นั้นมี import หลายกลุ่ม แต่ไม่จำเป็นต้องละเอียดเกินไป:

```ts
// import Library
import express from "express";

// import Types
import type { DbConnection } from "../types/common.type";
```

## Naming Pattern

### Function

- `find...` ใช้กับ query ที่อาจไม่เจอ และ return `null`
- `list...` ใช้กับรายการหลาย record
- `count...` ใช้นับจำนวน
- `create...` ใช้สร้าง record
- `update...` ใช้แก้ไข record
- `revoke...` ใช้ยกเลิก session/token
- `build...` ใช้สร้าง object/response/data/where condition
- `format...` ใช้จัดรูป response หรือ DTO เสริม
- `assert...` ใช้ตรวจ rule และ throw error ถ้าไม่ผ่าน
- `require...` ใช้ดึงข้อมูลที่ต้องมี ถ้าไม่มีให้ throw error
- `parse...` ใช้แปลงและ validate input

### Type

- `...Dto` สำหรับข้อมูลที่แปลงจาก database record
- `...Input` สำหรับ input ที่ส่งเข้า repository หรือ helper
- `...Response` สำหรับ response ที่ API/service ส่งกลับ
- `...Payload` สำหรับ JWT payload
- `...Config` สำหรับ config object
- `...Filters` สำหรับ filter/pagination ที่ repository ใช้

## Error Pattern

ใช้ `ApiError` ทุกครั้งที่เป็น error ที่ต้องส่งกลับ API

```ts
throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
```

รูปแบบ error code:

- ใช้ UPPER_SNAKE_CASE
- message ภาษาอังกฤษ สั้นและชัด
- validation error ใช้ `VALIDATION_ERROR`
- auth token error ใช้ code เฉพาะ เช่น `INVALID_TOKEN`, `INVALID_REFRESH_TOKEN`

## Transaction Pattern

ใช้ `withTransaction` เมื่อ workflow เขียนหลาย table หรือหลาย operation ที่ต้องสำเร็จ/ล้มเหลวพร้อมกัน

ตัวอย่าง:

```ts
return withTransaction(async (transaction) => {
  const account = await accountRepository.create(input, transaction);
  await profileRepository.create(profileInput, transaction);

  return formatUserDetail(account, transaction);
});
```

Repository ทุกตัวที่เกี่ยวกับ database ควรรับ `connection?: DbConnection` เพื่อรองรับ transaction

## Response Pattern

Response ของ service ควรสร้างให้ชัดใน service ไม่กระจายใน route

- list response ใช้ `{ data, pagination }`
- detail response ใช้ object ตาม type เช่น `UserDetailResponse`
- action response ใช้ `{ message: "..." }`
- auth response ใช้ token + account/profile/schedule ตาม `AuthSuccessResponse`

## สิ่งที่ควรหลีกเลี่ยง

- อย่าใส่ business logic ใน route
- อย่า query Prisma จาก service โดยตรงถ้ามี repository อยู่แล้ว
- อย่าสร้าง type เผื่อไว้ถ้ายังไม่มีการ import ใช้งาน
- อย่าแยก helper ไป utils ถ้าใช้แค่ไฟล์เดียวและทำให้ตาม code ยากขึ้น
- อย่า duplicate config หลายที่ ถ้าค่าเดียวกันถูกใช้หลายไฟล์
- อย่าใช้ `any` ถ้าใช้ `unknown`, DTO, หรือ Prisma type ได้
- อย่า return password hash ใน response

## Checklist ก่อนจบงาน

1. ชื่อไฟล์ตรงกับ feature หรือ layer หรือไม่
2. Logic อยู่ถูก layer หรือไม่
3. Comment ใช้รูปแบบ `Function`, `Config`, `Schema`, `Type ส่วน...` หรือไม่
4. Type ที่เพิ่มมีการใช้งานจริงหรือไม่
5. Import ที่เพิ่มจำเป็นจริงหรือไม่
6. ถ้าแก้ TypeScript logic ให้รัน `npm run build`
7. ถ้าแก้ behavior ให้รัน `npm test`

