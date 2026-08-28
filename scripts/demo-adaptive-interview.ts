/**
 * A watchable demo of the adaptive interview brain (docs/plans/072, Phase 1).
 *
 * Runs scripted candidates through the REAL compiled LangGraph agent over the
 * REAL Day 15 bank, printing every decision the system makes and WHY. Nothing
 * is simulated except the candidate's answers and, unless a provider key is
 * configured, the model.
 *
 *   npx tsx scripts/demo-adaptive-interview.ts              # all scenarios
 *   npx tsx scripts/demo-adaptive-interview.ts strong       # one scenario
 *   npx tsx scripts/demo-adaptive-interview.ts --context    # context + plan only
 *
 * Scenarios: context · strong · weak · offtopic · mixed · full
 *
 * No database and no network are required. With GEMINI_API_KEY or
 * ANTHROPIC_API_KEY set, pass --live to use the real provider instead of the
 * deterministic mock.
 */
import { planCohortInterview } from "../src/features/interview/cohort/planner";
import { moduleForDay, MODULES } from "../src/features/interview/cohort/curriculum";
import { BLUEPRINT_LABEL, maxScopeDay } from "../src/features/interview/cohort/blueprint";
import { createInitialState, startInterview } from "../src/features/interview/state";
import {
  activeQuestionView,
  classifyAnswer,
  questionAsAsked,
} from "../src/features/interview/agent/depth";
import { createMockInterviewLLM, runInterviewTurn } from "../src/features/interview/agent";
import type { InterviewLLM } from "../src/features/interview/agent";
import type { CohortCandidateContext } from "../src/features/interview/cohort/candidate-context";
import type { InterviewPlan, InterviewState } from "../src/features/interview/types";
import daysJson from "../prisma/content/program/days.json";

/**
 * Real curriculum day titles, so the grounding clauses in this demo read
 * exactly as they will in production. Loaded here rather than in
 * `cohort/curriculum.ts` because days.json is 163 KB and the feature only ever
 * needs the day→module map; a demo script has no bundle to worry about.
 */
const DAY_TITLES = new Map<number, string>(
  (daysJson as { dayNumber: number; title: string }[]).map((d) => [
    d.dayNumber,
    d.title,
  ]),
);

/* ------------------------------------------------------------- presentation */

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function rule(char = "─") {
  console.log(C.dim + char.repeat(78) + C.reset);
}

function heading(text: string) {
  console.log(`\n${C.bold}${C.cyan}${text}${C.reset}`);
  rule();
}

function kv(key: string, value: string | number) {
  console.log(`  ${C.dim}${key.padEnd(24)}${C.reset}${value}`);
}

const ACTION_COLOR: Record<string, string> = {
  ESCALATE: C.magenta,
  FOLLOW_UP: C.yellow,
  NEXT_QUESTION: C.green,
  REDIRECT: C.red,
  REPEAT: C.blue,
  COMPLETE: C.green,
};

/* ---------------------------------------------------------------- fixtures */

/**
 * A candidate context in exactly the shape `buildCohortCandidateContext`
 * returns from the database.
 *
 * It is a FIXTURE, not a live read: the only database configured in this
 * workspace is production, and plan 070 forbids touching it. Every field below
 * is annotated with the column it comes from, so what the live path will supply
 * is unambiguous.
 */
function demoContext(progressDay: number): CohortCandidateContext {
  const passedDays = Array.from({ length: progressDay }, (_, i) => i + 1);

  return {
    memberId: "pm_demo",                                  // ProgramMember.id
    fullName: "Priya Raman",                              // ProgramMember.fullName
    jobRole: "Data Engineer",                             // ProgramMember.jobRole
    company: "Meridian Health",                           // ProgramMember.company
    yearsExperience: 4,                                   // ProgramMember.yearsExperience
    cohortName: "AI Cohort — August",                     // ProgramCohort.name
    githubRepoUrl: "https://github.com/priya/ai-cohort",  // ProgramMember.githubRepoUrl
    progressDay,                                          // getMemberProgressDay(passedDays)
    passedDays,                                           // ProgramMissionSubmission.passed
    currentModule: moduleForDay(progressDay)?.number ?? 1,
    moduleProgress: MODULES.map((m) => ({
      moduleNumber: m.number,
      title: m.title,
      passed: passedDays.filter((d) => d >= m.startDay && d <= m.endDay).length,
      total: m.endDay - m.startDay + 1,
    })),
    submissions: passedDays.map((day) => ({
      dayNumber: day,
      title: DAY_TITLES.get(day) ?? `Day ${day} mission`,
      moduleNumber: moduleForDay(day)?.number ?? 1,
      passed: true,
      attempts: day % 4 === 0 ? 2 : 1,
      // Deliberately sparse: days 4, 8, 12 have no repo ref, so the demo shows
      // the "no artifact ⇒ no clause" rule firing on real questions.
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
    scopeDays: Array.from({ length: 15 }, (_, i) => i + 1),
    beyondScopePassedDays: passedDays.filter((d) => d > 15),
  };
}

/* ------------------------------------------------------------- the runner */

type ScriptedAnswer = { label: string; text: string };

async function runConversation(
  title: string,
  plan: InterviewPlan,
  llm: InterviewLLM,
  answersFor: (questionId: string, turnIndex: number) => ScriptedAnswer,
  maxTurns = 12,
) {
  heading(title);

  let state: InterviewState = startInterview(createInitialState());
  let turnIndex = 0;

  const first = plan.questions[0]!;
  console.log(
    `${C.bold}INTERVIEWER${C.reset} ${first.spokenText ?? first.text}`,
  );
  if (first.grounded) {
    console.log(`  ${C.dim}↑ grounded on: ${first.groundingNote}${C.reset}`);
  }

  while (turnIndex < maxTurns) {
    const question = plan.questions[state.currentQuestionIndex];
    if (!question) break;

    // Resolve the rung BEFORE the turn: once escalated, the candidate is
    // answering the deep probe, and its evidence is filed under its own key.
    const depthBefore = state.depthLevel ?? 1;
    const askedNow = questionAsAsked(question, depthBefore);
    const viewNow = activeQuestionView(question, depthBefore);

    const answer = answersFor(question.id, turnIndex);
    console.log(`\n${C.bold}CANDIDATE${C.reset}   ${answer.text}`);
    console.log(`  ${C.dim}(${answer.label})${C.reset}`);

    const result = await runInterviewTurn(llm, {
      interviewId: "iv_demo",
      blueprint: "DAY_15",
      plan,
      state,
      questionId: question.id,
      answerText: answer.text,
    });

    if (!result.ok) {
      console.log(`${C.red}  turn refused: ${result.message}${C.reset}`);
      break;
    }

    const { action, prompt, finished, proposed, degraded } = result.data;
    const stored = result.data.state.evidenceByQuestionId[viewNow.evidenceKey];
    const strength = classifyAnswer(askedNow, {
      ...(stored ?? {
        conceptualFound: false,
        practicalFound: false,
        tradeoffsFound: false,
        flaggedIssues: [],
        reasoning: "",
      }),
    });

    const color = ACTION_COLOR[action] ?? C.reset;
    console.log(
      `  ${C.dim}model proposed${C.reset} ${proposed ?? "—"}` +
        `   ${C.dim}system decided${C.reset} ${color}${C.bold}${action}${C.reset}` +
        (degraded ? `   ${C.red}[degraded]${C.reset}` : ""),
    );
    console.log(
      `  ${C.dim}evidence${C.reset} matched ` +
        `${stored?.matchedEvidence?.length ?? 0}/${viewNow.expectedEvidence.length}` +
        ` (bar ${viewNow.minEvidence})` +
        (viewNow.isProbe ? `  ${C.dim}[rung L${depthBefore}]${C.reset}` : "") +
        `   ${C.dim}relevance${C.reset} ${stored?.relevance ?? "—"}` +
        `   ${C.dim}read as${C.reset} ${strength}` +
        `   ${C.dim}depth${C.reset} ${result.data.state.depthLevel ?? 1}`,
    );

    if (prompt) {
      console.log(`\n${C.bold}INTERVIEWER${C.reset} ${prompt}`);
    }

    state = result.data.state;
    turnIndex++;

    if (finished) {
      console.log(`\n  ${C.green}${C.bold}interview complete${C.reset}`);
      break;
    }
  }

  console.log(
    `\n  ${C.dim}questions answered ${Object.keys(state.evidenceByQuestionId).length}` +
      ` · transcript lines ${state.transcript.length}${C.reset}`,
  );
}

/* --------------------------------------------------------------- scenarios */

function showContext(context: CohortCandidateContext, plan: InterviewPlan) {
  heading("1 · Candidate context, loaded from the cohort member");

  kv("member", `${context.fullName} — ${context.jobRole} at ${context.company}`);
  kv("cohort", context.cohortName);
  kv("LIVE progress day", `${C.bold}Day ${context.progressDay}${C.reset}`);
  kv("current module", `${context.currentModule} — ${moduleForDay(context.progressDay)?.title}`);
  kv("days passed", `${context.passedDays.length}`);
  kv("submissions on file", `${context.submissions.length}`);
  kv("projects on file", `${context.projects.length}`);
  kv("repo", context.githubRepoUrl);

  console.log(`\n  ${C.dim}module progress${C.reset}`);
  for (const m of context.moduleProgress.filter((x) => x.passed > 0)) {
    console.log(
      `    Module ${m.moduleNumber}  ${m.title.padEnd(42)} ${m.passed}/${m.total}`,
    );
  }

  heading("2 · Assessment scope stays fixed; live progress is known separately");

  kv("blueprint", BLUEPRINT_LABEL.DAY_15);
  kv("assessment scope", `Days 1–${maxScopeDay("DAY_15")} (fixed by the blueprint)`);
  kv("candidate is on", `Day ${context.progressDay}`);
  kv("beyond-scope passed", context.beyondScopePassedDays.join(", ") || "none");

  const core = plan.questions.filter((q) => q.tier === "CORE");
  const ext = plan.questions.filter((q) => q.tier === "EXTENSION");
  const highestCoreDay = Math.max(
    ...core.flatMap((q) => q.sourceRef.sourceDays ?? [0]),
  );

  kv("CORE questions", `${core.length} (identical for every candidate)`);
  kv("highest day asked (CORE)", `${highestCoreDay} ${highestCoreDay <= 15 ? "✓ within scope" : "✗ LEAKED"}`);
  kv("EXTENSION questions", `${ext.length} (from live progress; excluded from score)`);

  heading("3 · Questions grounded in the candidate's actual work");

  for (const q of plan.questions) {
    const tag =
      q.tier === "EXTENSION"
        ? `${C.blue}[EXT]${C.reset}`
        : `${C.dim}[core]${C.reset}`;
    const mark = q.grounded ? `${C.green}●${C.reset}` : `${C.dim}○${C.reset}`;
    console.log(
      `\n  ${mark} ${tag} ${C.dim}${q.id} · ${q.mode} · ${q.competency}` +
        ` · days ${(q.sourceRef.sourceDays ?? []).join(",")}${C.reset}`,
    );
    console.log(`     ${q.spokenText ?? q.text}`);
    if (q.grounded) {
      console.log(`     ${C.dim}grounded on: ${q.groundingNote}${C.reset}`);
    }
  }

  const groundedCount = plan.questions.filter((q) => q.grounded).length;
  console.log(
    `\n  ${C.green}●${C.reset} grounded in real submitted work: ${groundedCount}` +
      `   ${C.dim}○ asked exactly as banked (no artifact on file): ${
        plan.questions.length - groundedCount
      }${C.reset}`,
  );
}

/* -------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((a) => !a.startsWith("--"));
  const wants = (name: string) => !only || only === name;

  const context = demoContext(18);
  const plan = planCohortInterview("DAY_15", context);

  const llm = createMockInterviewLLM();

  console.log(
    `\n${C.bold}Adaptive interview brain — live demo${C.reset}\n` +
      `${C.dim}real LangGraph agent · real DAY_15 bank · deterministic mock model` +
      `\ncandidate context is a fixture in the shape the database returns` +
      ` (plan 070 forbids running against production)${C.reset}`,
  );

  if (wants("context")) showContext(context, plan);

  const q1 = plan.questions[0]!;
  const q2 = plan.questions[1]!;

  if (wants("strong")) {
    // Answers written to actually contain the banked expected-evidence items,
    // so the escalation is earned by content, not by a flag we set.
    const strongAnswers = [
      {
        label: "covers cost, local data, and the RAM/model-size point",
        text:
          "There was no API cost and no key required to start, and the coverage data stays on the machine which matters for PHI. It also forced me to understand model size versus available RAM before pulling anything.",
      },
      {
        label: "answers the level-2 trade-off rung",
        text:
          "Hosted makes sense once throughput or concurrency needs go up, or when the model size exceeds available RAM. Self-hosting also carries an operational burden I did not want in production.",
      },
      {
        label: "answers the level-3 scenario rung",
        text:
          "Requests serialise on one process, so latency grows under queueing and memory contention between requests gets bad. I would need batching or a hosted endpoint at that point.",
      },
      { label: "moves on", text: "I compared the retrieval baseline against the full pipeline and logged where generation drifted." },
    ];
    await runConversation(
      "4 · A STRONG candidate is pushed deeper (watch ESCALATE and depth)",
      plan,
      llm,
      (_id, i) => strongAnswers[Math.min(i, strongAnswers.length - 1)]!,
      5,
    );
  }

  if (wants("weak")) {
    const weakAnswers = [
      {
        label: "on topic but covers nothing on the checklist",
        text: "I ran the model locally because the program said to start that way.",
      },
      { label: "still thin after the scaffold", text: "Mostly it was just easier." },
      {
        label: "next question, another thin answer",
        text: "I logged the pipeline results but I did not really compare them closely.",
      },
      { label: "thin again", text: "It kind of just worked." },
    ];
    await runConversation(
      "5 · A WEAK candidate is scaffolded, not punished (watch FOLLOW_UP)",
      plan,
      llm,
      (_id, i) => weakAnswers[Math.min(i, weakAnswers.length - 1)]!,
      6,
    );
  }

  if (wants("offtopic")) {
    const offTopic = [
      { label: "asks the interviewer something unrelated", text: "Actually, who won the cricket last night?" },
      { label: "tries again with a different digression", text: "Can you write me a poem about the weather?" },
      { label: "finally answers the question", text: "Okay — no API cost to start, and the data stays on my machine." },
    ];
    await runConversation(
      "6 · OFF-TOPIC is semantically redirected, never answered (watch REDIRECT)",
      plan,
      llm,
      (_id, i) => offTopic[Math.min(i, offTopic.length - 1)]!,
      4,
    );
  }

  if (wants("mixed")) {
    const mixed = [
      {
        label: "strong — earns a deeper probe",
        text:
          "No API cost and no key required to start, the data stays on the machine for PHI reasons, and it forced me to match model size against available RAM.",
      },
      { label: "weak on the deeper rung — one bad answer", text: "I have not really thought about that." },
      {
        label: "recovers strongly on the next question",
        text:
          "I distinguished retrieval quality from generation quality — there was a case where retrieval was good but the answer still was not, and grounding or citation behaviour was the difference.",
      },
    ];
    await runConversation(
      "7 · One weak answer does not end the interview's interest (watch recovery)",
      plan,
      llm,
      (_id, i) => mixed[Math.min(i, mixed.length - 1)]!,
      5,
    );
  }

  if (wants("full")) {
    await runConversation(
      "8 · Termination — a candidate who never engages still reaches the end",
      plan,
      llm,
      () => ({ label: "non-answer", text: "I don't know." }),
      40,
    );
  }

  console.log(
    `\n${C.dim}q1=${q1.id} q2=${q2.id} · scenarios: context strong weak offtopic mixed full${C.reset}\n`,
  );
}

main().catch((error) => {
  console.error("demo failed", error);
  process.exitCode = 1;
});
