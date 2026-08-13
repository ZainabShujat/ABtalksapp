"use server";

import { revalidatePath } from "next/cache";
import {
  getInterviewProvider,
  resolveCandidateId,
  type AnswerTurnData,
  type FinishInterviewData,
  type StartInterviewData,
} from "@/features/interview/provider";
import {
  interviewIdSchema,
  submitInterviewAnswerSchema,
} from "@/lib/validations/interview";

/**
 * Server Actions for the General AB Talks AI Interview.
 *
 * Every action resolves the candidate server-side and passes only ids down. The
 * interview plan, runtime state, and submission entitlement never cross this
 * boundary, so a tampered client payload cannot alter question order, evidence,
 * scores, or what an attempt costs.
 */

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function requireCandidateId(): Promise<
  { ok: true; candidateId: string } | { ok: false; message: string }
> {
  const candidateId = await resolveCandidateId();
  if (!candidateId) {
    return { ok: false, message: "Please sign in to continue." };
  }
  return { ok: true, candidateId };
}

/** Opens an attempt and returns the first question. */
export async function startInterviewAction(): Promise<
  ActionResult<StartInterviewData>
> {
  const auth = await requireCandidateId();
  if (!auth.ok) return auth;

  const provider = await getInterviewProvider();
  const started = await provider.start(auth.candidateId);

  revalidatePath("/interview");
  return started;
}

/** Submits one answer and returns the next prompt. */
export async function submitInterviewAnswerAction(
  input: unknown,
): Promise<ActionResult<AnswerTurnData>> {
  const auth = await requireCandidateId();
  if (!auth.ok) return auth;

  const parsed = submitInterviewAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid answer submission." };
  }

  const provider = await getInterviewProvider();
  return provider.answer(
    auth.candidateId,
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
  const auth = await requireCandidateId();
  if (!auth.ok) return auth;

  const parsed = interviewIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const provider = await getInterviewProvider();
  const finished = await provider.finish(
    auth.candidateId,
    parsed.data.interviewId,
  );

  revalidatePath("/interview");
  return finished;
}

/** Abandons an in-progress attempt. Consumes no challenge progress. */
export async function abandonInterviewAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const auth = await requireCandidateId();
  if (!auth.ok) return auth;

  const parsed = interviewIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const provider = await getInterviewProvider();
  const result = await provider.abandon(
    auth.candidateId,
    parsed.data.interviewId,
  );

  revalidatePath("/interview");
  return result;
}
