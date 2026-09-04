import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { PointsSourceType, type Prisma } from "@prisma/client";
import { istDateRangeToUtc } from "@/lib/date-utils";
import { prisma, writeClient } from "@/lib/db";
import {
  isNewPointsRepoEnabled,
  isNewPointsWritesEnabled,
} from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import { dualWritePoints } from "@/repositories/dual-write";

type PointsReadClient = Pick<typeof prisma, "pointsAccount" | "user">;
type Tx = Prisma.TransactionClient;

const PRODUCTION_NEON_HOST_ID = "ep-nameless-term-ams9a5e3";

type LegacyMirrorJob = {
  input: ApplyPointsInput;
  amount: number;
};

const pendingLegacyMirrors = new AsyncLocalStorage<LegacyMirrorJob[]>();

/**
 * Run `fn` (the authoritative wallet transaction) then flush User/SynergyEvent
 * mirrors in a separate transaction after `fn` commits.
 */
export async function withLegacyPointsMirrorFlush<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const bag: LegacyMirrorJob[] = [];
  const result = await pendingLegacyMirrors.run(bag, fn);
  for (const job of bag) {
    await flushLegacyMirror(job);
  }
  return result;
}

function enqueueLegacyMirror(input: ApplyPointsInput, amount: number): void {
  if (!isNewPointsWritesEnabled() || amount === 0) return;
  const bag = pendingLegacyMirrors.getStore();
  if (!bag) {
    logger.error(
      "[points] legacy mirror not queued; wrap the writer in withLegacyPointsMirrorFlush",
      { userId: input.userId, idempotencyKey: input.idempotencyKey },
    );
    return;
  }
  bag.push({ input, amount });
}

function shouldInjectLegacyMirrorFailure(): boolean {
  if (process.env.POINTS_FAIL_LEGACY_MIRROR !== "true") return false;
  if ((process.env.DATABASE_URL ?? "").includes(PRODUCTION_NEON_HOST_ID)) {
    logger.error("[points] POINTS_FAIL_LEGACY_MIRROR ignored on production");
    return false;
  }
  return true;
}

async function flushLegacyMirror(job: LegacyMirrorJob): Promise<void> {
  try {
    if (shouldInjectLegacyMirrorFailure()) {
      throw new Error("POINTS_FAIL_LEGACY_MIRROR");
    }
    await writeClient().$transaction(
      async (tx) => {
        await writeLegacyWalletAndEvent(tx, job.input, job.amount);
      },
      { maxWait: 20000, timeout: 20000 },
    );
  } catch (err) {
    logger.error("[points] legacy mirror failed; new wallet kept", {
      userId: job.input.userId,
      idempotencyKey: job.input.idempotencyKey,
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });
  }
}

export type LegacySynergyMirror = {
  type: string;
  submissionId?: string | null;
  enrollmentId?: string | null;
  dayNumber?: number | null;
  createdByAdminId?: string | null;
};

export type ApplyPointsInput = {
  userId: string;
  /** Signed. Positive = credit, negative = debit. */
  amount: number;
  sourceType: PointsSourceType;
  sourceId?: string | null;
  idempotencyKey: string;
  reason?: string | null;
  createdByUserId?: string | null;
  mode: "credit" | "debit_strict" | "debit_clamp";
  legacyEvent?: LegacySynergyMirror;
};

export type ApplyPointsResult =
  | {
      ok: true;
      newBalance: number;
      appliedAmount: number;
      shortfall: number;
      duplicate: boolean;
    }
  | { ok: false; reason: "insufficient" | "not_found" };

export async function getBalance(
  userId: string,
  db: PointsReadClient = prisma,
): Promise<number> {
  if (isNewPointsRepoEnabled()) {
    const account = await db.pointsAccount.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return account?.balance ?? 0;
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { synergyPoints: true },
  });
  return user?.synergyPoints ?? 0;
}

/**
 * Lock the authoritative wallet row and return its balance. Used when creating
 * the StudentProfile synergy mirror at registration — not a spend/award.
 */
export async function lockWalletBalance(
  tx: Tx,
  userId: string,
): Promise<number> {
  if (isNewPointsWritesEnabled()) {
    const pa = await tx.pointsAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!pa) return 0;
    const locked = await tx.pointsAccount.update({
      where: { userId },
      data: { version: { increment: 0 } },
      select: { balance: true },
    });
    return locked.balance;
  }
  const user = await tx.user.update({
    where: { id: userId },
    data: { synergyPoints: { increment: 0 } },
    select: { synergyPoints: true },
  });
  return user.synergyPoints;
}

export async function submissionAwardTotal(
  tx: Tx,
  opts: { submissionIds: string[]; enrollmentId?: string },
): Promise<number> {
  if (isNewPointsWritesEnabled()) {
    if (opts.submissionIds.length === 0) return 0;
    const agg = await tx.pointsTransaction.aggregate({
      where: {
        sourceType: PointsSourceType.ACTIVITY_ATTEMPT,
        sourceId: { in: opts.submissionIds },
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }
  if (opts.enrollmentId) {
    const removed = await tx.synergyEvent.aggregate({
      where: { enrollmentId: opts.enrollmentId, type: "SUBMISSION" },
      _sum: { points: true },
    });
    return removed._sum.points ?? 0;
  }
  const submissionId = opts.submissionIds[0];
  if (!submissionId) return 0;
  const event = await tx.synergyEvent.findUnique({
    where: { submissionId },
    select: { points: true },
  });
  return event?.points ?? 0;
}

/**
 * Has this user already been paid submission synergy inside the given IST
 * calendar day? Flag-aware: reads the authoritative store for the current
 * cutover state. The positive-amount filter keeps reconciliation debits from
 * masking a genuine unpaid day. See plan 111.
 */
export async function hasEarnedSubmissionPointsOnIstDate(
  tx: Tx,
  opts: { userId: string; istDateKey: string },
): Promise<boolean> {
  const { startUtc, endExclusiveUtc } = istDateRangeToUtc(
    opts.istDateKey,
    opts.istDateKey,
  );
  if (!startUtc || !endExclusiveUtc) return false;
  const createdAt = { gte: startUtc, lt: endExclusiveUtc };

  if (isNewPointsWritesEnabled()) {
    const hit = await tx.pointsTransaction.findFirst({
      where: {
        userId: opts.userId,
        sourceType: PointsSourceType.ACTIVITY_ATTEMPT,
        amount: { gt: 0 },
        createdAt,
      },
      select: { id: true },
    });
    return hit !== null;
  }

  const hit = await tx.synergyEvent.findFirst({
    where: {
      userId: opts.userId,
      type: "SUBMISSION",
      points: { gt: 0 },
      createdAt,
    },
    select: { id: true },
  });
  return hit !== null;
}

export async function applyPointsChange(
  tx: Tx,
  input: ApplyPointsInput,
): Promise<ApplyPointsResult> {
  if (input.mode === "credit" && input.amount < 0) {
    throw new Error("applyPointsChange credit requires a non-negative amount");
  }
  if (input.mode !== "credit" && input.amount > 0) {
    throw new Error("applyPointsChange debit requires a non-positive amount");
  }

  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });
  if (!user) return { ok: false, reason: "not_found" };

  if (!isNewPointsWritesEnabled()) {
    return applyLegacyAuthoritative(tx, input);
  }
  return applyNewAuthoritative(tx, input);
}

async function applyLegacyAuthoritative(
  tx: Tx,
  input: ApplyPointsInput,
): Promise<ApplyPointsResult> {
  if (input.mode === "credit") {
    if (input.amount === 0) {
      return {
        ok: true,
        newBalance: await getBalance(input.userId, tx),
        appliedAmount: 0,
        shortfall: 0,
        duplicate: false,
      };
    }
    await writeLegacyEventOnly(tx, input, input.amount);
    await writeLegacyWalletOnly(tx, input.userId, input.amount);
    await dualWritePoints(tx, dualWritePayload(input, input.amount));
    return {
      ok: true,
      newBalance: await getBalance(input.userId, tx),
      appliedAmount: input.amount,
      shortfall: 0,
      duplicate: false,
    };
  }

  const requested = -input.amount;
  if (input.mode === "debit_strict") {
    const debit = await tx.user.updateMany({
      where: {
        id: input.userId,
        synergyPoints: { gte: requested },
      },
      data: { synergyPoints: { decrement: requested } },
    });
    if (debit.count === 0) return { ok: false, reason: "insufficient" };
    await tx.studentProfile.updateMany({
      where: { userId: input.userId },
      data: { synergyPoints: { decrement: requested } },
    });
    await writeLegacyEventOnly(tx, input, input.amount);
    await dualWritePoints(tx, dualWritePayload(input, input.amount));
    return {
      ok: true,
      newBalance: await getBalance(input.userId, tx),
      appliedAmount: input.amount,
      shortfall: 0,
      duplicate: false,
    };
  }

  const locked = await tx.user.update({
    where: { id: input.userId },
    data: { synergyPoints: { increment: 0 } },
    select: { synergyPoints: true },
  });
  const actualDebit = Math.min(requested, Math.max(locked.synergyPoints, 0));
  const shortfall = requested - actualDebit;
  if (actualDebit > 0) {
    await tx.user.update({
      where: { id: input.userId },
      data: { synergyPoints: { decrement: actualDebit } },
    });
    const profile = await tx.studentProfile.findUnique({
      where: { userId: input.userId },
      select: { synergyPoints: true },
    });
    if (profile) {
      await tx.studentProfile.update({
        where: { userId: input.userId },
        data: {
          synergyPoints: Math.max(0, profile.synergyPoints - actualDebit),
        },
      });
    }
    // Flag-off reset/reject never dual-wrote the clawback itself — only the
    // spent-shortfall recon credit below. Keep that shape until W1-A is on.
  }
  if (shortfall > 0) {
    const clampReason =
      input.reason ??
      "Clamped synergy to 0 after removing points that were already spent.";
    const event = await tx.synergyEvent.create({
      data: {
        userId: input.userId,
        points: shortfall,
        type: "BALANCE_RECONCILIATION",
        reason: clampReason,
      },
      select: { id: true },
    });
    await dualWritePoints(tx, {
      userId: input.userId,
      amount: shortfall,
      sourceType: PointsSourceType.RECONCILIATION,
      sourceId: event.id,
      idempotencyKey: `legacy:${event.id}`,
      reason: clampReason,
    });
  }
  return {
    ok: true,
    newBalance: await getBalance(input.userId, tx),
    appliedAmount: -actualDebit,
    shortfall,
    duplicate: false,
  };
}

async function applyNewAuthoritative(
  tx: Tx,
  input: ApplyPointsInput,
): Promise<ApplyPointsResult> {
  const existing = await tx.pointsTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, amount: true },
  });
  if (existing) {
    const balance = await accountBalance(tx, input.userId);
    return {
      ok: true,
      newBalance: balance,
      appliedAmount: existing.amount,
      shortfall: 0,
      duplicate: true,
    };
  }

  if (input.amount === 0) {
    return {
      ok: true,
      newBalance: await accountBalance(tx, input.userId),
      appliedAmount: 0,
      shortfall: 0,
      duplicate: false,
    };
  }

  await tx.pointsAccount.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      balance: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
    },
    update: { version: { increment: 0 } },
  });

  if (input.mode === "credit") {
    await tx.pointsAccount.update({
      where: { userId: input.userId },
      data: {
        balance: { increment: input.amount },
        lifetimeEarned: { increment: input.amount },
        version: { increment: 1 },
        reconciledAt: new Date(),
      },
    });
    await insertLedger(tx, input, input.amount);
    enqueueLegacyMirror(input, input.amount);
    return {
      ok: true,
      newBalance: await accountBalance(tx, input.userId),
      appliedAmount: input.amount,
      shortfall: 0,
      duplicate: false,
    };
  }

  const requested = -input.amount;
  if (input.mode === "debit_strict") {
    const debit = await tx.pointsAccount.updateMany({
      where: {
        userId: input.userId,
        balance: { gte: requested },
      },
      data: {
        balance: { decrement: requested },
        lifetimeSpent: { increment: requested },
        version: { increment: 1 },
        reconciledAt: new Date(),
      },
    });
    if (debit.count === 0) return { ok: false, reason: "insufficient" };
    await insertLedger(tx, input, input.amount);
    enqueueLegacyMirror(input, input.amount);
    return {
      ok: true,
      newBalance: await accountBalance(tx, input.userId),
      appliedAmount: input.amount,
      shortfall: 0,
      duplicate: false,
    };
  }

  const locked = await tx.pointsAccount.findUnique({
    where: { userId: input.userId },
    select: { balance: true },
  });
  const available = Math.max(locked?.balance ?? 0, 0);
  const actualDebit = Math.min(requested, available);
  const shortfall = requested - actualDebit;
  if (actualDebit > 0) {
    const debit = await tx.pointsAccount.updateMany({
      where: {
        userId: input.userId,
        balance: { gte: actualDebit },
      },
      data: {
        balance: { decrement: actualDebit },
        lifetimeSpent: { increment: actualDebit },
        version: { increment: 1 },
        reconciledAt: new Date(),
      },
    });
    if (debit.count === 0) {
      return {
        ok: true,
        newBalance: await accountBalance(tx, input.userId),
        appliedAmount: 0,
        shortfall: requested,
        duplicate: false,
      };
    }
    await insertLedger(tx, input, -actualDebit, {
      requested,
      applied: actualDebit,
      shortfall,
    });
    enqueueLegacyMirror(input, -actualDebit);
  }
  return {
    ok: true,
    newBalance: await accountBalance(tx, input.userId),
    appliedAmount: -actualDebit,
    shortfall,
    duplicate: false,
  };
}

async function insertLedger(
  tx: Tx,
  input: ApplyPointsInput,
  amount: number,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await tx.pointsTransaction.create({
    data: {
      userId: input.userId,
      amount,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      createdByUserId: input.createdByUserId,
      metadata: metadata ?? undefined,
    },
  });
}

async function accountBalance(tx: Tx, userId: string): Promise<number> {
  const row = await tx.pointsAccount.findUnique({
    where: { userId },
    select: { balance: true },
  });
  return row?.balance ?? 0;
}

function dualWritePayload(input: ApplyPointsInput, amount: number) {
  return {
    userId: input.userId,
    amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    createdByUserId: input.createdByUserId,
  };
}

async function writeLegacyWalletOnly(
  tx: Tx,
  userId: string,
  signedAmount: number,
): Promise<void> {
  if (signedAmount > 0) {
    await tx.user.update({
      where: { id: userId },
      data: { synergyPoints: { increment: signedAmount } },
    });
    await tx.studentProfile.updateMany({
      where: { userId },
      data: { synergyPoints: { increment: signedAmount } },
    });
  } else if (signedAmount < 0) {
    const debit = -signedAmount;
    await tx.user.update({
      where: { id: userId },
      data: { synergyPoints: { decrement: debit } },
    });
    await tx.studentProfile.updateMany({
      where: { userId },
      data: { synergyPoints: { decrement: debit } },
    });
  }
}

async function writeLegacyWalletAndEvent(
  tx: Tx,
  input: ApplyPointsInput,
  signedAmount: number,
): Promise<void> {
  await writeLegacyWalletOnly(tx, input.userId, signedAmount);
  await writeLegacyEventOnly(tx, input, signedAmount);
}

async function writeLegacyEventOnly(
  tx: Tx,
  input: ApplyPointsInput,
  signedAmount: number,
): Promise<void> {
  if (!input.legacyEvent || signedAmount === 0) return;
  await tx.synergyEvent.create({
    data: {
      userId: input.userId,
      points: signedAmount,
      type: input.legacyEvent.type,
      submissionId: input.legacyEvent.submissionId ?? undefined,
      enrollmentId: input.legacyEvent.enrollmentId ?? undefined,
      dayNumber: input.legacyEvent.dayNumber ?? undefined,
      reason: input.reason,
      createdByAdminId: input.legacyEvent.createdByAdminId ?? undefined,
    },
  });
}
