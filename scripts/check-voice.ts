/**
 * Diagnoses the interview voice pipeline on THIS machine.
 *
 *   npx tsx scripts/check-voice.ts
 *
 * Run it when speech-to-text "does not work" on someone's clone. It answers the
 * three questions the browser error cannot:
 *
 *   1. Which vendor would the server pick, and is a key actually loaded?
 *   2. Does that key work right now — by making a real transcription call?
 *   3. Is the Prisma client generated, so the route can even compile?
 *
 * Read-only. Touches no database and no interview.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";

function mask(v: string | undefined): string {
  if (!v) return "MISSING";
  return `set (${v.length} chars, ends …${v.slice(-4)})`;
}

/** A tiny valid WAV: 0.4s of near-silence. Enough to prove auth and reachability. */
function tinyWav(): ArrayBuffer {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * 0.4);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    // A faint tone, so the payload is not literally all zeroes.
    buf.writeInt16LE(Math.round(Math.sin(i / 12) * 60), 44 + i * 2);
  }
  // Copy out of Node's pooled Buffer into a standalone ArrayBuffer, which is
  // what Blob accepts without complaint.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function main() {
  console.log("\n=== 1. Keys visible to this process ===");
  console.log("  GROQ_API_KEY           ", mask(process.env.GROQ_API_KEY));
  console.log("  OPENAI_API_KEY         ", mask(process.env.OPENAI_API_KEY));
  console.log("  INTERVIEW_STT_MODEL    ", process.env.INTERVIEW_STT_MODEL ?? "(default)");
  console.log("  ENABLE_INTERVIEW_VOICE ", process.env.ENABLE_INTERVIEW_VOICE ?? "MISSING");
  console.log("  DATABASE_SAMPLE_URL    ", process.env.DATABASE_SAMPLE_URL ? "set" : "MISSING");

  const vendor = process.env.OPENAI_API_KEY
    ? { name: "openai" as const, apiKey: process.env.OPENAI_API_KEY }
    : process.env.GROQ_API_KEY
      ? { name: "groq" as const, apiKey: process.env.GROQ_API_KEY }
      : null;

  if (!vendor) {
    console.error(
      "\n  FAIL — no speech key. The route returns 503 'Voice is not configured.'\n" +
        "  Add GROQ_API_KEY to .env.local.\n",
    );
    process.exit(1);
  }
  console.log(`\n  → server would use: ${vendor.name}`);

  console.log("\n=== 2. Prisma client generated? ===");
  try {
    const mod = await import("@prisma/client");
    const hasUser = typeof (mod as { PrismaClient?: unknown }).PrismaClient === "function";
    console.log(`  @prisma/client loads  ${hasUser ? "yes" : "NO"}`);
    console.log("  (if this fails, run: npx prisma generate)");
  } catch (err) {
    console.error(
      "\n  FAIL — @prisma/client is not generated. The STT route cannot compile,\n" +
        "  so Next serves an HTML 500 and the browser shows\n" +
        "  'Could not reach the transcription service.'\n\n" +
        "  Fix:  npm install && npx prisma generate\n",
    );
    console.error("  " + String(err).slice(0, 200));
    process.exit(1);
  }

  console.log("\n=== 3. Live transcription call ===");
  const model =
    process.env.INTERVIEW_STT_MODEL ??
    (vendor.name === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe");
  console.log(`  model: ${model}`);

  const form = new FormData();
  form.append("file", new Blob([tinyWav()], { type: "audio/wav" }), "probe.wav");
  form.append("model", model);
  form.append("language", "en");

  try {
    const res = await fetch(
      vendor.name === "groq" ? GROQ_TRANSCRIBE_URL : OPENAI_TRANSCRIBE_URL,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${vendor.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      },
    );

    const body = await res.text();
    console.log(`  HTTP ${res.status}`);

    if (res.ok) {
      console.log(`  response: ${body.slice(0, 200)}`);
      console.log(
        "\n  PASS — the speech vendor is reachable and the key works.\n" +
          "  If the browser still fails, the problem is the app, not the key:\n" +
          "  check the dev server log for POST /api/interview/stt.\n",
      );
      return;
    }

    console.error(`  body: ${body.slice(0, 400)}`);
    if (res.status === 401) {
      console.error("\n  FAIL — the key is rejected. Wrong or revoked GROQ_API_KEY.\n");
    } else if (res.status === 429) {
      console.error(
        "\n  FAIL — rate limited. The team shares one key; only one person can\n" +
          "  transcribe at a time on the free tier. Wait, or use separate keys.\n",
      );
    } else {
      console.error("\n  FAIL — the vendor rejected the request. See body above.\n");
    }
    process.exitCode = 1;
  } catch (err) {
    console.error(
      `\n  FAIL — could not reach ${vendor.name}: ${
        err instanceof Error ? err.message : String(err)
      }\n  Network, proxy, or firewall. This is the same failure the browser\n` +
        "  reports as 'Could not reach the transcription service.'\n",
    );
    process.exitCode = 1;
  }
}

main();
