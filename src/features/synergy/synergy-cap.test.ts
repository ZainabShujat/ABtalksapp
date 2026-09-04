/**
 * Plan 111 — daily submission synergy cap.
 * Run: npm run test:synergy-cap
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { istDateRangeToUtc } from "@/lib/date-utils";
import {
  SYNERGY_BASE_SUBMISSION,
  SYNERGY_DAILY_SUBMISSION_CAP,
} from "@/features/synergy/scoring";

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

console.log("\nPlan 111 — synergy daily cap\n");

suite("cap is a flat 10 SP and matches the base award", () => {
  assert(SYNERGY_BASE_SUBMISSION === 10, "base is 10");
  assert(SYNERGY_DAILY_SUBMISSION_CAP === 10, "cap is 10");
  assert(
    SYNERGY_DAILY_SUBMISSION_CAP === SYNERGY_BASE_SUBMISSION,
    "cap and base stay in lockstep",
  );
});

suite("proof bonuses are gone from scoring", () => {
  const src = source("src/features/synergy/scoring.ts");
  assert(!src.includes("SYNERGY_PROOF_GITHUB"), "no GitHub bonus");
  assert(!src.includes("SYNERGY_PROOF_LINKEDIN"), "no LinkedIn bonus");
  assert(!src.includes("computeSubmissionSynergy"), "no compute helper");
});

suite("award short-circuits to 0 before touching the wallet", () => {
  const src = source("src/features/synergy/award-submission-synergy.ts");
  assert(
    src.includes("hasEarnedSubmissionPointsOnIstDate"),
    "consults the daily reader",
  );
  const guard = src.indexOf("return 0;");
  const grant = src.indexOf("applyPointsChange(tx, {");
  assert(guard > 0 && grant > 0, "both branches present");
  assert(guard < grant, "capped path returns before applyPointsChange");
});

suite("concurrent submissions serialize on the wallet row", () => {
  const src = source("src/features/synergy/award-submission-synergy.ts");
  const lock = src.indexOf("lockWalletBalance(tx");
  const read = src.indexOf("hasEarnedSubmissionPointsOnIstDate(tx");
  assert(lock > 0, "takes the wallet lock");
  assert(lock < read, "lock is held before the paid-today read");
});

suite("submit-day passes the IST day key, not proof flags", () => {
  const src = source("src/features/submission/submit-day.ts");
  const call = src.slice(src.indexOf("awardSubmissionSynergy(tx, {"));
  const args = call.slice(0, call.indexOf("});"));
  assert(args.includes("istDateKey: submittedAtIst"), "passes the IST key");
  assert(!args.includes("hasGithub"), "no GitHub flag in the award call");
  assert(!args.includes("hasLinkedin"), "no LinkedIn flag in the award call");
});

suite("daily reader is flag-aware across the 078 cutover", () => {
  const src = source("src/repositories/points.ts");
  const fn = src.slice(src.indexOf("export async function hasEarnedSubmissionPointsOnIstDate"));
  assert(fn.includes("isNewPointsWritesEnabled()"), "branches on the flag");
  assert(fn.includes("pointsTransaction.findFirst"), "new-path read");
  assert(fn.includes("synergyEvent.findFirst"), "legacy-path read");
  assert(fn.includes("amount: { gt: 0 }"), "new path ignores debits");
  assert(fn.includes("points: { gt: 0 }"), "legacy path ignores debits");
});

suite("marketplace no longer advertises the proof bonuses", () => {
  const src = source("src/components/marketplace/earning-pills.tsx");
  assert(!src.includes("SYNERGY_PROOF_"), "no bonus constants");
  assert(!src.includes("Share2"), "LinkedIn pill removed");
  assert(!src.includes("GitBranch"), "GitHub pill removed");
});

suite("IST day window is UTC+5:30 and exactly 24h", () => {
  const { startUtc, endExclusiveUtc } = istDateRangeToUtc(
    "2026-09-04",
    "2026-09-04",
  );
  assert(startUtc?.toISOString() === "2026-09-03T18:30:00.000Z", "IST midnight");
  assert(
    endExclusiveUtc?.toISOString() === "2026-09-04T18:30:00.000Z",
    "next IST midnight",
  );
  const span = Number(endExclusiveUtc) - Number(startUtc);
  assert(span === 24 * 60 * 60 * 1000, "24 hour span");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
