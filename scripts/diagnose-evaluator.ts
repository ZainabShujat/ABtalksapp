/**
 * Why does "the evaluator was unavailable" keep happening?
 *
 * A DIAGNOSTIC, not a regression test. It reproduces the live conditions the
 * minimal probe does not: a full-size prompt with accumulated conversational
 * memory, a real transcript window, profile context and a long answer — which
 * is what a turn looks like by question four, and is when the failures were
 * actually observed.
 *
 * It captures the provider's own failure message (the logger writes to console,
 * so console is intercepted) and times every call, so the answer is a
 * measurement rather than a hypothesis.
 *
 * Run: npx tsx scripts/diagnose-evaluator.ts
 */
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getStartableDomain } from "../src/features/interview/platform/domains";
import { buildPlatformPlan } from "../src/features/interview/platform/planner";
import { formatProfileContext } from "../src/features/interview/platform/profile-context";
import type { AnalyzeAnswerInput } from "../src/features/interview/agent/llm/provider";
import type {
  CandidateContext,
  TranscriptLine,
} from "../src/features/interview/types";

const PROFILE: CandidateContext = {
  userId: "u1",
  fullName: "Zainab Shujat",
  domain: "AI",
  role: "Data Analyst",
  organization: "Acme",
  yearsExperience: 3,
  college: "NUST",
  challenge: {
    enrollments: [],
    tasks: [],
    totalCompletedDays: 12,
    completedSubmissionIds: [],
  },
  resume: {
    hasStructuredResume: true,
    headline: "Python developer moving into AI engineering",
    summary: null,
    targetRole: null,
    skills: ["Python", "RAG", "Chroma", "FastAPI", "LangChain", "Pandas"],
    experience: [
      { title: "Analyst", company: "Acme", highlights: ["Built internal tooling"] },
    ],
    projects: ["A RAG chatbot over our internal documentation"],
    resumeUrl: null,
  },
};

/** What memory looks like by question four or five. */
const MEMORY = [
  '- When you type a question into something like ChatGPT — established: predicts text rather than looking up a stored answer — said: "It predicts the next token based on patterns."',
  '- If you ask the same tool the same question twice — established: generation involves sampling — said: "There is randomness in how it picks words."',
  '- Tell me about something you have used these tools for — established: names a specific real task; describes what came back — said: "I built a chatbot over our internal policy documents using retrieval."',
  '- When you want a genuinely useful answer — established: supplies context or source material — said: "I give it the actual document text and tell it the audience."',
];

const TRANSCRIPT: TranscriptLine[] = [
  {
    role: "interviewer",
    text: "Right, you built a chatbot over your internal docs. What did you actually ask it, and what came back?",
    questionId: "aif-3",
    ts: Date.now() - 60_000,
  },
  {
    role: "candidate",
    text: "I asked it policy questions, like how much leave someone in a particular grade gets. Mostly right, but it confused two similar policies.",
    questionId: "aif-3",
    ts: Date.now() - 30_000,
  },
];

const LONG_ANSWER =
  "So the main thing I built was a retrieval setup over our internal policy " +
  "documents. Originally we tried just pasting the documents into the prompt, " +
  "but they were far too long and it got expensive fast, and the model started " +
  "ignoring the middle of the context entirely. So I moved to retrieval. I " +
  "chunked the documents at around five hundred characters with some overlap, " +
  "because a clause was getting split across two chunks and neither half made " +
  "sense on its own. I embedded them and put them into Chroma. For each " +
  "question I pulled the top four chunks and passed those in. The main problem " +
  "was that when two policies used similar wording, retrieval would confidently " +
  "pull the wrong one, and the answer looked completely plausible. I ended up " +
  "adding metadata filtering so it could only search within the right policy " +
  "area, and I check anything with a number in it against the source document " +
  "myself before I pass it on to anyone.";

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.log("\nno OPENAI_API_KEY — cannot diagnose\n");
    return;
  }

  const serverOnly = require.resolve("server-only");
  require.cache[serverOnly] = {
    id: serverOnly,
    filename: serverOnly,
    loaded: true,
    exports: {},
  } as unknown as NodeJS.Module;

  const { resolveInterviewLLM } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../src/features/interview/agent/llm/registry") as typeof import("../src/features/interview/agent/llm/registry");
  const { buildAnalyzeUserMessage, ANALYZE_SYSTEM_PROMPT } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../src/features/interview/agent/llm/prompt") as typeof import("../src/features/interview/agent/llm/prompt");

  const llm = resolveInterviewLLM();
  const domain = getStartableDomain("ai-fluency")!;
  const plan = buildPlatformPlan(domain, {
    candidateFirstName: "Zainab",
    profileContext: formatProfileContext(PROFILE),
  });
  const question = plan.questions.find((q) => q.id === "aif-3") ?? plan.questions[0]!;

  const input: AnalyzeAnswerInput = {
    question,
    answerText: LONG_ANSWER,
    priorEvidence: null,
    followUpsRemaining: 2,
    recentTranscript: TRANSCRIPT,
    calibratedLevel: "WORKING",
    memory: MEMORY,
    curriculum: "",
    profileContext: formatProfileContext(PROFILE),
    recentOpeners: [
      "Right, you built a chatbot over your internal docs.",
      "Got it, so the randomness comes from sampling.",
    ],
    sessionFacts: { answered: 4, total: 7, remaining: 3, minutesLeft: 6 },
    nextQuestionText: plan.questions[4]?.text ?? null,
    progressContext: null,
  };

  const system = ANALYZE_SYSTEM_PROMPT;
  const user = buildAnalyzeUserMessage(input);
  console.log(`\nprovider : ${llm.name}`);
  console.log(`prompt   : system ${system.length} chars + user ${user.length} chars`);
  console.log(`           ~${Math.round((system.length + user.length) / 4)} input tokens\n`);

  // The provider logs its failure reason through `logger`, which writes to
  // console. Intercept it so the actual message is visible here.
  const failures: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const text = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    if (text.includes("llm call failed") || text.includes("malformed")) {
      failures.push(text);
    }
    realWarn(...args);
  };

  const runs = 8;
  const timings: number[] = [];
  let degraded = 0;

  for (let i = 0; i < runs; i += 1) {
    const started = Date.now();
    const out = await llm.analyzeAnswer(input);
    const ms = Date.now() - started;
    timings.push(ms);
    if (out.degraded) degraded += 1;
    console.log(
      `  run ${i + 1}: ${String(ms).padStart(5)}ms  ${
        out.degraded ? "DEGRADED" : `ok (${out.action})`
      }`,
    );
  }

  console.warn = realWarn;

  const sorted = [...timings].sort((a, b) => a - b);
  const mean = Math.round(timings.reduce((s, t) => s + t, 0) / timings.length);
  console.log(
    `\nlatency  : min ${sorted[0]}ms  median ${sorted[Math.floor(sorted.length / 2)]}ms  ` +
      `max ${sorted[sorted.length - 1]}ms  mean ${mean}ms`,
  );
  console.log(`degraded : ${degraded} of ${runs}`);

  if (failures.length > 0) {
    console.log("\nfailure messages:");
    for (const f of [...new Set(failures)]) console.log(`  ${f}`);
  } else {
    console.log("\nno failures captured in this run.");
  }
  console.log();
}

void main().catch((e) => {
  console.error("diagnose errored:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
