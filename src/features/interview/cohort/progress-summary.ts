/**
 * A compact, deterministic summary of the candidate's progress through the
 * cohort, computed ONCE at interview open and frozen into the plan.
 *
 * No model, no network — pure arithmetic over the `CohortCandidateContext` that
 * `buildCohortCandidateContext` already loads. The only purpose is to give the
 * live interviewer occasional conversational awareness ("you caught up after
 * falling behind") without passing the raw submission history into every turn.
 *
 * THE SCORING RULE: this module must NEVER be imported by scoring, evidence,
 * rubric, or report-generation code. It is context for the conversation, not
 * input to the assessment.
 */

import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { maxScopeDay } from "@/features/interview/cohort/blueprint";
import type { SubmittedDay } from "@/features/interview/cohort/candidate-context";

/* ------------------------------------------------------------------ types */

export type ProgressPacing = "AHEAD" | "ON_TRACK" | "BEHIND";

export type CandidateProgressSummary = {
  blueprint: InterviewBlueprintKey;
  /** The milestone day this interview covers (15 or 31). */
  milestoneDayExpected: number;
  /** Highest PASSED day at the time the interview opened. */
  progressDayAtInterview: number;
  /**
   * Highest day UNLOCKED (available or passed) — the cohort's pace indicator.
   * When a member has unlocked day 25 but only submitted through day 20,
   * `unlockedDay - progressDayAtInterview` is the gap.
   */
  highestUnlockedDay: number;
  /** AHEAD: progress > unlocked scope, ON_TRACK: same, BEHIND: progress < unlocked. */
  pacing: ProgressPacing;
  /** Days within the blueprint scope that have a passing submission. */
  submittedInScope: number;
  /** Days the blueprint scope covers. */
  totalInScope: number;
  /**
   * Day numbers within the blueprint scope that have NO passing submission.
   * Empty when the member completed every day up to the milestone.
   */
  gaps: number[];
  /**
   * True when the member once had gaps but later submitted them — the
   * "fell behind and caught up" pattern.
   */
  caughtUp: boolean;
  /** Latest submission day number within scope, or null if none. */
  latestSubmissionDayNumber: number | null;
};

/* --------------------------------------------------------------- builder */

/**
 * Builds the progress summary from data already loaded by
 * `buildCohortCandidateContext` plus `highestUnlockedDay` from the member row.
 *
 * ALL inputs are database rows; nothing is inferred or generated.
 *
 * `highestUnlockedDay` comes from `ProgramMember.highestUnlockedDay` — the
 * furthest day the cohort timeline (or an admin override) has unlocked for this
 * member. When it exceeds `progressDay` the member is behind pace.
 */
export function buildProgressSummary(
  blueprint: InterviewBlueprintKey,
  progressDay: number,
  highestUnlockedDay: number,
  passedDays: number[],
  submissions: SubmittedDay[],
): CandidateProgressSummary {
  const milestoneDayExpected = maxScopeDay(blueprint);
  const passedSet = new Set(passedDays);
  const scopeEnd = milestoneDayExpected;

  // Days within scope with a PASSING submission.
  const submittedInScope = passedDays.filter((d) => d <= scopeEnd).length;

  // Gaps: scope days with no passing submission.
  const gaps: number[] = [];
  for (let day = 1; day <= scopeEnd; day++) {
    if (!passedSet.has(day)) gaps.push(day);
  }

  // Pacing: compare how far the member has passed vs what the cohort has
  // unlocked. "On track" has a 1-day tolerance so a member who just submitted
  // yesterday is not called behind.
  const effectiveUnlocked = Math.min(highestUnlockedDay, milestoneDayExpected);
  let pacing: ProgressPacing;
  if (progressDay >= effectiveUnlocked) {
    pacing = progressDay > effectiveUnlocked ? "AHEAD" : "ON_TRACK";
  } else if (effectiveUnlocked - progressDay <= 1) {
    pacing = "ON_TRACK";
  } else {
    pacing = "BEHIND";
  }

  // Caught up: there were intermediate gaps that were later filled. A member
  // who submitted day 5 on day 10 but has since passed it "caught up" on that
  // gap. Detected by checking if any day within the scope was submitted out of
  // order (its submittedAt is LATER than a higher day's submittedAt).
  const scopeSubmissions = submissions
    .filter((s) => s.dayNumber <= scopeEnd && s.passed)
    .sort((a, b) => a.dayNumber - b.dayNumber);

  let caughtUp = false;
  if (scopeSubmissions.length >= 2) {
    // If any earlier day was submitted after a later day, they fell behind and
    // then went back to fill it.
    let latestSeenTs = 0;
    const submissionTsByDay = new Map(
      scopeSubmissions.map((s) => [s.dayNumber, s.submittedAt.getTime()]),
    );
    for (let day = 1; day <= scopeEnd; day++) {
      const ts = submissionTsByDay.get(day);
      if (!ts) continue;
      if (ts < latestSeenTs) {
        caughtUp = true;
        break;
      }
      latestSeenTs = Math.max(latestSeenTs, ts);
    }
  }

  const latestSubmissionDayNumber =
    scopeSubmissions.length > 0
      ? scopeSubmissions[scopeSubmissions.length - 1]!.dayNumber
      : null;

  return {
    blueprint,
    milestoneDayExpected,
    progressDayAtInterview: progressDay,
    highestUnlockedDay,
    pacing,
    submittedInScope,
    totalInScope: scopeEnd,
    gaps,
    caughtUp,
    latestSubmissionDayNumber,
  };
}

/* -------------------------------------------------------------- formatter */

const PACING_LABEL: Record<ProgressPacing, string> = {
  AHEAD: "ahead of cohort pace",
  ON_TRACK: "on track with cohort pace",
  BEHIND: "behind cohort pace",
};

/**
 * Renders the summary into a compact text block for the LLM prompt.
 *
 * ~100–200 tokens — small enough to never crowd the context window, large
 * enough to carry every signal the interviewer might naturally reference.
 */
export function formatProgressContext(
  summary: CandidateProgressSummary,
): string {
  const lines: string[] = [
    `Interview: ${summary.blueprint} (covers days 1–${summary.milestoneDayExpected})`,
    `Submissions completed in scope: ${summary.submittedInScope} of ${summary.totalInScope}`,
    `Progress day (highest passed): ${summary.progressDayAtInterview}`,
    `Cohort unlocked up to day: ${summary.highestUnlockedDay}`,
    `Pacing: ${PACING_LABEL[summary.pacing]}`,
  ];

  if (summary.gaps.length > 0 && summary.gaps.length <= 10) {
    lines.push(`Days not yet submitted: ${summary.gaps.join(", ")}`);
  } else if (summary.gaps.length > 10) {
    lines.push(
      `Days not yet submitted: ${summary.gaps.slice(0, 8).join(", ")} and ${summary.gaps.length - 8} more`,
    );
  }

  if (summary.caughtUp) {
    lines.push("Pattern: fell behind at some point and later caught up");
  }

  return lines.join("\n");
}
