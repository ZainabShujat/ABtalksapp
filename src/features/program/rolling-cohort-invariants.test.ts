/**
 * Plan 157 — rolling-cohort invariants.
 *
 *   npm run test:rolling-cohort
 *
 * The AI Cohort stopped accepting submissions on 2026-09-02 because
 * `isCohortFrozen` compared `new Date()` against a shared `Cohort.endsAt`. That
 * is not a bug in one expression; it is a shape of bug — any track that measures
 * a learner's progress against a cohort-wide date will eventually lock out
 * everyone who joined late, silently, with no failing feature anywhere.
 *
 * These are source-scanning assertions, in the style of
 * `src/features/admin/programme-ops-coherence.test.ts`: they read the files and
 * reject the shape, so the guard holds for code nobody has written yet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
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

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Every .ts/.tsx file under `rel`, recursively, excluding this test. */
function sourceFiles(rel: string): string[] {
  const out: string[] = [];
  const abs = join(process.cwd(), rel);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const childRel = `${rel}/${entry}`;
    if (statSync(join(process.cwd(), childRel)).isDirectory()) {
      out.push(...sourceFiles(childRel));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (entry.endsWith("rolling-cohort-invariants.test.ts")) continue;
    out.push(childRel);
  }
  return out;
}

/** Day-based learning tracks. Every one of these must stay learner-anchored. */
const TRACK_DIRS = [
  "src/features/program",
  "src/features/snowflake",
  "src/features/databricks",
  "src/features/databricks-ai",
  "src/features/powerbi",
  "src/features/ds-architect",
  "src/features/challenge",
];

console.log("\nrolling-cohort invariants (plan 157)\n");

// ---------------------------------------------------------------------------
// 1. No track may gate anything on a cohort-wide end date.
// ---------------------------------------------------------------------------
suite("no track compares 'now' against a cohort end date", () => {
  const offenders: string[] = [];
  const patterns: RegExp[] = [
    /new Date\(\)\s*[><]=?\s*[A-Za-z_$][\w.$]*\.?endsAt/,
    /Date\.now\(\)\s*[><]=?\s*[A-Za-z_$][\w.$]*\.?endsAt/,
    /[A-Za-z_$][\w.$]*\.?endsAt\s*[><]=?\s*new Date\(\)/,
    /[A-Za-z_$][\w.$]*\.?endsAt\s*[><]=?\s*Date\.now\(\)/,
    /isCohortPastEndsAt/,
  ];
  for (const dir of TRACK_DIRS) {
    for (const file of sourceFiles(dir)) {
      const code = stripComments(read(file));
      for (const re of patterns) {
        if (re.test(code)) offenders.push(`${file} matches ${re}`);
      }
    }
  }
  assert(
    offenders.length === 0,
    "a cohort end date is gating learner behaviour again:\n      " +
      offenders.join("\n      ") +
      "\n      Freezing a track is an admin act on cohort STATUS, not a date.",
  );
});

// ---------------------------------------------------------------------------
// 2. A null cohort date must never become the Unix epoch.
// ---------------------------------------------------------------------------
suite("repositories never default a cohort date to the epoch", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src/repositories")) {
    const code = stripComments(read(file));
    for (const m of code.matchAll(
      /(startsAt|endsAt)\s*:[^,;\n]*\?\?\s*new Date\(0\)/g,
    )) {
      offenders.push(`${file}: ${m[0].trim()}`);
    }
  }
  assert(
    offenders.length === 0,
    "a null cohort date is being coerced to 1970:\n      " +
      offenders.join("\n      ") +
      "\n      That reads as 'this cohort ended long ago' and froze the track.",
  );
});

// ---------------------------------------------------------------------------
// 2b. Same shape, second instance: null capacity must not become 0.
//
// `capacity ?? 0` in promoteWaitlisted turned "no cap" into "full", so every
// promotion failed with "Cohort is at capacity." Null means unlimited.
// ---------------------------------------------------------------------------
suite("null capacity is never coerced to zero", () => {
  const offenders: string[] = [];
  for (const dir of ["src/repositories", ...TRACK_DIRS]) {
    for (const file of sourceFiles(dir)) {
      const code = stripComments(read(file));
      for (const m of code.matchAll(/capacity\s*\?\?\s*0\b/g)) {
        offenders.push(`${file}: ${m[0].trim()}`);
      }
    }
  }
  assert(
    offenders.length === 0,
    "a null capacity is being coerced to 0:\n      " +
      offenders.join("\n      ") +
      "\n      Null capacity means unlimited, not full.",
  );
});

// ---------------------------------------------------------------------------
// 2c. Only the AI cohort has a capacity gate at all, and it honours null.
// ---------------------------------------------------------------------------
suite("capacity gates treat null as unlimited", () => {
  const entry = stripComments(read("src/features/program/entry.ts"));
  assert(
    /capacity\s*!==\s*null/.test(entry),
    "enrollOrWaitlist no longer checks `capacity !== null` before waitlisting — " +
      "an uncapped cohort must never waitlist anyone",
  );
  const admin = stripComments(read("src/features/program/admin.ts"));
  const at = admin.indexOf("export async function promoteWaitlisted");
  assert(at !== -1, "promoteWaitlisted is no longer exported");
  const body = admin.slice(at, at + 1600);
  assert(
    /capacity\s*!==\s*null/.test(body),
    "promoteWaitlisted no longer checks `capacity !== null` before refusing",
  );

  // No other track may grow a capacity gate.
  const offenders: string[] = [];
  for (const dir of TRACK_DIRS.filter((d) => d !== "src/features/program")) {
    for (const file of sourceFiles(dir)) {
      if (/\bcapacity\b/.test(stripComments(read(file)))) offenders.push(file);
    }
  }
  assert(
    offenders.length === 0,
    "a track other than the AI cohort grew a capacity limit:\n      " +
      offenders.join("\n      "),
  );
});

// ---------------------------------------------------------------------------
// 3. isCohortFrozen is a status check, nothing else.
// ---------------------------------------------------------------------------
suite("isCohortFrozen gates on status only", () => {
  const code = stripComments(read("src/features/program/progression.ts"));
  const start = code.indexOf("export function isCohortFrozen");
  assert(
    start !== -1,
    "isCohortFrozen is no longer exported from progression.ts as a plain function",
  );
  const body = code.slice(start, code.indexOf("\n}", start) + 2);
  assert(body.includes("status"), "isCohortFrozen does not look at status");
  assert(
    !body.includes("endsAt"),
    "isCohortFrozen reads endsAt again — it must gate on status alone",
  );
  assert(
    !/\bnew Date\b|\bDate\.now\b/.test(body),
    "isCohortFrozen reads the clock again — it must gate on status alone",
  );
});

// ---------------------------------------------------------------------------
// 4. No cohort is special-cased by name.
// ---------------------------------------------------------------------------
suite("no cohort is held open by matching its name", () => {
  const offenders: string[] = [];
  for (const dir of [...TRACK_DIRS, "src/components", "src/repositories"]) {
    for (const file of sourceFiles(dir)) {
      // Comments are allowed to name it — that is how the retirement is recorded.
      if (stripComments(read(file)).includes("PROGRAM_HOLD_OPEN_COHORT_NAME")) {
        offenders.push(file);
      }
    }
  }
  assert(
    offenders.length === 0,
    "PROGRAM_HOLD_OPEN_COHORT_NAME is back in:\n      " + offenders.join("\n      "),
  );
  assert(
    !read("src/features/program/constants.ts").includes(
      "export const PROGRAM_HOLD_OPEN_COHORT_NAME",
    ),
    "constants.ts exports PROGRAM_HOLD_OPEN_COHORT_NAME again",
  );
});

// ---------------------------------------------------------------------------
// 5. AI-cohort day math is learner-anchored.
// ---------------------------------------------------------------------------
suite("AI-cohort day math is anchored on the learner", () => {
  const code = read("src/features/program/progression.ts");
  assert(
    code.includes("export function getMemberCalendarDay"),
    "progression.ts no longer exports getMemberCalendarDay",
  );
  assert(
    !code.includes("export function getCohortCalendarDay"),
    "getCohortCalendarDay is back — day math must read the learner's startedAt",
  );
  assert(
    code.includes("export type ProgramAnchor"),
    "progression.ts no longer exports the ProgramAnchor type",
  );
  const stripped = stripComments(code);
  for (const fn of [
    "getMaxContentDay",
    "getContentDayUnlockKey",
    "getBehindByDays",
  ]) {
    const at = stripped.indexOf(`export function ${fn}(`);
    assert(at !== -1, `${fn} is no longer exported from progression.ts`);
    const signature = stripped.slice(at, stripped.indexOf(")", at));
    assert(
      signature.includes("ProgramAnchor"),
      `${fn} no longer takes a ProgramAnchor — it must read the learner's startedAt`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. No hardcoded programme dates in the cohort funnel.
// ---------------------------------------------------------------------------
suite("cohort funnel has no hardcoded programme dates", () => {
  const MONTH =
    "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
  const patterns = [
    new RegExp(`\\b(?:${MONTH})[a-z]*\\s+\\d{1,2},?\\s+20\\d\\d\\b`, "i"),
    new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH})[a-z]*\\s+20\\d\\d\\b`, "i"),
  ];
  const offenders: string[] = [];
  for (const file of sourceFiles("src/components/talent-hunt")) {
    const code = stripComments(read(file));
    for (const re of patterns) {
      const m = code.match(re);
      if (m) offenders.push(`${file}: "${m[0]}"`);
    }
  }
  assert(
    offenders.length === 0,
    "a fixed programme date is hardcoded in the cohort funnel again:\n      " +
      offenders.join("\n      ") +
      "\n      The cohort is rolling — there is no launch or completion date.",
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
