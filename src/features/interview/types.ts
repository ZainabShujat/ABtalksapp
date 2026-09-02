import { z } from "zod";

export const COMPETENCIES = [
  "CONCEPTUAL",
  "PRACTICAL",
  "PROBLEM_SOLVING",
  "TECHNICAL_DEPTH",
  "COMMUNICATION",
] as const;
export type Competency = (typeof COMPETENCIES)[number];

export const EVIDENCE_TIERS = [
  "NONE",
  "CLAIMED",
  "EXPLAINED",
  "DEMONSTRATED",
] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export const QUESTION_SOURCES = [
  /** A fixed AI Cohort bank question, grounded in cohort curriculum days. */
  "COHORT_CURRICULUM",
  /**
   * A question from a versioned interview-platform pack (plan 103). Carries no
   * cohort day: its provenance is `{packId, packVersion, sectionId}`, recorded
   * on the question itself.
   */
  "PLATFORM_PACK",
  "CHALLENGE_TASK",
  "RESUME_CLAIM",
  "PROFILE_SKILL",
  "GENERIC",
] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

/* ---------------------------------------------------------------- context */

export type CompletedChallengeTask = {
  submissionId: string;
  enrollmentId: string;
  challengeId: string;
  domain: string;
  challengeTitle: string;
  dayNumber: number;
  dailyTaskId: string;
  title: string;
  problemStatement: string;
  learningObjectives: string[];
  tags: string[];
  difficulty: string;
  hasGithubProof: boolean;
  hasLinkedinProof: boolean;
  submittedAt: Date;
};

export type ChallengeEnrollmentContext = {
  enrollmentId: string;
  challengeId: string;
  domain: string;
  title: string;
  status: string;
  totalDays: number;
  /** Days with an actual Submission row — the only assessable surface. */
  completedDays: number;
  currentStreak: number;
  longestStreak: number;
};

export type ChallengeContext = {
  enrollments: ChallengeEnrollmentContext[];
  /** Completed days only, already ranked and capped for prompt use. */
  tasks: CompletedChallengeTask[];
  totalCompletedDays: number;
  /** Every completed submission id — the basis of the retake rule. */
  completedSubmissionIds: string[];
};

export type ResumeExperience = {
  title: string;
  company: string;
  highlights: string[];
};

export type ResumeContext = {
  /**
   * False when we only have self-reported profile fields. No parsed resume
   * exists in ABTalks yet — see docs/plans/066.
   */
  hasStructuredResume: boolean;
  headline: string | null;
  summary: string | null;
  targetRole: string | null;
  skills: string[];
  experience: ResumeExperience[];
  projects: string[];
  /** Present but never fetched or parsed — recorded for provenance only. */
  resumeUrl: string | null;
};

export type CandidateContext = {
  userId: string;
  fullName: string;
  domain: string;
  role: string | null;
  organization: string | null;
  yearsExperience: number | null;
  college: string | null;
  challenge: ChallengeContext;
  resume: ResumeContext;
};

/* --------------------------------------------------------------- planning */

export type QuestionSourceRef = {
  source: QuestionSource;
  submissionId?: string;
  challengeId?: string;
  dayNumber?: number;
  dailyTaskId?: string;
  /** Cohort day numbers a COHORT_CURRICULUM question draws on. */
  sourceDays?: number[];
  label: string;
};

/**
 * CORE questions are the fixed spine — identical for every candidate at a
 * milestone, and the ONLY input to the comparable overall score.
 *
 * EXTENSION questions come from cohort days the member has passed BEYOND the
 * blueprint's scope (the "took DAY_15 on day 18" case). They are asked, judged
 * and reported, but deliberately excluded from the overall score: if they
 * counted, two DAY_15 results would no longer measure the same thing.
 */
export const QUESTION_TIERS = ["CORE", "EXTENSION"] as const;
export type QuestionTier = (typeof QUESTION_TIERS)[number];

export type PlannedQuestion = {
  id: string;
  order: number;
  competency: Competency;
  sourceRef: QuestionSourceRef;
  /**
   * The canonical question. For a cohort bank question this is the bank text,
   * byte-identical across candidates — it is what makes two scores comparable,
   * and it is what evaluation grades against.
   */
  text: string;
  /**
   * What the candidate actually hears: `text`, optionally preceded by one
   * factual clause about their own work (see `cohort/grounding.ts`). Absent
   * means "spoken exactly as `text`". The grading target is never the grounded
   * form, so personalisation cannot move a score.
   */
  spokenText?: string;
  /**
   * True when `spokenText` was phrased by the model rather than read from the
   * bank. Frozen into the plan so a transcript can always be checked against
   * the authored target it was generated from.
   */
  phrasedByModel?: boolean;
  /** True when a real artifact was found and referenced in `spokenText`. */
  grounded?: boolean;
  /** The fact that was referenced, for the plan/report audit trail. */
  groundingNote?: string | null;
  /** CORE by default; EXTENSION for beyond-milestone questions. */
  tier?: QuestionTier;
  /** How this question interrogates its competency. */
  mode?: import("@/features/interview/cohort/question-bank").QuestionMode;
  /** Escalation rungs for a candidate who already cleared the bar. */
  deepProbes?: readonly import("@/features/interview/cohort/question-bank").DeepProbe[];
  /** Narrower probes for a candidate below the bar. */
  scaffoldProbes?: readonly import("@/features/interview/cohort/question-bank").ScaffoldProbe[];
  /**
   * True once an LLM phrased it. Always FALSE for cohort bank questions — the
   * standardized wording is what makes scores comparable, so it is never
   * rewritten.
   */
  llmPhrased: boolean;
  difficulty: "easy" | "medium" | "hard";

  /* --- cohort bank fields; absent on general-interview questions --------- */

  /** Id in the fixed bank. Same as `id` for cohort questions. */
  bankQuestionId?: string;
  /** What a complete spoken answer contains. Drives evaluation + follow-ups. */
  expectedEvidence?: string[];
  /** Evidence items needed before the answer counts as sufficient. */
  minEvidence?: number;
  /** Per-question follow-up budget. 0 means never probe. */
  maxFollowUps?: number;
  /** Deterministic fallback probe, used when LLM follow-up drafting fails. */
  followUpPrompt?: string | null;

  /* --- interview-platform fields (plan 103); absent on cohort questions --- */

  /**
   * The pack section this question belongs to. Replaces the cohort's curriculum
   * module as the grouping unit in a platform report, so a report can say
   * "Prompting: 3 of 4" without any notion of a cohort day.
   */
  sectionId?: string;

  /**
   * The DOMAIN RUBRIC competency this question scores against.
   *
   * Deliberately separate from `competency` above, which stays one of the five
   * engine competencies. That field is not presentational — `depth.ts` keys the
   * competence signal and the escalation ceiling off it, so widening it to an
   * arbitrary string would silently change how every interview adapts. A
   * platform question therefore declares both: `competency` for the engine's
   * bookkeeping, `platformCompetencyId` for what the report actually reports.
   */
  platformCompetencyId?: string;
};

/**
 * Provenance frozen into the plan at open. Discriminated so a general-interview
 * plan can never be mistaken for a cohort one by a consumer reading the summary.
 */
export type CohortPlanContext = {
  kind: "COHORT";
  blueprint: "DAY_15" | "DAY_31";
  bankVersion: string;
  /** Cohort days the blueprint covers — 1..15 or 1..31. */
  scopeDays: number[];
  /** CORE questions only. This is the number two results are compared on. */
  questionCount: number;
  /** Beyond-milestone questions appended from the member's live progress. */
  extensionCount?: number;
  /** The member's live progress when the attempt opened. Provenance only. */
  progressDay?: number | null;
  /** How many questions referenced a real artifact of theirs. */
  groundedCount?: number;
  /** First name, for the spoken opening. Optional: a missing profile must not
   *  cost someone their interview, so the greeting degrades instead. */
  candidateFirstName?: string | null;
  /**
   * Compact, deterministic summary of the candidate's progress through the
   * cohort, rendered as labelled text for the live agent. Frozen at plan build
   * — the live agent reads it from the plan, never from the database.
   *
   * Context for the CONVERSATION only. Must never be imported or referenced by
   * scoring, evidence, rubric, or report code.
   */
  progressContext?: string | null;
};

export type GeneralPlanContext = {
  kind: "GENERAL";
  totalCompletedDays: number;
  challengeSourcedQuestions: number;
  resumeSourcedQuestions: number;
  genericQuestions: number;
  hasStructuredResume: boolean;
};

/**
 * Provenance for an interview-platform attempt (plan 103).
 *
 * The platform equivalent of `CohortPlanContext`, and deliberately a third
 * variant rather than a widening of it: a mock interview has no blueprint, no
 * cohort day scope and no milestone, and pretending otherwise is what would put
 * a fake `DAY_15` into a report.
 *
 * `rubric` is FROZEN here at plan build, for the same reason the cohort freezes
 * its question set: a domain config edited mid-flight must not change an attempt
 * already in progress, and a stored report must stay interpretable against the
 * rubric it was actually scored under.
 */
export type PlatformPlanContext = {
  kind: "PLATFORM";
  domainSlug: string;
  domainLabel: string;
  packId: string;
  packVersion: number;
  /** Number of questions asked. Two attempts are compared on this. */
  questionCount: number;
  /** Pack sections, in order. The report's grouping unit. */
  sections: { id: string; label: string }[];
  /** The domain rubric, frozen. Platform scoring reads this, never a const. */
  rubric: {
    id: string;
    competencies: { id: string; label: string; weight: number }[];
  };
  /** Declared workspaces. `["VOICE"]` in Phase 1. Frozen at open. */
  capabilities: string[];
  /** First name for the spoken opening. Null degrades to a nameless greeting. */
  candidateFirstName?: string | null;
  /**
   * Compact, deterministic description of the candidate, built from their own
   * profile at plan time. Frozen here so a profile edited mid-interview cannot
   * change the conversation underneath them.
   *
   * CONTEXT FOR THE CONVERSATION ONLY. It shapes what the interviewer asks and
   * must never reach scoring, evidence or the report as a demonstrated skill.
   * A claim in a profile is a reason to ask a better question, never a mark.
   */
  profileContext?: string | null;
};

export type InterviewPlan = {
  questions: PlannedQuestion[];
  /**
   * Cohort rubric snapshot. Written for provenance and never read anywhere in
   * the codebase (verified: only `cohort/planner.ts` and `mock/mock-provider.ts`
   * write it). A platform plan carries the same default so this field keeps one
   * shape; platform scoring reads `contextSummary.rubric` instead.
   */
  rubricSnapshot: ReturnType<
    typeof import("@/features/interview/rubric").buildRubricSnapshot
  >;
  contextSummary: CohortPlanContext | GeneralPlanContext | PlatformPlanContext;
};

/* ------------------------------------------------------------- evaluation */

export const ISSUE_TYPES = [
  "stuck_or_evasive",
  "no_practical_evidence",
  "factually_wrong",
  "contradicts_earlier",
  "off_topic",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

/**
 * How much of the question the answer actually engaged with.
 *
 * Judged semantically by the model, never by keyword. The three states matter
 * because they route differently: a PARTIAL answer earns a probe, an OFF_TOPIC
 * one earns a redirect and records no evidence at all.
 */
export const RELEVANCE_LEVELS = ["ON_TOPIC", "PARTIAL", "OFF_TOPIC"] as const;
export type Relevance = (typeof RELEVANCE_LEVELS)[number];

export type AnswerEvidence = {
  conceptualFound: boolean;
  practicalFound: boolean;
  tradeoffsFound: boolean;
  flaggedIssues: IssueType[];
  reasoning: string;
  /**
   * Indices into the question's `expectedEvidence` that this answer covered.
   *
   * The difference between "the model said it was fine" and a defensible
   * assessment: the depth ladder compares `matchedEvidence.length` against the
   * question's `minEvidence`, and the report cites the items by name. Optional
   * because attempts opened before this shipped have no such field — read it
   * as `?? []`.
   */
  matchedEvidence?: number[];
  /** Semantic relevance of the answer. Read as `"ON_TOPIC"` when absent. */
  relevance?: Relevance;
};

export type TurnAction =
  | "FOLLOW_UP"
  | "ESCALATE"
  | "NEXT_QUESTION"
  | "END_INTERVIEW";

export type TurnDecision = {
  evidence: AnswerEvidence;
  action: TurnAction;
  followUpText: string | null;
  candidateStuck: boolean;
};

export type CompetencyJudgment = {
  competency: Competency;
  tier: EvidenceTier;
  justification: string;
};

export type InterviewScores = {
  perCompetency: { competency: Competency; score: number; tier: EvidenceTier }[];
  overallScore: number;
  summary: string;
};

/* ------------------------------------------------------------------ state */

export type TranscriptLine = {
  role: "interviewer" | "candidate";
  text: string;
  questionId: string | null;
  ts: number;
};

export type InterviewStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ABANDONED"
  | "INVALID";

export type InterviewState = {
  status: InterviewStatus;
  currentQuestionIndex: number;
  /**
   * Targets already put to the candidate, in the order asked.
   *
   * What makes non-sequential selection safe: with an index cursor, "already
   * asked" was implied by being behind the cursor, and that stops being true
   * the moment the interview can jump. Optional because the cohort never jumps
   * and its persisted states have no such field — read it through
   * `askedIds()`, which backfills from `currentQuestionIndex`.
   */
  askedQuestionIds?: string[];
  followUpsAsked: number;
  consecutiveStuckAnswers: number;
  /**
   * Off-topic redirects issued on the question currently open. Optional because
   * attempts opened before the LangGraph agent shipped have no such field; read
   * it as `?? 0`.
   */
  redirectsAsked?: number;
  /** Repeat requests served on the question currently open. See above. */
  repeatsAsked?: number;
  /** Clarifications answered on the question currently on the floor. */
  clarificationsAsked?: number;
  /**
   * The highest interruption "speech generation" this interview has accepted.
   *
   * The browser stamps every spoken interviewer line with a monotonically
   * increasing number and sends it back with any utterance that interrupted
   * that line. This field is the SERVER's record of the newest one it has acted
   * on, and it is what makes replay and staleness detectable without trusting
   * the client and without a second store: a submission is admitted only if its
   * generation is strictly greater than this.
   *
   * Living on `InterviewState` is deliberate. That object is already the single
   * persisted source of truth for the interview, already written inside the
   * same `saveTurn` as every other turn effect, and already survives across
   * requests — so the guard cannot drift from the state it is guarding, and
   * costs no extra write.
   *
   * Optional: interviews that predate barge-in have no such field, and it is
   * read as `?? -1` so the first real submission is always admitted.
   */
  lastInterruptionGeneration?: number;
  /**
   * The conversational moves the interviewer has recently made, oldest first.
   *
   * Fed to the phrasing stage so it does not make the same move three turns
   * running. Distinct from varying the WORDING, which the analyse stage already
   * handles via `recentOpeners`: four differently-phrased acknowledgements in a
   * row still read as four acknowledgements in a row, and that is the pattern a
   * listener actually notices.
   *
   * Optional and bounded to the last handful. Attempts created before the
   * phrasing stage existed have no such field, and it is read as `?? []`.
   */
  recentMoves?: string[];
  /**
   * How deep the conversation has gone on the question currently open.
   * 1 = the core question as banked; 2 and 3 are escalation rungs. Resets with
   * every new question, like the other per-question counters.
   */
  depthLevel?: number;
  /** Escalations spent on the question currently open. */
  escalationsAsked?: number;
  /**
   * Running competence read per competency, as CONSECUTIVE strong/weak answers.
   *
   * This is what makes the interview adapt across questions rather than only
   * within one. Consecutive rather than cumulative on purpose: the spec's "do
   * not punish a candidate indefinitely for one weak answer" is expressed as a
   * counter that resets the moment they recover.
   */
  /**
   * The early read of how far this candidate can be pushed.
   *
   * Distinct from `competenceSignal`, which is a rolling per-competency streak
   * that resets constantly. Calibration is set ONCE, from the first few core
   * answers, and then holds — it is the difference between "how did that last
   * answer go" and "who am I talking to".
   *
   * It changes DEPTH POSTURE only: how readily the interview escalates, and
   * whether a struggling candidate gets a scaffold before a harder rung. It
   * never changes which CORE questions are asked, because that is the basis on
   * which two candidates are compared.
   */
  calibration?: {
    answered: number;
    strong: number;
    weak: number;
    level: "FOUNDATIONS" | "WORKING" | "ADVANCED" | null;
  };
  competenceSignal?: Partial<
    Record<Competency, { strong: number; weak: number }>
  >;
  transcript: TranscriptLine[];
  evidenceByQuestionId: Record<string, AnswerEvidence>;
  startedAtMs: number | null;
};

/* --------------------------------------------------------- eligibility */

/**
 * AI Cohort milestone eligibility. Every field is server-derived; the client
 * receives this only to render copy and never sends it back.
 *
 * `taken` is terminal — each blueprint is claimable exactly once, enforced by a
 * partial unique index on COMPLETED rows.
 */
export type CohortEligibility =
  | { state: "ready" }
  | {
      state: "locked";
      reason: string;
      /** Scope days not yet passed. */
      missingDays: number[];
      passedCount: number;
      needed: number;
    }
  | { state: "in_progress"; interviewId: string; startedAt: string | null }
  | { state: "taken"; overallScore: number | null };

/* -------------------------------------- general interview (not V1) -------- */

export type InterviewEligibility =
  | { state: "locked"; reason: string; completedDays: number; needed: number }
  | { state: "ready"; attemptNumber: number; eligibleSubmissionIds: string[] }
  | {
      state: "retake_locked";
      reason: string;
      newDaysSinceLastAttempt: number;
      needed: number;
    }
  | { state: "in_progress"; startedAt: string };

/* ------------------------------------------------------------- boundaries */

export const transcriptLineSchema = z.object({
  role: z.enum(["interviewer", "candidate"]),
  text: z.string().max(8000),
  questionId: z.string().nullable(),
  ts: z.number().int().nonnegative(),
});

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1),
  answerText: z.string().max(8000),
});

export const completeInterviewSchema = z.object({
  transcript: z.array(transcriptLineSchema).max(500),
  durationSec: z.number().int().min(0).max(7200),
});
