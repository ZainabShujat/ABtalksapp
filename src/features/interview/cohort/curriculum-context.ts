import days from "../../../../prisma/content/program/days.json";

/**
 * What the cohort was TAUGHT on a given day.
 *
 * The other half of grounding. `candidate-context.ts` answers "what did this
 * person actually submit"; this answers "what were they supposed to have
 * learned". A question generated from the target alone tends toward textbook
 * phrasing ("Why is vector search useful?"); one that also knows the day's
 * objectives and tools can ask about the thing they were actually taught to
 * build.
 *
 * `days.json` is read as a build-time import, not at runtime: it is 163 KB of
 * static content that ships with the app, and importing it keeps this module
 * pure — no fs, no `server-only` — so the generator's prompt builder stays
 * testable without a filesystem.
 *
 * NOTE ON SCOPE. This is CONTEXT for phrasing, never an assessment source. The
 * CORE targets and their expected evidence come from the question bank and
 * nowhere else; curriculum text can make a question sound informed, and cannot
 * add, remove or reweight anything that is scored.
 */

type RawDay = {
  dayNumber: number;
  moduleNumber: number;
  title: string;
  objectives?: string[];
  tools?: string[];
};

export type DayCurriculum = {
  dayNumber: number;
  title: string;
  /** What the day set out to teach. Trimmed — this feeds a prompt, not a page. */
  objectives: string[];
  tools: string[];
};

/** Objectives carried per day. Enough to characterise it, few enough to fit. */
const MAX_OBJECTIVES = 3;

const BY_DAY = new Map<number, DayCurriculum>(
  (days as RawDay[]).map((d) => [
    d.dayNumber,
    {
      dayNumber: d.dayNumber,
      title: d.title,
      objectives: (d.objectives ?? []).slice(0, MAX_OBJECTIVES),
      tools: d.tools ?? [],
    },
  ]),
);

export function curriculumForDay(dayNumber: number): DayCurriculum | null {
  return BY_DAY.get(dayNumber) ?? null;
}

/**
 * Curriculum for the days a question draws on.
 *
 * Takes the question's own `sourceDays`, so the context handed to the generator
 * is scoped to the target rather than to the whole cohort. A DAY_31 question
 * about day 24 does not need day 3's objectives in its prompt, and including
 * them would spend tokens making the question vaguer.
 */
export function curriculumForDays(dayNumbers: readonly number[]): DayCurriculum[] {
  return dayNumbers
    .map((n) => curriculumForDay(n))
    .filter((d): d is DayCurriculum => d !== null);
}

/** One compact line per day, for a prompt. */
export function describeCurriculum(dayNumbers: readonly number[]): string {
  return curriculumForDays(dayNumbers)
    .map((d) => {
      const parts = [`Day ${d.dayNumber} — ${d.title}`];
      if (d.tools.length > 0) parts.push(`tools: ${d.tools.join(", ")}`);
      if (d.objectives.length > 0) parts.push(`taught: ${d.objectives.join("; ")}`);
      return parts.join(" | ");
    })
    .join("\n");
}
