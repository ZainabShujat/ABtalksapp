/**
 * Pure helpers shared by the candidate repositories: month/date packing, the
 * primary-row precedence rule, and merged experience duration.
 *
 * Deliberately dependency-free — no Prisma client, no `server-only`. Both
 * `candidate.ts` (which projects the legacy-shaped identity view) and
 * `candidate-detail.ts` (which writes the structured rows) need this rule, and
 * it must exist in exactly one place or the two will drift.
 */

/** Month/year → the first of that month, UTC. `CandidateExperience` uses @db.Date. */
export function toMonthDate(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function splitMonthDate(date: Date | null): {
  month: number | null;
  year: number | null;
} {
  if (!date) return { month: null, year: null };
  return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

/* ─── Primary-row precedence ─────────────────────────────────────────────── */

/**
 * Which single education row stands in for the candidate when a legacy surface
 * can only hold one. Pure and exported so the rule is testable and lives in
 * exactly one place.
 *
 *   1. currently studying (latest start wins among several)
 *   2. otherwise the most recent end date
 *   3. otherwise the lowest sortOrder, then the newest row
 */
export function pickPrimaryEducation<
  T extends {
    isCurrent: boolean;
    startYear: number | null;
    startMonth: number | null;
    graduationYear: number | null;
    endMonth: number | null;
    sortOrder: number;
  },
>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null;

  const startKey = (r: T) => (r.startYear ?? 0) * 12 + (r.startMonth ?? 1);
  const endKey = (r: T) => (r.graduationYear ?? 0) * 12 + (r.endMonth ?? 12);

  const current = rows.filter((r) => r.isCurrent);
  if (current.length > 0) {
    return [...current].sort((a, b) => startKey(b) - startKey(a))[0]!;
  }

  const dated = rows.filter((r) => r.graduationYear !== null);
  if (dated.length > 0) {
    return [...dated].sort((a, b) => endKey(b) - endKey(a))[0]!;
  }

  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
}

/**
 *   1. currently working (latest start wins among several)
 *   2. otherwise the most recently ended
 *   3. otherwise the latest start
 */
export function pickPrimaryExperience<
  T extends {
    isCurrent: boolean;
    startMonth: number;
    startYear: number;
    endMonth: number | null;
    endYear: number | null;
  },
>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null;

  const startKey = (r: T) => r.startYear * 12 + r.startMonth;
  const endKey = (r: T) => (r.endYear ?? 0) * 12 + (r.endMonth ?? 12);

  const current = rows.filter((r) => r.isCurrent);
  if (current.length > 0) {
    return [...current].sort((a, b) => startKey(b) - startKey(a))[0]!;
  }

  const ended = rows.filter((r) => r.endYear !== null);
  if (ended.length > 0) {
    return [...ended].sort((a, b) => endKey(b) - endKey(a))[0]!;
  }

  return [...rows].sort((a, b) => startKey(b) - startKey(a))[0]!;
}

/**
 * Total months of experience across every role, merging overlaps.
 *
 * A plain sum would double-count someone who held two internships at once, and
 * `StudentProfile.yearsExperience` feeds `/hire`'s "minimum years" filter — so
 * the number has to be the span actually worked, not the sum of the rows.
 */
export function totalExperienceMonths(
  rows: readonly {
    startMonth: number;
    startYear: number;
    endMonth: number | null;
    endYear: number | null;
    isCurrent: boolean;
  }[],
  now: Date = new Date(),
): number {
  if (rows.length === 0) return 0;
  const nowKey = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);

  // Inclusive month keys: Jan 2024 → Jan 2024 is one month worked.
  const spans = rows
    .map((r) => {
      const start = r.startYear * 12 + r.startMonth;
      const end =
        r.isCurrent || r.endYear === null
          ? nowKey
          : r.endYear * 12 + (r.endMonth ?? 12);
      return { start, end: Math.max(start, end) };
    })
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    // `<= end + 1` also joins back-to-back roles, which are continuous service.
    if (last && span.start <= last.end + 1) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  return merged.reduce((sum, s) => sum + (s.end - s.start + 1), 0);
}
