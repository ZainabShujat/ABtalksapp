/**
 * The Gemini hiring brief: its schema, the checks it must pass, and what it
 * means for the `/hire` strip and for the search spec.
 *
 * Client-safe on purpose (no `server-only`, no key, no fetch): the composer
 * imports the flag type, and the tests run it with no network. The call itself
 * lives in `gemini-brief.ts`.
 *
 * Same two-key idea as `confirmPoolBrief`: the model proposes, and a city or a
 * skill is only kept if the recruiter's own words contain it. A hallucinated
 * city is not a harmless tick here: it becomes a location filter that flags
 * every candidate as "Location mismatch".
 */
import { z } from "zod";
import {
  jobSpecSchema,
  talentEmploymentTypeSchema,
  talentSenioritySchema,
  talentWorkModeSchema,
  type JobSpec,
} from "@/lib/validations/hire";
import { isMonthlyContext, parseMoney } from "@/features/hire/spec-fields";
import {
  detectSpokenBrief,
  type SpokenBriefFlags,
} from "@/features/hire/spoken-brief";

export type { SpokenBriefFlags };

/** What the composer posts. Same ceiling as a Scout message. */
export const hireBriefInputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

/** Near-miss spellings of enum values the model sometimes writes. */
const ENUM_SYNONYMS: Record<string, string> = {
  ON_SITE: "ONSITE",
  WFH: "REMOTE",
  WORK_FROM_HOME: "REMOTE",
  WORK_FROM_OFFICE: "ONSITE",
  FULLTIME: "FULL_TIME",
  PARTTIME: "PART_TIME",
};

/** A field the model got wrong is dropped on its own; the rest survive. */
function lenientEnum<T extends z.ZodTypeAny>(schema: T) {
  return z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const s = v.trim().toUpperCase().replace(/[\s-]+/g, "_");
      return ENUM_SYNONYMS[s] ?? s;
    }, schema.nullish())
    .catch(null);
}

const lenientNumber = (max: number) =>
  z.coerce.number().min(0).max(max).nullish().catch(null);

const lenientText = (max: number) =>
  z.string().trim().max(max).nullish().catch(null);

/** Gemini's raw output. Top level must be an object; fields degrade to null. */
export const geminiBriefSchema = z.object({
  isHiringBrief: z.boolean().nullish().catch(null),
  title: lenientText(200),
  locationCity: lenientText(80),
  workMode: lenientEnum(talentWorkModeSchema),
  minExperience: lenientNumber(50),
  maxExperience: lenientNumber(50),
  seniority: lenientEnum(talentSenioritySchema),
  education: lenientText(120),
  requiresDegree: z.boolean().nullish().catch(null),
  mustHaveStack: z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .nullish()
    .catch(null),
  employmentType: lenientEnum(talentEmploymentTypeSchema),
  noticePeriodDays: lenientNumber(180),
  salaryText: lenientText(120),
});

export type GeminiBrief = z.infer<typeof geminiBriefSchema>;

// ─── Grounding ───────────────────────────────────────────────────────────────

/** Canonical skill → other ways a recruiter writes it. */
const SKILL_SPELLINGS: Record<string, string[]> = {
  javascript: ["js"],
  typescript: ["ts"],
  node: ["nodejs", "node.js"],
  react: ["reactjs", "react.js"],
  postgresql: ["postgres"],
  kubernetes: ["k8s"],
  ".net": ["dotnet"],
  "c#": ["csharp"],
  "machine learning": ["ml"],
};

/** Model spelling → canonical, so "Node.js" and "node" are one skill. */
const SKILL_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(SKILL_SPELLINGS).flatMap(([canon, forms]) =>
    forms.map((f) => [f, canon]),
  ),
);

/** Renamed cities: a model that writes "Bengaluru" for "Bangalore" is not inventing. */
const CITY_SPELLINGS: string[][] = [
  ["bengaluru", "bangalore", "blr"],
  ["mumbai", "bombay"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["gurugram", "gurgaon"],
  ["kochi", "cochin"],
  ["hyderabad", "hyd"],
  ["mysuru", "mysore"],
  ["thiruvananthapuram", "trivandrum"],
  ["visakhapatnam", "vizag"],
  ["delhi", "new delhi"],
  ["pune", "poona"],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
}

/** The phrase stands on its own in the text: "go" is not in "ongoing". */
function saysWord(lowerText: string, phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(p)}(?![a-z0-9])`).test(lowerText);
}

function lettersOnly(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** A quoted phrase appears in the text, ignoring spacing and punctuation. */
function quoted(lowerText: string, phrase: string): boolean {
  const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const p = alnum(phrase);
  return p.length > 0 && alnum(lowerText).includes(p);
}

function normalizeSkill(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return SKILL_CANONICAL[s] ?? s;
}

function skillGrounded(lowerText: string, skill: string): boolean {
  if (saysWord(lowerText, skill)) return true;
  return (SKILL_SPELLINGS[skill] ?? []).some((f) => saysWord(lowerText, f));
}

function cityGrounded(lowerText: string, city: string): boolean {
  const said = lettersOnly(lowerText);
  const c = lettersOnly(city);
  if (c.length < 3) return false;
  if (said.includes(c)) return true;
  const group = CITY_SPELLINGS.find((g) => g.some((n) => lettersOnly(n) === c));
  return Boolean(group?.some((n) => saysWord(lowerText, n)));
}

/** Words that describe a work mode or a country, never a city to filter on. */
const NOT_A_CITY =
  /^(remote|hybrid|on[-\s]?site|onsite|wfh|work from home|anywhere|any|india|bharat|usa|us|united states)$/i;

// ─── Patch ───────────────────────────────────────────────────────────────────

/**
 * Model output → a `JobSpec` patch containing only what the text supports.
 * `{}` for anything that is not a hiring brief ("who is prime minister of india").
 */
export function toBriefPatch(brief: GeminiBrief, rawText: string): JobSpec {
  if (brief.isHiringBrief === false) return {};
  const lower = rawText.toLowerCase();
  const patch: JobSpec = {};

  const title = brief.title?.trim();
  if (title) patch.title = title.slice(0, 200);

  const city = brief.locationCity?.trim();
  if (city && !NOT_A_CITY.test(city) && cityGrounded(lower, city)) {
    patch.locationCity = city.slice(0, 80);
  }

  if (brief.workMode) patch.workMode = brief.workMode;
  if (brief.seniority) patch.seniority = brief.seniority;
  if (brief.employmentType) patch.employmentType = brief.employmentType;

  let min = brief.minExperience != null ? Math.round(brief.minExperience) : null;
  let max = brief.maxExperience != null ? Math.round(brief.maxExperience) : null;
  if (min != null && max != null && min > max) [min, max] = [max, min];
  if (min != null) patch.minExperience = min;
  if (max != null) patch.maxExperience = max;

  if (brief.noticePeriodDays != null) {
    patch.noticePeriodDays = Math.round(brief.noticePeriodDays);
  }

  const education = brief.education?.trim();
  if (
    (education && quoted(lower, education)) ||
    (brief.requiresDegree === true && !education)
  ) {
    patch.requiresDegree = true;
  } else if (brief.requiresDegree === false) {
    patch.requiresDegree = false;
  }

  const stack: string[] = [];
  for (const raw of brief.mustHaveStack ?? []) {
    const skill = normalizeSkill(raw);
    if (skill && !stack.includes(skill) && skillGrounded(lower, skill)) {
      stack.push(skill);
    }
  }
  if (stack.length) patch.mustHaveStack = stack.slice(0, 12);

  // The model quotes money; `parseMoney` computes it (same rule as Scout's
  // `salaryText`). A quote the recruiter never wrote is ignored.
  const salaryText = brief.salaryText?.trim();
  if (salaryText && quoted(lower, salaryText)) {
    const money = parseMoney(salaryText, isMonthlyContext(patch));
    if (money) {
      patch.salaryMin = money.min;
      patch.salaryMax = money.max;
      patch.salaryCurrency = "INR";
      patch.salaryPeriod = money.period;
    }
  }

  const parsed = jobSpecSchema.safeParse(patch);
  return parsed.success ? parsed.data : {};
}

// ─── Strip ticks ─────────────────────────────────────────────────────────────

export const NO_FLAGS: SpokenBriefFlags = {
  role: false,
  experience: false,
  location: false,
  education: false,
  skills: false,
  availability: false,
  compensation: false,
  abtalks: false,
};

/** Which strip criteria a patch answers. */
export function briefFlags(patch: JobSpec, rawText: string): SpokenBriefFlags {
  return {
    role: Boolean(patch.title?.trim()),
    experience:
      patch.minExperience != null ||
      patch.maxExperience != null ||
      patch.seniority != null,
    location: Boolean(patch.locationCity?.trim()) || patch.workMode != null,
    education: patch.requiresDegree != null,
    skills: (patch.mustHaveStack?.length ?? 0) > 0,
    availability:
      patch.workMode != null ||
      patch.noticePeriodDays != null ||
      patch.employmentType != null,
    compensation: patch.salaryMin != null || patch.salaryMax != null,
    // A platform phrase, not a hiring facet the model extracts.
    abtalks: detectSpokenBrief(rawText).abtalks,
  };
}

// ─── Merge ───────────────────────────────────────────────────────────────────

/**
 * Deterministic merge: a stated value in the patch wins, an absent one keeps
 * the base; stacks are unioned (case-insensitive, base order first).
 */
export function mergeBriefPatch(base: JobSpec, patch: JobSpec): JobSpec {
  const next: JobSpec = { ...base };
  for (const [key, value] of Object.entries(patch) as [keyof JobSpec, unknown][]) {
    if (value == null || key === "mustHaveStack" || key === "extra") continue;
    (next as Record<string, unknown>)[key] = value;
  }
  if (patch.mustHaveStack?.length) {
    const out = [...(base.mustHaveStack ?? [])];
    const seen = new Set(out.map((s) => s.toLowerCase()));
    for (const s of patch.mustHaveStack) {
      if (!seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase());
        out.push(s);
      }
    }
    next.mustHaveStack = out.slice(0, 20);
  }
  const parsed = jobSpecSchema.safeParse(next);
  return parsed.success ? parsed.data : base;
}
