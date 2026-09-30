/**
 * Plan 161 — recruiter search visibility and depth.
 *
 * One assertion per measured cause, so a regression names itself:
 *   §2b  12,734 rows closed by a superseded migration
 *   §2c  no product path could ever re-open a closed row
 *   §2f  every signed-in search capped at 20, so the pager stopped at 2 pages
 *   §2g  the profile pool was "newest 600", a recency window not a search
 *
 * Run: npm run test:search-visibility
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCHES_PER_PAGE } from "@/components/hire/match-pagination";
import {
  CHALLENGE_POOL_CAP,
  SEARCH_RESULT_LIMIT,
} from "@/features/hire/search-candidates";

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

function source(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Comments and string literals stripped, so assertions read code not prose. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const VIS = "src/repositories/visibility.ts";
const visibility = source(VIS);
const visibilityCode = code(VIS);

console.log("\nPlan 161 — search visibility and depth");

// =========================================================================
// 1. The gate itself is NOT loosened
// =========================================================================

suite("the discovery gate still requires searchable AND not withdrawn", () => {
  // The gate was never the bug — the data behind it was. Dropping either
  // condition would expose deleted, disabled or withdrawn candidates, which is
  // worse than the bug it would 'fix'.
  const src = code("src/repositories/talent.ts");
  const gate = src.slice(src.indexOf("export function searchableUserWhere"));
  for (const required of [
    "deletedAt: null",
    "disabledAt: null",
    "searchableByRecruiters: true",
    "withdrawnAt: null",
  ]) {
    assert(gate.includes(required), `searchableUserWhere must keep ${required}`);
  }
});

// =========================================================================
// 2. Healing a never-decided row (§2c)
// =========================================================================

suite("the opening intents can heal a closed, never-decided row", () => {
  assert(
    visibilityCode.includes("const neverDecided") &&
      visibilityCode.includes("existing.consentSource === null") &&
      visibilityCode.includes("!existing.searchableByRecruiters"),
    "an admin import must be able to open the 2026-08-24 artifact",
  );
  assert(
    visibilityCode.includes("if (!neverDecided)"),
    "a row carrying a real decision must still be skipped",
  );
});

suite("a row with any consentSource is still left alone", () => {
  // admin_resume_import, platform_default and program_apply_migrated all
  // record a decision that this must not overwrite.
  const at = visibilityCode.indexOf("const neverDecided");
  const branch = visibilityCode.slice(at, at + 600);
  assert(
    branch.includes("skipReason: ") || branch.includes("skipped: true"),
    "the non-healing path must still return a skip",
  );
});

suite("a withdrawn row can never be healed", () => {
  // This is the ordering that keeps admin moderation and account deletion
  // durable: the withdrawnAt early return has to come FIRST.
  const withdrawnGuard = visibilityCode.indexOf("existing?.withdrawnAt");
  const healing = visibilityCode.indexOf("const neverDecided");
  assert(withdrawnGuard > 0, "the withdrawn early return must exist");
  assert(
    withdrawnGuard < healing,
    "the withdrawnAt guard must precede the healing branch, or an admin " +
      "withdrawal would be undone by the candidate's next profile save",
  );
});

suite("admin_withdraw still closes the row", () => {
  assert(
    visibility.includes('if (input.kind === "admin_withdraw")'),
    "the withdraw branch must still exist",
  );
  const branch = visibility.slice(visibility.indexOf('input.kind === "admin_withdraw"'));
  assert(
    branch.includes("searchableByRecruiters: false") &&
      branch.includes("withdrawnAt: now"),
    "withdrawing must still close the row and stamp withdrawnAt",
  );
});

// =========================================================================
// 3. The backfill (§2b)
// =========================================================================

const BACKFILL = "prisma/scripts/backfill-visibility-legacy.ts";

suite("the backfill predicate is all three conditions, not fewer", () => {
  const src = code(BACKFILL);
  const at = src.indexOf("PREDICATE");
  const predicate = src.slice(at, src.indexOf("}", at) + 1);
  for (const required of [
    "searchableByRecruiters: false",
    "consentSource: null",
    "withdrawnAt: null",
  ]) {
    assert(
      predicate.includes(required),
      `the predicate must include ${required} — widening it would rewrite real decisions`,
    );
  }
});

suite("the backfill never deletes and never runs without --apply", () => {
  const src = code(BACKFILL);
  assert(
    !src.includes("deleteMany") && !src.includes(".delete("),
    "a repair must not delete rows",
  );
  assert(src.includes("apply"), "an --apply flag must gate the writes");
  const apply = src.indexOf("const apply");
  const write = src.indexOf("updateMany");
  assert(apply > 0 && apply < write, "the flag must be read before any write");
});

suite("repaired rows are stamped so they can be identified or reverted", () => {
  assert(
    source(BACKFILL).includes('"legacy_backfill_161"'),
    "the stamp is what makes the backfill reversible",
  );
});

suite("the historical migration script is left as a record", () => {
  const src = source("prisma/scripts/migrate-2b-visibility.ts");
  assert(
    src.includes("searchableByRecruiters: false"),
    "migrate-2b must keep its original behaviour — it is a historical record, " +
      "and the repair is a separate script",
  );
});

// =========================================================================
// 4. Pool selection (§2g)
// =========================================================================

suite("the profile pool filters on the brief's skills, not just recency", () => {
  const src = code("src/repositories/hire.ts");
  const at = src.indexOf("export async function listProfileCandidates");
  const fn = src.slice(at, at + 1400);
  assert(
    fn.includes("skills?: string[]"),
    "listProfileCandidates must accept the brief's skills",
  );
  assert(
    fn.includes("skill: { name: { in: wanted"),
    "the skills must reach the SQL where, or the pool stays a recency window",
  );
  assert(
    fn.includes("claimedByCandidate: true"),
    "the claimed-skill condition must survive",
  );
});

suite("the skill filter is threaded from the spec to the query", () => {
  const search = code("src/features/hire/search-candidates.ts");
  assert(
    search.includes("mustHaveStack") && search.includes("niceToHaveStack"),
    "the brief's skills must come from the spec",
  );
  assert(search.includes("skills: briefSkills"), "and be passed to loadTrack");

  const loaders = code("src/features/hire/track-loaders.ts");
  assert(loaders.includes("skills?: string[]"), "TrackLoadOpts must carry them");
  assert(loaders.includes("skills: opts.skills"), "and loadProfile must pass them on");

  const dossier = code("src/features/hire/profile-dossier.ts");
  assert(
    dossier.includes("skills: opts?.skills"),
    "buildProfileDossierSet must pass them to the query",
  );
});

// =========================================================================
// 5. Result depth (§2f)
// =========================================================================

suite("a signed-in search returns more than one page", () => {
  const limit = SEARCH_RESULT_LIMIT;
  assert(
    limit > MATCHES_PER_PAGE,
    `a limit of ${limit} at ${MATCHES_PER_PAGE} per page is one page — that was the bug`,
  );
  assert(
    limit >= MATCHES_PER_PAGE * 3,
    `${limit} gives only ${Math.ceil(limit / MATCHES_PER_PAGE)} pages`,
  );
});

suite("the hardcoded 20 is gone from the signed-in search", () => {
  const src = code("src/app/actions/hire-actions.ts");
  assert(
    !src.includes("searchCandidates(spec, { limit: 20 })"),
    "the signed-in search must not be capped at 20",
  );
  assert(
    src.includes("limit: SEARCH_RESULT_LIMIT"),
    "it must read the named constant",
  );
});

suite("the pool cap is at least the result limit", () => {
  assert(
    CHALLENGE_POOL_CAP >= SEARCH_RESULT_LIMIT,
    `loading ${CHALLENGE_POOL_CAP} rows cannot produce ${SEARCH_RESULT_LIMIT} matches`,
  );
});

suite("the limit lives outside the \"use server\" module", () => {
  // A "use server" file may only export async functions — exporting the
  // constant from hire-actions.ts failed the build. It belongs with the other
  // search limits anyway.
  assert(
    !/export const SEARCH_RESULT_LIMIT/.test(source("src/app/actions/hire-actions.ts")),
    "a Server Action module cannot export a constant",
  );
  assert(
    /export const SEARCH_RESULT_LIMIT/.test(source("src/features/hire/search-candidates.ts")),
    "it must live beside MIN_RESULTS and CHALLENGE_POOL_CAP",
  );
});

suite("the guest preview and the alert run keep their own limits", () => {
  // Both are deliberate and different: a signed-out teaser, and a digest.
  assert(
    code("src/app/actions/hire-guest-actions.ts").includes("limit: 20"),
    "the signed-out preview stays at 20",
  );
  assert(
    code("src/features/hire/run-hire-alerts.ts").includes("limit: 5"),
    "the alert run stays at 5",
  );
});

suite("the pager itself was not the bug and is untouched", () => {
  const src = code("src/components/hire/match-results.tsx");
  assert(
    src.includes("MATCHES_PER_PAGE") && src.includes("pageItems("),
    "the pagination added in plan 158 must still be in place",
  );
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
