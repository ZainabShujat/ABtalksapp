import "server-only";

import { Prisma, type CreditTransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getIntConfig, STARTING_GRANT_KEY } from "@/lib/platform-config";

/**
 * The recruiter credit ledger (T-228, architecture signed off in T-148).
 *
 * ## The one rule
 *
 * `CreditTransaction` is the money. `CreditAccount` is a cache. Every read that
 * answers "how much does this workspace have" derives the answer from the
 * ledger; the account row exists so that a movement has a single row to lock,
 * which is what makes a debit one conditional UPDATE instead of a read followed
 * by a write two requests can interleave. The invariant
 * `CreditAccount.balance === SUM(CreditTransaction.amount)` holds after every
 * successful mutation because the same transaction writes both, and
 * `npm run db:check:credit-ledger` exists to prove it against real data.
 *
 * A bare `creditBalance Int` column would have been shorter and is prohibited
 * (T-148 §2, Risk R17): it cannot survive a retry, cannot say who spent what on
 * whom, and cannot be corrected without corrupting its own history.
 *
 * ## The one writer
 *
 * `applyCreditChange` is the only function in this codebase that moves credits,
 * and this is the only file that writes either table. Product code calls the
 * workspace-scoped façade in `src/features/hire/credits.ts`; nothing else
 * touches `prisma.creditTransaction` or `prisma.creditAccount`.
 *
 * ## Composition
 *
 * `applyCreditChange` takes a caller-supplied `Prisma.TransactionClient` rather
 * than opening its own. That is deliberate and is what T-148 §4.4 requires:
 * T-229's unlock must commit the debit, the ledger row and the
 * `TalentEngagementRequest` at `CONTACT_SHARED` in a single transaction, so a
 * function that opened its own would make the guarantee impossible to write.
 *
 * `server-only`: this spends money.
 */

export type CreditChangeInput = {
  organizationId: string;
  /** Whose workspace this is. Under T-226, one Organization is one recruiter. */
  recruiterUserId: string;
  /** Set when the movement is about a specific candidate (T-229 unlocks). */
  candidateUserId?: string | null;
  /** Signed USD minor units. Positive credits, negative debits. Never 0. */
  amount: number;
  type: CreditTransactionType;
  sourceType: string;
  sourceId?: string | null;
  /** Deterministic. This, not a code path, is what makes a retry safe. */
  idempotencyKey: string;
  /** Required. Every movement says why it happened, in words. */
  reason: string;
  /** The actor when it is not the recruiter — an admin, a script. */
  createdByUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type CreditChangeResult =
  | {
      ok: true;
      /** Post-movement balance, in USD minor units. */
      balance: number;
      appliedAmount: number;
      /** True when this key had already been applied; nothing moved. */
      duplicate: boolean;
    }
  | { ok: false; reason: "INSUFFICIENT_CREDITS"; balance: number };

export type CreditLedgerEntry = {
  id: string;
  /** Stringified: a BigInt has no place crossing a serialisation boundary. */
  seq: string;
  amount: number;
  type: CreditTransactionType;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  recruiterUserId: string;
  candidateUserId: string | null;
  sourceType: string;
  sourceId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
};

export type ReconcileReport = {
  organizationId: string;
  /** SUM(amount) — the unarguable answer. */
  ledgerSum: number;
  /** The newest row's balanceAfter — the O(1) answer reads use. */
  latestBalanceAfter: number;
  /** The cached projection. Must equal both of the above. */
  accountBalance: number;
  transactionCount: number;
  reconciled: boolean;
};

/** The onboarding grant's key. One per workspace, forever. */
export function onboardingGrantKey(organizationId: string): string {
  return `grant:onboarding:${organizationId}`;
}

/**
 * One unlock, one key, forever.
 *
 * Scoped to the workspace rather than the recruiter user so it keeps meaning
 * the same thing if a workspace ever gains a second member — the credits are
 * the workspace's, so the thing that must not happen twice is a workspace
 * paying twice. T-148 §4.2 reserved this namespace; T-228 deliberately left it
 * unused.
 */
export function unlockIdempotencyKey(
  organizationId: string,
  candidateUserId: string,
): string {
  return `unlock:${organizationId}:${candidateUserId}`;
}

/* ─── reads: always from the ledger ──────────────────────────────────────── */

/**
 * The authoritative balance, in USD minor units.
 *
 * Reads the newest ledger row's `balanceAfter` rather than summing the ledger,
 * which is O(1) and still an answer that came out of the ledger — the cached
 * `CreditAccount.balance` is not consulted here and must not be. `seq` rather
 * than `createdAt` because two rows can share a millisecond and "the latest
 * balance" has to have exactly one answer.
 */
export async function getCreditBalance(
  organizationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const latest = await client.creditTransaction.findFirst({
    where: { organizationId },
    orderBy: { seq: "desc" },
    select: { balanceAfter: true },
  });
  return latest?.balanceAfter ?? 0;
}

/** SUM(amount). Slower, unarguable, and used by reconciliation, not by product code. */
export async function sumLedgerBalance(
  organizationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const agg = await client.creditTransaction.aggregate({
    where: { organizationId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/**
 * Lifetime money in and money out, derived from the ledger (T-231). Not from
 * `CreditAccount.lifetimeEarned/Spent` — those are the cache, and reads never
 * consult the cache.
 */
export async function summarizeCreditLedger(
  organizationId: string,
): Promise<{ grantedMinor: number; spentMinor: number; transactionCount: number }> {
  const [credits, debits, transactionCount] = await Promise.all([
    prisma.creditTransaction.aggregate({
      where: { organizationId, amount: { gt: 0 } },
      _sum: { amount: true },
    }),
    prisma.creditTransaction.aggregate({
      where: { organizationId, amount: { lt: 0 } },
      _sum: { amount: true },
    }),
    prisma.creditTransaction.count({ where: { organizationId } }),
  ]);
  return {
    grantedMinor: credits._sum.amount ?? 0,
    spentMinor: Math.abs(debits._sum.amount ?? 0),
    transactionCount,
  };
}

export async function listCreditTransactions(
  organizationId: string,
  opts?: { limit?: number; beforeSeq?: string },
): Promise<CreditLedgerEntry[]> {
  const rows = await prisma.creditTransaction.findMany({
    where: {
      organizationId,
      ...(opts?.beforeSeq ? { seq: { lt: BigInt(opts.beforeSeq) } } : {}),
    },
    orderBy: { seq: "desc" },
    take: Math.min(Math.max(opts?.limit ?? 50, 1), 200),
    select: {
      id: true,
      seq: true,
      amount: true,
      type: true,
      balanceBefore: true,
      balanceAfter: true,
      reason: true,
      recruiterUserId: true,
      candidateUserId: true,
      sourceType: true,
      sourceId: true,
      createdByUserId: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({ ...row, seq: row.seq.toString() }));
}

/**
 * Does the cache still agree with the ledger?
 *
 * Three numbers that must be equal. They are written by one transaction so they
 * cannot drift in normal operation; this exists because "cannot drift" is a
 * claim, and on a money path a claim wants a check behind it.
 */
export async function reconcileCreditAccount(
  organizationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ReconcileReport> {
  const [ledgerSum, latestBalanceAfter, account, transactionCount] =
    await Promise.all([
      sumLedgerBalance(organizationId, client),
      getCreditBalance(organizationId, client),
      client.creditAccount.findUnique({
        where: { organizationId },
        select: { balance: true },
      }),
      client.creditTransaction.count({ where: { organizationId } }),
    ]);

  const accountBalance = account?.balance ?? 0;
  return {
    organizationId,
    ledgerSum,
    latestBalanceAfter,
    accountBalance,
    transactionCount,
    reconciled:
      ledgerSum === latestBalanceAfter && ledgerSum === accountBalance,
  };
}

/* ─── the write ──────────────────────────────────────────────────────────── */

/**
 * Move credits. The only place that does.
 *
 * Runs inside the caller's transaction, in four statements:
 *
 * 1. Has this key already been applied? If so nothing moves and the caller is
 *    told `duplicate: true` — the retry-safe answer T-148 §4.2 specifies, and
 *    the reason a network retry of an unlock does not charge twice.
 * 2. Make sure the account row exists, so step 3 has a row to lock.
 * 3. `UPDATE … SET balance = balance + amount WHERE balance + amount >= 0`,
 *    `RETURNING balance`. One statement, so concurrent spenders serialise on
 *    the row lock and the predicate is evaluated against a balance nobody else
 *    can be halfway through changing. Zero rows matched means the money is not
 *    there; overdraft is not merely discouraged, it cannot be represented.
 * 4. Append the ledger row, taking `balanceAfter` from step 3's post-image and
 *    deriving `balanceBefore` from it — so the two can never disagree.
 *
 * Callers own the transaction and must own its timeout with it. Prisma's
 * default is 5s, and a contended money path spends most of that queueing behind
 * somebody else's lock over a network round trip — pass
 * `{ maxWait: 20000, timeout: 20000 }`, the same allowance
 * `src/repositories/points.ts` already uses. `grantOnboardingCreditsAtomic`
 * does this; T-229's unlock must too.
 *
 * The pre-check in step 1 is a fast path, not the guarantee. Two simultaneous
 * first attempts both pass it; the unique index on `idempotencyKey` then rejects
 * one of them at step 4, which aborts the transaction and rolls the balance
 * change back with it. That is the correct outcome, and callers that want it
 * reported rather than thrown own a transaction boundary and catch P2002 there
 * (see `grantOnboardingCreditsAtomic`).
 */
export async function applyCreditChange(
  tx: Prisma.TransactionClient,
  input: CreditChangeInput,
): Promise<CreditChangeResult> {
  if (!Number.isInteger(input.amount)) {
    throw new Error(
      `[credits] amount must be an integer number of minor units, got ${input.amount}`,
    );
  }

  const existing = await tx.creditTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { amount: true, balanceAfter: true },
  });
  if (existing) {
    return {
      ok: true,
      balance: await getCreditBalance(input.organizationId, tx),
      appliedAmount: existing.amount,
      duplicate: true,
    };
  }

  if (input.amount === 0) {
    // Not an error, but not a movement either — an append-only ledger should
    // not carry rows that say nothing happened.
    return {
      ok: true,
      balance: await getCreditBalance(input.organizationId, tx),
      appliedAmount: 0,
      duplicate: false,
    };
  }

  const credited = Math.max(input.amount, 0);
  const debited = Math.max(-input.amount, 0);

  // Two statements, and they have to be two.
  //
  // Collapsing them into one `INSERT … SELECT … WHERE amount >= 0 ON CONFLICT
  // DO UPDATE` looks right and is not: a debit makes the SELECT produce no
  // candidate row, so there is nothing to conflict, so DO UPDATE never runs and
  // every debit is silently refused. `db:check:credit-ledger --prove` caught
  // that in one run. Leave it as it is.
  await tx.creditAccount.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId },
    update: { version: { increment: 0 } },
    select: { id: true },
  });

  // The movement itself. One statement, so concurrent spenders serialise on
  // this row's lock and the floor is evaluated against a balance nobody else
  // can be halfway through changing.
  const moved = await tx.$queryRaw<{ balance: number }[]>`
    UPDATE "CreditAccount"
       SET "balance"        = "balance" + ${input.amount}::int,
           "lifetimeEarned" = "lifetimeEarned" + ${credited}::int,
           "lifetimeSpent"  = "lifetimeSpent" + ${debited}::int,
           "version"        = "version" + 1,
           "reconciledAt"   = NOW(),
           "updatedAt"      = NOW()
     WHERE "organizationId" = ${input.organizationId}
       AND "balance" + ${input.amount}::int >= 0
    RETURNING "balance"
  `;

  const balanceAfter = moved[0]?.balance;
  if (balanceAfter === undefined) {
    // The row exists — it was just upserted — so the only predicate that can
    // have failed is the one guarding the floor.
    return {
      ok: false,
      reason: "INSUFFICIENT_CREDITS",
      balance: await getCreditBalance(input.organizationId, tx),
    };
  }

  await tx.creditTransaction.create({
    data: {
      organizationId: input.organizationId,
      recruiterUserId: input.recruiterUserId,
      candidateUserId: input.candidateUserId ?? null,
      amount: input.amount,
      type: input.type,
      balanceBefore: balanceAfter - input.amount,
      balanceAfter,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      createdByUserId: input.createdByUserId ?? null,
      metadata: input.metadata,
    },
    select: { id: true },
  });

  return {
    ok: true,
    balance: balanceAfter,
    appliedAmount: input.amount,
    duplicate: false,
  };
}

/* ─── the onboarding grant ───────────────────────────────────────────────── */

export type OnboardingGrantInput = {
  organizationId: string;
  recruiterUserId: string;
  createdByUserId?: string | null;
};

/**
 * Grant a new workspace its starting credits, inside the caller's transaction.
 *
 * The amount is read from `PlatformConfig` at grant time and frozen into the
 * ledger row along with the key and value it came from, so changing the config
 * later moves the next recruiter's grant and never rewrites this one.
 *
 * Exactly-once is a database constraint, not a code path: the key is
 * `grant:onboarding:<organizationId>` and `idempotencyKey` is unique.
 */
export async function grantOnboardingCredits(
  tx: Prisma.TransactionClient,
  input: OnboardingGrantInput,
): Promise<CreditChangeResult> {
  const amount = await getIntConfig(STARTING_GRANT_KEY);
  return applyCreditChange(tx, {
    organizationId: input.organizationId,
    recruiterUserId: input.recruiterUserId,
    amount,
    type: "GRANT_ONBOARDING",
    sourceType: "ORGANIZATION",
    sourceId: input.organizationId,
    idempotencyKey: onboardingGrantKey(input.organizationId),
    reason: "Starting credits for a new recruiter workspace",
    createdByUserId: input.createdByUserId ?? null,
    metadata: { configKey: STARTING_GRANT_KEY, configValue: amount },
  });
}

/**
 * Is this the database refusing a second row where only one may exist?
 *
 * Prisma usually maps a unique violation to `P2002` on a
 * `PrismaClientKnownRequestError`. Usually is not always: a transaction that
 * has already issued a `$queryRaw` — which every credit movement does — can
 * surface the driver's own error instead, as a `PrismaClientUnknownRequestError`
 * carrying the raw Postgres SQLSTATE. Matching only `P2002` therefore reads a
 * successful, correct, entirely expected race as a crash.
 *
 * Found by `db:check:credit-ledger --prove`, which is the argument for having
 * written it: five concurrent grants are not a scenario a type checker can
 * reach, and the narrow check looked right until Postgres disagreed.
 *
 * 23505 is unique_violation.
 *
 * Exported because T-229's unlock owns its own transaction — debit, ledger row
 * and `CONTACT_SHARED` commit together (T-148 §4.4) — so the catch has to live
 * at that boundary. It reuses this rather than writing a second check, because
 * the second check is the narrow `P2002`-only one, and that is precisely the
 * bug the proofs already caught here once.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002";
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /23505|duplicate key value violates unique constraint/.test(
      error.message,
    );
  }
  return false;
}

/** How many lost races before we stop being patient and start being loud. */
const GRANT_RACE_ATTEMPTS = 3;

/**
 * The same grant, owning its own transaction.
 *
 * Callers that are not already inside one use this. It is also where a
 * concurrent first attempt is turned from an exception into an answer.
 *
 * Two different collisions are possible and they need different endings. If the
 * grant's own `idempotencyKey` was taken, somebody else has already granted this
 * workspace and the honest report is `duplicate: true`. If the collision was on
 * the account row — two transactions creating the same `CreditAccount` at once —
 * then no grant has been written yet and giving up would leave the workspace
 * unfunded, so this attempt is simply made again. Distinguishing them is one
 * read of the ledger, and it is the ledger, not the exception, that is asked.
 *
 * Bounded at three attempts. A workspace is granted once in its life by one of
 * two call sites; if that loses three races something is wrong that a fourth
 * would only hide.
 */
export async function grantOnboardingCreditsAtomic(
  input: OnboardingGrantInput,
): Promise<CreditChangeResult> {
  const key = onboardingGrantKey(input.organizationId);

  for (let attempt = 1; attempt <= GRANT_RACE_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) => grantOnboardingCredits(tx, input),
        // See applyCreditChange: the 5s default is not enough for a lock a
        // handful of requests may be queued behind.
        { maxWait: 20_000, timeout: 20_000 },
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const existing = await prisma.creditTransaction.findUnique({
        where: { idempotencyKey: key },
        select: { amount: true },
      });
      if (existing) {
        logger.info("[credits] onboarding grant already applied by a concurrent request", {
          organizationId: input.organizationId,
        });
        return {
          ok: true,
          balance: await getCreditBalance(input.organizationId),
          appliedAmount: existing.amount,
          duplicate: true,
        };
      }

      logger.info("[credits] lost a race on the account row; retrying the grant", {
        organizationId: input.organizationId,
        attempt,
      });
    }
  }

  throw new Error(
    `[credits] onboarding grant for ${input.organizationId} lost ${GRANT_RACE_ATTEMPTS} races`,
  );
}
