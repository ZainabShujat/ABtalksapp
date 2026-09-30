import { z } from "zod";
import type { JobSpec } from "@/lib/validations/hire";
import {
  recruiterRoleLabel,
  trackLongLabel,
  verifiedEvidenceFacts,
} from "@/features/hire/candidate-summary";

/**
 * The View Details candidate summary, written by Gemini: the shared, client-safe
 * half.
 *
 * Only View Details and the candidate report use it. Cards, saved lists and
 * every other Hire surface stay on the deterministic copy in
 * `candidate-summary.ts`, which is also the fallback here whenever the model is
 * unconfigured, slow, rate limited or returns something unusable.
 *
 * What the model is given is a compact fact sheet, never a profile dump: no
 * email, phone, unlock state, rationale or Gaps list, and nothing negative to
 * repeat. Card facts (numbers and flags the search already computed) come from
 * the client and are bounded by the schemas below; profile facts (degree,
 * school, most recent job, skills) are read on the server through the same
 * recruiter-safe repositories the panel already uses.
 */

export const SUMMARY_WORD_CAP = 50;

/** The slice of the active search the summary may lean on. */
export const summarySearchSchema = z.object({
  title: z.string().trim().max(120).nullable(),
  mustHaveStack: z.array(z.string().trim().min(1).max(60)).max(12),
  requiresDegree: z.boolean().nullable(),
  minExperience: z.number().int().min(0).max(50).nullable(),
  maxExperience: z.number().int().min(0).max(50).nullable(),
  locationCity: z.string().trim().max(80).nullable(),
  workMode: z.string().trim().max(20).nullable(),
});

export type SummarySearch = z.infer<typeof summarySearchSchema>;

/**
 * What the card already shows. Bounded numbers, flags and short strings only:
 * a given name that is letters, a role title, declared skills. The name is the
 * one the card prints (never the family name, which stays blurred).
 */
export const summaryCardSchema = z.object({
  givenName: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\p{L}\p{M}'.-]+$/u)
    .nullable(),
  jobRole: z.string().trim().max(120).nullable(),
  yearsExperience: z.number().min(0).max(60).nullable(),
  openToWork: z.boolean(),
  source: z.string().trim().max(40).nullable(),
  missionsPassed: z.number().int().min(0).max(1000).nullable(),
  totalTrackDays: z.number().int().min(0).max(1000).nullable(),
  cleanPassCount: z.number().int().min(0).max(1000).nullable(),
  commitDayCount: z.number().int().min(0).max(5000).nullable(),
  projectCount: z.number().int().min(0).max(200),
  certificateIssued: z.boolean(),
  quizAverage: z.number().min(0).max(100).nullable(),
  educationLevel: z.string().trim().max(120).nullable(),
  skills: z.array(z.string().trim().min(1).max(60)).max(40),
});

export type SummaryCard = z.infer<typeof summaryCardSchema>;

export const summaryRequestSchema = z.object({
  candidateRef: z.string().trim().min(1).max(200),
  card: summaryCardSchema,
  search: summarySearchSchema.nullable(),
});

export type SummaryRequest = z.infer<typeof summaryRequestSchema>;

/** The model's whole reply. One field, nothing else to trust. */
export const aiSummaryOutputSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
});

/** The desk's active `JobSpec`, cut down to what a summary can use. */
export function summarySearchFromSpec(
  spec: JobSpec | null | undefined,
): SummarySearch | null {
  if (!spec) return null;
  const stack = (spec.mustHaveStack ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  const search: SummarySearch = {
    title: spec.title?.trim().slice(0, 120) || null,
    mustHaveStack: stack,
    requiresDegree: spec.requiresDegree ?? null,
    minExperience: spec.minExperience ?? null,
    maxExperience: spec.maxExperience ?? null,
    locationCity: spec.locationCity?.trim().slice(0, 80) || null,
    workMode: spec.workMode ?? null,
  };
  const empty =
    !search.title &&
    search.mustHaveStack.length === 0 &&
    search.requiresDegree === null &&
    search.minExperience === null &&
    search.maxExperience === null &&
    !search.locationCity &&
    !search.workMode;
  return empty ? null : search;
}

/** The card facts off a match-shaped object. */
export function summaryCardFromMatch(match: {
  source?: string;
  jobRole?: string | null;
  displayName?: string | null;
  openToWork?: boolean;
  evidence?: {
    skills?: string[];
    yearsExperience?: number;
    missionsPassed?: number;
    totalTrackDays?: number | null;
    cleanPassCount?: number;
    commitDayCount?: number;
    projectScores?: number[];
    certificateIssued?: boolean;
    quizAverage?: number | null;
    educationLevel?: string | null;
  };
}): SummaryCard {
  const e = match.evidence ?? {};
  const given = match.displayName?.trim().split(/\s+/)[0] ?? "";
  const nonNeg = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const int = (v: number | null | undefined) => {
    const n = nonNeg(v);
    return n === null ? null : Math.round(n);
  };
  return {
    givenName: /^[\p{L}\p{M}'.-]{1,40}$/u.test(given) ? given : null,
    jobRole: match.jobRole?.trim().slice(0, 120) || null,
    yearsExperience: nonNeg(e.yearsExperience),
    openToWork: match.openToWork === true,
    source: match.source?.slice(0, 40) ?? null,
    missionsPassed: int(e.missionsPassed),
    totalTrackDays: int(e.totalTrackDays),
    cleanPassCount: int(e.cleanPassCount),
    commitDayCount: int(e.commitDayCount),
    projectCount: e.projectScores?.length ?? 0,
    certificateIssued: e.certificateIssued === true,
    quizAverage: nonNeg(e.quizAverage),
    educationLevel: e.educationLevel?.trim().slice(0, 120) || null,
    skills: (e.skills ?? [])
      .map((s) => s.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 40),
  };
}

/** FNV-1a, 32-bit. A cache key, not a secret. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Candidate + search + what the card showed. The client keys its stored copy
 * on this so the report reuses the paragraph View Details produced; the server
 * prefixes it with the recruiter's id for its own cache.
 */
export function summaryRequestKey(req: SummaryRequest): string {
  return `${req.candidateRef}#${hash(
    JSON.stringify([req.card, req.search]),
  )}`;
}

export type SummaryFacts = {
  givenName: string | null;
  roleLabel: string;
  openToWork: boolean;
  yearsExperience: number | null;
  skills: { name: string; matchesSearch: boolean }[];
  search: SummarySearch | null;
  recentExperience: { title: string; company: string | null } | null;
  education: { degree: string | null; school: string | null } | null;
  track: string | null;
  verifiedFacts: string[];
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

/** Placeholder rows ("Not specified") are not an education. */
function meaningful(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t) return null;
  if (/^(not specified|n\/?a|none|-+)$/i.test(t)) return null;
  return t.slice(0, 120);
}

export function buildSummaryFacts(input: {
  card: SummaryCard;
  search: SummarySearch | null;
  /** From the recruiter-safe identity read. */
  profile: {
    degree: string | null;
    school: string | null;
    skills: string[];
  } | null;
  /** The most recent job from the recruiter-safe work history. */
  recentJob: { title: string; companyName: string | null } | null;
}): SummaryFacts {
  const { card, search, profile, recentJob } = input;
  const wanted = new Set((search?.mustHaveStack ?? []).map(norm));

  const seen = new Set<string>();
  const skills: SummaryFacts["skills"] = [];
  for (const raw of [...card.skills, ...(profile?.skills ?? [])]) {
    const name = raw.trim().slice(0, 60);
    const key = norm(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    skills.push({ name, matchesSearch: wanted.has(key) });
  }
  // Matching skills first, so a capped list keeps the ones the search asked for.
  skills.sort((a, b) => Number(b.matchesSearch) - Number(a.matchesSearch));

  const degree = meaningful(profile?.degree) ?? meaningful(card.educationLevel);
  const school = meaningful(profile?.school);

  const title = recentJob?.title?.trim().slice(0, 120);

  return {
    givenName: card.givenName,
    roleLabel: recruiterRoleLabel({
      jobRole: card.jobRole,
      yearsExperience: card.yearsExperience,
    }),
    openToWork: card.openToWork,
    yearsExperience:
      card.yearsExperience && card.yearsExperience > 0
        ? card.yearsExperience
        : null,
    skills: skills.slice(0, 12),
    search,
    recentExperience: title
      ? { title, company: recentJob?.companyName?.trim().slice(0, 120) || null }
      : null,
    education: degree || school ? { degree, school } : null,
    track: trackLongLabel(card.source ?? undefined),
    // Positive facts only: `verifiedEvidenceFacts` never emits an absence, so
    // an empty list simply means there is nothing to say.
    verifiedFacts: verifiedEvidenceFacts({
      source: card.source ?? undefined,
      missionsPassed: card.missionsPassed,
      totalTrackDays: card.totalTrackDays,
      cleanPassCount: card.cleanPassCount,
      commitDayCount: card.commitDayCount,
      // Only the count is read; the card does not send the scores themselves.
      projectScores:
        card.projectCount > 0 ? Array<number>(card.projectCount).fill(0) : null,
      certificateIssued: card.certificateIssued,
      quizAverage: card.quizAverage,
    }),
  };
}

/**
 * Sentences a positive-only summary must not contain: absences, hedges, gaps,
 * ranking talk, internal ids, contact details.
 */
const NEGATIVE =
  /\b(no|not|none|never|nothing|lacks?|lacking|without|missing|absent|unverified|unknown|unclear|gaps?|yet to|weak|limited|unfortunately|however|although|ranked|ranking)\b|n't\b/i;
const LEAKS = /\bAB-[0-9?]{3,}\b|@|\+?\d[\d\s-]{8,}\d/;

/**
 * The model's text, made safe to print: negative or leaking sentences dropped,
 * em dashes turned into commas, and the whole capped at {@link SUMMARY_WORD_CAP}
 * words (at a sentence end when one fits). Null when nothing usable is left, so
 * the caller falls back to the deterministic summary.
 */
export function sanitizeAiSummary(raw: string): string | null {
  const text = raw
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const kept = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !NEGATIVE.test(s) && !LEAKS.test(s));
  if (kept.length === 0) return null;

  const words = kept.join(" ").split(" ");
  if (words.length <= SUMMARY_WORD_CAP) return kept.join(" ");

  // Longest run of whole sentences under the cap; failing that, a hard cut.
  let out = "";
  for (const sentence of kept) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.split(" ").length > SUMMARY_WORD_CAP) break;
    out = next;
  }
  if (out) return out;
  const cut = words
    .slice(0, SUMMARY_WORD_CAP)
    .join(" ")
    .replace(/[,;:]+$/, "");
  return /[.!?]$/.test(cut) ? cut : `${cut}.`;
}

export const __test = { hash, norm, meaningful, NEGATIVE, LEAKS };
