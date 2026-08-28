/**
 * Refuses to let development tooling run against a production-shaped database.
 *
 * Run this BEFORE any migration, seed, or smoke test during Interview Agent
 * development:
 *
 *   node scripts/db-preflight.mjs
 *
 * Exit 0 = target looks like a disposable test database, safe to write.
 * Exit 1 = target looks like production (or is unreachable). Do not write.
 *
 * The check is on DATA SHAPE, not on a hostname allowlist: hostnames rotate and
 * hard-coding the production host would put infrastructure detail in source
 * control. A real ABTalks production database has tens of thousands of users; a
 * test database has a handful. That difference is unambiguous and needs no
 * secret to detect.
 */
import fs from "node:fs";
import path from "node:path";

/** Populate process.env from .env.local (Prisma only auto-loads .env). */
function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// A test database for this work holds a handful of seeded rows. Production held
// 12,603 users and 518 mission submissions when this guard was written.
const MAX_USERS = 500;
const MAX_MISSION_SUBMISSIONS = 200;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

async function main() {
  loadEnvLocal();

  const url = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("\nFAIL — no SMOKE_DATABASE_URL or DATABASE_URL set.\n");
    process.exit(1);
  }
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL ??= url;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const [users, missionSubs, members, meta] = await Promise.all([
      prisma.user.count(),
      prisma.programMissionSubmission.count(),
      prisma.programMember.count(),
      prisma.$queryRaw`SELECT current_database()::text AS db, current_user::text AS usr`,
    ]);

    console.log("\n  host           :", hostOf(url));
    console.log("  database / user:", `${meta[0].db} / ${meta[0].usr}`);
    console.log("  User           :", users);
    console.log("  ProgramMember  :", members);
    console.log("  MissionSubmiss.:", missionSubs);

    const reasons = [];
    if (users > MAX_USERS) reasons.push(`${users} users (limit ${MAX_USERS})`);
    if (missionSubs > MAX_MISSION_SUBMISSIONS) {
      reasons.push(
        `${missionSubs} mission submissions (limit ${MAX_MISSION_SUBMISSIONS})`,
      );
    }

    if (reasons.length > 0) {
      console.error(
        `\n  FAIL — this looks like PRODUCTION: ${reasons.join("; ")}.` +
          `\n  Refusing to proceed. Point DATABASE_URL at the separate test` +
          `\n  database before running migrations, seeds, or smoke tests.\n`,
      );
      process.exit(1);
    }

    console.log("\n  PASS — target looks like a disposable test database.\n");
  } catch (e) {
    console.error(
      "\n  FAIL — could not inspect the database:",
      String(e.message).split("\n")[0],
      "\n",
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
