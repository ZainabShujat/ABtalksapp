/**
 * One-shot W1-A production probe: +1 ADMIN_GRANT through applyPointsChange.
 *
 * Requires PHASE2_ALLOW_PRODUCTION=1, production direct DATABASE_URL,
 * ENABLE_NEW_POINTS_WRITES=true. Does not stop mirrors. Does not start W2.
 *
 * Target: W1A_GRANT_EMAIL (default arjun@abtalks.dev) — must already exist
 * with a StudentProfile. Does not create or delete users.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

if (process.env.DATABASE_URL?.includes("-pooler.")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace("-pooler.", ".");
}

import { PointsSourceType } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";
import { isNewPointsWritesEnabled } from "../../src/lib/feature-flags";

const TARGET_EMAIL =
  process.env.W1A_GRANT_EMAIL?.trim() || "arjun@abtalks.dev";
const TX_OPTS = { maxWait: 20000, timeout: 20000 } as const;

type Snapshot = {
  paBalance: number | null;
  paVersion: number | null;
  txnCount: number;
  userSynergy: number | null;
  profileSynergy: number | null;
  eventCount: number;
};

async function main() {
  process.env.ENABLE_NEW_POINTS_WRITES = "true";
  process.env.ENABLE_NEW_POINTS = "true";
  process.env.ENABLE_DUAL_WRITE = "true";

  assertChildBranch();
  if (!isNewPointsWritesEnabled()) {
    throw new Error("ENABLE_NEW_POINTS_WRITES must be true for this probe");
  }

  const { writeClient } = await import("../../src/lib/db");
  const { applyPointsChange, withLegacyPointsMirrorFlush } = await import(
    "../../src/repositories/points"
  );
  const prisma = writeClient();

  async function snapshot(userId: string): Promise<Snapshot> {
    const [pa, txnCount, user, profile, eventCount] = await Promise.all([
      prisma.pointsAccount.findUnique({
        where: { userId },
        select: { balance: true, version: true },
      }),
      prisma.pointsTransaction.count({ where: { userId } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { synergyPoints: true },
      }),
      prisma.studentProfile.findUnique({
        where: { userId },
        select: { synergyPoints: true },
      }),
      prisma.synergyEvent.count({ where: { userId } }),
    ]);
    return {
      paBalance: pa?.balance ?? null,
      paVersion: pa?.version ?? null,
      txnCount,
      userSynergy: user?.synergyPoints ?? null,
      profileSynergy: profile?.synergyPoints ?? null,
      eventCount,
    };
  }

  let target = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: {
      id: true,
      email: true,
      studentProfile: { select: { id: true } },
    },
  });
  if (!target?.studentProfile) {
    target = await prisma.user.findFirst({
      where: {
        email: { endsWith: "@abtalks.dev" },
        studentProfile: { isNot: null },
      },
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        studentProfile: { select: { id: true } },
      },
    });
  }
  if (!target?.studentProfile) {
    throw new Error(
      `Probe refused: no @abtalks.dev user with StudentProfile (tried ${TARGET_EMAIL})`,
    );
  }

  const before = await snapshot(target.id);
  const idempotencyKey = `w1a-prod-grant:+1:${target.id}:${Date.now()}`;

  const applied = await withLegacyPointsMirrorFlush(() =>
    prisma.$transaction(
      (tx) =>
        applyPointsChange(tx, {
          userId: target.id,
          amount: 1,
          mode: "credit",
          sourceType: PointsSourceType.ADMIN_GRANT,
          sourceId: idempotencyKey,
          idempotencyKey,
          reason: "W1-A production write-authority probe (+1)",
          legacyEvent: { type: "COMMUNITY_GRANT" },
        }),
      TX_OPTS,
    ),
  );

  const after = await snapshot(target.id);
  const report = {
    email: target.email,
    userId: target.id,
    idempotencyKey,
    applied,
    before,
    after,
    deltas: {
      paBalance: (after.paBalance ?? 0) - (before.paBalance ?? 0),
      txnCount: after.txnCount - before.txnCount,
      userSynergy: (after.userSynergy ?? 0) - (before.userSynergy ?? 0),
      profileSynergy:
        (after.profileSynergy ?? 0) - (before.profileSynergy ?? 0),
      eventCount: after.eventCount - before.eventCount,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  if (!applied.ok || applied.duplicate || applied.appliedAmount !== 1) {
    throw new Error(`grant did not apply +1: ${JSON.stringify(applied)}`);
  }
  if (report.deltas.paBalance !== 1) {
    throw new Error(`PointsAccount did not change by +1: ${report.deltas.paBalance}`);
  }
  if (report.deltas.txnCount !== 1) {
    throw new Error(`expected exactly one PointsTransaction, got ${report.deltas.txnCount}`);
  }
  if (after.userSynergy !== after.paBalance) {
    throw new Error(
      `User.synergyPoints ${after.userSynergy} !== PointsAccount ${after.paBalance}`,
    );
  }
  if (after.profileSynergy !== after.paBalance) {
    throw new Error(
      `StudentProfile.synergyPoints ${after.profileSynergy} !== PointsAccount ${after.paBalance}`,
    );
  }
  if (report.deltas.eventCount !== 1) {
    throw new Error(`expected exactly one SynergyEvent, got ${report.deltas.eventCount}`);
  }
  console.log("W1-A production +1 grant probe passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
