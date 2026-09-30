/**
 * Top every live recruiter workspace up to $20,000.00 (2_000_000 USD cents).
 *
 * New workspaces already get that amount from `credits.starting_grant_minor`.
 * Existing workspaces froze their onboarding grant at the old $200 default;
 * this script writes one idempotent ADMIN_ADJUSTMENT per org for the delta
 * needed to reach $20,000. Orgs already at or above the target are skipped.
 * Deleted / anonymized recruiters and "Deleted workspace" orgs are skipped.
 *
 * Dry run by default. Pass --apply to write.
 *
 * Neon safety: run --apply only against a child branch connection string unless
 * production write is explicitly authorized in the same request.
 *
 * Run: npm run db:topup:recruiter-credits-20k
 *      npm run db:topup:recruiter-credits-20k -- --apply
 */
import { PrismaClient } from "@prisma/client";
import { applyCreditChange } from "../../src/repositories/credits";

const TARGET_MINOR = 2_000_000;
const IDEMPOTENCY_PREFIX = "grant:align-starting-20k-20260929:";

const prisma = new PrismaClient();

function usd(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log(
    `\n${apply ? "APPLYING" : "DRY RUN"} — top up live recruiter workspaces to ${usd(TARGET_MINOR)}\n`,
  );

  const targets = await prisma.organization.findMany({
    where: {
      name: { not: "Deleted workspace" },
      members: {
        some: {
          role: "RECRUITER",
          status: "ACTIVE",
          user: { deletedAt: null },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      members: {
        where: {
          role: "RECRUITER",
          status: "ACTIVE",
          user: { deletedAt: null },
        },
        orderBy: { joinedAt: "asc" },
        take: 1,
        select: { userId: true },
      },
    },
  });

  if (targets.length === 0) {
    console.log("No live recruiter workspaces found.\n");
    return;
  }

  let wouldGrant = 0;
  let granted = 0;
  let skippedOk = 0;
  let duplicates = 0;
  let failed = 0;
  let totalDelta = 0;

  for (const org of targets) {
    const recruiterUserId = org.members[0]?.userId;
    if (!recruiterUserId) {
      console.log(`  skip ${org.slug} — no active recruiter member`);
      continue;
    }

    const latest = await prisma.creditTransaction.findFirst({
      where: { organizationId: org.id },
      orderBy: { seq: "desc" },
      select: { balanceAfter: true },
    });
    const balance = latest?.balanceAfter ?? 0;
    const delta = TARGET_MINOR - balance;

    if (delta <= 0) {
      skippedOk++;
      console.log(
        `  ok     ${org.slug}  balance ${usd(balance)} (already >= target)`,
      );
      continue;
    }

    const idempotencyKey = `${IDEMPOTENCY_PREFIX}${org.id}`;
    wouldGrant++;
    totalDelta += delta;

    if (!apply) {
      console.log(
        `  would  ${org.slug}  ${usd(balance)} → ${usd(TARGET_MINOR)}  (+${usd(delta)})`,
      );
      continue;
    }

    try {
      const result = await prisma.$transaction(
        (tx) =>
          applyCreditChange(tx, {
            organizationId: org.id,
            recruiterUserId,
            amount: delta,
            type: "ADMIN_ADJUSTMENT",
            sourceType: "SCRIPT",
            sourceId: "topup-recruiter-credits-20k",
            idempotencyKey,
            reason:
              "Align existing recruiter workspace to $20,000 starting-credit policy",
            metadata: {
              script: "topup-recruiter-credits-20k",
              targetMinor: TARGET_MINOR,
              balanceBefore: balance,
            },
          }),
        { maxWait: 20_000, timeout: 20_000 },
      );

      if (!result.ok) {
        failed++;
        console.log(`  FAIL   ${org.slug}  ${result.reason}`);
        continue;
      }
      if (result.duplicate) {
        duplicates++;
        console.log(
          `  dup    ${org.slug}  already applied (balance ${usd(result.balance)})`,
        );
        continue;
      }
      granted++;
      console.log(
        `  granted ${org.slug}  ${usd(balance)} → ${usd(result.balance)}  (+${usd(result.appliedAmount)})`,
      );
    } catch (error) {
      failed++;
      console.log(`  FAIL   ${org.slug}  ${String(error)}`);
    }
  }

  console.log(
    apply
      ? `\nDone. granted=${granted} duplicates=${duplicates} already_ok=${skippedOk} failed=${failed} of ${targets.length} workspaces.\n`
      : `\n${wouldGrant} workspace(s) would receive a total of ${usd(totalDelta)}. ${skippedOk} already at/above target. Re-run with --apply.\n`,
  );
}

main()
  .catch((e) => {
    console.error("Recruiter credit top-up failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
