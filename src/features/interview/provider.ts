import "server-only";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";

/**
 * The seam between the interview UI and its storage, plus the one place that
 * answers "which member is this request acting for".
 *
 * Retargeted from the general interviewer. It previously resolved a *user* and
 * could swap in an in-memory demo provider driven by `INTERVIEW_DEMO=1`. Both
 * are wrong for V1: a cohort interview belongs to a `ProgramMember`, not a
 * `User`, and a demo path that fabricates cohort results has no legitimate use
 * on a milestone that can only be claimed once. The mock provider stays on disk
 * for the future general interview but is no longer reachable.
 */

export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export type {
  AnswerTurnData,
  ClientQuestion,
  CohortInterviewOverview,
  FinishInterviewData,
  StartInterviewData,
} from "@/features/interview/service";

/**
 * Resolves the ProgramMember this request acts for.
 *
 * The single source of member identity for every interview action. It reads the
 * session and the database and takes NO input, so there is no parameter through
 * which a caller could act as another member.
 *
 * Returns null for a signed-out user, a user with no membership, or a member
 * whose enrollment is not active — all of which mean "may not interview".
 */
export async function resolveInterviewMemberId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const member = await prisma.programMember.findFirst({
    where: {
      userId: session.user.id,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  return member?.id ?? null;
}

/**
 * Member id plus the blueprint, for callers that need both. Kept together so a
 * route handler cannot accidentally validate one and forget the other.
 */
export type InterviewActor = {
  memberId: string;
  blueprint: InterviewBlueprintKey;
};
