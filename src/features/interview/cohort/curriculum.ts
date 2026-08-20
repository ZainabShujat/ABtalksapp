import modulesJson from "../../../../prisma/content/program/modules.json";

/**
 * The cohort's module structure, as a pure lookup.
 *
 * Sourced from `prisma/content/program/modules.json` — the same file the seed
 * reads — so the interview can never disagree with the curriculum a member
 * actually studied. Deliberately does NOT import `days.json` (163 KB of mission
 * briefs): everything the interview needs from a day is its module, and day
 * titles already travel with each bank question as `sourceLabel`.
 *
 * Pure module: no `server-only`, no Prisma, no fs. `moduleForDay` is called from
 * scoring and from the plan builder, both of which must be testable without a
 * database.
 */

export type CurriculumModuleInfo = {
  number: number;
  title: string;
  subtitle: string;
  startDay: number;
  endDay: number;
};

export const MODULES: readonly CurriculumModuleInfo[] = (
  modulesJson as CurriculumModuleInfo[]
).map((m) => ({
  number: m.number,
  title: m.title,
  subtitle: m.subtitle,
  startDay: m.startDay,
  endDay: m.endDay,
}));

/** Highest day the curriculum defines. */
export const CURRICULUM_TOTAL_DAYS = MODULES.reduce(
  (max, m) => Math.max(max, m.endDay),
  0,
);

/**
 * Day → module, resolved once at module load.
 *
 * Built eagerly (rather than searched per call) so that a curriculum with a hole
 * or an overlap fails at import time — a day that silently mapped to no module
 * would drop that day's evidence out of module scoring without any error.
 */
const DAY_TO_MODULE: ReadonlyMap<number, CurriculumModuleInfo> = (() => {
  const map = new Map<number, CurriculumModuleInfo>();

  for (const mod of MODULES) {
    for (let day = mod.startDay; day <= mod.endDay; day += 1) {
      const existing = map.get(day);
      if (existing) {
        throw new Error(
          `[curriculum] day ${day} is claimed by module ${existing.number} ` +
            `and module ${mod.number}`,
        );
      }
      map.set(day, mod);
    }
  }

  for (let day = 1; day <= CURRICULUM_TOTAL_DAYS; day += 1) {
    if (!map.has(day)) {
      throw new Error(`[curriculum] day ${day} belongs to no module`);
    }
  }

  return map;
})();

/** The module a cohort day belongs to. Null for a day outside the curriculum. */
export function moduleForDay(day: number): CurriculumModuleInfo | null {
  return DAY_TO_MODULE.get(day) ?? null;
}

/** Module number for a day, or null. Convenience for grouping. */
export function moduleNumberForDay(day: number): number | null {
  return moduleForDay(day)?.number ?? null;
}

/**
 * Distinct modules touched by a set of days, in curriculum order. Used to say
 * "this question draws on Module 3" and to group evidence for module scoring.
 */
export function modulesForDays(days: number[]): CurriculumModuleInfo[] {
  const numbers = new Set<number>();
  for (const day of days) {
    const mod = moduleForDay(day);
    if (mod) numbers.add(mod.number);
  }
  return MODULES.filter((m) => numbers.has(m.number));
}

/** Modules fully or partly inside a blueprint's day scope. */
export function modulesInScope(scopeDays: number[]): CurriculumModuleInfo[] {
  return modulesForDays(scopeDays);
}
