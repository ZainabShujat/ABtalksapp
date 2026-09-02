import "server-only";
import { logger } from "@/lib/logger";
import { runInterviewTurn } from "@/features/interview/agent";
import type { AgentAction } from "@/features/interview/agent";
import { resolveInterviewLLM } from "@/features/interview/agent/llm/registry";
import { askForReport } from "@/features/interview/report-provider";
import {
  appendLine,
  createInitialState,
  getCurrentQuestion,
  startInterview,
} from "@/features/interview/state";
import {
  getDomain,
  getStartableDomain,
  listDomains,
  toDomainSummary,
} from "@/features/interview/platform/domains";
import {
  buildPlatformPlan,
  platformContextOf,
  platformOpeningLine,
} from "@/features/interview/platform/planner";
import {
  buildAssessmentReport,
  parseAssessmentReport,
} from "@/features/interview/platform/report";
import { competencyScoresFor } from "@/features/interview/platform/report-assembly";
import type { AssessmentReportDocument } from "@/features/interview/platform/report-assembly";
import {
  platformProgress,
  type PlatformProgress,
} from "@/features/interview/platform/scoring";
import {
  resolvePlatformCandidate,
} from "@/features/interview/platform/provider";
import * as repo from "@/features/interview/platform/repository";
import { selectNextPlatformTarget } from "@/features/interview/platform/target-planner";
import { buildCandidateContext } from "@/features/interview/candidate-context";
import { formatProfileContext } from "@/features/interview/platform/profile-context";
import type { DomainSummary, TurnSubmission } from "@/features/interview/platform/types";
import type { PlannedQuestion } from "@/features/interview/types";

/**
 * The interview platform's flows: start → (answer)* → finish, plus abandon.
 *
 * THE SECURITY POSTURE, stated once:
 *
 *   - `userId` is always passed in by the action, which resolved it from the
 *     session. Nothing here reads a session itself and nothing accepts a user id
 *     from a payload.
 *   - the domain is re-resolved from the code registry on every call; a slug is
 *     client input and is never trusted beyond being a lookup key
 *   - plan and state are reloaded from the row on every turn
 *   - duration is computed from the persisted `startedAt`
 *   - an answer must match the question the SERVER believes is open — enforced
 *     inside the graph's `receiveAnswer` node
 *
 * The only thing a client contributes to an interview is the text of an answer.
 */

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/**
 * How long an abandoned tab blocks a user before it is swept.
 *
 * Shorter than the cohort's hour: there is no milestone at stake here, so the
 * cost of sweeping early is that someone loses a practice attempt they had
 * already walked away from, while the cost of sweeping late is that the
 * one-open-attempt rule locks them out of the whole catalogue.
 */
const STALE_ATTEMPT_MS = 30 * 60 * 1000;

/**
 * Minimum answered questions before an attempt can be scored.
 *
 * THE NUMBER IS ABOUT THE REPORT'S HONESTY, NOT ABOUT EFFORT. A competency
 * score is an average over the questions that assessed it, and the rubric is
 * re-weighted to whatever was actually assessed (see
 * `overallFromPlatformCompetencies`). Both of those are correct behaviours, and
 * together they have a failure mode at the low end: one answer produces a
 * confident-looking competency breakdown and an overall figure derived from a
 * single response. The number would be arithmetically sound and completely
 * misleading.
 *
 * Three is the floor because it is the point at which the re-weighting has
 * something to average and a reader can see a pattern rather than an incident.
 *
 * A candidate may still leave before this — they simply get no report. The
 * attempt closes INVALID, consumes nothing (retakes are unlimited anyway), and
 * they are told plainly why. That is a better outcome than handing someone a
 * scored assessment of their abilities based on one answer.
 *
 * Matches the cohort's `COHORT_INTERVIEW_MIN_ANSWERED_CORE`, though for a
 * different reason: there it also protects a once-per-lifetime credential from
 * being burned by a thin session.
 */
export const MIN_ANSWERED_TO_SCORE = 3;

/**
 * How much time a NEW assessment target needs to be worth opening.
 *
 * A new question has to be spoken (several seconds of audio), understood,
 * answered, and then judged. Below roughly a minute none of that fits, so
 * asking is worse than not asking: the candidate is cut off mid-answer, the
 * question is recorded as reached, and the evidence is thinner than if it had
 * never been put.
 *
 * This is enforced in code rather than asked of the model. The prompt is told
 * to wind down too, but an instruction is a suggestion — a candidate should not
 * be handed a fresh question with eleven seconds left because a model felt
 * optimistic.
 */
const WIND_DOWN_SEC = 60;

/**
 * What the client is allowed to see about a question.
 *
 * Deliberately excludes `expectedEvidence`, `minEvidence`, `deepProbes`,
 * `scaffoldProbes` and the rubric — revealing what the evaluator looks for
 * would let candidates recite the checklist back.
 */
export type ClientQuestion = {
  id: string;
  order: number;
  text: string;
  totalQuestions: number;
};

function toClientQuestion(
  question: PlannedQuestion,
  totalQuestions: number,
): ClientQuestion {
  return {
    id: question.id,
    order: question.order,
    // The spoken form when one exists. Platform packs set no `spokenText`, so
    // this is the authored question — which is exactly what was intended.
    text: question.spokenText ?? question.text,
    totalQuestions,
  };
}

/* ---------------------------------------------------------------- catalogue */

export type CatalogueEntry = DomainSummary & {
  /** The user's completed attempts at this domain. */
  completedAttempts: number;
};

/**
 * The catalogue. Read-only, so a Server Component calls it directly.
 *
 * Every domain is listed, including COMING_SOON ones — the roadmap is part of
 * what the page is for. `getStartableDomain` is what gates actually opening one.
 */
export async function getCatalogue(
  userId: string,
): Promise<ServiceResult<CatalogueEntry[]>> {
  const attempts = await repo.listAttempts(userId, 200);
  const completedByDomain = new Map<string, number>();
  for (const a of attempts) {
    if (a.status !== "COMPLETED") continue;
    completedByDomain.set(a.domainSlug, (completedByDomain.get(a.domainSlug) ?? 0) + 1);
  }

  return {
    ok: true,
    data: listDomains().map((domain) => ({
      ...toDomainSummary(domain),
      completedAttempts: completedByDomain.get(domain.slug) ?? 0,
    })),
  };
}

export type HistoryEntry = repo.AttemptSummary & {
  domainLabel: string;
};

/** The user's own attempt history. Scoped at the query level. */
export async function getHistory(
  userId: string,
): Promise<ServiceResult<HistoryEntry[]>> {
  const attempts = await repo.listAttempts(userId);
  return {
    ok: true,
    data: attempts.map((a) => ({
      ...a,
      domainLabel: getDomain(a.domainSlug)?.label ?? a.domainSlug,
    })),
  };
}

/* -------------------------------------------------------------------- start */

export type StartAttemptData = {
  attemptId: string;
  domainSlug: string;
  domainLabel: string;
  attemptNumber: number;
  question: ClientQuestion;
  /** The full opening line plus the first question, as the server composed it. */
  prompt: string;
  durationSec: number;
  capabilities: string[];
};

/**
 * Opens an attempt.
 *
 * Order of operations is load-bearing:
 *   1. sweep stale attempts, so a closed tab does not lock the user out
 *   2. resolve the domain from the REGISTRY — a slug alone starts nothing
 *   3. close any open attempt (see below)
 *   4. compute the attempt number, build the plan, create the row
 *
 * ON STEP 3: an open attempt is ABANDONED rather than resumed, matching the
 * cohort. The reasoning differs though. For the cohort it is an integrity rule —
 * you must not hear the questions, leave, prepare and return. Here it is simply
 * that a half-finished practice run is not worth resuming, retakes are free, and
 * one open attempt at a time is what keeps a single user from consuming the
 * shared model rate limit several times over.
 */
export async function startAttempt(
  userId: string,
  domainSlug: string,
): Promise<ServiceResult<StartAttemptData>> {
  await repo.abandonStaleAttempts(userId, STALE_ATTEMPT_MS);

  // THE GATE. A COMING_SOON or unknown domain resolves to null here, so a
  // hand-crafted request cannot start an interview the catalogue does not offer.
  const domain = getStartableDomain(domainSlug);
  if (!domain || !domain.packRef) {
    return { ok: false, message: "That interview is not available yet." };
  }

  if (domain.maxAttempts !== null) {
    const completed = await repo.countCompletedAttempts(userId, domain.slug);
    if (completed >= domain.maxAttempts) {
      return {
        ok: false,
        message: `You have used all ${domain.maxAttempts} attempts at this interview.`,
      };
    }
  }

  const open = await repo.findAnyActiveAttempt(userId);
  if (open) {
    await repo.closeAttemptWithoutScoring(
      open.id,
      userId,
      "ABANDONED",
      "Superseded by a new attempt.",
    );
    logger.info("[mock-interview] previous open attempt abandoned", {
      attemptId: open.id,
      userId,
      domainSlug: open.domainSlug,
    });
  }

  // Reuses the EXISTING candidate-context builder (plan 066) rather than a
  // second profile system: it already composes StudentProfile + challenge
  // submissions + resume fields, and it is keyed on userId, which is exactly
  // what the platform has. Failure is not fatal — a missing profile produces a
  // perfectly good interview with a generic opening, which is the common case
  // for a new account.
  const [candidate, attemptNumber, profile] = await Promise.all([
    resolvePlatformCandidate(userId),
    repo.nextAttemptNumber(userId, domain.slug),
    buildCandidateContext(userId).catch(() => null),
  ]);
  const profileContext = formatProfileContext(profile);

  // Everything below is server-derived. The client contributed only the slug.
  const plan = buildPlatformPlan(domain, {
    candidateFirstName: candidate.firstName,
    profileContext: profileContext || null,
  });
  const context = platformContextOf(plan);
  if (!context) {
    return { ok: false, message: "Could not prepare this interview." };
  }

  const first = plan.questions[0];
  if (!first) {
    return { ok: false, message: "This interview has no questions." };
  }

  const opening = platformOpeningLine({
    domain,
    firstName: candidate.firstName,
    hasProfile: profileContext.length > 0,
    // Seeded per attempt so no two open with the same sentence, and so two
    // users starting in the same second still differ.
    seed: `${userId}:${domain.slug}:${attemptNumber}:${Date.now()}`,
  });
  const prompt = `${opening}\n\n${first.text}`;

  const state = appendLine(
    {
      ...startInterview(createInitialState()),
      // The opening question counts as asked. Without this the planner would
      // see it as an unassessed target and could route straight back to the one
      // question we know for certain has already been put.
      askedQuestionIds: [first.id],
    },
    "interviewer",
    prompt,
    first.id,
  );

  const attempt = await repo.createAttempt({
    userId,
    domainSlug: domain.slug,
    packId: context.packId,
    packVersion: context.packVersion,
    attemptNumber,
    capabilities: context.capabilities,
    plan,
    state,
  });

  logger.info("[mock-interview] attempt opened", {
    attemptId: attempt.id,
    userId,
    domainSlug: domain.slug,
    attemptNumber,
    packVersion: context.packVersion,
    grounded: profileContext.length > 0,
  });

  return {
    ok: true,
    data: {
      attemptId: attempt.id,
      domainSlug: domain.slug,
      domainLabel: domain.label,
      attemptNumber,
      question: toClientQuestion(first, plan.questions.length),
      prompt,
      durationSec: domain.durationSec,
      capabilities: context.capabilities,
    },
  };
}

/* ------------------------------------------------------------------- answer */

export type AnswerTurnData = {
  /** True whenever the same question stays open — follow-up, redirect, repeat. */
  isFollowUp: boolean;
  action: AgentAction;
  prompt: string | null;
  question: ClientQuestion | null;
  finished: boolean;
  progress: PlatformProgress;
};

/**
 * Processes one answer.
 *
 * Plan and state are reloaded from the row, so a tampered payload cannot change
 * question order, evidence, budgets, or which question is open. The graph
 * rejects an answer whose `questionId` does not match the open question, which
 * makes a replayed or stale turn a no-op rather than a double-scored answer.
 *
 * The engine is used AS IS: `runInterviewTurn` from `agent/index.ts`. The
 * platform does not go through `orchestrator.ts:submitAnswer`, which composes
 * cohort openings and resolves a blueprint — everything that function adds is
 * either cohort-specific or already done here.
 */
export async function recordAnswer(
  userId: string,
  attemptId: string,
  questionId: string,
  submission: TurnSubmission,
): Promise<ServiceResult<AnswerTurnData>> {
  const attempt = await repo.loadActiveAttempt(attemptId, userId);
  if (!attempt) {
    return { ok: false, message: "This interview is no longer in progress." };
  }

  const context = platformContextOf(attempt.plan);
  if (!context) {
    return { ok: false, message: "This interview is not readable." };
  }

  const domain = getDomain(attempt.domainSlug);
  const startedMs = Date.now();

  // Remaining time, from the PERSISTED start. Computed once and used for both
  // the model's pacing hint and the wind-down guard below, so the two can never
  // disagree about how long is left.
  const remainingSec =
    attempt.startedAt && domain
      ? Math.max(
          0,
          Math.round(
            (domain.durationSec * 1000 -
              (Date.now() - attempt.startedAt.getTime())) /
              1000,
          ),
        )
      : null;

  /**
   * The planner, with a clock in front of it.
   *
   * Returning `questionId: null` is how a selector says "there is nothing left
   * to ask", which `advanceTurn` turns into END_INTERVIEW. Out of time is
   * exactly that situation, so the wind-down needs no new mechanism — it is the
   * Phase B seam used for its second obvious purpose.
   */
  const targetSelector: typeof selectNextPlatformTarget = (p, st, answer) => {
    if (remainingSec !== null && remainingSec < WIND_DOWN_SEC) {
      return {
        questionId: null,
        index: p.questions.length,
        reason: `Only ${remainingSec}s left; not opening a new target.`,
        raised: [],
        considered: [],
      };
    }
    return selectNextPlatformTarget(p, st, answer);
  };

  // Started before the model call and awaited after it: the next turn index
  // depends only on the attempt, never on the answer, so waiting for the model
  // first would add a round trip to the gap the candidate hears as silence.
  const turnIndexPromise = repo.nextTurnIndex(attemptId, userId);

  const llmStartedMs = Date.now();
  const turn = await runInterviewTurn(resolveInterviewLLM(), {
    interviewId: attemptId,
    // The domain slug, not a fake blueprint. Nothing in the graph reads it;
    // it is honest provenance rather than a cohort value that is not true.
    blueprint: attempt.domainSlug,
    // Minutes left from the PERSISTED start time. Taking it from the client
    // would let a candidate claim they had all day.
    minutesLeft: remainingSec === null ? null : Math.round(remainingSec / 60),
    plan: attempt.plan,
    state: attempt.state,
    questionId,
    answerText: submission.text,
    // ADAPTIVE TARGET SELECTION, wrapped in the wind-down guard. The cohort
    // passes none and keeps authored order.
    targetSelector,
  });

  if (!turn.ok) return turn;
  const llmMs = Date.now() - llmStartedMs;

  const asked = attempt.plan.questions.find((q) => q.id === questionId);
  const depthLevel = attempt.state.depthLevel ?? 1;

  const record: repo.TurnRecord = {
    turnIndex: await turnIndexPromise,
    questionId,
    sectionId: asked?.sectionId ?? "",
    depthLevel,
    action: turn.data.action,
    promptText: turn.data.prompt ?? "",
    answerText: submission.text,
    // REDIRECT and REPEAT record no evidence by design; storing null makes that
    // explicit in the trail rather than leaving it to be inferred.
    evidence:
      turn.data.action === "REDIRECT" || turn.data.action === "REPEAT"
        ? null
        : (turn.data.state.evidenceByQuestionId[
            depthLevel > 1 ? `${questionId}@L${depthLevel}` : questionId
          ] ?? null),
    degraded: turn.data.degraded,
    latencyMs: Date.now() - startedMs,
    // Seams 3 and 6. Undefined in Phase 1: no workspace produces artifacts and
    // no client events are collected yet.
    artifacts: submission.artifacts?.length ? submission.artifacts : undefined,
  };

  const persistStartedMs = Date.now();
  await repo.saveTurn(attemptId, userId, turn.data.state, record);

  logger.info("[mock-interview] turn latency", {
    attemptId,
    action: turn.data.action,
    llmMs,
    persistMs: Date.now() - persistStartedMs,
    serverMs: Date.now() - startedMs,
  });

  const nextQuestion = turn.data.questionId
    ? (attempt.plan.questions.find((q) => q.id === turn.data.questionId) ?? null)
    : null;

  return {
    ok: true,
    data: {
      isFollowUp:
        turn.data.action === "FOLLOW_UP" ||
        turn.data.action === "REDIRECT" ||
        turn.data.action === "REPEAT",
      action: turn.data.action,
      prompt: turn.data.prompt,
      question: nextQuestion
        ? toClientQuestion(nextQuestion, attempt.plan.questions.length)
        : null,
      finished: turn.data.finished,
      progress: platformProgress(attempt.plan, turn.data.state),
    },
  };
}

/* ------------------------------------------------------------------- finish */

export type FinishAttemptData = {
  attemptId: string;
  domainSlug: string;
  attemptNumber: number;
  overallScore: number;
  durationSec: number;
  reportReady: boolean;
};

/**
 * Scores the attempt and stores its report.
 *
 * IDEMPOTENCE. `completeAttempt` guards on `status: "IN_PROGRESS"` via
 * `updateMany`, so a second finish updates zero rows and cannot recompute or
 * corrupt a completed attempt. This function detects that case BEFORE doing any
 * work — a duplicate request returns the stored result rather than paying for a
 * second narrative call and overwriting the report the candidate already read.
 *
 * Duration comes from the persisted `startedAt`, never from the client.
 */
export async function finishAttempt(
  userId: string,
  attemptId: string,
): Promise<ServiceResult<FinishAttemptData>> {
  const attempt = await repo.loadActiveAttempt(attemptId, userId);

  if (!attempt) {
    // Either it was never theirs, or it is already finished. A stored report
    // means the latter, so a duplicate finish is answered rather than refused.
    const existing = await repo.loadReport(attemptId, userId);
    if (existing) {
      const parsed = parseAssessmentReport(existing.report);
      return {
        ok: true,
        data: {
          attemptId,
          domainSlug: existing.domainSlug,
          attemptNumber: existing.attemptNumber,
          overallScore: parsed.ok ? parsed.data.overall.score : 0,
          durationSec: parsed.ok ? parsed.data.overall.durationSec : 0,
          reportReady: parsed.ok,
        },
      };
    }
    return { ok: false, message: "This interview is no longer in progress." };
  }

  const context = platformContextOf(attempt.plan);
  if (!context) {
    return { ok: false, message: "This interview is not readable." };
  }

  const durationSec = attempt.startedAt
    ? Math.round((Date.now() - attempt.startedAt.getTime()) / 1000)
    : 0;

  // Counted in ANSWERED QUESTIONS, not turns and not evidence keys. Deep-probe
  // evidence is filed under `${id}@L2`, so counting keys would let a single
  // question that escalated twice clear a three-question bar on its own.
  const answered = attempt.plan.questions.filter(
    (q) => attempt.state.evidenceByQuestionId[q.id] !== undefined,
  ).length;

  if (answered < MIN_ANSWERED_TO_SCORE) {
    await repo.closeAttemptWithoutScoring(
      attemptId,
      userId,
      "INVALID",
      `Ended after ${answered} of the ${MIN_ANSWERED_TO_SCORE} answers needed to score.`,
    );
    logger.info("[mock-interview] attempt closed without scoring", {
      attemptId,
      userId,
      answered,
      required: MIN_ANSWERED_TO_SCORE,
    });
    return {
      ok: false,
      message:
        `A report needs at least ${MIN_ANSWERED_TO_SCORE} answered questions — ` +
        `you answered ${answered}. Nothing has been counted against you, so you ` +
        `can start this interview again whenever you like.`,
    };
  }

  const finalState = { ...attempt.state, status: "COMPLETED" as const };
  const candidate = await resolvePlatformCandidate(userId);
  const turns = await repo.loadTurns(attemptId, userId);

  const report = await buildAssessmentReport(askForReport, {
    plan: attempt.plan,
    context,
    state: finalState,
    candidate: { name: candidate.fullName },
    attemptNumber: attempt.attemptNumber,
    durationSec,
    // `report-analysis.ts:TurnRow` requires a `tier`. Every platform question is
    // CORE — there is no extension tier off a milestone here — so this is a
    // constant rather than a field the platform needs to persist.
    turns: turns.map((t) => ({ ...t, tier: "CORE" })),
  });

  // VALIDATE BEFORE PERSISTING. This is the boundary that closes the obligation
  // Phase 2 left open: `repository.saveReport` takes an already-validated
  // document, and this is where it becomes one. A document that cannot be
  // parsed back is one that would render as "unavailable" later, and it is far
  // cheaper to refuse it here than to discover it on the candidate's screen.
  const validated = parseAssessmentReport(report);
  if (!validated.ok) {
    logger.error("[mock-interview] generated report failed validation", {
      attemptId,
      message: validated.message,
    });
    await repo.closeAttemptWithoutScoring(
      attemptId,
      userId,
      "INVALID",
      "Report failed validation.",
    );
    return { ok: false, message: "Could not produce a report for this attempt." };
  }

  const committed = await repo.completeAttempt(attemptId, userId, {
    state: finalState,
    competencyScores: competencyScoresFor(report),
    overallScore: report.overall.score,
    summary: report.summary,
    durationSec,
  });

  if (!committed.ok) return { ok: false, message: committed.message };

  // Storing the report is deliberately NOT fatal. The attempt is complete and
  // scored either way; a failed write is something to retry, not a reason to
  // tell someone their interview did not count.
  const stored = await repo.saveReport(attemptId, userId, {
    version: report.version,
    overallScore: report.overall.score,
    report,
    narrativeDegraded: report.narrativeDegraded,
  });
  if (!stored.ok) {
    logger.error("[mock-interview] report not stored", {
      attemptId,
      message: stored.message,
    });
  }

  logger.info("[mock-interview] attempt completed", {
    attemptId,
    userId,
    domainSlug: attempt.domainSlug,
    attemptNumber: attempt.attemptNumber,
    overallScore: report.overall.score,
  });

  return {
    ok: true,
    data: {
      attemptId,
      domainSlug: attempt.domainSlug,
      attemptNumber: attempt.attemptNumber,
      overallScore: report.overall.score,
      durationSec,
      reportReady: stored.ok,
    },
  };
}

/* ------------------------------------------------------------------ abandon */

/**
 * Abandons an in-progress attempt.
 *
 * Marks the row ABANDONED and keeps the transcript, evidence and every turn for
 * audit. Nothing is deleted: a practice attempt someone walked away from is
 * still a record of what happened, and destroying it would also destroy the
 * only evidence available if they later report a bug in it.
 */
export async function abandonAttempt(
  userId: string,
  attemptId: string,
): Promise<ServiceResult<null>> {
  const attempt = await repo.loadActiveAttempt(attemptId, userId);
  if (!attempt) return { ok: false, message: "No interview in progress." };

  await repo.closeAttemptWithoutScoring(attemptId, userId, "ABANDONED", null);
  logger.info("[mock-interview] attempt abandoned", { attemptId, userId });
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------- report */

export type LoadedAssessmentReport = {
  report: AssessmentReportDocument;
  domainSlug: string;
  domainLabel: string;
  attemptNumber: number;
  generatedAt: Date;
  narrativeDegraded: boolean;
};

/**
 * The stored report for one attempt.
 *
 * User-scoped at the query level, so an attempt id belonging to someone else
 * resolves to null rather than to their report. Nothing is regenerated here — a
 * report records an assessment that happened, and re-running the narrative on
 * every page view would let one attempt say different things on different days.
 *
 * Validated on READ as well as on write: this column outlives any single deploy,
 * so a row written against an older shape degrades to "unavailable" rather than
 * crashing the page rendering it.
 */
export async function getAttemptReport(
  userId: string,
  attemptId: string,
): Promise<ServiceResult<LoadedAssessmentReport>> {
  const row = await repo.loadReport(attemptId, userId);
  if (!row) {
    return { ok: false, message: "No report is available for this interview." };
  }

  const parsed = parseAssessmentReport(row.report);
  if (!parsed.ok) {
    logger.error("[mock-interview] stored report failed validation on read", {
      attemptId,
      message: parsed.message,
    });
    return { ok: false, message: "No report is available for this interview." };
  }

  return {
    ok: true,
    data: {
      report: parsed.data,
      domainSlug: row.domainSlug,
      domainLabel: getDomain(row.domainSlug)?.label ?? row.domainSlug,
      attemptNumber: row.attemptNumber,
      generatedAt: row.generatedAt,
      narrativeDegraded: row.narrativeDegraded,
    },
  };
}

/** The question the SERVER has on the floor. Used to resume a live room. */
export async function getOpenQuestion(
  userId: string,
  attemptId: string,
): Promise<ServiceResult<ClientQuestion>> {
  const attempt = await repo.loadActiveAttempt(attemptId, userId);
  if (!attempt) {
    return { ok: false, message: "This interview is no longer in progress." };
  }
  const question = getCurrentQuestion(attempt.plan, attempt.state);
  if (!question) {
    return { ok: false, message: "This interview has no question open." };
  }
  return {
    ok: true,
    data: toClientQuestion(question, attempt.plan.questions.length),
  };
}
