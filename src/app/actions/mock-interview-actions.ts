"use server";

import { revalidatePath } from "next/cache";
import { resolvePlatformUserId } from "@/features/interview/platform/provider";
import * as service from "@/features/interview/platform/service";
import type {
  AnswerTurnData,
  CatalogueEntry,
  FinishAttemptData,
  HistoryEntry,
  StartAttemptData,
} from "@/features/interview/platform/service";
import {
  attemptIdSchema,
  startMockInterviewSchema,
  submitMockAnswerSchema,
} from "@/lib/validations/mock-interview";

/**
 * Server Actions for the interview platform (plan 103).
 *
 * Every action resolves the user server-side and passes only ids downward. The
 * plan, runtime state, rubric, capabilities, scores and domain configuration
 * never cross this boundary inbound, so a tampered client payload cannot alter
 * question order, evidence, scores, or which interview is being sat.
 *
 * The complete set of things a client may send:
 *   - a domain slug (validated as slug-shaped, then re-gated by the registry)
 *   - an attempt id (scoped to the user in the WHERE clause)
 *   - a question id (checked against the question the server has open)
 *   - answer text, and optionally workspace artifacts
 *
 * Identity comes from `resolvePlatformUserId()`, which reads the session and
 * takes no arguments. It is never derived from an attempt id, a URL parameter
 * or a request body.
 */

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const userId = await resolvePlatformUserId();
  if (!userId) {
    return { ok: false, message: "Please sign in to take a mock interview." };
  }
  return { ok: true, userId };
}

/**
 * Opens an attempt and returns the first question.
 *
 * The slug is validated as slug-shaped here and independently re-gated inside
 * the service against the domain registry. Passing a COMING_SOON slug from a
 * browser console does not open an interview that has not been authored.
 */
export async function startMockInterviewAction(
  input: unknown,
): Promise<ActionResult<StartAttemptData>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;

  const parsed = startMockInterviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Unknown interview." };

  const started = await service.startAttempt(auth.userId, parsed.data.domainSlug);

  revalidatePath("/mock-interviews");
  return started;
}

/** Submits one answer and returns the next prompt. */
export async function submitMockAnswerAction(
  input: unknown,
): Promise<ActionResult<AnswerTurnData>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;

  const parsed = submitMockAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid answer submission." };
  }

  return service.recordAnswer(
    auth.userId,
    parsed.data.attemptId,
    parsed.data.questionId,
    { text: parsed.data.answerText, artifacts: parsed.data.artifacts },
  );
}

/**
 * Scores the attempt and stores its report.
 *
 * Safe to call twice: the service detects an already-completed attempt and
 * returns the stored result rather than recomputing it.
 */
export async function finishMockInterviewAction(
  input: unknown,
): Promise<ActionResult<FinishAttemptData>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;

  const parsed = attemptIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const finished = await service.finishAttempt(auth.userId, parsed.data.attemptId);

  revalidatePath("/mock-interviews");
  revalidatePath("/mock-interviews/history");
  return finished;
}

/** Abandons an in-progress attempt. The row is marked, never deleted. */
export async function abandonMockInterviewAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;

  const parsed = attemptIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid interview." };

  const result = await service.abandonAttempt(auth.userId, parsed.data.attemptId);

  revalidatePath("/mock-interviews");
  return result;
}

/* ------------------------------------------------------------------ reads */

/**
 * The catalogue and the history are reads, so Server Components call the
 * service directly. These wrappers exist for the client components that need to
 * refresh without a full navigation.
 */
export async function getMockCatalogueAction(): Promise<
  ActionResult<CatalogueEntry[]>
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  return service.getCatalogue(auth.userId);
}

export async function getMockHistoryAction(): Promise<
  ActionResult<HistoryEntry[]>
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  return service.getHistory(auth.userId);
}
