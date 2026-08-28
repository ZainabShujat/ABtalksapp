/**
 * One-shot: sync ENROLLED / COMPLETED members to PROGRAM_MEMBER_START_DAY.
 * When START_DAY is 1 this retracts unused Day 1–3 start waivers (members
 * with a real pass are left alone). When START_DAY is >1 it waives 1..(n-1)
 * and seeds early commit-activity days.
 *
 * Usage: npm run db:bootstrap:program-start-day
 *
 * Idempotent — safe to re-run.
 */
import { config } from "dotenv";
import { prisma } from "../../src/lib/db";
import { bootstrapMemberStartDay } from "../../src/features/program/bootstrap-start-day";

config({ path: ".env.local" });
config();

async function main() {
  const members = await prisma.programMember.findMany({
    where: { status: { in: ["ENROLLED", "COMPLETED"] } },
    select: {
      id: true,
      fullName: true,
      highestUnlockedDay: true,
    },
  });

  let updated = 0;
  for (const m of members) {
    await prisma.$transaction(
      async (tx) => {
        await bootstrapMemberStartDay(tx, m.id);
      },
      { timeout: 60_000 },
    );
    updated += 1;
    console.log(
      `  bootstrapped ${m.fullName} (${m.id}) — unlocked day ${m.highestUnlockedDay}`,
    );
  }

  console.log(
    `Done. Bootstrapped ${updated} of ${members.length} member(s) (missions + early commit days).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
