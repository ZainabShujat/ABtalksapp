import { planCohortInterview } from "@/features/interview/cohort/planner";
import type { PlannedQuestion } from "@/features/interview/types";

/**
 * The evaluation dataset for the interview agent.
 *
 * WHAT IS BEING EVALUATED: the model's INTERPRETATION of a candidate answer —
 * relevance, which expected-evidence items it covered, and the turn it
 * proposes. The server-side policy stays authoritative and is evaluated
 * separately by the deterministic suites; here it is applied afterwards so we
 * can see what the model's reading would actually have caused.
 *
 * Expectations are PREDICATES, never exact strings. "Ask about chunk overlap"
 * has a thousand valid phrasings and one wrong meaning, so every check tests
 * behaviour: did it read the answer correctly, did it pick the right kind of
 * turn, did its follow-up stay on the question, did it invent anything.
 *
 * Cases are pinned to real bank questions so the expected-evidence checklists
 * are the production ones, not fixtures written to flatter the agent.
 */

const DAY15 = planCohortInterview("DAY_15");

export function question(id: string): PlannedQuestion {
  const q = DAY15.questions.find((x) => x.id === id);
  if (!q) throw new Error(`eval dataset references unknown question ${id}`);
  return q;
}

/** The turn the model may propose. COMPLETE and ESCALATE are not its call. */
export type ProposedAction = "NEXT_QUESTION" | "FOLLOW_UP" | "REDIRECT" | "REPEAT";
export type Relevance = "ON_TOPIC" | "PARTIAL" | "OFF_TOPIC";

export type EvalCase = {
  id: string;
  /** Which A–L scenario family this belongs to. */
  family: string;
  label: string;
  questionId: string;
  answer: string;
  /** Conversation tail, when the case depends on what came before. */
  priorTurns?: { role: "interviewer" | "candidate"; text: string }[];
  /** Evidence already banked on this question by an earlier turn. */
  priorMatched?: number[];
  followUpsRemaining?: number;

  expect: {
    /** Any of these relevance readings is acceptable. */
    relevance: Relevance[];
    /** Acceptable proposals. Several cases have more than one defensible turn. */
    action: ProposedAction[];
    /** Indices the answer plainly contains. Missing any of these is a miss. */
    mustMatch?: number[];
    /**
     * Indices the answer does NOT contain. Claiming one is a hallucinated
     * credit — the most damaging failure mode for an assessment.
     */
    mustNotMatch?: number[];
    /** A follow-up is required (or forbidden) for this case to pass. */
    requiresFollowUp?: boolean;
    forbidsFollowUp?: boolean;
    /**
     * Substrings the follow-up must NOT contain: technologies, tools or claims
     * the candidate never mentioned and the question never raised. Catches
     * invention.
     */
    followUpMustNotMention?: string[];
    /** At least one of these concepts should appear in a good follow-up. */
    followUpShouldTouch?: string[];
    /** The action the deterministic policy should end up taking. */
    policyAction?: string[];
    notes: string;
  };
};

/* ------------------------------------------------------------------ cases */

/**
 * d15-q03 — "Why run a model locally with Ollama before a hosted API?"
 *   0 No API cost and no key required to start
 *   1 Data stays on the machine — relevant for coverage/PHI data
 *   2 Forces understanding of model size versus available RAM
 *   3 Faster iteration, works offline
 * minEvidence 2 · maxFollowUps 0 · deep probes at L2 (TRADEOFF) and L3 (SCENARIO)
 *
 * d15-q01 — chunk overlap
 *   0 Overlap preserves context across a chunk boundary
 *   1 Zero overlap can cut a clause or sentence mid-idea
 *   2 Retrieval may then return partial or missed exclusion clauses
 *   3 Tradeoff: more overlap means more chunks, more storage and cost
 * minEvidence 2 · maxFollowUps 1
 *
 * d15-q09 — Day 11 pipeline results vs Day 10 retrieval baseline
 *   0 Names a specific improvement or regression
 *   1 Distinguishes retrieval quality from generation quality
 *   2 Notes grounding or citation behaviour
 *   3 Identifies a case where retrieval was good but the answer still was not
 * minEvidence 2 · maxFollowUps 1
 */

export const EVAL_CASES: EvalCase[] = [
  /* ---------------------------------------------- A. strong → deepen */
  {
    id: "A1-strong-full",
    family: "A · strong answer should deepen",
    label: "Covers three of four expected points, unprompted",
    questionId: "d15-q03",
    answer:
      "There was no API cost and no key required to start, and the coverage data never leaves my machine, which matters because it is PHI. It also made me check my available RAM against the model size before pulling llama3.",
    expect: {
      relevance: ["ON_TOPIC"],
      action: ["NEXT_QUESTION"],
      mustMatch: [0, 1, 2],
      mustNotMatch: [3],
      forbidsFollowUp: true,
      policyAction: ["ESCALATE"],
      notes:
        "Clears the bar of 2 with 3 points. The model should not ask for more; the LADDER should take them deeper, which is policy's job, not the model's.",
    },
  },
  {
    id: "A2-strong-chunking",
    family: "A · strong answer should deepen",
    label: "Complete conceptual answer on a different question",
    questionId: "d15-q01",
    answer:
      "The overlap keeps context across a chunk boundary. With zero overlap you can cut a clause in half mid-idea, so retrieval comes back with a partial exclusion clause or misses it entirely. The cost is more chunks to store and embed.",
    expect: {
      relevance: ["ON_TOPIC"],
      action: ["NEXT_QUESTION"],
      mustMatch: [0, 1, 2, 3],
      forbidsFollowUp: true,
      policyAction: ["ESCALATE"],
      notes: "All four points present in plain language. A perfect read is 4/4.",
    },
  },

  /* ------------------------------------------- B. weak but genuine → scaffold */
  {
    id: "B1-weak-genuine",
    family: "B · weak but genuine should scaffold",
    label: "On topic, engaged, establishes nothing",
    questionId: "d15-q01",
    answer:
      "I think the overlap setting matters for how the chunks come out. We used 50 because that is what the notebook had.",
    expect: {
      relevance: ["ON_TOPIC", "PARTIAL"],
      action: ["FOLLOW_UP"],
      mustNotMatch: [0, 1, 2, 3],
      requiresFollowUp: true,
      followUpShouldTouch: ["overlap", "chunk", "boundary", "clause", "split"],
      followUpMustNotMention: ["Pinecone", "fine-tun", "Kubernetes", "Docker"],
      policyAction: ["FOLLOW_UP"],
      notes:
        "Engaged but empty. Must not be read as off-topic, and must not be credited with evidence it never gave.",
    },
  },

  /* ------------------------------------- C. partial → probe the missing item */
  {
    id: "C1-partial-one-short",
    family: "C · partial should probe the gap",
    label: "Two of four points, one obvious gap",
    questionId: "d15-q09",
    answer:
      "Once generation was added the answers read much better, but I could see the retrieval step was already returning the right policy text before the model wrote anything, so I could tell the two apart.",
    expect: {
      relevance: ["ON_TOPIC"],
      action: ["NEXT_QUESTION", "FOLLOW_UP"],
      mustMatch: [1],
      mustNotMatch: [3],
      followUpMustNotMention: ["Kubernetes", "Docker", "Pinecone"],
      notes:
        "Distinguishes retrieval from generation. Has NOT given the good-retrieval-wrong-answer case. A probe should target that, not restate the question.",
    },
  },

  /* --------------------------------------------- D. off-topic → redirect */
  {
    id: "D1-offtopic-question",
    family: "D · off-topic should redirect",
    label: "Asks the interviewer an unrelated question",
    questionId: "d15-q01",
    answer: "Actually, before that — do you know who won the cricket last night?",
    expect: {
      relevance: ["OFF_TOPIC"],
      action: ["REDIRECT"],
      mustNotMatch: [0, 1, 2, 3],
      policyAction: ["REDIRECT"],
      notes: "Must redirect and must never answer the question asked of it.",
    },
  },
  {
    id: "D2-offtopic-request",
    family: "D · off-topic should redirect",
    label: "Asks the interviewer to perform an unrelated task",
    questionId: "d15-q03",
    answer: "Can you write me a short poem about machine learning instead?",
    expect: {
      relevance: ["OFF_TOPIC"],
      action: ["REDIRECT"],
      mustNotMatch: [0, 1, 2, 3],
      policyAction: ["REDIRECT"],
      notes: "A polite refusal-and-redirect, never compliance.",
    },
  },

  /* ------------------------------- E. ambiguous → clarify, don't misclassify */
  {
    id: "E1-ambiguous",
    family: "E · ambiguous should clarify",
    label: "Could mean two different things",
    questionId: "d15-q09",
    answer: "It got better after that change.",
    expect: {
      relevance: ["ON_TOPIC", "PARTIAL"],
      action: ["FOLLOW_UP"],
      mustNotMatch: [0, 1, 2, 3],
      requiresFollowUp: true,
      policyAction: ["FOLLOW_UP"],
      notes:
        "Vague but plainly attempting the question. Reading this as OFF_TOPIC would be the damaging error — it redirects a candidate who is trying.",
    },
  },

  /* ------------------------------------------- F. self-correction → recover */
  {
    id: "F1-self-correct",
    family: "F · self-correction should be credited",
    label: "States something wrong, then corrects it in the same answer",
    questionId: "d15-q01",
    answer:
      "Overlap is mostly about saving storage — no, sorry, that is backwards. Overlap costs you more storage because you get more chunks. The reason you want it is that it keeps context across the boundary so a clause is not cut in half.",
    expect: {
      relevance: ["ON_TOPIC"],
      action: ["NEXT_QUESTION", "FOLLOW_UP"],
      mustMatch: [0, 3],
      notes:
        "The corrected position is the answer. Crediting the retracted claim, or penalising the correction, would both be wrong.",
    },
  },

  /* -------------------------------- G. sophisticated → increase depth */
  {
    id: "G1-sophisticated",
    family: "G · sophisticated answer should deepen",
    label: "Beyond the checklist, technically precise",
    questionId: "d15-q01",
    answer:
      "Overlap preserves context across the boundary so an exclusion clause is not severed mid-sentence, which otherwise shows up as a chunk that retrieves with high similarity but carries only half the condition. The cost is index size — 10 percent overlap is roughly 10 percent more vectors, more embedding spend and slightly worse top-k precision from near-duplicates.",
    expect: {
      relevance: ["ON_TOPIC"],
      action: ["NEXT_QUESTION"],
      mustMatch: [0, 1, 3],
      forbidsFollowUp: true,
      policyAction: ["ESCALATE"],
      notes:
        "Should be recognised as strong. A follow-up here wastes a strong candidate's time; the ladder should escalate instead.",
    },
  },

  /* --------------------------- H. confident but wrong → challenge, not credit */
  {
    id: "H1-confident-wrong",
    family: "H · confident but incorrect should be challenged",
    label: "Fluent, assertive, factually inverted",
    questionId: "d15-q01",
    answer:
      "Overlap exists purely to reduce the number of chunks you store. Setting it to zero would create far more chunks and blow up the index, so you always want high overlap for efficiency.",
    expect: {
      relevance: ["ON_TOPIC"],
      action: ["FOLLOW_UP"],
      mustNotMatch: [0, 1, 2, 3],
      requiresFollowUp: true,
      policyAction: ["FOLLOW_UP"],
      notes:
        "Inverted: overlap increases chunk count. Confidence must not buy credit. Ideally flagged factually_wrong; at minimum, no evidence credited.",
    },
  },

  /* --------------------------------------- I. repetition → do not loop */
  {
    id: "I1-repeat-same-answer",
    family: "I · repetition should not loop",
    label: "Repeats the identical answer after a follow-up",
    questionId: "d15-q01",
    answer:
      "I think the overlap setting matters for how the chunks come out. We used 50 because that is what the notebook had.",
    priorTurns: [
      {
        role: "candidate",
        text: "I think the overlap setting matters for how the chunks come out. We used 50 because that is what the notebook had.",
      },
      {
        role: "interviewer",
        text: "Think about a policy exclusion that spans two chunks — what does retrieval return?",
      },
    ],
    priorMatched: [],
    followUpsRemaining: 0,
    expect: {
      relevance: ["ON_TOPIC", "PARTIAL"],
      action: ["NEXT_QUESTION", "FOLLOW_UP"],
      mustNotMatch: [0, 1, 2, 3],
      policyAction: ["NEXT_QUESTION"],
      notes:
        "No new information and no follow-up budget left. Policy must move on regardless of what the model proposes — this is the anti-loop guarantee.",
    },
  },

  /* ------------- J. very short → weak evidence, not off-topic */
  {
    id: "J1-very-short-relevant",
    family: "J · short answer is weak, not off-topic",
    label: "Three words, on topic",
    questionId: "d15-q03",
    answer: "Mainly for privacy.",
    expect: {
      relevance: ["ON_TOPIC", "PARTIAL"],
      action: ["NEXT_QUESTION", "FOLLOW_UP"],
      mustMatch: [1],
      mustNotMatch: [0, 2, 3],
      notes:
        "Short but correct on one point. Must be credited for privacy and must not be redirected as off-topic.",
    },
  },
  {
    id: "J2-very-short-empty",
    family: "J · short answer is weak, not off-topic",
    label: "Non-answer",
    questionId: "d15-q03",
    answer: "I don't know.",
    expect: {
      relevance: ["ON_TOPIC", "PARTIAL"],
      action: ["NEXT_QUESTION"],
      mustNotMatch: [0, 1, 2, 3],
      policyAction: ["NEXT_QUESTION"],
      notes:
        "Honest not-knowing. Should be flagged stuck and moved on — never probed, never redirected.",
    },
  },

  /* ----------- K. work outside their submissions → do not assume it */
  {
    id: "K1-unsubmitted-work",
    family: "K · must not assume unsubmitted work",
    label: "Mentions a technology outside the cohort curriculum",
    questionId: "d15-q03",
    answer:
      "At work I served this behind a Triton inference cluster with tensor parallelism across four A100s, so local was mostly a formality.",
    expect: {
      relevance: ["ON_TOPIC", "PARTIAL"],
      action: ["NEXT_QUESTION", "FOLLOW_UP"],
      mustNotMatch: [0, 1, 3],
      followUpMustNotMention: ["your Triton cluster", "your A100"],
      notes:
        "The interviewer may ask about it, but must not treat unverifiable outside work as cohort evidence, and must not speak as though it were their submitted work.",
    },
  },

  /* -------------------------------- L. repeat request → repeat, not redirect */
  {
    id: "L1-repeat-request",
    family: "L · repeat request should repeat",
    label: "Asks for the question again",
    questionId: "d15-q01",
    answer: "Sorry, could you say that again? I did not catch the last part.",
    expect: {
      relevance: ["ON_TOPIC", "PARTIAL"],
      action: ["REPEAT"],
      mustNotMatch: [0, 1, 2, 3],
      policyAction: ["REPEAT"],
      notes:
        "Shares no vocabulary with the question, so a naive relevance read calls it off-topic. Redirecting someone who could not hear is a pure false positive.",
    },
  },
];
