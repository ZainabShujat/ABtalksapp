/**
 * W1-A Points write-authority source scans.
 * Run: npm run test:078-points-writes
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNewPointsWritesEnabled } from "@/lib/feature-flags";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

function source(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

suite("ENABLE_NEW_POINTS_WRITES defaults off", () => {
  const prev = process.env.ENABLE_NEW_POINTS_WRITES;
  delete process.env.ENABLE_NEW_POINTS_WRITES;
  assert(isNewPointsWritesEnabled() === false, "unset is false");
  process.env.ENABLE_NEW_POINTS_WRITES = "false";
  assert(isNewPointsWritesEnabled() === false, "false is false");
  process.env.ENABLE_NEW_POINTS_WRITES = "true";
  assert(isNewPointsWritesEnabled() === true, "true is true");
  if (prev === undefined) delete process.env.ENABLE_NEW_POINTS_WRITES;
  else process.env.ENABLE_NEW_POINTS_WRITES = prev;
});

suite("flag helper is explicit === true", () => {
  const src = source("src/lib/feature-flags.ts");
  assert(src.includes("isNewPointsWritesEnabled"), "helper");
  assert(
    src.includes('process.env.ENABLE_NEW_POINTS_WRITES === "true"'),
    "strict true",
  );
});

suite("every balance writer goes through applyPointsChange", () => {
  const files = [
    "src/features/marketplace/redeem-item.ts",
    "src/features/synergy/award-submission-synergy.ts",
    "src/features/synergy/award-referral-synergy.ts",
    "src/app/actions/admin-redemption-actions.ts",
    "src/app/actions/admin-actions.ts",
  ];
  for (const file of files) {
    const src = source(file);
    assert(src.includes("applyPointsChange"), `${file} missing applyPointsChange`);
    assert(!src.includes("dualWritePoints"), `${file} must not call dualWritePoints`);
  }
});

suite("legacy User guard and new PointsAccount guard both live in points.ts", () => {
  const src = source("src/repositories/points.ts");
  assert(src.includes("isNewPointsWritesEnabled"), "write flag");
  assert(src.includes("synergyPoints: { gte: requested }"), "legacy strict debit");
  assert(src.includes("balance: { gte: requested }"), "atomic account debit");
  assert(src.includes("legacy mirror failed; new wallet kept"), "mirror failure log");
  assert(src.includes("withLegacyPointsMirrorFlush"), "post-commit mirror flush");
  assert(src.includes("POINTS_FAIL_LEGACY_MIRROR"), "rehearsal inject");
});

suite("points.ts does not mutate phase2 recon keys", () => {
  const src = source("src/repositories/points.ts");
  assert(!src.includes("reconciliation:phase2"), "do not touch phase2 keys");
});

suite("reset/reject do not aggregate SynergyEvent as authority", () => {
  const src = source("src/app/actions/admin-actions.ts");
  assert(src.includes("submissionAwardTotal"), "clawback helper");
  assert(!src.includes("synergyEvent.aggregate"), "no event sum");
  assert(!src.includes("synergyEvent.findUnique"), "no event find for reject");
  assert(src.includes('mode: "debit_clamp"'), "compensating clamp");
  assert(src.includes("PointsSourceType.RECONCILIATION"), "append-only recon");
});

suite("redeem uses preallocated id then applyPointsChange", () => {
  const src = source("src/features/marketplace/redeem-item.ts");
  assert(src.includes("randomUUID"), "preallocate");
  assert(src.includes('mode: "debit_strict"'), "strict spend");
  assert(!src.includes("synergyPoints: { gte"), "no User guard in redeem");
});

suite("dual-write helpers stay free of ENABLE_NEW_POINTS_WRITES", () => {
  const src = source("src/repositories/dual-write.ts");
  assert(!src.includes("ENABLE_NEW_POINTS_WRITES"), "no write-authority flag");
  assert(!src.includes("ENABLE_NEW_"), "no new-read flags");
});

suite("idempotent retry does not re-queue a legacy mirror increment", () => {
  const src = source("src/repositories/points.ts");
  const idx = src.indexOf("if (existing)");
  const slice = src.slice(idx, idx + 400);
  assert(slice.includes("duplicate: true"), "duplicate result");
  assert(!slice.includes("enqueueLegacyMirror"), "no second mirror increment");
});

suite("registration locks wallet through lockWalletBalance", () => {
  const src = source("src/features/registration/complete-registration.ts");
  assert(src.includes("lockWalletBalance"), "lock helper");
});

suite("flag-on lockWalletBalance does not fall through to User", () => {
  const src = source("src/repositories/points.ts");
  const start = src.indexOf("export async function lockWalletBalance");
  const end = src.indexOf("export async function submissionAwardTotal");
  const slice = src.slice(start, end);
  const flagOn = slice.slice(
    slice.indexOf("if (isNewPointsWritesEnabled())"),
    slice.indexOf("const user = await tx.user.update"),
  );
  assert(slice.includes("isNewPointsWritesEnabled"), "write flag");
  assert(flagOn.includes("if (!pa) return 0"), "missing account is 0");
  assert(!flagOn.includes("synergyPoints"), "flag-on branch never reads User");
  assert(
    slice.includes("synergyPoints: { increment: 0 }"),
    "flag-off rollback still locks User",
  );
});

suite("outermost balance writers flush legacy mirrors after commit", () => {
  const files = [
    "src/features/marketplace/redeem-item.ts",
    "src/app/actions/admin-redemption-actions.ts",
    "src/app/actions/admin-actions.ts",
    "src/features/submission/submit-day.ts",
    "src/features/registration/complete-registration.ts",
  ];
  for (const file of files) {
    const src = source(file);
    assert(
      src.includes("withLegacyPointsMirrorFlush"),
      `${file} missing withLegacyPointsMirrorFlush`,
    );
  }
});

async function asyncSuite(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

function fakeTx(opts: {
  account: { id: string; balance: number } | null;
  userSynergy: number;
}) {
  let userLocked = false;
  const tx = {
    pointsAccount: {
      findUnique: async () =>
        opts.account ? { id: opts.account.id } : null,
      update: async () => {
        if (!opts.account) throw new Error("no PointsAccount to lock");
        return { balance: opts.account.balance };
      },
    },
    user: {
      update: async () => {
        userLocked = true;
        return { synergyPoints: opts.userSynergy };
      },
    },
  };
  return { tx, wasUserLocked: () => userLocked };
}

async function runBehavioralLockTests() {
  const { lockWalletBalance } = await import("./points");
  const prev = process.env.ENABLE_NEW_POINTS_WRITES;

  await asyncSuite(
    "flag-on missing PointsAccount returns 0 even if User.synergyPoints > 0",
    async () => {
      process.env.ENABLE_NEW_POINTS_WRITES = "true";
      const { tx, wasUserLocked } = fakeTx({
        account: null,
        userSynergy: 99,
      });
      const result = await lockWalletBalance(tx as never, "user-1");
      assert(result === 0, `expected 0, got ${result}`);
      assert(!wasUserLocked(), "must not treat User.synergyPoints as authority");
    },
  );

  await asyncSuite(
    "flag-on existing PointsAccount returns account balance, not User",
    async () => {
      process.env.ENABLE_NEW_POINTS_WRITES = "true";
      const { tx, wasUserLocked } = fakeTx({
        account: { id: "pa-1", balance: 7 },
        userSynergy: 99,
      });
      const result = await lockWalletBalance(tx as never, "user-1");
      assert(result === 7, `expected 7, got ${result}`);
      assert(!wasUserLocked(), "must not lock User when account exists");
    },
  );

  await asyncSuite(
    "flag-off lockWalletBalance still uses User.synergyPoints",
    async () => {
      process.env.ENABLE_NEW_POINTS_WRITES = "false";
      const { tx, wasUserLocked } = fakeTx({
        account: null,
        userSynergy: 99,
      });
      const result = await lockWalletBalance(tx as never, "user-1");
      assert(result === 99, `expected 99, got ${result}`);
      assert(wasUserLocked(), "flag-off rollback still locks User");
    },
  );

  if (prev === undefined) delete process.env.ENABLE_NEW_POINTS_WRITES;
  else process.env.ENABLE_NEW_POINTS_WRITES = prev;
}

void runBehavioralLockTests()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
