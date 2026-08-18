import { z } from "zod";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { ISSUE_TYPES } from "@/features/interview/types";
import type {
  AnswerEvidence,
  InterviewPlan,
  InterviewState,
  InterviewStatus,
  TranscriptLine,
} from "@/features/interview/types";

/**
 * Types for the LangGraph interview agent — the "brain" that decides what the
 * interviewer says next.
 *
 * Nothing here duplicates the persistence model. `AnswerEvidence`,
 * `InterviewState`, `InterviewPlan` and `TranscriptLine` are imported from
 * `features/interview/types.ts`, which remains the single source of truth for
 * anything written to the database. The agent adds only the vocabulary the
 * turn-level conversation needs: an action set that includes REDIRECT and
 * REPEAT, and the graph channel shape.
 */

/** The plan document calls a transcript entry a TranscriptTurn. Same thing. */
export type TranscriptTurn = TranscriptLine;

/**
 * What the interviewer does after an answer.
 *
 * Superset of the persisted `TurnAction`. REDIRECT and REPEAT are conversation
 * moves that leave the question on the floor and consume no follow-up budget,
 * so they never reach `advanceTurn`.
 */
export const AGENT_ACTIONS = [
  "FOLLOW_UP",
  "NEXT_QUESTION",
  "REDIRECT",
  "REPEAT",
  "COMPLETE",
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/** The subset an LLM is allowed to propose. COMPLETE is never the model's call. */
export const LLM_ACTIONS = [
  "FOLLOW_UP",
  "NEXT_QUESTION",
  "REDIRECT",
  "REPEAT",
] as const;
export type LlmAction = (typeof LLM_ACTIONS)[number];

/* ------------------------------------------------------- structured output */

/**
 * Schema every model response is validated against before the application
 * touches it. Anything that fails this is not "mostly fine" — it is discarded
 * in favour of a deterministic fallback, because a half-parsed decision is how
 * an assessment silently loses its rules.
 */
export const interviewDecisionSchema = z.object({
  action: z.enum(LLM_ACTIONS),
  reason: z.string().max(500).default(""),
  evidence: z
    .object({
      conceptualFound: z.boolean().default(false),
      practicalFound: z.boolean().default(false),
      tradeoffsFound: z.boolean().default(false),
      flaggedIssues: z.array(z.enum(ISSUE_TYPES)).default([]),
      reasoning: z.string().max(500).default(""),
    })
    .default({
      conceptualFound: false,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: [],
      reasoning: "",
    }),
  followUpQuestion: z.string().max(600).nullish(),
  acknowledgement: z.string().max(300).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
});

export type InterviewDecision = {
  action: LlmAction;
  reason: string;
  evidence: AnswerEvidence;
  followUpQuestion?: string | null;
  /**
   * One short, neutral sentence reacting to what the candidate just said, spoken
   * before the next question so the interview sounds like a conversation rather
   * than a form. Never evaluative — see `resolveAcknowledgement`.
   */
  acknowledgement?: string | null;
  confidence?: number | null;
  /**
   * True when this decision came from the deterministic fallback rather than a
   * validated model response. Logged and surfaced in tests; the interview keeps
   * running either way.
   */
  degraded: boolean;
};

/* ---------------------------------------------------------- graph channels */

/**
 * The agent's working state for ONE turn.
 *
 * Deliberately NOT a second copy of the interview: `interviewState` is the
 * persisted record and stays authoritative. The flat fields around it
 * (currentQuestionId, followUpCount, …) are the read-only view the nodes and
 * the prompt need, projected from the plan and the persisted state when the
 * turn opens.
 */
export type InterviewAgentState = {
  interviewId: string;
  blueprint: InterviewBlueprintKey;

  plan: InterviewPlan;
  interviewState: InterviewState;

  currentQuestionId: string;
  currentQuestionIndex: number;
  currentQuestion: string;

  candidateAnswer: string;

  transcript: TranscriptTurn[];
  evidence: Record<string, AnswerEvidence>;

  followUpCount: number;
  maxFollowUps: number;
  redirectCount: number;
  repeatCount: number;

  decision: InterviewDecision | null;
  lastDecision: AgentAction | null;
  nextPrompt: string | null;
  finished: boolean;
  status: InterviewStatus;

  /** Set only when a node refuses the turn (stale question, not in progress). */
  error: string | null;
};
