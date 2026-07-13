import dotenv from "dotenv";
import { closePrisma, getPrisma } from "../src/db/prisma";
import { ADMIN_PERMISSIONS } from "../src/config/permission.config";
import type { AdminPermission, AdminPermissionLevel } from "../src/config/permission.config";
import { hashPassword } from "../src/utils/password";

dotenv.config({ quiet: true });

const prisma = getPrisma();
const SEED_ADMIN = {
  username: "admin",
  password: "Admin@123456",
  email: "admin@simmummuang.local",
  phone: "081-000-0001",
};

const SEED_RUNTIME_SETTINGS = {
  driver_session_ttl_hours: 24,
  worker_accept_deadline_seconds: 60,
  worker_scan_deadline_minutes: 15,
  worker_break_duration_minutes: 15,
  worker_break_limit: 5,
  worker_break_count_ttl_hours: 48,
  worker_presence_stale_seconds: 90,
} as const;

const SEED_OPERATION_PERMISSIONS = ADMIN_PERMISSIONS.filter(
  (permission) =>
    permission !== "settings:update" && permission !== "permissions:update"
);

const SEED_ROLE_PERMISSION_TEMPLATES: Record<AdminPermissionLevel, AdminPermission[]> = {
  owner: [...ADMIN_PERMISSIONS],
  manager: [...ADMIN_PERMISSIONS],
  supervisor: [...SEED_OPERATION_PERMISSIONS],
};

// Function เตรียมข้อมูลเริ่มต้นของ admin, supervisor, worker, settings และ permission
async function main(): Promise<void> {
  const admin = await prisma.account.upsert({
    where: {
      username: SEED_ADMIN.username,
    },
    update: {
      email: SEED_ADMIN.email,
      phone: SEED_ADMIN.phone,
      permissionLevel: "owner",
    },
    create: {
      username: SEED_ADMIN.username,
      passwordHash: await hashPassword(SEED_ADMIN.password),
      role: "admin",
      status: "active",
      fullName: "System Admin",
      position: "Administrator",
      email: SEED_ADMIN.email,
      phone: SEED_ADMIN.phone,
      permissionLevel: "owner",
    },
  });

  for (const [key, value] of Object.entries(SEED_RUNTIME_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: {
        key,
      },
      update: {
        value: String(value),
        updatedBy: admin.id,
      },
      create: {
        key,
        value: String(value),
        updatedBy: admin.id,
      },
    });
  }

  for (const account of [admin]) {
    const permissions =
      account.permissionLevel && account.permissionLevel in SEED_ROLE_PERMISSION_TEMPLATES
        ? SEED_ROLE_PERMISSION_TEMPLATES[account.permissionLevel as AdminPermissionLevel]
        : [];

    await prisma.accountPermission.deleteMany({
      where: {
        accountId: account.id,
      },
    });

    if (permissions.length > 0) {
      await prisma.accountPermission.createMany({
        data: permissions.map((permission) => ({
          accountId: account.id,
          permission,
        })),
        skipDuplicates: true,
      });
    }
  }

  console.log(`Seed admin account ready: ${SEED_ADMIN.username}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await closePrisma();
  });
