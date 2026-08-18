import { PrismaClient } from "@prisma/client";
import { masterMarketSeedData } from "./master-market.seed";

const TEST_OWNER = {
  firstName: "พีรพล",
  lastName: "จันทร์ผล",
  lineUserId: "Ubd9b17811181e01f8fca0372d2b37088",
  cardId: "0000000000000",
  telephone: "0000000000",
} as const;

// Config ลูกน้องแผงทดสอบ ผูกกับ TEST_OWNER คนเดียวกันทุกแผง เพื่อทดสอบ flow แจ้งเตือน LINE
// ที่ส่งถึงทั้งเจ้าของแผงและลูกน้องแผงพร้อมกัน (ดู resolveVendorLineTargets ใน gate-ticket.repository.ts)
const TEST_MEMBERS = [
  {
    firstName: "Kittipoom",
    lastName: "Intachot",
    lineUserId: "Ue43a276ca7b52bf9bdf915f5cbf10eba",
    idCard: "0000000000001",
    telephone: "0000000001",
  },
  {
    firstName: "Pemtat",
    lastName: "Ruksachat", 
    lineUserId: "U6747dc8a4155f273d2555908b0f168e0",
    idCard: "0000000000002",
    telephone: "0000000002",
  },
] as const;

// Function ผูก LINE User ทดสอบกับทุกแผงที่มีอยู่จริงใน Master Market
export async function seedTestLine(prisma: PrismaClient): Promise<void> {
  const syncedAt = new Date();

  for (let index = 0; index < masterMarketSeedData.length; index += 100) {
    const batch = masterMarketSeedData.slice(index, index + 100);

    await prisma.$transaction([
      ...batch.map((booth) =>
        prisma.masterOwnerStall.upsert({
          where: {
            marketCode_boothCode: {
              marketCode: booth.marketCode,
              boothCode: booth.boothCode,
            },
          },
          create: {
            marketCode: booth.marketCode,
            boothCode: booth.boothCode,
            boothName: booth.boothName,
            cardId: TEST_OWNER.cardId,
            customerTelephone: TEST_OWNER.telephone,
            firstName: TEST_OWNER.firstName,
            lastName: TEST_OWNER.lastName,
            ownerStatus: "Normal",
            lineUserId: TEST_OWNER.lineUserId,
            status: "active",
            syncedAt,
          },
          update: {
            boothName: booth.boothName,
            cardId: TEST_OWNER.cardId,
            customerTelephone: TEST_OWNER.telephone,
            firstName: TEST_OWNER.firstName,
            lastName: TEST_OWNER.lastName,
            ownerStatus: "Normal",
            lineUserId: TEST_OWNER.lineUserId,
            status: "active",
            syncedAt,
          },
        }),
      ),
      ...batch.flatMap((booth) =>
        TEST_MEMBERS.map((member) =>
          prisma.masterMemberStall.upsert({
            where: {
              marketCode_ownerIdCard_ownerLineUserId_memberStallLineUserId: {
                marketCode: booth.marketCode,
                ownerIdCard: TEST_OWNER.cardId,
                ownerLineUserId: TEST_OWNER.lineUserId,
                memberStallLineUserId: member.lineUserId,
              },
            },
            create: {
              ownerLineUserId: TEST_OWNER.lineUserId,
              ownerIdCard: TEST_OWNER.cardId,
              ownerTelephone: TEST_OWNER.telephone,
              ownerName: `${TEST_OWNER.firstName} ${TEST_OWNER.lastName}`,
              marketCode: booth.marketCode,
              marketName: booth.marketName,
              memberStallLineUserId: member.lineUserId,
              memberStallIdCard: member.idCard,
              memberStallTelephone: member.telephone,
              memberStallUserGroup: "STAFF",
              memberStallFirstName: member.firstName,
              memberStallLastName: member.lastName,
              memberStallStatusOnStall: "1",
              status: "active",
              syncedAt,
            },
            update: {
              ownerTelephone: TEST_OWNER.telephone,
              ownerName: `${TEST_OWNER.firstName} ${TEST_OWNER.lastName}`,
              marketName: booth.marketName,
              memberStallIdCard: member.idCard,
              memberStallTelephone: member.telephone,
              memberStallUserGroup: "STAFF",
              memberStallFirstName: member.firstName,
              memberStallLastName: member.lastName,
              memberStallStatusOnStall: "1",
              status: "active",
              syncedAt,
            },
          }),
        ),
      ),
    ]);
  }

  console.info(
    `[seed] test-line completed: ${masterMarketSeedData.length} master booths mapped to LINE user, ` +
      `${TEST_MEMBERS.length} member LINE users mapped to every booth's owner`,
  );
}
