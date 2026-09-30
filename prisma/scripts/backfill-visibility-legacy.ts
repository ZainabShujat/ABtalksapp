/**
 * Plan 161 — re-open the CandidateVisibility rows that were never a decision.
 *
 *   npm run db:backfill:visibility                                  # dry run
 *   npm run db:backfill:visibility -- --apply --expect-host=nameless
 *
 * `--apply` REQUIRES `--expect-host=<substring>` and aborts unless the live
 * DATABASE_URL host contains it. This repository has more than one
 * production-volume Neon host — `ep-young-shadow-amawetjy` and
 * `ep-nameless-term-ams9a5e3` — and which one `.env.local` resolves to depends
 * on the checkout. Naming the intended host is the only thing that makes a
 * 12,000-row write to the wrong database impossible rather than merely
 * unlikely.
 *
 * WHAT THIS REPAIRS
 * `migrate-2b-visibility` wrote 12,734 rows in a 49-second window on
 * 2026-08-24 as `{ searchableByRecruiters: false, consentSource: null }` —
 * its "other legacy users stay closed" branch, run while the column still
 * defaulted to false. Migration 20260824153000 corrected the default 52
 * minutes later and says in its own comment that it "does not rewrite existing
 * CandidateVisibility rows". Nothing has re-opened them since, so 10,980
 * candidate profiles search as 86.
 *
 * WHAT IT WILL NOT TOUCH
 *  - `withdrawnAt` set        — an admin moderation or deletion decision.
 *  - any non-null consentSource — a real decision, including
 *    admin_resume_import, platform_default and program_apply_migrated.
 * Those two exclusions are the whole safety argument. Do not widen them.
 *
 * Repaired rows are stamped `legacy_backfill_161`, which is what makes this
 * reversible: that value identifies exactly the rows this script wrote.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Never a decision: the 2026-08-24 artifact and nothing else. */
const PREDICATE = {
  searchableByRecruiters: false,
  consentSource: null,
  withdrawnAt: null,
} as const;

export const BACKFILL_CONSENT_SOURCE = "legacy_backfill_161";

const CHUNK = 1000;

/** Host only — never the credentials. */
function targetHost(): string {
  const url = process.env.DATABASE_URL ?? "";
  try {
    return new URL(url).host;
  } catch {
    return "(DATABASE_URL unparseable)";
  }
}

function flag(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const SEARCHABLE = {
  deletedAt: null,
  disabledAt: null,
  visibility: { is: { searchableByRecruiters: true, withdrawnAt: null } },
} as const;

async function funnel(label: string) {
  const [profiles, gate, pool] = await Promise.all([
    prisma.user.count({
      where: { deletedAt: null, disabledAt: null, candidateProfile: { isNot: null } },
    }),
    prisma.user.count({ where: { ...SEARCHABLE, candidateProfile: { isNot: null } } }),
    prisma.user.count({
      where: {
        ...SEARCHABLE,
        candidateProfile: {
          is: { fullName: { not: "" }, skills: { some: { claimedByCandidate: true } } },
        },
      },
    }),
  ]);
  console.log(`\n  ${label}`);
  console.log(`    candidate profiles ............ ${profiles}`);
  console.log(`    passing the visibility gate ... ${gate}`);
  console.log(`    reaching the search pool ...... ${pool}`);
}

async function main() {
  config({ path: ".env.local" });
  config();

  const apply = process.argv.includes("--apply");
  const expectHost = flag("expect-host");
  const host = targetHost();

  console.log(`\n  TARGET DATABASE: ${host}`);

  if (apply) {
    if (!expectHost) {
      console.error(
        "\n  REFUSING TO WRITE: --apply requires --expect-host=<substring>.\n" +
          `  The live DATABASE_URL points at ${host}.\n` +
          "  Re-run naming the database you intend, e.g.\n" +
          "    npm run db:backfill:visibility -- --apply --expect-host=nameless\n",
      );
      await prisma.$disconnect();
      process.exit(1);
    }
    if (!host.includes(expectHost)) {
      console.error(
        `\n  REFUSING TO WRITE: expected a host containing "${expectHost}",\n` +
          `  but DATABASE_URL points at ${host}. Nothing was written.\n`,
      );
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  const target = await prisma.candidateVisibility.count({ where: PREDICATE });
  const withdrawn = await prisma.candidateVisibility.count({
    where: { withdrawnAt: { not: null } },
  });
  const decided = await prisma.candidateVisibility.count({
    where: { consentSource: { not: null } },
  });

  console.log("\nPlan 161 — CandidateVisibility legacy backfill");
  console.log(`  rows matching the repair predicate ... ${target}`);
  console.log(`  left alone (withdrawn) ............... ${withdrawn}`);
  console.log(`  left alone (has a consentSource) ..... ${decided}`);

  await funnel("BEFORE");

  if (!apply) {
    console.log(
      "\n  DRY RUN — nothing written. Re-run with `-- --apply` to write.\n",
    );
    await prisma.$disconnect();
    return;
  }

  console.log(`\n  Applying to ${target} rows in chunks of ${CHUNK}…`);
  let done = 0;
  // Chunked by id rather than one updateMany: ~12.7K rows over Neon in a
  // single statement is a long lock on a table the recruiter search reads.
  for (;;) {
    const batch = await prisma.candidateVisibility.findMany({
      where: PREDICATE,
      select: { id: true },
      take: CHUNK,
    });
    if (batch.length === 0) break;
    const result = await prisma.candidateVisibility.updateMany({
      where: { id: { in: batch.map((r) => r.id) }, ...PREDICATE },
      data: {
        searchableByRecruiters: true,
        consentSource: BACKFILL_CONSENT_SOURCE,
        consentedAt: new Date(),
      },
    });
    done += result.count;
    console.log(`    ${done}/${target}`);
    if (result.count === 0) break;
  }

  await funnel("AFTER");
  console.log(
    `\n  Done. Repaired rows carry consentSource="${BACKFILL_CONSENT_SOURCE}",` +
      " which is how they can be identified or reverted.\n",
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
