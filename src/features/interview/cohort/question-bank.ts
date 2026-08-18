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

export const QUESTION_BANK_VERSION = "2026-08-14.1";

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
    text: "Why did the program have you run a model locally with Ollama before using any hosted API?",
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
  },
  {
    id: "d15-q09",
    competency: "PRACTICAL",
    difficulty: "medium",
    text: "You logged 10 full-pipeline results on Day 11 and compared them to your Day 10 retrieval baseline. What changed once generation was added?",
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
  },
  {
    id: "d15-q01",
    competency: "CONCEPTUAL",
    difficulty: "medium",
    text: "You split the policy documents into chunks of 500 characters with 50 characters of overlap before embedding them. Why does the overlap matter, and what would you expect to break if you set it to zero?",
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
      "Think about a policy exclusion that spans two chunks — what does retrieval return?",
  },
  {
    id: "d15-q10",
    competency: "PROBLEM_SOLVING",
    difficulty: "medium",
    text: "Your local chatbot kept conversation history. Describe how you stored it, and what breaks in a long conversation.",
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
    followUpPrompt: "What happens on turn fifty?",
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
  },
  {
    id: "d15-q07",
    competency: "CONCEPTUAL",
    difficulty: "medium",
    text: "You compared Chroma and Pinecone and chose Chroma. What was the reasoning, and what would make you switch?",
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
    followUpPrompt: "At what point does that choice stop working?",
  },
  {
    id: "d15-q02",
    competency: "PRACTICAL",
    difficulty: "hard",
    text: "On Day 10 you classified questions as structured, unstructured, or both. Give me an actual question from your test harness that needed both paths, and tell me what each path returned.",
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
      "Which part of that answer came from SQL and which from the vector store?",
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
    text: "Walk me through what happens between a member pressing send and the first token appearing on their screen, in your streamed /chat.",
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
  },
  {
    id: "d31-q02",
    competency: "PROBLEM_SOLVING",
    difficulty: "hard",
    text: "A member's conversation passes roughly 2000 tokens of history. What does your system do, and what is the risk of that strategy?",
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
    followUpPrompt: "What is the one thing that must survive summarisation?",
  },
  {
    id: "d31-q03",
    competency: "CONCEPTUAL",
    difficulty: "hard",
    text: "Why does PII redaction sit on the logging path specifically, and what does putting it there not protect against?",
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
    followUpPrompt: "Does redacting the log stop PHI reaching the model?",
  },
  {
    id: "d31-q08",
    competency: "PRACTICAL",
    difficulty: "hard",
    text: "You containerised the app, then deployed it to Minikube with two backend replicas. What actually had to change between docker-compose and Kubernetes?",
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
  },
  {
    id: "d31-q06",
    competency: "PRACTICAL",
    difficulty: "hard",
    text: "Which RAGAS metric came out weakest, what was your hypothesis, and did your fix actually move it?",
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
    followUpPrompt: "Did the number move after your fix?",
  },
  {
    id: "d31-q10",
    competency: "PROBLEM_SOLVING",
    difficulty: "hard",
    text: "A member says an answer is wrong, but the bot cited a policy source. How do you investigate?",
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
