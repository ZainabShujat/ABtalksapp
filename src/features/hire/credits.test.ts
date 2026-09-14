/**
 * T-228 — the credit foundation.
 *
 * Two kinds of check live here, and both earn their place.
 *
 * The **pure** ones cover the rules that are arithmetic or policy: what $200 is
 * in minor units, what a missing price resolves to, what an idempotency key
 * looks like. They need no database and they never flake.
 *
 * The **source assertions** cover a class of rule a unit test structurally
 * cannot see. "The ledger is the source of truth" is not a function's return
 * value; it is a statement about which file reads which table, and the way it
 * gets broken is somebody, six months from now, reasonably deciding that
 * reading `CreditAccount.balance` is faster. A test that reads the source is
 * the only thing standing between that edit and a silent regression back to the
 * bare counter T-148 §2 prohibits.
 *
 * The guarantees that are genuinely the database's — the unique index, the row
 * lock, `WHERE balance + amount >= 0` — are proved against Postgres by
 * `npm run db:check:credit-ledger -- --prove`. Asserting them here against a
 * mock would prove only that the mock agrees with whoever wrote it.
 *
 * Run: npm run test:credits
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  creditLevel,
  formatCreditsMinor,
  formatCreditsSpelled,
} from "@/lib/credits-format";
import {
  CONTACT_UNLOCK_COST_KEY,
  PLATFORM_CONFIG_KEYS,
  resolveIntConfig,
  resolveStringConfig,
  STARTING_GRANT_KEY,
  CREDITS_CURRENCY_KEY,
} from "@/lib/platform-config";
import { onboardingGrantKey } from "@/repositories/credits";

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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const CREDITS_REPO = "src/repositories/credits.ts";
const CREDITS_FEATURE = "src/features/hire/credits.ts";
const SETUP_ACTION = "src/app/actions/recruiter-setup-actions.ts";
const SCHEMA = "prisma/schema.prisma";

console.log("\nT-228 credits foundation\n");

/* ─── the starting grant is $200, and it is a default, not a constant ────── */

console.log("Starting credits");

suite("the starting grant is $200.00, expressed in integer minor units", () => {
  const spec = PLATFORM_CONFIG_KEYS[STARTING_GRANT_KEY];
  assert(spec.kind === "int", "the starting grant must be an integer setting");
  assert(
    spec.default === 20_000,
    `expected 20000 minor units, got ${String(spec.default)}`,
  );
  assert(
    formatCreditsMinor(spec.default) === "$200.00",
    `20000 minor units must read as $200.00, got ${formatCreditsMinor(spec.default)}`,
  );
});

suite("a configured value overrides the default, with no deployment", () => {
  // What the database says wins. This is the whole feature: product moves the
  // grant to $100 by editing a row, and the next initialisation uses it.
  assert(
    resolveIntConfig(STARTING_GRANT_KEY, 10_000) === 10_000,
    "a configured 10000 must resolve to 10000",
  );
  assert(
    resolveIntConfig(STARTING_GRANT_KEY, 50_000) === 50_000,
    "a configured 50000 must resolve to 50000",
  );
});

suite("the grant amount is read from config, never hard-coded at the call site", () => {
  const repo = source(CREDITS_REPO);
  assert(
    repo.includes("getIntConfig(STARTING_GRANT_KEY)"),
    "grantOnboardingCredits must read the amount from PlatformConfig",
  );
  assert(
    !/amount:\s*20_?000/.test(repo),
    "the starting amount must not be written as a literal in the repository",
  );
  const action = source(SETUP_ACTION);
  assert(
    action.includes("getIntConfig(STARTING_GRANT_KEY)"),
    "the setup action must read the grant from config too",
  );
  assert(
    !/20_?000/.test(action),
    "the setup action must not carry the grant as a literal",
  );
});

suite("the grant is frozen into its ledger row with the config it came from", () => {
  const repo = source(CREDITS_REPO);
  assert(
    repo.includes("configKey: STARTING_GRANT_KEY") &&
      repo.includes("configValue: amount"),
    "the ledger row must record which config value produced it",
  );
});

/* ─── the unlock price fails closed ──────────────────────────────────────── */

console.log("\nUnlock price");

suite("a missing or unreadable price never becomes free", () => {
  const fallback = PLATFORM_CONFIG_KEYS[CONTACT_UNLOCK_COST_KEY].default;
  assert(fallback > 0, "the fallback unlock price must be greater than zero");

  const broken: (number | null | undefined)[] = [
    null,
    undefined,
    0,
    -1,
    -100_000,
    1_000_000_000,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    3.5,
  ];
  for (const raw of broken) {
    const resolved = resolveIntConfig(CONTACT_UNLOCK_COST_KEY, raw);
    assert(
      resolved === fallback,
      `${String(raw)} must fall back to ${fallback}, got ${resolved}`,
    );
    assert(resolved > 0, `${String(raw)} resolved to a free unlock (${resolved})`);
  }
});

suite("the price's own schema forbids zero", () => {
  assert(
    PLATFORM_CONFIG_KEYS[CONTACT_UNLOCK_COST_KEY].min >= 1,
    "a zero unlock price must not even be a configurable value",
  );
});

suite("the seeded price is labelled a placeholder, not a product decision", () => {
  const config = source("src/lib/platform-config.ts");
  assert(
    config.includes("PLACEHOLDER"),
    "the unlock price must say in the code that it is a placeholder",
  );
  assert(
    PLATFORM_CONFIG_KEYS[CONTACT_UNLOCK_COST_KEY].description.includes(
      "PLACEHOLDER",
    ),
    "the description written to the database row must say so too",
  );
});

suite("nothing in T-228 spends the unlock price", () => {
  const repo = source(CREDITS_REPO);
  assert(
    !repo.includes(CONTACT_UNLOCK_COST_KEY),
    "the ledger writer must not read the unlock price — that is T-229",
  );
});

suite("the currency falls back sanely too", () => {
  assert(resolveStringConfig(CREDITS_CURRENCY_KEY, null) === "USD", "null → USD");
  assert(resolveStringConfig(CREDITS_CURRENCY_KEY, "  ") === "USD", "blank → USD");
  assert(resolveStringConfig(CREDITS_CURRENCY_KEY, "INR") === "INR", "INR → INR");
});

/* ─── ledger arithmetic ──────────────────────────────────────────────────── */

console.log("\nLedger arithmetic");

/** The rule every row obeys, applied to a sequence, as the writer applies it. */
function replay(amounts: number[]) {
  let balance = 0;
  return amounts.map((amount) => {
    const balanceBefore = balance;
    balance += amount;
    return { amount, balanceBefore, balanceAfter: balance };
  });
}

suite("a positive movement raises the balance by exactly its amount", () => {
  const [row] = replay([20_000]);
  assert(row.balanceBefore === 0, "a first grant starts from zero");
  assert(row.balanceAfter === 20_000, "and lands on the amount granted");
  assert(row.balanceAfter - row.balanceBefore === row.amount, "arithmetic closes");
});

suite("a negative movement lowers it by exactly its amount", () => {
  const rows = replay([20_000, -1_000]);
  const debit = rows[1];
  assert(debit.balanceBefore === 20_000, "a debit starts from the previous balance");
  assert(debit.balanceAfter === 19_000, "and lands 1000 lower");
  assert(debit.balanceAfter - debit.balanceBefore === debit.amount, "arithmetic closes");
});

suite("balanceBefore/balanceAfter chain across a mixed sequence", () => {
  const amounts = [20_000, -1_000, -2_500, 5_000, -500, -15_000];
  const rows = replay(amounts);
  rows.forEach((row, i) => {
    assert(
      row.balanceAfter - row.balanceBefore === row.amount,
      `row ${i} does not close: ${JSON.stringify(row)}`,
    );
    assert(
      row.balanceBefore === (i === 0 ? 0 : rows[i - 1].balanceAfter),
      `row ${i} does not start where row ${i - 1} ended`,
    );
  });
  const sum = amounts.reduce((a, b) => a + b, 0);
  assert(
    rows[rows.length - 1].balanceAfter === sum,
    "the last balanceAfter must equal the sum of every amount",
  );
});

suite("the balance a read returns is the last row's balanceAfter", () => {
  // This is the shape `getCreditBalance` relies on: the newest row already
  // carries the answer, so an O(1) read is still a ledger-derived read.
  const rows = replay([20_000, -1_000, -2_500]);
  assert(rows[rows.length - 1].balanceAfter === 16_500, "expected 16500");
});

suite("amounts are integers — no floats on a money path", () => {
  const repo = source(CREDITS_REPO);
  assert(
    repo.includes("Number.isInteger(input.amount)"),
    "applyCreditChange must refuse a non-integer amount",
  );
  const schema = source(SCHEMA);
  const model = schema.slice(schema.indexOf("model CreditTransaction {"));
  assert(
    /amount\s+Int\b/.test(model.slice(0, model.indexOf("}"))),
    "CreditTransaction.amount must be Int",
  );
});

/* ─── idempotency keys ───────────────────────────────────────────────────── */

console.log("\nIdempotency");

suite("the onboarding key is deterministic and workspace-scoped", () => {
  assert(
    onboardingGrantKey("org_abc") === "grant:onboarding:org_abc",
    `unexpected key: ${onboardingGrantKey("org_abc")}`,
  );
  assert(
    onboardingGrantKey("org_abc") === onboardingGrantKey("org_abc"),
    "the key must be stable for one workspace",
  );
  assert(
    onboardingGrantKey("org_abc") !== onboardingGrantKey("org_xyz"),
    "two workspaces must never share a grant key",
  );
});

suite("exactly-once is a database constraint, not an application check", () => {
  const schema = source(SCHEMA);
  const model = schema.slice(
    schema.indexOf("model CreditTransaction {"),
    schema.indexOf("model CreditTransaction {") + 3_000,
  );
  assert(
    /idempotencyKey\s+String\s+@unique/.test(model),
    "CreditTransaction.idempotencyKey must be @unique",
  );
  const migration = source(
    "prisma/migrations/20260910120000_credit_ledger_and_platform_config/migration.sql",
  );
  assert(
    migration.includes(
      'CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key"',
    ),
    "the migration must create the unique index",
  );
});

suite("the unlock key namespace is reserved for T-229 and unused here", () => {
  const repo = source(CREDITS_REPO);
  assert(
    !repo.includes('"unlock:'),
    "T-228 must not consume the unlock idempotency namespace",
  );
});

/* ─── the ledger is the source of truth ──────────────────────────────────── */

console.log("\nThe ledger is the source of truth");

suite("no mutable balance column was added to any recruiter-facing model", () => {
  const schema = source(SCHEMA);
  for (const model of ["model Organization {", "model RecruiterProfile {", "model User {"]) {
    const start = schema.indexOf(model);
    assert(start > -1, `${model} not found`);
    const body = schema.slice(start, schema.indexOf("\n}", start));
    assert(
      !/credit(s)?(Balance)?\s+Int/i.test(body),
      `${model} must not carry a credit counter — that is Risk R17`,
    );
  }
});

suite("the authoritative read derives from CreditTransaction", () => {
  const repo = source(CREDITS_REPO);
  const fn = repo.slice(
    repo.indexOf("export async function getCreditBalance"),
    repo.indexOf("export async function sumLedgerBalance"),
  );
  assert(fn.includes("creditTransaction.findFirst"), "it must read the ledger");
  assert(fn.includes('orderBy: { seq: "desc" }'), "ordered by the ledger's total order");
  assert(fn.includes("balanceAfter"), "returning the row's own balanceAfter");
  assert(
    !fn.includes("creditAccount"),
    "the authoritative read must not consult the cached projection",
  );
});

suite("CreditAccount.balance is read nowhere outside the repository", () => {
  const offenders: string[] = [];
  for (const rel of [
    CREDITS_FEATURE,
    SETUP_ACTION,
    "src/features/hire/provision-recruiter.ts",
    "src/features/hire/entitlements.ts",
    "src/features/recruiter-workspace/workspace.ts",
  ]) {
    const text = source(rel);
    if (/creditAccount[\s\S]{0,200}?balance\s*:\s*true/.test(text)) {
      offenders.push(rel);
    }
  }
  assert(
    offenders.length === 0,
    `these files select the cached balance: ${offenders.join(", ")}`,
  );
});

suite("the schema says in its own comments that the cache is not the truth", () => {
  const schema = source(SCHEMA);
  const start = schema.indexOf("model CreditAccount {");
  const doc = schema.slice(Math.max(0, start - 1_400), start);
  assert(
    doc.includes("Not the source of truth") || doc.includes("not the source of truth"),
    "CreditAccount must document that it is a projection",
  );
  assert(
    doc.includes("SUM(CreditTransaction.amount)"),
    "and must name what the truth is",
  );
});

/* ─── exactly one writer ─────────────────────────────────────────────────── */

console.log("\nExactly one writer");

suite("only the repository and the setup action's batch write the ledger", () => {
  // The setup action writes the grant inline, in the same batched transaction
  // that creates the workspace — a deliberate, documented fast path for the one
  // case where the movement is fully known before the batch is sent. Any third
  // writer is a bug.
  const files = walk("src");
  const writers = files.filter((f) => {
    const text = readFileSync(f, "utf8");
    return /\.creditTransaction\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/.test(
      text,
    );
  });
  const allowed = new Set([
    join(process.cwd(), CREDITS_REPO),
    join(process.cwd(), SETUP_ACTION),
  ]);
  const extra = writers.filter((f) => !allowed.has(f));
  assert(extra.length === 0, `unexpected ledger writers: ${extra.join(", ")}`);
});

suite("the ledger is append-only — nothing updates or deletes a row", () => {
  const repo = source(CREDITS_REPO);
  assert(
    !/creditTransaction\.(update|updateMany|delete|deleteMany)/.test(repo),
    "a credit transaction must never be updated or deleted",
  );
});

suite("the write primitive accepts a caller's transaction (T-148 §4.4)", () => {
  const repo = source(CREDITS_REPO);
  assert(
    /export async function applyCreditChange\(\s*tx: Prisma\.TransactionClient/.test(
      repo,
    ),
    "applyCreditChange must take a caller-supplied transaction so T-229 can " +
      "commit the debit and the contact grant together",
  );
});

suite("the debit is a conditional decrement, not a read then a write", () => {
  const repo = source(CREDITS_REPO);
  assert(
    /"balance" \+ \$\{input\.amount\}(::int)? >= 0/.test(repo),
    "the UPDATE must carry the floor predicate",
  );
  assert(
    repo.includes('RETURNING "balance"'),
    "and must return the post-image the ledger row is built from",
  );
  assert(
    repo.includes("balanceBefore: balanceAfter - input.amount"),
    "balanceBefore must be derived from that post-image, not read separately",
  );
});

/* ─── credits never appear on a read path ────────────────────────────────── */

console.log("\nReads do not create money");

suite("the workspace façade grants nothing", () => {
  const feature = source(CREDITS_FEATURE);
  assert(
    !/grantOnboarding/.test(feature),
    "a credit read must never issue a grant",
  );
  assert(
    !/applyCreditChange/.test(feature),
    "a credit read must never move credits",
  );
});

suite("the grant lives where a workspace is created", () => {
  const provision = source("src/features/hire/provision-recruiter.ts");
  assert(
    provision.includes("grantOnboardingCredits(tx, {"),
    "provisionRecruiterIdentity must fund the workspace it creates",
  );
});

/* ─── setup performance ──────────────────────────────────────────────────── */

console.log("\nRecruiter setup");

suite("completeRecruiterSetupAction has no interactive transaction left", () => {
  const action = source(SETUP_ACTION);
  const start = action.indexOf("export async function completeRecruiterSetupAction");
  assert(start > -1, "the action was not found");
  const body = action.slice(start);
  assert(
    !/\$transaction\(\s*async/.test(body),
    "the interactive callback form is what cost ~8.6s; it must not return",
  );
  assert(
    /\$transaction\(\[/.test(body),
    "the batched array form must be used",
  );
});

suite("the setup success path still issues no revalidate", () => {
  const action = source(SETUP_ACTION);
  // The comment explaining its absence mentions it by name, so this looks for
  // a call and an import rather than the word.
  assert(
    !/revalidatePath\s*\(/.test(action),
    "revalidatePath here redirected the recruiter off the workspace-ready " +
      "screen a second after it appeared (T-226). It must stay out.",
  );
  assert(
    !/from\s+"next\/cache"/.test(action),
    "the setup action must not import next/cache at all",
  );
});

suite("T-226 is consumed, not re-implemented", () => {
  const action = source(SETUP_ACTION);
  assert(
    action.includes("recruiterWorkspaceSlug"),
    "the slug must come from provision-recruiter, not be rebuilt here",
  );
  const files = walk("src").filter((f) =>
    /recruiterWorkspaceSlug\s*\(\s*userId/.test(readFileSync(f, "utf8")),
  );
  assert(
    files.length === 1 &&
      files[0].endsWith(join("features", "hire", "provision-recruiter.ts")),
    `the slug must be defined in exactly one place, found: ${files.join(", ")}`,
  );
});

/* ─── nothing downstream moved ───────────────────────────────────────────── */

console.log("\nT-229 is not started, and neighbours are untouched");

suite("hasContactAccess is byte-identical to what T-148 §6 signed off", () => {
  const text = source("src/features/hire/contact-access.ts");
  const start = text.indexOf("export async function hasContactAccess");
  assert(start > -1, "hasContactAccess is gone");
  const body = text.slice(start, text.indexOf("\n}", start) + 2);
  const normalized = body.replace(/\s+/g, " ");
  assert(
    normalized.includes(
      'status: "CONTACT_SHARED", }, select: { id: true }, }); return shared !== null;',
    ),
    "hasContactAccess has changed; access must stay derived from " +
      "TalentEngagementRequest alone",
  );
  assert(
    !/credit/i.test(body),
    "contact access must not consult credits — credits gate the write, never the check",
  );
});

suite("entitlements.ts still fails closed", () => {
  const text = source("src/features/hire/entitlements.ts");
  assert(
    text.includes('reason: "NOT_IMPLEMENTED"') && text.includes("allowed: false"),
    "checkPlanLimit must still refuse; wiring it to a balance is T-033",
  );
  assert(
    !/creditAccount|creditTransaction|getCreditBalance/.test(text),
    "T-228 must not wire entitlements to the ledger",
  );
});

suite("the unlock key has exactly one definition", () => {
  // T-228 reserved this namespace and T-229 now uses it. What must stay true is
  // that one function mints it: a hand-rolled `unlock:...` string somewhere
  // else is a second key for the same movement, and two keys for one charge is
  // how a double-charge gets in past a unique index.
  const minters = walk("src")
    .filter((f) => !f.endsWith(".test.ts"))
    .filter((f) => /`unlock:\$\{/.test(readFileSync(f, "utf8")));
  assert(
    minters.length === 1 &&
      minters[0].endsWith(join("repositories", "credits.ts")),
    `the unlock key must be built in one place, found: ${minters.join(", ")}`,
  );
});

suite("the credit layer stays generic — it knows nothing about unlocking", () => {
  // Code only — the doc comment names TalentEngagementRequest precisely to
  // explain why this file does not touch it.
  const repo = stripComments(source(CREDITS_REPO));
  assert(
    !/hasContactAccess|talentEngagementRequest/i.test(repo),
    "the ledger must not reach into contact access; the unlock composes them",
  );
});

console.log("\nT-231 balance states");

suite("credit levels follow configured thresholds", () => {
  const t = { lowMinor: 5_000, veryLowMinor: 2_000 };
  assert(creditLevel(20_000, t, 1_000) === "normal", "$200 is normal");
  assert(creditLevel(5_000, t, 1_000) === "low", "$50 is low");
  assert(creditLevel(2_000, t, 1_000) === "very-low", "$20 is very low");
  assert(creditLevel(600, t, 1_000) === "empty", "$6 cannot afford a $10 unlock");
  assert(creditLevel(0, t, 1_000) === "empty", "$0 is empty");
});

suite("credits are spelled out for hover text", () => {
  assert(formatCreditsSpelled(20_000) === "200 credits", "20000 → 200 credits");
  assert(formatCreditsSpelled(100) === "1 credit", "singular");
});

suite("warning thresholds are configuration, not component constants", () => {
  assert(
    "credits.low_balance_threshold_minor" in PLATFORM_CONFIG_KEYS &&
      "credits.very_low_balance_threshold_minor" in PLATFORM_CONFIG_KEYS,
    "both thresholds must be registered in PlatformConfig",
  );
});

/* ─── helpers ────────────────────────────────────────────────────────────── */

function walk(rel: string): string[] {
  const root = join(process.cwd(), rel);
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
      } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
        out.push(full);
      }
    }
  }
  return out;
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
