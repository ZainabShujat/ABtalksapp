# Plan 066 — Recruiter sign-in, and the whole recruiter flow

> Successor to `065-recruiter-portal-requests-and-verified-access.md`.

---

## Context

A recruiter opening ABTalks today clicks **Sign in → For recruiters** and lands
on the same Google button a student gets. That is the complaint, and it is
accurate: `/login?as=recruiter` only changes the heading and where you land
afterwards. There is no recruiter sign-in.

I checked the owner's repo properly before planning — all 33 refs (9 on
`origin`, 23 on `upstream`, plus tags), searching file paths, commit messages,
and file *contents* with `git log --all -S`. **No recruiter login exists on any
branch, and never has.** What does exist upstream is `/talent/register`, a
form (Full name / Company / Phone + consent), reachable only *after* a Google
sign-in. That is the page in your screenshot, it is intact in our local, and
`git log --diff-filter=D` shows it has never been deleted.

One real find: the production database has a table **`RecruiterEmailOtp`** —
`email, codeHash, purpose, attempts, expiresAt, createdAt`, with three rows
whose `purpose` is `register`. Its migration (`20260810100124_recruiter_email_otp`)
is recorded as applied. **Its code is in no branch anywhere.** Someone built
recruiter email-OTP, applied the migration to the shared database, and the code
never landed. The table shape is exactly right for what we want, so this plan
adopts it rather than inventing another.

The outcome: a recruiter never touches Google, signs in with their work email
against the verified-seat list, and every recruiter route has a guard that says
what it guards.

---

## 1. What exists today — verified, not assumed

### Routes

| Route | Guard today |
|---|---|
| `/hire`, `/hire/[requestId]`, `/hire/[requestId]/candidates`, `/hire/requests` | middleware `/hire` → logged in; layout `requireRecruiter()` |
| `/talent/shortlist` (cart) | middleware `/talent`; page `requireRecruiter()` |
| `/talent/members/[id]` | middleware `/talent`; page `requireRecruiter()` |
| `/talent/register` | middleware `/talent`; page redirects on state |
| `/talent/pending` | middleware `/talent`; page redirects on state |
| `/admin/hire-demand`, `/admin/hire-requests`, `/admin/recruiter-seats` | `requireAdmin()` |
| `/api/cron/hire-alerts` | cron secret |

`protectedPaths` in `middleware.ts` already contains `"/talent"` and `"/hire"`,
so **unauthenticated access is already blocked**. What is missing is not
protection — it is a door.

### The flow a recruiter walks today

```
/  → Sign in → For recruiters
   → /login?as=recruiter        ← same Google button, only the copy differs
   → Google
   → /hire
   → requireRecruiter() fails   → /talent/pending
   → no profile                 → /talent/register  (the form)
   → submit → seat lookup → approved → /hire
```

Four redirects, a Google account, and the registration form is the *last* thing
you see rather than the first.

### Auth architecture (must be respected)

- `auth.config.ts` is **edge-safe** — imported by `middleware.ts`, no Prisma.
  Its `Credentials` entry is a stub whose `authorize` returns `null`.
- `auth.ts` holds `PrismaAdapter` and the real `authorize`.
- `session: { strategy: "jwt" }`.
- **Credentials sign-ins bypass the adapter**, so `events.createUser` in
  `auth.ts:56` does *not* fire for them. That hook is what records legal consent
  for OAuth signups — its own comment warns about holding data with no consent
  record. An OTP flow must therefore create the `User` row and call
  `recordLegalConsents` ([record-consent.ts:52](src/features/legal/record-consent.ts#L52))
  itself.
- `signOutAction` ([auth-actions.ts:5](src/app/actions/auth-actions.ts#L5))
  already sends everyone to `/` — the landing behaviour you described works.

### Constraints found

- **`RESEND_API_KEY` is not in `.env.local`.** `sendEmail`
  ([lib/email.ts:19](src/lib/email.ts#L19)) logs a warning and sends nothing.
  Per your answer, dev shows the code on screen; production stays dark until the
  key exists.
- `RecruiterEmailOtp` is **not** in `prisma/schema.prisma`, but the table is in
  the database. Any migration must be idempotent — see §6.
- The three existing rows hold **real people's email addresses** and are long
  expired. They get deleted.

---

## 2. Target flow

```
LOGGED OUT
  /  ──▶ Sign in ──┬─▶ For candidates ─▶ /login          (Google, unchanged)
                   └─▶ For recruiters ─▶ /talent/login   (NEW)

/talent/login   one box: work email
  │
  ├─ no live seat ────▶ "We haven't verified this company yet.
  │                      Write to team@abtalks.in from your work address."
  │                      (no code sent, no account revealed)
  │
  └─ live seat ───────▶ 6-digit code emailed ─▶ /talent/login (step 2: code)
                          │
                          ├─ User exists      ─▶ sign in ─────────────▶ /hire
                          └─ no User          ─▶ create User+consent
                                                 ─▶ /talent/register  ─▶ /hire
                                                    (name + phone only;
                                                     email already verified)

LOGGED IN (recruiter)
  /hire ─── New search · Requests · Cart · theme
    ├─ /hire/[requestId]              conversation + top match
    ├─ /hire/[requestId]/candidates   full ranked list
    ├─ /talent/shortlist              cart → place request
    ├─ /hire/requests                 tickets
    └─ /talent/members/[id]           evidence profile
  Sign out ──▶ /
```

**One email box decides everything.** The recruiter never has to know whether
they are "registered" — the system does. Seat missing is the only dead end, and
it says exactly what to do about it.

`/talent/register` survives as **step 3 of first-time sign-in**: name and phone,
with email and company already known from the seat. It keeps its consent
checkboxes.

---

## 3. What has to be built

| # | Thing | Why |
|---|---|---|
| 1 | `RecruiterEmailOtp` in `schema.prisma` | Table exists; Prisma cannot see it |
| 2 | OTP issue + verify feature module | The actual mechanism |
| 3 | `recruiter-otp` Credentials provider | Turn a verified code into a session |
| 4 | `/talent/login` page + form | The door |
| 5 | Rewire `SignInMenu` and `/login?as=recruiter` | Stop sending recruiters to Google |
| 6 | `/talent/register` becomes step 3 | No longer the place you land last |
| 7 | Guard audit across every recruiter route | Your "har route protected honi chahiye" |
| 8 | Rate limiting on the email box | It sends email to anyone who asks |

---

## 4. Files

**New**

| Path | What |
|---|---|
| `src/features/recruiter-auth/otp.ts` | issue / verify. Hashing, expiry, attempts, single-use |
| `src/app/actions/recruiter-auth-actions.ts` | `requestRecruiterOtpAction`, `verifyRecruiterOtpAction` |
| `src/lib/validations/recruiter-auth.ts` | Zod at both boundaries |
| `src/app/talent/login/page.tsx` | Server Component, redirects if already signed in |
| `src/components/talent/recruiter-login-form.tsx` | Client: email step → code step |
| `prisma/migrations/<ts>_recruiter_email_otp_baseline/migration.sql` | idempotent, see §6 |

**Edited**

| Path | Change |
|---|---|
| `prisma/schema.prisma` | add the model, matching the live table exactly |
| `src/auth.config.ts` | edge-safe stub provider `id: "recruiter-otp"` |
| `src/auth.ts` | real `authorize` — verify code, find-or-create User |
| `src/components/landing/sign-in-menu.tsx` | For recruiters → `/talent/login` |
| `src/app/login/page.tsx` | `?as=recruiter` → redirect to `/talent/login` |
| `src/app/talent/register/page.tsx` | step 3 framing; drop the Company field |
| `src/components/talent/recruiter-register-form.tsx` | name + phone; company shown read-only from the seat |
| `middleware.ts` | `/talent/login` must be public — see guardrails |

---

## 5. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `/talent/login/page.tsx` | Server | reads session, redirects signed-in users to `/hire` |
| `recruiter-login-form.tsx` | Client | two steps in local state; calls Server Actions then `signIn("recruiter-otp")` |
| `otp.ts` | server-only | `import "server-only"` |
| `auth.config.ts` | edge | **no Prisma, no `@/lib/*`** |

Nothing but plain serialisable values crosses the boundary.

---

## 6. Database

**No new table.** `RecruiterEmailOtp` already exists in the shared database. The
model added to `schema.prisma` must match it exactly:

```prisma
model RecruiterEmailOtp {
  id        String   @id @default(cuid())
  email     String
  codeHash  String
  purpose   String            // "login" | "register"
  attempts  Int      @default(0)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([email])
  @@index([expiresAt])
}
```

That is the live DDL, read back from `information_schema` and `pg_indexes` —
including both indexes and the `attempts` default of 0.

The migration file is written **by hand** as `CREATE TABLE IF NOT EXISTS` plus
`CREATE INDEX IF NOT EXISTS`, so it is a no-op against the shared database and
still correct on a fresh one. Do **not** generate it with `migrate dev`: that
would try to create a table that exists and fail.

Before running anything, re-read plan 065 §5 — `DATABASE_URL` is the shared
production database, and three migrations there are already in a failed state,
so `prisma migrate deploy` is blocked on it regardless.

**Cleanup:** delete the three stale rows. They are expired and hold real
addresses (`sohail.…@abes.ac.in` and two others) for a flow that never shipped.

---

## 7. How the OTP is handled

- 6 digits, generated with `crypto.randomInt` — never `Math.random`.
- Stored as **`sha256(code + AUTH_SECRET)`**, never in plaintext. The column is
  named `codeHash` for a reason.
- 10-minute expiry, **5 attempts**, then the row dies.
- Deleted the moment it is used — one code, one sign-in.
- Compared with `crypto.timingSafeEqual`.
- Any previous unused code for that email is deleted when a new one is issued.

**What the response reveals.** A missing seat is stated plainly — a recruiter
needs to know their company is not verified. Beyond that the answer is identical
whether or not an account exists, so the box cannot be used to enumerate who has
signed up.

**Rate limit.** Per email and per IP, in the same table via `createdAt`: at most
3 codes in 15 minutes. Without this the box is a free email cannon.

**Dev fallback.** When `RESEND_API_KEY` is absent **and**
`process.env.NODE_ENV !== "production"`, the action returns the code so the form
can display it. Both conditions, always — a single flag flipped in a deployed
environment would otherwise hand every recruiter's code to whoever asked. Same
shape as `recruiterDevBypassEnabled()` in `lib/program-auth.ts`.

---

## 8. Guard audit — the "har route protected" part

After the change, each route states its own rule:

| Route | Rule |
|---|---|
| `/talent/login` | **public** — must be reachable signed-out. Add to the middleware exception, and redirect to `/hire` if already signed in |
| `/talent/register` | signed in + live seat + no profile yet. Approved → `/hire` |
| `/talent/pending` | kept for legacy pending profiles; approved → `/hire` |
| `/hire/**` | `requireRecruiter()` in the layout — already correct |
| `/talent/shortlist`, `/talent/members/[id]` | `requireRecruiter()` per page — already correct |
| Every `hire-*` Server Action | `requireApprovedRecruiter()` — already correct |
| `/admin/**` | `requireAdmin()` — already correct |

⚠️ `middleware.ts` protects the `/talent` **prefix**, so `/talent/login` would
be forced to `/login` — the new door would be unreachable. Excluding it is the
one middleware change, and it must be an exact-path exception, not a prefix.

---

## 9. Steps

1. Add the model to `schema.prisma`; hand-write the idempotent migration;
   `prisma generate`. Confirm the client sees the existing table without any DDL
   running against production.
2. `features/recruiter-auth/otp.ts` — issue, verify, rate limit, cleanup.
3. Server Actions with Zod at entry.
4. `recruiter-otp` provider: edge stub in `auth.config.ts`, real `authorize` in
   `auth.ts` that verifies, then finds or creates the `User` (role `RECRUITER`)
   **and calls `recordLegalConsents`** with source `recruiter_otp_signup`.
5. `/talent/login` + form.
6. Rewire `SignInMenu` and `/login?as=recruiter`.
7. Reshape `/talent/register` into step 3.
8. Middleware exception for `/talent/login`.
9. Delete the three stale OTP rows.

---

## 10. Guardrails

- **DO NOT** import Prisma or `@/lib/*` into `auth.config.ts` or `middleware.ts`.
- **DO NOT** generate this migration with `migrate dev` — the table exists.
- **DO NOT** store or log the code in plaintext; never log a hash either.
- **DO NOT** return the dev code on `NODE_ENV === "production"`, whatever other
  flags say.
- **DO NOT** let the response distinguish "account exists" from "account does
  not exist".
- **DO NOT** rely on `events.createUser` — it does not fire for credentials.
- **DO NOT** protect `/talent/login` by prefix; it must stay publicly reachable.
- **DO NOT** remove Google from `/login` — candidates still use it.

---

## 11. Verification

1. **Signed out**, `/` → Sign in → For recruiters → lands on `/talent/login`,
   no Google button anywhere on it.
2. Email with **no seat** → clear message, and `RecruiterEmailOtp` gains no row.
3. Email **with a seat, no account** → code shown in dev → verify → `User` +
   `RecruiterProfile` created, a `LegalConsent` row exists for them → name/phone
   → `/hire`.
4. Email **with a seat and an account** (`recruiter@hire.abtalks.dev`) → verify
   → straight to `/hire`, no duplicate `User`.
5. Wrong code five times → row gone, sixth attempt refused.
6. Reuse a used code → refused.
7. Expired code (set `expiresAt` back) → refused.
8. Four codes in 15 minutes → fourth refused.
9. `/talent/login` while signed in → `/hire`.
10. Sign out → `/`, and `/hire` afterwards → `/login`.
11. Existing Google recruiters still reach `/hire` — nothing regressed.
12. `npx tsc --noEmit`, `npm run build` (67+ pages),
    `npx tsx src/features/hire/score-candidate.test.ts` 7/7.
13. Middleware bundle still builds — `auth.config.ts` imports unchanged.

---

## 12. Deliberately not in this plan

- **Passwords.** No hashing, no reset flow, nothing to leak.
- **Removing Google for candidates.** Unchanged.
- **Recruiters blocked from student routes.** A `RECRUITER` visiting
  `/dashboard` is bounced to `/register` today — odd, harmless, separate.
- **Self-serve seat requests.** Verification stays manual, via
  `/admin/recruiter-seats`.

## 13. Open item to decide before production

`RESEND_API_KEY` is not set anywhere. Until it is, recruiter sign-in works in
development only. Everything else here can ship and be tested without it.
