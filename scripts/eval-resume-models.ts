/**
 * Plan 154 Step 20 — choose the résumé model on accuracy AND cost, reproducibly.
 *
 * For every `src/features/resume/fixtures/<name>.pdf` that has a matching
 * `<name>.expected.json`, each model parses the PDF with the production prompts
 * and the production request shape (`callOpenAiResumeParser`), the output goes
 * through the production normaliser, and it is scored field by field.
 *
 * "Fabricated URL" is counted separately and weighs most: a link the résumé does
 * not contain, shown to a recruiter as the candidate's, is the worst failure a
 * parser can have.
 *
 * Only synthetic fixtures belong in that folder — never a real person's résumé.
 * Spends a few cents of real API credit (it prints the exact amount).
 *
 * Usage:
 *   npm run eval:resume-models
 *   npm run eval:resume-models -- --models gpt-4.1-mini,gpt-5-mini --runs 3
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

type Expected = {
  candidateName: string;
  email: string | null;
  counts: { experience: number; projects: number; education: number; certifications: number };
  minSkills: number;
  links: { linkedin: string | null; github: string | null; portfolio: string | null };
  projects: { match: string; github: string | null; demo: string | null }[];
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main() {
  const { callOpenAiResumeParser, costMicroUsd } = await import("@/features/resume/providers/openai");
  const { RESUME_SYSTEM_PROMPT, RESUME_SCHEMA_PROMPT } = await import("@/features/resume/parse");
  const { normalizeParsedResume, allSkills } = await import("@/features/resume/normalize");

  const models = arg("models", "gpt-4.1-mini,gpt-4o-mini,gpt-5-mini").split(",").map((m) => m.trim());
  const runs = Math.max(1, Number(arg("runs", "2")) || 2);
  const dir = join(process.cwd(), "src/features/resume/fixtures");
  const fixtures = readdirSync(dir)
    .filter((f) => f.endsWith(".pdf") && existsSync(join(dir, f.replace(/\.pdf$/, ".expected.json"))))
    .map((f) => ({
      name: f,
      bytes: new Uint8Array(readFileSync(join(dir, f))),
      expected: JSON.parse(readFileSync(join(dir, f.replace(/\.pdf$/, ".expected.json")), "utf8")) as Expected,
    }));
  if (fixtures.length === 0) {
    console.log("No fixtures with an .expected.json — nothing to evaluate.");
    return;
  }
  console.log(`Evaluating ${models.join(", ")} on ${fixtures.length} fixture(s) × ${runs} run(s)\n`);

  const rows: string[][] = [];
  let totalCost = 0;

  for (const model of models) {
    let checks = 0;
    let passedChecks = 0;
    let fabricated = 0;
    let nameCaseExact = 0;
    let calls = 0;
    let failures = 0;
    let tokIn = 0;
    let tokOut = 0;
    const latencies: number[] = [];

    for (const fx of fixtures) {
      for (let r = 0; r < runs; r++) {
        const call = await callOpenAiResumeParser({
          bytes: fx.bytes,
          fileName: fx.name,
          system: RESUME_SYSTEM_PROMPT,
          user: `${RESUME_SCHEMA_PROMPT}\n\nOriginal filename: ${fx.name}`,
          model,
        });
        calls++;
        tokIn += call.usage.prompt;
        tokOut += call.usage.completion;
        latencies.push(call.latencyMs);
        if (!call.ok) {
          failures++;
          continue;
        }
        const p = normalizeParsedResume(JSON.parse(call.text));
        const e = fx.expected;
        const check = (ok: boolean) => {
          checks++;
          if (ok) passedChecks++;
        };
        check((p.candidateName ?? "").toLowerCase() === e.candidateName.toLowerCase());
        if (p.candidateName === e.candidateName) nameCaseExact++;
        check((p.email ?? null) === e.email);
        check(p.experience.length === e.counts.experience);
        check(p.projects.length === e.counts.projects);
        check(p.education.length === e.counts.education);
        check(p.certifications.length === e.counts.certifications);
        check(allSkills(p).length >= e.minSkills);
        for (const k of ["linkedin", "github", "portfolio"] as const) {
          check((p[k] ?? null) === e.links[k]);
          if (p[k] && e.links[k] === null) fabricated++;
        }
        for (const ep of e.projects) {
          const got = p.projects.find((x) => (x.title ?? "").toLowerCase().includes(ep.match));
          for (const k of ["github", "demo"] as const) {
            const value = got?.[k] ?? null;
            check(value === ep[k]);
            if (value && value !== ep[k]) fabricated++;
          }
        }
      }
    }

    const cost = costMicroUsd(model, tokIn, tokOut);
    totalCost += cost;
    const ok = calls - failures;
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0;
    rows.push([
      model,
      `${checks ? ((100 * passedChecks) / checks).toFixed(1) : "0"}%`,
      String(fabricated),
      `${nameCaseExact}/${ok}`,
      `${failures}/${calls}`,
      `${Math.round(tokIn / calls)} / ${Math.round(tokOut / calls)}`,
      `${(p50 / 1000).toFixed(1)} s`,
      `$${(cost / calls / 1_000_000).toFixed(4)}`,
      `$${((cost / calls) * 1000 / 1_000_000).toFixed(2)}`,
    ]);
  }

  const head = ["model", "accuracy", "fabricated URLs", "name exact", "failed calls", "tokens in/out", "p50", "$/résumé*", "$/1,000*"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
  console.log(`\n* on these fixtures' size; this run spent $${(totalCost / 1_000_000).toFixed(4)}.`);
  console.log("Choose the cheapest model with zero fabricated URLs and the top accuracy band.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
