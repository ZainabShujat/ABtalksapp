/**
 * Plan 166 — recruiter sign-in defaults to password, emailed code second.
 *
 * The important assertions are the two that stop this being undone by a
 * well-meaning edit: the default must stay CONDITIONAL on email login, and no
 * copy may ever distinguish "no password set" from "wrong password".
 *
 * Run: npm run test:recruiter-signin
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

const SCREEN = "src/components/recruiter-onboarding/signin-screen.tsx";
const screen = source(SCREEN);

console.log("\nPlan 166 — password-first recruiter sign-in");

// =========================================================================
// 1. The default
// =========================================================================

suite("the entry screen is password when email login is on", () => {
  assert(
    screen.includes('passwordEnabled ? "password" : "email"'),
    "the entry screen must be password-first",
  );
  assert(
    screen.includes("useState<Screen>(entryScreen)"),
    "and the initial state must use it",
  );
});

suite("the default is conditional, never absolute", () => {
  // With ENABLE_EMAIL_LOGIN off, authorizePassword returns null for everyone —
  // opening on the password form there would make signing in impossible.
  assert(
    !screen.includes('useState<Screen>("password")'),
    "an unconditional password default locks everyone out when the flag is off",
  );
  assert(screen.includes("entryScreen"), "the conditional must be named");
});

suite("the page still resolves the flag on the server", () => {
  const page = source("src/app/recruiter-onboarding/signin/page.tsx");
  assert(
    page.includes("passwordEnabled={isEmailLoginEnabled()}"),
    "the flag must come from the server, not the client",
  );
});

// =========================================================================
// 2. The password screen works as an entry point
// =========================================================================

suite("it carries both fields, as one credential", () => {
  assert(screen.includes('id="si-pw-email"'), "email field");
  assert(screen.includes('passwordField("si-password", "current-password"'), "password field");
  assert(
    screen.includes('autoComplete="username"'),
    "username + current-password is the pair a password manager fills",
  );
});

suite("the entry field takes focus", () => {
  assert(
    screen.includes('autoFocus={entryScreen === "password"}'),
    "the entry email field must be focused",
  );
});

suite("no back arrow on the entry screen", () => {
  assert(
    screen.includes('entryScreen === "password"\n                      ? undefined'),
    "there is nothing behind the entry screen to go back to",
  );
});

suite("sign-up is reachable from the entry screen", () => {
  // It only lived on the code screen before, which is no longer first.
  const pw = screen.slice(screen.indexOf('key="password"'));
  assert(
    pw.includes("/recruiter-onboarding/signup"),
    "a recruiter without an account must still find the way out",
  );
});

// =========================================================================
// 3. Both routes survive
// =========================================================================

suite("the code flow is reachable from the password screen", () => {
  assert(
    screen.includes("Email me a 6-digit code instead"),
    "the secondary option must be offered",
  );
});

suite("the password flow is reachable back from the code screen", () => {
  assert(
    screen.includes("Sign in with a password instead"),
    "the return route must survive",
  );
  assert(screen.includes("passwordEnabled ? ("), "and stay gated on the flag");
});

suite("the reset flow is untouched", () => {
  assert(
    screen.includes("Email me a code to set a password"),
    "eight of ten recruiters currently need this path",
  );
});

// =========================================================================
// 4. The security line (plan 166 §2b)
// =========================================================================

suite("no copy distinguishes 'no password set' from 'wrong password'", () => {
  // Saying so would tell anyone who can type an address which accounts exist
  // and how they authenticate — the enumeration burnPasswordCheck prevents.
  for (const leak of [
    "no password set",
    "hasn't set a password",
    "has not set a password",
    "account has no password",
    "no password on this account",
  ]) {
    assert(
      !screen.toLowerCase().includes(leak.toLowerCase()),
      `sign-in copy must not reveal auth state: "${leak}"`,
    );
  }
});

suite("the timing defence is still in the authorize path", () => {
  const auth = source("src/lib/email-auth.ts");
  assert(
    auth.includes("burnPasswordCheck(password)"),
    "no such user and wrong password must still take the same time",
  );
});

suite("no auth path was changed by this plan", () => {
  // This is a default, not an auth change.
  const auth = source("src/lib/email-auth.ts");
  assert(auth.includes("export async function authorizePassword"), "intact");
  assert(auth.includes("export async function authorizeEmailCode"), "intact");
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
