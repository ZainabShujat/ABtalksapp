import type { CandidateSource } from "@/features/hire/candidate-ref";

/**
 * The recruiter-facing wording for a candidate's evidence.
 *
 * One module because three surfaces say the same three things and had already
 * drifted: the card pill said "24 of 31 missions passed", the resume grid said
 * "24 of 31" under a "Missions passed" heading, and the rationale said
 * "Verified: 24 missions passed of 27 attempted". A recruiter reading all three
 * on one screen was reading three different claims about one number.
 *
 * Client-safe on purpose — no `server-only`. The cards and the inspector build
 * their copy at render time, which is also what keeps a rationale stored before
 * this change from putting an `AB-####` label back on the page.
 *
 * Takes plain fields rather than a `MatchCardData`, so the server's rationale
 * builder (which holds a `ScoredCandidate`) reads from the same wording.
 */

/** Track names as a recruiter should read them, e.g. "60-Day Challenge". */
export function trackLongLabel(source?: CandidateSource): string | null {
  switch (source) {
    case "CLAUDE":
      return "Claude Challenge";
    case "CHALLENGE_60":
      return "60-Day Challenge";
    case "HACKATHON":
      return "Hackathon";
    case "PROGRAM":
      return "US Cohort";
    default:
      return null;
  }
}

export type EvidenceFacts = {
  source?: CandidateSource;
  /** The cohort's own name when a loader knows one; the track label otherwise. */
  trackName?: string | null;
  missionsPassed?: number | null;
  totalTrackDays?: number | null;
  cleanPassCount?: number | null;
  commitDayCount?: number | null;
  projectScores?: number[] | null;
  certificateIssued?: boolean | null;
  quizAverage?: number | null;
  workingLanguages?: string[] | null;
  skills?: string[] | null;
};

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * "42 of 60 missions of 60-Day Challenge", or null when there is nothing to
 * claim.
 *
 * Null rather than "0 missions": zero passes is not a result a recruiter should
 * read as one, and "0 of 0" is an empty record rather than a candidate who
 * failed everything. Both fold into "No verified evidence" upstream.
 */
export function missionsLine(f: EvidenceFacts): string | null {
  const passed = count(f.missionsPassed);
  if (passed <= 0) return null;
  const total = count(f.totalTrackDays);
  const span = total > 0 ? `${passed} of ${total}` : String(passed);
  const word = total > 0 || passed !== 1 ? "missions" : "mission";
  const name = f.trackName?.trim() || trackLongLabel(f.source);
  return name ? `${span} ${word} of ${name}` : `${span} ${word}`;
}

/**
 * Everything the platform has actually verified, in the order it is read.
 *
 * Declared skills are deliberately absent: they are the candidate's own claim,
 * the Skills section already shows them as such, and listing them here under a
 * "Verified" heading is the one wording error this surface cannot make.
 */
export function verifiedEvidenceFacts(f: EvidenceFacts): string[] {
  const out: string[] = [];
  const missions = missionsLine(f);
  if (missions) out.push(missions);
  if (f.source === "HACKATHON" && !missions) out.push("a shipped hackathon project");
  const clean = count(f.cleanPassCount);
  if (clean > 0) out.push(`${clean} passed on the first attempt`);
  const commits = count(f.commitDayCount);
  if (commits > 0) out.push(`${commits} verified commit days`);
  const projects = f.projectScores?.length ?? 0;
  if (projects > 0) {
    out.push(`${projects} graded project${projects === 1 ? "" : "s"}`);
  }
  if (typeof f.quizAverage === "number") {
    out.push(`a quiz average of ${f.quizAverage}`);
  }
  if (f.certificateIssued) out.push("a track certificate");
  return out;
}

export const NO_VERIFIED_EVIDENCE = "No verified evidence";

/** The Verified evidence block's one line. Never filler, never declared skills. */
export function verifiedEvidenceSentence(f: EvidenceFacts): string {
  const facts = verifiedEvidenceFacts(f);
  if (facts.length === 0) return NO_VERIFIED_EVIDENCE;
  const joined = joinList(facts);
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

export type SummaryInput = EvidenceFacts & {
  /**
   * The given name, where the surface is already allowed to print one. Null on
   * a locked preview and wherever the pool has no name, and never the family
   * name — the card blurs that until contact is unlocked (`MaskedName`).
   */
  givenName?: string | null;
  jobRole?: string | null;
  /** Drives Student vs Working Professional when jobRole is blank or "Candidate". */
  yearsExperience?: number | null;
  availabilityUnknown?: boolean;
};

/**
 * Recruiter-facing role chip / "is a …" label.
 *
 * The pool often stores the literal "Candidate", which reads as noise next to a
 * name. Empty or "Candidate" becomes Working Professional when they have any
 * years of experience, otherwise Student. Real titles (Data Analyst, etc.) pass
 * through unchanged.
 */
export function recruiterRoleLabel(input: {
  jobRole?: string | null;
  yearsExperience?: number | null;
}): string {
  const role = input.jobRole?.trim() ?? "";
  if (role && role.toLowerCase() !== "candidate") return role;
  const years = input.yearsExperience;
  if (typeof years === "number" && Number.isFinite(years) && years > 0) {
    return "Working Professional";
  }
  return "Student";
}

/** "Priya", or a subject that names nobody. */
function subjectOf(s: SummaryInput): string {
  const given = s.givenName?.trim().split(/\s+/)[0];
  return given || "This candidate";
}

function skillList(s: SummaryInput, max: number): string[] {
  return (s.skills ?? []).map((v) => v.trim()).filter(Boolean).slice(0, max);
}

/**
 * The card's one-liner: who they are and what the platform has verified, as a
 * sentence rather than an id and a score.
 *
 * Third person plural throughout. A given name says nothing about how somebody
 * wants to be referred to, and guessing it wrong on a recruiter's screen is a
 * worse error than the slight stiffness of "they".
 *
 * Absences are omitted: "no verified evidence" belongs under Verified evidence,
 * not in the summary.
 */
export function candidateSummaryLine(s: SummaryInput): string {
  const who = subjectOf(s);
  const skills = skillList(s, 3);
  const role = recruiterRoleLabel(s);
  const parts: string[] = [];

  if (skills.length > 0) {
    parts.push(`${who} lists ${joinList(skills)}.`);
  } else {
    parts.push(`${who} is a ${role}.`);
  }

  const missions = missionsLine(s);
  const commits = count(s.commitDayCount);
  if (missions && commits > 0) {
    parts.push(
      `They have completed ${missions}, with ${commits} verified commit days.`,
    );
  } else if (missions) {
    parts.push(`They have completed ${missions}.`);
  } else if (verifiedEvidenceFacts(s).length > 0) {
    parts.push(`Verified on ABTalks: ${joinList(verifiedEvidenceFacts(s))}.`);
  }

  return parts.join(" ");
}

/** The View Details version: the same facts, with the ones the card dropped. */
export function candidateSummaryDetail(s: SummaryInput): string {
  const who = subjectOf(s);
  const skills = skillList(s, 8);
  const role = recruiterRoleLabel(s);
  const parts: string[] = [];

  if (skills.length > 0) {
    parts.push(
      `${who} is a ${role} and lists ${joinList(skills)} as self-declared skills.`,
    );
  } else {
    parts.push(`${who} is a ${role}.`);
  }

  const facts = verifiedEvidenceFacts(s);
  if (facts.length > 0) {
    parts.push(`On ABTalks they have ${joinList(facts)}.`);
  }

  const languages = (s.workingLanguages ?? [])
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  if (languages.length > 0) {
    parts.push(
      `They worked in ${joinList(languages)} on the missions they passed.`,
    );
  }

  return parts.join(" ");
}

/**
 * A stored rationale, made safe to print on a search surface.
 *
 * Rationales live on `TalentRequestMatch`, so rows written before this change
 * still carry the old shape: an `AB-####` lead-in, a trailing `Gaps:` list and
 * em dashes. Regenerating them is a search away, and until a recruiter runs one
 * the old text is what their screen shows — so the sanitising happens at render
 * rather than only at write.
 */
export function cleanRecruiterCopy(raw: string | null | undefined): string {
  if (!raw) return "";
  const sentences = raw.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return sentences
    .filter((s) => !/^gaps\s*:/i.test(s))
    .filter((s) => !/^AB-[\w?]+\s+scores\b/i.test(s))
    .filter((s) => !/^Ranked on\b/i.test(s))
    .filter(
      (s) =>
        !/^No verified ABTalks evidence\b/i.test(s) &&
        !/\bhas not declared\b/i.test(s),
    )
    .join(" ")
    .replace(/\bAB-[0-9?]{3,}\b/g, "This candidate")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether this text is the pre-2026-09-25 template rather than prose.
 *
 * Sanitising strips the id and the gaps, but what is left of the old builder is
 * still "Declared skills: X. Verified: 4 missions passed of 6 attempted." — the
 * field dump this change exists to replace. Those rows get freshly built prose
 * instead; anything written since reads as written.
 */
function isLegacyTemplate(text: string): boolean {
  return /\bDeclared skills:|\bVerified:\s*\d+\s+missions passed of\b/i.test(text);
}

/**
 * What the detail panel prints as the candidate summary: Scout's own sentences
 * where they are usable, freshly built prose otherwise.
 */
export function recruiterSummary(
  rationale: string | null | undefined,
  s: SummaryInput,
): string {
  const cleaned = cleanRecruiterCopy(rationale);
  if (cleaned.length > 0 && !isLegacyTemplate(cleaned)) {
    const role = recruiterRoleLabel(s);
    return cleaned.replace(/\bis a Candidate\b/gi, `is a ${role}`);
  }
  return candidateSummaryDetail(s);
}

/** Pulls the summary inputs off a match-shaped object. */
export function summaryInputFromMatch(match: {
  source?: CandidateSource;
  jobRole?: string | null;
  displayName?: string | null;
  availabilityUnknown?: boolean;
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
    workingLanguages?: string[];
  };
  /** Set by a locked preview card, whose name must stay behind the blur. */
  locked?: boolean;
}): SummaryInput {
  const e = match.evidence ?? {};
  return {
    source: match.source,
    jobRole: match.jobRole ?? null,
    yearsExperience: e.yearsExperience ?? null,
    givenName: match.locked ? null : (match.displayName ?? null),
    availabilityUnknown: match.availabilityUnknown ?? false,
    missionsPassed: e.missionsPassed ?? null,
    totalTrackDays: e.totalTrackDays ?? null,
    cleanPassCount: e.cleanPassCount ?? null,
    commitDayCount: e.commitDayCount ?? null,
    projectScores: e.projectScores ?? null,
    certificateIssued: e.certificateIssued ?? null,
    quizAverage: e.quizAverage ?? null,
    workingLanguages: e.workingLanguages ?? null,
    skills: e.skills ?? null,
  };
}

/** Exported for the evals — the wording rules a recruiter actually reads. */
export const __test = { isLegacyTemplate, joinList, recruiterRoleLabel };
