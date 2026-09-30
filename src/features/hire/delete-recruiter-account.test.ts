/**
 * Plan 160 — permanent recruiter account deletion.
 *
 * The headline test is the coverage one: the purge keeps the User and the
 * Organization rows (the credit ledger's RESTRICT foreign keys make deleting
 * them impossible), so NONE of the cascades that would normally clean a
 * recruiter's data will fire. Every child table has to be named explicitly, and
 * a schema that grows a new recruiter-owned table must fail here rather than
 * quietly leak rows.
 *
 * Run: npm run test:recruiter-delete
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/** Source with comments and string literals stripped, so assertions read code. */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const PURGE = "src/features/hire/delete-recruiter-account.ts";
const purge = source(PURGE);
const purgeCode = code(PURGE);

/** camelCase model name, as Prisma exposes it on the client. */
function client(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

type Rel = { model: string; field: string; target: string; onDelete: string };

function schemaRelations(): Rel[] {
  const schema = source("prisma/schema.prisma");
  const models = [...schema.matchAll(/\nmodel (\w+) \{([\s\S]*?)\n\}/g)];
  const out: Rel[] = [];
  for (const [, model, body] of models) {
    for (const line of (body ?? "").split("\n")) {
      if (!line.includes("references: [id]")) continue;
      const target = line.trim().split(/\s+/)[1]?.replace(/[?[\]]/g, "") ?? "";
      const field = /fields:\s*\[([^\]]+)\]/.exec(line)?.[1]?.trim() ?? "";
      const onDelete = /onDelete:\s*(\w+)/.exec(line)?.[1] ?? "Restrict";
      out.push({ model: model ?? "", field, target, onDelete });
    }
  }
  return out;
}

console.log("\nPlan 160 — recruiter account deletion");

// =========================================================================
// 1. Coverage — the reason this suite exists
// =========================================================================

suite("every Organization-cascading table is deleted by name", () => {
  // These rows would be removed by `ON DELETE CASCADE` if the Organization were
  // deleted. It is not — the ledger's RESTRICT keys forbid it — so the purge
  // has to name each one. A table added later lands here.
  const owned = schemaRelations().filter(
    (r) => r.target === "Organization" && r.onDelete === "Cascade",
  );
  assert(owned.length > 0, "the schema parser found no Organization children");

  const missing = owned
    .map((r) => r.model)
    // OrganizationMember is deleted by userId below, not by organizationId.
    .filter((m) => m !== "OrganizationMember")
    .filter((m) => !purgeCode.includes(`tx.${client(m)}.deleteMany`));

  assert(
    missing.length === 0,
    `these Organization-owned tables are never deleted, so their rows leak: ${missing.join(", ")}`,
  );
});

suite("every recruiter-owned table on User is deleted by name", () => {
  // Same argument on the other side: the User row survives, so its cascades
  // never fire either.
  const owned = schemaRelations().filter(
    (r) => r.target === "User" && r.onDelete === "Cascade" && /recruiter/i.test(r.field),
  );
  assert(owned.length > 0, "the schema parser found no recruiter-owned tables");

  const missing = owned
    .map((r) => r.model)
    .filter((m) => !purgeCode.includes(`tx.${client(m)}.deleteMany`));

  assert(
    missing.length === 0,
    `these recruiter-owned tables are never deleted, so their rows leak: ${missing.join(", ")}`,
  );
});

suite("the recruiter identity rows themselves are removed", () => {
  for (const model of ["recruiterProfile", "organizationMember"]) {
    assert(
      purgeCode.includes(`tx.${model}.deleteMany`),
      `${model} must be deleted — otherwise the account is still a recruiter`,
    );
  }
  assert(
    purgeCode.includes("tx.account.deleteMany") &&
      purgeCode.includes("tx.session.deleteMany"),
    "the OAuth link and live sessions must go with the account",
  );
});

// =========================================================================
// 2. The ledger is not touched
// =========================================================================

suite("no credit row is ever created, updated or deleted", () => {
  for (const forbidden of [
    "creditTransaction.delete",
    "creditTransaction.deleteMany",
    "creditTransaction.update",
    "creditTransaction.updateMany",
    "creditTransaction.create",
    "creditAccount.delete",
    "creditAccount.deleteMany",
    "creditAccount.update",
  ]) {
    assert(
      !purgeCode.includes(forbidden),
      `${forbidden} would break an append-only, financial-grade ledger`,
    );
  }
  // Reading it is how the purchased-balance guard works.
  assert(
    purgeCode.includes("creditTransaction.aggregate"),
    "the purchased balance must be read to enforce the self-delete guard",
  );
});

suite("the User and Organization rows are kept, not deleted", () => {
  assert(
    !purgeCode.includes("tx.user.delete(") && !purgeCode.includes("tx.user.deleteMany"),
    "user.delete() is refused by CreditTransaction.recruiterUserId (RESTRICT)",
  );
  assert(
    !purgeCode.includes("tx.organization.delete"),
    "organization.delete() is refused by CreditAccount/CreditTransaction (RESTRICT)",
  );
  assert(
    purgeCode.includes("tx.organization.update"),
    "the surviving workspace must be stripped of company identity",
  );
});

// =========================================================================
// 3. Guards
// =========================================================================

suite("a platform admin cannot be deleted from either surface", () => {
  assert(
    purgeCode.includes("PlatformRole.ADMIN") && purgeCode.includes("RoleScopeType.GLOBAL"),
    "the platform-admin refusal must be present",
  );
});

suite("an admin cannot delete themselves here", () => {
  assert(
    purgeCode.includes("byAdmin && userId === actorUserId"),
    "self-deletion by an admin must be refused",
  );
});

suite("a non-recruiter account is refused", () => {
  assert(
    purgeCode.includes("tx.recruiterProfile.findUnique"),
    "the routine must confirm this is a recruiter before purging",
  );
  assert(
    purge.includes("This is not a recruiter account."),
    "and say so plainly",
  );
});

suite("an already-deleted account is refused", () => {
  assert(purgeCode.includes("user.deletedAt"), "deletedAt must be checked");
});

suite("purchased credits block self-delete but not an admin", () => {
  assert(
    purgeCode.includes("!byAdmin && purchasedMinor > 0 && balanceMinor > 0"),
    "the guard must apply only to the self-service path",
  );
});

suite("the disabled-button balance uses the same condition as the guard", () => {
  // A UI that disagreed with the server would either dead-end the recruiter or
  // promise a deletion the server then refuses.
  assert(
    purgeCode.includes("purchasedMinor > 0 && balanceMinor > 0 ? balanceMinor : 0"),
    "blockingPurchasedBalanceMinor must mirror guard 4 exactly",
  );
});

// =========================================================================
// 4. Audit
// =========================================================================

suite("the audit row is written before the wipe and inside the transaction", () => {
  const audit = purgeCode.indexOf("writeAudit(tx");
  const userWipe = purgeCode.indexOf("tx.user.update");
  const orgWipe = purgeCode.indexOf("tx.organization.update");
  assert(audit > 0, "an audit row must be written");
  assert(
    audit < userWipe && audit < orgWipe,
    "after the wipe the company name and email domain are no longer readable",
  );
});

suite("the audit records the email domain, never the address", () => {
  assert(purgeCode.includes("emailDomain"), "the domain must be recorded");
  const previous = purgeCode.slice(
    purgeCode.indexOf("previousState: {"),
    purgeCode.indexOf("newState:"),
  );
  assert(
    !/\bemail\b(?!Domain)/.test(previous),
    "the full address must not be written to the audit row",
  );
});

suite("the audit says who did it and that the ledger survived", () => {
  assert(purgeCode.includes("byAdmin"), "the audit must distinguish the two paths");
  assert(
    purge.includes('actionType: "RECRUITER_ACCOUNT_DELETED"'),
    "the action type must name what happened",
  );
});

// =========================================================================
// 5. Anonymisation
// =========================================================================

suite("the account is stripped of every credential", () => {
  const wipe = purgeCode.slice(purgeCode.indexOf("tx.user.update"));
  for (const field of [
    "password: null",
    "emailVerified: null",
    "image: null",
    "deletedAt: now",
    "anonymizedAt: now",
    "sessionInvalidatedAt: now",
  ]) {
    assert(wipe.includes(field), `the wipe must set ${field}`);
  }
});

suite("the email is released so the address can be used again", () => {
  assert(
    purge.includes("`deleted+${userId}@deleted.local`"),
    "the address must be rewritten to the deleted namespace",
  );
});

suite("the workspace loses its company identity", () => {
  const orgWipe = purgeCode.slice(purgeCode.indexOf("tx.organization.update"));
  for (const field of [
    "websiteUrl: null",
    "industry: null",
    "sizeBucket: null",
    "location: null",
    "logoUrl: null",
  ]) {
    assert(orgWipe.includes(field), `the workspace wipe must set ${field}`);
  }
});

// =========================================================================
// 6. The two surfaces
// =========================================================================

suite("self-delete resolves the caller from the session", () => {
  const src = code("src/app/actions/recruiter-account-actions.ts");
  assert(
    src.includes("await requireRecruiterWorkspace()"),
    "the caller must come from the session",
  );
  assert(
    !src.includes("targetUserId") && !src.includes("input.userId"),
    "no user id may be accepted from the client on this path",
  );
  assert(src.includes("byAdmin: false"), "this path is not an admin action");
});

suite("the admin path is admin-gated and takes a reason", () => {
  const src = code("src/app/actions/admin-recruiter-actions.ts");
  const at = src.indexOf("deleteRecruiterAccountAction");
  const body = src.slice(at);
  assert(body.includes("await requireAdmin()"), "must call requireAdmin()");
  assert(src.includes("min(8"), "a reason of at least 8 characters is required");
  assert(body.includes("byAdmin: true"), "the audit must record it as an admin act");
});

suite("both surfaces require a typed DELETE", () => {
  for (const rel of [
    "src/app/actions/recruiter-account-actions.ts",
    "src/app/actions/admin-recruiter-actions.ts",
  ]) {
    assert(
      source(rel).includes('z.literal("DELETE")'),
      `${rel} must require the confirmation literal`,
    );
  }
});

suite("the logo blob is deleted after the commit, never inside it", () => {
  assert(
    !purgeCode.includes("deleteCompanyLogoBlob"),
    "a blob delete cannot join a database transaction",
  );
  for (const rel of [
    "src/app/actions/recruiter-account-actions.ts",
    "src/app/actions/admin-recruiter-actions.ts",
  ]) {
    const src = code(rel);
    const tx = src.indexOf("$transaction");
    const blob = src.indexOf("deleteCompanyLogoBlob(");
    assert(tx > 0 && blob > tx, `${rel} must clean the blob after the commit`);
  }
});

// =========================================================================
// 7. The neighbouring deletion paths are left alone
// =========================================================================

suite("the candidate paths are untouched and unreachable from here", () => {
  assert(
    !purgeCode.includes("anonymizeUser") &&
      !purgeCode.includes("deleteOwnCandidateAccount"),
    "the candidate routines have different rules and must not be reused",
  );
  const candidate = source("src/features/profile/delete-own-account.ts");
  assert(
    candidate.includes("Recruiter accounts cannot be deleted from this screen."),
    "the candidate self-delete must still refuse recruiters",
  );
});

suite("the locked notification module is not touched", () => {
  for (const model of [
    "userNotification",
    "notificationRead",
    "notificationPreference",
    "notificationDelivery",
  ]) {
    assert(
      !purgeCode.includes(model),
      `${model} is locked to Manuvrtti — purging it needs their approval first`,
    );
  }
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
