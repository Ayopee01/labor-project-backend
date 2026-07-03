import assert from "node:assert/strict";
import { test } from "node:test";

const runDbTests = process.env.RUN_DB_TESTS === "1";

test(
  "services create user, login, refresh, and read current schedule",
  {
    skip: runDbTests
      ? false
      : "Set RUN_DB_TESTS=1 and run PostgreSQL migration before this test.",
  },
  async () => {
    process.env.JWT_ACCESS_SECRET = "service-test-access-secret";
    process.env.JWT_REFRESH_SECRET = "service-test-refresh-secret";
    process.env.JWT_LOGIN_CHALLENGE_SECRET =
      "service-test-login-challenge-secret";
    process.env.REFRESH_TOKEN_HASH_SECRET = "service-test-refresh-hash-secret";

    const authService = await import("../src/services/auth.service");
    const userService = await import("../src/services/user.service");
    const { closePrisma } = await import("../src/db/prisma");
    const suffix = Date.now().toString(36);
    const username = `service-user-${suffix}`;
    const workerCode = `SVC-${suffix}`;

    try {
      const created = await userService.createUser(
        {
          username,
          password: "123456",
          full_name: "Service Worker",
          profile: {
            worker_code: workerCode,
            nationality_code: "TH",
            nationality_name: "Thai",
            work_start_date: "2024-07-15",
            phone: "081-234-5678",
          },
          work_schedule: {
            work_date: "2026-07-01",
            shift_start_time: "06:00",
            shift_end_time: "18:00",
          },
        },
        {
          account_id: 1,
          role: "admin",
          session_id: 1,
          token_type: "access",
        }
      );

      assert.equal(created.account.username, username);
      assert.equal(
        (created.account as { password_hash?: string }).password_hash,
        undefined
      );
      assert.equal(created.profile?.worker_code, workerCode);
      assert.ok(created.current_work_schedule?.shift_name);

      const login = await authService.login({
        username,
        password: "123456",
        device_id: `browser-device-${suffix}`,
        device_name: "Chrome on Windows",
      });

      assert.equal(login.token_type, "Bearer");
      assert.ok(login.access_token);
      assert.ok(login.refresh_token);

      const refreshed = await authService.refresh({
        refresh_token: login.refresh_token,
      });

      assert.ok(refreshed.access_token);
      assert.ok(refreshed.refresh_token);

      const list = await userService.listUsers({
        page: 1,
        limit: 20,
        search: workerCode,
      });

      assert.equal(list.pagination.total, 1);

      const schedule = await userService.getCurrentWorkSchedule(
        created.account.id
      );

      assert.ok(schedule.data?.shift_name);
    } finally {
      await closePrisma();
    }
  }
);
