import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { PlatformRole, Role, RoleScopeType } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/password";

const PRODUCTION_DB_HOST_IDS = ["ep-nameless-term-ams9a5e3", ".main."] as const;

function assertNotProductionDb() {
  const url = process.env.DATABASE_URL ?? "";
  for (const id of PRODUCTION_DB_HOST_IDS) {
    if (url.includes(id)) {
      throw new Error(
        `Refusing to seed: DATABASE_URL looks like production (${id}). Use a Neon branch.`,
      );
    }
  }
}

async function main() {
  assertNotProductionDb();
  console.log("\n─── Setting up Local Admin User ───\n");

  const email = "admin@abtalks.dev";
  const password = "admin";
  const hashedPassword = await hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "Local Admin",
      password: hashedPassword,
      role: Role.ADMIN,
      emailVerified: new Date(),
    },
    update: {
      password: hashedPassword,
      role: Role.ADMIN,
      emailVerified: new Date(),
    },
    select: { id: true, email: true },
  });

  console.log(`  ✓ Admin user: ${admin.email} (id: ${admin.id})`);

  // Ensure GLOBAL PlatformRole.ADMIN assignment
  const existingGrant = await prisma.userRoleAssignment.findFirst({
    where: {
      userId: admin.id,
      role: PlatformRole.ADMIN,
      scopeType: RoleScopeType.GLOBAL,
      revokedAt: null,
    },
    select: { id: true },
  });

  if (!existingGrant) {
    await prisma.userRoleAssignment.create({
      data: {
        userId: admin.id,
        role: PlatformRole.ADMIN,
        scopeType: RoleScopeType.GLOBAL,
      },
    });
    console.log("  ✓ Created GLOBAL PlatformRole.ADMIN assignment");
  } else {
    console.log("  ✓ GLOBAL PlatformRole.ADMIN assignment already active");
  }

  // Ensure CandidateProfile exists so registration gate doesn't intercept
  await prisma.candidateProfile.upsert({
    where: { userId: admin.id },
    create: {
      userId: admin.id,
      fullName: "Local Admin",
      referralCode: "ADM001",
    },
    update: {},
  });
  console.log("  ✓ CandidateProfile attached (bypasses /register)");

  console.log(`\nDone! Local admin is ready.`);
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}\n`);
}

main()
  .catch((e) => {
    console.error("Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
