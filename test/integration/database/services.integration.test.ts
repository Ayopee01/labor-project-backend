import assert from "node:assert/strict";
import { test } from "node:test";

import { assertSafeTestDatabaseUrl } from "../../setup/test-env";

/* -------------------------------------- Config -------------------------------------- */

const runDbTests = process.env.RUN_DB_TESTS === "1";

/* -------------------------------------- Tests -------------------------------------- */

test(
  "services create user, login, refresh, and read current schedule",
  {
    skip: runDbTests
      ? false
      : "Set RUN_DB_TESTS=1 and run PostgreSQL migration before this test.",
  },
  async () => {
    assertSafeTestDatabaseUrl();

    process.env.JWT_ACCESS_SECRET = "service-test-access-secret";
    process.env.JWT_REFRESH_SECRET = "service-test-refresh-secret";
    process.env.JWT_LOGIN_CHALLENGE_SECRET =
      "service-test-login-challenge-secret";
    process.env.REFRESH_TOKEN_HASH_SECRET = "service-test-refresh-hash-secret";

    const authService = await import("../../../src/services/auth.service");
    const { accountRepository } = await import(
      "../../../src/repositories/admin-workers.repository"
    );
    const userService = await import("../../../src/services/admin-workers.service");
    const { closePrisma } = await import("../../../src/db/prisma");
    const { hashPassword, verifyPassword } = await import("../../../src/utils/password");
    const suffix = Date.now().toString(36);
    const phone = `service-phone-${suffix}`;
    const shirtNumber = "130";
    const workerCode = "MN000130";

    try {
      const created = await userService.createUser(
        {
          img: "https://example.com/worker.jpg",
          full_name: "Service Worker",
          phone,
          nationality: "Myanmar",
          shirt_type: "Navy",
          shirt_number: shirtNumber,
          work_start_date: "2024-07-15",
          status: "active",
          shift_no: 1,
        },
        {
          account_id: 1,
          role: "admin",
          session_id: 1,
          token_type: "access",
        }
      );

      assert.equal(created.message, "Worker created successfully.");
      const workerAccount = await accountRepository.findUserByIdentifier(workerCode);
      assert.ok(workerAccount);
      assert.equal(workerAccount.phone, phone);
      assert.equal(await verifyPassword(phone, workerAccount.password_hash), true);

      const admin = await accountRepository.create({
        username: `service-admin-${suffix}`,
        password_hash: await hashPassword("Admin@123456"),
        role: "admin",
        status: "active",
        full_name: "Service Admin",
        position: "Administrator",
        permission_level: "manager",
        created_by: 1,
      });

      const adminLogin = await authService.login({
        username: admin.username,
        password: "Admin@123456",
      });

      assert.equal(adminLogin.token_type, "Bearer");
      assert.ok(adminLogin.access_token);
      assert.ok(adminLogin.refresh_token);
      assert.equal((adminLogin as { account?: unknown }).account, undefined);
      assert.equal((adminLogin as { profile?: unknown }).profile, undefined);
      assert.equal(
        (adminLogin as { current_work_schedule?: unknown }).current_work_schedule,
        undefined
      );
      assert.equal(
        (adminLogin as { profile_card?: unknown }).profile_card,
        undefined
      );

      await assert.rejects(
        () =>
          authService.login({
            username: workerCode,
            password: phone,
          }),
        (error) =>
          Boolean(
            error &&
              typeof error === "object" &&
              (error as { code?: string }).code === "VALIDATION_ERROR"
          )
      );

      const login = await authService.login({
        username: workerCode,
        password: phone,
        device_id: `browser-device-${suffix}`,
        device_name: "Chrome on Windows",
      });

      assert.equal(login.token_type, "Bearer");
      assert.ok(login.access_token);
      assert.ok(login.refresh_token);
      assert.equal((login as { account?: unknown }).account, undefined);

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
      const createdUser = list.data[0];
      assert.equal(createdUser.worker_code, workerCode);
      assert.equal((createdUser as { id?: number }).id, undefined);
      assert.equal(
        (createdUser as { password_hash?: string }).password_hash,
        undefined
      );
      assert.equal(
        (createdUser as { username?: string }).username,
        undefined
      );
      assert.equal(createdUser.shirt_number, shirtNumber);
      assert.equal(createdUser.full_name, "Service Worker");
      assert.equal(createdUser.status, "active");
      assert.equal(createdUser.work_start_date, "2024-07-15");
      assert.equal((createdUser as { work_schedules?: unknown }).work_schedules, undefined);
      assert.equal(createdUser.work_schedule?.shift_no, 1);
      assert.equal(createdUser.work_schedule?.shift_start_time, "08:00");
      assert.equal(createdUser.work_schedule?.shift_end_time, "18:00");
      assert.ok(createdUser.work_schedule?.shift_name);
      assert.equal(
        (createdUser.work_schedule as { id?: number } | null)?.id,
        undefined
      );
      assert.equal(
        (createdUser.work_schedule as { account_id?: number } | null)?.account_id,
        undefined
      );
      assert.equal(
        (createdUser.work_schedule as { created_by?: number } | null)?.created_by,
        undefined
      );
      assert.equal(
        (createdUser.work_schedule as { updated_by?: number } | null)?.updated_by,
        undefined
      );
      assert.equal(
        (createdUser.work_schedule as { created_at?: string } | null)?.created_at,
        undefined
      );
      assert.equal(
        (createdUser.work_schedule as { updated_at?: string } | null)?.updated_at,
        undefined
      );
      assert.equal(
        (createdUser.work_schedule as { is_current?: boolean } | null)?.is_current,
        undefined
      );
      const updated = await userService.updateUser(
        workerCode,
        {
          status: "inactive",
          position: "Worker",
          shift_start_time: "18:00",
          shift_end_time: "06:00",
        },
        {
          account_id: 1,
          role: "admin",
          session_id: 1,
          token_type: "access",
        }
      );

      assert.equal(updated.status, "inactive");
      assert.equal(updated.worker_code, workerCode);
      assert.equal(updated.details.position, "Worker");
      assert.equal(updated.details.work_start_date, "2024-07-15");
      assert.equal((updated.details as { work_schedules?: unknown }).work_schedules, undefined);
      assert.equal(updated.details.shift_no, 2);
      assert.equal(updated.details.shift_start_time, "18:00");
      assert.equal(updated.details.shift_end_time, "06:00");
      assert.ok(updated.details.shift_name);
    } finally {
      await closePrisma();
    }
  }
);
