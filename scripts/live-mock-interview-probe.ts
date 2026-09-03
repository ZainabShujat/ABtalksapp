/**
 * LIVE probe of the mock interview pipeline. Real providers, real database.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT.
 *
 * Every dependency here is the real one: Deepgram Nova-3 transcribes, OpenAI
 * runs stage 1 and stage 2, the real LangGraph turn executes, the real
 * repository writes to the configured database, and Deepgram Aura-2 streams the
 * reply. Nothing is stubbed.
 *
 * It is NOT a microphone test. The candidate's "speech" is synthesized with
 * Deepgram TTS and fed to the transcriber as an audio file, because the browser
 * automation available here cannot open a microphone. So this proves the
 * PIPELINE — transport, reasoning, phrasing, state, latency — and proves
 * nothing about acoustics: not echo cancellation, not the barge-in thresholds,
 * not whether interrupting feels immediate in a room with speakers. Those need
 * a person at a real microphone and are reported separately as unverified.
 *
 * It spends real money on both providers. Roughly the cost of one interview.
 *
 * Run: npx tsx scripts/live-mock-interview-probe.ts
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import Module from "node:module";

// `server-only` throws outside a React Server Component and the service tree
// imports it. Neutralised the same way the interruption suite does it.
const realRequire = Module.prototype.require;
(Module.prototype as never as { require: unknown }).require = function (
  this: unknown,
  id: string,
) {
  if (id === "server-only") return {};
  return realRequire.call(this as never, id);
} as never;

/* eslint-disable @typescript-eslint/no-var-requires */
const service =
  require("../src/features/interview/platform/service") as typeof import("../src/features/interview/platform/service");
const voice =
  require("../src/features/interview/voice") as typeof import("../src/features/interview/voice");
const telemetry =
  require("../src/features/interview/telemetry") as typeof import("../src/features/interview/telemetry");
const { PrismaClient } = require("@prisma/client");

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
if (!DEEPGRAM_KEY) throw new Error("DEEPGRAM_API_KEY is required for this probe.");

/** Records every measured leg so percentiles come from observations, not guesses. */
const samples: Record<string, number[]> = {};
function sample(name: string, ms: number) {
  (samples[name] ??= []).push(ms);
}

/** Speaks a candidate line into real audio bytes, so real STT has real speech. */
async function speakAsCandidate(text: string): Promise<Blob> {
  // mp3, not linear16/wav. The WAV variant repeatedly had its socket closed
  // part-way through the body ("other side closed" after ~350KB), which is a
  // transport failure of the PROBE, not of the interview. mp3 is the encoding
  // the interviewer's own path already uses successfully.
  const url =
    "https://api.deepgram.com/v1/speak?model=aura-2-orion-en&encoding=mp3";

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        lastError = `${res.status} ${await res.text().catch(() => "")}`;
        continue;
      }
      return new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`candidate TTS failed after 3 attempts: ${lastError}`);
}

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({
    where: { email: "demo-day31@abtalks.dev" },
    select: { id: true, email: true },
  });
  if (!user) throw new Error("demo-day31@abtalks.dev not found in this database.");

  const dbHost = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1];
  console.log("\n=== LIVE MOCK INTERVIEW PROBE ===");
  line("database", dbHost ?? "unknown");
  line("user", user.email);
  line("LLM provider", process.env.INTERVIEW_LLM_PROVIDER ?? "(autodetect)");
  line("platform STT", process.env.INTERVIEW_STT_PROVIDER ?? "(default)");
  line("platform TTS", process.env.INTERVIEW_TTS_PROVIDER ?? "(default)");

  /* ------------------------------------------------------------- start */
  const t0 = Date.now();
  const started = await service.startAttempt(user.id, "ai-fluency");
  if (!started.ok) throw new Error(`startAttempt failed: ${started.message}`);
  sample("start_attempt", Date.now() - t0);
  const attemptId = started.data.attemptId;

  console.log(`\n--- OPENING (attempt ${attemptId}) ---`);
  console.log(`INTERVIEWER: ${started.data.prompt}\n`);

  // Real streamed synthesis of the opening, measured to first byte.
  const openTts = await voice.synthesizeLineStream(
    started.data.prompt,
    "probe",
    "platform",
  );
  if (openTts.ok) {
    sample("tts_ttfb", openTts.data.ttfbMs);
    line("opening TTS", `${openTts.data.vendor}/${openTts.data.model} ttfb=${openTts.data.ttfbMs}ms`);
    await openTts.data.stream.cancel();
  } else {
    console.log(`  opening TTS FAILED: ${openTts.message}`);
  }

  /* ------------------------------------------------- scripted candidate */
  //
  // Mixed on purpose: a substantive answer, a deliberately vague one, and a
  // strong one. A probe made of three perfect answers exercises none of the
  // follow-up machinery this plan changed.
  const answers = [
    "I've used GPT-4 and Claude quite a lot for work. Mostly for drafting code and summarising documents. I understand it's predicting the next token rather than looking things up, so it can sound confident and still be wrong.",
    "Yeah, we did some prompt engineering to make it more consistent.",
    "I built a retrieval setup over our internal runbooks using Chroma and LangChain. I chunked by heading with about a hundred tokens of overlap, and I checked quality by holding out thirty questions I already knew the answers to and measuring how often the right passage came back in the top three.",
  ];

  let questionId = started.data.question.id;

  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i]!;
    console.log(`--- TURN ${i + 1} ---`);
    console.log(`CANDIDATE: ${answer}\n`);

    // 1. real synthesis of the candidate's voice
    const audio = await speakAsCandidate(answer);

    // 2. real Deepgram STT
    const sttStart = Date.now();
    const stt = await voice.transcribeAnswer(
      audio,
      "answer.mp3",
      "probe",
      "platform",
    );
    const sttMs = Date.now() - sttStart;
    sample("stt", sttMs);
    if (!stt.ok) {
      console.log(`  STT FAILED: ${stt.message}`);
      break;
    }
    line("STT", `${sttMs}ms  "${stt.data.text.slice(0, 70)}…"`);

    // 3. real graph turn: stage 1 + stage 2 + policy + persistence
    const turnStart = Date.now();
    const turn = await service.recordAnswer(user.id, attemptId, questionId, {
      text: stt.data.text,
    });
    const turnMs = Date.now() - turnStart;
    sample("turn_total", turnMs);
    if (!turn.ok) {
      console.log(`  TURN FAILED: ${turn.message}`);
      break;
    }
    line("turn (stage1+2+db)", `${turnMs}ms  action=${turn.data.action}`);

    console.log(`\nINTERVIEWER: ${turn.data.prompt}\n`);

    // 4. real streamed synthesis of the reply
    if (turn.data.prompt) {
      const tts = await voice.synthesizeLineStream(turn.data.prompt, "probe", "platform");
      if (tts.ok) {
        sample("tts_ttfb", tts.data.ttfbMs);
        line("reply TTS ttfb", `${tts.data.ttfbMs}ms`);
        await tts.data.stream.cancel();
      }
    }

    if (turn.data.finished || !turn.data.question) break;
    questionId = turn.data.question.id;
  }

  /* ----------------------------------------------------- interruptions */
  console.log("\n--- INTERRUPTIONS (real classifier) ---\n");

  const interruptions: { label: string; utterance: string }[] = [
    { label: "REPEAT-ish", utterance: "Sorry, can you say that again?" },
    { label: "CLARIFY-ish", utterance: "What do you mean by grounding exactly?" },
    { label: "CORRECT-ish", utterance: "Actually, sorry, I said Chroma but I meant FAISS." },
    { label: "ADD_INFO-ish", utterance: "Oh, and I forgot to mention I also added a reranker on top." },
  ];

  let generation = 100;
  for (const { label, utterance } of interruptions) {
    const before = await service.getOpenQuestion(user.id, attemptId);
    const beforeId = before.ok ? before.data?.id : null;

    const start = Date.now();
    const res = await service.recordInterruption(
      user.id,
      attemptId,
      utterance,
      "and how did you decide what actually went into",
      45,
      generation++,
    );
    const ms = Date.now() - start;
    sample("interruption_total", ms);

    const after = await service.getOpenQuestion(user.id, attemptId);
    const afterId = after.ok ? after.data?.id : null;

    console.log(`  [${label}] "${utterance}"`);
    line("  -> latency", `${ms}ms`);
    line("  -> action", res.ok ? res.data.action : `FAILED ${res.message}`);
    line("  -> advanced?", beforeId === afterId ? "NO (question held)" : "YES (ADVANCED)");
    if (res.ok && res.data.prompt) {
      console.log(`     says: ${res.data.prompt.replace(/\n+/g, " ").slice(0, 150)}`);
    }
    console.log();
  }

  /* ------------------------------------------------------------ replay */
  console.log("--- REPLAY GUARD (live) ---\n");
  const replayGen = 500;
  const first = await service.recordInterruption(
    user.id, attemptId, "Sorry, could you repeat that?", "", 0, replayGen,
  );
  const beforeReplay = await service.getOpenQuestion(user.id, attemptId);
  const second = await service.recordInterruption(
    user.id, attemptId, "Sorry, could you repeat that?", "", 0, replayGen,
  );
  const afterReplay = await service.getOpenQuestion(user.id, attemptId);
  line("first accepted", first.ok ? `yes (${first.data.action})` : "no");
  line("replay same gen", second.ok ? `refused as no-op, prompt=${second.data.prompt === null}` : "error");
  line(
    "question unchanged",
    (beforeReplay.ok ? beforeReplay.data?.id : "x") ===
      (afterReplay.ok ? afterReplay.data?.id : "y")
      ? "YES"
      : "NO — BUG",
  );

  const stale = await service.recordInterruption(
    user.id, attemptId, "Sorry, could you repeat that?", "", 0, 3,
  );
  line("stale gen=3", stale.ok && stale.data.prompt === null ? "refused as no-op" : "ACCEPTED — BUG");

  /* --------------------------------------------------------- teardown */
  await service.abandonAttempt(user.id, attemptId);

  /* ----------------------------------------------------- measurements */
  // Server-recorded spans: the per-stage breakdown inside a turn. The probe
  // timers above measure whole legs from the outside; these separate the
  // assessment call from the phrasing call, the planner and the database.
  console.log("\n=== PER-STAGE SPANS (server-recorded) ===\n");
  const byName = new Map<string, number[]>();
  for (const s of telemetry.readSpans(attemptId)) {
    const list = byName.get(s.name) ?? [];
    list.push(s.ms);
    byName.set(s.name, list);
  }
  for (const [name, values] of [...byName.entries()].sort()) {
    const q = telemetry.percentiles(values);
    console.log(
      `  ${name.padEnd(20)} n=${String(q.n).padEnd(3)} p50=${String(q.p50).padEnd(6)} p90=${String(q.p90).padEnd(6)} max=${q.max}`,
    );
  }

  console.log("\n=== MEASURED LATENCY (real providers) ===\n");
  for (const [name, values] of Object.entries(samples)) {
    const p = telemetry.percentiles(values);
    console.log(
      `  ${name.padEnd(20)} n=${String(p.n).padEnd(3)} p50=${String(p.p50).padEnd(6)} p90=${String(p.p90).padEnd(6)} max=${p.max}`,
    );
  }

  const spans = telemetry.summarize(attemptId);
  console.log(`\n  telemetry spans recorded: ${telemetry.readSpans(attemptId).length}`);
  console.log(`  estimated cost so far:    $${spans.totalCostUsd.toFixed(4)}`);
  console.log(`  degraded spans:           ${spans.degradedSpans}`);
  if (spans.failures.length > 0) {
    console.log("  FAILURES:");
    for (const f of spans.failures) console.log(`    ${f.span}: ${f.reason}`);
  }

  await prisma.$disconnect();
  console.log();
}

void main().catch((e) => {
  console.error("\nPROBE FAILED:", e);
  process.exitCode = 1;
});
