/**
 * Child-only W1-A Points write-authority rehearsal.
 * Refuses the production Neon host. ENABLE_NEW_POINTS_WRITES=true here only.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { PointsSourceType } from "@prisma/client";
import {
  assertChildBranch,
  PRODUCTION_NEON_HOST_ID,
} from "./migrate-078-shared";

const TX_OPTS = { maxWait: 20000, timeout: 20000 } as const;

async function db() {
  const { writeClient } = await import("../../src/lib/db");
  return writeClient();
}

type Db = Awaited<ReturnType<typeof db>>;
let prisma: Db;

function log(label: string, value: unknown): void {
  process.stdout.write(
    `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

async function phase2Count(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
      FROM "PointsTransaction"
     WHERE "idempotencyKey" LIKE 'reconciliation:phase2:%'
  `;
  return Number(rows[0]?.n ?? 0);
}

async function txnCount(userId: string): Promise<number> {
  return prisma.pointsTransaction.count({ where: { userId } });
}

async function assertAccountLedgerParity(userId: string, label: string) {
  const pa = await prisma.pointsAccount.findUnique({
    where: { userId },
    select: { balance: true },
  });
  const ledger = await prisma.pointsTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  const sum = ledger._sum.amount ?? 0;
  if ((pa?.balance ?? 0) !== sum) {
    throw new Error(
      `${label}: PointsAccount.balance ${pa?.balance} !== SUM(PointsTransaction) ${sum}`,
    );
  }
}

async function assertLegacyMirrorParity(userId: string, label: string) {
  const pa = await prisma.pointsAccount.findUnique({
    where: { userId },
    select: { balance: true },
  });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { synergyPoints: true },
  });
  if ((pa?.balance ?? 0) !== (user?.synergyPoints ?? 0)) {
    throw new Error(
      `${label}: PointsAccount ${pa?.balance} !== User.synergyPoints ${user?.synergyPoints}`,
    );
  }
}

async function applyViaRepo(
  userId: string,
  input: {
    amount: number;
    mode: "credit" | "debit_strict" | "debit_clamp";
    sourceType: PointsSourceType;
    idempotencyKey: string;
    reason: string;
  },
) {
  const { applyPointsChange, withLegacyPointsMirrorFlush } = await import(
    "../../src/repositories/points"
  );
  return withLegacyPointsMirrorFlush(() =>
    prisma.$transaction(
      (tx) =>
      applyPointsChange(tx, {
        userId,
        amount: input.amount,
        mode: input.mode,
        sourceType: input.sourceType,
        sourceId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        legacyEvent:
          input.mode === "credit" &&
          input.sourceType === PointsSourceType.ADMIN_GRANT
            ? { type: "COMMUNITY_GRANT" }
            : input.mode === "debit_strict"
              ? { type: "REDEEM" }
              : input.sourceType === PointsSourceType.REDEMPTION_REFUND
                ? { type: "REDEEM_REFUND" }
                : undefined,
      }),
      TX_OPTS,
    ),
  );
}

async function cleanupUser(userId: string) {
  await prisma.pointsTransaction.deleteMany({ where: { userId } });
  await prisma.synergyEvent.deleteMany({ where: { userId } });
  await prisma.pointsAccount.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes(PRODUCTION_NEON_HOST_ID)) {
    throw new Error(
      "rehearse-078-points-writes refuses production. Point DATABASE_URL at a Neon child.",
    );
  }
  process.env.PHASE2_ALLOW_PRODUCTION = "";
  prisma = await db();
  assertChildBranch();

  const phase2Before = await phase2Count();
  const stamp = Date.now();
  const email = `w1a-points-${stamp}@abtalks.dev`;
  const failEmail = `w1a-points-fail-${stamp}@abtalks.dev`;
  const user = await prisma.user.create({
    data: { email, name: "W1A Points Rehearsal", synergyPoints: 0 },
    select: { id: true },
  });
  const failUser = await prisma.user.create({
    data: {
      email: failEmail,
      name: "W1A Points Mirror Fail",
      synergyPoints: 0,
    },
    select: { id: true },
  });
  const userId = user.id;
  const failUserId = failUser.id;
  log("test_user", userId);
  log("fail_user", failUserId);

  try {
    process.env.ENABLE_NEW_POINTS = "true";
    process.env.ENABLE_NEW_POINTS_WRITES = "true";
    process.env.ENABLE_DUAL_WRITE = process.env.ENABLE_DUAL_WRITE ?? "true";
    delete process.env.POINTS_FAIL_LEGACY_MIRROR;

    const grant = await applyViaRepo(userId, {
      amount: 100,
      mode: "credit",
      sourceType: PointsSourceType.ADMIN_GRANT,
      idempotencyKey: `rehearse-grant:${userId}`,
      reason: "W1-A grant",
    });
    if (!grant.ok || grant.newBalance !== 100 || grant.duplicate) {
      throw new Error(`grant failed: ${JSON.stringify(grant)}`);
    }
    await assertAccountLedgerParity(userId, "grant ledger");
    await assertLegacyMirrorParity(userId, "grant mirror");
    log("grant", grant);

    const grantTxnBefore = await txnCount(userId);
    const grantRetry = await applyViaRepo(userId, {
      amount: 100,
      mode: "credit",
      sourceType: PointsSourceType.ADMIN_GRANT,
      idempotencyKey: `rehearse-grant:${userId}`,
      reason: "W1-A grant retry",
    });
    if (!grantRetry.ok || !grantRetry.duplicate || grantRetry.newBalance !== 100) {
      throw new Error(`idempotent retry failed: ${JSON.stringify(grantRetry)}`);
    }
    if ((await txnCount(userId)) !== grantTxnBefore) {
      throw new Error("idempotent retry appended a second PointsTransaction");
    }
    await assertAccountLedgerParity(userId, "retry ledger");
    log("idempotent_retry", grantRetry);

    const spend = await applyViaRepo(userId, {
      amount: -30,
      mode: "debit_strict",
      sourceType: PointsSourceType.REDEMPTION,
      idempotencyKey: `rehearse-spend:${userId}`,
      reason: "W1-A spend",
    });
    if (!spend.ok || spend.newBalance !== 70) {
      throw new Error(`spend failed: ${JSON.stringify(spend)}`);
    }
    await assertAccountLedgerParity(userId, "spend ledger");
    await assertLegacyMirrorParity(userId, "spend mirror");
    log("spend", spend);

    const refund = await applyViaRepo(userId, {
      amount: 30,
      mode: "credit",
      sourceType: PointsSourceType.REDEMPTION_REFUND,
      idempotencyKey: `rehearse-refund:${userId}`,
      reason: "W1-A refund",
    });
    if (!refund.ok || refund.newBalance !== 100) {
      throw new Error(`refund failed: ${JSON.stringify(refund)}`);
    }
    await assertAccountLedgerParity(userId, "refund ledger");
    await assertLegacyMirrorParity(userId, "refund mirror");
    log("refund", refund);

    const debit = await applyViaRepo(userId, {
      amount: -40,
      mode: "debit_clamp",
      sourceType: PointsSourceType.RECONCILIATION,
      idempotencyKey: `rehearse-debit:${userId}`,
      reason: "W1-A debit",
    });
    if (!debit.ok || debit.newBalance !== 60) {
      throw new Error(`debit failed: ${JSON.stringify(debit)}`);
    }
    await assertAccountLedgerParity(userId, "debit ledger");
    await assertLegacyMirrorParity(userId, "debit mirror");
    log("debit", debit);

    const creditsBeforeReset = await prisma.pointsTransaction.count({
      where: { userId, amount: { gt: 0 } },
    });
    const reset = await applyViaRepo(userId, {
      amount: -10_000,
      mode: "debit_clamp",
      sourceType: PointsSourceType.RECONCILIATION,
      idempotencyKey: `rehearse-reset:${userId}`,
      reason: "W1-A reset",
    });
    if (!reset.ok || reset.newBalance !== 0 || reset.appliedAmount !== -60) {
      throw new Error(`reset failed: ${JSON.stringify(reset)}`);
    }
    const creditsAfterReset = await prisma.pointsTransaction.count({
      where: { userId, amount: { gt: 0 } },
    });
    if (creditsAfterReset !== creditsBeforeReset) {
      throw new Error("reset must not delete historical credit ledger rows");
    }
    const compensating = await prisma.pointsTransaction.findUnique({
      where: { idempotencyKey: `rehearse-reset:${userId}` },
      select: { amount: true, sourceType: true },
    });
    if (
      compensating?.sourceType !== PointsSourceType.RECONCILIATION ||
      compensating.amount !== -60
    ) {
      throw new Error(`reset compensating txn missing: ${JSON.stringify(compensating)}`);
    }
    await assertAccountLedgerParity(userId, "reset ledger");
    await assertLegacyMirrorParity(userId, "reset mirror");
    log("reset", reset);

    const raceGrant = await applyViaRepo(userId, {
      amount: 100,
      mode: "credit",
      sourceType: PointsSourceType.ADMIN_GRANT,
      idempotencyKey: `rehearse-race-seed:${userId}`,
      reason: "W1-A race seed",
    });
    if (!raceGrant.ok || raceGrant.newBalance !== 100) {
      throw new Error(`race seed failed: ${JSON.stringify(raceGrant)}`);
    }

    const [a, b] = await Promise.all([
      applyViaRepo(userId, {
        amount: -80,
        mode: "debit_strict",
        sourceType: PointsSourceType.REDEMPTION,
        idempotencyKey: `rehearse-race-a:${userId}`,
        reason: "W1-A race A",
      }),
      applyViaRepo(userId, {
        amount: -80,
        mode: "debit_strict",
        sourceType: PointsSourceType.REDEMPTION,
        idempotencyKey: `rehearse-race-b:${userId}`,
        reason: "W1-A race B",
      }),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    const losses = [a, b].filter((r) => !r.ok && r.reason === "insufficient").length;
    log("concurrent_overspend", { a, b, wins, losses });
    if (wins !== 1 || losses !== 1) {
      throw new Error(
        `concurrent overspend expected exactly one winner, got wins=${wins} losses=${losses}`,
      );
    }
    const raced = await prisma.pointsAccount.findUnique({
      where: { userId },
      select: { balance: true },
    });
    if (raced?.balance !== 20) {
      throw new Error(`concurrent balance expected 20, got ${raced?.balance}`);
    }
    await assertAccountLedgerParity(userId, "concurrent ledger");
    log("concurrent_balance", raced.balance);

    process.env.POINTS_FAIL_LEGACY_MIRROR = "true";
    const failGrant = await applyViaRepo(failUserId, {
      amount: 25,
      mode: "credit",
      sourceType: PointsSourceType.ADMIN_GRANT,
      idempotencyKey: `rehearse-fail-mirror:${failUserId}`,
      reason: "W1-A injected mirror failure",
    });
    delete process.env.POINTS_FAIL_LEGACY_MIRROR;
    if (!failGrant.ok || failGrant.newBalance !== 25) {
      throw new Error(`mirror-fail grant should succeed: ${JSON.stringify(failGrant)}`);
    }
    const failPa = await prisma.pointsAccount.findUnique({
      where: { userId: failUserId },
      select: { balance: true },
    });
    const failUserRow = await prisma.user.findUnique({
      where: { id: failUserId },
      select: { synergyPoints: true },
    });
    const failLedger = await prisma.pointsTransaction.aggregate({
      where: { userId: failUserId },
      _sum: { amount: true },
    });
    if (failPa?.balance !== 25 || (failLedger._sum.amount ?? 0) !== 25) {
      throw new Error("injected mirror failure rolled back the new wallet");
    }
    if ((failUserRow?.synergyPoints ?? 0) !== 0) {
      throw new Error("legacy mirror should have stayed at 0 after injected failure");
    }
    log("legacy_mirror_failure", {
      pointsAccount: failPa.balance,
      ledgerSum: Number(failLedger._sum.amount ?? 0),
      userSynergyPoints: failUserRow?.synergyPoints ?? 0,
    });

    const phase2After = await phase2Count();
    if (phase2After !== phase2Before) {
      throw new Error(
        `phase2 recon rows changed: ${phase2Before} → ${phase2After}`,
      );
    }
    log("phase2_recon_untouched", phase2After);
    log("rehearsal", "ok");
  } finally {
    delete process.env.POINTS_FAIL_LEGACY_MIRROR;
    await cleanupUser(userId);
    await cleanupUser(failUserId);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
