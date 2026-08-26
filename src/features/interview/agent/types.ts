import { z } from "zod";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";
import { ISSUE_TYPES, RELEVANCE_LEVELS } from "@/features/interview/types";
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
  "ESCALATE",
  "NEXT_QUESTION",
  "REDIRECT",
  "REPEAT",
  "CLARIFY",
  "COMPLETE",
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/**
 * The subset an LLM is allowed to propose.
 *
 * Neither COMPLETE nor ESCALATE is the model's call. COMPLETE is termination,
 * which belongs to the budget machine. ESCALATE is the adaptive decision, and
 * it is withheld deliberately: if a model could ask to go deeper it would do so
 * out of enthusiasm rather than evidence, and "this candidate is strong" would
 * become a matter of tone rather than of cleared checklist items. The model
 * reports WHAT IT SAW; `depth.ts` decides what that earns.
 */
export const LLM_ACTIONS = [
  "FOLLOW_UP",
  "NEXT_QUESTION",
  "REDIRECT",
  "REPEAT",
  "CLARIFY",
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
      /**
       * 1-based positions from the expected-evidence checklist the model was
       * shown. Converted to 0-based indices and range-filtered by the provider.
       *
       * `.catch([])` is load-bearing. A model once returned `[123]` — meaning
       * items 1, 2 and 3 concatenated — and a strict element bound rejected the
       * WHOLE decision, throwing away a correct action, a correct relevance
       * judgment and a good acknowledgement over one malformed array. A
       * cosmetic field must not be able to invalidate an assessment: a bad
       * value degrades to "made no claim", which the depth ladder already
       * handles as distinct from "claimed nothing matched".
       */
      matchedEvidence: z
        .array(z.number().int().nonnegative())
        .max(40)
        .catch([])
        .default([]),
      relevance: z.enum(RELEVANCE_LEVELS).default("ON_TOPIC"),
    })
    .default({
      conceptualFound: false,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: [],
      reasoning: "",
      matchedEvidence: [],
      relevance: "ON_TOPIC",
    }),
  followUpQuestion: z.string().max(600).nullish(),
  acknowledgement: z.string().max(300).nullish(),
  clarification: z.string().max(400).nullish(),
  bridge: z.string().max(300).nullish(),
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
  /**
   * A direct answer to a clarification the candidate asked about the QUESTION
   * ("what do you mean by locally?"). Spoken before the question is restated
   * verbatim. Records no evidence and spends no budget — see `routeDecision`.
   */
  clarification?: string | null;
  /**
   * One short sentence linking what the candidate just said to the authored
   * deep probe that follows it. The probe text itself is never model-written:
   * an escalation everyone receives differently is not comparable. The bridge
   * is what stops that probe arriving as a non-sequitur.
   */
  bridge?: string | null;
  /**
   * The room submitted its no-response marker rather than anything the
   * candidate said.
   *
   * Kept separate from `stuck_or_evasive`, which describes a real answer that
   * happened to contain nothing. This one means there was no answer at all, so
   * it must not earn a scaffold, must not spend follow-up budget, and must not
   * record evidence — see `routeDecision`.
   */
  noResponse?: boolean;
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
  /** 1 = the core question; 2 and 3 are escalation rungs. */
  depthLevel: number;
  escalationsAsked: number;

  decision: InterviewDecision | null;
  lastDecision: AgentAction | null;
  nextPrompt: string | null;
  finished: boolean;
  status: InterviewStatus;

  /** Set only when a node refuses the turn (stale question, not in progress). */
  error: string | null;
};
