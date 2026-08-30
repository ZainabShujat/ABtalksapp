/**
 * The recruiter-discovery gate — run with:
 *   npm run test:visibility
 *
 * No network, no database. Two kinds of check:
 *
 *  1. The gate itself has the shape it claims to have.
 *  2. Every query in `/hire` that loads candidate rows actually applies it.
 *
 * (2) is a source scan, which is unusual for a unit test and deliberate. The
 * failure this guards against is not a wrong boolean, it is a *missing clause*:
 * before this change the program path was gated and the challenge and hackathon
 * paths were not, so a challenge participant who had never been made searchable
 * could be shortlisted and, at CONTACT_SHARED, have their details released. A
 * shape assertion cannot catch that. A fifth track added next quarter without
 * the gate is the same bug, and this is what fails when someone writes it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  searchableUserWhere,
  visibleProgramMemberWhere,
} from "@/repositories/talent";
import { memberEligibilityWhere } from "@/features/hire/pool-policy";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

console.log("\nrecruiter visibility gate");

suite("the gate requires searchable, not-withdrawn, not-deleted", () => {
  const g = searchableUserWhere() as {
    deletedAt: null;
    visibility: { is: { searchableByRecruiters: boolean; withdrawnAt: null } };
  };
  assert(g.deletedAt === null, "deleted users must be excluded");
  assert(
    g.visibility.is.searchableByRecruiters === true,
    "searchableByRecruiters must be required true",
  );
  assert(
    g.visibility.is.withdrawnAt === null,
    "a withdrawn candidate must be excluded even if the flag is still true",
  );
});

suite("the gate is not openToWork", () => {
  // Two different questions: may a recruiter find you, and are you looking.
  // If these ever get wired together, someone marking themselves open to work
  // silently becomes discoverable — or worse, the reverse.
  assert(
    !JSON.stringify(searchableUserWhere()).includes("openToWork"),
    "searchableUserWhere must not reference openToWork",
  );
});

suite("the pool clause describes the pool and nothing else", () => {
  // The gate is added by repositories/hire.ts on the way out, so a caller cannot
  // forget it and a second `user:` key cannot overwrite it. This clause must
  // therefore carry no visibility of its own — if it grows one, there are two
  // gates again and one of them will drift.
  const w = memberEligibilityWhere(["cohort_1"]) as Record<string, unknown>;
  assert(!("user" in w), "the pool clause must not build a user gate");
  assert(
    !("recruiterVisibilityConsentAt" in w),
    "the old per-track consent clause must be gone",
  );
  assert("cohortId" in w && "status" in w, "it must still scope the pool");
});

suite("the seam adds the gate with AND, not a spreadable key", () => {
  const src = readFileSync(join(process.cwd(), "src/repositories/hire.ts"), "utf8");
  assert(
    src.includes("AND: [where, { user: searchableUserWhere() }]"),
    "listProgramCandidates must AND the gate onto whatever the caller passes",
  );
});

suite("the retiring /talent fragment is still distinct and still narrow", () => {
  // Left in place only as a named leftover. If it ever grows a second
  // responsibility, that is the drift this catches.
  assert(
    Object.keys(visibleProgramMemberWhere()).length === 1,
    "visibleProgramMemberWhere must stay a single-key fragment",
  );
});

suite("/talent pool uses CandidateVisibility, not the legacy consent column", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/talent-pool/pool.ts"),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(
    !code.includes("recruiterVisibilityConsentAt"),
    "/talent must not use recruiterVisibilityConsentAt as visibility",
  );
  assert(
    code.includes("searchableUserWhere()"),
    "/talent must gate on searchableUserWhere",
  );
});

/* ── source scan ─────────────────────────────────────────────────────────── */

/**
 * Prisma models that 078 migrates and whose rows describe a PERSON. Reading one
 * of these directly from `src/features/hire/` bypasses the repository seam, so
 * the recruiter desk would not switch with the rest of the platform at Phase 6 —
 * and, more immediately, it is how an ungated candidate query gets written.
 *
 * Hire-owned tables (`TalentRequest`, `TalentRequestMatch`,
 * `TalentEngagementRequest`, ...) are deliberately absent: they have no
 * legacy/new duality, are not part of the migration, and wrapping them would buy
 * a layer and nothing else.
 */
const MIGRATED_CANDIDATE_MODELS = [
  "prisma.programMember.",
  "prisma.enrollment.",
  "prisma.hackathonParticipant.",
  "prisma.submission.",
  "prisma.quizAttempt.",
  "prisma.programMissionSubmission.",
  "prisma.programDay.",
  "prisma.programCohort.",
];

function scanFile(name: string, src: string): string[] {
  return MIGRATED_CANDIDATE_MODELS.filter((n) => src.includes(n)).map(
    (n) => `${name} reads ${n}* directly instead of via repositories/hire.ts`,
  );
}

suite("no hire file reads a migrated candidate table directly", () => {
  const dir = join(process.cwd(), "src/features/hire");
  const problems: string[] = [];
  let scanned = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    scanned++;
    problems.push(...scanFile(f, readFileSync(join(dir, f), "utf8")));
  }
  assert(scanned > 10, `expected to scan the hire feature, saw ${scanned} files`);
  assert(
    problems.length === 0,
    `reads outside the seam:\n      - ${problems.join("\n      - ")}`,
  );
});

suite("every candidate query in the seam applies the gate", () => {
  // The queries live in repositories/hire.ts now, so this is where the gate is
  // checked. A label lookup for a candidate already known from a stored match or
  // engagement is not a discovery query and is identified by `shortlistedBy`.
  const src = readFileSync(join(process.cwd(), "src/repositories/hire.ts"), "utf8");
  const problems: string[] = [];
  for (const needle of [
    "prisma.programMember.findMany",
    "prisma.enrollment.findMany",
    "prisma.hackathonParticipant.findMany",
  ]) {
    let from = 0;
    for (;;) {
      const at = src.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      const window = src.slice(at, at + 900);
      if (window.includes("searchableUserWhere()")) continue;
      if (window.includes("shortlistedBy")) continue;
      problems.push(`${needle} at offset ${at} is missing the gate`);
    }
  }
  assert(
    problems.length === 0,
    `ungated in the seam:\n      - ${problems.join("\n      - ")}`,
  );
});

suite("the saved match list re-applies the gate on read", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/hire/load-request-matches.ts"),
    "utf8",
  );
  assert(
    src.includes("filterSearchableUserIds("),
    "loadRequestMatches must re-filter stored matches",
  );
  assert(
    !/matches:\s*request\.matches\.map/.test(src),
    "the rendered list must be the filtered one, not the raw stored rows",
  );
});

suite("no hire file builds its own visibility clause", () => {
  const dir = join(process.cwd(), "src/features/hire");
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const src = readFileSync(join(dir, f), "utf8");
    // Comments may name these; code may not.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (
      code.includes("recruiterVisibilityConsentAt") ||
      code.includes("searchableByRecruiters")
    ) {
      offenders.push(f);
    }
  }
  assert(
    offenders.length === 0,
    `these build their own gate instead of importing it: ${offenders.join(", ")}`,
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
