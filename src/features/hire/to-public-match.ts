import type {
  MatchCardData,
  PublicScoreSlice,
} from "@/components/hire/match-card";
import type { ScoredCandidate } from "@/features/hire/types";
import { formatBandLpa } from "@/features/hire/compensation";
import { ROLE_FAMILY_LABEL } from "@/features/hire/role-family";

const WORK_MODE_LABEL: Record<string, string> = {
  ONSITE: "Onsite",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
  FLEXIBLE: "Flexible",
};

const SCORE_KEYS: (keyof PublicScoreSlice)[] = [
  "stack",
  "missions",
  "cleanPass",
  "projects",
  "consistency",
  "interview",
  "experience",
];

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return items.length ? items : undefined;
}

/** The seven dimension scores. Drops weights and anything else on the blob. */
export function pickPublicScores(raw: unknown): PublicScoreSlice | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const slice: PublicScoreSlice = {
    stack: numOrNull(row.stack),
    missions: numOrNull(row.missions),
    cleanPass: numOrNull(row.cleanPass),
    projects: numOrNull(row.projects),
    consistency: numOrNull(row.consistency),
    interview: numOrNull(row.interview),
    experience: numOrNull(row.experience),
  };
  const any = SCORE_KEYS.some((k) => slice[k] !== null);
  return any ? slice : undefined;
}

/**
 * Whitelist of evidence the browser may see.
 *
 * The stored match blob still carries `company` from CandidateEvidence. That
 * must never ride along — identity waits on an accepted introduction.
 */
export function pickPublicEvidence(raw: unknown): MatchCardData["evidence"] {
  if (!raw || typeof raw !== "object") return {};
  const e = raw as Record<string, unknown>;
  const out: MatchCardData["evidence"] = {};
  const skills = strList(e.skills);
  if (skills) out.skills = skills;
  if (typeof e.missionPoints === "number") out.missionPoints = e.missionPoints;
  if (typeof e.missionsPassed === "number") out.missionsPassed = e.missionsPassed;
  if (typeof e.missionsAttempted === "number") {
    out.missionsAttempted = e.missionsAttempted;
  }
  if (typeof e.cleanPassCount === "number") out.cleanPassCount = e.cleanPassCount;
  if (typeof e.commitDayCount === "number") out.commitDayCount = e.commitDayCount;
  if (Array.isArray(e.projectScores)) {
    out.projectScores = e.projectScores.filter(
      (n): n is number => typeof n === "number",
    );
  }
  if (typeof e.yearsExperience === "number") {
    out.yearsExperience = e.yearsExperience;
  }
  const langs = strList(e.workingLanguages);
  if (langs) out.workingLanguages = langs;
  if (typeof e.cohortDay === "number") out.cohortDay = e.cohortDay;
  if (typeof e.certificateIssued === "boolean") {
    out.certificateIssued = e.certificateIssued;
  }
  if (typeof e.quizAverage === "number" || e.quizAverage === null) {
    out.quizAverage = e.quizAverage as number | null;
  }
  if (typeof e.totalTrackDays === "number" || e.totalTrackDays === null) {
    out.totalTrackDays = e.totalTrackDays as number | null;
  }
  if (typeof e.educationLevel === "string" && e.educationLevel.trim()) {
    out.educationLevel = e.educationLevel.trim();
  }
  if (typeof e.workMode === "string" && e.workMode.trim()) {
    out.workMode = e.workMode.trim();
  }
  if (typeof e.githubConnected === "boolean") {
    out.githubConnected = e.githubConnected;
  }
  if (typeof e.linkedinConnected === "boolean") {
    out.linkedinConnected = e.linkedinConnected;
  }
  if (typeof e.interviewOverall === "number" || e.interviewOverall === null) {
    out.interviewOverall = e.interviewOverall as number | null;
  }
  if (typeof e.interviewComm === "number" || e.interviewComm === null) {
    out.interviewComm = e.interviewComm as number | null;
  }
  if (typeof e.interviewTech === "number" || e.interviewTech === null) {
    out.interviewTech = e.interviewTech as number | null;
  }
  if (typeof e.interviewProblem === "number" || e.interviewProblem === null) {
    out.interviewProblem = e.interviewProblem as number | null;
  }
  return out;
}

function workModeLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return WORK_MODE_LABEL[raw] ?? raw;
}

function locationLabel(
  cities: string[] | undefined,
): string | null {
  if (!cities?.length) return null;
  return cities
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}

/** The candidate's own words where there are any, the derived bucket otherwise. */
function declaredRole(match: ScoredCandidate): string {
  const raw = match.dossier?.rawRoleLabel.value ?? match.jobRole;
  if (raw && raw !== "Not stated") return raw;
  const family = match.dossier?.roleFamily.value;
  return family ? ROLE_FAMILY_LABEL[family] : "Candidate";
}

/**
 * What a browser is allowed to see of a scored candidate.
 *
 * Drops company, userId, email and profile URLs. Given name is allowed on the
 * card; contact still waits on an introduction. This is the one mapper so a
 * guest action cannot accidentally spread a ScoredCandidate across the wire.
 */
export function toPublicMatch(
  match: ScoredCandidate & { rationale?: string | null },
  opts?: {
    shortlisted?: boolean;
    coverageNote?: string | null;
    highlightSkills?: string[];
  },
): MatchCardData {
  const dossier = match.dossier;
  const declaredPay = dossier?.compensation.declared ?? null;
  const estimate = dossier?.compensation.estimate ?? null;
  const ev = dossier?.evidence;
  const interview = match.evidence.interview;
  const links = dossier?.links.value;
  const edu = dossier?.education.value;
  const availability = dossier?.availability;
  const compensationDeclared = Boolean(declaredPay);
  const compensationBand = declaredPay
    ? formatBandLpa({
        min: declaredPay.min,
        max: declaredPay.max,
        currency: "INR",
        confidence: "MEDIUM",
      })
    : estimate
      ? formatBandLpa(estimate)
      : null;

  return {
    candidateRef: match.candidateRef,
    source: match.source,
    programMemberId: match.programMemberId,
    displayName: match.fullName.trim() ? match.fullName.trim() : null,
    // The raw job title is free text the member typed ("STUDENT", "B.Tech 3rd"
    // year Student"). The derived family is the readable version; the raw one
    // stays on the dossier for the profile page to attribute properly.
    //
    // Most challenge participants never stated a role at all, and "Not stated"
    // as the heading of every second card tells a recruiter nothing. The
    // derived family is what the card is actually about — it is marked DERIVED
    // on the dossier, so nothing here is passed off as the candidate's claim.
    jobRole: declaredRole(match),
    locationLabel: locationLabel(availability?.preferredCities),
    score: match.score,
    tier: match.tier,
    rationale: match.rationale ?? null,
    gaps: match.gaps,
    availabilityUnknown: match.availabilityUnknown,
    shortlisted: opts?.shortlisted ?? false,
    engagementStatus: null,
    scores: pickPublicScores(match.scoreBreakdown),
    compensationBand,
    compensationDeclared,
    coverageNote: opts?.coverageNote ?? null,
    highlightSkills: opts?.highlightSkills?.length
      ? opts.highlightSkills
      : undefined,
    evidence: {
      skills: match.evidence.skills,
      missionPoints: match.evidence.missionPoints,
      missionsPassed: match.evidence.missionsPassed,
      missionsAttempted: match.evidence.missionsAttempted,
      cleanPassCount: match.evidence.cleanPassCount,
      commitDayCount: match.evidence.commitDayCount,
      projectScores: match.evidence.projectScores,
      yearsExperience: match.evidence.yearsExperience,
      workingLanguages: match.evidence.workingLanguages,
      cohortDay: match.evidence.cohortDay,
      // Shown, never scored — see the notes on these facts in types.ts.
      certificateIssued: ev?.certificateIssued?.value ?? false,
      quizAverage: ev?.quizAverage?.value ?? null,
      totalTrackDays: ev?.cohortProgress.value.ofDays ?? null,
      educationLevel: edu?.level?.trim() || null,
      workMode: workModeLabel(availability?.preferredWorkMode),
      githubConnected: links?.github ?? false,
      linkedinConnected: links?.linkedin ?? false,
      interviewOverall: interview?.overall ?? null,
      interviewComm: interview?.comm ?? null,
      interviewTech: interview?.tech ?? null,
      interviewProblem: interview?.problem ?? null,
    },
  };
}
