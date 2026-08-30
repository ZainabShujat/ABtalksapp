/**
 * The complete interview, end to end: plan → conversation → scoring → report →
 * persist → retrieve → render.
 *
 *   npx tsx scripts/e2e-interview-report.ts            # strong candidate
 *   npx tsx scripts/e2e-interview-report.ts mixed      # realistic mixed
 *   npx tsx scripts/e2e-interview-report.ts weak
 *   npx tsx scripts/e2e-interview-report.ts --md out.md
 *
 * WHAT IS REAL HERE: the plan, the compiled LangGraph agent, every turn, the
 * evidence, all scoring, the report document, and the Zod validation performed
 * on write and on read.
 *
 * WHAT IS NOT: the database and the narrative model.
 *   - The only DATABASE_URL configured in this workspace points at production
 *     (12,613 users) and `scripts/db-preflight.mjs` refuses it, so persistence
 *     runs against an in-memory store that performs the SAME validate-on-write
 *     and validate-on-read as `repository.ts`. The Prisma path is typechecked
 *     against the generated client but has not been executed.
 *   - With no ANTHROPIC_API_KEY the narrative falls back to deterministic text
 *     and the report is flagged `narrativeDegraded`. Pass a key to see real
 *     prose; the scores are identical either way, because no model touches them.
 */
import { writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

import { planCohortInterview } from "../src/features/interview/cohort/planner";
import { moduleForDay, MODULES } from "../src/features/interview/cohort/curriculum";
import { scopeDaysFor } from "../src/features/interview/cohort/planner";
import { BLUEPRINT_LABEL } from "../src/features/interview/cohort/blueprint";
import { createInitialState, startInterview } from "../src/features/interview/state";
import { createMockInterviewLLM, runInterviewTurn } from "../src/features/interview/agent";
import { createJsonInterviewLLM } from "../src/features/interview/agent/llm/json-provider";
import { activeQuestionView } from "../src/features/interview/agent/depth";
import { scoreQuestion } from "../src/features/interview/module-scoring";
import {
  assessCompetencies,
  overallFromCompetencies,
} from "../src/features/interview/scoring";
import { buildInterviewReport } from "../src/features/interview/report";
import { parseReport } from "../src/features/interview/report-assembly";
import type { InterviewReportDocument } from "../src/features/interview/report-assembly";
import type { AskJson } from "../src/features/interview/agent/llm/json-provider";
import type { CohortCandidateContext } from "../src/features/interview/cohort/candidate-context";
import type { InterviewState } from "../src/features/interview/types";
import daysJson from "../prisma/content/program/days.json";

// Scripts do not get Next.js's automatic env loading.
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const DAY_TITLES = new Map<number, string>(
  (daysJson as { dayNumber: number; title: string }[]).map((d) => [d.dayNumber, d.title]),
);

/* ------------------------------------------------------- in-memory store */

/**
 * Stands in for `InterviewTurn` + `InterviewReport`.
 *
 * Mirrors the repository's contract deliberately, including the two things that
 * actually matter for correctness: a report is validated BEFORE it is stored,
 * and validated AGAIN when it is read back. If either fails, the read returns
 * null exactly as the Prisma implementation does.
 */
type StoredTurn = {
  turnIndex: number;
  questionId: string;
  tier: string;
  depthLevel: number;
  action: string;
  promptText: string;
  answerText: string;
  evidence: unknown;
  degraded: boolean;
};

class InMemoryInterviewStore {
  private turns: StoredTurn[] = [];
  private report: { json: unknown; overallScore: number; degraded: boolean } | null = null;

  nextTurnIndex(): number {
    return this.turns.length;
  }

  saveTurn(turn: StoredTurn): void {
    if (this.turns.some((t) => t.turnIndex === turn.turnIndex)) return; // replay
    this.turns.push(turn);
  }

  loadTurns(): StoredTurn[] {
    return [...this.turns].sort((a, b) => a.turnIndex - b.turnIndex);
  }

  saveReport(report: InterviewReportDocument): { ok: boolean; message?: string } {
    const validated = parseReport(report);
    if (!validated.ok) return { ok: false, message: validated.message };
    // Stored as JSON, exactly as a JSONB column would.
    this.report = {
      json: JSON.parse(JSON.stringify(report)),
      overallScore: report.overall.score,
      degraded: report.narrativeDegraded,
    };
    return { ok: true };
  }

  loadReport(): InterviewReportDocument | null {
    if (!this.report) return null;
    const parsed = parseReport(this.report.json);
    return parsed.ok ? parsed.data : null;
  }
}

/* ------------------------------------------------------------- fixtures */

function demoContext(progressDay: number): CohortCandidateContext {
  const passedDays = Array.from({ length: progressDay }, (_, i) => i + 1);
  return {
    memberId: "pm_demo",
    fullName: "Priya Raman",
    jobRole: "Data Engineer",
    company: "Meridian Health",
    yearsExperience: 4,
    cohortName: "AI Cohort — August",
    githubRepoUrl: "https://github.com/priya/ai-cohort",
    progressDay,
    passedDays,
    currentModule: moduleForDay(progressDay)?.number ?? 1,
    moduleProgress: MODULES.map((m) => ({
      moduleNumber: m.number,
      title: m.title,
      passed: passedDays.filter((d) => d >= m.startDay && d <= m.endDay).length,
      total: m.endDay - m.startDay + 1,
    })),
    submissions: passedDays.map((day) => ({
      dayNumber: day,
      title: DAY_TITLES.get(day) ?? `Day ${day}`,
      moduleNumber: moduleForDay(day)?.number ?? 1,
      passed: true,
      attempts: day % 4 === 0 ? 2 : 1,
      repoRef: day % 4 === 0 ? null : `day${day}_solution.py`,
      submittedAt: new Date(Date.UTC(2026, 7, day)),
    })),
    projects: [
      {
        moduleNumber: 4,
        title: "Coverage RAG pipeline with plan-scoped retrieval",
        repoUrl: "https://github.com/priya/ai-cohort",
        score: 88,
      },
    ],
    scopeDays: scopeDaysFor("DAY_15"),
    beyondScopePassedDays: passedDays.filter((d) => d > 15),
  };
}

/**
 * Scripted answers keyed by question id.
 *
 * Written to genuinely contain the banked expected-evidence wording, so the
 * scores below are earned by content rather than by a stubbed flag.
 */
const STRONG_ANSWERS: Record<string, string> = {
  "d15-q03":
    "There was no API cost and no key required to start, and the data stays on the machine which matters for PHI. It also forced me to understand model size versus available RAM.",
  "d15-q09":
    "I could distinguish retrieval quality from generation quality — there was a case where retrieval was good but the answer still was not, and grounding or citation behaviour explained it.",
  "d15-q01":
    "The overlap preserves context across a chunk boundary. With zero overlap you can cut a clause mid-idea, so retrieval may return partial or missed exclusion clauses. The tradeoff is more chunks, more storage and cost.",
  "d15-q10":
    "I appended turns to a messages list passed back each call. The context window grows toward the token limit, so cost and latency grow with every turn and I would need truncation or summarisation.",
  "d15-q04":
    "The filter restricts the candidate set considered for similarity, which prevents returning another plan's policy text. Without it top-k can be dominated by irrelevant plans.",
  "d15-q05":
    "I locked variant three. I scored on accuracy, tone, conciseness and compliance, and the runner-up dropped the standard disclaimer language on edge questions.",
  "d15-q07":
    "Chroma is local and persistent so no external service was needed for this build, and there was no hosting cost. Pinecone would win for scale or managed operations.",
  "d15-q02":
    "One question needed both paths: the SQL lookup returned the plan and claim rows, the vector lookup returned the policy text, and I combined the two results into one answer.",
  "d15-q08":
    "The model receives a malformed or unexpected shape, which leads to downstream hallucination or a crash. Validation is the trust boundary between tool output and the model.",
  "d15-q06":
    "This is a retrieval and data problem, not a style problem. Fine-tuning changes tone and format, not facts, so I would inspect the knowledge base or the SQL source first.",
};

const WEAK_ANSWERS: Record<string, string> = {
  "d15-q03": "I ran the model locally because the program said to start that way.",
  "d15-q09": "I logged the results but did not compare them closely.",
  "d15-q01": "The overlap matters for chunks I think.",
  "d15-q10": "I stored the conversation somewhere in the script.",
  "d15-q04": "The filter filters things in Chroma.",
  "d15-q05": "I picked one of the prompts.",
  "d15-q07": "Chroma seemed fine.",
  "d15-q02": "I had a test harness with some questions.",
  "d15-q08": "Pydantic checks the response.",
  "d15-q06": "Probably fine-tuning would fix the deductible.",
};

function answerFor(mode: string, questionId: string, index: number): string {
  const base = questionId.split("@")[0]!;
  if (mode === "weak") return WEAK_ANSWERS[base] ?? "I am not sure about that one.";
  if (mode === "mixed") {
    return index % 3 === 2
      ? (WEAK_ANSWERS[base] ?? "Not sure.")
      : (STRONG_ANSWERS[base] ?? "I worked on that during the cohort.");
  }
  return STRONG_ANSWERS[base] ?? "I worked through that during the cohort.";
}

/* --------------------------------------------------------- live models */

/**
 * The real Claude call, inlined rather than imported.
 *
 * `report-provider.ts` and `agent/llm/anthropic-provider.ts` are both
 * `server-only` and cannot be imported by a plain script. This is the same
 * endpoint, model and JSON extraction as `lib/anthropic.ts`.
 */
function createAnthropicAsk(): AskJson {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.PROGRAM_ANTHROPIC_MODEL ?? "claude-sonnet-5";

  return async ({ system, user, maxTokens }) => {
    if (!apiKey) return { ok: false, message: "no ANTHROPIC_API_KEY configured" };
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) {
        return {
          ok: false,
          message: `anthropic ${res.status}`,
          retryable: res.status !== 429,
        };
      }
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = json.content?.find((c) => c.type === "text")?.text ?? "";
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) {
        return { ok: false, message: "no JSON in response" };
      }
      return { ok: true, data: JSON.parse(text.slice(start, end + 1)) };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  };
}

/* ----------------------------------------------------------- rendering */

function bar(score: number | null, width = 24): string {
  if (score === null) return "·".repeat(width);
  const filled = Math.round((score / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function renderReport(report: InterviewReportDocument): string {
  const L: string[] = [];
  const rule = "═".repeat(78);
  const thin = "─".repeat(78);

  L.push(rule);
  L.push("AI COHORT INTERVIEW REPORT");
  L.push(rule);
  L.push("");
  L.push(`Candidate      ${report.candidate.name} — ${report.candidate.jobRole} at ${report.candidate.company}`);
  L.push(`Cohort         ${report.candidate.cohort}`);
  L.push(`Milestone      ${report.milestone.label}`);
  L.push(`Scope assessed Days ${report.milestone.scopeFrom}–${report.milestone.scopeTo}`);
  L.push(
    `Live progress  Day ${report.milestone.progressDay ?? "—"}  (context only — not scored)`,
  );
  L.push(
    `Duration       ${Math.floor(report.overall.durationSec / 60)}m ${report.overall.durationSec % 60}s`,
  );
  L.push(`Generated      ${report.generatedAt}`);
  L.push(`Bank version   ${report.milestone.bankVersion}`);
  L.push("");
  L.push(thin);
  L.push(`OVERALL SCORE     ${report.overall.score} / 100   (${report.overall.tier})`);
  L.push(thin);
  L.push(
    `  ${report.overall.questionsAnswered}/${report.overall.questionsAsked} questions answered · ` +
      `${report.overall.escalationsEarned} deeper probe(s) earned · ` +
      `${report.overall.followUpsAsked} follow-up(s) · ` +
      `${report.overall.redirectsIssued} redirect(s)`,
  );
  L.push("");

  L.push("MODULE PERFORMANCE");
  L.push(thin);
  for (const m of report.modules) {
    const score = m.score === null ? "  n/a" : `${String(m.score).padStart(5)}`;
    L.push(
      `  ${String(m.moduleNumber).padStart(2)}. ${m.title.padEnd(38).slice(0, 38)} ` +
        `${bar(m.score)} ${score}`,
    );
    L.push(`      Days ${m.dayRange.from}–${m.dayRange.to} · ${m.note}`);
    if (m.evidenceRefs.length > 0) {
      L.push(`      evidence: ${m.evidenceRefs.join(", ")}`);
    }
  }
  L.push("");

  L.push("COMPETENCIES");
  L.push(thin);
  for (const c of report.competencies) {
    L.push(
      `  ${c.label.padEnd(30)} ${bar(c.score)} ${String(c.score).padStart(3)}  ` +
        `(weight ${c.weight}%, ${c.tier})`,
    );
    L.push(`      ${c.justification}`);
    if (c.evidenceRefs.length > 0) {
      L.push(`      evidence: ${c.evidenceRefs.join(", ")}`);
    }
  }
  L.push("");

  L.push("STRENGTHS");
  L.push(thin);
  for (const s of report.strengths) {
    L.push(`  • ${s.text}`);
    L.push(`    ↳ ${s.evidenceRefs.join(", ")}`);
  }
  L.push("");

  L.push("AREAS TO IMPROVE");
  L.push(thin);
  for (const i of report.improvements) {
    L.push(`  • ${i.text}`);
    L.push(
      `    ↳ ${i.evidenceRefs.join(", ")}` +
        (i.suggestedDays.length > 0 ? ` · revisit day ${i.suggestedDays.join(", ")}` : ""),
    );
  }
  L.push("");

  L.push("SKILLS");
  L.push(thin);
  L.push(`  Demonstrated (${report.skills.demonstrated.length}):`);
  for (const s of report.skills.demonstrated.slice(0, 8)) L.push(`    ✓ ${s}`);
  if (report.skills.notShown.length > 0) {
    L.push(`  Not shown (${report.skills.notShown.length}):`);
    for (const s of report.skills.notShown.slice(0, 8)) L.push(`    ✗ ${s}`);
  }
  L.push("");

  if (report.beyondMilestone.length > 0) {
    L.push("BEYOND THE MILESTONE (asked, not scored)");
    L.push(thin);
    for (const b of report.beyondMilestone) {
      L.push(`  ${b.questionId} · days ${b.sourceDays.join(", ")}`);
      L.push(`    Q: ${b.question}`);
      L.push(`    A: ${b.answerExcerpt.slice(0, 160)}`);
      L.push(`    ${b.note}`);
    }
    L.push("");
  }

  L.push("EVIDENCE");
  L.push(thin);
  for (const e of report.evidence.filter((x) => x.answered)) {
    L.push(
      `  ${e.questionId} · ${e.mode} · ${e.competency} · module ${e.moduleNumber ?? "—"} · ` +
        `days ${e.sourceDays.join(",")} · score ${e.score}` +
        (e.depthReached > 1 ? ` · reached depth ${e.depthReached}` : "") +
        (e.tier === "EXTENSION" ? " · EXTENSION" : ""),
    );
    L.push(`    Q: ${e.question}`);
    L.push(`    A: "${e.answerExcerpt}"`);
    if (e.matched.length > 0) L.push(`    covered: ${e.matched.join(" · ")}`);
    if (e.missing.length > 0) L.push(`    missed:  ${e.missing.join(" · ")}`);
    L.push("");
  }

  L.push("INTERVIEW SUMMARY");
  L.push(thin);
  L.push(`  ${report.summary}`);
  L.push("");
  L.push("RECOMMENDATION");
  L.push(thin);
  L.push(`  ${report.recommendation}`);
  L.push("");
  if (report.narrativeDegraded) {
    L.push(
      "  NOTE: the narrative was generated deterministically from the recorded",
    );
    L.push(
      "  evidence because no narrative model was configured. Scores are unaffected.",
    );
    L.push("");
  }
  L.push(rule);
  return L.join("\n");
}

/* ----------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => !a.startsWith("--")) ?? "strong";
  const mdIndex = args.indexOf("--md");
  const mdPath = mdIndex >= 0 ? args[mdIndex + 1] : null;

  const blueprint = "DAY_15" as const;
  const context = demoContext(18);
  const plan = planCohortInterview(blueprint, context);
  const store = new InMemoryInterviewStore();

  // --live swaps BOTH models for the real ones. Nothing else changes: same
  // graph, same policy, same scoring, same report assembly.
  //
  // Anthropic rather than the configured Gemini: the Gemini free tier caps at
  // 15 requests per day and one interview needs roughly thirty, so it cannot
  // complete a session. See the notes at the end of this run.
  const live = args.includes("--live");
  const askAnthropic = createAnthropicAsk();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const llm =
    live && anthropicKey
      ? createJsonInterviewLLM({
          name: `anthropic:${process.env.PROGRAM_ANTHROPIC_MODEL ?? "claude-sonnet-5"}`,
          askJson: askAnthropic,
        })
      : createMockInterviewLLM();

  console.log(`\n▸ 1. PLAN — ${BLUEPRINT_LABEL[blueprint]}`);
  console.log(
    `     ${plan.questions.filter((q) => q.tier === "CORE").length} core + ` +
      `${plan.questions.filter((q) => q.tier === "EXTENSION").length} extension questions, ` +
      `${plan.questions.filter((q) => q.grounded).length} grounded in real submissions`,
  );

  console.log(`\n▸ 2. INTERVIEW (${mode} candidate)`);

  let state: InterviewState = startInterview(createInitialState());
  let turnCount = 0;
  let finished = false;

  while (turnCount < 80 && !finished) {
    const question = plan.questions[state.currentQuestionIndex];
    if (!question) break;

    const depthBefore = state.depthLevel ?? 1;
    const view = activeQuestionView(question, depthBefore);
    const answerText = answerFor(mode, question.id, turnCount);

    const result = await runInterviewTurn(llm, {
      interviewId: "iv_e2e",
      blueprint,
      plan,
      state,
      questionId: question.id,
      answerText,
    });

    if (!result.ok) {
      console.log(`     turn refused: ${result.message}`);
      break;
    }

    // Exactly what `service.recordCohortAnswer` builds and hands to saveTurn.
    store.saveTurn({
      turnIndex: store.nextTurnIndex(),
      questionId: question.id,
      tier: question.tier ?? "CORE",
      depthLevel: depthBefore,
      action: result.data.action,
      promptText: result.data.prompt ?? "",
      answerText,
      evidence:
        result.data.action === "REDIRECT" || result.data.action === "REPEAT"
          ? null
          : (result.data.state.evidenceByQuestionId[view.evidenceKey] ?? null),
      degraded: result.data.degraded,
    });

    state = result.data.state;
    finished = result.data.finished;
    turnCount++;
  }

  console.log(`     ${turnCount} turns · finished=${finished} · status=${state.status}`);
  console.log(`     ${store.loadTurns().length} turn rows persisted`);

  console.log("\n▸ 3. SCORING (no model involved)");
  const coreScores = plan.questions
    .filter((q) => (q.tier ?? "CORE") === "CORE")
    .map((q) => scoreQuestion(q, state));
  const competencies = assessCompetencies(coreScores, state, plan);
  const overall = overallFromCompetencies(competencies);
  console.log(`     overall ${overall}/100 from ${coreScores.filter((s) => s.answered).length} answered core questions`);

  console.log("\n▸ 4. REPORT");
  const ask: AskJson = askAnthropic;

  console.log(
    `     narrative model: ${
      anthropicKey
        ? (process.env.PROGRAM_ANTHROPIC_MODEL ?? "claude-sonnet-5")
        : "none (deterministic fallback)"
    }`,
  );

  const report = await buildInterviewReport(ask, {
    plan,
    state,
    blueprint,
    scopeDays: scopeDaysFor(blueprint),
    candidate: {
      name: context.fullName,
      cohort: context.cohortName,
      jobRole: context.jobRole,
      company: context.company,
    },
    progressDay: context.progressDay,
    durationSec: 640,
  });

  console.log("\n▸ 5. PERSIST");
  const saved = store.saveReport(report);
  console.log(
    `     validate-on-write: ${saved.ok ? "PASS" : `FAIL — ${saved.message}`}`,
  );
  if (!saved.ok) process.exitCode = 1;

  console.log("\n▸ 6. RETRIEVE");
  const loaded = store.loadReport();
  console.log(`     validate-on-read:  ${loaded ? "PASS" : "FAIL"}`);
  if (!loaded) {
    process.exitCode = 1;
    return;
  }

  const sameScore = loaded.overall.score === report.overall.score;
  const sameEvidence = loaded.evidence.length === report.evidence.length;
  console.log(
    `     round-trip fidelity: score ${sameScore ? "PASS" : "FAIL"}, evidence ${
      sameEvidence ? "PASS" : "FAIL"
    }`,
  );

  // Traceability audit on the RETRIEVED document, not the in-memory one.
  const answeredIds = new Set(
    loaded.evidence.filter((e) => e.answered).map((e) => e.questionId),
  );
  const allRefs = [
    ...loaded.strengths.flatMap((s) => s.evidenceRefs),
    ...loaded.improvements.flatMap((i) => i.evidenceRefs),
    ...loaded.competencies.flatMap((c) => c.evidenceRefs),
    ...loaded.modules.flatMap((m) => m.evidenceRefs),
  ];
  const untraceable = allRefs.filter((ref) => !answeredIds.has(ref));
  console.log(
    `     traceability: ${allRefs.length} references, ${untraceable.length} untraceable ` +
      `${untraceable.length === 0 ? "PASS" : `FAIL — ${untraceable.join(", ")}`}`,
  );
  if (untraceable.length > 0) process.exitCode = 1;

  const scopeLeaks = loaded.evidence
    .filter((e) => e.tier === "CORE")
    .flatMap((e) => e.sourceDays)
    .filter((d) => d > loaded.milestone.scopeTo);
  console.log(
    `     scope: core evidence outside days 1–${loaded.milestone.scopeTo}: ` +
      `${scopeLeaks.length} ${scopeLeaks.length === 0 ? "PASS" : "FAIL"}`,
  );
  if (scopeLeaks.length > 0) process.exitCode = 1;

  console.log("\n▸ 7. THE REPORT AS A READER SEES IT\n");
  const rendered = renderReport(loaded);
  console.log(rendered);

  if (mdPath) {
    writeFileSync(mdPath, "```\n" + rendered + "\n```\n", "utf8");
    console.log(`\nWritten to ${mdPath}`);
  }
}

main().catch((error) => {
  console.error("e2e failed", error);
  process.exitCode = 1;
});
