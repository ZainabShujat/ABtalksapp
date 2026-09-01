import { roleFamilyFor } from "@/features/hire/role-family";
import type { JobSpec } from "@/lib/validations/hire";

/**
 * A stable signature for "the same requirement, asked again".
 *
 * Two recruiters asking for a Python/Flask/MERN full-stack developer with three
 * years in Delhi NCR are one sourcing job, even though they typed it
 * differently, listed the skills in another order, and one wrote "3+ years"
 * while the other wrote "3-5". The fingerprint is what lets the sourcing team
 * see that, without the two requests being merged into one — the requests keep
 * their own recruiter, timeline, notes and priority, and only the *work* is
 * shared.
 *
 * Deliberately lossy. Experience becomes a band and salary is dropped entirely:
 * a recruiter paying more does not change who has to be found. Anything kept
 * here is something that changes the search.
 *
 * Pure: no DB, no `server-only`, no randomness. The same spec must always
 * produce the same string, on the server and in a test.
 */

/** Skill spellings that would otherwise fingerprint as different requirements. */
const SKILL_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  node: "nodejs",
  "node.js": "nodejs",
  reactjs: "react",
  "react.js": "react",
  nextjs: "next",
  "next.js": "next",
  postgres: "postgresql",
  mongo: "mongodb",
  golang: "go",
  "c++": "cpp",
  "c#": "csharp",
  dotnet: "net",
  ".net": "net",
  k8s: "kubernetes",
  ml: "machinelearning",
  ai: "artificialintelligence",
};

/** MERN and friends name a stack, not a skill; expand so members compare. */
const STACK_EXPANSIONS: Record<string, string[]> = {
  mern: ["mongodb", "express", "react", "nodejs"],
  mean: ["mongodb", "express", "angular", "nodejs"],
  lamp: ["linux", "apache", "mysql", "php"],
  fullstack: [],
};

export function normaliseSkill(raw: string): string[] {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!key) return [];
  const expanded = STACK_EXPANSIONS[key];
  if (expanded) return expanded.length > 0 ? expanded : [];
  return [SKILL_ALIASES[key] ?? key];
}

/**
 * Order-independent by construction: the set is sorted before it is joined, so
 * ["react","python"] and ["Python","React"] reach the same string.
 */
export function normaliseSkills(raw: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const s of raw ?? []) for (const k of normaliseSkill(s)) out.add(k);
  return [...out].sort();
}

/**
 * Experience as a band, because "3+", "3-5" and "4" are the same search.
 * Bands are deliberately coarse; a year either side does not change who the
 * sourcing team goes looking for.
 */
export function experienceBand(min?: number | null, max?: number | null): string {
  const lo = typeof min === "number" ? min : typeof max === "number" ? max : null;
  if (lo === null) return "any";
  if (lo <= 1) return "0-1";
  if (lo <= 3) return "2-3";
  if (lo <= 6) return "4-6";
  if (lo <= 10) return "7-10";
  return "10+";
}

export function normaliseLocation(raw?: string | null): string {
  const v = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!v) return "any";
  // The metros people type six ways each.
  if (/^(delhi|new delhi|ncr|delhi ncr|gurgaon|gurugram|noida|faridabad)$/.test(v)) {
    return "delhi-ncr";
  }
  if (/^(bangalore|bengaluru|blr)$/.test(v)) return "bengaluru";
  if (/^(bombay|mumbai)$/.test(v)) return "mumbai";
  if (/^(madras|chennai)$/.test(v)) return "chennai";
  if (/^(calcutta|kolkata)$/.test(v)) return "kolkata";
  if (/^(remote|anywhere|work from home|wfh)$/.test(v)) return "remote";
  return v.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type RequirementFingerprint = {
  /** Stable, comparable signature. Safe to index and to show an admin. */
  key: string;
  roleFamily: string;
  skills: string[];
  experience: string;
  location: string;
  employmentType: string;
};

export function requirementFingerprint(spec: JobSpec): RequirementFingerprint {
  const skills = normaliseSkills(spec.mustHaveStack);
  const roleFamily = roleFamilyFor(spec.title ?? null);
  const experience = experienceBand(spec.minExperience, spec.maxExperience);
  const location = normaliseLocation(spec.locationCity);
  const employmentType = (spec.employmentType ?? "any").toString().toLowerCase();

  // Role first because it is the coarsest bucket, then the sorted skill set.
  // Salary is absent on purpose — see the note at the top of this file.
  const key = [
    `role:${roleFamily}`,
    `skills:${skills.join("+") || "any"}`,
    `exp:${experience}`,
    `loc:${location}`,
    `type:${employmentType}`,
  ].join("|");

  return { key, roleFamily, skills, experience, location, employmentType };
}

/**
 * How close two requirements are, 0..1, by shared must-have skills once role,
 * experience band and location already agree. The sourcing team uses this to
 * spot "near enough to reuse the same person" — it never merges anything by
 * itself.
 */
export function fingerprintSimilarity(
  a: RequirementFingerprint,
  b: RequirementFingerprint,
): number {
  if (a.key === b.key) return 1;
  if (a.roleFamily !== b.roleFamily) return 0;
  const setA = new Set(a.skills);
  const setB = new Set(b.skills);
  if (setA.size === 0 && setB.size === 0) return a.experience === b.experience ? 0.9 : 0.6;
  let shared = 0;
  for (const s of setA) if (setB.has(s)) shared += 1;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union === 0 ? 0 : shared / union;
  const expPenalty = a.experience === b.experience ? 1 : 0.8;
  const locPenalty = a.location === b.location ? 1 : 0.9;
  return Number((jaccard * expPenalty * locPenalty).toFixed(4));
}
