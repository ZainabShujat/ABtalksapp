/**
 * Read-only: what would the /hire candidate pool actually contain, per track?
 *
 * Cross-track matching (60-day, Claude, hackathon) cannot be validated from a
 * developer machine — those tracks have rows in production and none here. This
 * reports the real numbers wherever it is pointed, so the decision to switch a
 * source on is made against data instead of a guess.
 *
 * It writes nothing and reads no personal data beyond counts.
 *
 * The number that matters is the last column. Completing a challenge is not
 * consent to be shown to recruiters: only ProgramMember carries
 * `recruiterVisibilityConsentAt`, and for every other track the sole affirmative
 * signal a candidate has given is CandidateAvailability.openToWork. A source
 * whose consented count is 0 is not "broken" — it means nobody on that track
 * has agreed yet, and enabling it would show people who never opted in.
 *
 *   npx tsx scripts/verify-hire-pool.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function row(label: string, total: number, eligible: number, consented: number) {
  console.log(
    `  ${label.padEnd(26)} ${String(total).padStart(6)} ${String(eligible).padStart(10)} ${String(consented).padStart(11)}`,
  );
}

async function main() {
  const openToWorkUserIds = new Set(
    (
      await prisma.candidateAvailability.findMany({
        where: { openToWork: true },
        select: { userId: true },
      })
    ).map((a) => a.userId),
  );

  console.log("\n  ABTalks hire pool\n");
  console.log(
    `  ${"track".padEnd(26)} ${"total".padStart(6)} ${"eligible".padStart(10)} ${"consented".padStart(11)}`,
  );
  console.log(`  ${"-".repeat(56)}`);

  // ── AI cohort: the only track with a real recruiter-visibility consent ──
  const members = await prisma.programMember.findMany({
    where: { status: { in: ["ENROLLED", "COMPLETED"] } },
    select: { id: true, recruiterVisibilityConsentAt: true },
  });
  row(
    "AI cohort (ProgramMember)",
    members.length,
    members.length,
    members.filter((m) => m.recruiterVisibilityConsentAt !== null).length,
  );

  // ── 60-day challenge, split by domain ──
  for (const domain of ["SE", "DS", "AI", "CLAUDE"] as const) {
    const rows = await prisma.enrollment.findMany({
      where: { domain },
      select: { status: true, userId: true },
    });
    const completed = rows.filter((r) => r.status === "COMPLETED");
    row(
      `60-day · ${domain}`,
      rows.length,
      completed.length,
      completed.filter((r) => openToWorkUserIds.has(r.userId)).length,
    );
  }

  // ── Hackathon ──
  // Submissions hang off the team, not the participant — one per team.
  const participants = await prisma.hackathonParticipant.findMany({
    select: { userId: true, teamId: true },
  });
  const submittedTeamIds = new Set(
    (
      await prisma.hackathonSubmission.findMany({ select: { teamId: true } })
    ).map((s) => s.teamId),
  );
  const withSubmission = participants.filter((p) =>
    submittedTeamIds.has(p.teamId),
  );
  row(
    "Hackathon",
    participants.length,
    withSubmission.length,
    withSubmission.filter((p) => openToWorkUserIds.has(p.userId)).length,
  );

  console.log(`  ${"-".repeat(56)}`);
  console.log(
    `\n  CandidateAvailability rows with openToWork = true: ${openToWorkUserIds.size}`,
  );

  if (openToWorkUserIds.size === 0) {
    console.log(
      "\n  Nobody outside the AI cohort has opted in yet, so no other source\n" +
        "  can be enabled without showing candidates who never agreed to it.\n" +
        "  The candidate-side availability form (plan 062 §5.1) is what unblocks\n" +
        "  this — until it ships, these counts stay at zero.",
    );
  }
  console.log();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
