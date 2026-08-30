import type {
  CandidateContext,
  CompletedChallengeTask,
} from "@/features/interview/types";

/**
 * Seeded candidate for the demo provider.
 *
 * This is a real `CandidateContext` — the same shape `buildCandidateContext`
 * returns from Prisma — so the production question planner, turn router,
 * evaluator and scorer consume it without knowing it was seeded. Only the
 * source of the data is fake.
 */

export const DEMO_CANDIDATE_ID = "demo-candidate";

type TaskSeed = {
  day: number;
  title: string;
  problem: string;
  objectives: string[];
  tags: string[];
  difficulty: "easy" | "medium" | "hard";
  github: boolean;
};

/**
 * 34 completed days across two enrollments — comfortably over the 30-day floor,
 * so the demo opens on a `ready` eligibility state. The AI track is the deeper
 * one; the SE track supplies cross-challenge variety so the planner's
 * round-robin across enrollments is visible.
 */
const AI_TASKS: TaskSeed[] = [
  { day: 1, title: "Tokenization from scratch", problem: "Implement a byte-pair encoding tokenizer and compare its vocabulary against a word-level split on the same corpus.", objectives: ["Understand subword vocabularies", "Measure compression ratio"], tags: ["nlp", "tokenization"], difficulty: "easy", github: true },
  { day: 2, title: "Embeddings and cosine similarity", problem: "Embed 500 sentences and build a nearest-neighbour lookup. Report where cosine similarity disagrees with your own judgement.", objectives: ["Vector representations", "Similarity metrics"], tags: ["embeddings"], difficulty: "easy", github: true },
  { day: 3, title: "Chunking strategy comparison", problem: "Compare fixed-size, sentence-aware and recursive chunking on a 40-page PDF. Measure retrieval recall for 20 questions.", objectives: ["Chunking tradeoffs", "Recall measurement"], tags: ["rag", "retrieval"], difficulty: "medium", github: true },
  { day: 5, title: "Build a minimal RAG pipeline", problem: "Wire retrieval to generation end to end. The answer must cite which chunk it used.", objectives: ["Retrieval-augmented generation", "Citation grounding"], tags: ["rag", "llm"], difficulty: "medium", github: true },
  { day: 7, title: "Evaluating retrieval quality", problem: "Build a small labelled set and compute precision@k and recall@k. Explain which one matters more for your use case.", objectives: ["Offline evaluation", "Metric selection"], tags: ["evaluation", "rag"], difficulty: "medium", github: true },
  { day: 9, title: "Prompt injection defences", problem: "Take a RAG app that reads untrusted documents and demonstrate an injection, then defend against it.", objectives: ["Threat modelling for LLM apps", "Input isolation"], tags: ["security", "llm"], difficulty: "hard", github: true },
  { day: 11, title: "Structured output with schemas", problem: "Force a model to return JSON matching a schema. Handle the failure case where it does not.", objectives: ["Schema validation", "Graceful degradation"], tags: ["llm", "validation"], difficulty: "medium", github: true },
  { day: 13, title: "Caching and cost control", problem: "Add a cache layer to an LLM app and measure cost and latency before and after.", objectives: ["Cost modelling", "Cache invalidation"], tags: ["llmops", "performance"], difficulty: "medium", github: true },
  { day: 15, title: "Fine-tuning vs prompting", problem: "Take one classification task and solve it both ways. Report accuracy, cost and iteration speed.", objectives: ["Approach selection", "Empirical comparison"], tags: ["finetuning"], difficulty: "hard", github: true },
  { day: 17, title: "Agent tool use", problem: "Build an agent with three tools where one is unreliable. Make the agent handle the unreliable tool sensibly.", objectives: ["Tool calling", "Failure handling"], tags: ["agents"], difficulty: "hard", github: true },
  { day: 19, title: "Multi-step agent planning", problem: "Give an agent a task needing four dependent steps. Show what happens when step two returns wrong data.", objectives: ["Planning loops", "Error propagation"], tags: ["agents", "planning"], difficulty: "hard", github: true },
  { day: 21, title: "Vector database migration", problem: "Move an index from an in-memory store to a persistent vector database without downtime.", objectives: ["Index portability", "Zero-downtime migration"], tags: ["vectordb", "infra"], difficulty: "medium", github: true },
  { day: 23, title: "Hybrid search", problem: "Combine BM25 and dense retrieval. Show a query where each one alone fails.", objectives: ["Lexical vs semantic retrieval", "Score fusion"], tags: ["retrieval", "search"], difficulty: "hard", github: true },
  { day: 25, title: "Streaming responses", problem: "Stream tokens to a browser client and handle a mid-stream disconnect cleanly.", objectives: ["Streaming protocols", "Connection lifecycle"], tags: ["streaming", "frontend"], difficulty: "medium", github: true },
  { day: 27, title: "Guardrails and refusals", problem: "Add an output filter that blocks a defined category without breaking legitimate queries. Measure the false-positive rate.", objectives: ["Output moderation", "Precision/recall balance"], tags: ["safety", "llm"], difficulty: "hard", github: true },
  { day: 29, title: "Observability for LLM apps", problem: "Instrument a pipeline so you can answer 'why did this specific answer happen' three days later.", objectives: ["Tracing", "Debuggability"], tags: ["observability", "llmops"], difficulty: "medium", github: true },
  { day: 31, title: "Batch inference pipeline", problem: "Process 10,000 documents overnight with retries and resumability.", objectives: ["Batch processing", "Idempotency"], tags: ["pipelines"], difficulty: "medium", github: true },
  { day: 33, title: "Model comparison harness", problem: "Build a harness that runs the same 50 prompts against three models and produces a comparison table.", objectives: ["Benchmarking", "Reproducibility"], tags: ["evaluation"], difficulty: "medium", github: true },
  { day: 35, title: "Context window management", problem: "Handle a conversation that exceeds the context window without losing the thread.", objectives: ["Summarisation strategies", "Memory design"], tags: ["llm", "memory"], difficulty: "hard", github: true },
  { day: 37, title: "Reranking retrieved results", problem: "Add a cross-encoder reranker and quantify whether it was worth the added latency.", objectives: ["Two-stage retrieval", "Latency budgets"], tags: ["retrieval", "reranking"], difficulty: "hard", github: true },
  { day: 39, title: "Handling PDFs with tables", problem: "Extract tabular data from PDFs where the layout is inconsistent.", objectives: ["Document parsing", "Layout handling"], tags: ["parsing"], difficulty: "medium", github: true },
  { day: 41, title: "Rate limiting and backoff", problem: "Make a pipeline survive an API that rate-limits you at unpredictable intervals.", objectives: ["Retry strategies", "Exponential backoff"], tags: ["reliability"], difficulty: "medium", github: true },
  { day: 43, title: "Deploying an inference endpoint", problem: "Deploy a model behind an HTTP endpoint with health checks and a rollback path.", objectives: ["Deployment", "Operational readiness"], tags: ["deployment", "infra"], difficulty: "hard", github: true },
  { day: 45, title: "A/B testing prompts in production", problem: "Run two prompt variants against live traffic and decide which wins with real evidence.", objectives: ["Experiment design", "Statistical significance"], tags: ["experimentation"], difficulty: "hard", github: true },
];

const SE_TASKS: TaskSeed[] = [
  { day: 1, title: "REST API with pagination", problem: "Build an endpoint returning 10,000 rows efficiently. Explain your pagination choice.", objectives: ["API design", "Pagination strategies"], tags: ["api", "backend"], difficulty: "easy", github: true },
  { day: 2, title: "Database indexing", problem: "Take a slow query and make it fast. Show the execution plan before and after.", objectives: ["Query optimisation", "Index design"], tags: ["database", "performance"], difficulty: "medium", github: true },
  { day: 4, title: "Authentication flow", problem: "Implement session-based auth with secure cookie handling and a logout that actually invalidates.", objectives: ["Session management", "Secure defaults"], tags: ["auth", "security"], difficulty: "medium", github: true },
  { day: 6, title: "Race condition in checkout", problem: "Reproduce a double-spend race in a checkout flow and fix it with the right isolation level.", objectives: ["Concurrency", "Transaction isolation"], tags: ["concurrency", "database"], difficulty: "hard", github: true },
  { day: 8, title: "Caching layer", problem: "Add caching to a read-heavy endpoint and handle invalidation on write.", objectives: ["Cache strategies", "Invalidation"], tags: ["caching", "performance"], difficulty: "medium", github: true },
  { day: 10, title: "Background job queue", problem: "Move slow work off the request path with retries and a dead-letter path.", objectives: ["Async processing", "Failure handling"], tags: ["queues", "backend"], difficulty: "medium", github: true },
  { day: 12, title: "Integration testing", problem: "Write tests that catch a regression a unit test would miss.", objectives: ["Test strategy", "Coverage tradeoffs"], tags: ["testing"], difficulty: "medium", github: false },
  { day: 14, title: "API versioning", problem: "Ship a breaking change without breaking existing clients.", objectives: ["Versioning strategies", "Backward compatibility"], tags: ["api", "design"], difficulty: "hard", github: true },
  { day: 16, title: "Observability and logging", problem: "Instrument a service so an on-call engineer can diagnose an incident from logs alone.", objectives: ["Structured logging", "Operational empathy"], tags: ["observability"], difficulty: "medium", github: true },
  { day: 18, title: "Handling file uploads at scale", problem: "Accept large file uploads without exhausting server memory.", objectives: ["Streaming uploads", "Resource limits"], tags: ["backend", "storage"], difficulty: "hard", github: true },
];

function toTask(
  seed: TaskSeed,
  enrollmentId: string,
  challengeId: string,
  challengeTitle: string,
  domain: CompletedChallengeTask["domain"],
  index: number,
): CompletedChallengeTask {
  return {
    submissionId: `${enrollmentId}-sub-${seed.day}`,
    enrollmentId,
    challengeId,
    domain,
    challengeTitle,
    dayNumber: seed.day,
    dailyTaskId: `${enrollmentId}-task-${seed.day}`,
    title: seed.title,
    problemStatement: seed.problem,
    learningObjectives: seed.objectives,
    tags: seed.tags,
    difficulty: seed.difficulty,
    hasGithubProof: seed.github,
    hasLinkedinProof: index % 3 === 0,
    submittedAt: new Date(Date.now() - (60 - seed.day) * 24 * 60 * 60 * 1000),
  };
}

const aiTasks = AI_TASKS.map((seed, i) =>
  toTask(seed, "demo-enr-ai", "demo-ch-ai", "60-Day AI Challenge", "AI", i),
);
const seTasks = SE_TASKS.map((seed, i) =>
  toTask(
    seed,
    "demo-enr-se",
    "demo-ch-se",
    "60-Day Software Engineering Challenge",
    "SE",
    i,
  ),
);

const allTasks = [...aiTasks, ...seTasks];

export const DEMO_CANDIDATE_NAME = "Aarav Sharma";

export function buildDemoCandidateContext(): CandidateContext {
  return {
    userId: DEMO_CANDIDATE_ID,
    fullName: DEMO_CANDIDATE_NAME,
    domain: "AI",
    role: null,
    organization: null,
    yearsExperience: null,
    college: "Vellore Institute of Technology",
    challenge: {
      enrollments: [
        {
          enrollmentId: "demo-enr-ai",
          challengeId: "demo-ch-ai",
          domain: "AI",
          title: "60-Day AI Challenge",
          status: "ACTIVE",
          completedDays: aiTasks.length,
          totalDays: 60,
          currentStreak: 6,
          longestStreak: 11,
        },
        {
          enrollmentId: "demo-enr-se",
          challengeId: "demo-ch-se",
          domain: "SE",
          title: "60-Day Software Engineering Challenge",
          status: "ACTIVE",
          completedDays: seTasks.length,
          totalDays: 60,
          currentStreak: 2,
          longestStreak: 5,
        },
      ],
      tasks: allTasks,
      totalCompletedDays: allTasks.length,
      completedSubmissionIds: allTasks.map((t) => t.submissionId),
    },
    resume: {
      hasStructuredResume: false,
      headline: null,
      summary: null,
      targetRole: null,
      skills: ["Python", "PyTorch", "FastAPI", "PostgreSQL", "Docker"],
      experience: [],
      projects: [],
      resumeUrl: null,
    },
  };
}
