import {
  BLUEPRINT_SCOPE,
  maxScopeDay,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";
import type { Competency } from "@/features/interview/types";

/**
 * The fixed, standardized AI Cohort question banks.
 *
 * Every candidate at a milestone answers the SAME core questions in the SAME
 * order. That is the entire basis on which two candidates' scores may be
 * compared, so nothing here is generated, sampled, shuffled, or rephrased by a
 * model. The LLM never sees this file's `text` as something to rewrite — it only
 * ever judges answers against `expectedEvidence` and drafts a follow-up when
 * `minEvidence` is not met.
 *
 * Content is transcribed from the approved review artifact
 * `docs/plans/068-day15-day31-question-banks.md`, which grounds every question
 * in a specific day of `prisma/content/program/days.json`. The cohort is a
 * single healthcare-coverage chatbot built across all 31 days — every candidate
 * builds the same system, which is what makes a standardized question fair.
 *
 * Pure module: no `server-only`, no Prisma, no fs. The bank is code, not data
 * loaded at runtime, so a malformed bank is a compile error rather than a
 * production incident.
 */

export const QUESTION_BANK_VERSION = "2026-08-20.1";

/**
 * Interview modes. A bank is not a quiz because the same competency is probed
 * from different angles: recall, implementation walk-through, a decision, a
 * debugging scenario. Recorded per question so the report can say WHICH KIND of
 * thinking a candidate is strong at, and so bank composition is reviewable.
 */
export const QUESTION_MODES = [
  "CONCEPTUAL",
  "IMPLEMENTATION",
  "DECISION",
  "DEBUGGING",
  "SCENARIO",
  "TRADEOFF",
  "EVIDENCE",
  "REFLECTION",
  "TRANSFER",
] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];

/**
 * Which real artifact this question can point at.
 *
 * Resolved against the candidate's own submissions at plan time by
 * `cohort/grounding.ts`. If the artifact does not exist the reference is
 * dropped and the question is asked exactly as banked — never softened into a
 * vague claim about work we cannot see.
 */
export type GroundsOn = {
  /** Cohort day whose submission/repo is referenced. */
  day?: number;
  /** Module whose project is referenced. Used with `artifact: "project"`. */
  moduleNumber?: number;
  artifact: "repo" | "submission" | "project";
};

/**
 * An escalation rung: what to ask when the candidate has ALREADY cleared the
 * bar on the core question.
 *
 * This is the difference between an interview and a questionnaire. A strong
 * answer earns a harder question rather than a polite "thank you, next".
 * Because rungs are banked rather than generated, going deeper stays
 * comparable: two candidates who answer equally well hear the same escalation.
 */
export type DeepProbe = {
  /** 2 = one level deeper than the core question, 3 = deepest. */
  level: 2 | 3;
  mode: QuestionMode;
  text: string;
  /** What the deeper answer should contain. Judged like any other evidence. */
  expectedEvidence: string[];
};

/**
 * A scaffold: what to ask when the candidate is BELOW the bar but still
 * engaged. Narrower than the core question and aimed at one specific expected
 * item, so a struggling candidate gets a way back in rather than a repeat of
 * the question they already could not answer.
 */
export type ScaffoldProbe = {
  text: string;
  /** The expected-evidence item this probe is trying to unlock. */
  targets: string;
};

export type CoreQuestion = {
  /** Stable id. Persisted in plan/transcript/evidence — never renumber. */
  id: string;
  competency: Competency;
  difficulty: "easy" | "medium" | "hard";
  /** Asked verbatim. Never LLM-rephrased. */
  text: string;
  /**
   * Cohort days this question draws on. Enforced at module load to lie inside
   * the blueprint's scope — this is what makes "DAY_15 can never ask about
   * Day 16" a structural guarantee rather than an authoring convention.
   */
  sourceDays: number[];
  /** Human-readable provenance, shown to admins and stored in the plan. */
  sourceLabel: string;
  /** What a complete spoken answer contains. Drives evaluation and follow-ups. */
  expectedEvidence: string[];
  /** Evidence items needed before the answer counts as sufficient. */
  minEvidence: number;
  /** Follow-up budget for this question. 0 means never probe. */
  maxFollowUps: number;
  /**
   * Seed used when the model must probe. It targets the gap the bank expects,
   * so a follow-up stays on the same topic even if the LLM call fails.
   */
  followUpPrompt: string | null;

  /** How this question interrogates the competency. */
  mode: QuestionMode;
  /** Optional pointer at the candidate's real work. Omitted ⇒ asked as banked. */
  groundsOn?: GroundsOn;
  /**
   * Escalation ladder, ascending by level. Empty or absent means a strong
   * answer simply moves on — which is correct for questions with nothing
   * deeper to ask.
   */
  deepProbes?: readonly DeepProbe[];
  /** Simplification ladder for a below-bar answer. */
  scaffoldProbes?: readonly ScaffoldProbe[];
};

export type QuestionBank = {
  blueprint: InterviewBlueprintKey;
  version: string;
  /** Asked in array order. */
  questions: readonly CoreQuestion[];
};

/* ------------------------------------------------------------------ DAY_15 */

/**
 * Composition: CONCEPTUAL 3 · PRACTICAL 3 · PROBLEM_SOLVING 2 ·
 * TECHNICAL_DEPTH 2. COMMUNICATION carries no slot by design — it is observed
 * across every answer rather than asked about directly.
 *
 * Order is chosen, not incidental: the one `easy` recall question opens so the
 * candidate settles, no two adjacent questions share a competency, difficulty
 * ramps, and the strongest discriminator (fine-tuning vs retrieval) closes.
 */
const DAY_15_QUESTIONS: readonly CoreQuestion[] = [
  {
    id: "d15-q03",
    competency: "CONCEPTUAL",
    difficulty: "easy",
    text: "What did running the model locally with Ollama let you learn that a hosted API would have hidden from you?",
    sourceDays: [1, 2],
    sourceLabel: "Day 1 VS Code & Python Setup · Day 2 Ollama + AI Coding Assistant",
    expectedEvidence: [
      "No API cost and no key required to start",
      "Data stays on the machine — relevant for coverage/PHI data",
      "Forces understanding of model size versus available RAM",
      "Faster iteration, works offline",
    ],
    minEvidence: 2,
    // The only zero-follow-up question in either bank: it is recall-level, so
    // probing would pad the transcript without adding signal.
    maxFollowUps: 0,
    followUpPrompt: null,
    mode: "CONCEPTUAL",
    groundsOn: { day: 2, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "TRADEOFF",
        text: "When would you not run locally — what makes a hosted API the right call for this chatbot?",
        expectedEvidence: [
          "Model size against available RAM",
          "Throughput or concurrency needs",
          "Quality gap on harder generation",
          "Operational burden of self-hosting",
        ],
      },
      {
        level: 3,
        mode: "SCENARIO",
        text: "Suppose the coverage bot has to serve two hundred members at once. What breaks first on the local setup?",
        expectedEvidence: [
          "Requests serialise on one process",
          "Memory contention between requests",
          "Latency grows under queueing",
          "Would need batching or a hosted endpoint",
        ],
      },
    ],
  },
  {
    id: "d15-q09",
    competency: "PRACTICAL",
    difficulty: "medium",
    text: "You logged 10 full-pipeline results and compared them to your retrieval-only baseline. What changed once generation was added?",
    sourceDays: [10, 11],
    sourceLabel: "Day 10 Retrieval Engine · Day 11 RAG End-to-End & LLM API Basics",
    expectedEvidence: [
      "Names a specific improvement or regression",
      "Distinguishes retrieval quality from generation quality",
      "Notes grounding or citation behaviour",
      "Identifies a case where retrieval was good but the answer still was not",
    ],
    minEvidence: 2,
    maxFollowUps: 1,
    followUpPrompt:
      "Was there a case where the right context still produced a wrong answer?",
    mode: "IMPLEMENTATION",
    groundsOn: { day: 11, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "Take one of those ten where the answer came out wrong. How would you work out whether retrieval or generation caused it?",
        expectedEvidence: [
          "Inspect the retrieved chunks first",
          "Check whether the claim appears in them at all",
          "Separates a retrieval failure from a generation failure",
          "Names a concrete check they actually ran",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "If you could only improve one — retrieval quality or the generation prompt — which buys more for coverage answers?",
        expectedEvidence: [
          "Grounding depends on retrieval first",
          "A perfect prompt cannot recover missing context",
          "Acknowledges the counter-case",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Start smaller — for one question, what did the retrieval step hand back before the model wrote anything?", targets: "Distinguishes retrieval quality from generation quality" },
    ],
  },
  {
    id: "d15-q01",
    competency: "CONCEPTUAL",
    difficulty: "medium",
    text: "You embedded the policy documents in 500-character chunks with 50 characters of overlap. Why does that overlap matter?",
    sourceDays: [6, 7],
    sourceLabel: "Day 6 Building the Knowledge Base · Day 7 Embeddings Explained",
    expectedEvidence: [
      "Overlap preserves context across a chunk boundary",
      "Zero overlap can cut a clause or sentence mid-idea",
      "Retrieval may then return partial or missed exclusion clauses",
      "Tradeoff: more overlap means more chunks, more storage and cost",
    ],
    minEvidence: 2,
    maxFollowUps: 1,
    followUpPrompt:
      "What would you expect to break if you set the overlap to zero?",
    mode: "CONCEPTUAL",
    groundsOn: { day: 6, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "Your policy documents double in size and you keep 500 with 50 overlap. What degrades first — retrieval quality, cost, or latency?",
        expectedEvidence: [
          "More chunks means a larger index",
          "Top-k dilution from near-duplicates",
          "Storage and embedding cost rise",
          "Similarity search latency",
        ],
      },
      {
        level: 3,
        mode: "DECISION",
        text: "How would you actually choose a chunk size for these documents rather than inheriting 500?",
        expectedEvidence: [
          "Measure against a real question set",
          "Align to document structure — clause or section",
          "Trade recall against precision",
          "Re-evaluate after changing it",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Just take one exclusion clause that runs across two chunks — what does the retriever hand back?", targets: "Retrieval may then return partial or missed exclusion clauses" },
    ],
  },
  {
    id: "d15-q10",
    competency: "PROBLEM_SOLVING",
    difficulty: "medium",
    text: "Your local chatbot kept conversation history. How did you store it?",
    sourceDays: [3],
    sourceLabel: "Day 3 First Python Project, Local Chatbot & Git/GitHub",
    expectedEvidence: [
      "Appended turns to a messages list passed back each call",
      "Context window grows toward the token limit",
      "Cost and latency grow with every turn",
      "Would need truncation or summarisation",
    ],
    minEvidence: 2,
    maxFollowUps: 1,
    followUpPrompt:
      "What starts to break once that conversation gets long?",
    mode: "IMPLEMENTATION",
    groundsOn: { day: 3, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "Turn fifty arrives and you are over the context limit. What is your strategy, and what do you refuse to drop?",
        expectedEvidence: [
          "Truncation or summarisation",
          "Keeps the identifying facts — which plan, which member",
          "States the cost against fidelity tradeoff",
        ],
      },
      {
        level: 3,
        mode: "TRANSFER",
        text: "Same problem, but now it is a support agent that must recall a claim number from turn three. Does your strategy still hold?",
        expectedEvidence: [
          "Recognises summarisation can lose identifiers",
          "Pins key facts outside the rolling window",
          "Separates working memory from durable state",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Concretely — where in your code did the previous turns live between requests?", targets: "Appended turns to a messages list passed back each call" },
    ],
  },
  {
    id: "d15-q04",
    competency: "TECHNICAL_DEPTH",
    difficulty: "hard",
    text: "You attached metadata like plan_type and source_type to every chunk. Walk me through what actually differs in Chroma between a query with a metadata filter and one without.",
    sourceDays: [9],
    sourceLabel: "Day 9 Building & Populating the Vector Database",
    expectedEvidence: [
      "The filter restricts the candidate set considered for similarity",
      "It prevents returning another plan's policy text",
      "Without it, top-k can be dominated by irrelevant plans",
      "For coverage answers, correctness matters more than recall",
    ],
    minEvidence: 2,
    maxFollowUps: 1,
    followUpPrompt: "What could a member see if the filter were removed?",
    mode: "IMPLEMENTATION",
    groundsOn: { day: 9, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "A query with the plan_type filter suddenly returns nothing at all. What are the first two things you check?",
        expectedEvidence: [
          "Metadata key or value mismatch at write time",
          "Casing or type of the filter value",
          "Whether chunks were ingested with that metadata",
          "Drops the filter to isolate the cause",
        ],
      },
      {
        level: 3,
        mode: "SCENARIO",
        text: "Two plans share almost identical wording. Does the filter still save you, and what else would you add?",
        expectedEvidence: [
          "The filter scopes correctly by plan",
          "Similarity alone would confuse the two",
          "Suggests reranking or stricter chunk provenance",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Simpler version — what does the filter stop the search from even looking at?", targets: "The filter restricts the candidate set considered for similarity" },
    ],
  },
  {
    id: "d15-q05",
    competency: "PRACTICAL",
    difficulty: "medium",
    text: "You scored five system-prompt variants. Which one did you lock for production, and what specifically made it win?",
    sourceDays: [12],
    sourceLabel: "Day 12 Prompt Engineering Fundamentals",
    expectedEvidence: [
      "Names the variant they chose",
      "Cites the scoring axes — accuracy, tone, conciseness, compliance",
      "Gives a concrete failure of a variant they rejected",
      "Mentions the standard disclaimer / compliance language",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt: "What did the runner-up get wrong that yours got right?",
    mode: "EVIDENCE",
    groundsOn: { day: 12, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "DECISION",
        text: "If tone and accuracy pulled in opposite directions on one variant, how did you break the tie?",
        expectedEvidence: [
          "Names accuracy or compliance as the priority here",
          "Explains why that ordering fits coverage",
          "Gives a concrete instance",
        ],
      },
      {
        level: 3,
        mode: "REFLECTION",
        text: "Looking at that locked prompt now, what would you change before it went in front of real members?",
        expectedEvidence: [
          "Names a concrete weakness",
          "Ties it to an observed failure",
          "Realistic about the compliance language",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Just name the variant you locked, and one thing it did better than the rest.", targets: "Names the variant they chose" },
    ],
  },
  {
    id: "d15-q07",
    competency: "CONCEPTUAL",
    difficulty: "medium",
    text: "You compared Chroma and Pinecone and chose Chroma. What decided it?",
    sourceDays: [7, 8],
    sourceLabel: "Day 7 Embeddings Explained · Day 8 Vector Databases Overview",
    expectedEvidence: [
      "Local and persistent — no external service needed for this build",
      "Cost / no hosting overhead",
      "Pinecone for scale or managed operations",
      "Notes the enterprise access-control consideration",
    ],
    minEvidence: 2,
    maxFollowUps: 1,
    followUpPrompt:
      "What would make you switch to Pinecone?",
    mode: "DECISION",
    groundsOn: { day: 8, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "You are now serving three enterprise clients whose documents may never mix. Does Chroma still hold?",
        expectedEvidence: [
          "Isolation or multi-tenancy concern",
          "Access control per client",
          "Operational burden at that point",
          "Names the trigger to switch",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "What do you actually give up by moving to a managed vector store?",
        expectedEvidence: [
          "Cost",
          "Data leaves your boundary",
          "Vendor lock-in",
          "Less control over indexing",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Start with the simplest reason — what did Chroma let you do on your own machine?", targets: "Local and persistent — no external service needed for this build" },
    ],
  },
  {
    id: "d15-q02",
    competency: "PRACTICAL",
    difficulty: "hard",
    text: "You classified questions as structured, unstructured, or both. Give me a question from your test harness that needed both paths.",
    sourceDays: [4, 5, 10],
    sourceLabel:
      "Day 4 Structured Data · Day 5 Unstructured Data · Day 10 Retrieval / Matching Engine",
    expectedEvidence: [
      "Names a concrete question from their own harness",
      "Describes the SQL/structured lookup returning plan or claim rows",
      "Describes the vector lookup returning policy text",
      "Explains how the two results were combined into one answer",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt:
      "What did each path return for it?",
    mode: "EVIDENCE",
    groundsOn: { day: 10, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "Suppose the SQL half returns the right row but the final answer still contradicts it. Where do you look?",
        expectedEvidence: [
          "Prompt assembly and precedence between sources",
          "The model overriding structured context",
          "Inspects the assembled prompt itself",
          "Strength of the grounding instruction",
        ],
      },
      {
        level: 3,
        mode: "TRANSFER",
        text: "New requirement — the same question has to work for a member with no claim history. What changes?",
        expectedEvidence: [
          "Handles the empty structured result",
          "Falls back to policy text only",
          "Avoids fabricating a claim status",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Take any one question from your harness — what did the SQL side return?", targets: "Describes the SQL/structured lookup returning plan or claim rows" },
    ],
  },
  {
    id: "d15-q08",
    competency: "TECHNICAL_DEPTH",
    difficulty: "hard",
    text: "You validated every tool response with Pydantic before returning it to the model. What goes wrong if you skip that step?",
    sourceDays: [13],
    sourceLabel: "Day 13 Function Calling & Structured Outputs",
    expectedEvidence: [
      "The model receives a malformed or unexpected shape",
      "Downstream hallucination or crash",
      "Type errors surface late, or silently",
      "Validation is the trust boundary between tool output and the model",
    ],
    minEvidence: 2,
    maxFollowUps: 1,
    followUpPrompt: "What does the model do with a field it did not expect?",
    mode: "DEBUGGING",
    groundsOn: { day: 13, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "The tool starts returning an extra nested field one day and validation catches it. What should happen next?",
        expectedEvidence: [
          "Fail closed rather than coerce silently",
          "Log it and surface a safe message",
          "Versioning the tool contract",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "What does strict validation cost you when the upstream tool evolves?",
        expectedEvidence: [
          "Breaks on benign additions",
          "Couples deployments together",
          "Argues for tolerant reading of unknown fields",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "What is the very first thing that goes wrong if one field has the wrong type?", targets: "The model receives a malformed or unexpected shape" },
    ],
  },
  {
    id: "d15-q06",
    competency: "PROBLEM_SOLVING",
    difficulty: "hard",
    text: "A member reports the bot gave them the wrong deductible amount. Would you fix that with fine-tuning or with retrieval? Walk me through your reasoning.",
    sourceDays: [14, 15],
    sourceLabel: "Day 14 Fine-Tuning Concepts · Day 15 LoRA/QLoRA Hands-On",
    expectedEvidence: [
      "Identifies this as a retrieval/data problem, not a style problem",
      "Fine-tuning changes tone and format, not facts",
      "Would inspect the knowledge base or the SQL source first",
      "Fine-tuning on wrong facts bakes the error in",
    ],
    minEvidence: 3,
    // Two follow-ups: reasoning this through out loud needs room, and it is the
    // strongest discriminator in the bank.
    maxFollowUps: 2,
    followUpPrompt: "Where would the wrong number have entered the pipeline?",
    mode: "DECISION",
    groundsOn: { day: 15, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "You have decided it is a data problem. Trace the wrong deductible back — what do you check, in order?",
        expectedEvidence: [
          "The retrieved chunk or the SQL row",
          "The version of the source document",
          "The metadata filter and plan scoping",
          "Reproduces against the eval set",
        ],
      },
      {
        level: 3,
        mode: "TRANSFER",
        text: "Now the complaint is that the tone is too clinical, not that it is wrong. Same answer?",
        expectedEvidence: [
          "Recognises this one IS a style problem",
          "Prompting first, fine-tuning only if it persists",
          "Explains why the tool differs by problem type",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Before deciding — is a wrong deductible a facts problem or a style problem?", targets: "Identifies this as a retrieval/data problem, not a style problem" },
    ],
  },
];

/* ------------------------------------------------------------------ DAY_31 */

/**
 * Composition: PRACTICAL 3 · PROBLEM_SOLVING 4 · CONCEPTUAL 2 ·
 * TECHNICAL_DEPTH 2 — eleven questions.
 *
 * Deeper than DAY_15, enforced three ways: `minEvidence` is 3 on every question
 * (versus 2 on half of DAY_15), every question is `hard`, and PROBLEM_SOLVING
 * gains slots while CONCEPTUAL loses one. Questions ask what the candidate
 * *decided and observed*, not what a thing *is*.
 *
 * Per docs/plans/068 §4 this bank runs the MCP question in place of the weaker
 * observability one, and closes on the capstone roadmap question so the exit
 * interview ends on the candidate's own prioritisation judgement.
 *
 * DAY_31 assumes nothing about whether DAY_15 was taken — the milestones are
 * independent — so the closing synthesis question deliberately spans early and
 * late material.
 */
const DAY_31_QUESTIONS: readonly CoreQuestion[] = [
  {
    id: "d31-q01",
    competency: "TECHNICAL_DEPTH",
    difficulty: "hard",
    text: "In your streamed /chat, what has to finish before the model can write the first token?",
    sourceDays: [18],
    sourceLabel: "Day 18 Full-Stack Integration & Streaming Responses",
    expectedEvidence: [
      "Request reaches FastAPI /chat",
      "Retrieval completes before generation can start",
      "StreamingResponse yields SSE data: lines from the LLM SDK",
      "Streamlit consumes with stream=True and st.empty()",
      "Pre-first-token loading UX exists because retrieval adds latency",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt: "Where does the delay before the first token come from?",
    mode: "IMPLEMENTATION",
    groundsOn: { day: 18, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "The first token now takes eight seconds. Where do you instrument to find out why?",
        expectedEvidence: [
          "Times retrieval separately from generation",
          "Checks embedding and query latency",
          "Checks time-to-first-token from the model",
          "Measures before optimising",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "Would you start streaming before retrieval finishes? What does that buy and cost?",
        expectedEvidence: [
          "Perceived latency against correctness",
          "Cannot ground an answer before context arrives",
          "Suggests a status indicator instead",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Just the order — what has to finish before the model can write anything at all?", targets: "Retrieval completes before generation can start" },
    ],
  },
  {
    id: "d31-q05",
    competency: "PRACTICAL",
    difficulty: "hard",
    text: "You chaos-tested a broken tool and required that no raw 500 ever reaches the member. Tell me exactly what you broke and what the member saw.",
    sourceDays: [24],
    sourceLabel: "Day 24 Agentic Chatbot — Full Integration",
    expectedEvidence: [
      "Describes how the tool was broken",
      "10-second timeout, at most one retry",
      "A canned support fallback message",
      "Confirms no stack trace or raw 500 surfaced",
      "The failure was still logged for observability",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt: "What did the member actually see on screen?",
    mode: "EVIDENCE",
    groundsOn: { day: 24, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "The tool is not down but slow — nine seconds every time, just under your timeout. What does the member experience?",
        expectedEvidence: [
          "The timeout threshold interacts badly with the retry",
          "Latency compounds across attempts",
          "Would need a tighter budget or a circuit breaker",
        ],
      },
      {
        level: 3,
        mode: "REFLECTION",
        text: "What failure mode do you think you did not cover?",
        expectedEvidence: [
          "Names a real gap honestly",
          "Partial or corrupt response rather than hard failure",
          "Cascading failure across tools",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "What message did the member actually get when the tool failed?", targets: "A canned support fallback message" },
    ],
  },
  {
    id: "d31-q02",
    competency: "PROBLEM_SOLVING",
    difficulty: "hard",
    text: "A member's conversation passes roughly 2000 tokens of history. What does your system do?",
    sourceDays: [20],
    sourceLabel: "Day 20 Conversation Memory & Context Management",
    expectedEvidence: [
      "Summarises the oldest turns",
      "Keeps the last N turns plus plan_id",
      "Risk: the summary drops a detail that mattered — which plan, which claim",
      "Token counting via tiktoken drives the threshold",
      "Explicit tradeoff between cost and fidelity",
    ],
    minEvidence: 3,
    maxFollowUps: 2,
    followUpPrompt:
      "What is the risk of handling it that way?",
    mode: "SCENARIO",
    groundsOn: { day: 20, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "A member complains the bot forgot which plan they are on, halfway through. What happened?",
        expectedEvidence: [
          "plan_id lost during summarisation",
          "Identifiers must be pinned outside the rolling window",
          "Would inspect the summarised payload",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "Summarise more aggressively or keep more raw turns — which way do you lean for coverage support?",
        expectedEvidence: [
          "Cost against fidelity",
          "Accuracy stakes are higher here than in chat",
          "Reasons about a concrete threshold",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "What does your code do first when the history gets too long?", targets: "Summarises the oldest turns" },
    ],
  },
  {
    id: "d31-q03",
    competency: "CONCEPTUAL",
    difficulty: "hard",
    text: "Why does your PII redaction sit on the logging path specifically?",
    sourceDays: [25],
    sourceLabel: "Day 25 AI Governance, PHI Handling & Guardrails",
    expectedEvidence: [
      "Logs persist PHI/PII well beyond the request lifetime",
      "Redaction happens before the write",
      "It does not protect the prompt sent to the model",
      "It does not prevent leakage in the response to the member",
      "Formal compliance review is still required regardless",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt:
      "What does putting it there not protect against?",
    mode: "CONCEPTUAL",
    groundsOn: { day: 25, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "If you had one more place to spend redaction, where would you put it?",
        expectedEvidence: [
          "Before the prompt leaves for the model",
          "On the response path back to the member",
          "Argues for the choice rather than listing both",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "What does redaction break, operationally?",
        expectedEvidence: [
          "Debuggability of real incidents",
          "Support cannot reproduce a case",
          "Suggests reversible tokenisation or restricted access",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "What lives in a log file long after the request is over?", targets: "Logs persist PHI/PII well beyond the request lifetime" },
    ],
  },
  {
    id: "d31-q08",
    competency: "PRACTICAL",
    difficulty: "hard",
    text: "You containerised the app, then deployed it to Minikube with two backend replicas. What was the biggest thing you had to change between docker-compose and Kubernetes?",
    sourceDays: [28, 29],
    sourceLabel: "Day 28 Docker · Day 29 Kubernetes",
    expectedEvidence: [
      "Secrets moved from env_file to a Secret with envFrom",
      "Deployment and Service manifests replace compose services",
      "Health probes wired to /health",
      "Images had to be loaded into the cluster",
      "Chroma data mounting / replica state considerations",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt: "What did you do about the Chroma data with two replicas?",
    mode: "IMPLEMENTATION",
    groundsOn: { day: 29, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "One replica serves stale policy answers and the other is fine. What is your first hypothesis?",
        expectedEvidence: [
          "Chroma state is not shared between replicas",
          "Each pod has its own local volume",
          "Would move to shared storage or a separate service",
        ],
      },
      {
        level: 3,
        mode: "SCENARIO",
        text: "You need zero-downtime deploys. What in your manifest actually matters?",
        expectedEvidence: [
          "Readiness probe correctness",
          "Rolling update strategy",
          "Graceful shutdown for in-flight requests",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "What did you have to do with the secrets that env_file used to handle?", targets: "Secrets moved from env_file to a Secret with envFrom" },
    ],
  },
  {
    id: "d31-q04",
    competency: "PROBLEM_SOLVING",
    difficulty: "hard",
    text: "You ran the same five questions through a single ReAct agent and through the Router/Specialist multi-agent setup. When did multi-agent actually help, and when was it worse?",
    sourceDays: [21, 22],
    sourceLabel: "Day 21 LangChain Agents & Tool Use · Day 22 Multi-Agent Orchestration",
    expectedEvidence: [
      "Names a concrete question where routing helped",
      "Notes the added latency, cost, or complexity",
      "A single agent was sufficient for a narrow tool set",
      "Failure mode: the Router picks the wrong specialist",
      "Cites the saved traces as evidence",
    ],
    minEvidence: 3,
    maxFollowUps: 2,
    followUpPrompt: "Was there a question where the extra hop bought you nothing?",
    mode: "TRADEOFF",
    groundsOn: { day: 22, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "The Router sends a coverage question to the claims specialist. How would you catch that in production?",
        expectedEvidence: [
          "Inspects traces",
          "Treats routing accuracy as a measured metric",
          "A fallback or confirmation step",
        ],
      },
      {
        level: 3,
        mode: "DECISION",
        text: "If you had to ship one of the two tomorrow, which, and what would make you revisit it?",
        expectedEvidence: [
          "Commits to a choice",
          "Ties it to how large the tool surface is",
          "Names the trigger to revisit",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Name one question where the multi-agent setup did better.", targets: "Names a concrete question where routing helped" },
    ],
  },
  {
    id: "d31-q07",
    competency: "TECHNICAL_DEPTH",
    difficulty: "hard",
    text: "You cached exact-match general questions but never claim- or member-specific ones. Why draw the boundary there?",
    sourceDays: [26],
    sourceLabel: "Day 26 Token Governance, Cost Management & Experiment Design",
    expectedEvidence: [
      "Member-specific answers depend on that member's private data",
      "Caching them risks serving one member's data to another",
      "Claim status changes over time — staleness",
      "General policy answers are stable and shared across members",
      "The cost saving concentrates on repeated general questions anyway",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt: "What is the worst case if you cached a claim-status answer?",
    mode: "DECISION",
    groundsOn: { day: 26, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "A general policy document is updated. What does your cache do?",
        expectedEvidence: [
          "Even stable answers go stale",
          "Invalidation keyed to document version",
          "TTL as a blunt instrument",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "How much are you actually saving, and how would you know?",
        expectedEvidence: [
          "Measures hit rate",
          "Cost per cached against uncached answer",
          "Would instrument before widening the cache",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "What is the risk if two different members share one cached answer?", targets: "Caching them risks serving one member's data to another" },
    ],
  },
  {
    id: "d31-q06",
    competency: "PRACTICAL",
    difficulty: "hard",
    text: "Which RAGAS metric came out weakest for you?",
    sourceDays: [27],
    sourceLabel: "Day 27 Evaluation Frameworks",
    expectedEvidence: [
      "Names the metric — faithfulness, relevancy, precision, or recall",
      "States a hypothesis for why it was weakest",
      "Describes one concrete change made",
      "Reports the re-run result",
      // Intentional: a candidate who reports a fix that FAILED should score
      // higher than one who claims everything improved. Honest negative results
      // are the point of Day 27's measure/hypothesise/fix/re-measure loop.
      "Says so plainly if the fix did not work",
    ],
    minEvidence: 3,
    maxFollowUps: 2,
    followUpPrompt:
      "What was your hypothesis for why it was weak?",
    mode: "EVIDENCE",
    groundsOn: { day: 27, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "DEBUGGING",
        text: "Faithfulness is low but context precision is high. What does that combination tell you?",
        expectedEvidence: [
          "The right context was retrieved and generation drifted",
          "Points at the prompt or model, not retrieval",
          "Would tighten the grounding instruction",
        ],
      },
      {
        level: 3,
        mode: "REFLECTION",
        text: "Do you trust the metric itself? Where does RAGAS mislead?",
        expectedEvidence: [
          "LLM-judge variance",
          "Eval set too small to conclude from",
          "The metric may not match member-perceived quality",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Which metric came out lowest — just the name and roughly the number.", targets: "Names the metric — faithfulness, relevancy, precision, or recall" },
    ],
  },
  {
    id: "d31-q10",
    competency: "PROBLEM_SOLVING",
    difficulty: "hard",
    text: "A member says an answer is wrong, but the bot cited a policy source. What do you check first?",
    sourceDays: [10, 19, 27],
    sourceLabel:
      "Day 10 Retrieval Engine · Day 19 Response Formatting & Citations · Day 27 Evaluation Frameworks",
    expectedEvidence: [
      "Check whether the cited chunk actually contains the claim",
      "Separate a retrieval error from a generation error",
      "Check the metadata filter and plan scoping",
      "Reproduce against the eval set",
      "Consider that the source document itself may be wrong or outdated",
    ],
    minEvidence: 3,
    maxFollowUps: 2,
    followUpPrompt: "How would you tell a retrieval bug from a generation bug?",
    mode: "DEBUGGING",
    groundsOn: { day: 19, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "The cited chunk does contain the claim, but the source PDF is a year out of date. Now what?",
        expectedEvidence: [
          "The pipeline worked; data governance failed",
          "Document freshness and versioning",
          "A re-ingestion policy",
        ],
      },
      {
        level: 3,
        mode: "TRANSFER",
        text: "Same complaint, but you have no eval case for that question type. How do you proceed?",
        expectedEvidence: [
          "Builds a minimal reproduction",
          "Adds the case to the eval set",
          "Avoids a one-off patch",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Start here — how do you check whether the cited chunk actually says it?", targets: "Check whether the cited chunk actually contains the claim" },
    ],
  },
  {
    id: "d31-q11",
    competency: "CONCEPTUAL",
    difficulty: "hard",
    text: "You exposed check_coverage as an MCP tool and called it from Claude Desktop or Cline. What does MCP give you that just defining the function in your own agent does not?",
    sourceDays: [23, 24],
    sourceLabel: "Day 23 Model Context Protocol · Day 24 Full Integration",
    expectedEvidence: [
      "The tool becomes callable by any MCP-compatible client, not just their agent",
      "Separates the tool server from the model/host application",
      "A standard protocol rather than a per-framework tool definition",
      "Describes registering the server and confirming a real tool call",
      "Enterprise angle — one governed tool surface, many clients",
    ],
    minEvidence: 3,
    maxFollowUps: 1,
    followUpPrompt:
      "Who else could call your check_coverage tool once it speaks MCP?",
    mode: "CONCEPTUAL",
    groundsOn: { day: 23, artifact: "repo" },
    deepProbes: [
      {
        level: 2,
        mode: "SCENARIO",
        text: "Three teams want to call check_coverage. What now has to be true of your server?",
        expectedEvidence: [
          "Authentication and authorisation per client",
          "Rate limiting",
          "Schema stability as a contract",
          "Audit logging",
        ],
      },
      {
        level: 3,
        mode: "TRADEOFF",
        text: "What does the protocol cost you compared with a plain function call?",
        expectedEvidence: [
          "Transport and serialisation overhead",
          "Another process to run and monitor",
          "Versioning discipline",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Who could call your tool once it speaks MCP that could not before?", targets: "The tool becomes callable by any MCP-compatible client, not just their agent" },
    ],
  },
  {
    id: "d31-q12",
    competency: "PROBLEM_SOLVING",
    difficulty: "hard",
    text: "What is the top item on your v2 roadmap, and why did it beat everything else on the list?",
    sourceDays: [31],
    sourceLabel: "Day 31 Capstone — End-to-End Review & Roadmap",
    expectedEvidence: [
      "Names one specific top roadmap item",
      "Gives the reason it outranked the others — impact, risk, or cost",
      "References evidence from the five live scenarios or Langfuse traces",
      "Acknowledges a known weakness of what they actually shipped",
      "Notes that formal compliance review is still outstanding",
    ],
    minEvidence: 3,
    maxFollowUps: 2,
    followUpPrompt: "What did you leave on the list, and why does it wait?",
    mode: "REFLECTION",
    groundsOn: { day: 31, artifact: "submission" },
    deepProbes: [
      {
        level: 2,
        mode: "DECISION",
        text: "What would have to be true for the second item to jump ahead of it?",
        expectedEvidence: [
          "Names a concrete trigger",
          "Shows the ordering is reasoned rather than fixed",
          "Ties it to impact or risk",
        ],
      },
      {
        level: 3,
        mode: "REFLECTION",
        text: "Of what you shipped, what would you warn the next person about?",
        expectedEvidence: [
          "Honest about a real weakness",
          "Specific rather than generic",
          "Suggests a mitigation",
        ],
      },
    ],
    scaffoldProbes: [
      { text: "Just the top item — what is it?", targets: "Names one specific top roadmap item" },
    ],
  },
];

/* ------------------------------------------------------------------ export */

const BANKS: Record<InterviewBlueprintKey, QuestionBank> = {
  DAY_15: {
    blueprint: "DAY_15",
    version: QUESTION_BANK_VERSION,
    questions: DAY_15_QUESTIONS,
  },
  DAY_31: {
    blueprint: "DAY_31",
    version: QUESTION_BANK_VERSION,
    questions: DAY_31_QUESTIONS,
  },
};

/**
 * Load-time integrity check.
 *
 * The scope assertion is the important one: it makes "DAY_15 can never ask a
 * Day 16–31 question" impossible to violate by editing this file, because the
 * module throws on import rather than shipping a bank that leaks future
 * curriculum into a checkpoint interview. The planner re-checks at selection
 * time as well — cheap, and defence in depth for the one rule that would
 * invalidate every DAY_15 result if it broke.
 */
function assertBankIntegrity(bank: QuestionBank): void {
  const ceiling = maxScopeDay(bank.blueprint);
  const scope = new Set(BLUEPRINT_SCOPE[bank.blueprint]);
  const seen = new Set<string>();

  if (bank.questions.length === 0) {
    throw new Error(`[question-bank] ${bank.blueprint} bank is empty.`);
  }

  for (const q of bank.questions) {
    if (seen.has(q.id)) {
      throw new Error(`[question-bank] duplicate question id ${q.id}.`);
    }
    seen.add(q.id);

    if (q.sourceDays.length === 0) {
      throw new Error(`[question-bank] ${q.id} declares no source days.`);
    }
    for (const day of q.sourceDays) {
      if (!scope.has(day)) {
        throw new Error(
          `[question-bank] ${q.id} references cohort day ${day}, outside ` +
            `${bank.blueprint} scope (1..${ceiling}).`,
        );
      }
    }

    if (q.minEvidence < 1 || q.minEvidence > q.expectedEvidence.length) {
      throw new Error(
        `[question-bank] ${q.id} minEvidence ${q.minEvidence} is not ` +
          `satisfiable against ${q.expectedEvidence.length} evidence items.`,
      );
    }
    if (q.maxFollowUps > 0 && !q.followUpPrompt) {
      throw new Error(
        `[question-bank] ${q.id} allows follow-ups but has no followUpPrompt.`,
      );
    }

    // Escalation rungs must climb. An out-of-order or duplicated level would
    // make "one level deeper" ambiguous, and the ladder picks by position.
    let previousLevel = 1;
    for (const probe of q.deepProbes ?? []) {
      if (probe.level <= previousLevel) {
        throw new Error(
          `[question-bank] ${q.id} deepProbes must ascend by level; saw ` +
            `${probe.level} after ${previousLevel}.`,
        );
      }
      if (probe.expectedEvidence.length === 0) {
        throw new Error(
          `[question-bank] ${q.id} deep probe at level ${probe.level} has no ` +
            `expected evidence, so its answer could never be judged.`,
        );
      }
      previousLevel = probe.level;
    }

    // A scaffold exists to unlock ONE listed evidence item. Pointing it at text
    // that is not in the checklist means the probe cannot close the gap it was
    // written for, which is a silent authoring error rather than a visible one.
    for (const scaffold of q.scaffoldProbes ?? []) {
      if (!q.expectedEvidence.includes(scaffold.targets)) {
        throw new Error(
          `[question-bank] ${q.id} scaffold targets "${scaffold.targets}", ` +
            `which is not one of its expected evidence items.`,
        );
      }
    }
    if ((q.scaffoldProbes?.length ?? 0) > 0 && q.maxFollowUps === 0) {
      throw new Error(
        `[question-bank] ${q.id} has scaffolds but a zero follow-up budget, ` +
          `so they could never be asked.`,
      );
    }
  }
}

for (const bank of Object.values(BANKS)) assertBankIntegrity(bank);

export function getQuestionBank(
  blueprint: InterviewBlueprintKey,
): QuestionBank {
  return BANKS[blueprint];
}

/** Number of core questions a blueprint asks, before follow-ups. */
export function questionCountFor(blueprint: InterviewBlueprintKey): number {
  return BANKS[blueprint].questions.length;
}
