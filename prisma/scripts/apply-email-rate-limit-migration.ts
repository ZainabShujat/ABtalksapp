import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { prisma } from "../../src/lib/db";

const PRODUCTION_DB_HOST_IDS = ["ep-nameless-term-ams9a5e3", ".main."] as const;

function assertNotProductionDb() {
  const url = process.env.DATABASE_URL ?? "";
  for (const id of PRODUCTION_DB_HOST_IDS) {
    if (url.includes(id)) {
      throw new Error(
        `Refusing to execute: DATABASE_URL looks like production (${id}). Use a Neon branch.`,
      );
    }
  }
}

async function main() {
  assertNotProductionDb();
  console.log("\n─── Applying RateLimitBucket Enums for Email/Password Auth ───\n");

  await prisma.$executeRawUnsafe(
    `ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'LOGIN_PASSWORD_ACCOUNT';`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'LOGIN_PASSWORD_IP';`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'EMAIL_CODE_ADDRESS';`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'EMAIL_CODE_IP';`,
  );

  console.log("  ✓ LOGIN_PASSWORD_ACCOUNT added");
  console.log("  ✓ LOGIN_PASSWORD_IP added");
  console.log("  ✓ EMAIL_CODE_ADDRESS added");
  console.log("  ✓ EMAIL_CODE_IP added");
  console.log("\nDone! Rate limit buckets for email/password auth are ready.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
