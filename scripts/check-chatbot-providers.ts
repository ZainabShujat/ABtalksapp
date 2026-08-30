/**
 * Chatbot production-readiness check.
 *
 *   npm run check:chatbot
 *   npm run check:chatbot -- --quick   # skip the conversation section
 *
 * Exercises the REAL provider chain (`generateStream`) and the REAL retrieval
 * path (`retrieve`), not reimplementations, so a green run describes what the
 * `/api/chat` route would actually do.
 *
 * SECURITY: never prints a key, a key fragment, or a request/response body that
 * could carry one. Presence, resolved model name, latency and status only —
 * this output is meant to be pasteable into an issue.
 *
 * Failover is verified by hiding a provider's key from `process.env` for the
 * duration of one call. `generateStream` reads the environment per call, so
 * this exercises the genuine fallback branch rather than a mocked one. Keys are
 * restored in a `finally`, so an assertion failure cannot leak state into the
 * next section.
 */
import { config } from "dotenv";
import { retrieve, buildContext } from "@/lib/chatbot/retrieve";
import { generateStream, type ChatTurn } from "@/lib/chatbot/providers";
import {
  FALLBACK_MESSAGE,
  GENERATION_UNAVAILABLE_MESSAGE,
  RETRIEVAL_ERROR_MESSAGE,
  buildSystemPrompt,
} from "@/lib/chatbot/prompt";

config({ path: ".env.local" });
config();

const QUICK = process.argv.includes("--quick");

type ProviderKey =
  | "OPENAI_API_KEY"
  | "GEMINI_API_KEY"
  | "GROQ_API_KEY"
  | "ANTHROPIC_API_KEY";

const PROVIDERS: {
  name: string;
  envKey: ProviderKey;
  modelEnv: string;
  defaultModel: string;
}[] = [
  {
    name: "openai",
    envKey: "OPENAI_API_KEY",
    modelEnv: "CHATBOT_OPENAI_MODEL",
    defaultModel: "gpt-4.1-mini",
  },
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    modelEnv: "CHATBOT_GEMINI_MODEL",
    defaultModel: "gemini-flash-latest",
  },
  {
    name: "groq",
    envKey: "GROQ_API_KEY",
    modelEnv: "CHATBOT_GROQ_MODEL",
    defaultModel: "openai/gpt-oss-120b",
  },
  {
    name: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    modelEnv: "CHATBOT_ANTHROPIC_MODEL",
    defaultModel: "claude-haiku-4-5-20251001",
  },
];

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function heading(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

/** Runs `fn` with the named env vars removed, then restores them. */
async function withProvidersDisabled<T>(
  keys: ProviderKey[],
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of keys) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Drains a text stream, returning the first slice and total length. */
async function drain(stream: ReadableStream<string>) {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) text += value;
  }
  return text;
}

const SYSTEM_PING =
  "You are a test harness probe. Reply with exactly the word: ok";

async function main() {
  /* ------------------------------------------------ 1. environment inventory */
  heading("1. Environment (names only — no key material is printed)");
  for (const p of PROVIDERS) {
    const present = Boolean(process.env[p.envKey]);
    const model = process.env[p.modelEnv] ?? p.defaultModel;
    const overridden = Boolean(process.env[p.modelEnv]);
    console.log(
      `  ${p.name.padEnd(10)} ${p.envKey.padEnd(20)} ${present ? "present" : "ABSENT "}  model=${model}${overridden ? " (env override)" : " (default)"}`,
    );
  }
  const openaiPresent = Boolean(process.env.OPENAI_API_KEY);
  console.log(
    `  ${"(embed)".padEnd(10)} ${"OPENAI_API_KEY".padEnd(20)} ${openaiPresent ? "present" : "ABSENT "}  model=text-embedding-3-small (retrieval embeddings)`,
  );
  console.log(
    [
      "",
      "  NOTE: OPENAI_API_KEY now serves BOTH generation (primary) and retrieval",
      "        embeddings. Losing it degrades retrieval to lexical-only AND drops",
      "        generation to the Gemini rung — one key, two blast radii.",
    ].join("\n"),
  );

  /* ------------------------------------------- 2. per-provider live probes */
  heading("2. Provider probes (each isolated: only that provider is enabled)");
  const health = new Map<string, { ok: boolean; ms: number; note: string }>();

  for (const p of PROVIDERS) {
    if (!process.env[p.envKey]) {
      health.set(p.name, { ok: false, ms: 0, note: "no key configured" });
      console.log(`  ${p.name.padEnd(10)} SKIP    no key configured`);
      continue;
    }
    // Disable the others so the chain has exactly one candidate — this probes
    // the provider through the same adapter production uses.
    const others = PROVIDERS.filter((o) => o.name !== p.name).map((o) => o.envKey);
    const started = Date.now();
    const result = await withProvidersDisabled(others, () =>
      generateStream(SYSTEM_PING, [{ role: "user", content: "ping" }]),
    );
    const ms = Date.now() - started;

    if (!result.ok) {
      health.set(p.name, { ok: false, ms, note: "stream did not open" });
      console.log(`  ${p.name.padEnd(10)} FAIL    ${ms}ms  stream did not open`);
      continue;
    }
    const text = await drain(result.stream);
    const ttl = Date.now() - started;
    const ok = text.trim().length > 0;
    health.set(p.name, { ok, ms: ttl, note: ok ? "responded" : "empty stream" });
    console.log(
      `  ${p.name.padEnd(10)} ${ok ? "OK  " : "FAIL"}    ${ttl}ms  served_by=${result.provider}  chars=${text.trim().length}`,
    );
  }

  const healthy = [...health.entries()].filter(([, v]) => v.ok).map(([k]) => k);
  console.log(`\n  healthy providers: ${healthy.join(", ") || "NONE"}`);
  check(healthy.length > 0, "at least one generation provider is usable");
  check(
    openaiPresent,
    "OPENAI_API_KEY present (primary generation + retrieval embeddings)",
    openaiPresent ? "" : "generation drops to Gemini and retrieval to lexical-only",
  );
  check(
    healthy[0] === "openai",
    "the primary rung (openai) is the one actually serving traffic",
    healthy[0] ? `first healthy provider is ${healthy[0]}` : "no healthy provider",
  );

  /* ------------------------------------------------------- 3. failover chain */
  heading("3. Failover (chain order: OpenAI -> Gemini -> Groq -> Anthropic)");

  const scenarios: { label: string; disable: ProviderKey[] }[] = [
    { label: "all providers enabled", disable: [] },
    { label: "openai disabled", disable: ["OPENAI_API_KEY"] },
    {
      label: "openai + gemini disabled",
      disable: ["OPENAI_API_KEY", "GEMINI_API_KEY"],
    },
    {
      label: "openai + gemini + groq disabled",
      disable: ["OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"],
    },
    {
      label: "all disabled",
      disable: [
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
        "ANTHROPIC_API_KEY",
      ],
    },
  ];

  for (const s of scenarios) {
    const started = Date.now();
    const result = await withProvidersDisabled(s.disable, () =>
      generateStream(SYSTEM_PING, [{ role: "user", content: "ping" }]),
    );
    const ms = Date.now() - started;
    if (result.ok) {
      await drain(result.stream);
      console.log(`  ${s.label.padEnd(26)} -> served by ${result.provider} (${ms}ms)`);
    } else {
      console.log(`  ${s.label.padEnd(26)} -> no provider available (${ms}ms)`);
    }
    if (s.label === "all disabled") {
      check(!result.ok, "with every provider disabled the chain reports failure");
    } else {
      check(
        result.ok,
        `failover succeeds: ${s.label}`,
        result.ok ? "" : "no remaining rung could serve — see provider probes above",
      );
    }
  }

  /* -------------------------------------------- 4. three distinct outcomes */
  heading("4. Three distinct user-facing outcomes");
  console.log(`  unsupported question -> "${FALLBACK_MESSAGE.slice(0, 62)}..."`);
  console.log(`  provider outage      -> "${GENERATION_UNAVAILABLE_MESSAGE.slice(0, 62)}..."`);
  console.log(`  retrieval error      -> "${RETRIEVAL_ERROR_MESSAGE.slice(0, 62)}..."`);

  const distinct = new Set([
    FALLBACK_MESSAGE,
    GENERATION_UNAVAILABLE_MESSAGE,
    RETRIEVAL_ERROR_MESSAGE,
  ]);
  check(distinct.size === 3, "all three outcomes are distinct strings");
  check(
    !GENERATION_UNAVAILABLE_MESSAGE.toLowerCase().includes("knowledge base") &&
      !RETRIEVAL_ERROR_MESSAGE.toLowerCase().includes("knowledge base"),
    "neither system-failure message blames the knowledge base",
  );
  check(
    FALLBACK_MESSAGE.toLowerCase().includes("knowledge base"),
    "the genuine knowledge gap is the only one that mentions the knowledge base",
  );

  // The gate itself must still refuse an unsupported question.
  const unsupported = await retrieve("what is the weather today");
  check(
    unsupported.verdict === "fallback",
    "unsupported question is refused by the gate",
    `verdict=${unsupported.verdict} confidence=${unsupported.topScore.toFixed(3)}`,
  );
  const supported = await retrieve("how do i claim my certificate");
  check(
    supported.verdict !== "fallback",
    "supported question passes the gate",
    `verdict=${supported.verdict} confidence=${supported.topScore.toFixed(3)}`,
  );

  /* ------------------------------------------------ 5. multi-turn conversation */
  if (QUICK) {
    console.log("\n--quick: conversation section skipped.");
  } else {
    heading("5. Five-turn conversation (real retrieval + real generation)");

    // Expectations list every source that genuinely carries the answer, not one
    // preferred file: "what happens after day 60" is answered by the challenge
    // file's completion section as fully as by the certificates file, and
    // demanding a single winner would test a preference the product lacks.
    const TURNS = [
      { say: "tell me about the claude challenge", expect: ["claude-challenge.md", "programs.md"] },
      { say: "what do i have to post", expect: ["claude-challenge.md", "programs.md"] },
      { say: "who do i tag", expect: ["claude-challenge.md"] },
      { say: "what happens after day 60", expect: ["certificates.md", "claude-challenge.md"] },
      { say: "how do i claim it", expect: ["certificates.md"] },
    ];

    const history: ChatTurn[] = [];
    let first = true;
    for (const turn of TURNS) {
      // A readiness check that hammers the API measures its own rate limiting.
      if (!first) await new Promise((r) => setTimeout(r, 6000));
      first = false;
      // Exactly how the route builds the retrieval query.
      const priors = history
        .filter((m) => m.role === "user")
        .slice(-2)
        .map((m) => m.content);
      const query = [...priors, turn.say].join("\n");

      const r = await retrieve(query);
      const sources = r.results.map((x) => x.chunk.source);
      history.push({ role: "user", content: turn.say });

      let answer = "(no generation)";
      if (r.verdict !== "fallback") {
        const system = buildSystemPrompt(
          buildContext(r.results),
          "28 August 2026",
          r.verdict === "clarify",
        );
        const gen = await generateStream(system, history.slice(-8));
        answer = gen.ok ? await drain(gen.stream) : GENERATION_UNAVAILABLE_MESSAGE;
      }
      history.push({ role: "assistant", content: answer });

      const retrievedExpected = sources.some((x) => turn.expect.includes(x));
      console.log(`\n  USER: ${turn.say}`);
      console.log(
        `        gate=${r.verdict} conf=${r.topScore.toFixed(2)} top=${sources.slice(0, 2).join(", ")}`,
      );
      console.log(`  BOT : ${answer.trim().slice(0, 260).replace(/\n+/g, " ")}`);
      check(
        retrievedExpected,
        `turn retrieved one of [${turn.expect.join(", ")}]`,
        retrievedExpected ? "" : `got [${sources.slice(0, 3).join(", ")}]`,
      );
      // The knowledge-gap message here would mean context was lost mid-thread.
      // The outage message means the corpus was fine and an upstream failed —
      // reported separately so a rate limit is never read as a retrieval bug.
      check(
        answer !== FALLBACK_MESSAGE,
        "turn did not fall back to the knowledge-gap message",
      );
      if (answer === GENERATION_UNAVAILABLE_MESSAGE) {
        console.log(
          "        NOTE: providers unavailable on this turn — retrieval was fine, generation was not.",
        );
      }
    }
  }

  /* ------------------------------------------------------------- summary */
  heading("SUMMARY");
  console.log(`  healthy providers : ${healthy.join(", ") || "NONE"}`);
  for (const [name, v] of health) {
    console.log(`  ${name.padEnd(10)} ${v.ok ? "up  " : "down"}  ${v.ms}ms  ${v.note}`);
  }
  console.log(`\n  checks failed: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
