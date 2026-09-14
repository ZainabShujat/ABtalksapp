import "server-only";

import { formatCreditsMinor } from "@/lib/credits-format";
import { persistableSource } from "@/features/hire/track-loaders";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  applyCreditChange,
  getCreditBalance,
  isUniqueViolation,
  unlockIdempotencyKey,
} from "@/repositories/credits";
import {
  CONTACT_UNLOCK_COST_KEY,
  getIntConfig,
} from "@/lib/platform-config";

/**
 * The money half of a contact unlock (T-229, T-230).
 *
 * Separated from `unlock-contact.ts` deliberately. That file resolves *who is
 * asking* — it reaches for the session, and through it the whole auth stack.
 * This file assumes that question is already answered and does the part that
 * must be right: charge once, write the ledger, grant access, all or nothing.
 *
 * The split buys two things. The transaction can be exercised against a real
 * database without a script having to fake a session — which matters, because
 * the guarantees T-230 is about are row locks and unique indexes, and a mock
 * cannot honestly stand in for either. And the session boundary stays one
 * short, readable function instead of being buried in the middle of a money
 * path.
 *
 * **The ids here must never come from a request.** `unlockContact` is the only
 * caller and it derives every one of them from the session. A server action
 * reaching past it into this file would be handing the browser its own
 * `organizationId`.
 */

export type UnlockRefusal =
  | "NOT_A_RECRUITER"
  | "CANDIDATE_UNAVAILABLE"
  | "INSUFFICIENT_CREDITS"
  | "UNAVAILABLE";

export type UnlockSuccess = {
  ok: true;
  /** False when they already had access — the repeat unlock, which is free. */
  charged: boolean;
  /** What this unlock cost, in USD minor units. Zero when not charged. */
  costMinor: number;
  /** Balance after the movement. */
  balanceMinor: number;
  engagementId: string;
};

export type UnlockFailure = {
  ok: false;
  reason: UnlockRefusal;
  message: string;
  /**
   * The recruiter's own balance, so the UI can say what they have. Never any
   * detail about the candidate — a refusal must carry no PII (T-148 §5).
   */
  balanceMinor: number;
};

export type UnlockResult = UnlockSuccess | UnlockFailure;


export const REFUSAL_MESSAGE: Record<UnlockRefusal, string> = {
  NOT_A_RECRUITER: "Sign in as a recruiter to unlock contact details.",
  CANDIDATE_UNAVAILABLE: "This candidate is no longer available.",
  INSUFFICIENT_CREDITS: "You do not have enough credits for this unlock.",
  UNAVAILABLE: "Could not complete the unlock. Try again.",
};

/**
 * "Not enough credits" with the actual figures, so the recruiter knows what
 * was blocked and by how much. Nothing was charged when this is returned.
 */
export function insufficientCreditsMessage(
  costMinor: number,
  balanceMinor: number,
): string {
  return (
    `${REFUSAL_MESSAGE.INSUFFICIENT_CREDITS} This unlock costs ` +
    `${formatCreditsMinor(costMinor)} and you have ${formatCreditsMinor(balanceMinor)} ` +
    "remaining. Nothing was charged. Contact ABTalks at team@abtalks.in for more credits."
  );
}

/**
 * The allowance every credit movement runs under.
 *
 * Prisma's default is 5s and a contended money path spends most of that queued
 * behind somebody else's row lock over a network round trip. T-228's proofs
 * found this the hard way; see `applyCreditChange`. Do not lower it.
 */
const TX_OPTIONS = { maxWait: 20_000, timeout: 20_000 } as const;

export type ResolvedUnlock = {
  organizationId: string;
  recruiterUserId: string;
  candidateUserId: string;
  candidatePublicId: string;
  programMemberId: string | null;
  source: string;
};

/**
 * The unlock itself, once we know who is asking and about whom.
 *
 * Split from `unlockContact` for one reason: everything above this line is the
 * session boundary, and everything below it is the money. Keeping them apart
 * means the money path can be exercised against a real database — see
 * `db:check:credit-ledger --prove` — without a script having to fake a session,
 * and the guarantees T-230 is about are database behaviour that no mock can
 * honestly stand in for.
 *
 * **The ids this takes must never come from a request.** `unlockContact` is the
 * only caller that matters and it resolves them from the session; a server
 * action calling this directly would be handing the browser its own
 * `organizationId`. `server-only` and that rule are the whole protection here.
 */
export async function unlockResolvedContact(
  resolvedData: ResolvedUnlock,
): Promise<UnlockResult> {
  const {
    organizationId,
    recruiterUserId,
    candidateUserId,
    candidatePublicId,
    programMemberId,
    source,
  } = resolvedData;

  // Already theirs. Free, and answered before any billing exists to go wrong.
  const existing = await findSharedEngagement(recruiterUserId, candidateUserId);
  if (existing) {
    return {
      ok: true,
      charged: false,
      costMinor: 0,
      balanceMinor: await getCreditBalance(organizationId),
      engagementId: existing.id,
    };
  }

  const costMinor = await getIntConfig(CONTACT_UNLOCK_COST_KEY);

  // The engagement's `source` column is an enum. A track the database cannot
  // store must say so here rather than fail inside a transaction that has
  // already taken the recruiter's money.
  const persistable = persistableSource(source);
  if (!persistable) {
    logger.error("[hire] unlock blocked: source missing from enum", { source });
    return {
      ok: false,
      reason: "UNAVAILABLE",
      message: REFUSAL_MESSAGE.UNAVAILABLE,
      balanceMinor: await getCreditBalance(organizationId),
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const change = await applyCreditChange(tx, {
        organizationId,
        recruiterUserId,
        candidateUserId,
        amount: -costMinor,
        type: "UNLOCK_CONTACT",
        sourceType: "TALENT_ENGAGEMENT_REQUEST",
        idempotencyKey: unlockIdempotencyKey(organizationId, candidateUserId),
        reason: "Contact unlock",
        metadata: {
          configKey: CONTACT_UNLOCK_COST_KEY,
          configValue: costMinor,
          candidatePublicId,
        },
      });

      if (!change.ok) {
        // Insufficient. Returning rather than throwing, because there is
        // nothing to roll back yet and the caller wants the reason, not an
        // exception. No ledger row was written — that is T-230's requirement
        // and `applyCreditChange` guarantees it by never reaching the insert.
        return { refused: "INSUFFICIENT_CREDITS" as const, balance: change.balance };
      }

      // `duplicate: true` means a concurrent request already paid for this
      // exact key. Not an error, and emphatically not a second charge — fall
      // through and make sure the access row it was paying for exists.
      //
      // Upgrade the recruiter's existing request rather than adding a second
      // row beside it. Two live engagements for one pair is how
      // `existingEngagements` starts reporting the wrong status to the UI.
      const open = await tx.talentEngagementRequest.findFirst({
        where: {
          recruiterUserId,
          candidateUserId,
          status: { notIn: ["CLOSED", "DECLINED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      const engagement = open
        ? await tx.talentEngagementRequest.update({
            where: { id: open.id },
            data: {
              status: "CONTACT_SHARED",
              decidedAt: new Date(),
              // Released by credit, not by a person. T-148 §4.4.
              decidedByAdminId: null,
            },
            select: { id: true },
          })
        : await tx.talentEngagementRequest.create({
            data: {
              recruiterUserId,
              source: persistable,
              programMemberId,
              candidateUserId,
              candidatePublicId,
              status: "CONTACT_SHARED",
              submittedAt: new Date(),
              decidedAt: new Date(),
              decidedByAdminId: null,
            },
            select: { id: true },
          });

      return {
        refused: null,
        balance: change.balance,
        engagementId: engagement.id,
        charged: !change.duplicate,
      };
    }, TX_OPTIONS);

    if (result.refused) {
      return {
        ok: false,
        reason: "INSUFFICIENT_CREDITS",
        // T-231: name the real numbers, not just the category.
        message: insufficientCreditsMessage(costMinor, result.balance),
        balanceMinor: result.balance,
      };
    }

    return {
      ok: true,
      charged: result.charged ?? true,
      costMinor: result.charged ? costMinor : 0,
      balanceMinor: result.balance,
      engagementId: result.engagementId ?? "",
    };
  } catch (error) {
    // A concurrent unlock won the race on the unique index and this
    // transaction rolled back whole — no charge, no half-written row. The
    // winner's work is committed, so the honest answer is that the recruiter
    // now has access and was not billed for this attempt.
    if (isUniqueViolation(error)) {
      const shared = await findSharedEngagement(recruiterUserId, candidateUserId);
      if (shared) {
        return {
          ok: true,
          charged: false,
          costMinor: 0,
          balanceMinor: await getCreditBalance(organizationId),
          engagementId: shared.id,
        };
      }
    }
    logger.error("[hire] unlockContact", {
      organizationId,
      error: String(error),
    });
    return {
      ok: false,
      reason: "UNAVAILABLE",
      message: REFUSAL_MESSAGE.UNAVAILABLE,
      balanceMinor: await getCreditBalance(organizationId),
    };
  }
}

/** The recruiter's live access row for this candidate, if there is one. */
async function findSharedEngagement(
  recruiterUserId: string,
  candidateUserId: string,
): Promise<{ id: string } | null> {
  return prisma.talentEngagementRequest.findFirst({
    where: { recruiterUserId, candidateUserId, status: "CONTACT_SHARED" },
    select: { id: true },
  });
}

