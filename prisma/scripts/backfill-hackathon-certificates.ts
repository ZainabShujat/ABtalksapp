/**
 * Issue ViCoDathon 2026 participation certificates for hackathon
 * participants whose team submitted both a repo URL and a live URL.
 *
 * Usage:
 *   npm run db:backfill:certificates:hackathon
 *   npm run db:backfill:certificates:hackathon -- --dry-run
 */
import { config } from "dotenv";
import { prisma } from "../../src/lib/db";
import { ensureHackathonCertificate } from "../../src/features/certificate/issue-hackathon-certificate";
import { toWinAnsiSafe } from "../../src/features/certificate/render-certificate-pdf";

config({ path: ".env.local" });
config();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const teams = await prisma.hackathonTeam.findMany({
    where: { submission: { isNot: null } },
    select: {
      id: true,
      teamCode: true,
      teamName: true,
      entryType: true,
      submission: { select: { repoUrl: true, liveUrl: true } },
      participants: {
        orderBy: { slotIndex: "asc" },
        select: { userId: true, fullName: true, email: true, isLeader: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const eligible: typeof teams = [];
  const incomplete: { team: (typeof teams)[number]; blank: string }[] = [];

  for (const team of teams) {
    const repoUrl = team.submission?.repoUrl.trim() ?? "";
    const liveUrl = team.submission?.liveUrl.trim() ?? "";
    if (repoUrl && liveUrl) {
      eligible.push(team);
    } else {
      const missing: string[] = [];
      if (!repoUrl) missing.push("repoUrl");
      if (!liveUrl) missing.push("liveUrl");
      incomplete.push({ team, blank: missing.join(" + ") });
    }
  }

  console.log(
    `Found ${eligible.length} team(s) eligible for hackathon certificates.`,
  );
  for (const team of eligible) {
    const repoUrl = team.submission?.repoUrl.trim() ?? "";
    const liveUrl = team.submission?.liveUrl.trim() ?? "";
    console.log(
      `  - ${team.teamCode} ${team.teamName ?? "SOLO"} participants=${team.participants.length}`,
    );
    console.log(`      repo: ${repoUrl}`);
    console.log(`      live: ${liveUrl}`);
  }

  console.log("\nSKIPPED (incomplete submission)");
  if (incomplete.length === 0) {
    console.log("  (none)");
  } else {
    for (const { team, blank } of incomplete) {
      console.log(
        `  - ${team.teamCode} ${team.teamName ?? "SOLO"} missing=${blank}`,
      );
    }
  }

  const unrenderable: { userId: string; fullName: string; email: string }[] = [];
  const unrenderableIds = new Set<string>();
  for (const team of eligible) {
    for (const p of team.participants) {
      if (!toWinAnsiSafe(p.fullName)) {
        unrenderable.push({
          userId: p.userId,
          fullName: p.fullName,
          email: p.email,
        });
        unrenderableIds.add(p.userId);
      }
    }
  }

  console.log("\nUNRENDERABLE NAME — will be skipped");
  if (unrenderable.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of unrenderable) {
      console.log(`  - ${p.fullName} <${p.email}>`);
    }
  }

  if (dryRun) {
    console.log("Dry run — no certificates issued.");
    return;
  }

  const participants = eligible.flatMap((team) => team.participants);
  if (participants.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\nPress Ctrl+C in the next 5 seconds to cancel...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  let issued = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of participants) {
    if (unrenderableIds.has(p.userId)) {
      failed += 1;
      console.log(`  FAIL ${p.fullName}: unrenderable name`);
      continue;
    }

    const result = await ensureHackathonCertificate(p.userId);
    if (!result.ok) {
      failed += 1;
      console.log(`  FAIL ${p.fullName}: ${result.message}`);
      continue;
    }
    if (result.data.alreadyIssued) {
      skipped += 1;
      console.log(`  SKIP ${p.fullName}: already ${result.data.certificateId}`);
    } else {
      issued += 1;
      console.log(`  OK   ${p.fullName}: ${result.data.certificateId}`);
    }
  }

  console.log(`\nDone. issued=${issued} skipped=${skipped} failed=${failed}`);
  console.log(
    "Certificates are live at /verify/<id> and on /achievements.",
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
