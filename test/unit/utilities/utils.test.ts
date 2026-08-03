import assert from "node:assert/strict";
import { before, test } from "node:test";

import type ApiErrorClass from "../../../src/utils/api-error";

/* -------------------------------------- Test Env -------------------------------------- */

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_LOGIN_CHALLENGE_SECRET = "test-login-challenge-secret";
process.env.REFRESH_TOKEN_HASH_SECRET = "test-refresh-hash-secret";

/* -------------------------------------- Test Modules -------------------------------------- */

let ApiError: typeof ApiErrorClass;
let jwt: typeof import("../../../src/utils/jwt");
let password: typeof import("../../../src/utils/password");
let refreshTokenHash: typeof import("../../../src/utils/refresh-token-hash");
let shift: typeof import("../../../src/utils/shift");
let authConfig: typeof import("../../../src/config/auth.config");
let schemas: typeof import("../../../src/validation/schemas");
let apiCase: typeof import("../../../src/middlewares/api-case.middleware");
let uploadMiddleware: typeof import("../../../src/middlewares/upload.middleware");

before(async () => {
  const apiErrorModule = await import("../../../src/utils/api-error");

  ApiError = apiErrorModule.default;
  jwt = await import("../../../src/utils/jwt");
  password = await import("../../../src/utils/password");
  refreshTokenHash = await import("../../../src/utils/refresh-token-hash");
  shift = await import("../../../src/utils/shift");
  authConfig = await import("../../../src/config/auth.config");
  schemas = await import("../../../src/validation/schemas");
  apiCase = await import("../../../src/middlewares/api-case.middleware");
  uploadMiddleware = await import("../../../src/middlewares/upload.middleware");
});

/* -------------------------------------- JWT Tests -------------------------------------- */

test("jwt utilities sign and verify token types", () => {
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

  assert.equal(jwt.verifyAccessToken(accessToken).token_type, "access");
  assert.equal(jwt.verifyRefreshToken(refreshJwt).token_type, "refresh");
  assert.equal(
    jwt.verifyLoginChallengeToken(challengeToken).token_type,
    "login_challenge"
  );
});

test("jwt utilities reject wrong token type", () => {
  const accessToken = jwt.signAccessToken(
    {
      account_id: 1,
      role: "admin",
      session_id: 2,
    },
    { expiresIn: "1m" }
  );

  assert.throws(
    () => jwt.verifyRefreshToken(accessToken),
    (error) => error instanceof ApiError && error.code === "INVALID_REFRESH_TOKEN"
  );
});

/* -------------------------------------- Password/Hash Tests -------------------------------------- */

test("password utilities hash and verify passwords", async () => {
  const passwordHash = await password.hashPassword("Admin@123456");

  assert.equal(await password.verifyPassword("Admin@123456", passwordHash), true);
  assert.equal(await password.verifyPassword("wrong-password", passwordHash), false);
});

test("refresh token hash utilities hash and compare safely", () => {
  const hash = refreshTokenHash.hashRefreshToken("refresh-token");

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

test("auth config parses access token expiry units", () => {
  const previousExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN;

  try {
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
    if (previousExpiresIn === undefined) {
      delete process.env.JWT_ACCESS_EXPIRES_IN;
    } else {
      process.env.JWT_ACCESS_EXPIRES_IN = previousExpiresIn;
    }
  }
});

/* -------------------------------------- Schema Tests -------------------------------------- */

test("login body schema allows device fields to be omitted", () => {
  const loginBody = schemas.loginBodySchema.parse({
    username: "admin",
    password: "Admin@123456",
  });

  assert.equal(loginBody.username, "admin");
  assert.equal(loginBody.device_id, undefined);
  assert.equal(loginBody.device_name, undefined);
});

test("gate vehicle job schema accepts PascalCase Gate body", () => {
  const gateBody = schemas.gateVehicleJobBodySchema.parse({
    TicketNo: "TKT-DISPATCH-NOW",
    TicketCreatedAt: "2026-07-23T14:30:00+07:00",
    BoothCount: 2,
    MarketCode: "MARKET-A",
    MarketName: "Market A",
    BoothCode: "BOOTH-A01",
    BoothName: "Vendor A",
    LicensePlate: "ABC-1234",
    VehicleTypeCode: "PICKUP",
    VehicleTypeName: "Pickup truck",
    ProductCode: "PRODUCT-DISPATCH-NOW",
    ProductName: "Cabbage",
    PackageCode: "CRATE",
    PackageName: "crate",
    Quantity: 10,
    Dispatch: true,
  });

  assert.equal(gateBody.Dispatch, true);
  assert.equal(gateBody.VehicleTypeName, "Pickup truck");
  assert.equal(gateBody.BoothCount, 2);
  assert.equal("workersRequired" in gateBody, false);
});

test("API case utilities normalize PascalCase request payloads", () => {
  const payload = apiCase.normalizeApiRequestPayload({
    DeviceId: "mobile-001",
    WorkerCodes: ["MN000012"],
    WorkerAcceptDeadlineSeconds: 60,
    Items: [
      {
        ProductCode: "PRODUCT-001",
        ConfirmedQuantity: 8,
      },
    ],
  });

  assert.deepEqual(payload, {
    device_id: "mobile-001",
    worker_codes: ["MN000012"],
    worker_accept_deadline_seconds: 60,
    items: [
      {
        productCode: "PRODUCT-001",
        confirmed_quantity: 8,
      },
    ],
  });
});

test("API case utilities transform response payloads to PascalCase", () => {
  const payload = apiCase.toPascalCasePayload({
    access_token: "access",
    worker_qr_token: "TKT-001",
    vehicle_job: {
      ticketNo: "TKT-001",
      latest_activity_at: "2026-07-24T10:00:00.000Z",
    },
  });

  assert.deepEqual(payload, {
    AccessToken: "access",
    WorkerQrToken: "TKT-001",
    VehicleJob: {
      TicketNo: "TKT-001",
      LatestActivityAt: "2026-07-24T10:00:00.000Z",
    },
  });
});

test("multipart worker body normalizes PascalCase shift number", () => {
  let nextCalled = false;
  const req: any = {
    is: (contentType: string) => contentType === "multipart/form-data",
    body: {
      FullName: "Worker One",
      Phone: "0812345678",
      Nationality: "Myanmar",
      ShirtType: "Navy",
      ShirtNumber: "12",
      WorkStartDate: "2026-07-03",
      ShiftNo: "1",
      Status: "active",
    },
  };

  uploadMiddleware.normalizeCreateUserMultipartBody(
    req as never,
    {} as never,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
  const parsed = schemas.createUserBodySchema.parse(req.body);
  assert.equal(parsed.shift_no, 1);
});

test("worker schemas accept shift number on create and time-only shifts on update", () => {
  const createBody = schemas.createUserBodySchema.parse({
    full_name: "Worker One",
    phone: "0812345678",
    nationality: "Myanmar",
    shirt_type: "Navy",
    shirt_number: "12",
    shift_no: 1,
  });
  const updateBody = schemas.updateUserBodySchema.parse({
    shift_start_time: "08:00",
    shift_end_time: "17:00",
  });

  assert.equal(createBody.shift_no, 1);
  assert.equal(createBody.work_start_date, undefined);
  assert.equal(updateBody.shift_start_time, "08:00");
  assert.equal(updateBody.shift_end_time, "17:00");
});

test("worker update schema rejects shift number changes", () => {
  assert.throws(() =>
    schemas.updateUserBodySchema.parse({
      shift_no: 2,
    })
  );
});

test("worker schemas reject date-time values for shifts", () => {
  assert.throws(() =>
    schemas.updateUserBodySchema.parse({
      shift_start_time: "2026-07-03T08:00:00+07:00",
      shift_end_time: "2026-07-03T17:00:00+07:00",
    })
  );
});

test("worker create schema rejects missing or invalid shift number", () => {
  assert.throws(() =>
    schemas.createUserBodySchema.parse({
      full_name: "Worker One",
      phone: "0812345678",
      nationality: "Myanmar",
      shirt_type: "Navy",
      shirt_number: "12",
      work_start_date: "2026-07-03",
    })
  );

  assert.throws(() =>
    schemas.createUserBodySchema.parse({
      full_name: "Worker One",
      phone: "0812345678",
      nationality: "Myanmar",
      shirt_type: "Navy",
      shirt_number: "12",
      shift_no: 3,
    })
  );
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
  const updateBody = schemas.updateUserBodySchema.parse({
    profile: {
      image_url: "https://example.com/new-worker-image.jpg",
    },
  });

  assert.equal(
    updateBody.profile?.image_url,
    "https://example.com/new-worker-image.jpg"
  );
  assert.equal("worker_code" in (updateBody.profile ?? {}), false);
});

/* -------------------------------------- Shift Tests -------------------------------------- */

test("shift utility calculates shifts from start time", () => {
  const morningShift = shift.calculateShiftName("06:00");
  const nightShift = shift.calculateShiftName("18:00");
  assert.equal(morningShift, "Morning shift");
  assert.equal(nightShift, "Evening shift");

  assert.equal(shift.calculateShiftName("08:00"), morningShift);
  assert.equal(shift.calculateShiftName("17:59"), morningShift);
  assert.equal(shift.calculateShiftName("18:00"), nightShift);
  assert.notEqual(morningShift, nightShift);
});

test("shift utility rejects invalid shift time", () => {
  assert.throws(
    () => shift.calculateShiftName("25:00"),
    (error) => error instanceof ApiError && error.code === "INVALID_SHIFT_TIME"
  );
});

test("shift utility checks whether a time is inside work schedule", () => {
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

  assert.equal(waitInfo.shift.name, "Morning shift");
  assert.equal(waitInfo.shift.start_time, "08:00");
  assert.equal(waitInfo.shift.end_time, "17:00");
  assert.equal(waitInfo.remaining_time, "2 hours 28 minutes");
});
