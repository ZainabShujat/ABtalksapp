import type {
  AnswerEvidence,
  PlannedQuestion,
} from "@/features/interview/types";
import type {
  InterviewDecision,
  TranscriptTurn,
} from "@/features/interview/agent/types";

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
  sessionFacts?: { answered: number; total: number; remaining: number };
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
}

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
