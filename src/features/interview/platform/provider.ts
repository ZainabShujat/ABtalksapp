import "server-only";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * Who this request is acting for, on the interview platform.
 *
 * The single source of identity for every platform action. It reads the session
 * and takes NO ARGUMENTS, so there is no parameter through which a caller could
 * act as somebody else. Identity is never derived from an attempt id, a URL
 * segment, or a request body.
 *
 * THE DIFFERENCE FROM THE COHORT PATH, which is the whole point of the platform:
 * `resolveInterviewMemberId()` requires an active `ProgramMember` with an
 * ENROLLED or COMPLETED enrollment, because a cohort interview is a milestone
 * inside a paid programme. A mock interview requires only a registered account.
 * So this resolves a `User.id` and checks nothing else — except that the account
 * has not been soft-deleted, since a deleted user should not be able to generate
 * new rows against their own id.
 */
export async function resolvePlatformUserId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, deletedAt: null },
    select: { id: true },
  });

  return user?.id ?? null;
}

/**
 * The user's display name for the spoken opening.
 *
 * Separate from identity resolution because it is presentational and optional:
 * a missing name degrades the greeting rather than costing someone an
 * interview, exactly as it does on the cohort path.
 */
export async function resolvePlatformCandidate(
  userId: string,
): Promise<{ fullName: string; firstName: string | null }> {
  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { name: true },
  });

  const fullName = (user?.name ?? "").trim();
  const firstName = fullName.split(/\s+/)[0] || null;

  return { fullName: fullName || "Candidate", firstName };
}
