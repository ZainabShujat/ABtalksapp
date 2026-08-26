/**
 * 078 Phase 2f — SynergyEvent → PointsTransaction; User.synergyPoints → PointsAccount.
 */
import { config } from "dotenv";
import { PointsSourceType, PrismaClient } from "@prisma/client";
import {
  assertChildBranch,
  chunked,
  resolveSampleUserIds,
  runStep,
  whereUserId,
} from "./migrate-078-shared";
import { bulkUpsertBatched } from "./migrate-078-bulk";

const prisma = new PrismaClient();

function parseId(reason: string | null, key: string): string | null {
  if (!reason) return null;
  const m = reason.match(new RegExp(`${key}=([^,)\\s]+)`));
  return m?.[1] ?? null;
}

function mapType(type: string): PointsSourceType {
  switch (type) {
    case "SUBMISSION":
      return PointsSourceType.ACTIVITY_ATTEMPT;
    case "REFERRAL":
      return PointsSourceType.REFERRAL;
    case "REDEEM":
      return PointsSourceType.REDEMPTION;
    case "REDEEM_REFUND":
      return PointsSourceType.REDEMPTION_REFUND;
    case "COMMUNITY_GRANT":
      return PointsSourceType.ADMIN_GRANT;
    case "BALANCE_RECONCILIATION":
      return PointsSourceType.RECONCILIATION;
    default:
      return PointsSourceType.LEGACY;
  }
}

function idempotencyKey(row: {
  id: string;
  type: string;
  submissionId: string | null;
  reason: string | null;
}): string {
  if (row.type === "SUBMISSION" && row.submissionId) {
    return `submission:${row.submissionId}`;
  }
  if (row.type === "REFERRAL") {
    const id = parseId(row.reason, "referralId");
    if (id) return `referral:${id}`;
  }
  if (row.type === "REDEEM" || row.type === "REDEEM_REFUND") {
    const id = parseId(row.reason, "redemptionId");
    if (id) return row.type === "REDEEM" ? `redeem:${id}` : `redeem-refund:${id}`;
  }
  return `legacy:${row.id}`;
}

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2f-points", async (ctx) => {
    const sample = await resolveSampleUserIds(ctx.prisma);
    const uw = whereUserId(sample);
    const events = await ctx.prisma.synergyEvent.findMany({ where: uw });
    const usedKeys = new Set<string>();
    const txRows = events.map((e) => {
      let key = idempotencyKey(e);
      if (usedKeys.has(key)) key = `legacy:${e.id}`;
      usedKeys.add(key);
      return {
        id: `pt_${e.id}`,
        userId: e.userId,
        amount: e.points,
        sourceType: mapType(e.type),
        sourceId: e.submissionId ?? parseId(e.reason, "referralId") ?? parseId(e.reason, "redemptionId"),
        idempotencyKey: key,
        reason: e.reason,
        createdAt: e.createdAt,
        createdByUserId: e.createdByAdminId,
      };
    });
    let copied = 0;
    await chunked(txRows, 200, async (chunk) => {
      const r = await ctx.prisma.pointsTransaction.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      copied += r.count;
    });

    const users = await ctx.prisma.user.findMany({
      where: sample ? { id: { in: sample } } : undefined,
      select: { id: true, synergyPoints: true },
    });
    const ledger = await ctx.prisma.pointsTransaction.groupBy({
      by: ["userId"],
      where: sample ? { userId: { in: sample } } : undefined,
      _sum: { amount: true },
    });
    const ledgerByUser = new Map(ledger.map((l) => [l.userId, l._sum.amount ?? 0]));

    const now = new Date();
    const accountRows = users.map((u) => {
      const sum = ledgerByUser.get(u.id) ?? 0;
      return {
        id: `pa_${u.id}`,
        userId: u.id,
        balance: u.synergyPoints,
        lifetimeEarned: Math.max(0, sum),
        lifetimeSpent: sum < 0 ? -sum : 0,
        reconciledAt: now,
        updatedAt: now,
      };
    });
    const reconRows = users
      .filter((u) => (ledgerByUser.get(u.id) ?? 0) !== u.synergyPoints)
      .map((u) => {
        const sum = ledgerByUser.get(u.id) ?? 0;
        return {
          id: `pt_recon_${u.id}`,
          userId: u.id,
          amount: u.synergyPoints - sum,
          sourceType: PointsSourceType.RECONCILIATION,
          sourceId: u.id,
          idempotencyKey: `reconciliation:phase2:${u.id}`,
          reason: "phase2 backfill recon to User.synergyPoints",
        };
      });
    await bulkUpsertBatched(ctx.prisma, {
      label: "2f-accounts",
      table: "PointsAccount",
      cursorField: "userId",
      rows: accountRows,
      conflict: ["userId"],
      update: [
        "balance",
        "lifetimeEarned",
        "lifetimeSpent",
        "reconciledAt",
        "updatedAt",
      ],
    });
    await bulkUpsertBatched(ctx.prisma, {
      label: "2f-recon",
      table: "PointsTransaction",
      cursorField: "id",
      rows: reconRows,
      conflict: ["idempotencyKey"],
      update: ["amount"],
      casts: { sourceType: '"PointsSourceType"' },
    });
    const accounts = accountRows.length;
    const recon = reconRows.length;

    return { transactions: copied, accounts, reconciliations: recon };
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
