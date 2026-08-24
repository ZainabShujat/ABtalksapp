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
 * The column that matters is `searchable`. Completing a challenge is not by
 * itself grounds to show someone to a recruiter: discoverability is
 * `CandidateVisibility.searchableByRecruiters`, one User-level gate that applies
 * identically to every track.
 *
 * `openToWork` is printed alongside it and is a DIFFERENT question — whether the
 * candidate is actively looking. A candidate can be searchable and not looking,
 * or looking and not searchable. Never read one as the other.
 *
 *   npx tsx scripts/verify-hire-pool.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function row(
  label: string,
  total: number,
  eligible: number,
  searchable: number,
  openToWork: number,
) {
  console.log(
    `  ${label.padEnd(26)} ${String(total).padStart(6)} ${String(eligible).padStart(10)} ${String(searchable).padStart(11)} ${String(openToWork).padStart(11)}`,
  );
}

async function main() {
  const openToWorkUserIds = new Set(
    (
      await prisma.candidatePreference.findMany({
        where: { openToWork: true },
        select: { userId: true },
      })
    ).map((a) => a.userId),
  );

  const searchableUserIds = new Set(
    (
      await prisma.candidateVisibility.findMany({
        where: { searchableByRecruiters: true, withdrawnAt: null },
        select: { userId: true },
      })
    ).map((v) => v.userId),
  );

  console.log("\n  ABTalks hire pool\n");
  console.log(
    `  ${"track".padEnd(26)} ${"total".padStart(6)} ${"eligible".padStart(10)} ${"searchable".padStart(11)} ${"openToWork".padStart(11)}`,
  );
  console.log(`  ${"-".repeat(68)}`);

  // ── AI cohort ──
  const members = await prisma.programMember.findMany({
    where: { status: { in: ["ENROLLED", "COMPLETED"] } },
    select: { id: true, userId: true },
  });
  row(
    "AI cohort (ProgramMember)",
    members.length,
    members.length,
    members.filter((m) => searchableUserIds.has(m.userId)).length,
    members.filter((m) => openToWorkUserIds.has(m.userId)).length,
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
      completed.filter((r) => searchableUserIds.has(r.userId)).length,
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
    withSubmission.filter((p) => searchableUserIds.has(p.userId)).length,
    withSubmission.filter((p) => openToWorkUserIds.has(p.userId)).length,
  );

  console.log(`  ${"-".repeat(68)}`);
  console.log(
    `\n  CandidateVisibility searchable rows: ${searchableUserIds.size}` +
      `\n  CandidatePreference openToWork rows: ${openToWorkUserIds.size}`,
  );

  if (searchableUserIds.size < 100) {
    console.log(
      "\n  The searchable population is small. Phase 2b of the 078 migration is\n" +
        "  the thing that sets it — see docs/project-context.md §5. Until 2b is\n" +
        "  reconciled against the intended pool (AI Cohort + post-launch\n" +
        "  candidates), /hire will rank a fraction of the people it holds.",
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
