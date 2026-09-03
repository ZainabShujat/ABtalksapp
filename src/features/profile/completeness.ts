import { isOtpVerificationRequired } from "@/lib/feature-flags";
import type { CandidateDetail } from "@/repositories/candidate-detail";

/**
 * Profile strength.
 *
 * A UX metric and nothing else. It does not gate recruiter discovery (that is
 * `CandidateVisibility.searchableByRecruiters`), it does not imply the candidate
 * is looking (that is `CandidatePreference.openToWork`), and it never filters
 * anybody out of `/hire`. It exists to tell a candidate what is still worth
 * adding.
 *
 * Weights deliberately sum to 125, and the score is capped at 100. Nobody has
 * every kind of history: a first-year student has no employment, a working
 * professional may have no side projects, and most people hold no external
 * certifications. Over-weighting means a complete, honest profile reaches 100%
 * along more than one path, instead of nagging people for rows they cannot
 * truthfully fill.
 */

export type SectionKey =
  | "basic"
  | "experience"
  | "education"
  | "projects"
  | "skills"
  | "certifications"
  | "links"
  | "preferences"
  | "evidence";

export type SectionStatus = {
  key: SectionKey;
  label: string;
  complete: boolean;
  /** 0 for sections that are earned rather than filled in. */
  weight: number;
  /** Shown when incomplete. Null when there is nothing to ask for. */
  hint: string | null;
};

export type ProfileCompleteness = {
  /** 0-100, capped. */
  score: number;
  sections: SectionStatus[];
};

const WEIGHTS: Record<SectionKey, number> = {
  basic: 20,
  skills: 20,
  education: 15,
  experience: 15,
  projects: 15,
  links: 15,
  preferences: 15,
  certifications: 10,
  // Earned from real activity, never self-filled — so it is reported but
  // scoring it would punish candidates for having joined recently.
  evidence: 0,
};

const MIN_SKILLS = 3;

export function computeCompleteness(
  detail: CandidateDetail,
  evidence: { hasAny: boolean },
): ProfileCompleteness {
  const pref = detail.preference;

  const basicComplete =
    detail.fullName.trim().length > 0 &&
    (detail.headline?.trim() || detail.summary?.trim() ? true : false) &&
    (detail.locationCity?.trim() ? true : false) &&
    (!isOtpVerificationRequired() || detail.phoneVerified);

  const claimedSkills = detail.skills.filter((s) => s.claimedByCandidate);

  const linksComplete =
    Boolean(detail.linkedinUrl) ||
    Boolean(detail.githubUsername) ||
    Boolean(detail.portfolioUrl) ||
    detail.links.length > 0;

  // Engagement with the section, not a particular answer. Requiring
  // `openToWork` would push people into declaring they are job-hunting just to
  // move a progress bar.
  const preferencesComplete = Boolean(
    pref &&
      (pref.preferredRoles.length > 0 ||
        pref.preferredLocations.length > 0 ||
        pref.opportunityTypes.length > 0 ||
        pref.remotePreference),
  );

  const sections: SectionStatus[] = [
    {
      key: "basic",
      label: "Basic information",
      complete: basicComplete,
      weight: WEIGHTS.basic,
      hint: !detail.phoneVerified && isOtpVerificationRequired()
        ? "Verify your phone number"
        : "Add a headline and your location",
    },
    {
      key: "experience",
      label: "Experience",
      complete: detail.experience.length > 0,
      weight: WEIGHTS.experience,
      hint: "Add a role, internship, or freelance work",
    },
    {
      key: "education",
      label: "Education",
      complete: detail.education.length > 0,
      weight: WEIGHTS.education,
      hint: "Add your college or school",
    },
    {
      key: "projects",
      label: "Projects",
      complete: detail.projects.length > 0,
      weight: WEIGHTS.projects,
      hint: "Add something you have built",
    },
    {
      key: "skills",
      label: "Skills",
      complete: claimedSkills.length >= MIN_SKILLS,
      weight: WEIGHTS.skills,
      hint: `Add at least ${MIN_SKILLS} skills`,
    },
    {
      key: "certifications",
      label: "Certifications",
      complete: detail.certifications.length > 0,
      weight: WEIGHTS.certifications,
      hint: "Add any external certifications you hold",
    },
    {
      key: "links",
      label: "Links",
      complete: linksComplete,
      weight: WEIGHTS.links,
      hint: "Add LinkedIn, GitHub, or a portfolio",
    },
    {
      key: "preferences",
      label: "Career preferences",
      complete: preferencesComplete,
      weight: WEIGHTS.preferences,
      hint: "Tell us the roles and locations you want",
    },
    {
      key: "evidence",
      label: "Evidence & achievements",
      complete: evidence.hasAny,
      weight: WEIGHTS.evidence,
      hint: null,
    },
  ];

  const earned = sections.reduce(
    (sum, s) => sum + (s.complete ? s.weight : 0),
    0,
  );

  return { score: Math.min(100, earned), sections };
}
