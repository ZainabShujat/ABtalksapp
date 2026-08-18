/**
 * Issue ViCoDathon 2026 placement certificates (winner / 2nd / 3rd / top 5).
 * Extra HACKATHON rows with metadata.hackathonVariant; participation rows stay.
 *
 * Usage:
 *   npx tsx prisma/scripts/issue-hackathon-award-certificates.ts --all --allow-production --dry-run
 *   npx tsx prisma/scripts/issue-hackathon-award-certificates.ts --all --allow-production
 *   npx tsx prisma/scripts/issue-hackathon-award-certificates.ts --email=user@example.com --variant=winner --allow-production
 *
 * Requires production Neon host ep-nameless-term-ams9a5e3 and --allow-production.
 */
import { createRequire } from "node:module";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { prisma } from "../../src/lib/db";
import {
  parseHackathonVariant,
  type HackathonCertificateVariant,
} from "../../src/features/certificate/constants";

config({ path: ".env.local" });
config();

const PRODUCTION_NEON_HOST_ID = "ep-nameless-term-ams9a5e3";

type AwardRow = {
  email: string;
  variant: HackathonCertificateVariant;
  recipientName: string;
};

const AWARDS: AwardRow[] = [
  {
    email: "pjha5863@gmail.com",
    variant: "winner",
    recipientName: "Prem Jha",
  },
  {
    email: "subhojyotimaity1082005@gmail.com",
    variant: "second",
    recipientName: "Subhojyoti Maity",
  },
  {
    email: "devanshd310@gmail.com",
    variant: "third",
    recipientName: "The Terrible Trio",
  },
  {
    email: "shrutisaxena1706@gmail.com",
    variant: "third",
    recipientName: "The Terrible Trio",
  },
  {
    email: "dhruvnaithani8@gmail.com",
    variant: "third",
    recipientName: "The Terrible Trio",
  },
  {
    email: "mohitkabi456@gmail.com",
    variant: "top5",
    recipientName: "Arcade",
  },
  {
    email: "chhayakantamaharan@gmail.com",
    variant: "top5",
    recipientName: "Arcade",
  },
  {
    email: "haripangi335@gmail.com",
    variant: "top5",
    recipientName: "Arcade",
  },
  {
    email: "shanusmani.dev@gmail.com",
    variant: "top5",
    recipientName: "Shan Usmani",
  },
];

function neutralizeServerOnly(): void {
  const require = createRequire(fileURLToPath(import.meta.url));
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as NodeModule;

  const mod = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = mod._load;
  mod._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

function assertProductionAllowed(): void {
  const dbUrl = process.env.DATABASE_URL ?? "";
  let host = "(DATABASE_URL unset)";
  try {
    host = new URL(dbUrl).host;
  } catch {
    // keep fallback
  }
  console.log(`Issue target DATABASE_URL host: ${host}`);
  if (!dbUrl.toLowerCase().includes(PRODUCTION_NEON_HOST_ID)) {
    console.error(
      `❌ Refusing to run: expected production host containing ${PRODUCTION_NEON_HOST_ID}.`,
    );
    process.exit(1);
  }
  if (!process.argv.includes("--allow-production")) {
    console.error("❌ Refusing to run: pass --allow-production to write/read production.");
    process.exit(1);
  }
}

async function main() {
  assertProductionAllowed();
  neutralizeServerOnly();

  const { ensureHackathonAwardCertificate } = await import(
    "../../src/features/certificate/issue-hackathon-certificate"
  );

  const dryRun =
    process.env.DRY_RUN === "1" ||
    process.argv.some((arg) => arg === "--dry-run" || arg === "dry-run");
  const emailFilter = argValue("email")?.toLowerCase();
  const variantArg = argValue("variant");
  const recipientOverride = argValue("recipient-name");

  console.log(
    `Mode: ${dryRun ? "dry-run" : "live"} (argv=${JSON.stringify(process.argv.slice(2))})`,
  );

  let targets: AwardRow[];
  if (emailFilter) {
    const variant = parseHackathonVariant(variantArg);
    if (!variant) {
      console.error(
        "❌ --email requires --variant=winner|second|third|top5",
      );
      process.exit(1);
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: emailFilter, mode: "insensitive" } },
      select: { id: true, email: true },
    });
    if (!user?.email) {
      console.error(
        `❌ No user with email ${emailFilter}. Sign in on localhost first.`,
      );
      process.exit(1);
    }

    const participant = await prisma.hackathonParticipant.findUnique({
      where: { userId: user.id },
      select: {
        fullName: true,
        team: { select: { teamName: true } },
      },
    });
    if (!participant) {
      console.error(
        `❌ ${user.email} is not a hackathon participant. Register at /hackathon/register first.`,
      );
      process.exit(1);
    }

    const rosterHit = AWARDS.find(
      (row) => row.email.toLowerCase() === user.email!.toLowerCase(),
    );
    const recipientName =
      recipientOverride ||
      rosterHit?.recipientName ||
      participant.team.teamName?.trim() ||
      participant.fullName;

    targets = [
      {
        email: user.email,
        variant,
        recipientName,
      },
    ];
  } else if (process.argv.includes("--all")) {
    targets = AWARDS;
  } else {
    console.error(
      "❌ Pass --email=... --variant=... or --all (full ranked roster).",
    );
    process.exit(1);
  }

  console.log(`Targets: ${targets.length}`);
  for (const row of targets) {
    console.log(
      `  - ${row.email} variant=${row.variant} name="${row.recipientName}"`,
    );
  }

  let preflightFailed = 0;
  for (const row of targets) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: row.email, mode: "insensitive" } },
      select: { id: true, email: true },
    });
    if (!user) {
      preflightFailed += 1;
      console.log(`  LOOKUP FAIL ${row.email}: no user`);
      continue;
    }
    const participant = await prisma.hackathonParticipant.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!participant) {
      preflightFailed += 1;
      console.log(`  LOOKUP FAIL ${row.email}: not a hackathon participant`);
    }
  }
  if (preflightFailed > 0) {
    console.error(
      `❌ Preflight failed for ${preflightFailed} email(s). No certificates issued.`,
    );
    process.exit(1);
  }
  console.log("Preflight: all targets exist as hackathon participants.");

  if (dryRun) {
    console.log("Dry run — no certificates issued.");
    return;
  }

  let issued = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of targets) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: row.email, mode: "insensitive" } },
      select: { id: true, email: true },
    });
    if (!user) {
      failed += 1;
      console.log(`  FAIL ${row.email}: no user`);
      continue;
    }

    const result = await ensureHackathonAwardCertificate({
      userId: user.id,
      variant: row.variant,
      recipientName: row.recipientName,
    });
    if (!result.ok) {
      failed += 1;
      console.log(`  FAIL ${row.email}: ${result.message}`);
      continue;
    }
    if (result.data.alreadyIssued) {
      skipped += 1;
      console.log(
        `  SKIP ${row.email}: already ${result.data.certificateId}`,
      );
    } else {
      issued += 1;
      console.log(`  OK   ${row.email}: ${result.data.certificateId}`);
      console.log(`https://abtalks.in/verify/${result.data.certificateId}`);
    }
  }

  console.log(`\nDone. issued=${issued} skipped=${skipped} failed=${failed}`);
  console.log("Certificates are live at /verify/<id> and on /achievements.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
