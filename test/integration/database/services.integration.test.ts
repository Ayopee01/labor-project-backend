import assert from "node:assert/strict";
import { test } from "node:test";

import { assertSafeTestDatabaseUrl } from "../../setup/test-env";

/* -------------------------------------- Config -------------------------------------- */

// Config เปิด DB integration test เฉพาะตอนตั้ง RUN_DB_TESTS=1
const runDbTests = process.env.RUN_DB_TESTS === "1";

/* -------------------------------------- Tests -------------------------------------- */

// Test integration ของ service หลักโดยใช้ DB จริง เฉพาะตอนเปิด RUN_DB_TESTS=1 และ DATABASE_URL เป็น test DB
test(
  "services create user, login, refresh, and read current schedule",
  {
    skip: runDbTests
      ? false
      : "Set RUN_DB_TESTS=1 and run PostgreSQL migration before this test.",
  },
  async () => {
    assertSafeTestDatabaseUrl();

    // Step Arrange ตั้งค่า secret สำหรับ JWT และ refresh token hash ใน test
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
      // Step Act สร้าง worker ผ่าน admin-workers service พร้อม profile และ work schedule
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
          work_schedules: [
            {
              work_date: "2026-07-01",
              shift_start_time: "06:00",
              shift_end_time: "12:00",
            },
            {
              work_date: "2026-07-01",
              shift_start_time: "13:00",
              shift_end_time: "18:00",
            },
          ],
        },
        {
          account_id: 1,
          role: "admin",
          session_id: 1,
          token_type: "access",
        }
      );

      // Step Assert ตรวจว่าสร้าง worker สำเร็จ
      assert.equal(created.message, "Worker created successfully.");
      const workerAccount = await accountRepository.findUserByIdentifier(workerCode);
      assert.ok(workerAccount);
      assert.equal(workerAccount.phone, phone);
      assert.equal(await verifyPassword(phone, workerAccount.password_hash), true);

      // Step Arrange สร้าง admin account เพื่อทดสอบ login ฝั่ง Admin Web
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

      // Step Act login ด้วย admin account
      const adminLogin = await authService.login({
        username: admin.username,
        password: "Admin@123456",
      });

      // Step Assert ตรวจว่า admin login แล้วไม่มี profile/schedule แบบ worker
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

      // Step Assert ตรวจว่า worker role login ต้องส่ง device_id/device_name
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

      // Step Act login ด้วย worker พร้อมข้อมูลอุปกรณ์
      const login = await authService.login({
        username: workerCode,
        password: phone,
        device_id: `browser-device-${suffix}`,
        device_name: "Chrome on Windows",
      });

      // Step Assert ตรวจว่า worker login ได้ token ครบ
      assert.equal(login.token_type, "Bearer");
      assert.ok(login.access_token);
      assert.ok(login.refresh_token);
      assert.equal((login as { account?: unknown }).account, undefined);

      // Step Act ขอ token ชุดใหม่จาก refresh token
      const refreshed = await authService.refresh({
        refresh_token: login.refresh_token,
      });

      // Step Assert ตรวจว่า refresh ได้ access/refresh token ใหม่
      assert.ok(refreshed.access_token);
      assert.ok(refreshed.refresh_token);

      // Step Act ดึงรายการ worker ด้วย search เพื่อหา worker ที่เพิ่งสร้าง
      const list = await userService.listUsers({
        page: 1,
        limit: 20,
        search: workerCode,
      });

      // Step Assert ตรวจ response list ว่าซ่อน password และ map profile/schedule ถูกต้อง
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
      assert.equal(createdUser.work_schedules?.length, 2);
      assert.deepEqual(
        createdUser.work_schedules?.map((schedule) => ({
          work_date: schedule.work_date,
          shift_start_time: schedule.shift_start_time,
          shift_end_time: schedule.shift_end_time,
        })),
        [
          {
            work_date: "2026-07-01",
            shift_start_time: "06:00",
            shift_end_time: "12:00",
          },
          {
            work_date: "2026-07-01",
            shift_start_time: "13:00",
            shift_end_time: "18:00",
          },
        ]
      );
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
      // Step Act แก้สถานะ worker และเปลี่ยน work schedule เป็นกะกลางคืน
      const updated = await userService.updateUser(
        workerCode,
        {
          status: "inactive",
          position: "Worker",
          work_schedules: [
            {
              work_date: "2026-07-02",
              shift_start_time: "06:00",
              shift_end_time: "12:00",
            },
            {
              work_date: "2026-07-02",
              shift_start_time: "18:00",
              shift_end_time: "06:00",
            },
          ],
        },
        {
          account_id: 1,
          role: "admin",
          session_id: 1,
          token_type: "access",
        }
      );

      // Step Assert ตรวจว่า update account/schedule สำเร็จ และ session active ถูกเคลียร์
      assert.equal(updated.status, "inactive");
      assert.equal(updated.worker_code, workerCode);
      assert.equal(updated.details.position, "Worker");
      assert.equal(updated.details.work_schedules?.length, 2);
      assert.deepEqual(
        updated.details.work_schedules?.map((schedule) => ({
          work_date: schedule.work_date,
          shift_start_time: schedule.shift_start_time,
          shift_end_time: schedule.shift_end_time,
        })),
        [
          {
            work_date: "2026-07-02",
            shift_start_time: "06:00",
            shift_end_time: "12:00",
          },
          {
            work_date: "2026-07-02",
            shift_start_time: "18:00",
            shift_end_time: "06:00",
          },
        ]
      );
      assert.ok(updated.details.shift_name);
    } finally {
      // Step Cleanup ปิด Prisma connection หลังจบ integration test
      await closePrisma();
    }
  }
);
