import assert from "node:assert/strict";
import { test } from "node:test";

import { assertSafeTestDatabaseUrl } from "../../setup/test-env";

/* -------------------------------------- Config -------------------------------------- */

// Config เปิด DB integration test เฉพาะตอนตั้ง RUN_DB_TESTS=1
const runDbTests = process.env.RUN_DB_TESTS === "1";

/* -------------------------------------- Tests -------------------------------------- */

// Test integration ของ service หลัก โดยใช้ DB จริงเพื่อเช็ก create worker, login, refresh และ schedule
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
    const { hashPassword } = await import("../../../src/utils/password");
    const suffix = Date.now().toString(36);
    const phone = `service-phone-${suffix}`;
    const shirtNumber = `SVC-${suffix}`;

    try {
      // Step Act สร้าง worker ผ่าน admin-workers service พร้อม profile และ work schedule
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

      // Step Assert ตรวจว่าสร้าง worker สำเร็จ
      assert.equal(created.message, "Worker created successfully.");

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
      assert.equal(adminLogin.account.role, "admin");
      assert.equal(adminLogin.profile, null);
      assert.equal(adminLogin.current_work_schedule, null);

      // Step Assert ตรวจว่า worker role login ต้องส่ง device_id/device_name
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

      // Step Act login ด้วย worker พร้อมข้อมูลอุปกรณ์
      const login = await authService.login({
        username: phone,
        password: "123456",
        device_id: `browser-device-${suffix}`,
        device_name: "Chrome on Windows",
      });

      // Step Assert ตรวจว่า worker login ได้ token ครบ
      assert.equal(login.token_type, "Bearer");
      assert.ok(login.access_token);
      assert.ok(login.refresh_token);

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
        search: shirtNumber,
      });

      // Step Assert ตรวจ response list ว่าซ่อน password และ map profile/schedule ถูกต้อง
      assert.equal(list.pagination.total, 1);
      const createdUser = list.data[0];
      assert.equal(createdUser.username, phone);
      assert.equal(
        (createdUser as { password_hash?: string }).password_hash,
        undefined
      );
      assert.equal(createdUser.profile?.worker_code, shirtNumber);
      assert.equal(
        createdUser.profile?.image_url,
        "https://example.com/worker.jpg"
      );
      assert.equal(createdUser.profile?.nationality, "Thai");
      assert.equal(createdUser.profile?.nationality_name, "Thai");
      assert.equal(createdUser.profile?.shirt_number, shirtNumber);
      assert.ok(createdUser.current_work_schedule?.shift_name);

      // Step Act แก้สถานะ worker และเปลี่ยน work schedule เป็นกะกลางคืน
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

      // Step Assert ตรวจว่า update account/schedule สำเร็จ และ session active ถูกเคลียร์
      assert.equal(updated.account.status, "inactive");
      assert.equal(updated.current_work_schedule?.work_date, "2026-07-02");
      assert.ok(updated.current_work_schedule?.shift_name);
      assert.equal(updated.active_session, null);
    } finally {
      // Step Cleanup ปิด Prisma connection หลังจบ integration test
      await closePrisma();
    }
  }
);
