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
  label: string;
};

export type PlannedQuestion = {
  id: string;
  order: number;
  competency: Competency;
  sourceRef: QuestionSourceRef;
  /** Deterministic template text. Replaced by LLM phrasing when available. */
  text: string;
  /** True once an LLM phrased it; false means the fallback template is in use. */
  llmPhrased: boolean;
  difficulty: "easy" | "medium" | "hard";
};

export type InterviewPlan = {
  questions: PlannedQuestion[];
  rubricSnapshot: ReturnType<
    typeof import("@/features/interview/rubric").buildRubricSnapshot
  >;
  contextSummary: {
    totalCompletedDays: number;
    challengeSourcedQuestions: number;
    resumeSourcedQuestions: number;
    genericQuestions: number;
    hasStructuredResume: boolean;
  };
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
