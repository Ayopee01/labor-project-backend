import { PrismaClient } from "@prisma/client";
import { masterMarketSeedData } from "./master-market.seed";

const TEST_OWNER = {
  firstName: "พีรพล",
  lastName: "จันทร์ผล",
  lineUserId: "Ubd9b17811181e01f8fca0372d2b37088",
  cardId: "0000000000000",
  telephone: "0000000000",
} as const;

// Function ผูก LINE User ทดสอบกับทุกแผงที่มีอยู่จริงใน Master Market
export async function seedTestLine(
  prisma: PrismaClient,
): Promise<void> {
  const syncedAt = new Date();

  for (let index = 0; index < masterMarketSeedData.length; index += 100) {
    const batch = masterMarketSeedData.slice(index, index + 100);

    await prisma.$transaction(
      batch.map((booth) =>
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
    );
  }

  console.info(
    `[seed] test-line completed: ${masterMarketSeedData.length} master booths mapped to LINE user`,
  );
}