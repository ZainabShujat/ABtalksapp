/**
 * Interview-agent evaluation harness.
 *
 *   npx tsx scripts/evals/run-eval.ts --providers mock
 *   npx tsx scripts/evals/run-eval.ts --providers groq-120b,groq-20b,qwen,gemini --runs 2
 *   npx tsx scripts/evals/run-eval.ts --report          # re-score the cache, no API calls
 *
 * THREE LAYERS, kept apart on purpose:
 *
 *   1. deterministic policy tests   `npm run test:interview` — 210 checks, no model
 *   2. model-quality evaluation     this file, against the mock — free, repeatable
 *   3. live-provider evaluation     this file, with --providers — costs quota
 *
 * Every raw model response is written to a JSON cache keyed by
 * provider+case+run. Re-scoring, adding a dimension, or fixing a predicate
 * replays the cache instead of re-calling the API, so iterating on the
 * scorecard is free. Delete the cache file to force fresh calls.
 *
 * The model is evaluated on INTERPRETATION and PROPOSAL only. The deterministic
 * policy is then applied to its decision so we can see what the candidate would
 * actually have experienced — but the policy itself is not under test here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config as loadEnv } from "dotenv";

const shellEnv = { ...process.env };
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
for (const [k, v] of Object.entries(shellEnv)) if (v !== undefined) process.env[k] = v;

import { EVAL_CASES, question, type EvalCase } from "./cases";
import { aggregate, DIMENSIONS, scoreCase, type CaseScore } from "./scorecard";
import { routeDecision } from "@/features/interview/agent/policy";
import { createInitialState, startInterview } from "@/features/interview/state";
import { createMockInterviewLLM } from "@/features/interview/agent/llm/mock-provider";
import { createGroqInterviewLLM } from "@/features/interview/agent/llm/groq-provider";
import { createGeminiInterviewLLM } from "@/features/interview/agent/llm/gemini-provider";
import type { InterviewLLM } from "@/features/interview/agent/llm/provider";
import type { InterviewDecision } from "@/features/interview/agent/types";
import type { AnswerEvidence, InterviewState } from "@/features/interview/types";

const CACHE = "scripts/evals/.cache/responses.json";

/* --------------------------------------------------------------- providers */

type ProviderSpec = { key: string; label: string; make: () => InterviewLLM | null };

const PROVIDERS: ProviderSpec[] = [
  {
    key: "mock",
    label: "mock (deterministic baseline)",
    make: () => createMockInterviewLLM(),
  },
  {
    key: "groq-120b",
    label: "groq openai/gpt-oss-120b",
    make: () =>
      process.env.GROQ_API_KEY
        ? createGroqInterviewLLM(process.env.GROQ_API_KEY, "openai/gpt-oss-120b")
        : null,
  },
  {
    key: "groq-20b",
    label: "groq openai/gpt-oss-20b",
    make: () =>
      process.env.GROQ_API_KEY
        ? createGroqInterviewLLM(process.env.GROQ_API_KEY, "openai/gpt-oss-20b")
        : null,
  },
  {
    key: "qwen",
    label: "groq qwen/qwen3.6-27b",
    make: () =>
      process.env.GROQ_API_KEY
        ? createGroqInterviewLLM(process.env.GROQ_API_KEY, "qwen/qwen3.6-27b")
        : null,
  },
  {
    key: "gemini",
    label: "gemini-3.5-flash-lite",
    make: () =>
      process.env.GEMINI_API_KEY
        ? createGeminiInterviewLLM(process.env.GEMINI_API_KEY)
        : null,
  },
];

/* ------------------------------------------------------------------ cache */

type CachedRun = {
  provider: string;
  caseId: string;
  run: number;
  latencyMs: number;
  decision: InterviewDecision;
};

function loadCache(): Record<string, CachedRun> {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, CachedRun>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CachedRun>) {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache, null, 2), "utf8");
}

const cacheKey = (provider: string, caseId: string, run: number) =>
  `${provider}::${caseId}::${run}`;

/* ------------------------------------------------------------- one case */

/** Interview state reconstructed so the policy sees the case's real context. */
function stateFor(testCase: EvalCase): InterviewState {
  const base = startInterview(createInitialState());
  const evidenceByQuestionId: Record<string, AnswerEvidence> = {};

  if (testCase.priorMatched) {
    evidenceByQuestionId[testCase.questionId] = {
      conceptualFound: false,
      practicalFound: false,
      tradeoffsFound: false,
      flaggedIssues: [],
      reasoning: "prior turn",
      matchedEvidence: testCase.priorMatched,
      relevance: "ON_TOPIC",
    };
  }

  return {
    ...base,
    evidenceByQuestionId,
    followUpsAsked:
      testCase.followUpsRemaining === 0 && testCase.priorTurns ? 1 : 0,
    transcript: (testCase.priorTurns ?? []).map((t) => ({
      role: t.role,
      text: t.text,
      questionId: testCase.questionId,
      ts: Date.now(),
    })),
  };
}

async function runCase(
  llm: InterviewLLM,
  testCase: EvalCase,
): Promise<{ decision: InterviewDecision; latencyMs: number }> {
  const q = question(testCase.questionId);
  const started = Date.now();

  const decision = await llm.analyzeAnswer({
    question: q,
    answerText: testCase.answer,
    priorEvidence: testCase.priorMatched
      ? {
          conceptualFound: false,
          practicalFound: false,
          tradeoffsFound: false,
          flaggedIssues: [],
          reasoning: "prior turn",
          matchedEvidence: testCase.priorMatched,
        }
      : null,
    followUpsRemaining: testCase.followUpsRemaining ?? 1,
    recentTranscript: (testCase.priorTurns ?? []).map((t) => ({
      role: t.role,
      text: t.text,
      questionId: testCase.questionId,
      ts: Date.now(),
    })),
  });

  return { decision, latencyMs: Date.now() - started };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes("--report");
  const runs = Number(args[args.indexOf("--runs") + 1]) || 1;
  const requested = (
    args.includes("--providers") ? args[args.indexOf("--providers") + 1] : "mock"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const cache = loadCache();
  const selected = PROVIDERS.filter((p) => requested.includes(p.key));

  if (selected.length === 0 && !reportOnly) {
    console.error(`\n  Unknown provider(s). Available: ${PROVIDERS.map((p) => p.key).join(", ")}\n`);
    process.exit(1);
  }

  console.log(`\n  ${EVAL_CASES.length} cases · ${runs} run(s) each`);
  console.log(`  cache: ${CACHE}${reportOnly ? "  (report only — no API calls)" : ""}\n`);

  /* --------------------------------------------------------- execution */

  if (!reportOnly) {
    for (const spec of selected) {
      const llm = spec.make();
      if (!llm) {
        console.log(`  ${spec.key.padEnd(11)} SKIPPED — no API key`);
        continue;
      }

      let called = 0;
      let replayed = 0;

      for (let run = 1; run <= runs; run++) {
        for (const testCase of EVAL_CASES) {
          const key = cacheKey(spec.key, testCase.id, run);
          if (cache[key]) {
            replayed++;
            continue;
          }
          const { decision, latencyMs } = await runCase(llm, testCase);
          cache[key] = {
            provider: spec.key,
            caseId: testCase.id,
            run,
            latencyMs,
            decision,
          };
          called++;
          // Written after each call: a quota failure mid-sweep must not lose
          // the responses already paid for.
          saveCache(cache);
        }
      }
      console.log(
        `  ${spec.key.padEnd(11)} ${called} live call(s), ${replayed} replayed from cache`,
      );
    }
    console.log("");
  }

  /* ----------------------------------------------------------- scoring */

  const providersInCache = [...new Set(Object.values(cache).map((c) => c.provider))];
  const byProvider = new Map<string, CaseScore[]>();
  const latencies = new Map<string, number[]>();
  const degradedCount = new Map<string, number>();
  const failures: string[] = [];
  const consistency = new Map<string, { compared: number; stable: number }>();

  for (const providerKey of providersInCache) {
    const scores: CaseScore[] = [];
    const lat: number[] = [];
    let degraded = 0;
    const perCaseActions = new Map<string, string[]>();

    for (const testCase of EVAL_CASES) {
      for (let run = 1; run <= runs; run++) {
        const cached = cache[cacheKey(providerKey, testCase.id, run)];
        if (!cached) continue;

        const q = question(testCase.questionId);
        const state = stateFor(testCase);
        const outcome = routeDecision(
          q,
          cached.decision,
          {
            followUpsAsked: state.followUpsAsked,
            redirectsAsked: state.redirectsAsked ?? 0,
            repeatsAsked: state.repeatsAsked ?? 0,
          },
          state,
        );

        lat.push(cached.latencyMs);

        // A degraded turn is the deterministic fallback, not the model. Scoring
        // it would report the fallback's behaviour as the provider's — the same
        // conflation that once made unjudged answers look like failed ones.
        // Degraded turns are counted as a RELIABILITY signal instead.
        if (cached.decision.degraded) {
          degraded++;
          continue;
        }

        const score = scoreCase(testCase, q, cached.decision, outcome.action);
        scores.push(score);

        const key = testCase.id;
        perCaseActions.set(key, [
          ...(perCaseActions.get(key) ?? []),
          `${cached.decision.evidence.relevance}/${cached.decision.action}/${(cached.decision.evidence.matchedEvidence ?? []).join("")}`,
        ]);

        if (run === 1) {
          for (const dim of DIMENSIONS) {
            if (score[dim].pass === false) {
              failures.push(
                `${providerKey} · ${testCase.id} · ${dim}: ${score[dim].detail}`,
              );
            }
          }
        }
      }
    }

    // Consistency: identical input, identical reading?
    let compared = 0;
    let stable = 0;
    for (const [, signatures] of perCaseActions) {
      if (signatures.length < 2) continue;
      compared++;
      if (new Set(signatures).size === 1) stable++;
    }
    consistency.set(providerKey, { compared, stable });

    byProvider.set(providerKey, scores);
    latencies.set(providerKey, lat);
    degradedCount.set(providerKey, degraded);
  }

  /* ------------------------------------------------------------ output */

  const SHORT: Record<string, string> = {
    relevance: "Relev",
    followUpQuality: "F-up",
    adaptivity: "Adapt",
    grounding: "Grnd",
    evidenceExtraction: "Evid",
    technicalCorrectness: "Tech",
    conversationalQuality: "Conv",
    nonRepetition: "NoRep",
    safetyNonInvention: "Safe",
  };

  console.log("  SCORECARD — pass rate per dimension (n = applicable cases)\n");
  const header = ["provider".padEnd(11), ...DIMENSIONS.map((d) => SHORT[d]!.padStart(6))].join(" ");
  console.log("  " + header);
  console.log("  " + "-".repeat(header.length));

  for (const [providerKey, scores] of byProvider) {
    const agg = aggregate(scores);
    const cells = DIMENSIONS.map((d) => {
      const a = agg[d];
      return (a.rate === null ? "  n/a" : `${Math.round(a.rate * 100)}%`).padStart(6);
    });
    console.log("  " + [providerKey.padEnd(11), ...cells].join(" "));
  }

  console.log("\n  OPERATIONAL\n");
  console.log(
    "  " +
      ["provider".padEnd(11), "scored".padStart(7), "median ms".padStart(10), "p90 ms".padStart(8), "degraded".padStart(9), "consistency".padStart(14)].join(" "),
  );
  for (const [providerKey] of byProvider) {
    const lat = [...(latencies.get(providerKey) ?? [])].sort((a, b) => a - b);
    const median = lat.length ? lat[Math.floor(lat.length / 2)]! : 0;
    const p90 = lat.length ? lat[Math.floor(lat.length * 0.9)]! : 0;
    const c = consistency.get(providerKey)!;
    // Only pairs where BOTH runs reached the model are comparable.
    const consText =
      c.compared === 0 ? "not measurable" : `${c.stable}/${c.compared} identical`;
    console.log(
      "  " +
        [
          providerKey.padEnd(11),
          String(byProvider.get(providerKey)?.length ?? 0).padStart(7),
          String(median).padStart(10),
          String(p90).padStart(8),
          String(degradedCount.get(providerKey) ?? 0).padStart(9),
          consText.padStart(14),
        ].join(" "),
    );
  }

  if (failures.length > 0) {
    console.log(`\n  FAILURES (run 1) — ${failures.length}\n`);
    for (const f of failures) console.log(`    ${f}`);
  }

  console.log("");
}

main().catch((error) => {
  console.error("\nEVAL FAILED\n", error);
  process.exitCode = 1;
});
