import "server-only";

import { logger } from "@/lib/logger";
import { recruiterVisibleName } from "@/features/profile/recruiter-view-name";
import {
  candidateSummaryDetail,
  recruiterRoleLabel,
  trackLongLabel,
  verifiedEvidenceSentence,
} from "@/features/hire/candidate-summary";
import {
  cleanPassScore,
  consistencyScore,
  interviewScore,
  missionScore,
  projectScore,
} from "@/features/hire/score-candidate";
import {
  loadOwnTrackEvidence,
  type OwnTrackEvidence,
} from "@/features/hire/own-track-evidence";
import { loadRecruiterIdentities } from "@/repositories/talent";
import { listPublicWorkHistory } from "@/repositories/candidate-detail";
import { getVerifiedAccomplishments } from "@/features/profile/get-verified-accomplishments";
import { getVerifiedSkills } from "@/features/profile/get-verified-skills";
import { getProfilePerformance } from "@/features/profile/get-profile-performance";
import { getCandidateDiscoverability } from "@/features/admin/get-candidate-discoverability";
import {
  toCandidateSafeChecks,
  type CandidateFindability,
} from "@/features/profile/recruiter-view-checks";

/**
 * The candidate's own profile, as a recruiter's search returns it (plan 155).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE DESIGN RULE: READ THROUGH THE RECRUITER'S OWN FUNCTIONS
 *
 * Every figure below comes from the function the recruiter path uses, not from a
 * second implementation of it:
 *
 *   - identity and field policy → `loadRecruiterIdentities` (repositories/talent.ts),
 *     which is the recruiter-safe overlay itself and enforces
 *     `RECRUITER_FIELD_POLICY`. It does not select email, phone or résumé URL, so
 *     this preview *cannot* leak them even by mistake.
 *   - evidence counts → `loadOwnTrackEvidence`, which reuses the pool dossier
 *     builders.
 *   - the score dimensions → the scorers exported from `score-candidate.ts`.
 *   - card copy → `candidate-summary.ts` (pure).
 *   - name masking → `recruiter-view-name.ts`, which a test pins to `splitName`
 *     on the recruiter card. It cannot be imported from there directly — that
 *     module is `"use client"` and this one is `server-only`; see that file.
 *   - findability → the admin check engine, reworded by
 *     `recruiter-view-checks.ts`.
 *
 * A preview assembled any other way would be a second definition of "what
 * recruiters see", and the day the two disagree the page is lying to the person
 * whose profile it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY ABSENT, AND WHY
 *
 * NO TOTAL, NO TIER. The AB score weights eight dimensions, three of which do not
 * exist without a recruiter's spec. A total over the other five is not the AB
 * score and must not be shown beside one.
 *
 * NO `stack`, `role` OR `experience` NUMBER. `stackScore` needs the spec's
 * requested stack; `assessRole` needs its title; and `experienceScore` returns a
 * FLAT 0.7 when the spec states no band (`score-candidate.ts:393`) — so a figure
 * there would be a constant dressed up as a measurement. All three are reported
 * as search-relative instead, with the underlying fact beside them.
 *
 * NO CONTACT, NO UNLOCK. No email, no phone, no résumé link, no LinkedIn or
 * GitHub URL. LinkedIn/GitHub appear as booleans only, exactly as the recruiter
 * card carries them.
 *
 * NO WRITES. Not one. A candidate looking at their own preview must not move
 * their own "recruiters viewed you" counter, so nothing here records a
 * `DETAIL_VIEW` and nothing calls the `hire-*-actions` Server Actions, which
 * exist to stamp exactly that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type CardPill = {
  kind: "exp" | "location" | "employment" | "education";
  text: string;
};

export type CardSkill = { name: string; evidenceBacked: boolean };

export type EvidenceDim =
  /** Measured on the candidate alone. 0–100. */
  | { key: string; label: string; kind: "measured"; value: number; caption: string }
  /** The candidate's track cannot produce this evidence. Never a zero. */
  | { key: string; label: string; kind: "unavailable"; caption: string }
  /** Only exists against a recruiter's search. `fact` is the raw truth, if any. */
  | {
      key: string;
      label: string;
      kind: "search-relative";
      caption: string;
      fact: string | null;
    };

export type PanelJob = {
  id: string;
  title: string;
  companyName: string;
  span: string;
  locationCity: string | null;
  employmentType: string | null;
  description: string | null;
};

export type PanelAward = {
  key: string;
  title: string;
  detail: string | null;
  outcomeLabel: string;
  /** Pre-formatted on the server. Never a Date across the boundary. */
  occurredOn: string | null;
};

export type CandidateRecruiterView = {
  card: {
    /** The given name a recruiter sees in the clear. */
    givenName: string;
    /**
     * How many glyphs of surname a recruiter does NOT see, or null when there is
     * none. A LENGTH, never the surname and never a decoy of it — nothing that
     * could be read as a name goes into this page's HTML.
     */
    maskedLength: number | null;
    roleLabel: string;
    trackLabel: string | null;
    pills: CardPill[];
    skills: CardSkill[];
    openToWork: boolean;
    availabilityUnknown: boolean;
    evidenceLine: string;
    summary: string;
    hasLinkedin: boolean;
    hasGithub: boolean;
  };
  dims: EvidenceDim[];
  tabs: {
    awards: PanelAward[];
    jobs: PanelJob[];
    hasNoWorkExperience: boolean;
    education: { level: string | null; note: string };
    skills: CardSkill[];
    workingLanguages: string[];
  };
  findability: CandidateFindability;
  performance: { searchAppearances: number; recruiterActions: number };
};

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function monthYear(month: number | null, year: number | null): string {
  if (!year) return "";
  const name = month && month >= 1 && month <= 12 ? MONTH_SHORT[month - 1] : "";
  return name ? `${name} ${year}` : String(year);
}

/** Same span format the recruiter inspector prints (`candidate-inspector.tsx`). */
function jobSpan(row: {
  startMonth: number;
  startYear: number;
  endMonth: number | null;
  endYear: number | null;
  isCurrent: boolean;
}): string {
  const from = monthYear(row.startMonth, row.startYear);
  const to = row.isCurrent ? "Present" : monthYear(row.endMonth, row.endYear);
  if (!from && !to) return "";
  return from && to ? `${from} – ${to}` : from || to;
}

function pct(n: number): number {
  return Math.round(n * 100);
}

/**
 * The five dimensions that measure the candidate and nothing else, plus the
 * three that cannot be measured without a recruiter's search.
 *
 * Order matches the recruiter's own score chart so the two read the same way.
 */
function buildDims(
  ev: OwnTrackEvidence | null,
  years: number | null,
): EvidenceDim[] {
  const searchRelative: EvidenceDim[] = [
    {
      key: "stack",
      label: "Stack match",
      kind: "search-relative",
      caption:
        "Scored against the exact skills each recruiter asks for, so it changes with every search.",
      fact: null,
    },
    {
      key: "role",
      label: "Role match",
      kind: "search-relative",
      caption:
        "How close your titles and skills sit to the role being searched for. No search, no number.",
      fact: null,
    },
    {
      key: "experience",
      label: "Experience",
      kind: "search-relative",
      caption:
        "Scored against the years each recruiter asks for — three years is a perfect fit for one role and short for another.",
      fact:
        years != null && years > 0
          ? `${years} ${years === 1 ? "year" : "years"} on your profile`
          : null,
    },
  ];

  if (!ev) {
    // Profile-only: honest zeros are still wrong here. There is no track record
    // to measure, so every measured dimension is unavailable rather than 0.
    return [
      {
        key: "missions",
        label: "Missions passed",
        kind: "unavailable",
        caption:
          "You have no track record on ABTalks yet. Finish days of a challenge or a cohort and this starts measuring.",
      },
      {
        key: "cleanPass",
        label: "First-try passes",
        kind: "unavailable",
        caption: "Needs passed missions to measure.",
      },
      {
        key: "projects",
        label: "Graded projects",
        kind: "unavailable",
        caption: "Needs a graded project.",
      },
      {
        key: "consistency",
        label: "Consistency",
        kind: "unavailable",
        caption: "Needs submission days to measure.",
      },
      {
        key: "interview",
        label: "Interview",
        kind: "unavailable",
        caption: "You have not sat a platform interview.",
      },
      ...searchRelative,
    ];
  }

  const dims: EvidenceDim[] = [];

  dims.push({
    key: "missions",
    label: "Missions passed",
    kind: "measured",
    value: pct(missionScore(ev.missionsPassed, ev.cohortDay, ev.maxEarnable)),
    caption: `${ev.missionsPassed} passed out of the ${Math.max(3, Math.min(ev.cohortDay, ev.maxEarnable))} you have had time to earn. Measured against your own elapsed days, not the full track.`,
  });

  dims.push(
    ev.missionsPassed > 0
      ? {
          key: "cleanPass",
          label: "First-try passes",
          kind: "measured",
          value: pct(cleanPassScore(ev.cleanPassCount, ev.missionsPassed)),
          caption: `${ev.cleanPassCount} of your ${ev.missionsPassed} passes went through on the first verification run.`,
        }
      : {
          key: "cleanPass",
          label: "First-try passes",
          kind: "unavailable",
          caption: "Nothing passed yet, so there is nothing to measure.",
        },
  );

  dims.push(
    ev.projectScores.length > 0
      ? {
          key: "projects",
          label: "Graded projects",
          kind: "measured",
          value: pct(projectScore(ev.projectScores)),
          caption: `${ev.projectScores.length} graded ${ev.projectScores.length === 1 ? "project" : "projects"}. Weighted towards your best one.`,
        }
      : {
          key: "projects",
          label: "Graded projects",
          kind: "unavailable",
          caption:
            "Your track has not produced a graded project for you yet, so recruiters see this as unmeasured rather than as a zero.",
        },
  );

  dims.push({
    key: "consistency",
    label: "Consistency",
    kind: "measured",
    value: pct(
      consistencyScore(ev.commitDays, ev.cohortDay, ev.consistencyWindow),
    ),
    caption: `${ev.commitDays} ${ev.commitDays === 1 ? "day" : "days"} with work submitted, against the days you have had. Showing up is the signal.`,
  });

  dims.push(
    ev.interview
      ? {
          key: "interview",
          label: "Interview",
          kind: "measured",
          value: pct(interviewScore(ev.interview)),
          caption:
            "The mean of your communication, technical, problem-solving and overall interview marks.",
        }
      : {
          key: "interview",
          label: "Interview",
          kind: "unavailable",
          caption:
            "You have not sat a platform interview, so recruiters see this as unmeasured rather than as a zero.",
        },
  );

  return [...dims, ...searchRelative];
}

function buildPills(
  ev: OwnTrackEvidence | null,
  years: number | null,
  educationLine: string | null,
): CardPill[] {
  const pills: CardPill[] = [];

  if (years != null && years > 0) {
    pills.push({
      kind: "exp",
      text: `${years} ${years === 1 ? "yr" : "yrs"}`,
    });
  }

  // The card's location is the candidate's STATED PREFERRED CITIES, not the city
  // on their profile — `to-public-match.ts:197` builds it from
  // `availability.preferredCities`. Worth showing plainly: a complete profile
  // with no stated preference still has no location on its card.
  const cities = (ev?.preferredCities ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (cities.length > 0) {
    pills.push({ kind: "location", text: cities.join(" · ") });
  }

  if (ev?.workMode) {
    pills.push({ kind: "employment", text: WORK_MODE[ev.workMode] ?? ev.workMode });
  }

  if (educationLine) {
    pills.push({ kind: "education", text: educationLine });
  }

  return pills;
}

const WORK_MODE: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  FLEXIBLE: "Flexible",
};

export async function getCandidateRecruiterView(
  userId: string,
): Promise<CandidateRecruiterView | null> {
  // The recruiter-safe overlay. If this has nothing for the candidate there is no
  // `CandidateProfile` row, and there is no recruiter view to show.
  const identities = await loadRecruiterIdentities([userId]);
  const identity = identities.get(userId);
  if (!identity) return null;

  const [evidence, workHistory, awards, verifiedSkills, performance, discovery] =
    await Promise.all([
      loadOwnTrackEvidence(userId),
      listPublicWorkHistory(userId),
      getVerifiedAccomplishments(userId, "wins-only"),
      // Newer tables that are not on every environment yet. The preview degrades
      // to an empty section rather than 500ing, exactly as `/profile` does.
      getVerifiedSkills(userId).catch((e: unknown) => {
        logger.warn("[profile] recruiter-view verified skills unavailable", {
          message: e instanceof Error ? e.message : String(e),
        });
        return [] as Awaited<ReturnType<typeof getVerifiedSkills>>;
      }),
      getProfilePerformance(userId),
      getCandidateDiscoverability(userId),
    ]);

  const years = identity.yearsExperience;
  const roleLabel = recruiterRoleLabel({
    jobRole: identity.role ?? "",
    yearsExperience: years,
  });
  const { given, maskedLength } = recruiterVisibleName(identity.fullName);

  // Evidence-backed skills are named by `getVerifiedSkills`; everything else on
  // the card is the candidate's own claim. Matched case-insensitively because the
  // two lists come from different tables.
  const verifiedNames = new Set(
    verifiedSkills.map((s) => s.name.trim().toLowerCase()),
  );
  const skills: CardSkill[] = identity.skills.map((name) => ({
    name,
    evidenceBacked: verifiedNames.has(name.trim().toLowerCase()),
  }));

  const educationLine = identity.education?.trim() || null;

  const summaryInput = {
    source: evidence?.source,
    jobRole: identity.role ?? "",
    displayName: identity.fullName,
    availabilityUnknown: evidence?.availabilityUnknown ?? true,
    evidence: {
      skills: identity.skills,
      yearsExperience: years ?? undefined,
      missionsPassed: evidence?.missionsPassed,
      totalTrackDays: evidence?.totalTrackDays ?? null,
      cleanPassCount: evidence?.cleanPassCount,
      commitDayCount: evidence?.commitDays,
      projectScores: evidence?.projectScores,
      certificateIssued: evidence?.certificateIssued,
      quizAverage: evidence?.quizAverage ?? null,
      workingLanguages: evidence?.workingLanguages,
    },
  };

  return {
    card: {
      givenName: given,
      maskedLength,
      roleLabel,
      trackLabel: trackLongLabel(evidence?.source),
      pills: buildPills(evidence, years, educationLine),
      skills,
      openToWork: evidence?.openToWork ?? false,
      availabilityUnknown: evidence?.availabilityUnknown ?? true,
      evidenceLine: verifiedEvidenceSentence(summaryInput.evidence),
      summary: candidateSummaryDetail(summaryInput),
      hasLinkedin: identity.hasLinkedin,
      hasGithub: identity.hasGithub,
    },
    dims: buildDims(evidence, years),
    tabs: {
      awards: awards.map((a) => ({
        key: a.key,
        title: a.title,
        detail: a.detail,
        outcomeLabel: a.outcomeLabel,
        occurredOn: a.occurredAt
          ? a.occurredAt.toLocaleDateString("en-IN", {
              month: "short",
              year: "numeric",
              timeZone: "Asia/Kolkata",
            })
          : null,
      })),
      jobs: workHistory.rows.map((row) => ({
        id: row.id,
        title: row.title,
        companyName: row.companyName,
        span: jobSpan(row),
        locationCity: row.locationCity,
        employmentType: row.employmentType,
        description: row.description,
      })),
      hasNoWorkExperience: workHistory.hasNoWorkExperience,
      education: {
        level: educationLine,
        // The dossier carries the university name but the card and panel never
        // print it — `MatchCardData.evidence.educationLevel` says "Declared
        // education level only — never the university name". Saying so is better
        // than a candidate assuming their college was on show.
        note: "Recruiters see your degree and graduation year. Your institution's name is not on the card.",
      },
      skills,
      workingLanguages: evidence?.workingLanguages ?? [],
    },
    findability: discovery
      ? toCandidateSafeChecks(discovery)
      : {
          appears: false,
          headline: "We could not read your search status just now.",
          rows: [],
          platformHold: false,
        },
    performance,
  };
}
