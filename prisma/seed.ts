import dotenv from "dotenv";
import { closePrisma, getPrisma } from "../src/db/prisma";
import { hashPassword } from "../src/utils/password";

dotenv.config({ quiet: true });

const prisma = getPrisma();
const SEED_ADMIN = {
  username: "admin",
  password: "Admin@123456",
};

async function main(): Promise<void> {
  await prisma.account.upsert({
    where: {
      username: SEED_ADMIN.username,
    },
    update: {},
    create: {
      username: SEED_ADMIN.username,
      passwordHash: await hashPassword(SEED_ADMIN.password),
      role: "admin",
      status: "active",
      fullName: "System Admin",
      position: "Administrator",
      permissionLevel: "admin",
    },
  });

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
