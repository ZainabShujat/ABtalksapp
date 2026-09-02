import type {
  AnswerEvidence,
  PlannedQuestion,
} from "@/features/interview/types";
import type {
  InterviewDecision,
  TranscriptTurn,
} from "@/features/interview/agent/types";
import type { InterruptionClassification } from "@/features/interview/interruption";

/**
 * The one seam between the interview brain and any language model.
 *
 * Every LangGraph node talks to this interface and never to an SDK. Swapping
 * Anthropic for Groq, OpenAI or Gemini is therefore a new file in this folder
 * plus one line in `registry.ts` — the graph, the routing policy and the tests
 * do not change. That matters here for a boring reason: this project runs on
 * free tiers, and provider availability is the thing most likely to move.
 */

export type AnalyzeAnswerInput = {
  question: PlannedQuestion;
  answerText: string;
  /** Evidence already banked for THIS question by an earlier turn. */
  priorEvidence: AnswerEvidence | null;
  /**
   * Follow-ups still affordable. Passed so the model does not draft a probe
   * that will be thrown away — it is a hint, never the enforcement point.
   */
  followUpsRemaining: number;
  /** Tail of the conversation, for pronoun/context resolution only. */
  recentTranscript: TranscriptTurn[];
  /**
   * The early read of the candidate's level, once three core answers have
   * landed. Null before that. Shapes the interviewer's TONE only; every
   * assessment decision is still made from the evidence it reports back.
   */
  calibratedLevel?: "FOUNDATIONS" | "WORKING" | "ADVANCED" | null;
  /**
   * Standing summary of what the candidate has already established, one line
   * per answered question. Distinct from `recentTranscript`, which is a short
   * window for resolving references.
   */
  memory?: string[];
  /**
   * What was TAUGHT on the days this question draws on, from the authored
   * curriculum knowledge base. Context for conducting the conversation —
   * concepts, misconceptions, useful follow-ups — never a source of questions
   * or evidence.
   */
  curriculum?: string;
  /**
   * True facts about the session itself, so questions ABOUT the interview can
   * be answered instead of deflected. A candidate asking "how much longer is
   * this?" is asking something reasonable, and a real interviewer answers it.
   */
  sessionFacts?: {
    answered: number;
    total: number;
    remaining: number;
    minutesLeft: number | null;
  };
  /**
   * The authored question that will be asked next if this turn moves on.
   *
   * Given to the model ONLY so the connecting sentence can lead into it. The
   * question itself is still spoken verbatim from the bank — the model never
   * chooses it, rewords it, or decides whether it is reached.
   */
  nextQuestionText?: string | null;
  /**
   * Compact, deterministic summary of the candidate's progress through the
   * cohort, precomputed at plan build. Context for the conversation only —
   * the model may reference it occasionally, but it must never change the
   * technical evidence read or score.
   */
  progressContext?: string | null;
  /**
   * Who the candidate says they are, from their own profile. Shapes what is
   * asked; never evidence of what they know. See `platform/profile-context.ts`.
   */
  profileContext?: string | null;
  /**
   * How the interviewer opened its last few turns.
   *
   * Passed so the model can avoid starting three turns running with "That's
   * interesting" or "Can you walk me through". Variety by awareness rather than
   * by randomisation: the alternative is a shuffled phrase bank, which reads as
   * arbitrary because it is.
   */
  recentOpeners?: string[];
  /**
   * Whether a phrasing stage will run after this call.
   *
   * When true the leaner assessment-only prompt is used, because nothing this
   * call writes for `acknowledgement`, `followUpQuestion` or `bridge` will be
   * spoken. When false or absent — every cohort turn — the original combined
   * prompt is used and the behaviour is unchanged.
   */
  conversational?: boolean;
};

export interface InterviewLLM {
  /** Stable identifier, logged with every turn. */
  readonly name: string;
  /**
   * MUST NOT throw and MUST NOT reject. A provider that cannot produce a
   * validated decision returns a degraded one instead, so a model outage
   * degrades the interview rather than ending it.
   */
  analyzeAnswer(input: AnalyzeAnswerInput): Promise<InterviewDecision>;

  /**
   * Phrases CORE questions from their targets, once, at plan build.
   *
   * OPTIONAL: a provider that cannot do this simply omits it and every question
   * is asked as authored — the interview that existed before generation. Like
   * `analyzeAnswer` it must not throw: an empty map is the degraded answer.
   */
  phraseQuestions?(input: PhraseQuestionsInput): Promise<Record<string, string>>;

  /**
   * STAGE 2. Writes what the interviewer says, from a decision already made.
   *
   * OPTIONAL, and that is load-bearing rather than incidental. The cohort path
   * never calls it: its graph runs with `conversational` unset, so the turn
   * takes exactly the shape it took before this method existed. A provider that
   * omits it — the mock provider, or any future vendor — simply falls back to
   * the prose fields stage 1 already returns, which fall back in turn to the
   * deterministic pools in `policy.ts`. Three levels, and the interview sounds
   * progressively plainer rather than breaking at any of them.
   *
   * MUST NOT throw. A phrasing failure is a duller sentence, never a lost turn.
   */
  phraseTurn?(input: PhraseTurnInput): Promise<TurnPhrasing | null>;

  /**
   * Reads what a candidate meant by talking over the interviewer.
   *
   * OPTIONAL for the same reason: without it, barge-in is simply not offered,
   * and `InterviewRoom` stays half-duplex exactly as it is today.
   *
   * MUST NOT throw. On failure the caller treats the interruption as the safe
   * label — see `interruption.ts:advancesInterview` — which keeps the question
   * on the floor rather than spending it on a guess.
   */
  classifyInterruption?(
    input: ClassifyInterruptionInput,
  ): Promise<InterruptionClassification | null>;
}

/**
 * The conversational moves stage 2 can make, tracked so it does not make the
 * same one three turns running.
 *
 * Varying the MOVE rather than the wording is the distinction that matters:
 * four differently-phrased acknowledgements in a row still read as four
 * acknowledgements in a row. `recentOpeners` on `AnalyzeAnswerInput` already
 * varies wording; this varies what the sentence is DOING.
 */
export const CONVERSATIONAL_MOVES = [
  "acknowledge",
  "observe",
  "challenge",
  "compare",
  "wonder",
  "scenario",
  "narrow",
  "connect",
] as const;

export type ConversationalMove = (typeof CONVERSATIONAL_MOVES)[number];

export type TurnPhrasing = {
  acknowledgement: string | null;
  followUpQuestion: string | null;
  bridge: string | null;
  move: ConversationalMove | null;
};

export type PhraseTurnInput = {
  /** Already routed. Stage 2 cannot change it. */
  action: "FOLLOW_UP" | "NEXT_QUESTION";
  candidateAnswer: string;
  currentQuestion: string;
  followUpReason: string | null;
  targetDetail: string | null;
  /** Points already established on this question, so they are not re-asked. */
  whatIsKnown: string[];
  /**
   * What the answer still lacks, PARAPHRASED.
   *
   * Never the verbatim checklist. A follow-up that quotes an expected-evidence
   * item back at the candidate tells them exactly what to say, which turns the
   * remainder of the question into dictation rather than assessment.
   */
  whatIsMissing: string[];
  recentConversation: TranscriptTurn[];
  recentMoves: ConversationalMove[];
  flaggedIssues: string[];
  calibratedLevel?: "FOUNDATIONS" | "WORKING" | "ADVANCED" | null;
  /** Only for NEXT_QUESTION, so the bridge can lead into it. Never reworded. */
  nextQuestionText?: string | null;
};

export type ClassifyInterruptionInput = {
  utterance: string;
  /** As much of the interviewer's line as the candidate actually heard. */
  interruptedText: string;
  currentQuestion: string;
  recentConversation: TranscriptTurn[];
};

export type PhraseTarget = {
  id: string;
  /** The authored question. The model rewrites this; it never replaces it. */
  authored: string;
  competency: string;
  /** Curriculum lines for the days this target draws on. */
  curriculum: string;
  /** What this candidate actually submitted for those days, if anything. */
  candidateWork: string;
};

export type PhraseQuestionsInput = {
  targets: PhraseTarget[];
  /** Framing band from `question-phrasing.ts`, chosen by calibration. */
  framing: string;
  candidateFirstName?: string | null;
};
