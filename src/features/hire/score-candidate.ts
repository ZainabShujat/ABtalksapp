import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { canonicalSkillName } from "@/lib/skill-catalog";
import type { JobSpec } from "@/lib/validations/hire";
import {
  parseRoleQuery,
  roleSkillFit,
  roleTitleFit,
  type RoleQuery,
  type SkillFit,
  type TitleFit,
} from "@/features/hire/role-match";
import type {
  EvidenceCoverage,
  MatchTier,
  ScoreBreakdown,
  ScoreDimension,
  ScoreableMember,
  ScoredCandidate,
} from "@/features/hire/types";

/**
 * Default dimension weights — the evidence seven sum to 100 before priority and
 * coverage.
 *
 * `role` sits on top of them and is zeroed unless the recruiter named a role, so
 * it only ever takes a share when there is a role to fit. With one named it is
 * about a sixth of a full cohort rubric, and two fifths of a profile-only one,
 * where declared skills and titles are all there is to rank on.
 */
const BASE_WEIGHTS: Record<ScoreDimension, number> = {
  stack: 25,
  missions: 20,
  cleanPass: 15,
  projects: 15,
  consistency: 10,
  interview: 10,
  experience: 5,
  role: 20,
};

/** Everything counts, for callers that have no pool to measure. */
const FULL_COVERAGE: EvidenceCoverage = {
  dimensions: {
    stack: true,
    missions: true,
    cleanPass: true,
    projects: true,
    consistency: true,
    interview: true,
    experience: true,
    role: true,
  },
  note: "Ranked on all 7 evidence dimensions.",
};

/**
 * Total curriculum days minus the three waived at enrolment — the most
 * missions anybody can actually earn.
 */
const MAX_EARNABLE_MISSIONS = 28;

/** Map recruiter evidence-priority tokens → score dimensions. */
const PRIORITY_TO_DIM: Record<string, keyof typeof BASE_WEIGHTS> = {
  missions: "missions",
  code_correctness: "missions",
  clean_pass: "cleanPass",
  first_attempt: "cleanPass",
  projects: "projects",
  project_quality: "projects",
  consistency: "consistency",
  commit: "consistency",
  ship_speed: "consistency",
  interview: "interview",
  communication: "interview",
  stack: "stack",
  data: "stack",
  ai_prompting: "stack",
  sql: "stack",
};

function normToken(s: string): string {
  return s.trim().toLowerCase().replace(/[\s/_-]+/g, " ");
}

/**
 * The shortest token allowed to match by containment.
 *
 * Bare substring matching made "react" match a candidate whose only skills were
 * "Python" and "C" — because `"react".includes("c")` is true. Single-letter
 * languages are real ("C", "R", "Go"), so they cannot be dropped from a skill
 * list; they simply must not be allowed to match *inside* a longer word.
 */
const MIN_CONTAINMENT_LENGTH = 3;

/** Is `needle` present in `haystack` as a whole word rather than a fragment? */
function containsWord(haystack: string, needle: string): boolean {
  if (needle.length < MIN_CONTAINMENT_LENGTH) return false;
  const i = haystack.indexOf(needle);
  if (i === -1) return false;
  // "js" inside "js" is a word; "java" inside "javascript" is not. Punctuation
  // and spaces bound a word — "react" matches "react.js" and "react native".
  const before = i === 0 ? "" : haystack[i - 1]!;
  const after = haystack[i + needle.length] ?? "";
  const isBoundary = (c: string) => c === "" || !/[a-z0-9]/.test(c);
  return isBoundary(before) && isBoundary(after);
}

/**
 * The parts of a compound skill — "AI/ML" → ai, ml; "Git & GitHub" → git,
 * github — or none for a single skill.
 *
 * Compounds stay whole on the dossier (see `splitSkills`), so a two-letter part
 * can no longer be reached by containment. Each part is a whole token in its own
 * right, so it matches by equality: "ML" finds "AI/ML" and "C" finds "C/C++",
 * while "C" still never matches inside "C++" or "react".
 */
function compoundParts(skill: string): string[] {
  const parts = skill.split(/\s*\/\s*|\s+(?:and|&)\s+/i);
  return parts.length > 1 ? parts.map(normToken).filter(Boolean) : [];
}

/** Letters and digits only: "Tailwind CSS", "TailwindCSS", "tailwind-css" collide. */
function squashToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The same skill under two spellings.
 *
 * `skill-catalog.ts` exists to fold how people actually type onto one name —
 * "golang" → Go, "reactjs" → React, "k8s" → Kubernetes, "cpp" → C++ — and search
 * ignored it: a "reactjs" requirement found none of the 17 searchable React
 * candidates (QA-KI-009). Both sides now fold through the catalog.
 *
 * Squash equality covers spellings the catalog has not heard of ("Nest JS" /
 * "NestJS"), but never for names whose symbols ARE the name: "C", "C++" and "C#"
 * all squash to "c". Three characters is the floor for the same reason
 * `containsWord` has one.
 */
function sameSkill(a: string, b: string): boolean {
  if (canonicalSkillName(a).toLowerCase() === canonicalSkillName(b).toLowerCase()) {
    return true;
  }
  if (/[+#]/.test(a) || /[+#]/.test(b)) return false;
  const sa = squashToken(a);
  if (sa.length >= 3 && sa === squashToken(b)) return true;
  const ka = spellingKey(a);
  return ka.length >= 3 && ka === spellingKey(b);
}

/**
 * Two spelling differences that never change the skill: "&" for "and", and a
 * plural. "Data Structures and Algorithms", "Data structures & Algorithm" and
 * "DSA" (a catalog alias) are one skill.
 *
 * The plural fold is deliberately narrow: only a word of five or more letters,
 * and never an "s" after s / j / u / i, so "NestJS", "Express", "Status" and
 * "Analysis" keep their final letter.
 */
function spellingKey(raw: string): string {
  return squashToken(
    canonicalSkillName(raw)
      .toLowerCase()
      .replace(/\s*&\s*/g, " and ")
      .replace(/\b([a-z]{3,}[^\W\dsjui])s\b/g, "$1"),
  );
}

function stackTokensMatch(have: string[], need: string): boolean {
  const n = normToken(need);
  if (!n) return true;
  return have.some((h) => {
    const x = normToken(h);
    if (x === n || containsWord(x, n) || containsWord(n, x)) return true;
    const parts = compoundParts(h);
    if (parts.includes(n)) return true;
    return sameSkill(h, need) || parts.some((p) => sameSkill(p, need));
  });
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

type WorkMode = "REMOTE" | "HYBRID" | "ONSITE" | "FLEXIBLE";

/**
 * One work-mode vocabulary for both sides of the filter.
 *
 * `/profile` stores the PICKER LABELS on `CandidatePreference.remotePreference`
 * — "Remote", "Hybrid", "On-site", "Flexible" (`candidate-vocab.ts`) — while a
 * recruiter spec carries the ENUMS. Comparing them literally excluded every
 * candidate who had ever chosen a work mode, exact matches included: a
 * "Remote" candidate failed a REMOTE search, and "Flexible" failed all of them.
 * The 2026-09-16 audit found 9 candidates hidden this way across 43 searches.
 *
 * An unparseable value reads as UNSTATED rather than as a mismatch. A string
 * nobody can interpret is not evidence that the candidate refused the role, and
 * the null convention here has always been "unstated never excludes".
 */
function normalizeWorkMode(raw: string | null | undefined): WorkMode | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "remote" || key === "wfh" || key === "workfromhome") return "REMOTE";
  if (key === "hybrid") return "HYBRID";
  if (key === "onsite" || key === "inoffice" || key === "office") return "ONSITE";
  if (key === "flexible" || key === "any") return "FLEXIBLE";
  return null;
}

/**
 * The budget to filter on, or null when the recruiter never set one.
 *
 * `skip:salary` stores 0/0 as "not decided" (`scout-conversation.ts`, and
 * `hire-filter-dialog.ts` reads it back the same way). Treated as a real
 * ceiling it excluded everyone who had stated any salary expectation.
 */
function effectiveBudget(spec: JobSpec): number | null {
  if (spec.salaryMax == null) return null;
  if (spec.salaryMax === 0 && (spec.salaryMin ?? 0) === 0) return null;
  return spec.salaryMax;
}

/** Recruiter-side sentinels that mean "no city", not a city with that name. */
const ANY_CITY = /^(any|any city|anywhere)$/i;

/**
 * One spelling per city, for renames and misspellings that cannot mean anything
 * else. Keyed by letters only.
 *
 * Scout itself rewrites "bangalore" to "Bengaluru", so a candidate who typed
 * "Bangalore" was filtered out of every Bengaluru search (QA-KI-009). Regions are
 * deliberately absent: "Delhi NCR" contains Noida, but a recruiter asking for
 * Noida has not agreed to Gurugram, so NCR cities are never folded together.
 */
const CITY_ALIASES: Record<string, string> = {
  bangalore: "bengaluru",
  banglore: "bengaluru",
  bangaluru: "bengaluru",
  bengluru: "bengaluru",
  blr: "bengaluru",
  bombay: "mumbai",
  newdelhi: "delhi",
  gurgaon: "gurugram",
  hydrabad: "hyderabad",
  hyd: "hyderabad",
  madras: "chennai",
  calcutta: "kolkata",
  poona: "pune",
  mysore: "mysuru",
  cochin: "kochi",
  trivandrum: "thiruvananthapuram",
  vizag: "visakhapatnam",
};

function cityKey(raw: string): string {
  const letters = raw.toLowerCase().replace(/[^a-z]/g, "");
  return CITY_ALIASES[letters] ?? normToken(raw);
}

/** The city to filter on, or null when the recruiter skipped the question. */
function effectiveCity(spec: JobSpec): string | null {
  const city = spec.locationCity?.trim();
  if (!city || ANY_CITY.test(city)) return null;
  return city;
}

/**
 * Weights for this search: recruiter priorities applied, then dimensions the
 * pool cannot produce dropped and their share redistributed.
 *
 * The redistribution is the important half. Projects and interviews are worth
 * 25 of the 100 points and are cohort milestones — on a cohort that has not
 * reached them, every member scores zero on a quarter of the rubric and the
 * best person on the platform cannot clear the STRONG threshold. Scoring an
 * absent milestone as a failure does not rank anybody; it just compresses
 * everyone toward the bottom. So an uncovered dimension leaves the rubric
 * entirely, and the recruiter is told which ones did (see `EvidenceCoverage`).
 */
function reweight(
  priority: string[] | undefined,
  coverage: EvidenceCoverage = FULL_COVERAGE,
  roleAsked = false,
): Record<ScoreDimension, number> {
  const w = { ...BASE_WEIGHTS };
  // No role named, no role dimension: the other weights rescale exactly as they
  // did before it existed.
  if (!roleAsked) w.role = 0;
  const boost = new Set<ScoreDimension>();
  for (const p of priority ?? []) {
    const key = PRIORITY_TO_DIM[normToken(p).replace(/ /g, "_")] ??
      PRIORITY_TO_DIM[normToken(p)];
    if (key) boost.add(key);
  }
  for (const dim of boost) {
    w[dim] = Math.round(w[dim] * 1.5);
  }
  for (const k of Object.keys(w) as ScoreDimension[]) {
    if (!coverage.dimensions[k]) w[k] = 0;
  }
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  // Every dimension uncovered would mean nothing to rank on. Fall back to the
  // declared dimensions rather than dividing by zero.
  if (sum <= 0) {
    return { ...BASE_WEIGHTS, missions: 0, cleanPass: 0, projects: 0, consistency: 0, interview: 0, stack: 83.3, experience: 16.7, role: 0 };
  }
  const scale = 100 / sum;
  for (const k of Object.keys(w) as ScoreDimension[]) {
    w[k] = Math.round(w[k] * scale * 10) / 10;
  }
  return w;
}

/**
 * @param roleSkills the role's typical-skill fit, used only when the recruiter
 *   named no skills at all. Without it every candidate scored the same neutral
 *   0.5 on a title-only search, and the stack dimension ranked nobody.
 */
function stackScore(
  memberSkills: string[],
  spec: JobSpec,
  roleSkills: SkillFit | null = null,
): { score: number; missing: string[] } {
  const must = spec.mustHaveStack ?? [];
  const nice = spec.niceToHaveStack ?? [];
  const missing = must.filter((m) => !stackTokensMatch(memberSkills, m));
  if (must.length === 0 && nice.length === 0) {
    return { score: roleSkills ? roleSkills.fit : 0.5, missing: [] };
  }
  const mustHit = must.length === 0 ? 1 : (must.length - missing.length) / must.length;
  const niceHit =
    nice.length === 0
      ? 0.5
      : nice.filter((n) => stackTokensMatch(memberSkills, n)).length / nice.length;
  // Must-haves dominate; nice-to-have fills the rest.
  const score = must.length === 0 ? niceHit : mustHit * 0.75 + niceHit * 0.25;
  return { score: clamp01(score), missing };
}

/**
 * Missions earned, measured against the missions there has been time to earn.
 *
 * Was `missionPoints / 240`, which is two mistakes at once. `missionPoints`
 * includes the three days waived at enrolment, so it credits work nobody did;
 * and 240 assumes a finished cohort, so on day 14 a member who has passed
 * everything available scores 0.7 and one who has passed nothing scores 0.15 —
 * a gap far too small to rank on.
 */
export function missionScore(
  missionsPassed: number,
  cohortDay: number,
  maxEarnable: number = MAX_EARNABLE_MISSIONS,
): number {
  const earnable = Math.max(3, Math.min(cohortDay, maxEarnable));
  return clamp01(missionsPassed / earnable);
}

/** Share of earned passes that passed on the first verification run. */
export function cleanPassScore(cleanPassCount: number, missionsPassed: number): number {
  if (missionsPassed <= 0) return 0;
  return clamp01(cleanPassCount / missionsPassed);
}

export function projectScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const best = Math.max(...scores);
  return clamp01((mean * 0.6 + best * 0.4) / 100);
}

/** Commit days against days elapsed — showing up daily is the signal, and on
 *  day 14 nobody can have 20 of them. */
export function consistencyScore(
  commitDays: number,
  cohortDay: number,
  window = 30,
): number {
  return clamp01(commitDays / Math.max(5, Math.min(cohortDay, window)));
}

export function interviewScore(
  interview: ScoreableMember["interview"],
): number {
  if (!interview) return 0;
  const parts = [interview.comm, interview.tech, interview.problem, interview.overall]
    .filter((n): n is number => typeof n === "number");
  if (parts.length === 0) return 0;
  const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
  return clamp01(mean / 100);
}

function experienceScore(
  years: number,
  min: number | null | undefined,
  max: number | null | undefined,
): number {
  if (min == null && max == null) return 0.7;
  const lo = min ?? 0;
  const hi = max ?? lo + 10;
  if (years >= lo && years <= hi) return 1;
  if (years < lo) return clamp01(1 - (lo - years) / Math.max(lo, 3));
  return clamp01(1 - (years - hi) / Math.max(hi, 3));
}

function tierFor(
  score: number,
  missingMust: string[],
  missionsPassed = 1,
  roleMismatch = false,
): MatchTier {
  if (missingMust.length > 0) {
    return score >= 40 ? "PARTIAL" : "NONE";
  }
  // STRONG is also a claim about fit. A cohort graduate with a strong record
  // and nothing — no title, no typical skill — connecting them to the role
  // asked for is a strong candidate, not a strong match for THIS role. Before
  // the role counted, the same six such people headed every title-only search.
  if (roleMismatch && score >= 70) return "PARTIAL";
  // STRONG is a claim about proven work, so it cannot be reached without any.
  //
  // Dropping the uncovered dimensions leaves declared skills carrying most of
  // the weight, and a member who has passed nothing was scoring 69 on a typed
  // skill list alone. The score is a fair reading of the evidence available;
  // the tier is what a recruiter acts on, and it must not promise a track
  // record that does not exist.
  if (score >= 70) return missionsPassed > 0 ? "STRONG" : "PARTIAL";
  if (score >= 40) return "PARTIAL";
  return "NONE";
}

/**
 * Hard filters + availability. Does not score — used before weighting.
 * Members failing hard filters get hardFiltered=true and score 0.
 */
export function evaluateHardFilters(
  member: ScoreableMember,
  spec: JobSpec,
): { ok: boolean; reasons: string[]; missingMust: string[] } {
  const reasons: string[] = [];

  if (!member.hasVisibilityConsent) {
    reasons.push("No recruiter-visibility consent");
  }
  if (!member.cohortPublished) {
    reasons.push("Cohort results not published");
  }
  if (member.status !== "ENROLLED" && member.status !== "COMPLETED") {
    reasons.push(`Status ${member.status} not eligible`);
  }

  const must = spec.mustHaveStack ?? [];
  const missingMust = must.filter((m) => !stackTokensMatch(member.skills, m));
  // Must-have stack is a soft-hard hybrid: missing must-haves do not hard-exclude
  // so PARTIAL near-misses can power the gap report. They block STRONG via tierFor.

  const avail = member.availability;
  if (avail) {
    const extra = (spec.extra ?? {}) as Record<string, unknown>;
    if (extra.openToWork === true && !avail.openToWork) {
      reasons.push("Not open to work");
    }
    const budget = effectiveBudget(spec);
    if (
      budget != null &&
      avail.expectedSalaryMin != null &&
      avail.expectedSalaryMin > budget
    ) {
      reasons.push("Expected salary above budget");
    }
    if (
      spec.noticePeriodDays != null &&
      avail.noticePeriodDays != null &&
      avail.noticePeriodDays > spec.noticePeriodDays
    ) {
      reasons.push("Notice period too long");
    }
    // Engagement type: ANY overlap. An EMPTY list means the candidate never
    // said, which must not exclude them — the same convention `availability ==
    // null` already uses. Only a stated list that omits the asked-for type is a
    // real mismatch.
    if (
      spec.employmentType &&
      avail.opportunityTypes.length > 0 &&
      !avail.opportunityTypes.includes(spec.employmentType)
    ) {
      reasons.push("Not open to this engagement type");
    }
    const wantedMode = normalizeWorkMode(spec.workMode);
    const candidateMode = normalizeWorkMode(avail.preferredWorkMode);
    if (
      wantedMode &&
      wantedMode !== "FLEXIBLE" &&
      candidateMode &&
      candidateMode !== "FLEXIBLE" &&
      candidateMode !== wantedMode
    ) {
      reasons.push("Work mode mismatch");
    }
    const wantedCity = effectiveCity(spec);
    if (
      wantedCity &&
      !avail.openToRelocate &&
      avail.preferredCities.length > 0
    ) {
      const city = cityKey(wantedCity);
      const hit = avail.preferredCities.some((c) => {
        const have = cityKey(c);
        return have === city || have.includes(city) || city.includes(have);
      });
      if (!hit) reasons.push("Location mismatch");
    }
  }

  return { ok: reasons.length === 0, reasons, missingMust };
}

/**
 * Deterministic 0–100 score. No LLM. Pure function of member + spec.
 */

/**
 * Years a seniority label implies, used only when the recruiter gave no band.
 *
 * `seniority` was asked, stored, shown in the requirement panel — and read by
 * nothing. An "Intern" requirement scored identically to a "Lead" one. It is a
 * soft signal rather than a filter: the label is the recruiter's shorthand, and
 * the evidence still decides the ranking.
 */
const SENIORITY_BAND: Record<string, { min: number; max: number }> = {
  INTERN: { min: 0, max: 1 },
  JUNIOR: { min: 0, max: 2 },
  MID: { min: 2, max: 5 },
  SENIOR: { min: 5, max: 12 },
  LEAD: { min: 8, max: 25 },
};

/**
 * The experience band to score against.
 *
 * An explicit band always wins. "Evidence only" stores 0–50, which is the
 * recruiter saying they do not want an experience filter — so seniority must
 * not quietly reimpose one.
 */
function effectiveExperienceBand(spec: {
  seniority?: string | null;
  minExperience?: number | null;
  maxExperience?: number | null;
}): { min: number | null | undefined; max: number | null | undefined } {
  const explicit =
    spec.minExperience != null &&
    spec.maxExperience != null &&
    !(spec.minExperience === 0 && spec.maxExperience >= 50);
  if (explicit || !spec.seniority) {
    return { min: spec.minExperience, max: spec.maxExperience };
  }
  const band = SENIORITY_BAND[spec.seniority];
  return band ? { min: band.min, max: band.max } : { min: null, max: null };
}

/** Parsed once per distinct title; a search scores the whole pool against one. */
const roleQueryCache = new Map<string, RoleQuery | null>();

function roleQueryFor(title: string | null | undefined): RoleQuery | null {
  const key = title ?? "";
  if (!roleQueryCache.has(key)) {
    if (roleQueryCache.size >= 500) roleQueryCache.clear();
    roleQueryCache.set(key, parseRoleQuery(title));
  }
  return roleQueryCache.get(key) ?? null;
}

export type RoleAssessment = {
  query: RoleQuery;
  title: TitleFit;
  /** Null when the role has no typical skills to count. */
  skills: SkillFit | null;
  /**
   * Nothing connects this candidate to the role: no title reads as it or a
   * close neighbour, and not one typical skill. Only judged when the recruiter
   * named no must-have skills — a stated must-have is their own definition of
   * relevance, and it already gates STRONG.
   */
  mismatch: boolean;
};

/** Title fit this strong or better counts as a connection to the role. */
const ROLE_CONNECTED_TITLE_FIT = 0.5;

/** The role reading for one candidate, or null when no role was asked. */
export function assessRole(member: ScoreableMember, spec: JobSpec): RoleAssessment | null {
  const query = roleQueryFor(spec.title);
  if (!query) return null;
  const titles = member.roleTitles ?? (member.jobRole ? [member.jobRole] : []);
  const title = roleTitleFit(query, titles);
  const skills = roleSkillFit(query, member.skills, stackTokensMatch);
  const mismatch =
    (spec.mustHaveStack ?? []).length === 0 &&
    title.fit < ROLE_CONNECTED_TITLE_FIT &&
    (skills == null || skills.hits.length === 0);
  return { query, title, skills, mismatch };
}

export function scoreCandidate(
  member: ScoreableMember,
  spec: JobSpec,
  searchCoverage: EvidenceCoverage = FULL_COVERAGE,
): ScoredCandidate {
  // A candidate carrying its own coverage is scored against what its track can
  // produce, not against what the widest pool in the search happened to have.
  const coverage = member.coverage ?? searchCoverage;
  const source = member.source ?? "PROGRAM";
  const candidateRef = member.candidateRef ?? encodeCandidateRef(source, member.id);
  const programMemberId = source === "PROGRAM" ? member.id : null;

  const { ok, reasons, missingMust } = evaluateHardFilters(member, spec);
  const availabilityUnknown = member.availability == null;
  // A status carried to the card, not an input to anything below. Nobody is
  // ranked up for looking or down for not — see the note on ScoredCandidate.
  const openToWork = member.availability?.openToWork === true;

  const role = assessRole(member, spec);
  const stack = stackScore(member.skills, spec, role?.skills ?? null);
  // Prefer hard-filter missing list when present; stackScore missing aligns.
  const missing = missingMust.length > 0 ? missingMust : stack.missing;

  const weights = reweight(spec.evidencePriority, coverage, role != null);
  const cohortDay = member.cohortDay > 0 ? member.cohortDay : 1;
  const dims: Record<ScoreDimension, number> = {
    stack: stack.score,
    missions: missionScore(
      member.missionsPassed,
      cohortDay,
      member.maxEarnableMissions,
    ),
    cleanPass: cleanPassScore(member.cleanPassCount, member.missionsPassed),
    projects: projectScore(member.projectScores),
    consistency: consistencyScore(
      member.commitDayCount,
      cohortDay,
      member.consistencyWindow,
    ),
    interview: interviewScore(member.interview),
    experience: (() => {
      const band = effectiveExperienceBand(spec);
      return experienceScore(member.yearsExperience, band.min, band.max);
    })(),
    role: role?.title.fit ?? 0,
  };

  const dimensionsUsed = (Object.keys(dims) as ScoreDimension[]).filter(
    (k) => coverage.dimensions[k] && weights[k] > 0,
  );

  let total = 0;
  for (const k of dimensionsUsed) {
    total += dims[k] * weights[k];
  }
  total = Math.round(Math.max(0, Math.min(100, total)));

  // An uncovered dimension reports null, not 0 — the audit trail has to
  // distinguish "this cohort could not produce the evidence" from "the
  // evidence exists and it was bad".
  const breakdown = (t: number): ScoreBreakdown => ({
    stack: coverage.dimensions.stack ? Math.round(dims.stack * 100) : null,
    missions: coverage.dimensions.missions ? Math.round(dims.missions * 100) : null,
    cleanPass: coverage.dimensions.cleanPass ? Math.round(dims.cleanPass * 100) : null,
    projects: coverage.dimensions.projects ? Math.round(dims.projects * 100) : null,
    consistency: coverage.dimensions.consistency
      ? Math.round(dims.consistency * 100)
      : null,
    interview: coverage.dimensions.interview ? Math.round(dims.interview * 100) : null,
    experience: coverage.dimensions.experience
      ? Math.round(dims.experience * 100)
      : null,
    role: role && coverage.dimensions.role ? Math.round(dims.role * 100) : null,
    weights,
    total: t,
    dimensionsUsed,
  });

  if (!ok) {
    return {
      programMemberId,
      source,
      candidateRef,
      userId: member.userId,
      fullName: member.fullName,
      jobRole: member.jobRole,
      company: member.company,
      score: 0,
      tier: "NONE",
      scoreBreakdown: breakdown(0),
      evidence: toEvidence(member),
      gaps: [...reasons, ...missing.map((m) => `Missing stack: ${m}`)],
      availabilityUnknown,
      openToWork,
      hardFiltered: true,
      hardFilterReasons: reasons,
      dossier: member.dossier,
    };
  }

  const gaps: string[] = [];
  for (const m of missing) gaps.push(`Missing stack: ${m}`);
  // Shown, but never quietly. A candidate three missions in is a real person
  // with a real profile and almost no track record, and the card has to say so.
  if (member.missionsPassed < 3) {
    gaps.push(
      member.missionsPassed === 0
        ? "Just started — no verified missions completed yet"
        : `Early in the cohort — only ${member.missionsPassed} verified mission(s) so far`,
    );
  }
  // Only report a gap the cohort could actually have filled. "No graded
  // projects" against a cohort whose project days have not arrived reads as a
  // fault of the candidate, and it is not one.
  if (coverage.dimensions.projects && dims.projects < 0.3) {
    gaps.push("Limited graded project evidence");
  }
  if (coverage.dimensions.interview && dims.interview < 0.3) {
    gaps.push("No or low interview scores");
  }
  if (coverage.dimensions.consistency && dims.consistency < 0.3) {
    gaps.push("Few verified commit days");
  }
  if (availabilityUnknown) {
    gaps.push("Availability not shared — confirm salary/notice/location at outreach");
  }
  if (role?.mismatch) {
    gaps.push(`Nothing in their titles or skills points to "${role.query.label}"`);
  }

  const tier = tierFor(total, missing, member.missionsPassed, role?.mismatch ?? false);

  return {
    programMemberId,
    source,
    candidateRef,
    userId: member.userId,
    fullName: member.fullName,
    jobRole: member.jobRole,
    company: member.company,
    score: total,
    tier,
    scoreBreakdown: breakdown(total),
    evidence: toEvidence(member),
    gaps,
    availabilityUnknown,
    openToWork,
    hardFiltered: false,
    hardFilterReasons: [],
    dossier: member.dossier,
  };
}

function toEvidence(member: ScoreableMember) {
  return {
    skills: member.skills,
    yearsExperience: member.yearsExperience,
    missionPoints: member.missionPoints,
    missionsPassed: member.missionsPassed,
    missionsAttempted: member.missionsAttempted,
    missionsWaived: member.dossier?.evidence.missionsWaived.value ?? 0,
    cleanPassCount: member.cleanPassCount,
    commitDayCount: member.commitDayCount,
    workingLanguages: member.dossier?.evidence.workingLanguages.value ?? [],
    cohortDay: member.cohortDay,
    projectScores: member.projectScores,
    interview: member.interview,
    totalScore: member.totalScore,
    jobRole: member.jobRole,
    company: member.company,
  };
}

/** Rank non-hard-filtered candidates; optionally include near-miss for gap analysis. */
/** Listing order of tiers: proven work first. */
const TIER_ORDER: Record<MatchTier, number> = { STRONG: 0, PARTIAL: 1, NONE: 2 };

export function rankCandidates(
  members: ScoreableMember[],
  spec: JobSpec,
  opts?: {
    includeHardFiltered?: boolean;
    limit?: number;
    coverage?: EvidenceCoverage;
  },
): ScoredCandidate[] {
  const scored = members.map((m) => scoreCandidate(m, spec, opts?.coverage));
  const list = opts?.includeHardFiltered
    ? scored
    : scored.filter((s) => !s.hardFiltered);
  // Tier first, then score. The score is a fair reading of the evidence each
  // track can produce, but it is not comparable ACROSS tracks: a profile with
  // nothing but a typed skill list has every evidence dimension dropped and its
  // stack weight rescaled to ~83%, so "lists React" scored 85 while a cohort
  // graduate with 22 passed missions and three graded projects scored 81 — and
  // was listed below it (QA-KI-008). STRONG is the claim about proven work, so
  // proven work is listed first; within a tier the score decides.
  //
  // Name is the tiebreak where there is one. Candidates outside the program
  // carry no name by design, so their ties fall back to the handle — arbitrary,
  // but stable, which is what a tiebreak is for.
  list.sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      b.score - a.score ||
      (a.fullName || a.candidateRef).localeCompare(
        b.fullName || b.candidateRef,
      ),
  );
  const limit = opts?.limit ?? 25;
  return list.slice(0, limit);
}

/**
 * Who actually appears as a result card.
 *
 * Ranked people who fail a stated must-have are near-misses for the gap
 * report, not results. Padding an empty must-have search with a business
 * executive is how the sample-card path never fired.
 */
export function pickSearchMatches(
  ranked: ScoredCandidate[],
  spec: JobSpec,
  opts?: { hardCap?: number | null; limit?: number; minResults?: number },
): ScoredCandidate[] {
  const must = spec.mustHaveStack ?? [];
  const minResults = opts?.minResults ?? 5;
  const hardCap = opts?.hardCap ?? null;
  const limit = hardCap ?? opts?.limit ?? 25;

  const shown = ranked.filter((r) => {
    if (r.hardFiltered) return false;
    if (must.length === 0) return true;
    const skills = r.evidence.skills ?? [];
    return must.every((t) => stackTokensMatch(skills, t));
  });
  const primary = shown.filter((r) => r.tier !== "NONE");
  if (primary.length === 0) {
    return must.length > 0 ? [] : shown.slice(0, limit);
  }
  const padded =
    hardCap || primary.length >= minResults
      ? primary
      : [...primary, ...shown.filter((r) => r.tier === "NONE")];
  return padded.slice(0, limit);
}

export type SearchSelection = {
  /** Every loaded candidate, hard-filtered ones included, in listing order. */
  ranked: ScoredCandidate[];
  /** The result cards. */
  matches: ScoredCandidate[];
  /** Up to ten people who were not shown, for the gap report only. */
  nearMisses: ScoredCandidate[];
};

/**
 * Everything a search returns, chosen from the WHOLE ranked pool.
 *
 * `searchCandidates` used to rank, cut the list to the top 100, and only then
 * apply hard filters and required skills. When a hundred people who did not
 * have the required skill outscored the ones who did, the matching candidates
 * were cut before anyone checked — a recruiter saw zero cards while matches
 * existed (QA-KI-006). Scoring already touched every candidate, so ranking all
 * of them costs one sort, not a query.
 *
 * Pure, and the single implementation: the search and the search-QA probe both
 * call it, so the audit measures exactly what recruiters get.
 */
export function selectSearchResults(
  members: ScoreableMember[],
  spec: JobSpec,
  opts: {
    coverage?: EvidenceCoverage;
    hardCap?: number | null;
    limit: number;
    minResults: number;
  },
): SearchSelection {
  const ranked = rankCandidates(members, spec, {
    includeHardFiltered: true,
    limit: Number.MAX_SAFE_INTEGER,
    coverage: opts.coverage,
  });
  const matches = pickSearchMatches(ranked, spec, {
    hardCap: opts.hardCap,
    limit: opts.limit,
    minResults: opts.minResults,
  });
  // Keyed by candidateRef. It was programMemberId, which is null for every
  // challenge, hackathon and profile candidate — so `has(null)` excluded all of
  // them from the gap report the moment one of them was shown.
  const shown = new Set(matches.map((m) => m.candidateRef));
  const nearMisses = ranked
    .filter(
      (r) =>
        !shown.has(r.candidateRef) &&
        (r.hardFiltered ||
          r.tier === "NONE" ||
          (r.tier === "PARTIAL" && r.gaps.length > 0)),
    )
    .slice(0, 10);
  return { ranked, matches, nearMisses };
}

// ─── Pure helpers exported for unit tests (no DB) ───────────────────────────

export const __test = {
  stackTokensMatch,
  reweight,
  stackScore,
  missionScore,
  cleanPassScore,
  projectScore,
  consistencyScore,
  interviewScore,
  experienceScore,
  tierFor,
  assessRole,
  normToken,
  BASE_WEIGHTS,
  FULL_COVERAGE,
};
