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
  super_admin: [...ADMIN_PERMISSIONS],
  admin: [...ADMIN_PERMISSIONS],
  supervisor: [...SEED_OPERATION_PERMISSIONS],
};

async function main(): Promise<void> {
  const admin = await prisma.account.upsert({
    where: {
      username: SEED_ADMIN.username,
    },
    update: {
      permissionLevel: "super_admin",
    },
    create: {
      username: SEED_ADMIN.username,
      passwordHash: await hashPassword(SEED_ADMIN.password),
      role: "admin",
      status: "active",
      fullName: "System Admin",
      position: "Administrator",
      permissionLevel: "super_admin",
    },
  });

  const supervisor = await prisma.account.upsert({
    where: {
      username: "supervisor",
    },
    update: {
      permissionLevel: "supervisor",
    },
    create: {
      username: "supervisor",
      passwordHash: await hashPassword("Supervisor@123456"),
      role: "admin",
      status: "active",
      fullName: "Mock Supervisor",
      position: "Supervisor",
      permissionLevel: "supervisor",
      createdBy: admin.id,
    },
  });

  const worker = await prisma.account.upsert({
    where: {
      username: "0812345678",
    },
    update: {},
    create: {
      username: "0812345678",
      passwordHash: await hashPassword("Worker@123456"),
      role: "user",
      status: "active",
      fullName: "Mock Worker One",
      createdBy: supervisor.id,
    },
  });

  await prisma.userProfile.upsert({
    where: {
      accountId: worker.id,
    },
    update: {},
    create: {
      accountId: worker.id,
      workerCode: "W001",
      imageUrl: null,
      nationality: "Myanmar",
      nationalityCode: "MM",
      nationalityName: "Myanmar",
      workStartDate: "2026-07-06",
      phone: "0812345678",
      shirtType: "Navy",
      shirtNumber: "1",
    },
  });

  const currentSchedule = await prisma.userWorkSchedule.findFirst({
    where: {
      accountId: worker.id,
      isCurrent: true,
    },
  });

  if (currentSchedule) {
    await prisma.userWorkSchedule.update({
      where: {
        id: currentSchedule.id,
      },
      data: {
        workDate: "2026-07-06",
        shiftStartTime: "08:00",
        shiftEndTime: "17:00",
        isCurrent: true,
        updatedBy: admin.id,
      },
    });
  } else {
    await prisma.userWorkSchedule.create({
      data: {
        accountId: worker.id,
        workDate: "2026-07-06",
        shiftStartTime: "08:00",
        shiftEndTime: "17:00",
        isCurrent: true,
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    });
  }

  await prisma.userWorkSchedule.deleteMany({
    where: {
      accountId: worker.id,
      isCurrent: false,
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

  for (const account of [admin, supervisor]) {
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
  console.log("Seed supervisor account ready: supervisor");
  console.log("Seed worker account ready: 0812345678");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await closePrisma();
  });
