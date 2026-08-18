import "server-only";
import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";
import {
  BLUEPRINT_LABEL,
  type InterviewBlueprintKey,
} from "@/features/interview/cohort/blueprint";
import { planCohortInterview } from "@/features/interview/cohort/planner";
import {
  MAX_REDIRECTS_PER_QUESTION,
  MAX_REPEATS_PER_QUESTION,
} from "@/features/interview/constants";
import { resolveInterviewLLM } from "@/features/interview/agent/llm/registry";
import { runInterviewTurn } from "@/features/interview/agent/graph";
import {
  createInitialState,
  followUpBudgetFor,
  getCurrentQuestion,
  startInterview,
} from "@/features/interview/state";
import type {
  InterviewPlan,
  InterviewState,
  PlannedQuestion,
} from "@/features/interview/types";
import type { AgentAction } from "@/features/interview/agent/types";

/**
 * Session backing for the DEVELOPER demo at `/dev/interview-agent`.
 *
 * Deliberately separate from `service.ts`. The real cohort flow is owned by a
 * `ProgramMember`, gated on actual passed days, persisted, and claimable once —
 * none of which belongs in a demo, and all of which would make a demo dangerous
 * if it shared the same tables. So this keeps its sessions in process memory and
 * touches no database at all.
 *
 * What it does NOT change: the plan comes from the real cohort planner, the
 * questions from the real bank, and every turn goes through the real compiled
 * LangGraph agent under the real policy. The demo swaps the storage, never the
 * brain.
 *
 * In-memory means sessions vanish on reload or restart. That is fine here — the
 * UI has a Reset button, and a lost demo session costs nothing.
 */

type DemoSession = {
  plan: InterviewPlan;
  state: InterviewState;
  blueprint: InterviewBlueprintKey;
  questionId: string;
};

const sessions = new Map<string, DemoSession>();

/** Bounded so a long-running dev server cannot accumulate sessions forever. */
const MAX_SESSIONS = 50;

export type DemoDebug = {
  /** What the interview DID. */
  action: AgentAction | null;
  /** What the model ASKED for. Differs whenever policy overrode it. */
  proposed: string | null;
  questionId: string;
  followUps: string;
  redirects: string;
  repeats: string;
  status: string;
  /** Node names LangGraph actually executed, in order. */
  trace: string[];
  degraded: boolean;
  evidenceCount: number;
  provider: string;
};

export type DemoPreset = { label: string; text: string; note: string };

/**
 * Sample answers for the question CURRENTLY on the floor.
 *
 * Built per turn, not fixed, because a fixed "strong answer" stops being strong
 * the moment the interview advances: an excellent answer about running Ollama is
 * off-topic once the question is about chunk overlap, and the agent correctly
 * redirects it. That looked like a misfire in the demo when it was actually the
 * harness feeding the wrong answer.
 *
 * The strong sample is composed from the bank's own `expectedEvidence`, so it is
 * on-topic by construction for whatever question is open.
 *
 * This is DEV-ONLY. `expectedEvidence` is deliberately withheld from candidates
 * in `service.ts` — reciting the checklist back would defeat the assessment — so
 * these strings are built on the server for the demo and never leak into the
 * real interview surface.
 */
function presetsFor(question: PlannedQuestion | null): DemoPreset[] {
  const expected = question?.expectedEvidence ?? [];

  const strong =
    expected.length > 0
      ? `${expected
          .slice(0, 3)
          .map((item) => item.replace(/\.$/, ""))
          .join(". ")}. I worked through that myself while building it and checked the output against what I expected.`
      : "I built that part myself and can walk you through exactly what I changed and why.";

  const weak =
    expected.length > 0
      ? `Something to do with ${expected[0]!.toLowerCase().replace(/\.$/, "")}, I think. I didn't really go deeper than that.`
      : "It worked better that way, I think.";

  return [
    { label: "Strong answer", note: "expect NEXT_QUESTION", text: strong },
    {
      label: "Weak answer",
      note: "expect FOLLOW_UP where the question has budget",
      text: weak,
    },
    {
      label: "Off-topic",
      note: "expect REDIRECT, and no answer to the question",
      text: "Who is the Prime Minister of India?",
    },
    {
      label: "Repeat request",
      note: "expect REPEAT",
      text: "Sorry, could you repeat the question?",
    },
    {
      label: "Stuck",
      note: "expect NEXT_QUESTION, never a probe",
      text: "I don't know.",
    },
  ];
}

export type DemoView = {
  sessionId: string;
  blueprintLabel: string;
  question: { id: string; order: number; text: string; total: number } | null;
  transcript: { role: "interviewer" | "candidate"; text: string }[];
  debug: DemoDebug;
  /** Sample answers matched to the question now on the floor. */
  presets: DemoPreset[];
  finished: boolean;
};

function buildView(
  sessionId: string,
  session: DemoSession,
  over: Partial<DemoDebug> = {},
): DemoView {
  const question = getCurrentQuestion(session.plan, session.state);
  const budget = followUpBudgetFor(question);

  return {
    sessionId,
    blueprintLabel: BLUEPRINT_LABEL[session.blueprint],
    question: question
      ? {
          id: question.id,
          order: question.order,
          text: question.text,
          total: session.plan.questions.length,
        }
      : null,
    transcript: session.state.transcript.map((line) => ({
      role: line.role,
      text: line.text,
    })),
    debug: {
      action: null,
      proposed: null,
      questionId: question?.id ?? "—",
      followUps: `${session.state.followUpsAsked}/${budget}`,
      redirects: `${session.state.redirectsAsked ?? 0}/${MAX_REDIRECTS_PER_QUESTION}`,
      repeats: `${session.state.repeatsAsked ?? 0}/${MAX_REPEATS_PER_QUESTION}`,
      status: session.state.status,
      trace: [],
      degraded: false,
      evidenceCount: Object.keys(session.state.evidenceByQuestionId).length,
      provider: resolveInterviewLLM().name,
      ...over,
    },
    presets: presetsFor(question),
    finished: session.state.status === "COMPLETED",
  };
}

/** Opens a fresh demo interview and puts the first question on the floor. */
export function startDemoSession(blueprint: InterviewBlueprintKey): DemoView {
  if (sessions.size >= MAX_SESSIONS) sessions.clear();

  const plan = planCohortInterview(blueprint);
  const first = plan.questions[0]!;

  const state: InterviewState = {
    ...startInterview(createInitialState()),
    transcript: [
      {
        role: "interviewer",
        text: first.text,
        questionId: first.id,
        ts: Date.now(),
      },
    ],
  };

  const sessionId = randomUUID();
  const session: DemoSession = {
    plan,
    state,
    blueprint,
    questionId: first.id,
  };
  sessions.set(sessionId, session);

  logger.info("[interview-agent-demo] session opened", {
    sessionId,
    blueprint,
    provider: resolveInterviewLLM().name,
  });

  return buildView(sessionId, session);
}

export type DemoResult =
  | { ok: true; data: DemoView }
  | { ok: false; message: string };

/**
 * Runs one answer through the real graph and returns the new view.
 *
 * The client sends a session id and a string. It cannot send the plan, the
 * state, the question index, an action, or a score — the same posture as the
 * production service, for the same reason: what the UI renders must be a
 * consequence of the graph, never an instruction to it.
 */
export async function answerDemoSession(
  sessionId: string,
  answerText: string,
): Promise<DemoResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: "Demo session expired — press Reset." };
  }

  const turn = await runInterviewTurn(resolveInterviewLLM(), {
    interviewId: `demo_${sessionId.slice(0, 8)}`,
    blueprint: session.blueprint,
    plan: session.plan,
    state: session.state,
    questionId: session.questionId,
    answerText,
  });

  if (!turn.ok) return { ok: false, message: turn.message };

  session.state = turn.data.state;
  session.questionId = turn.data.questionId ?? session.questionId;

  return {
    ok: true,
    data: buildView(sessionId, session, {
      action: turn.data.action,
      proposed: turn.data.proposed,
      trace: turn.data.trace,
      degraded: turn.data.degraded,
    }),
  };
}

export function resetDemoSession(sessionId: string): void {
  sessions.delete(sessionId);
}
