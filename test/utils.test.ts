import assert from "node:assert/strict";
import { before, test } from "node:test";

import type ApiErrorClass from "../src/utils/api-error";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_LOGIN_CHALLENGE_SECRET = "test-login-challenge-secret";
process.env.REFRESH_TOKEN_HASH_SECRET = "test-refresh-hash-secret";

let ApiError: typeof ApiErrorClass;
let jwt: typeof import("../src/utils/jwt");
let password: typeof import("../src/utils/password");
let refreshTokenHash: typeof import("../src/utils/refresh-token-hash");
let shift: typeof import("../src/utils/shift");
let authConfig: typeof import("../src/config/auth.config");
let schemas: typeof import("../src/validation/schemas");

before(async () => {
  const apiErrorModule = await import("../src/utils/api-error");

  ApiError = apiErrorModule.default;
  jwt = await import("../src/utils/jwt");
  password = await import("../src/utils/password");
  refreshTokenHash = await import("../src/utils/refresh-token-hash");
  shift = await import("../src/utils/shift");
  authConfig = await import("../src/config/auth.config");
  schemas = await import("../src/validation/schemas");
});

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
      role: "user",
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

test("login body schema allows device fields to be omitted", () => {
  const loginBody = schemas.loginBodySchema.parse({
    username: "admin",
    password: "Admin@123456",
    client_type: "admin_web",
  });

  assert.equal(loginBody.username, "admin");
  assert.equal(loginBody.client_type, "admin_web");
  assert.equal(loginBody.device_id, undefined);
  assert.equal(loginBody.device_name, undefined);
});

test("login body schema rejects unknown client type", () => {
  assert.throws(() =>
    schemas.loginBodySchema.parse({
      username: "admin",
      password: "Admin@123456",
      client_type: "unknown_client",
    })
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
  assert.equal(updateBody.profile?.worker_code, undefined);
});

test("shift utility calculates shifts from start time", () => {
  const morningShift = shift.calculateShiftName("06:00");
  const nightShift = shift.calculateShiftName("17:00");

  assert.equal(shift.calculateShiftName("08:00"), morningShift);
  assert.equal(shift.calculateShiftName("16:59"), morningShift);
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
    shift.isDateInWorkSchedule(morningSchedule, new Date(2026, 6, 7, 8, 30)),
    true
  );
  assert.equal(
    shift.isDateInWorkSchedule(morningSchedule, new Date(2026, 6, 7, 17, 0)),
    false
  );
  assert.equal(
    shift.isDateInWorkSchedule(nightSchedule, new Date(2026, 6, 8, 2, 0)),
    true
  );
  assert.equal(
    shift.isDateInWorkSchedule(nightSchedule, new Date(2026, 6, 8, 7, 0)),
    false
  );
});
