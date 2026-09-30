/**
 * Plan 154 — password hashing, sign-in validation, and the static rules the
 * password / email-code providers depend on.
 *   npm run test:email-login
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hashPassword,
  isUsablePasswordHash,
  verifyPassword,
} from "@/lib/password";
import {
  PASSWORD_MAX_LENGTH,
  SIGN_IN_ERROR,
  passwordCredentialsSchema,
  passwordSchema,
  resetPasswordSchema,
  signInErrorMessage,
} from "@/lib/validations/email-auth";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

async function suite(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

function src(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

async function main() {
  console.log("\nPlan 154 — password + email-code sign-in");

  await suite("a hash verifies its own password and nothing else", async () => {
    const stored = await hashPassword("correct horse battery");
    assert(stored.startsWith("scrypt$15$8$3$"), `unexpected format: ${stored.slice(0, 20)}`);
    assert(await verifyPassword("correct horse battery", stored), "own password must verify");
    assert(!(await verifyPassword("correct horse batterY", stored)), "one letter off must fail");
    assert(!(await verifyPassword("", stored)), "empty must fail");
  });

  await suite("every hash is salted", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    assert(a !== b, "two hashes of one password must differ");
  });

  await suite("NFKC: composed and decomposed input are the same password", async () => {
    const stored = await hashPassword("café-12345");
    assert(await verifyPassword("café-12345", stored), "decomposed é must verify");
  });

  await suite("plain text and junk are never a usable password", async () => {
    for (const value of [null, undefined, "", "test", "admin", "scrypt$15$8$3$x$y"]) {
      assert(!isUsablePasswordHash(value), `${String(value)} must not be usable`);
    }
    // The old dev seed stored "test" as-is: typing "test" must not match it.
    assert(!(await verifyPassword("test", "test")), "plain text must never be compared");
  });

  await suite("parameters from a stored hash are bounded", async () => {
    const stored = await hashPassword("bounded-params");
    const huge = stored.replace("scrypt$15$", "scrypt$30$");
    assert(!isUsablePasswordHash(huge), "N=2^30 must be refused, not attempted");
  });

  await suite("new passwords: 8 to 128 characters, not the email", () => {
    assert(!passwordSchema.safeParse("short").success, "7 chars must fail");
    assert(passwordSchema.safeParse("eightch!").success, "8 chars must pass");
    assert(
      !passwordSchema.safeParse("x".repeat(PASSWORD_MAX_LENGTH + 1)).success,
      "over the ceiling must fail",
    );
    const same = resetPasswordSchema.safeParse({
      email: "Priya@Example.com",
      code: "123456",
      newPassword: "priya@example.com",
    });
    assert(!same.success, "password equal to the email must fail");
  });

  await suite("sign-in accepts an old short password but not an unknown door", () => {
    assert(
      passwordCredentialsSchema.safeParse({
        email: "a@b.co",
        password: "test",
        audience: "candidate",
      }).success,
      "sign-in must not re-apply the length floor",
    );
    assert(
      !passwordCredentialsSchema.safeParse({
        email: "a@b.co",
        password: "test",
        audience: "admin",
      }).success,
      "audience must be candidate or recruiter",
    );
  });

  await suite("refusal codes have their own messages", () => {
    const generic = signInErrorMessage(undefined, "password");
    for (const code of Object.values(SIGN_IN_ERROR)) {
      assert(signInErrorMessage(code, "password") !== generic, `${code} needs a message`);
    }
    assert(
      signInErrorMessage("credentials", "password") === generic,
      "wrong password stays generic",
    );
  });

  await suite("auth.config.ts stays edge-safe and has no plain-text provider", () => {
    const config = src("src/auth.config.ts");
    assert(!/from "@\/lib\//.test(config), "auth.config.ts must not import @/lib/*");
    assert(!config.includes('id: "dev-credentials"'), "dev-credentials must be gone");
    assert(config.includes('id: "email-code"'), "email-code stub must be routable");
    assert(config.includes('id: "password"'), "password stub must be routable");
    const auth = src("src/auth.ts");
    assert(!auth.includes('id: "dev-credentials"'), "dev-credentials must be gone from auth.ts");
    assert(
      !auth.includes("user.password !== String(credentials.password)"),
      "no plain-text comparison may remain",
    );
  });

  await suite("revocation reads the sign-in time, not the re-stamped iat", () => {
    const auth = src("src/auth.ts");
    assert(
      auth.includes("isJwtInvalidated(authTime ?? token.iat"),
      "session callback must compare authTime",
    );
    assert(
      src("src/auth.config.ts").includes("token.authTime = nowSeconds()"),
      "jwt callback must stamp authTime at sign-in",
    );
  });

  await suite("every code check is bound to a purpose", () => {
    const emailAuth = src("src/lib/email-auth.ts");
    assert(
      emailAuth.includes('purposes: ["candidate-login"]'),
      "email-code provider accepts candidate-login codes only",
    );
    const actions = src("src/app/actions/email-auth-actions.ts");
    const resets = actions.match(/purposes: \["password-reset"\]/g) ?? [];
    assert(resets.length === 2, "reset and first-set accept password-reset codes only");
    assert(
      src("src/features/recruiter-auth/otp.ts").includes('purposes: ["login", "register"]'),
      "recruiter codes stay recruiter codes",
    );
  });

  await suite("admins are Google-only on both providers", () => {
    const emailAuth = src("src/lib/email-auth.ts");
    const checks = emailAuth.match(/await isGoogleOnlyAccount\(/g) ?? [];
    assert(checks.length >= 3, "email-code (new + existing) and password must check");
    assert(
      emailAuth.includes('process.env.NODE_ENV !== "production"'),
      "the dev admin exception must be local-only",
    );
  });

  await suite("the candidate door never touches a recruiter account", () => {
    const actions = src("src/app/actions/email-auth-actions.ts");
    const guard = actions.indexOf(
      'if (audience === "candidate" && user?.recruiterProfile)',
    );
    assert(guard > 0, "a recruiter address on /login must be sent to Hire");
    assert(
      guard < actions.indexOf("await issueEmailCode("),
      "the refusal must come before any code is issued, for either purpose",
    );
  });

  await suite("a refused password sign-in offers the way out", () => {
    const form = src("src/components/auth/password-sign-in.tsx");
    assert(
      form.includes("onUseEmailCode?: () => void"),
      "an account with no password cannot be named — offer the code tab instead",
    );
    assert(
      form.includes("disabled={pending || !emailOk}"),
      "asking for a reset code must not wait on the Terms box",
    );
  });

  await suite("consent gates account creation, not password sign-in", () => {
    const login = src("src/app/login/login-client.tsx");
    // Password is the default door and the only one that cannot create an
    // account, so it must not wait on the Terms box.
    assert(
      login.includes('useState<"code" | "password">("password")'),
      "password is the default method",
    );
    const form = login.slice(login.indexOf("<PasswordSignIn"), login.indexOf("/>", login.indexOf("<PasswordSignIn")));
    assert(!form.includes("disabled="), "the password form is not consent-gated");
    assert(!form.includes("onBeforeSignIn"), "and does not run the signup hook");
    // The two doors that do create an account still wait for it.
    assert(
      login.includes("disabled={pending || !canSignIn}") ||
        login.includes("disabled={emailPending || !canSignIn || !email.trim()}"),
      "the emailed-code path still waits for consent",
    );
    assert(
      login.includes("handleGoogleSignIn") && login.includes("ensureLegalAccepted"),
      "Google still waits for consent",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
