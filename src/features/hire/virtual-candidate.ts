import type { MatchCardData } from "@/components/hire/match-card";
import type { JobSpec } from "@/lib/validations/hire";
import {
  requirementFingerprint,
  type RequirementFingerprint,
} from "@/features/hire/requirement-fingerprint";

/**
 * A requirement rendered as a profile, for when the pool has nobody.
 *
 * ## What this is not
 *
 * It is not a person, and nothing here may be mistaken for one. Every field is
 * derived from what the recruiter typed. There is no name, no photograph, no
 * contact detail, no employer, no institution, no salary history — not blurred,
 * not placeholder, absent. A recruiter reading this card learns exactly one
 * thing: *this is the person we would go and find for you.*
 *
 * The title is the requirement said back — "Python + Flask + MERN full-stack
 * developer" — because that is what the card is about. A generated human name
 * would make the card a claim about inventory we do not have, which is the one
 * thing this feature exists to avoid.
 *
 * ## Why the ref keeps the SAMPLE prefix
 *
 * `candidateRef` stays `SAMPLE:`, which `resolveEligibleCandidates` already
 * refuses. So a virtual profile cannot be shortlisted, cannot become a
 * `TalentEngagementRequest`, and cannot reach the introductions queue — the
 * whitelist enforces that, rather than this file remembering to. Requesting one
 * goes down a separate path (`VirtualCandidateRequest`) that is explicitly a
 * sourcing job, not an introduction to somebody who exists.
 *
 * Pure: no DB, no model, no `server-only`. Rendered on the client and reused by
 * the persistence layer.
 */

export const VIRTUAL_REF_PREFIX = "SAMPLE:VC-";

export type VirtualCandidateProfile = {
  /** Stable within a fingerprint, so the same search shows the same card. */
  ref: string;
  fingerprintKey: string;
  /** The requirement said back. Never a person's name. */
  title: string;
  requiredSkills: string[];
  preferredSkills: string[];
  experienceLabel: string;
  experienceMin: number | null;
  experienceMax: number | null;
  locationLabel: string;
  employmentLabel: string | null;
  availabilityLabel: string;
  educationLabel: string | null;
  fingerprint: RequirementFingerprint;
};

/** Title case a stack token for display without mangling MERN, iOS, .NET. */
function displaySkill(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (s.length <= 4 && s === s.toUpperCase()) return s;
  if (/^[a-z]/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function roleTitle(spec: JobSpec, skills: string[]): string {
  const stated = spec.title?.trim();
  const display = skills.map(displaySkill);

  if (stated) {
    // Lead with the stack, because "Full Stack Developer" alone says little.
    // But only with the part the title does not already carry: a recruiter who
    // typed "COBOL mainframe engineer" should not be handed back
    // "COBOL + IBM z/OS COBOL mainframe engineer".
    const lower = stated.toLowerCase();
    const lead = display
      .filter((s) => !lower.includes(s.toLowerCase()))
      .slice(0, 3);
    return lead.length > 0 ? `${lead.join(" + ")} ${stated}` : stated;
  }

  const lead = display.slice(0, 3);
  if (lead.length === 0) return "Requirement-based profile";
  return `${lead.join(" + ")} developer`;
}

function experienceLabel(min?: number | null, max?: number | null): string {
  if (typeof min === "number" && typeof max === "number") {
    return min === max ? `${min} years required` : `${min}–${max} years required`;
  }
  if (typeof min === "number") return `${min}+ years required`;
  if (typeof max === "number") return `up to ${max} years`;
  return "Experience: not specified";
}

function availabilityLabel(noticePeriodDays?: number | null): string {
  if (typeof noticePeriodDays === "number") {
    return noticePeriodDays === 0
      ? "Immediate joiner required — to be sourced"
      : `Within ${noticePeriodDays} days — to be sourced`;
  }
  return "To be sourced";
}

/**
 * Build the profile. Returns null when the requirement says too little to
 * describe anybody — an empty card is worse than no card, because it reads as
 * the product being broken rather than the pool being empty.
 */
export function generateVirtualCandidate(spec: JobSpec): VirtualCandidateProfile | null {
  const required = (spec.mustHaveStack ?? []).map((s) => s.trim()).filter(Boolean);
  const preferred = (spec.niceToHaveStack ?? []).map((s) => s.trim()).filter(Boolean);
  const title = spec.title?.trim() ?? "";
  if (required.length === 0 && !title) return null;

  const fingerprint = requirementFingerprint(spec);

  return {
    ref: `${VIRTUAL_REF_PREFIX}${fingerprint.key}`,
    fingerprintKey: fingerprint.key,
    title: roleTitle(spec, required),
    requiredSkills: required.map(displaySkill),
    preferredSkills: preferred.map(displaySkill),
    experienceLabel: experienceLabel(spec.minExperience, spec.maxExperience),
    experienceMin: spec.minExperience ?? null,
    experienceMax: spec.maxExperience ?? null,
    locationLabel: spec.locationCity?.trim() || "Location: not specified",
    employmentLabel: spec.employmentType ? String(spec.employmentType) : null,
    availabilityLabel: availabilityLabel(spec.noticePeriodDays),
    educationLabel: spec.requiresDegree ? "Degree required" : null,
    fingerprint,
  };
}

/**
 * Render the profile through the card the desk already knows how to draw.
 *
 * `score: 0` and `tier: "NONE"` are honest: nobody has been measured, because
 * nobody has been found. The card component reads `isVirtual` to swap the
 * chrome — a real candidate and a requirement must never look alike.
 */
export function virtualCandidateToCard(
  profile: VirtualCandidateProfile,
): MatchCardData & { isVirtual: true } {
  return {
    isVirtual: true,
    candidateRef: profile.ref,
    programMemberId: null,
    jobRole: profile.title,
    displayName: null,
    score: 0,
    tier: "NONE",
    rationale: null,
    gaps: [],
    availabilityUnknown: true,
    shortlisted: false,
    engagementStatus: null,
    locationLabel: profile.locationLabel,
    highlightSkills: profile.requiredSkills.length ? profile.requiredSkills : undefined,
    evidence: {
      skills: profile.requiredSkills,
      ...(profile.experienceMin !== null
        ? { yearsExperience: profile.experienceMin }
        : {}),
    },
  };
}

/** True for any ref this module minted. Cheap enough to call on every card. */
export function isVirtualRef(ref: string): boolean {
  return ref.startsWith(VIRTUAL_REF_PREFIX);
}
