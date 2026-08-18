"use server";

import { revalidatePath } from "next/cache";
import { getInterviewProvider } from "@/features/interview/prisma-provider";
import { resolveInterviewMemberId } from "@/features/interview/provider";
import type {
  AnswerTurnData,
  FinishInterviewData,
  StartInterviewData,
} from "@/features/interview/service";
import {
  interviewIdSchema,
  startInterviewSchema,
  submitInterviewAnswerSchema,
} from "@/lib/validations/interview";

/**
 * Server Actions for the AI Cohort milestone interview.
 *
 * Every action resolves the member server-side and passes only ids downward. The
 * interview plan, runtime state, eligibility and scores never cross this
 * boundary inbound, so a tampered client payload cannot alter question order,
 * evidence, scores, or whether a milestone is claimable.
 *
 * The complete set of things a client may send:
 *   - a blueprint enum value (validated against the enum, then re-gated)
 *   - an interview id (scoped to the member in the WHERE clause)
 *   - a question id (checked against the question the server has open)
 *   - answer text
 */

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function requireMemberId(): Promise<
  { ok: true; memberId: string } | { ok: false; message: string }
> {
  const memberId = await resolveInterviewMemberId();
  if (!memberId) {
    return {
      ok: false,
      message: "You need an active cohort enrollment to interview.",
    };
  }
  return { ok: true, memberId };
}

/**
 * Opens or resumes an attempt and returns the first question.
 *
 * The blueprint is validated as an enum here and independently re-gated inside
 * the service against actual passed mission days. Passing `DAY_31` from a
 * browser console does not open a Day 31 interview.
 */
export async function startInterviewAction(
  input: unknown,
): Promise<ActionResult<StartInterviewData>> {
  const auth = await requireMemberId();
  if (!auth.ok) return auth;

  const parsed = startInterviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Unknown interview." };

  const started = await getInterviewProvider().start(
    auth.memberId,
    parsed.data.blueprint,
  );

  revalidatePath("/program/dashboard");
  return started;
}

/** Submits one answer and returns the next prompt. */
export async function submitInterviewAnswerAction(
  input: unknown,
): Promise<ActionResult<AnswerTurnData>> {
  const auth = await requireMemberId();
  if (!auth.ok) return auth;

  const parsed = submitInterviewAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid answer submission." };
  }

  return getInterviewProvider().answer(
    auth.memberId,
    parsed.data.interviewId,
    parsed.data.questionId,
    parsed.data.answerText,
  );
}

/**
 * Scores and commits the attempt. Duration is derived server-side from the
 * persisted start time, so it is not a client input.
 */
export async function finishInterviewAction(
  input: unknown,
): Promise<ActionResult<FinishInterviewData>> {
  const auth = await requireMemberId();
  if (!auth.ok) return auth;

  const parsed = interviewIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const finished = await getInterviewProvider().finish(
    auth.memberId,
    parsed.data.interviewId,
  );

  revalidatePath("/program/dashboard");
  return finished;
}

/** Abandons an in-progress attempt. Consumes no milestone. */
export async function abandonInterviewAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const auth = await requireMemberId();
  if (!auth.ok) return auth;

  const parsed = interviewIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const result = await getInterviewProvider().abandon(
    auth.memberId,
    parsed.data.interviewId,
  );

  revalidatePath("/program/dashboard");
  return result;
}
