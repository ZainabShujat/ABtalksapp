import "server-only";

import { prisma } from "@/lib/db";

/**
 * Whether this recruiter may see this candidate's real identity and contact
 * details.
 *
 * Derived from the request status, never stored as its own flag. A second
 * "contactVisible" boolean is a field that can be left switched on by a bug, a
 * bad backfill, or a status change that forgot to clear it; there is nothing to
 * forget when the answer is computed from the decision itself.
 *
 * One rule, one place. Every surface that could reveal a name, an email, a
 * phone number or a profile link asks this — nothing decides locally.
 *
 * Keyed on the candidate's *user* id rather than their program member id, which
 * is the only key both pools have: a challenge participant has no ProgramMember
 * row, and a rule that cannot name half the candidates is not one rule.
 */
export async function hasContactAccess(
  recruiterUserId: string,
  candidateUserId: string,
): Promise<boolean> {
  const shared = await prisma.talentEngagementRequest.findFirst({
    where: {
      recruiterUserId,
      candidateUserId,
      status: "CONTACT_SHARED",
    },
    select: { id: true },
  });
  return shared !== null;
}

/** The same question for a page rendering many candidates at once. */
export async function contactAccessFor(
  recruiterUserId: string,
  candidateUserIds: string[],
): Promise<Set<string>> {
  if (candidateUserIds.length === 0) return new Set();

  const rows = await prisma.talentEngagementRequest.findMany({
    where: {
      recruiterUserId,
      candidateUserId: { in: candidateUserIds },
      status: "CONTACT_SHARED",
    },
    select: { candidateUserId: true },
  });

  return new Set(
    rows
      .map((r) => r.candidateUserId)
      .filter((id): id is string => id !== null),
  );
}

/** What the recruiter has already asked about, so the UI never offers twice. */
export async function existingEngagements(
  recruiterUserId: string,
  candidateUserIds: string[],
): Promise<Map<string, { id: string; status: string }>> {
  if (candidateUserIds.length === 0) return new Map();

  const rows = await prisma.talentEngagementRequest.findMany({
    where: {
      recruiterUserId,
      candidateUserId: { in: candidateUserIds },
      status: { not: "CLOSED" },
    },
    select: { id: true, status: true, candidateUserId: true },
    orderBy: { createdAt: "desc" },
  });

  const out = new Map<string, { id: string; status: string }>();
  for (const r of rows) {
    // Newest first, so the first row seen for a candidate is the live one.
    if (r.candidateUserId && !out.has(r.candidateUserId)) {
      out.set(r.candidateUserId, { id: r.id, status: r.status });
    }
  }
  return out;
}
