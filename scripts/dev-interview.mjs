/**
 * Starts the Next dev server bound to the SEPARATE TEST database.
 *
 *   npm run dev:interview
 *
 * Why this exists rather than a documented set of environment variables: the
 * project's `.env.local` points `DATABASE_URL` at production, so a plain
 * `npm run dev` serves the app from the live database. The interview tables do
 * not exist there, and nothing in this workstream may write to it.
 *
 * This wrapper binds the test database from `DATABASE_SAMPLE_URL`, verifies by
 * ROW COUNT that the target is disposable, and only then starts the server. It
 * refuses to boot against anything production-shaped, so the guard cannot be
 * skipped by forgetting a flag.
 *
 * Nothing is written to any .env file — the override lives in this process.
 */
import { spawn } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

const MAX_USERS = 500;
const MAX_SUBMISSIONS = 200;

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const sampleUrl = process.env.DATABASE_SAMPLE_URL;
if (!sampleUrl) {
  console.error(
    "\n  DATABASE_SAMPLE_URL is not set.\n" +
      "  Point it at a separate Neon database, then run this again.\n",
  );
  process.exit(1);
}

// Neon's pooled endpoint is fine for queries; migrations want the direct one.
const directUrl = sampleUrl.replace("-pooler", "");

process.env.DATABASE_URL = sampleUrl;
process.env.DIRECT_URL = directUrl;

// Groq is the only reasoning provider with working credit on this project:
// the Gemini key is capped at 15 free requests a day and the Anthropic key
// reports a zero balance. Without this the interview silently degrades to
// keyword heuristics and scores every candidate near zero.
process.env.INTERVIEW_LLM_PROVIDER =
  process.env.INTERVIEW_LLM_PROVIDER_OVERRIDE ?? "groq";
process.env.ENABLE_INTERVIEW_VOICE = "true";

const host = new URL(sampleUrl).hostname;

const prisma = new PrismaClient();
try {
  const [users, submissions] = await Promise.all([
    prisma.user.count(),
    prisma.programMissionSubmission.count(),
  ]);

  console.log("");
  console.log("  database      " + host);
  console.log("  users         " + users);
  console.log("  submissions   " + submissions);

  if (users > MAX_USERS || submissions > MAX_SUBMISSIONS) {
    console.error(
      `\n  REFUSING TO START: this looks like production ` +
        `(${users} users, ${submissions} mission submissions).\n`,
    );
    process.exit(1);
  }

  console.log("  verdict       disposable test database — safe\n");
  console.log("  llm provider  " + process.env.INTERVIEW_LLM_PROVIDER);
  console.log("  voice         enabled");
  console.log(
    "  speech        stt " +
      (process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.GROQ_API_KEY
          ? "groq/whisper"
          : "NONE") +
      " · tts " +
      (process.env.OPENAI_API_KEY ? "openai" : "browser fallback"),
  );
  console.log("");
} catch (error) {
  console.error("\n  Could not inspect the database: " + String(error) + "\n");
  process.exit(1);
} finally {
  await prisma.$disconnect();
}

const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 0));
