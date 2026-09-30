# 154 — Password and emailed-code sign-in

> **Status: implemented directly (no plan-first pass), 2026-09-22.** This is
> the record of what was built and why, so the "plan 154" references in code
> resolve. Behind `ENABLE_EMAIL_LOGIN` (default off).

## 1. Goal
Let people sign in with a password **or** an emailed code, on both the
candidate door (`/login`, Google-only before) and the recruiter doors
(`/talent/login`, `/recruiter-onboarding/signin`, email-code-only before).

## 2. Decisions (Sohail, 2026-09-22)
| Question | Decision |
|---|---|
| Which surfaces | Candidate `/login` **and** recruiter sign-in |
| Password vs code | Either one — alternatives, not 2FA |
| Code channel | Email only (reuses the recruiter OTP machinery) |
| How a password is set | Forgot/set via code on the sign-in pages; `/settings/security`; at registration |
| New candidate signups by email | Yes — a code to an unknown address creates the account |
| Admins | Google only; neither method opens an admin account |
| Recruiter registration (Zainab's module) | Change approved by Sohail: optional password field |
| Old plain-text Dev Login | Replaced; seeds hash their passwords |

## 3. How it works
- **Providers** (`src/auth.ts`, stubs in `src/auth.config.ts`):
  `email-code` (candidate only; purpose `candidate-login`) and `password`
  (`audience: candidate | recruiter`). Rules live in `src/lib/email-auth.ts`.
  A door opens only its own accounts: a recruiter on `/login` is refused
  with `recruiter_account`, a candidate on a recruiter door with
  `not_recruiter` — both only *after* the password verifies.
- **Codes** (`src/lib/email-code.ts`): the `RecruiterEmailOtp` table is now
  the one code table. `purpose` binds a code to its job (`login`/`register`
  recruiter, `candidate-login`, `password-reset`); a code for one purpose is
  a wrong code for any other. The recruiter email template is byte-identical
  to plan 152's.
- **Passwords** (`src/lib/password.ts`): node:crypto scrypt, N=2^15 r=8 p=3,
  params stored in the hash. Any value without the `scrypt$` prefix (old
  plain-text seeds) is "no password" and is never compared. 8–128 chars, no
  composition rules, not the email address.
- **Rate limits** (`RateLimitEvent`): `LOGIN_PASSWORD_ACCOUNT` 10 and
  `LOGIN_PASSWORD_IP` 100 per 15 min, checked before any hashing;
  `EMAIL_CODE_ADDRESS` 5 and `EMAIL_CODE_IP` 30 per 15 min on every code send,
  recruiter sends included. Email subjects are peppered hashes, never
  addresses. This also fixes the old per-address OTP cap, which counted rows
  on a table where each send deletes the previous row, so it never exceeded 1.
- **Enumeration**: password reset always answers "if there's an account…";
  admin and frozen accounts get the normal answer and no email. No-account and
  wrong-password take the same time (`burnPasswordCheck`).
- **Sessions**: the JWT gains `authTime` (sign-in time, never re-stamped).
  Revocation (`sessionInvalidatedAt`) now compares it instead of `iat`, which
  Auth.js re-stamps on every refresh — previously a revoked session came back
  after one refresh. Password change and reset sign the account out
  everywhere; the page signs the person back in with the new password.
- **First password**: allowed without a code only within 15 min of a real
  sign-in (`isFreshSignIn`); otherwise an emailed code is required. Backfilled
  `authTime` on pre-existing tokens never counts as fresh.
- **Google linking**: with the flag on, Google may attach to an account made by
  email code (`allowDangerousEmailAccountLinking`), guarded in the `signIn`
  callback: never for recruiters (→ `/login?error=RecruiterAccount`), frozen
  accounts, or a Google profile without `email_verified`.

## 4. Cross-module changes (approved by Sohail, 2026-09-22)
- **Recruiter registration (Zainab):** optional password on `/talent/register`
  and on the onboarding wizard's code card, saved in the same transaction as
  the account (`registerRecruiterWithOtpAction`). Never written to the
  sessionStorage draft.
- **Candidate `/register` (Shivansh):** optional password field, shown only
  when it can be saved without a code (flag on, no password yet, not an admin,
  sign-in under 15 min old). Saved by `setPasswordAction` after registration
  succeeds; a failure warns and never blocks registration.
- **Links to `/settings/security`:** `/profile` (Shivansh) and
  `/hire/settings` (Zainab), both behind the flag.

## 5. Rollout
1. Deploy with the flag off; apply migration
   `20260922150000_email_login_rate_limit_buckets` (4 additive enum values).
2. Read-only check: `SELECT count(*) FROM "User" WHERE password IS NOT NULL
   AND password NOT LIKE 'scrypt$%'` — those are old plain-text dev values.
   They can no longer sign in; null them out in a separate, snapshotted step.
3. Set `ENABLE_EMAIL_LOGIN=true` in Vercel.

## 6. Verification
`npm run test:email-login`, `test:demo1-security` (rate-limit call sites),
`test:account-ops`, `test:work-email`, `test:observability:scan`,
`npx tsc --noEmit`, `npx next build`.
