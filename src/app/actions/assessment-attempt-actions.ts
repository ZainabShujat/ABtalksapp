"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import { fireAssessmentCompletedNotification } from "@/features/recruiter-notifications/hook-assessment-completed";
import {
  attemptActionSchema,
  endAttemptSchema,
  saveAnswerSchema,
  type AssessmentEndReason,
} from "@/lib/validations/assessment";
import {
  endAttempt,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type DeviceHint,
} from "@/features/assessment-attempts/service";
import { prismaAttemptStore } from "@/features/assessment-attempts/prisma-store";

/**
 * T-218 (plan 129) — candidate assessment actions.
 *
 * The candidate is always the session user. No action reads a user id from its
 * input: the service scopes every read and write to `sessionUserId()`.
 * No response carries a score or pass/fail — the candidate sees "Submitted"
 * only (D-1). Answer contents are never logged.
 */

type ActionOk<T> = { ok: true; data: T };
type ActionErr = { ok: false; message: string; status?: number };

const SIGN_IN: ActionErr = {
  ok: false,
  message: "Please sign in to continue.",
  status: 401,
};

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function statusFor(code: "NOT_FOUND" | "INVALID" | "CONFLICT"): number | undefined {
  if (code === "NOT_FOUND") return 404;
  if (code === "CONFLICT") return 409;
  return undefined;
}

function revalidateAttempt(assignmentId: string) {
  revalidatePath("/assessments");
  revalidatePath(`/assessments/${assignmentId}`);
}

async function deviceHint(): Promise<DeviceHint> {
  return { mobile: (await headers()).get("sec-ch-ua-mobile") === "?1" };
}

export async function startAssessmentAttemptAction(
  input: unknown,
): Promise<ActionOk<{ alreadyStarted: boolean }> | ActionErr> {
  const userId = await sessionUserId();
  if (!userId) return SIGN_IN;

  const parsed = attemptActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  try {
    const result = await startAttempt(prismaAttemptStore(), userId, parsed.data, await deviceHint());
    if (!result.ok) {
      return { ok: false, message: result.message, status: statusFor(result.code) };
    }
    revalidateAttempt(parsed.data.assignmentId);
    return { ok: true, data: { alreadyStarted: result.data.alreadyStarted } };
  } catch (error) {
    logger.error("[assessment-attempt-actions] start", {
      assignmentId: parsed.data.assignmentId,
      error: String(error),
    });
    return { ok: false, message: "Couldn't start the assessment. Try again." };
  }
}

export async function saveAssessmentAnswerAction(
  input: unknown,
): Promise<ActionOk<{ savedAt: string }> | ActionErr> {
  const userId = await sessionUserId();
  if (!userId) return SIGN_IN;

  const parsed = saveAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid answer",
    };
  }

  try {
    const result = await saveAnswer(prismaAttemptStore(), userId, parsed.data, await deviceHint());
    if (!result.ok) {
      return { ok: false, message: result.message, status: statusFor(result.code) };
    }
    return { ok: true, data: { savedAt: result.data.savedAt.toISOString() } };
  } catch (error) {
    // The assignment and question ids only — never the answer itself.
    logger.error("[assessment-attempt-actions] save", {
      assignmentId: parsed.data.assignmentId,
      questionId: parsed.data.questionId,
      error: String(error),
    });
    return { ok: false, message: "Couldn't save that answer. Try again." };
  }
}

/**
 * "End assessment", or strict mode's strike limit reached on the candidate's
 * screen. Closes the attempt without the Submit checks; it can't be reopened.
 */
export async function endAssessmentAttemptAction(
  input: unknown,
): Promise<ActionOk<{ submittedAt: string; reason: AssessmentEndReason }> | ActionErr> {
  const userId = await sessionUserId();
  if (!userId) return SIGN_IN;

  const parsed = endAttemptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  try {
    const result = await endAttempt(prismaAttemptStore(), userId, parsed.data, await deviceHint());
    if (!result.ok) {
      return { ok: false, message: result.message, status: statusFor(result.code) };
    }
    revalidateAttempt(parsed.data.assignmentId);
    return {
      ok: true,
      data: {
        submittedAt: result.data.submittedAt.toISOString(),
        reason: result.data.reason,
      },
    };
  } catch (error) {
    logger.error("[assessment-attempt-actions] end", {
      assignmentId: parsed.data.assignmentId,
      reason: parsed.data.reason,
      error: String(error),
    });
    return { ok: false, message: "Couldn't end the assessment. Try again." };
  }
}

export async function submitAssessmentAttemptAction(
  input: unknown,
): Promise<ActionOk<{ submittedAt: string }> | ActionErr> {
  const userId = await sessionUserId();
  if (!userId) return SIGN_IN;

  const parsed = attemptActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  try {
    const result = await submitAttempt(prismaAttemptStore(), userId, parsed.data, await deviceHint());
    if (!result.ok) {
      return { ok: false, message: result.message, status: statusFor(result.code) };
    }
    revalidateAttempt(parsed.data.assignmentId);

    // T-249 #3: fire the assessment.completed notification for the
    // recruiter who owns the assessment. Wrapped in try/catch by the
    // helper itself; wrapped here again as belt-and-braces so a
    // dispatch that somehow escapes still cannot fail the candidate's
    // submit reply. Plan 166: platform assessments have no recruiter —
    // the admin who built one reads results on /admin/assessments instead
    // of receiving one notification per candidate.
    if (result.data.source === "RECRUITER") {
      try {
        await fireAssessmentCompletedNotification({
          assignmentId: parsed.data.assignmentId,
          candidateUserId: userId,
        });
      } catch (err) {
        logger.warn("[assessment-attempt-actions] notify_wrapper_caught", {
          assignmentId: parsed.data.assignmentId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: true,
      data: { submittedAt: result.data.submittedAt.toISOString() },
    };
  } catch (error) {
    logger.error("[assessment-attempt-actions] submit", {
      assignmentId: parsed.data.assignmentId,
      error: String(error),
    });
    return {
      ok: false,
      message: "Couldn't submit. Your answers are saved — try again.",
    };
  }
}
