/**
 * Grounding and generation checks. Deterministic, offline, no provider.
 *
 *   npm run test:interview:grounding
 *
 * Exercises the whole phrasing path with a mock LLM: curriculum context, the
 * generation call, validation, and what ends up frozen in the plan.
 *
 * THE CONDITIONS FLAG IS REQUIRED, not optional. `generate-phrasing.ts` is
 * `server-only`, and that package resolves to an entry that throws on import
 * unless the `react-server` condition is set — so a plain `npx tsx` run of this
 * file dies at import and reports zero checks rather than failing one.
 *
 * The npm script above passes it to `tsx` directly rather than through
 * NODE_OPTIONS, which is how the older `test:scout` style scripts do it: npm
 * runs scripts through cmd.exe on Windows, where a `VAR=value command` prefix
 * is not shell syntax and the run dies before node starts.
 *
 * Nothing about the production boundary changes: `generate-phrasing.ts` keeps
 * its `server-only` import and still cannot be pulled into a client bundle.
 */
import assert from "node:assert/strict";
import { describeCurriculum } from "@/features/interview/cohort/curriculum-context";
import { generateCohortPhrasing } from "@/features/interview/cohort/generate-phrasing";
import { planCohortInterview } from "@/features/interview/cohort/planner";
import { getQuestionBank } from "@/features/interview/cohort/question-bank";
import { FRAMING } from "@/features/interview/cohort/question-phrasing";
import type {
  InterviewLLM,
  PhraseQuestionsInput,
} from "@/features/interview/agent/llm/provider";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

/** A provider that phrases every target however the test tells it to. */
function phrasingLLM(reply: (id: string, authored: string) => string): InterviewLLM {
  return {
    name: "mock-phrasing",
    async analyzeAnswer() {
      throw new Error("not used in this suite");
    },
    async phraseQuestions(input: PhraseQuestionsInput) {
      const out: Record<string, string> = {};
      for (const t of input.targets) out[t.id] = reply(t.id, t.authored);
      return out;
    },
  } as unknown as InterviewLLM;
}

async function main() {
  console.log("\nCurriculum grounding");

  await check("curriculum text is real, scoped, and never invented", () => {
    const day2 = describeCurriculum([2]);
    assert.ok(day2.includes("Day 2"), "must name the day");
    assert.ok(/Ollama/i.test(day2), "must carry the day's real tools");
    // Scoped to the days asked for: a question about day 2 must not drag the
    // whole cohort into its prompt.
    assert.ok(!/Day 11/.test(day2));
    assert.equal(describeCurriculum([999]), "", "an unknown day yields nothing");
  });

  await check("every bank question maps onto real curriculum days", () => {
    for (const blueprint of ["DAY_15", "DAY_31"] as const) {
      for (const q of getQuestionBank(blueprint).questions) {
        assert.ok(
          describeCurriculum(q.sourceDays).length > 0,
          `${q.id} references days with no curriculum entry`,
        );
      }
    }
  });

  console.log("\nGeneration end to end");

  await check("accepted wording is frozen into spokenText", async () => {
    const bank = getQuestionBank("DAY_15");
    const llm = phrasingLLM((_id, authored) => `So, ${authored.toLowerCase()}`);
    const phrasing = await generateCohortPhrasing(llm, "DAY_15", null);
    assert.ok(Object.keys(phrasing).length > 0, "some questions must be phrased");

    const plan = planCohortInterview("DAY_15", null, phrasing);
    const q = plan.questions.find((x) => phrasing[x.id]);
    assert.ok(q, "a phrased question must appear in the plan");
    assert.ok(
      q!.spokenText?.includes(phrasing[q!.id]!),
      "spokenText must carry the frozen wording",
    );
    assert.equal(q!.phrasedByModel, true, "the plan must record it was generated");

    // The GRADING target is untouched — this is the whole guarantee.
    const authored = bank.questions.find((b) => b.id === q!.id)!;
    assert.equal(q!.text, authored.text, "the authored target must not move");
  });

  await check("invalid wording falls back to the bank text", async () => {
    const llm = phrasingLLM(() => "How did you handle billing and invoicing?");
    const phrasing = await generateCohortPhrasing(llm, "DAY_15", null);
    assert.equal(Object.keys(phrasing).length, 0, "off-target wording is dropped");

    const plan = planCohortInterview("DAY_15", null, phrasing);
    for (const q of plan.questions) {
      assert.ok(!q.phrasedByModel, `${q.id} should not be marked generated`);
    }
  });

  await check("a compound generation is dropped, not asked", async () => {
    const llm = phrasingLLM(
      (_id, authored) => `${authored} And what would you change now?`,
    );
    assert.equal(
      Object.keys(await generateCohortPhrasing(llm, "DAY_15", null)).length,
      0,
    );
  });

  await check("a provider without phrasing support changes nothing", async () => {
    const bare = {
      name: "bare",
      async analyzeAnswer() {
        throw new Error("x");
      },
    } as unknown as InterviewLLM;
    assert.deepEqual(await generateCohortPhrasing(bare, "DAY_15", null), {});
  });

  await check("calibration changes the framing handed to the model", async () => {
    const seen: string[] = [];
    const spy = {
      name: "spy",
      async analyzeAnswer() {
        throw new Error("x");
      },
      async phraseQuestions(input: PhraseQuestionsInput) {
        seen.push(input.framing);
        return {};
      },
    } as unknown as InterviewLLM;

    await generateCohortPhrasing(spy, "DAY_15", null, "FOUNDATIONS");
    await generateCohortPhrasing(spy, "DAY_15", null, "ADVANCED");
    await generateCohortPhrasing(spy, "DAY_15", null, null);

    assert.equal(seen[0], FRAMING.FOUNDATIONS);
    assert.equal(seen[1], FRAMING.ADVANCED);
    assert.equal(seen[2], FRAMING.WORKING, "no calibration yet means WORKING");
    assert.equal(new Set(seen).size, 3, "the three levels must differ");
  });

  await check("the model is given curriculum AND candidate work per target", async () => {
    let captured: PhraseQuestionsInput | null = null;
    const spy = {
      name: "spy",
      async analyzeAnswer() {
        throw new Error("x");
      },
      async phraseQuestions(input: PhraseQuestionsInput) {
        captured = input;
        return {};
      },
    } as unknown as InterviewLLM;

    await generateCohortPhrasing(spy, "DAY_15", null);
    assert.ok(captured, "the provider must be called");
    const input = captured as unknown as PhraseQuestionsInput;
    assert.ok(input.targets.length > 0);
    for (const t of input.targets) {
      assert.ok(t.authored.length > 0, "every target carries its authored text");
      assert.ok(t.curriculum.length > 0, "every target carries curriculum");
      // With no candidate context there is nothing to ground on, and the
      // prompt must say so rather than let the model imagine something.
      assert.equal(t.candidateWork, "", "no context means no claimed work");
    }
  });

  console.log("\nMilestone scope");

  await check("DAY_15 stays days 1-15 whatever the live progress", async () => {
    const plan = planCohortInterview("DAY_15", null, {});
    const core = plan.questions.filter((q) => (q.tier ?? "CORE") === "CORE");
    for (const q of getQuestionBank("DAY_15").questions) {
      for (const day of q.sourceDays) {
        assert.ok(day <= 15, `${q.id} reaches day ${day}, outside the milestone`);
      }
    }
    assert.equal(
      plan.contextSummary.kind === "COHORT"
        ? plan.contextSummary.questionCount
        : -1,
      core.length,
      "the comparable count is CORE only",
    );
  });

  console.log(`\n${passed} checks passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

void main();
