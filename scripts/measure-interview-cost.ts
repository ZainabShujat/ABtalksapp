/**
 * Measures what ONE complete AI Cohort interview actually costs on OpenAI.
 *
 *   npm run measure:interview              # DAY_31, real API calls
 *   npm run measure:interview -- DAY_15
 *   npm run measure:interview -- --dry-run # plan only, no API calls
 *
 * WHY THIS EXISTS
 *
 * Capacity against a fixed prepaid balance cannot be planned from "roughly
 * thirty calls at roughly this size". This drives the REAL compiled graph, the
 * REAL question bank and the REAL routing policy with scripted candidate
 * answers, and reads token counts back from OpenAI's own `usage` field rather
 * than estimating them. Speech is priced from the published per-minute rates
 * against the interview's own duration constants.
 *
 * No database and no dev server: the graph is pure with respect to persistence,
 * exactly as `scripts/demo-interview-agent.ts` relies on.
 *
 * The answers below are deliberately MIXED — strong, thin, off-topic, stuck —
 * so the run exercises follow-ups, probes and redirects. An interview of twelve
 * perfect answers is the cheapest possible interview and would understate the
 * real bill.
 */
import { config } from "dotenv";
import { planCohortInterview } from "@/features/interview/cohort/planner";
import { isInterviewBlueprint } from "@/features/interview/cohort/blueprint";
import { createInitialState, startInterview } from "@/features/interview/state";
import type { InterviewState } from "@/features/interview/types";
import { runInterviewTurn } from "@/features/interview/agent";
import { resolveInterviewLLM } from "@/features/interview/agent/llm/registry";
import {
  readUsage,
  resetUsage,
  DEFAULT_OPENAI_MODEL,
} from "@/features/interview/agent/llm/openai-provider";
import {
  COHORT_INTERVIEW_DURATION_SEC,
} from "@/features/interview/constants";

config({ path: ".env.local" });
config();

const DRY_RUN = process.argv.includes("--dry-run");
const blueprintArg = process.argv.find((a) => isInterviewBlueprint(a));
const BLUEPRINT = blueprintArg && isInterviewBlueprint(blueprintArg) ? blueprintArg : "DAY_31";

/* ------------------------------------------------------------------ pricing */

/**
 * USD per 1M tokens, and per minute of audio. From OpenAI's published pricing.
 * Kept in one block so a price change is a one-line edit, and so the report can
 * state exactly what it charged rather than hiding it in arithmetic.
 */
const PRICING = {
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4.1": { inputPerM: 2.0, outputPerM: 8 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6 },
  "gpt-4.1-nano": { inputPerM: 0.1, outputPerM: 0.4 },
} as const;

/** whisper-1 is billed per minute of audio, rounded to the second. */
const WHISPER_PER_MINUTE = 0.006;
/** gpt-4o-mini-tts, billed on audio output. Published estimate per minute. */
const TTS_PER_MINUTE = 0.015;

/**
 * How the 15-minute wall clock splits.
 *
 * The candidate does most of the talking in an assessment; the interviewer
 * speaks one line per turn. These are the SPEECH shares of
 * COHORT_INTERVIEW_DURATION_SEC, and they are the softest numbers in this
 * report — they are stated so they can be argued with rather than buried.
 */
const CANDIDATE_SPEECH_SHARE = 0.6;
const INTERVIEWER_SPEECH_SHARE = 0.25;

/* ------------------------------------------------------- scripted candidate */

const ANSWERS: string[] = [
  // Strong, detailed — the expensive kind: long transcript, full evidence read.
  "We used a retrieval augmented generation setup. Documents were chunked on headings at about a thousand characters, embedded with a small embedding model, and stored in Chroma. At query time we embed the question, take the top eight chunks by cosine similarity, and pass them to the model with a system prompt that forbids answering outside that context.",
  // Thin — should earn exactly one follow-up.
  "We used embeddings and a vector database.",
  "Chunking matters because if a chunk is too big the embedding averages out the meaning, and if it is too small you lose the surrounding context. We overlapped slightly on headings to keep sections intact.",
  // Off-topic — should be restated, then redirected if repeated.
  "Sorry, what was the question again?",
  "We evaluated with a small golden set of questions and checked whether the expected source document appeared in the retrieved context, rather than grading the prose.",
  // Stuck.
  "I don't know that one.",
  "For deployment we containerised the app with Docker, put the API behind FastAPI, and ran it locally with Ollama so there were no paid API keys involved.",
  "Guardrails were mostly input and output checks — we refused questions the retrieval could not support, and we never let the model answer from its own knowledge.",
  "The agent used tool calling. We defined a small set of tools, described them in the system prompt, and let the model choose which to call, then fed the result back for the next step.",
  "MCP is a protocol for exposing tools and context to a model in a standard way, so the same server can be used by different clients.",
  "We tracked latency and cost per request, and logged which documents were retrieved so we could debug a bad answer later.",
  "The capstone put all of it together: ingestion, retrieval, the agent loop, guardrails, and a deployed endpoint with a simple front end.",
];

/* ---------------------------------------------------------------------- run */

function money(n: number): string {
  return `$${n.toFixed(4)}`;
}

async function main() {
  const plan = planCohortInterview(BLUEPRINT);
  const model = process.env.OPENAI_INTERVIEW_MODEL ?? DEFAULT_OPENAI_MODEL;

  console.log(`blueprint      : ${BLUEPRINT}`);
  console.log(`questions      : ${plan.questions.length}`);
  console.log(`scripted answers: ${ANSWERS.length}`);
  console.log(`judge model    : ${model}`);
  console.log(`wall clock     : ${COHORT_INTERVIEW_DURATION_SEC / 60} min\n`);

  if (DRY_RUN) {
    console.log("--dry-run: no API calls made.");
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set — this measurement needs the real API.");
    process.exit(1);
  }

  resetUsage();
  const llm = resolveInterviewLLM();
  console.log(`resolved LLM   : ${llm.name}\n`);
  if (llm.name.startsWith("mock")) {
    console.error("Resolved to the MOCK provider — measurement would be meaningless.");
    process.exit(1);
  }

  let state: InterviewState = startInterview(createInitialState());
  let turns = 0;
  let degradedTurns = 0;
  const started = Date.now();

  // Cycle the scripted answers until the interview actually FINISHES.
  //
  // A fixed list stops partway — the first run reached question 4 of 11 in
  // twelve turns, because follow-ups, repeats and redirects each consume a turn
  // without advancing. Costing that as "one interview" understates the bill
  // badly, and understates it in the direction that runs out of credit mid-cohort.
  const MAX_TURNS = 60;
  for (let i = 0; i < MAX_TURNS; i += 1) {
    const answer = ANSWERS[i % ANSWERS.length];
    const question = plan.questions[state.currentQuestionIndex];
    if (!question) break;
    if (state.status !== "IN_PROGRESS") break;

    const result = await runInterviewTurn(llm, {
      interviewId: "cost-measurement",
      blueprint: BLUEPRINT,
      plan,
      state,
      questionId: question.id,
      answerText: answer,
    });

    if (!result.ok) {
      console.log(`  turn ${turns + 1} refused: ${result.message}`);
      break;
    }

    state = result.data.state;
    turns += 1;
    if (result.data.degraded) degradedTurns += 1;
    process.stdout.write(
      `  turn ${String(turns).padStart(2)}  ${result.data.action.padEnd(14)}` +
        ` q${state.currentQuestionIndex + 1}/${plan.questions.length}` +
        `${result.data.degraded ? "  [DEGRADED — heuristic fallback]" : ""}\n`,
    );
    if (result.data.finished) break;
  }

  // A degraded turn did not reach the model, so it is cheap AND wrong. Counting
  // them keeps a cheap-looking run from being read as a cheap interview.
  if (degradedTurns > 0) {
    console.log(
      `\n  WARNING: ${degradedTurns}/${turns} turns fell back to heuristics — ` +
        `this run understates both cost and quality.`,
    );
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const usage = readUsage();

  console.log(`\ncompleted ${turns} turns in ${elapsed}s\n`);
  console.log("=".repeat(64));
  console.log("MEASURED TOKEN USAGE (reported by OpenAI, not estimated)");
  console.log("=".repeat(64));

  let llmCost = 0;
  for (const [usedModel, u] of Object.entries(usage)) {
    const price = PRICING[usedModel as keyof typeof PRICING];
    const cost = price
      ? (u.promptTokens / 1_000_000) * price.inputPerM +
        (u.completionTokens / 1_000_000) * price.outputPerM
      : 0;
    llmCost += cost;
    console.log(
      `  ${usedModel.padEnd(16)} calls=${String(u.calls).padStart(3)}  in=${u.promptTokens.toLocaleString().padStart(8)}  out=${u.completionTokens.toLocaleString().padStart(7)}  ${price ? money(cost) : "(no price on file)"}`,
    );
  }

  // Speech is not exercised by this harness (no audio), so it is priced from
  // the published rates against the interview's own duration constant. Labelled
  // as derived, not measured — the distinction matters for a budget.
  const minutes = COHORT_INTERVIEW_DURATION_SEC / 60;
  const sttMinutes = minutes * CANDIDATE_SPEECH_SHARE;
  const ttsMinutes = minutes * INTERVIEWER_SPEECH_SHARE;
  const sttCost = sttMinutes * WHISPER_PER_MINUTE;
  const ttsCost = ttsMinutes * TTS_PER_MINUTE;

  console.log("\n" + "=".repeat(64));
  console.log("SPEECH (derived from published rates, not measured here)");
  console.log("=".repeat(64));
  console.log(`  whisper-1 STT    ${sttMinutes.toFixed(1)} min @ $${WHISPER_PER_MINUTE}/min   ${money(sttCost)}`);
  console.log(`  gpt-4o-mini-tts  ${ttsMinutes.toFixed(1)} min @ $${TTS_PER_MINUTE}/min  ${money(ttsCost)}`);

  const total = llmCost + sttCost + ttsCost;

  console.log("\n" + "=".repeat(64));
  console.log("COST PER INTERVIEW");
  console.log("=".repeat(64));
  console.log(`  judge + report (measured) : ${money(llmCost)}`);
  console.log(`  speech (derived)          : ${money(sttCost + ttsCost)}`);
  console.log(`  TOTAL                     : ${money(total)}`);

  const remaining = Number(process.env.OPENAI_REMAINING_CREDIT ?? "9");
  console.log(`\n  at $${remaining} remaining credit:`);
  console.log(`    interviews affordable   : ${Math.floor(remaining / total)}`);
  console.log(`    27 members x 2 milestones = 54 interviews -> ${money(total * 54)}`);
  const shortfall = total * 54 - remaining;
  console.log(
    shortfall > 0
      ? `    SHORTFALL: ${money(shortfall)} — 54 interviews do NOT fit in the remaining credit.`
      : `    HEADROOM: ${money(-shortfall)} left after 54 interviews.`,
  );
  console.log(
    `\n  note: this run used ${ANSWERS.length} scripted answers with a mix of strong, thin,\n` +
      `  off-topic and stuck replies. A quieter candidate costs less; a very talkative\n` +
      `  one costs more, mostly through longer transcripts on the judge's input side.`,
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
