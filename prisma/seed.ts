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
  worker_accept_timeout_limit: 3,
  worker_scan_deadline_minutes: 15,
  worker_scan_warning_before_minutes: 2,
  worker_scan_team_remaining_minutes: 5,
  worker_break_duration_minutes: 15,
  worker_break_limit: 4,
  worker_break_count_ttl_hours: 48,
  worker_presence_stale_seconds: 90,
  vendor_confirm_timeout_hours: 24,
  vendor_reconfirm_timeout_hours: 4,
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

const SEED_MASTER_OWNER_STALLS = [
  {
    MarketCode: "1123",
    BoothCode: "B-018",
    BoothName: "Orange Booth 18",
    CardId: "1234567890123",
    CustomerTelephone: "0812220001",
    FirstName: "Orange",
    LastName: "Owner",
    Status: "Normal",
    LineUserID: "Umockvendororange0001",
  },
  {
    MarketCode: "1123",
    BoothCode: "B-019",
    BoothName: "Orange Booth 19",
    CardId: "1234567890123",
    CustomerTelephone: "0812220001",
    FirstName: "Orange",
    LastName: "Owner",
    Status: "Normal",
    LineUserID: "Umockvendororange0001",
  },
  {
    MarketCode: "1124",
    BoothCode: "B-020",
    BoothName: "Vegetable Booth 20",
    CardId: "9876543210987",
    CustomerTelephone: "0812220002",
    FirstName: "Vegetable",
    LastName: "Owner",
    Status: "Normal",
    LineUserID: "Umockvendorvegetable0001",
  },
  {
    MarketCode: "1114",
    BoothCode: "DC1/7",
    BoothName: "Mock Master Stall DC1/7",
    CardId: "1629900107538",
    CustomerTelephone: "0824022676",
    FirstName: "Mock",
    LastName: "Owner",
    Status: "Normal",
    LineUserID: "U6323c04e63cb111336b4de144003c132",
  },
] as const;

const SEED_MASTER_MEMBER_STALLS = [
  {
    OwnerLineUserID: "Umockvendororange0001",
    OwnerIDCard: "1234567890123",
    OwnerTelephone: "0812220001",
    OwnerCode: "CRS0001",
    OwnerName: "Orange Owner",
    MarketCode: "1123",
    MarketName: "Orange Market",
    MemberStallLineUserID: "Umockmemberorange0001",
    MemberStallIDCard: "2234567890123",
    MemberStallTelephone: "0813330001",
    MemberStallUserGroup: "member",
    MemberStallFirstName: "Orange",
    MemberStallLastName: "Member One",
    MemberStallStatusOnStall: "1",
  },
  {
    OwnerLineUserID: "Umockvendororange0001",
    OwnerIDCard: "1234567890123",
    OwnerTelephone: "0812220001",
    OwnerCode: "CRS0001",
    OwnerName: "Orange Owner",
    MarketCode: "1123",
    MarketName: "Orange Market",
    MemberStallLineUserID: "Umockmemberorange0002",
    MemberStallIDCard: "2234567890124",
    MemberStallTelephone: "0813330002",
    MemberStallUserGroup: "member",
    MemberStallFirstName: "Orange",
    MemberStallLastName: "Member Inactive",
    MemberStallStatusOnStall: "0",
  },
  {
    OwnerLineUserID: "Umockvendorvegetable0001",
    OwnerIDCard: "9876543210987",
    OwnerTelephone: "0812220002",
    OwnerCode: "CRS0002",
    OwnerName: "Vegetable Owner",
    MarketCode: "1124",
    MarketName: "Vegetable Market",
    MemberStallLineUserID: "Umockmembervegetable0001",
    MemberStallIDCard: "8876543210987",
    MemberStallTelephone: "0813330003",
    MemberStallUserGroup: "member",
    MemberStallFirstName: "Vegetable",
    MemberStallLastName: "Member One",
    MemberStallStatusOnStall: "1",
  },
  {
    OwnerLineUserID: "U6323c04e63cb111336b4de144003c132",
    OwnerIDCard: "1629900107538",
    OwnerTelephone: "0824022676",
    OwnerCode: "CRS1114",
    OwnerName: "Mock Owner DC1/7",
    MarketCode: "1114",
    MarketName: "Mock Market 1114",
    MemberStallLineUserID: "Umockmemberdc170001",
    MemberStallIDCard: "1809900300603",
    MemberStallTelephone: "0872687525",
    MemberStallUserGroup: "member",
    MemberStallFirstName: "Mock",
    MemberStallLastName: "Member DC1/7",
    MemberStallStatusOnStall: "1",
  },
] as const;

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

  for (const ownerStall of SEED_MASTER_OWNER_STALLS) {
    await prisma.masterOwnerStall.upsert({
      where: {
        marketCode_boothCode: {
          marketCode: ownerStall.MarketCode,
          boothCode: ownerStall.BoothCode,
        },
      },
      update: {
        boothName: ownerStall.BoothName,
        cardId: ownerStall.CardId,
        customerTelephone: ownerStall.CustomerTelephone,
        firstName: ownerStall.FirstName,
        lastName: ownerStall.LastName,
        ownerStatus: ownerStall.Status,
        lineUserId: ownerStall.LineUserID,
        status: ownerStall.Status === "Normal" ? "active" : "inactive",
        syncedAt: new Date(),
      },
      create: {
        marketCode: ownerStall.MarketCode,
        boothCode: ownerStall.BoothCode,
        boothName: ownerStall.BoothName,
        cardId: ownerStall.CardId,
        customerTelephone: ownerStall.CustomerTelephone,
        firstName: ownerStall.FirstName,
        lastName: ownerStall.LastName,
        ownerStatus: ownerStall.Status,
        lineUserId: ownerStall.LineUserID,
        status: ownerStall.Status === "Normal" ? "active" : "inactive",
        syncedAt: new Date(),
      },
    });

    if (ownerStall.LineUserID) {
      await prisma.gateTicket.updateMany({
        where: {
          boothCode: ownerStall.BoothCode,
          vendorLineId: null,
          marketJob: {
            marketCode: ownerStall.MarketCode,
          },
        },
        data: {
          vendorLineId: ownerStall.LineUserID,
        },
      });
    }
  }

  for (const memberStall of SEED_MASTER_MEMBER_STALLS) {
    await prisma.masterMemberStall.upsert({
      where: {
        marketCode_ownerIdCard_ownerLineUserId_memberStallLineUserId: {
          marketCode: memberStall.MarketCode,
          ownerIdCard: memberStall.OwnerIDCard,
          ownerLineUserId: memberStall.OwnerLineUserID,
          memberStallLineUserId: memberStall.MemberStallLineUserID,
        },
      },
      update: {
        ownerTelephone: memberStall.OwnerTelephone,
        ownerCode: memberStall.OwnerCode,
        ownerName: memberStall.OwnerName,
        marketName: memberStall.MarketName,
        memberStallIdCard: memberStall.MemberStallIDCard,
        memberStallTelephone: memberStall.MemberStallTelephone,
        memberStallUserGroup: memberStall.MemberStallUserGroup,
        memberStallFirstName: memberStall.MemberStallFirstName,
        memberStallLastName: memberStall.MemberStallLastName,
        memberStallStatusOnStall: memberStall.MemberStallStatusOnStall,
        status: memberStall.MemberStallStatusOnStall === "1" ? "active" : "inactive",
        syncedAt: new Date(),
      },
      create: {
        ownerLineUserId: memberStall.OwnerLineUserID,
        ownerIdCard: memberStall.OwnerIDCard,
        ownerTelephone: memberStall.OwnerTelephone,
        ownerCode: memberStall.OwnerCode,
        ownerName: memberStall.OwnerName,
        marketCode: memberStall.MarketCode,
        marketName: memberStall.MarketName,
        memberStallLineUserId: memberStall.MemberStallLineUserID,
        memberStallIdCard: memberStall.MemberStallIDCard,
        memberStallTelephone: memberStall.MemberStallTelephone,
        memberStallUserGroup: memberStall.MemberStallUserGroup,
        memberStallFirstName: memberStall.MemberStallFirstName,
        memberStallLastName: memberStall.MemberStallLastName,
        memberStallStatusOnStall: memberStall.MemberStallStatusOnStall,
        status: memberStall.MemberStallStatusOnStall === "1" ? "active" : "inactive",
        syncedAt: new Date(),
      },
    });
  }

  console.log(`Seed admin account ready: ${SEED_ADMIN.username}`);
  console.log(`Seed master owner stalls ready: ${SEED_MASTER_OWNER_STALLS.length}`);
  console.log(`Seed master member stalls ready: ${SEED_MASTER_MEMBER_STALLS.length}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await closePrisma();
  });
