/**
 * Run plan 078 Phase 2 backfill steps in order against the current DATABASE_URL.
 * Must target Neon child branch plan-078-phase1.
 */
import { spawn } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

function withSocketTimeout(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", "30");
    }
    if (!parsed.searchParams.has("socket_timeout")) {
      parsed.searchParams.set("socket_timeout", "180");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "30");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

process.env.DATABASE_URL = withSocketTimeout(process.env.DATABASE_URL);
process.env.DIRECT_URL = withSocketTimeout(process.env.DIRECT_URL);

const STEPS = [
  "prisma/scripts/migrate-2a-identity.ts",
  "prisma/scripts/migrate-2b-visibility.ts",
  "prisma/scripts/migrate-2c-roles.ts",
  "prisma/scripts/migrate-2d-learning-content.ts",
  "prisma/scripts/migrate-2e-enrollments-attempts.ts",
  "prisma/scripts/migrate-2f-points.ts",
  "prisma/scripts/migrate-2g-credentials.ts",
  "prisma/scripts/migrate-2h-recruiting.ts",
  "prisma/scripts/migrate-2i-achievements.ts",
  "prisma/scripts/migrate-078-verify.ts",
];

function run(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n======== ${file} ========`);
    const child = spawn("npx", ["tsx", file], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited ${code}`));
    });
  });
}

async function main() {
  if (process.env.PHASE2_SAMPLE === "1") {
    console.log("Phase 2 SAMPLE mode: representative users only (full learning catalog).");
  }
  const { assertChildBranch, assertNotSampleChildForFullRun } = await import(
    "./migrate-078-shared"
  );
  assertChildBranch();
  assertNotSampleChildForFullRun();
  const only = process.argv[2];
  const files = only ? STEPS.filter((s) => s.includes(only)) : STEPS;
  if (files.length === 0) throw new Error(`No step matched ${only}`);
  for (const file of files) await run(file);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
