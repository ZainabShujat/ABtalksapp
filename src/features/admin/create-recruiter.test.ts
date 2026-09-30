/**
 * Plan 159 — admin-created recruiter accounts.
 *
 * The schema boundary, the password generator, and the invariants that make
 * this surface safe: admin-only, hashing outside the commit window, an audit
 * row inside it, and a plaintext password that exists in exactly one place.
 *
 * Run: npm run test:admin-create-recruiter
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRecruiterSchema } from "@/lib/validations/admin-recruiter";
import {
  GENERATED_PASSWORD_LENGTH,
  generateRecruiterPassword,
} from "@/features/admin/generate-password";
import { WORK_EMAIL_REQUIRED_MESSAGE } from "@/lib/validations/work-email";

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

/**
 * Source with comments and string literals removed.
 *
 * Every assertion below that asks "does the code do X" has to read the code.
 * Reading the raw text instead catches the doc comment that explains why X is
 * forbidden, and the log message whose wording happens to contain the word.
 */
function code(rel: string): string {
  return source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const BASE = {
  fullName: "Jane Recruiter",
  email: "jane@acme.com",
  phone: null,
  companyName: "Acme Technologies",
  website: null,
  industry: null,
  companySize: null,
  location: null,
  passwordMode: "generate" as const,
};

console.log("\nPlan 159 — admin creates recruiter accounts");

// =========================================================================
// 1. Schema
// =========================================================================

suite("a complete work-email submission parses", () => {
  const parsed = createRecruiterSchema.safeParse({
    ...BASE,
    website: "acme.com",
    industry: "FinTech",
    companySize: "50-200",
    location: "Bengaluru, IN",
  });
  assert(parsed.success, "a valid submission must parse");
  if (parsed.success) {
    assert(
      parsed.data.website === "https://acme.com",
      "a bare domain must be auto-prefixed, as the profile schema does",
    );
  }
});

suite("consumer mailboxes are refused — there is no admin override", () => {
  for (const email of [
    "jane@gmail.com",
    "jane@yahoo.co.in",
    "jane@outlook.com",
    "jane@hotmail.com",
  ]) {
    const parsed = createRecruiterSchema.safeParse({ ...BASE, email });
    assert(!parsed.success, `${email} must be refused`);
    if (!parsed.success) {
      assert(
        parsed.error.issues.some((i) => i.message === WORK_EMAIL_REQUIRED_MESSAGE),
        `${email} must fail with the work-email message`,
      );
    }
  }
});

suite("the work-email rule has no escape hatch in this schema", () => {
  const src = code("src/lib/validations/admin-recruiter.ts");
  assert(src.includes("workEmailSchema"), "must use workEmailSchema");
  assert(
    !/allowPersonal|allowConsumer|skipEmailCheck|bypassWorkEmail/i.test(src),
    "work-email.ts says the rule holds on any path — no flag may weaken it here",
  );
  assert(
    !/\.optional\(\)[\s\S]{0,40}email|email[\s\S]{0,40}\.optional\(\)/.test(src),
    "the email must not be optional on this path",
  );
});

suite("the company rules are inherited, not restated", () => {
  const src = code("src/lib/validations/admin-recruiter.ts");
  assert(
    /updateRecruiterProfileSchema\s*\.extend\(/.test(src),
    "extending the profile schema is what keeps one source of truth",
  );
  // Inherited: a name with digits is refused by the profile schema's rule.
  const parsed = createRecruiterSchema.safeParse({ ...BASE, fullName: "Jane2" });
  assert(!parsed.success, "a name with a digit must be refused");
});

suite("a manual password must clear the password rules", () => {
  const short = createRecruiterSchema.safeParse({
    ...BASE,
    passwordMode: "manual",
    password: "abc123",
  });
  assert(!short.success, "under 8 characters must be refused");

  const missing = createRecruiterSchema.safeParse({
    ...BASE,
    passwordMode: "manual",
  });
  assert(!missing.success, "manual mode with no password must be refused");

  const asEmail = createRecruiterSchema.safeParse({
    ...BASE,
    passwordMode: "manual",
    password: "jane@acme.com",
  });
  assert(!asEmail.success, "the password must not be the email address");

  const good = createRecruiterSchema.safeParse({
    ...BASE,
    passwordMode: "manual",
    password: "correct horse battery",
  });
  assert(good.success, "a long passphrase must be accepted");
});

suite("generate mode needs no password field", () => {
  const parsed = createRecruiterSchema.safeParse(BASE);
  assert(parsed.success, "generate mode must parse with no password");
});

suite("logoUrl is not settable as text on this path either", () => {
  const parsed = createRecruiterSchema.safeParse({
    ...BASE,
    logoUrl: "https://evil.example.com/tracker.png",
  });
  assert(parsed.success, "an extra key must not fail the parse");
  if (parsed.success) {
    assert(
      !("logoUrl" in parsed.data),
      "logoUrl must be stripped — a logo is a file, never client text",
    );
  }
});

// =========================================================================
// 2. The generated password
// =========================================================================

suite("the generated password has the advertised length and alphabet", () => {
  const pw = generateRecruiterPassword();
  assert(
    pw.length === GENERATED_PASSWORD_LENGTH,
    `expected ${GENERATED_PASSWORD_LENGTH} characters, got ${pw.length}`,
  );
  assert(
    /^[A-HJ-NP-Za-hj-kmnp-z2-9]+$/.test(pw),
    `unexpected character in "${pw}"`,
  );
});

suite("ambiguous glyphs are excluded — this gets read aloud", () => {
  const joined = Array.from({ length: 200 }, () => generateRecruiterPassword()).join("");
  for (const ch of ["0", "O", "1", "l", "I"]) {
    assert(!joined.includes(ch), `"${ch}" must not appear in a generated password`);
  }
});

suite("200 draws are all distinct", () => {
  const seen = new Set(
    Array.from({ length: 200 }, () => generateRecruiterPassword()),
  );
  assert(seen.size === 200, `only ${seen.size} distinct values in 200 draws`);
});

suite("a custom length is honoured", () => {
  assert(generateRecruiterPassword(32).length === 32, "length 32");
  assert(generateRecruiterPassword(1).length === 1, "length 1");
});

suite("the generator rejection-samples instead of taking a biased modulo", () => {
  const src = source("src/features/admin/generate-password.ts");
  assert(src.includes("randomBytes"), "must use crypto randomBytes");
  assert(!src.includes("Math.random"), "Math.random is not a credential source");
  assert(
    src.includes("CEILING") && src.includes("byte >= CEILING"),
    "a 55-character alphabet needs rejection sampling; bare % biases the low 36",
  );
});

// =========================================================================
// 3. Invariants that live in the action and the feature
// =========================================================================

suite("the action is admin-only and takes no identity from the client", () => {
  const src = source("src/app/actions/admin-recruiter-actions.ts");
  assert(src.includes("await requireAdmin()"), "must call requireAdmin()");
  const guard = src.indexOf("await requireAdmin()");
  const parse = src.indexOf("createRecruiterSchema.safeParse");
  assert(guard > 0 && guard < parse, "the guard must come before the parsing");
  assert(
    !src.includes('formData.get("userId")') &&
      !src.includes('formData.get("organizationId")') &&
      !src.includes('formData.get("role")'),
    "no id or role may be read from the client",
  );
  assert(
    src.includes("adminUserId: admin.userId"),
    "the actor must be the session admin",
  );
});

suite("scrypt runs before the transaction, not inside it", () => {
  const action = source("src/app/actions/admin-recruiter-actions.ts");
  assert(
    action.includes("await hashPassword(password)"),
    "the action hashes the password",
  );
  const feature = source("src/features/admin/create-recruiter.ts");
  assert(
    !feature.includes("hashPassword"),
    "hashing inside the commit window is what timed the OTP path out at ~5.3s",
  );
  assert(
    feature.includes("passwordHash: string"),
    "the feature must take an already-computed hash",
  );
});

suite("the plaintext password is never logged, persisted or audited", () => {
  // String literals are stripped first: a log MESSAGE may say "password hash
  // failed" — what must never appear is the password as a logged VALUE.
  const action = code("src/app/actions/admin-recruiter-actions.ts");
  for (const call of action.match(/logger\.\w+\([\s\S]*?\}\);/g) ?? []) {
    assert(
      !/\bpassword\b/.test(call),
      `a logger call passes password as a value:\n${call}`,
    );
  }
  assert(
    action.includes("logger."),
    "the stripper must not have eaten the logger calls it is checking",
  );
  const feature = source("src/features/admin/create-recruiter.ts");
  const metadata = feature.slice(
    feature.indexOf("metadata: {"),
    feature.indexOf("reusedExistingUser"),
  );
  assert(
    !metadata.includes("passwordHash") && !/password:/.test(metadata),
    "the audit metadata must carry passwordMode only, never a password",
  );
});

suite("a password posted in generate mode cannot bypass the minimum", () => {
  // superRefine only runs passwordSchema for `manual`, so a `password` field
  // sent with passwordMode=generate is unvalidated. The action must ignore it
  // rather than hash it.
  const src = code("src/app/actions/admin-recruiter-actions.ts");
  assert(
    !/const password = input\.password \?\?/.test(src),
    "?? would accept an unvalidated password posted in generate mode",
  );
  assert(
    /input\.passwordMode === ""/.test(src) || src.includes("passwordMode ==="),
    "the choice must branch on the mode",
  );
  assert(
    src.includes("generateRecruiterPassword()"),
    "generate mode must issue a server-side password",
  );

  // And the schema still leaves it unvalidated, which is why the above matters.
  const parsed = createRecruiterSchema.safeParse({
    ...BASE,
    passwordMode: "generate",
    password: "abc",
  });
  assert(
    parsed.success,
    "the schema does not validate a password in generate mode — the action must",
  );
});

suite("the password is returned exactly once, in the success payload", () => {
  const src = source("src/app/actions/admin-recruiter-actions.ts");
  assert(src.includes("password,"), "the result carries the plaintext");
  assert(
    !src.includes("sendEmail") && !src.includes("notify"),
    "mailing a live credential is the practice the one-time panel avoids",
  );
});

suite("the audit row is written inside the same transaction as the account", () => {
  const src = source("src/features/admin/create-recruiter.ts");
  const txStart = src.indexOf("prisma.$transaction");
  const audit = src.indexOf("writeAudit(tx");
  const txEnd = src.indexOf("{ maxWait: 20_000");
  assert(txStart > 0, "the writes must be in a transaction");
  assert(
    audit > txStart && audit < txEnd,
    "an audit row outside the commit can disagree with what was written",
  );
  assert(
    src.includes('actionType: "RECRUITER_CREATED_BY_ADMIN"'),
    "the action type must name what happened",
  );
});

suite("provisioning is called, not reimplemented, and records the granter", () => {
  const src = source("src/features/admin/create-recruiter.ts");
  assert(
    src.includes("provisionRecruiterIdentity(tx, {"),
    "the workspace and its credit grant come from the one existing function",
  );
  assert(
    src.includes("grantedByUserId: input.adminUserId"),
    "the admin must be recorded as the granter",
  );
  assert(
    !src.includes("grantOnboardingCredits"),
    "a second credit grant here would double-fund the workspace",
  );
  assert(
    src.includes("timeout: 20_000"),
    "Neon times out below this for the provisioning write set",
  );
});

suite("a student account cannot be turned into a recruiter", () => {
  const src = source("src/features/admin/create-recruiter.ts");
  assert(
    src.includes("candidateProfile"),
    "the candidate-profile refusal must be here, as in registerRecruiter",
  );
  assert(
    src.includes("recruiterProfile"),
    "a second recruiter account on one email must be refused",
  );
});

suite("no seat is created or consumed", () => {
  const src = source("src/features/admin/create-recruiter.ts");
  const action = source("src/app/actions/admin-recruiter-actions.ts");
  assert(
    !src.includes("verifiedRecruiterSeat") &&
      !action.includes("verifiedRecruiterSeat"),
    "a seat is a pre-verified name for self-registration; spending one here " +
      "would silently change what the seat list means",
  );
});

suite("the logo is attached after the commit and never fails the account", () => {
  const src = source("src/app/actions/admin-recruiter-actions.ts");
  const create = src.indexOf("createRecruiterAccount({");
  const logo = src.indexOf("attachLogo(created.organizationId");
  assert(create > 0 && logo > create, "the logo must be attached after creation");
  assert(
    src.includes("logoAttached") && src.includes("logoMessage"),
    "a logo that did not attach must be reported, not swallowed",
  );
  assert(
    src.includes("readLogoUpload"),
    "the admin path must use the shared upload validation, not its own",
  );
});

suite("the form never leaks the password to storage or a toast", () => {
  const src = source("src/components/admin/create-recruiter-form.tsx");
  assert(
    !src.includes("localStorage") && !src.includes("sessionStorage"),
    "the password must not be written to browser storage",
  );
  assert(
    !/toast\.\w+\([^)]*password/i.test(src),
    "the password must not go through a toast",
  );
  assert(
    src.includes("shown once"),
    "the panel must say the password cannot be shown again",
  );
});

suite("the admin page renders the form behind requireAdmin", () => {
  const src = source("src/app/admin/recruiters/page.tsx");
  assert(src.includes("await requireAdmin()"), "the page stays admin-gated");
  assert(src.includes("CreateRecruiterForm"), "the page renders the form");
  assert(
    src.includes("emailLoginEnabled={isEmailLoginEnabled()}"),
    "the flag must be resolved on the server and passed as a boolean",
  );
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
