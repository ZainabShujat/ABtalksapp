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

export type PlannedQuestion = {
  id: string;
  order: number;
  competency: Competency;
  sourceRef: QuestionSourceRef;
  /** Deterministic template text. Replaced by LLM phrasing when available. */
  text: string;
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
  questionCount: number;
};

export type GeneralPlanContext = {
  kind: "GENERAL";
  totalCompletedDays: number;
  challengeSourcedQuestions: number;
  resumeSourcedQuestions: number;
  genericQuestions: number;
  hasStructuredResume: boolean;
};

export type InterviewPlan = {
  questions: PlannedQuestion[];
  rubricSnapshot: ReturnType<
    typeof import("@/features/interview/rubric").buildRubricSnapshot
  >;
  contextSummary: CohortPlanContext | GeneralPlanContext;
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

export type AnswerEvidence = {
  conceptualFound: boolean;
  practicalFound: boolean;
  tradeoffsFound: boolean;
  flaggedIssues: IssueType[];
  reasoning: string;
};

export type TurnAction = "FOLLOW_UP" | "NEXT_QUESTION" | "END_INTERVIEW";

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
  followUpsAsked: number;
  consecutiveStuckAnswers: number;
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
