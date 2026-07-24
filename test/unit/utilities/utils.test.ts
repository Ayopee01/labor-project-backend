import assert from "node:assert/strict";
import { before, test } from "node:test";

import type ApiErrorClass from "../../../src/utils/api-error";

/* -------------------------------------- Test Env -------------------------------------- */

// Config secret สำหรับทดสอบ JWT และ refresh token hash โดยไม่พึ่ง .env จริง
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_LOGIN_CHALLENGE_SECRET = "test-login-challenge-secret";
process.env.REFRESH_TOKEN_HASH_SECRET = "test-refresh-hash-secret";

/* -------------------------------------- Test Modules -------------------------------------- */

// Module ใต้ test ที่ import ใน before เพื่อให้ env ถูกตั้งค่าก่อนโหลดไฟล์จริง
let ApiError: typeof ApiErrorClass;
let jwt: typeof import("../../../src/utils/jwt");
let password: typeof import("../../../src/utils/password");
let refreshTokenHash: typeof import("../../../src/utils/refresh-token-hash");
let shift: typeof import("../../../src/utils/shift");
let authConfig: typeof import("../../../src/config/auth.config");
let schemas: typeof import("../../../src/validation/schemas");

// Function โหลด utility/config/schema ที่ต้องใช้ใน test หลังตั้งค่า env แล้ว
before(async () => {
  const apiErrorModule = await import("../../../src/utils/api-error");

  ApiError = apiErrorModule.default;
  jwt = await import("../../../src/utils/jwt");
  password = await import("../../../src/utils/password");
  refreshTokenHash = await import("../../../src/utils/refresh-token-hash");
  shift = await import("../../../src/utils/shift");
  authConfig = await import("../../../src/config/auth.config");
  schemas = await import("../../../src/validation/schemas");
});

/* -------------------------------------- JWT Tests -------------------------------------- */

// Test sign/verify JWT แต่ละประเภทว่าคืน token_type ถูกต้อง
// Test ตรวจว่า utility JWT สร้างและ verify token แต่ละชนิดได้ถูก token_type
test("jwt utilities sign and verify token types", () => {
  // Step Arrange สร้าง access, refresh และ login challenge token
  const accessToken = jwt.signAccessToken(
    {
      account_id: 1,
      role: "admin",
      session_id: 2,
    },
    { expiresIn: "1m" }
  );
  const refreshJwt = jwt.signRefreshToken(
    {
      account_id: 1,
      session_id: 2,
    },
    { expiresIn: "1m" }
  );
  const challengeToken = jwt.signLoginChallengeToken(
    {
      account_id: 1,
      role: "worker",
      old_session_id: 2,
      new_device_id: "browser-device-id",
    },
    { expiresIn: "1m" }
  );

  // Step Assert verify token แต่ละประเภทแล้วได้ token_type ตรงตามชนิด
  assert.equal(jwt.verifyAccessToken(accessToken).token_type, "access");
  assert.equal(jwt.verifyRefreshToken(refreshJwt).token_type, "refresh");
  assert.equal(
    jwt.verifyLoginChallengeToken(challengeToken).token_type,
    "login_challenge"
  );
});

// Test ป้องกันการนำ token ผิดชนิดไปใช้ผิด flow
// Test ตรวจว่า utility JWT ไม่ยอมให้เอา token ไปใช้ผิด flow
test("jwt utilities reject wrong token type", () => {
  // Step Arrange สร้าง access token
  const accessToken = jwt.signAccessToken(
    {
      account_id: 1,
      role: "admin",
      session_id: 2,
    },
    { expiresIn: "1m" }
  );

  // Step Assert เอา access token ไป verify เป็น refresh token ต้องโดน reject
  assert.throws(
    () => jwt.verifyRefreshToken(accessToken),
    (error) => error instanceof ApiError && error.code === "INVALID_REFRESH_TOKEN"
  );
});

/* -------------------------------------- Password/Hash Tests -------------------------------------- */

// Test hash password และ verify password ถูก/ผิด
// Test ตรวจว่า password utility hash แล้ว verify password ถูก/ผิดได้ตามจริง
test("password utilities hash and verify passwords", async () => {
  // Step Act hash password ด้วย utility จริง
  const passwordHash = await password.hashPassword("Admin@123456");

  // Step Assert password ที่ถูกต้องต้องผ่าน และ password ผิดต้องไม่ผ่าน
  assert.equal(await password.verifyPassword("Admin@123456", passwordHash), true);
  assert.equal(await password.verifyPassword("wrong-password", passwordHash), false);
});

// Test refresh token hash ว่า compare แบบปลอดภัยแล้วแยก token ถูก/ผิดได้
// Test ตรวจว่า refresh token hash ใช้ compare ได้ถูกต้องและ reject token ที่ไม่ตรงกัน
test("refresh token hash utilities hash and compare safely", () => {
  // Step Arrange สร้าง hash จาก refresh token ตัวอย่าง
  const hash = refreshTokenHash.hashRefreshToken("refresh-token");

  // Step Assert hash เดียวกันต้องตรงกัน และ token อื่นต้องไม่ตรงกัน
  assert.equal(refreshTokenHash.refreshTokenHashesMatch(hash, hash), true);
  assert.equal(
    refreshTokenHash.refreshTokenHashesMatch(
      hash,
      refreshTokenHash.hashRefreshToken("other-token")
    ),
    false
  );
});

/* -------------------------------------- Auth Config Tests -------------------------------------- */

// Test parser ค่า expires_in ของ access token จาก env หลายรูปแบบ
// Test ตรวจว่า auth config แปลงค่า expiresIn เป็นจำนวนวินาทีได้ถูกต้อง
test("auth config parses access token expiry units", () => {
  // Step Arrange เก็บค่า env เดิมไว้เพื่อคืนค่าหลัง test
  const previousExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN;

  try {
    // Step Assert ตรวจหน่วยนาที ชั่วโมง วินาที และ fallback เมื่อ format ไม่ถูกต้อง
    process.env.JWT_ACCESS_EXPIRES_IN = "15m";
    assert.equal(authConfig.getAccessTokenExpiresInSeconds(), 900);

    process.env.JWT_ACCESS_EXPIRES_IN = "2h";
    assert.equal(authConfig.getAccessTokenExpiresInSeconds(), 7200);

    process.env.JWT_ACCESS_EXPIRES_IN = "30";
    assert.equal(authConfig.getAccessTokenExpiresInSeconds(), 30);

    process.env.JWT_ACCESS_EXPIRES_IN = "invalid";
    assert.equal(
      authConfig.getAccessTokenExpiresInSeconds(),
      authConfig.AUTH_DEFAULTS.accessTokenExpiresInSeconds
    );
  } finally {
    // Step Cleanup คืนค่า JWT_ACCESS_EXPIRES_IN กลับเหมือนก่อนเริ่ม test
    if (previousExpiresIn === undefined) {
      delete process.env.JWT_ACCESS_EXPIRES_IN;
    } else {
      process.env.JWT_ACCESS_EXPIRES_IN = previousExpiresIn;
    }
  }
});

/* -------------------------------------- Schema Tests -------------------------------------- */

// Test login schema ไม่บังคับ device fields ในชั้น schema
// Test ตรวจ schema login ว่ายังไม่บังคับ device field เพราะ service จะตัดสินจาก role
test("login body schema allows device fields to be omitted", () => {
  // Step Act parse body login พื้นฐาน
  const loginBody = schemas.loginBodySchema.parse({
    username: "admin",
    password: "Admin@123456",
  });

  // Step Assert ตรวจ field ที่ parse ได้และ device fields เป็น undefined
  assert.equal(loginBody.username, "admin");
  assert.equal(loginBody.device_id, undefined);
  assert.equal(loginBody.device_name, undefined);
});

// Test update user schema รองรับ partial profile update
// Test ตรวจ schema update worker ว่ารับ partial update ของ profile และ schedule ได้
test("gate vehicle job schema accepts optional dispatch_now flag", () => {
  const gateBody = schemas.gateVehicleJobBodySchema.parse({
    ticketNo: "TKT-DISPATCH-NOW",
    marketCode: "MARKET-A",
    marketName: "Market A",
    boothCode: "BOOTH-A01",
    boothName: "Vendor A",
    licensePlate: "ABC-1234",
    vehicleTypeCode: "PICKUP",
    vehicleTypeName: "Pickup truck",
    productCode: "PRODUCT-DISPATCH-NOW",
    productName: "Cabbage",
    packageCode: "CRATE",
    packageName: "crate",
    quantity: 10,
    dispatch_now: true,
  });

  assert.equal(gateBody.dispatch_now, true);
  assert.equal(gateBody.vehicleTypeName, "Pickup truck");
  assert.equal("workersRequired" in gateBody, false);
});

test("shift utility builds a stable break counter key for one shift instance", () => {
  const schedule = {
    id: 1,
    account_id: 1,
    shift_no: 1,
    work_date: "2026-07-13",
    shift_start_time: "18:00",
    shift_end_time: "08:00",
    is_current: true,
    created_by: null,
    updated_by: null,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
  };

  assert.equal(
    shift.buildWorkScheduleShiftInstanceKey(
      schedule,
      new Date("2026-07-13T19:00:00+07:00")
    ),
    "2026-07-13:18:00-08:00"
  );
  assert.equal(
    shift.buildWorkScheduleShiftInstanceKey(
      schedule,
      new Date("2026-07-14T02:00:00+07:00")
    ),
    "2026-07-13:18:00-08:00"
  );
  assert.equal(
    shift.buildWorkScheduleShiftInstanceKey(
      schedule,
      new Date("2026-07-14T19:00:00+07:00")
    ),
    "2026-07-14:18:00-08:00"
  );
});

test("update user schema allows partial profile updates", () => {
  // Step Act parse body ที่ส่งมาแค่ image_url ใน profile
  const updateBody = schemas.updateUserBodySchema.parse({
    profile: {
      image_url: "https://example.com/new-worker-image.jpg",
    },
  });

  // Step Assert field ที่ส่งมาถูกเก็บไว้ และ field ที่ไม่ได้ส่งเป็น undefined
  assert.equal(
    updateBody.profile?.image_url,
    "https://example.com/new-worker-image.jpg"
  );
  assert.equal("worker_code" in (updateBody.profile ?? {}), false);
});

/* -------------------------------------- Shift Tests -------------------------------------- */

// Test คำนวณชื่อกะจากเวลาเริ่มงาน
// Test ตรวจ function shift ว่าคำนวณชื่อกะจากเวลาเริ่มงานได้ถูกต้อง
test("shift utility calculates shifts from start time", () => {
  // Step Arrange คำนวณชื่อกะเช้าและกะกลางคืนจาก boundary หลัก
  const morningShift = shift.calculateShiftName("06:00");
  const nightShift = shift.calculateShiftName("17:00");

  // Step Assert เวลาในช่วงเช้าคืนชื่อกะเดียวกัน และ 18:00 เป็นกะกลางคืน
  assert.equal(shift.calculateShiftName("08:00"), morningShift);
  assert.equal(shift.calculateShiftName("16:59"), morningShift);
  assert.equal(shift.calculateShiftName("18:00"), nightShift);
  assert.notEqual(morningShift, nightShift);
});

// Test reject เวลาเริ่มกะที่ format ผิด
// Test ตรวจ function shift ว่า throw ApiError เมื่อเวลาไม่ตรง format ที่รองรับ
test("shift utility rejects invalid shift time", () => {
  // Step Assert เวลา 25:00 ไม่ถูกต้องและต้องคืน INVALID_SHIFT_TIME
  assert.throws(
    () => shift.calculateShiftName("25:00"),
    (error) => error instanceof ApiError && error.code === "INVALID_SHIFT_TIME"
  );
});

// Test ตรวจเวลาปัจจุบันว่ายังอยู่ใน work schedule หรือไม่ ทั้งกะปกติและกะข้ามวัน
// Test ตรวจ function shift ว่าบอกได้ว่าเวลาปัจจุบันอยู่ในช่วงกะหรือไม่ รวมกะข้ามวัน
test("shift utility checks whether a time is inside work schedule", () => {
  // Step Arrange สร้าง schedule กะกลางวันและกะกลางคืนข้ามวัน
  const morningSchedule = {
    id: 1,
    account_id: 1,
    shift_no: 1,
    work_date: "2026-07-07",
    shift_start_time: "08:00",
    shift_end_time: "17:00",
    is_current: true,
    created_by: null,
    updated_by: null,
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
  };
  const nightSchedule = {
    ...morningSchedule,
    shift_start_time: "18:00",
    shift_end_time: "06:00",
  };

  // Step Assert กะกลางวันอยู่ในช่วง 08:00-17:00 แบบไม่รวมเวลาจบ
  assert.equal(
    shift.isTimeInWorkSchedule(
      morningSchedule,
      new Date("2026-07-13T08:30:00+07:00")
    ),
    true
  );
  assert.equal(
    shift.isTimeInWorkSchedule(
      morningSchedule,
      new Date("2026-07-13T17:00:00+07:00")
    ),
    false
  );
  // Step Assert กะกลางคืนรองรับช่วงเวลาหลังเที่ยงคืนของวันถัดไป
  assert.equal(
    shift.isTimeInWorkSchedule(
      nightSchedule,
      new Date("2026-07-14T02:00:00+07:00")
    ),
    true
  );
  assert.equal(
    shift.isTimeInWorkSchedule(
      nightSchedule,
      new Date("2026-07-14T07:00:00+07:00")
    ),
    false
  );

  const waitInfo = shift.buildShiftWaitInfo(
    morningSchedule,
    new Date("2026-07-13T05:32:00+07:00")
  );

  assert.equal(waitInfo.shift.name, "กะเช้า");
  assert.equal(waitInfo.shift.start_time, "08:00");
  assert.equal(waitInfo.shift.end_time, "17:00");
  assert.equal(waitInfo.remaining_time, "2 ชม. 28 นาที");
});
