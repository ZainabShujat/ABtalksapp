/**
 * Seed VerifiedRecruiterSeat from the recruiters who are already approved.
 *
 * Once access is gated on a seat, an empty seat table would lock out every
 * recruiter who is working today. Their existing `approved: true` row *is* the
 * verification decision an admin already made, so it carries over rather than
 * being asked for again.
 *
 * Unapproved profiles are deliberately skipped — they were never verified, and
 * inventing a seat for them would hand out access nobody granted.
 *
 * Idempotent: matching is on lowercased email, and an existing seat is left
 * exactly as it is.
 *
 *   npx tsx scripts/backfill-recruiter-seats.ts           # report only
 *   npx tsx scripts/backfill-recruiter-seats.ts --write    # apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const WRITE = process.argv.includes("--write");

async function main() {
  const profiles = await prisma.recruiterProfile.findMany({
    select: {
      approved: true,
      company: true,
      fullName: true,
      approvedAt: true,
      user: { select: { email: true } },
    },
  });

  const existing = new Set(
    (await prisma.verifiedRecruiterSeat.findMany({ select: { email: true } }))
      .map((s) => s.email),
  );

  let created = 0;
  let skippedUnapproved = 0;
  let alreadyThere = 0;

  for (const p of profiles) {
    const email = p.user.email?.trim().toLowerCase();
    if (!email) continue;

    if (!p.approved) {
      skippedUnapproved++;
      console.log(`  skip (never approved): ${email}`);
      continue;
    }
    if (existing.has(email)) {
      alreadyThere++;
      continue;
    }

    console.log(`  seat: ${email}  (${p.company})`);
    created++;
    if (WRITE) {
      await prisma.verifiedRecruiterSeat.create({
        data: {
          email,
          company: p.company,
          contactName: p.fullName,
          active: true,
          verifiedAt: p.approvedAt ?? new Date(),
          notes: "Backfilled from an existing approved RecruiterProfile.",
        },
      });
    }
  }

  console.log(
    `\n  ${profiles.length} profiles · ${created} seat(s) ${WRITE ? "created" : "to create"}` +
      ` · ${alreadyThere} already present · ${skippedUnapproved} skipped as unapproved` +
      (WRITE ? "" : "\n  dry run — pass --write to apply."),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
