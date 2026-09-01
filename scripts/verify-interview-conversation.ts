/**
 * LIVE conversational-quality probe for Phase A.
 *
 * Unlike every other verifier in this folder, this one CALLS THE REAL MODEL. It
 * exists because the Phase A complaint ("too direct, jumps to the next
 * question, doesn't react") cannot be proved by a mock: the mock provider is
 * deterministic keyword logic and would pass any prompt at all. The only way to
 * know whether the prompt now produces a thoughtful interviewer is to ask it.
 *
 * It asserts BEHAVIOUR, not wording:
 *   - a substantive answer draws an acknowledgement that names something real
 *   - a follow-up carries a structured reason and a specific target
 *   - the profile shapes the question without being treated as evidence
 *   - a non-answer draws no acknowledgement and no invented probe
 *
 * Skipped when no provider key is present, so CI without secrets still passes.
 *
 * Run: npx tsx scripts/verify-interview-conversation.ts
 */
import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });

import { getStartableDomain } from "../src/features/interview/platform/domains";
import { buildPlatformPlan } from "../src/features/interview/platform/planner";
import { formatProfileContext } from "../src/features/interview/platform/profile-context";
import type { AnalyzeAnswerInput } from "../src/features/interview/agent/llm/provider";
import type { CandidateContext } from "../src/features/interview/types";

let checks = 0;
let failures = 0;
function check(label: string, fn: () => void): void {
  try {
    fn();
    checks += 1;
    console.log(`  ok  ${label}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL ${label}\n       ${e instanceof Error ? e.message : e}`);
  }
}

const PROFILE: CandidateContext = {
  userId: "u1",
  fullName: "Zainab Shujat",
  domain: "",
  role: "Data Analyst",
  organization: "Acme",
  yearsExperience: 3,
  college: null,
  challenge: {
    enrollments: [],
    tasks: [],
    totalCompletedDays: 0,
    completedSubmissionIds: [],
  },
  resume: {
    hasStructuredResume: true,
    headline: "Python developer moving into AI engineering",
    summary: null,
    targetRole: null,
    skills: ["Python", "RAG", "Chroma"],
    experience: [],
    projects: ["A RAG chatbot over our internal documentation"],
    resumeUrl: null,
  },
};

const SUBSTANTIVE_ANSWER =
  "I built a chatbot over our internal documentation. I used RAG because the " +
  "docs weren't in the model. I chunked them, put them in Chroma, and retrieved " +
  "the top few for each question. It mostly worked, though it sometimes pulled " +
  "the wrong section.";

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
    console.log("\nlive conversation probe: SKIPPED (no provider key)\n");
    return;
  }

  // `registry.ts` is server-only; this script is the one place that needs a
  // live provider, so the same require-cache shim the E2E uses applies here.
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

  const llm = resolveInterviewLLM();
  console.log(`\nlive conversation probe (provider: ${llm.name})`);
  if (llm.name === "mock") {
    console.log("  provider resolved to mock — nothing to prove. SKIPPED.\n");
    return;
  }

  const domain = getStartableDomain("ai-fluency")!;
  const plan = buildPlatformPlan(domain, {
    candidateFirstName: "Zainab",
    profileContext: formatProfileContext(PROFILE),
  });
  // aif-3 asks what they have actually used these tools for. The RAG answer
  // below is genuinely ON-TOPIC for it. An earlier version of this probe used
  // question 1 ("what is happening when you type a question into ChatGPT") and
  // the model correctly REDIRECTED the RAG answer as off-topic — the probe was
  // wrong, not the interviewer. Worth recording: it is evidence the relevance
  // judgement works.
  const question =
    plan.questions.find((q) => q.id === "aif-3") ?? plan.questions[0]!;

  const base: Omit<AnalyzeAnswerInput, "answerText"> = {
    question,
    priorEvidence: null,
    followUpsRemaining: 2,
    recentTranscript: [],
    calibratedLevel: null,
    memory: [],
    curriculum: "",
    profileContext: formatProfileContext(PROFILE),
    recentOpeners: [],
    sessionFacts: { answered: 0, total: 7, remaining: 7, minutesLeft: 12 },
    nextQuestionText: plan.questions[1]?.text ?? null,
    progressContext: null,
  };

  /* --- a substantive answer with an obvious thread to pull ---------------- */

  const substantive = await llm.analyzeAnswer({
    ...base,
    answerText: SUBSTANTIVE_ANSWER,
  });

  console.log(
    `\n  [substantive] action=${substantive.action} reason=${substantive.followUpReason ?? "-"}`,
  );
  console.log(`  ack:    ${JSON.stringify(substantive.acknowledgement)}`);
  console.log(`  target: ${JSON.stringify(substantive.targetDetail)}`);
  console.log(`  probe:  ${JSON.stringify(substantive.followUpQuestion)}`);

  check("a substantive answer draws an acknowledgement", () => {
    const ack = (substantive.acknowledgement ?? "").trim();
    assert.equal(ack.length > 0, true, "no acknowledgement at all");
  });

  check("the acknowledgement names something the candidate actually said", () => {
    const ack = (substantive.acknowledgement ?? "").toLowerCase();
    assert.equal(
      /rag|chroma|chunk|retriev|document/.test(ack),
      true,
      `generic acknowledgement: ${JSON.stringify(substantive.acknowledgement)}`,
    );
  });

  check("it stays on the thread rather than jumping to a new question", () => {
    assert.equal(
      substantive.action,
      "FOLLOW_UP",
      `moved on instead of probing (action=${substantive.action})`,
    );
  });

  check("a follow-up carries a structured reason and a specific target", () => {
    assert.notEqual(substantive.followUpReason, null, "no followUpReason");
    const target = (substantive.targetDetail ?? "").trim();
    assert.equal(target.length > 10, true, `target too thin: ${target}`);
  });

  check("the probe is specific, not 'can you elaborate'", () => {
    const q = (substantive.followUpQuestion ?? "").toLowerCase();
    assert.equal(q.length > 0, true, "no follow-up question");
    assert.equal(
      /can you elaborate|tell me more about that|explain more/.test(q),
      false,
      `generic probe: ${q}`,
    );
    // "Anchored" is checked structurally rather than against a keyword list I
    // guessed at: the probe must reuse a distinctive word the candidate
    // actually used. An earlier version of this assertion listed the words I
    // expected and failed a probe that quoted "the wrong section" — which was a
    // better follow-up than anything on my list.
    const stop = new Set([
      "that","this","them","they","what","when","with","your","yours","about",
      "could","would","which","there","their","then","from","have","because",
      "into","were","was","the","and","for","you","did","how","why","use","used",
    ]);
    const said = new Set(
      SUBSTANTIVE_ANSWER.toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 3 && !stop.has(w)),
    );
    const echoed = q
      .split(/[^a-z]+/)
      .filter((w) => said.has(w));
    assert.equal(
      echoed.length > 0,
      true,
      `probe reuses nothing the candidate said: ${q}`,
    );
  });

  /* --- a non-answer must not draw filler or an invented probe ------------- */

  const blank = await llm.analyzeAnswer({
    ...base,
    answerText: "I don't know, I've never really thought about it.",
  });
  console.log(
    `\n  [non-answer] action=${blank.action} ack=${JSON.stringify(blank.acknowledgement)}`,
  );

  check("a non-answer is flagged stuck", () => {
    assert.equal(
      blank.evidence.flaggedIssues.includes("stuck_or_evasive"),
      true,
      `flags were ${JSON.stringify(blank.evidence.flaggedIssues)}`,
    );
  });

  check("a non-answer records no evidence", () => {
    assert.deepEqual(blank.evidence.matchedEvidence ?? [], []);
  });

  /* --- the profile must not become evidence ------------------------------ */

  check("a profile claim is not scored as demonstrated", () => {
    // The profile says RAG and Chroma. The answer below mentions neither.
    assert.deepEqual(
      blank.evidence.matchedEvidence ?? [],
      [],
      "profile knowledge leaked into matchedEvidence",
    );
  });

  /* --- the truncation regression: a long answer must still be judged ------ */

  // Phase A added `followUpReason` and `targetDetail` to the decision envelope
  // without raising `max_tokens`, so a talkative turn ran out of budget
  // mid-JSON, the brace matcher found no object, and the turn degraded to
  // keyword rules. That is what produced "3 of 6 answers could not be judged"
  // on a real interview — on answers the candidate had actually given well.
  //
  // This is the regression guard: a deliberately long, rich answer, judged
  // several times. `degraded` is the honest signal, since it is set by the
  // provider only when validation failed and the deterministic fallback ran.
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

  const runs = 5;
  let degradedRuns = 0;
  for (let i = 0; i < runs; i += 1) {
    const out = await llm.analyzeAnswer({ ...base, answerText: LONG_ANSWER });
    if (out.degraded) degradedRuns += 1;
  }

  check(`a long, rich answer is judged reliably (${runs} runs)`, () => {
    assert.equal(
      degradedRuns,
      0,
      `${degradedRuns} of ${runs} long answers degraded — the decision ` +
        `envelope is still running out of token budget`,
    );
  });

  console.log(
    `\n${checks} checks passed${failures > 0 ? `, ${failures} FAILED` : ""}.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

void main().catch((e) => {
  console.error("\nprobe errored:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
