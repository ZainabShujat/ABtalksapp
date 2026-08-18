/**
 * Interactive demo of the LangGraph interview agent.
 *
 * Sits you in the candidate's chair for a real DAY_15 or DAY_31 interview: the
 * real question bank, the real compiled graph, the real routing policy. After
 * every answer it prints what the model PROPOSED and what the policy ACTUALLY
 * DID, which is the whole point of the architecture and the thing worth showing
 * in a demo.
 *
 * No database and no dev server needed — the graph is pure with respect to
 * persistence, so this drives it directly.
 *
 *   npx tsx scripts/demo-interview-agent.ts            # DAY_15, live model if a key exists
 *   npx tsx scripts/demo-interview-agent.ts --mock     # force the offline mock
 *   npx tsx scripts/demo-interview-agent.ts DAY_31
 *   npx tsx scripts/demo-interview-agent.ts --verbose  # show the agent's turn logs
 *
 * Try these to see each branch fire:
 *   "Who is the PM of India?"        -> REDIRECT (and it will not answer)
 *   "Could you repeat the question?" -> REPEAT
 *   "I don't know."                  -> NEXT_QUESTION, never a probe
 *   a thin but honest answer          -> FOLLOW_UP, once, then it moves on
 */
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";

import { planCohortInterview } from "../src/features/interview/cohort/planner";
import { isInterviewBlueprint } from "../src/features/interview/cohort/blueprint";
import {
  createInitialState,
  startInterview,
} from "../src/features/interview/state";
import type { InterviewState } from "../src/features/interview/types";
import {
  createJsonInterviewLLM,
  createMockInterviewLLM,
  runInterviewTurn,
} from "../src/features/interview/agent";
import type { InterviewLLM } from "../src/features/interview/agent";

/* ------------------------------------------------------------------ setup */

/** Line splitter for scripted stdin. Declared once to keep the regex readable. */
const SPLIT_LINES = new RegExp("\r?\n");

const args = process.argv.slice(2);
const forceMock = args.includes("--mock");
const verbose = args.includes("--verbose");

// The agent logs every turn through `lib/logger.ts`, which is right in
// production and unreadable in a live demo. Silence the informational levels
// unless asked; warnings and errors always survive, so a degraded turn is
// never hidden.
if (!verbose) {
  console.info = () => {};
  console.log = ((original) => (...a: unknown[]) =>
    original(...(a as [])))(console.log.bind(console));
}
const blueprintArg = args.find((a) => !a.startsWith("--")) ?? "DAY_15";

if (!isInterviewBlueprint(blueprintArg)) {
  console.error(`Unknown blueprint "${blueprintArg}". Use DAY_15 or DAY_31.`);
  process.exit(1);
}
const blueprint = blueprintArg;

/** Reads .env.local without pulling in a dependency. */
function envFromLocalFile(key: string): string | undefined {
  try {
    const file = readFileSync(".env.local", "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env.local — fine */
  }
  return undefined;
}

/**
 * Live Anthropic provider, built here rather than imported.
 *
 * `agent/llm/anthropic-provider.ts` is `server-only` and cannot load in a plain
 * tsx script, so this demo supplies its own `askJson` to the SAME shared
 * provider factory. That is the provider seam doing its job: one `askJson`
 * function is the entire cost of a new backend.
 */
function liveAnthropicLLM(apiKey: string): InterviewLLM {
  return createJsonInterviewLLM({
    name: "anthropic (demo)",
    async askJson({ system, user, maxTokens }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.PROGRAM_ANTHROPIC_MODEL ?? "claude-sonnet-5",
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = json.content?.find((c) => c.type === "text")?.text ?? "";
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end <= start) {
        return { ok: false, message: "no JSON object in response" };
      }
      try {
        return { ok: true, data: JSON.parse(text.slice(start, end + 1)) };
      } catch (error) {
        return { ok: false, message: String(error) };
      }
    },
  });
}

const apiKey = process.env.ANTHROPIC_API_KEY ?? envFromLocalFile("ANTHROPIC_API_KEY");
const llm: InterviewLLM =
  forceMock || !apiKey ? createMockInterviewLLM() : liveAnthropicLLM(apiKey);

/* ------------------------------------------------------------------- run */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function main() {
  const plan = planCohortInterview(blueprint);
  let state: InterviewState = startInterview(createInitialState());
  let questionId = plan.questions[0]!.id;

  // Interactively we prompt; with piped stdin the whole file arrives as one
  // chunk and readline resolves only once, so scripted runs are replayed from a
  // pre-read list instead. Same graph either way — only the input source moves.
  const piped = !stdin.isTTY;
  const scripted: string[] = piped
    ? readFileSync(0, "utf8").split(SPLIT_LINES)
    : [];
  let scriptIndex = 0;

  const rl = piped ? null : createInterface({ input: stdin, output: stdout });

  async function nextAnswer(): Promise<string | null> {
    if (piped) {
      while (scriptIndex < scripted.length) {
        const line = scripted[scriptIndex++]!.trim();
        if (line.length > 0) {
          console.log(`  You: ${line}`);
          return line;
        }
      }
      return null;
    }
    return (await rl!.question("  You: ")).trim();
  }

  console.log(bold(`\n  ${blueprint} interview — LangGraph agent demo`));
  console.log(
    dim(
      `  provider: ${llm.name}  ·  ${plan.questions.length} standardized questions  ·  Ctrl+C to quit\n`,
    ),
  );
  if (llm.name === "mock") {
    console.log(
      dim(
        "  Running offline (no ANTHROPIC_API_KEY found, or --mock). Routing is real;\n" +
          "  answer understanding is keyword-based.\n",
      ),
    );
  }

  console.log(cyan("  Interviewer: ") + plan.questions[0]!.text + "\n");

  for (;;) {
    const answer = await nextAnswer();
    if (answer === null) break;
    if (answer.length === 0) continue;
    if (answer === "/quit") break;

    const result = await runInterviewTurn(llm, {
      interviewId: "demo",
      blueprint,
      plan,
      state,
      questionId,
      answerText: answer,
    });

    if (!result.ok) {
      console.log(yellow(`\n  [refused] ${result.message}\n`));
      break;
    }

    const { data } = result;
    state = data.state;

    // The demo's real payload: proposal vs. what the interview actually did.
    const proposed = data.degraded ? "fallback" : "model";
    console.log(
      dim(
        `\n  [${proposed} -> ${data.action}]  followUps=${state.followUpsAsked}/${
          plan.questions.find((q) => q.id === questionId)?.maxFollowUps ?? 0
        }  redirects=${state.redirectsAsked ?? 0}  repeats=${
          state.repeatsAsked ?? 0
        }  q=${state.currentQuestionIndex + 1}/${plan.questions.length}`,
      ),
    );

    if (data.prompt) console.log(cyan("  Interviewer: ") + data.prompt + "\n");

    if (data.finished) {
      console.log(bold("  Interview complete."));
      console.log(
        dim(
          `  ${Object.keys(state.evidenceByQuestionId).length} questions answered · ` +
            `${state.transcript.length} transcript lines\n`,
        ),
      );
      break;
    }

    questionId = data.questionId ?? questionId;
  }

  rl?.close();
}

main().catch((error) => {
  console.error("\nDemo failed:", error);
  process.exit(1);
});
