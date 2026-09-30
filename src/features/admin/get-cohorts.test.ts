/**
 * Plan 156 — admin cohort enrollment reads.
 *   npm run test:cohorts
 *
 * Pure helpers plus a source guard for the join-date trap: the join date is
 * ProgramEnrollment.joinedAt, never createdAt (createdAt is the plan-078
 * backfill timestamp, identical on 3,340 production rows).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COHORT_STATUSES,
  emptyStatusCounts,
  foldStatusCounts,
  monthLabel,
} from "./get-cohorts";

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

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

console.log("\nPlan 156 admin cohort reads");

suite("emptyStatusCounts covers every EnrollmentStatusV2 value", () => {
  const counts = emptyStatusCounts();
  for (const status of COHORT_STATUSES) {
    assert(counts[status] === 0, `${status} starts at 0`);
  }
  assert(
    Object.keys(counts).length === COHORT_STATUSES.length,
    "no extra keys",
  );
});

suite("foldStatusCounts fills absent statuses with zero", () => {
  const counts = foldStatusCounts([
    { status: "ACTIVE", count: 2743 },
    { status: "COMPLETED", count: 92 },
    { status: "DROPPED", count: 1 },
  ]);
  assert(counts.ACTIVE === 2743, "active folded");
  assert(counts.COMPLETED === 92, "completed folded");
  assert(counts.DROPPED === 1, "dropped folded");
  assert(counts.APPLIED === 0, "applied defaults to 0");
  assert(counts.WAITLISTED === 0, "waitlisted defaults to 0");
  assert(counts.REMOVED === 0, "removed defaults to 0");
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  assert(total === 2836, "totals match the production claude cohort");
});

suite("foldStatusCounts sums duplicate rows rather than overwriting", () => {
  const counts = foldStatusCounts([
    { status: "ACTIVE", count: 3 },
    { status: "ACTIVE", count: 4 },
  ]);
  assert(counts.ACTIVE === 7, "duplicates summed");
});

suite("monthLabel formats month keys and passes through junk", () => {
  assert(monthLabel("2026-05") === "May 2026", "May 2026");
  assert(monthLabel("2026-01") === "Jan 2026", "Jan 2026");
  assert(monthLabel("2026-12") === "Dec 2026", "Dec 2026");
  assert(monthLabel("2026-13") === "2026-13", "out-of-range month passes through");
  assert(monthLabel("nonsense") === "nonsense", "junk passes through");
});

const source = read("src/features/admin/get-cohorts.ts");

suite("join dates read joinedAt, never createdAt", () => {
  assert(source.includes("joinedAt"), "reads joinedAt");
  // createdAt may appear only as the cohort list ordering, never on an
  // enrollment select, filter or aggregate.
  const enrollmentCreatedAt =
    /programEnrollment[\s\S]{0,400}?createdAt/.test(source);
  assert(!enrollmentCreatedAt, "no createdAt on a ProgramEnrollment query");
  assert(
    !source.includes("joinedAt ?? ") && !source.includes("?? row.createdAt"),
    "no createdAt fallback for a join date",
  );
});

suite("month buckets are truncated in IST, not UTC", () => {
  assert(source.includes("date_trunc('month'"), "buckets by month");
  assert(
    source.includes("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'"),
    "converts to IST before truncating",
  );
  assert(
    !/date_trunc\('month',\s*"joinedAt"\s*\)/.test(source),
    "no bare UTC truncation",
  );
});

suite("every Prisma query uses an explicit select", () => {
  assert(!source.includes("include:"), "no include:");
  const findManyCount = (source.match(/findMany\(/g) ?? []).length;
  const findUniqueCount = (source.match(/findUnique\(/g) ?? []).length;
  assert(findManyCount === 2, "two findMany calls");
  assert(findUniqueCount === 1, "one findUnique call");
});

suite("the index does not issue a query per cohort", () => {
  const head = source.slice(
    source.indexOf("export async function getCohortIndex"),
    source.indexOf("export type CohortRosterRow"),
  );
  assert(head.length > 0, "found getCohortIndex body");
  assert(!/for\s*\([\s\S]{0,200}?await\s+prisma/.test(head), "no await in a loop");
  assert(
    !/\.map\([\s\S]{0,200}?await\s+prisma/.test(head),
    "no per-cohort query in a map",
  );
  assert(head.includes("groupBy"), "aggregates with groupBy");
});

if (failed > 0) {
  console.log(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
