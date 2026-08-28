"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/admin-auth";
import { resolveEligibleCandidates } from "@/features/hire/pool-policy";
import { persistableSource } from "@/features/hire/track-loaders";
import {
  decideEngagementSchema,
  engagementMessageSchema,
  placeBulkEngagementRequestSchema,
  placeEngagementRequestSchema,
} from "@/lib/validations/hire-request";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function requireApprovedRecruiter(): Promise<
  ActionResult<{ userId: string }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Sign in as an approved recruiter." };
  }
  let profile;
  try {
    profile = await prisma.recruiterProfile.findUnique({
      where: { userId: session.user.id },
      select: { approved: true },
    });
  } catch (error) {
    logger.error("[hire] requireApprovedRecruiter", { error: String(error) });
    return {
      ok: false,
      message: "Could not reach the server. Try again in a moment.",
    };
  }
  if (!profile?.approved) {
    return { ok: false, message: "Recruiter access not approved yet." };
  }
  return { ok: true, data: { userId: session.user.id } };
}

/**
 * Registered as a recruiter — approved or still waiting on the team.
 *
 * A recruiter who registers *because* they want two specific candidates had
 * their ask dropped on the floor: it lived in sessionStorage until approval,
 * which arrives hours later in a different browser session. The intent that
 * caused the signup was the first thing lost.
 *
 * Letting a pending recruiter record the ask is safe — an engagement request
 * reveals nothing. The candidate stays behind a reference id until an admin
 * explicitly shares contact, and that decision is unchanged. What it buys is
 * that the application and what they came for reach the team together.
 */
async function requireRegisteredRecruiter(): Promise<
  ActionResult<{ userId: string; approved: boolean }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Sign in to place a request." };
  }
  let profile;
  try {
    profile = await prisma.recruiterProfile.findUnique({
      where: { userId: session.user.id },
      select: { approved: true },
    });
  } catch (error) {
    logger.error("[hire] requireRegisteredRecruiter", { error: String(error) });
    return {
      ok: false,
      message: "Could not reach the server. Try again in a moment.",
    };
  }
  if (!profile) {
    return { ok: false, message: "Register as a recruiter first." };
  }
  return {
    ok: true,
    data: { userId: session.user.id, approved: profile.approved },
  };
}

/**
 * Ask to be introduced to one candidate.
 *
 * The recruiter never sees who this is — the request is how ABTalks stays in
 * the loop, and how the candidate keeps a say in being contacted at all.
 */
export async function placeEngagementRequestAction(
  input: unknown,
): Promise<ActionResult<{ engagementId: string; status: string }>> {
  const gate = await requireApprovedRecruiter();
  if (!gate.ok) return gate;

  const parsed = placeEngagementRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { candidateRef, requestId, note } = parsed.data;

  try {
    // The candidate must be someone this recruiter could legitimately have
    // seen: in the pool, on whichever track they came from.
    const [candidate] = await resolveEligibleCandidates([candidateRef]);
    if (!candidate) return { ok: false, message: "Candidate not available." };

    // One open request per recruiter/candidate pair. Asking twice is a
    // duplicate, not a second ask.
    const open = await prisma.talentEngagementRequest.findFirst({
      where: {
        recruiterUserId: gate.data.userId,
        candidateUserId: candidate.userId,
        status: { notIn: ["CLOSED", "DECLINED"] },
      },
      select: { id: true, status: true },
    });
    if (open) {
      return { ok: true, data: { engagementId: open.id, status: open.status } };
    }

    // An intro is an explicit click, so a track the DB enum cannot store must
    // say so rather than fail inside a transaction the recruiter never sees.
    const source = persistableSource(candidate.source);
    if (!source) {
      logger.error("[hire] intro blocked: source missing from enum", {
        source: candidate.source,
      });
      return {
        ok: false,
        message:
          "Introductions aren't open for this track yet. Shortlist them and we'll reach out.",
      };
    }

    const created = await prisma.$transaction(async (tx) => {
      const engagement = await tx.talentEngagementRequest.create({
        data: {
          recruiterUserId: gate.data.userId,
          requestId: requestId ?? null,
          source,
          programMemberId: candidate.programMemberId,
          candidateUserId: candidate.userId,
          candidatePublicId: candidate.publicId,
          note: note ?? null,
          status: "SUBMITTED",
          submittedAt: new Date(),
        },
        select: { id: true, status: true },
      });

      if (note) {
        await tx.talentEngagementMessage.create({
          data: {
            engagementId: engagement.id,
            authorUserId: gate.data.userId,
            authorRole: "recruiter",
            body: note,
          },
        });
      }

      return engagement;
    });

    revalidatePath("/hire");
    revalidatePath("/hire/requests");
    revalidatePath("/admin/hire");
    return {
      ok: true,
      data: { engagementId: created.id, status: created.status },
    };
  } catch (error) {
    logger.error("[hire] placeEngagementRequestAction", {
      error: String(error),
    });
    return { ok: false, message: "Could not place the request." };
  }
}

/**
 * Place one request per shortlisted candidate, from a single submission.
 *
 * Deliberately one row per candidate rather than one row for the batch: the
 * team decides each introduction separately, and contact release is per pair.
 * Batching the decision would mean sharing everyone or no one.
 */
export async function placeBulkEngagementRequestAction(
  input: unknown,
): Promise<ActionResult<{ placed: number; skipped: number }>> {
  // Registered is enough here. This is the path a pending recruiter lands on
  // straight after signing up with candidates already in their cart.
  const gate = await requireRegisteredRecruiter();
  if (!gate.ok) return gate;

  const parsed = placeBulkEngagementRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Select at least one candidate." };
  }
  const { candidateRefs, requestId, note } = parsed.data;
  const userId = gate.data.userId;

  try {
    const eligible = await resolveEligibleCandidates(candidateRefs);

    const alreadyOpen = new Set(
      (
        await prisma.talentEngagementRequest.findMany({
          where: {
            recruiterUserId: userId,
            candidateUserId: { in: eligible.map((c) => c.userId) },
            status: { notIn: ["CLOSED", "DECLINED"] },
          },
          select: { candidateUserId: true },
        })
      ).map((r) => r.candidateUserId),
    );

    // Same enum limit as the single intro. Here the batch continues without the
    // unstorable ones and they are reported as skipped, so a mixed cart still
    // places the introductions it can.
    const toPlace = eligible
      .filter((c) => !alreadyOpen.has(c.userId))
      .filter((c) => {
        if (persistableSource(c.source)) return true;
        logger.error("[hire] intro skipped: source missing from enum", {
          source: c.source,
        });
        return false;
      });
    if (toPlace.length === 0) {
      return {
        ok: true,
        data: { placed: 0, skipped: candidateRefs.length },
      };
    }

    await prisma.$transaction(async (tx) => {
      for (const candidate of toPlace) {
        const engagement = await tx.talentEngagementRequest.create({
          data: {
            recruiterUserId: userId,
            requestId: requestId ?? null,
            source: persistableSource(candidate.source)!,
            programMemberId: candidate.programMemberId,
            candidateUserId: candidate.userId,
            candidatePublicId: candidate.publicId,
            note: note ?? null,
            status: "SUBMITTED",
            submittedAt: new Date(),
          },
          select: { id: true },
        });
        if (note) {
          await tx.talentEngagementMessage.create({
            data: {
              engagementId: engagement.id,
              authorUserId: userId,
              authorRole: "recruiter",
              body: note,
            },
          });
        }
      }
    });

    revalidatePath("/hire");
    revalidatePath("/hire/requests");
    revalidatePath("/talent/shortlist");
    revalidatePath("/admin/hire");
    return {
      ok: true,
      data: {
        placed: toPlace.length,
        skipped: candidateRefs.length - toPlace.length,
      },
    };
  } catch (error) {
    logger.error("[hire] placeBulkEngagementRequestAction", {
      error: String(error),
    });
    return { ok: false, message: "Could not place the requests." };
  }
}

/** Recruiter adds a comment to their own request thread. */
export async function addEngagementCommentAction(
  input: unknown,
): Promise<ActionResult<{ engagementId: string }>> {
  const gate = await requireApprovedRecruiter();
  if (!gate.ok) return gate;

  const parsed = engagementMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a message first." };

  try {
    // Scoped to the caller, so a valid id belonging to someone else is a miss
    // rather than an authorisation check that could be forgotten.
    const owned = await prisma.talentEngagementRequest.findFirst({
      where: {
        id: parsed.data.engagementId,
        recruiterUserId: gate.data.userId,
      },
      select: { id: true },
    });
    if (!owned) return { ok: false, message: "Request not found." };

    await prisma.talentEngagementMessage.create({
      data: {
        engagementId: owned.id,
        authorUserId: gate.data.userId,
        authorRole: "recruiter",
        body: parsed.data.body,
      },
    });

    revalidatePath("/hire/requests");
    revalidatePath("/admin/hire");
    return { ok: true, data: { engagementId: owned.id } };
  } catch (error) {
    logger.error("[hire] addEngagementCommentAction", { error: String(error) });
    return { ok: false, message: "Could not post the comment." };
  }
}

/** Admin decision. CONTACT_SHARED is what releases identity to the recruiter. */
export async function decideEngagementAction(
  input: unknown,
): Promise<ActionResult<{ engagementId: string; status: string }>> {
  const admin = await requireAdmin();

  const parsed = decideEngagementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid decision." };
  const { engagementId, decision, note } = parsed.data;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.talentEngagementRequest.update({
        where: { id: engagementId },
        data: {
          status: decision,
          decidedAt: new Date(),
          decidedByAdminId: admin.userId ?? null,
        },
        select: { id: true, status: true },
      });

      if (note) {
        await tx.talentEngagementMessage.create({
          data: {
            engagementId: row.id,
            authorUserId: admin.userId ?? null,
            authorRole: "admin",
            body: note,
          },
        });
      }

      return row;
    });

    revalidatePath("/admin/hire");
    revalidatePath("/hire/requests");
    return {
      ok: true,
      data: { engagementId: updated.id, status: updated.status },
    };
  } catch (error) {
    logger.error("[hire] decideEngagementAction", { error: String(error) });
    return { ok: false, message: "Could not save the decision." };
  }
}
