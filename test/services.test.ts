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
    const accountRepository = await import("../src/repositories/account.repository");
    const userService = await import("../src/services/user.service");
    const { closePrisma } = await import("../src/db/prisma");
    const { hashPassword } = await import("../src/utils/password");
    const suffix = Date.now().toString(36);
    const phone = `service-phone-${suffix}`;
    const shirtNumber = `SVC-${suffix}`;

    try {
      const created = await userService.createUser(
        {
          password: "123456",
          img: "https://example.com/worker.jpg",
          full_name: "Service Worker",
          phone,
          nationality: "Thai",
          shirt_type: "Navy",
          shirt_number: shirtNumber,
          work_start_date: "2024-07-15",
          status: "active",
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

      assert.equal(created.message, "Worker created successfully.");

      const admin = await accountRepository.create({
        username: `service-admin-${suffix}`,
        password_hash: await hashPassword("Admin@123456"),
        role: "admin",
        status: "active",
        full_name: "Service Admin",
        position: "Administrator",
        permission_level: "admin",
        created_by: 1,
      });

      const adminLogin = await authService.login({
        username: admin.username,
        password: "Admin@123456",
      });

      assert.equal(adminLogin.account.role, "admin");
      assert.equal(adminLogin.profile, null);
      assert.equal(adminLogin.current_work_schedule, null);

      await assert.rejects(
        () =>
          authService.login({
            username: phone,
            password: "123456",
          }),
        (error) =>
          Boolean(
            error &&
              typeof error === "object" &&
              (error as { code?: string }).code === "VALIDATION_ERROR"
          )
      );

      const login = await authService.login({
        username: phone,
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
        search: shirtNumber,
      });

      assert.equal(list.pagination.total, 1);
      const createdUser = list.data[0];
      assert.equal(createdUser.username, phone);
      assert.equal(
        (createdUser as { password_hash?: string }).password_hash,
        undefined
      );
      assert.equal(createdUser.profile?.worker_code, shirtNumber);
      assert.equal(createdUser.profile?.image_url, "https://example.com/worker.jpg");
      assert.equal(createdUser.profile?.nationality, "Thai");
      assert.equal(createdUser.profile?.nationality_name, "Thai");
      assert.equal(createdUser.profile?.shirt_number, shirtNumber);
      assert.ok(createdUser.current_work_schedule?.shift_name);

      const updated = await userService.updateUser(
        createdUser.id,
        {
          status: "inactive",
          work_schedule: {
            work_date: "2026-07-02",
            shift_start_time: "18:00",
            shift_end_time: "06:00",
          },
        },
        {
          account_id: 1,
          role: "admin",
          session_id: 1,
          token_type: "access",
        }
      );

      assert.equal(updated.account.status, "inactive");
      assert.equal(updated.current_work_schedule?.work_date, "2026-07-02");
      assert.ok(updated.current_work_schedule?.shift_name);
      assert.equal(updated.active_session, null);
    } finally {
      await closePrisma();
    }
  }
);
