#!/usr/bin/env npx tsx
/**
 * Deterministic tests for the progress summary module.
 *
 * No LLM, no network, no database — pure functions over in-memory data.
 *
 *   npx tsx scripts/test-progress-summary.ts
 */

import {
  buildProgressSummary,
  formatProgressContext,
  type CandidateProgressSummary,
} from "../src/features/interview/cohort/progress-summary";
import type { SubmittedDay } from "../src/features/interview/cohort/candidate-context";

/* ---------------------------------------------------------------- helpers */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

/** Quick submission factory. */
function sub(dayNumber: number, submittedAt: Date, p = true): SubmittedDay {
  return {
    dayNumber,
    title: `Day ${dayNumber}`,
    moduleNumber: Math.ceil(dayNumber / 8),
    passed: p,
    attempts: 1,
    repoRef: null,
    submittedAt,
  };
}

/* ------------------------------------------------------------------ tests */

console.log("\n=== Progress Summary Tests ===\n");

// ---- Test 1: On-track candidate
console.log("1. On-track candidate (DAY_15, passed through 15, unlocked to 15)");
{
  const passedDays = Array.from({ length: 15 }, (_, i) => i + 1);
  const submissions = passedDays.map((d) =>
    sub(d, new Date(`2025-06-${String(d).padStart(2, "0")}T10:00:00Z`)),
  );
  const summary = buildProgressSummary("DAY_15", 15, 15, passedDays, submissions);

  assertEq(summary.pacing, "ON_TRACK", "pacing is ON_TRACK");
  assertEq(summary.gaps.length, 0, "no gaps");
  assertEq(summary.submittedInScope, 15, "15 of 15 submitted");
  assert(!summary.caughtUp, "did not need to catch up");
  assertEq(summary.latestSubmissionDayNumber, 15, "latest is day 15");
}

// ---- Test 2: Behind candidate
console.log("\n2. Behind candidate (DAY_15, passed through 10, unlocked to 20)");
{
  const passedDays = Array.from({ length: 10 }, (_, i) => i + 1);
  const submissions = passedDays.map((d) =>
    sub(d, new Date(`2025-06-${String(d).padStart(2, "0")}T10:00:00Z`)),
  );
  const summary = buildProgressSummary("DAY_15", 10, 20, passedDays, submissions);

  assertEq(summary.pacing, "BEHIND", "pacing is BEHIND");
  assertEq(summary.gaps, [11, 12, 13, 14, 15], "gaps are 11-15");
  assertEq(summary.submittedInScope, 10, "10 of 15 submitted");
  assertEq(summary.highestUnlockedDay, 20, "unlocked to 20");
}

// ---- Test 3: Ahead candidate
console.log("\n3. Ahead candidate (DAY_15, passed through 20, unlocked to 15)");
{
  const passedDays = Array.from({ length: 20 }, (_, i) => i + 1);
  const submissions = passedDays.map((d) =>
    sub(d, new Date(`2025-06-${String(d).padStart(2, "0")}T10:00:00Z`)),
  );
  const summary = buildProgressSummary("DAY_15", 20, 15, passedDays, submissions);

  assertEq(summary.pacing, "AHEAD", "pacing is AHEAD");
  assertEq(summary.gaps.length, 0, "no gaps (all scope days passed)");
  assertEq(summary.submittedInScope, 15, "15 of 15 in scope");
}

// ---- Test 4: Candidate who fell behind and caught up
console.log("\n4. Fell behind and caught up");
{
  // Submitted days 1-5 in order, then skipped to 8-10, then went back for 6-7.
  const submissions = [
    sub(1, new Date("2025-06-01T10:00:00Z")),
    sub(2, new Date("2025-06-02T10:00:00Z")),
    sub(3, new Date("2025-06-03T10:00:00Z")),
    sub(4, new Date("2025-06-04T10:00:00Z")),
    sub(5, new Date("2025-06-05T10:00:00Z")),
    sub(8, new Date("2025-06-08T10:00:00Z")),
    sub(9, new Date("2025-06-09T10:00:00Z")),
    sub(10, new Date("2025-06-10T10:00:00Z")),
    // Went back to fill gaps
    sub(6, new Date("2025-06-11T10:00:00Z")),
    sub(7, new Date("2025-06-12T10:00:00Z")),
  ];
  const passedDays = submissions.map((s) => s.dayNumber).sort((a, b) => a - b);
  const summary = buildProgressSummary("DAY_15", 10, 12, passedDays, submissions);

  assert(summary.caughtUp, "caughtUp is true");
  assertEq(summary.gaps, [11, 12, 13, 14, 15], "gaps are the remaining ones");
}

// ---- Test 5: 1-day tolerance for ON_TRACK
console.log("\n5. One day behind still counts as ON_TRACK (tolerance)");
{
  const passedDays = Array.from({ length: 14 }, (_, i) => i + 1);
  const submissions = passedDays.map((d) =>
    sub(d, new Date(`2025-06-${String(d).padStart(2, "0")}T10:00:00Z`)),
  );
  const summary = buildProgressSummary("DAY_15", 14, 15, passedDays, submissions);

  assertEq(summary.pacing, "ON_TRACK", "1 day behind is still ON_TRACK");
}

// ---- Test 6: DAY_31 blueprint
console.log("\n6. DAY_31 blueprint");
{
  const passedDays = Array.from({ length: 25 }, (_, i) => i + 1);
  const submissions = passedDays.map((d) =>
    sub(d, new Date(`2025-06-${String(d).padStart(2, "0")}T10:00:00Z`)),
  );
  const summary = buildProgressSummary("DAY_31", 25, 30, passedDays, submissions);

  assertEq(summary.milestoneDayExpected, 31, "milestone is 31");
  assertEq(summary.pacing, "BEHIND", "behind (25 vs 30)");
  assertEq(summary.gaps, [26, 27, 28, 29, 30, 31], "gaps are 26-31");
}

// ---- Test 7: No submissions at all
console.log("\n7. No submissions");
{
  const summary = buildProgressSummary("DAY_15", 0, 10, [], []);
  assertEq(summary.submittedInScope, 0, "0 submitted");
  assertEq(summary.pacing, "BEHIND", "behind with nothing submitted");
  assertEq(summary.gaps.length, 15, "all 15 days are gaps");
  assertEq(summary.latestSubmissionDayNumber, null, "no latest");
  assert(!summary.caughtUp, "cannot catch up with nothing");
}

// ---- Test 8: formatProgressContext produces stable output
console.log("\n8. formatProgressContext output is stable and compact");
{
  const summary: CandidateProgressSummary = {
    blueprint: "DAY_15",
    milestoneDayExpected: 15,
    progressDayAtInterview: 12,
    highestUnlockedDay: 15,
    pacing: "BEHIND",
    submittedInScope: 12,
    totalInScope: 15,
    gaps: [13, 14, 15],
    caughtUp: false,
    latestSubmissionDayNumber: 12,
  };

  const text = formatProgressContext(summary);
  assert(text.includes("DAY_15"), "contains blueprint");
  assert(text.includes("12 of 15"), "contains submission count");
  assert(text.includes("behind cohort pace"), "contains pacing label");
  assert(text.includes("13, 14, 15"), "contains gap days");
  assert(!text.includes("caught up"), "does not mention catch-up when false");
  assert(text.split("\n").length <= 10, "compact — 10 lines or fewer");
}

// ---- Test 9: formatProgressContext with catch-up
console.log("\n9. formatProgressContext includes catch-up pattern");
{
  const summary: CandidateProgressSummary = {
    blueprint: "DAY_15",
    milestoneDayExpected: 15,
    progressDayAtInterview: 15,
    highestUnlockedDay: 15,
    pacing: "ON_TRACK",
    submittedInScope: 15,
    totalInScope: 15,
    gaps: [],
    caughtUp: true,
    latestSubmissionDayNumber: 15,
  };

  const text = formatProgressContext(summary);
  assert(text.includes("caught up"), "mentions catch-up pattern");
}

// ---- Test 10: Many gaps are truncated
console.log("\n10. Many gaps get truncated in format");
{
  const summary: CandidateProgressSummary = {
    blueprint: "DAY_31",
    milestoneDayExpected: 31,
    progressDayAtInterview: 5,
    highestUnlockedDay: 25,
    pacing: "BEHIND",
    submittedInScope: 5,
    totalInScope: 31,
    gaps: Array.from({ length: 26 }, (_, i) => i + 6),
    caughtUp: false,
    latestSubmissionDayNumber: 5,
  };

  const text = formatProgressContext(summary);
  assert(text.includes("and 18 more"), "truncates long gap list");
}

/* ---------------------------------------------------------------- report */

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
