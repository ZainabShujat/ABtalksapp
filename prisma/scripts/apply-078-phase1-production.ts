/**
 * Apply additive 078 Phase 1 + Phase 2 audit DDL to production.
 * Requires CONFIRM_PRODUCTION_DDL=078-phase1 and a direct (non-pooler) URL.
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PRODUCTION_NEON_HOST_ID } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const PHASE1 =
  "prisma/migrations/20260820120000_platform_data_architecture_phase1/migration.sql";
const PHASE2_AUDIT =
  "prisma/migrations/20260820130000_phase2_migration_audit/migration.sql";

function assertProductionDirect(url: string): void {
  if (!url.toLowerCase().includes(PRODUCTION_NEON_HOST_ID)) {
    throw new Error(`DATABASE_URL is not production host ${PRODUCTION_NEON_HOST_ID}`);
  }
  if (url.includes("-pooler")) {
    throw new Error("Use the Neon direct endpoint, not -pooler");
  }
}

function runPrisma(args: string[]): void {
  const result = spawnSync("npx", ["prisma", ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed with ${result.status}`);
  }
}

async function main() {
  if (process.env.CONFIRM_PRODUCTION_DDL !== "078-phase1") {
    throw new Error("Set CONFIRM_PRODUCTION_DDL=078-phase1 to apply production DDL");
  }
  const url = process.env.DATABASE_URL ?? "";
  assertProductionDirect(url);
  process.env.DIRECT_URL = process.env.DIRECT_URL || url;

  const prisma = new PrismaClient();
  try {
    const already = await prisma.$queryRaw<Array<{ t: string | null }>>`
      SELECT to_regclass('public."CandidateProfile"')::text AS t
    `;
    if (already[0]?.t) {
      console.log("CandidateProfile already exists — skipping Phase 1 DDL");
    } else {
      console.log("Running orphan/precondition checks…");
      const checks = await prisma.$queryRaw<Array<{ check: string; n: bigint }>>`
        SELECT 'job_orphan_createdByAdminId' AS check, count(*)::bigint AS n
        FROM "Job" j
        WHERE j."createdByAdminId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = j."createdByAdminId")
        UNION ALL
        SELECT 'recruiter_orphan_approvedByAdminId', count(*)::bigint
        FROM "RecruiterProfile" r
        WHERE r."approvedByAdminId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = r."approvedByAdminId")
        UNION ALL
        SELECT 'notification_orphan_createdByAdminId', count(*)::bigint
        FROM "Notification" n
        WHERE n."createdByAdminId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = n."createdByAdminId")
        UNION ALL
        SELECT 'hackathon_removal_orphan_removedByUserId', count(*)::bigint
        FROM "HackathonRemoval" h
        WHERE h."removedByUserId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = h."removedByUserId")
        UNION ALL
        SELECT 'certificate_orphan_userId', count(*)::bigint
        FROM "Certificate" c
        WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = c."userId")
        UNION ALL
        SELECT 'synergy_orphan_userId', count(*)::bigint
        FROM "SynergyEvent" s
        WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = s."userId")
        UNION ALL
        SELECT 'shortlist_orphan_memberId', count(*)::bigint
        FROM "RecruiterShortlistItem" i
        WHERE NOT EXISTS (SELECT 1 FROM "ProgramMember" m WHERE m.id = i."memberId")
      `;
      for (const row of checks) {
        console.log(`  ${row.check}: ${row.n}`);
      }
      const blocking = checks.filter(
        (row) =>
          Number(row.n) > 0 &&
          (row.check === "certificate_orphan_userId" ||
            row.check === "synergy_orphan_userId" ||
            row.check === "shortlist_orphan_memberId"),
      );
      if (blocking.length > 0) {
        throw new Error(
          `Blocking orphans (FK RESTRICT would fail): ${blocking.map((b) => `${b.check}=${b.n}`).join(", ")}`,
        );
      }
      console.log("Applying Phase 1 additive DDL…");
      runPrisma(["db", "execute", "--file", PHASE1, "--url", url]);
      console.log("Marking Phase 1 migration applied…");
      runPrisma([
        "migrate",
        "resolve",
        "--applied",
        "20260820120000_platform_data_architecture_phase1",
      ]);
    }

    const audit = await prisma.$queryRaw<Array<{ t: string | null }>>`
      SELECT to_regclass('public."MigrationRun"')::text AS t
    `;
    if (audit[0]?.t) {
      console.log("MigrationRun already exists — skipping Phase 2 audit DDL");
    } else {
      console.log("Applying Phase 2 audit tables…");
      runPrisma(["db", "execute", "--file", PHASE2_AUDIT, "--url", url]);
      runPrisma([
        "migrate",
        "resolve",
        "--applied",
        "20260820130000_phase2_migration_audit",
      ]);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
