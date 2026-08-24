/**
 * One-off: strip candidate names out of already-stored match rationales.
 *
 * Rationales written before the anonymisation change begin "Ada Lovelace
 * scores 92/100…". They are rendered straight to recruiters, so every one of
 * those rows is a live name leak that outlives the code fix.
 *
 * Rewrites in place rather than deleting: the rows are a recruiter's current
 * results, and replacing the name with the same public id the app now uses
 * removes the leak without emptying anyone's shortlist.
 *
 * Idempotent — a rationale with no name in it is left untouched.
 *
 *   npx tsx scripts/anonymise-match-rationales.ts          # report only
 *   npx tsx scripts/anonymise-match-rationales.ts --write   # apply
 */
import { PrismaClient } from "@prisma/client";
import { candidatePublicId } from "../src/features/hire/public-id";

const prisma = new PrismaClient();
const WRITE = process.argv.includes("--write");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const members = await prisma.programMember.findMany({
    select: { id: true, fullName: true },
  });
  const nameById = new Map(members.map((m) => [m.id, m.fullName.trim()]));

  const rows = await prisma.talentRequestMatch.findMany({
    select: { id: true, programMemberId: true, rationale: true },
  });

  let changed = 0;
  for (const row of rows) {
    if (!row.rationale) continue;

    // programMemberId is nullable (onDelete: SetNull), so a match can outlive
    // the member it described — with their name still sitting in the text and
    // no id left to derive a label from. That is the erasure case, and it gets
    // an unattributed placeholder rather than a stable one.
    const label = row.programMemberId
      ? candidatePublicId(row.programMemberId)
      : "A candidate";

    let next = row.rationale;
    // Any member's name is a leak, not just this row's own.
    for (const [, name] of nameById) {
      if (!name || !next.includes(name)) continue;
      next = next.replace(new RegExp(escapeRegExp(name), "g"), label);
    }
    if (next === row.rationale) continue;

    changed++;
    console.log(`  ${row.id}`);
    console.log(`    before: ${row.rationale.slice(0, 90)}…`);
    console.log(`    after:  ${next.slice(0, 90)}…`);
    if (WRITE) {
      await prisma.talentRequestMatch.update({
        where: { id: row.id },
        data: { rationale: next },
      });
    }
  }

  console.log(
    `\n  ${rows.length} rows scanned, ${changed} contained a name` +
      (WRITE ? " — rewritten." : " — dry run, pass --write to apply."),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
