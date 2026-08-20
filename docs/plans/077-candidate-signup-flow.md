# 077 — Candidate signup flow: nav → Google → profile-only registration → dashboard

## 1. Goal

Repoint the landing navbar's **Get Started → Candidates** item at the 60-Day
Challenge signup, and decouple profile creation from track enrollment:
registration creates a `StudentProfile` **only**, the user lands on `/dashboard`,
and they join a track from there. Add a `/dashboard` gate so a signed-in user
with no profile is sent back to `/register`.

## 2. Current behavior

### Nav
[`landing-content.ts:12`](src/components/landing/site/landing-content.ts:12) —
`GET_STARTED_ITEMS[0]` is `{ href: "/program", label: "Candidates" }`. The
dropdown ([`landing-nav.tsx`](src/components/landing/site/landing-nav.tsx),
plan 076, currently uncommitted) renders only when `user` is `null`.

### Registration
`/register` is in `protectedPaths` ([`middleware.ts:44`](middleware.ts:44)), so
a signed-out visit redirects to `/login?from=/register`. After Google,
[`auth.ts`](src/auth.ts) `events.createUser` records legal + newsletter consent,
then Auth.js returns to `/register`.

[`complete-registration.ts:149`](src/features/registration/complete-registration.ts:149)
creates `StudentProfile` **and** `Enrollment` in one transaction. Consequently
the app-wide "is this user registered" gate is **`profile && enrollment`**, in
three places:

| Site | Line | Behavior |
|---|---|---|
| [`register/page.tsx`](src/app/register/page.tsx:47) | 47–83 | `profile && enrollmentCount > 0` → dashboard / `?domain=` fast-path; `profile && count === 0` → **deletes the profile** |
| [`login/page.tsx`](src/app/login/page.tsx:66) | 66–73 | `profile && enrollment` → honour `from`, else `/register` |
| [`complete-registration.ts`](src/features/registration/complete-registration.ts:44) | 44–54 | `both` → `already_registered`; `profile only` → **deletes the profile** |

### Joining a second track (already exists — reuse it)
- `/challenges` → [`domain-picker.tsx:58`](src/components/challenges/domain-picker.tsx:58) → `/register?domain=SE`
- Dashboard → [`roadmaps.tsx:48`](src/components/dashboard-hub/roadmaps.tsx:48) → `/register?domain=<D>`
- `/register` fast-path ([`register/page.tsx:52`](src/app/register/page.tsx:52)) → [`createCoreEnrollment`](src/features/enrollment/create-core-enrollment.ts) → `CORE_TRACK_PATH[domain]`
- Claude → [`JoinClaudeButton`](src/components/dashboard-hub/join-claude-button.tsx) → `enrollInClaudeChallenge`

`createCoreEnrollment` and `createClaudeEnrollment` both explicitly **do not
touch `StudentProfile.domain`** — the schema already treats profile-domain as a
legacy "primary track" label, not a source of truth.

### `/dashboard`
[`get-hub-data.ts:80`](src/features/dashboard/get-hub-data.ts:80) tolerates
`profile: null` and renders an empty hub. No gate.

## 3. Blast radius — what changes and what does not

### 3a. `StudentProfile.domain` is `Domain` **NOT NULL** (with an index)

```prisma
domain  Domain
@@index([domain, createdAt(sort: Desc)])
```

Removing the domain picker means the column has no value to write.
**Decision: make it `Domain?` (nullable).** Existing rows keep their values; the
index tolerates nulls. The alternative — silently writing `SE` — is rejected:
`profile.domain` is *displayed* on `/profile`, `/students/[id]` and
`/admin/students/[id]`, so every new user would be publicly labelled
"Software Engineering" without ever choosing it.

Read paths that must accept `null` (13 files):

| File | What breaks |
|---|---|
| [`get-profile.ts:19,51`](src/features/profile/get-profile.ts:19) | `domain: Domain` → `Domain \| null` |
| [`profile/page.tsx:176`](src/app/profile/page.tsx:176) | `domainDisplayName(profile.domain)` — hide the badge when null |
| [`get-public-profile.ts:37,47,106`](src/features/profile/get-public-profile.ts:37) | `where: { domain: profile.domain }` heatmap lookup needs a null guard; `?? 0` fallbacks already exist |
| [`students/[id]/page.tsx:102`](src/app/students/[id]/page.tsx:102) | domain badge — null branch |
| [`admin/students/[id]/page.tsx:167`](src/app/admin/students/[id]/page.tsx:167) | domain badge — null branch |
| [`get-dashboard-data.ts:112`](src/features/dashboard/get-dashboard-data.ts:112) | `profileSnapshot.domain: string` → `string \| null` |
| [`track-page.tsx:226,265,333`](src/components/challenge/track-page.tsx:226) | drop the `as Domain` casts |
| [`get-user-with-profile.ts:19`](src/features/user/get-user-with-profile.ts:19) | select type |
| [`get-students.ts:111`](src/features/admin/get-students.ts:111) | display column only |
| [`get-referrals-report.ts:95`](src/features/admin/get-referrals-report.ts:95) | display column only |
| [`admin-export-actions.ts:57`](src/app/actions/admin-export-actions.ts:57) | CSV cell → `""` when null |
| [`api/claude-recent-signups/route.ts`](src/app/api/claude-recent-signups/route.ts) | display only |
| [`get-recruiter-profile.ts`](src/features/recruiter/get-recruiter-profile.ts), [`get-job-applicants.ts`](src/features/jobs/get-job-applicants.ts), [`get-student-detail.ts`](src/features/admin/get-student-detail.ts) | display only |

[`resolve-dashboard-enrollment.ts`](src/features/enrollment/resolve-dashboard-enrollment.ts)
already takes `profileDomain: Domain | null` and guards with `if (profileDomain)`.
**No change needed** — it was written for exactly this.

### 3b. Unaffected — all driven by `Enrollment.domain`, not the profile

Leaderboard ([`get-leaderboard.ts:42`](src/features/dashboard/get-leaderboard.ts:42)),
admin domain counts / track counts
([`get-students.ts:262`](src/features/admin/get-students.ts:262)), the admin
student-list *filter*, certificates, submissions, streaks, quizzes, synergy
scoring, marketplace, program, hackathon, talent, workshop. Verified: none of
them read `StudentProfile.domain` for logic.

### 3c. Known consequence to accept — admin visibility gap

[`get-students.ts:77`](src/features/admin/get-students.ts:77) builds the admin
student list from `prisma.enrollment.findMany`. **A user with a profile but no
enrollment will not appear in `/admin/students` at all**, and will not be
counted in `getStudentDomainCounts`. Under this change that becomes a normal,
expected state rather than an anomaly. Out of scope here; see §10.

### 3d. Funnels that carry a track intent through `/register?domain=`

Three existing entry points pass a domain and expect an enrollment to result:

- `/challenges` DomainPicker → `/register?domain=SE|DS|AI`
- [`claude-signup/page.tsx:47`](src/app/claude-signup/page.tsx:47) → `/register?domain=CLAUDE` (profileless users)
- [`claude-onboarding-client.tsx:20`](src/components/claude/claude-onboarding-client.tsx:20) → `/login?from=/register?domain=CLAUDE`

If registration simply stops creating enrollments, all three silently drop the
chosen track. **Step 6 keeps `?domain=` working**: the form forwards it, and on
success the action creates that enrollment and returns a redirect target.

### 3e. Claude welcome email becomes unreachable

[`registration-actions.ts:118`](src/app/actions/registration-actions.ts:118)
sends `claudeWelcomeEmail` when `domain === "CLAUDE"`, and
[`registration-form.tsx`](src/app/register/registration-form.tsx) sets the
`claude-day0-share-pending` localStorage flag on the same condition. Both branches
survive only through the `?domain=CLAUDE` path in §3d. Step 6 preserves them
there and does not move them.

## 4. Files to touch

| File | | Note |
|---|---|---|
| [`prisma/schema.prisma`](prisma/schema.prisma) | `[edit]` | `StudentProfile.domain` → `Domain?` |
| `prisma/migrations/<ts>_student_profile_domain_optional/` | `[new]` | `DROP NOT NULL` |
| [`src/components/landing/site/landing-content.ts`](src/components/landing/site/landing-content.ts) | `[edit]` | `GET_STARTED_ITEMS[0].href` → `/register` |
| [`src/lib/validations/register.ts`](src/lib/validations/register.ts) | `[edit]` | drop `domain` from `registerPayloadBase` |
| [`src/app/register/registration-form.tsx`](src/app/register/registration-form.tsx) | `[edit]` | remove the domain card block; forward `?domain=` |
| [`src/app/register/page.tsx`](src/app/register/page.tsx) | `[edit]` | gate on `profile` alone; **delete the orphan-profile delete** |
| [`src/app/actions/registration-actions.ts`](src/app/actions/registration-actions.ts) | `[edit]` | accept optional `enrollDomain`; return `redirectTo` |
| [`src/features/registration/complete-registration.ts`](src/features/registration/complete-registration.ts) | `[edit]` | profile-only; optional enrollment; **delete the orphan-profile delete** |
| [`src/app/login/page.tsx`](src/app/login/page.tsx) | `[edit]` | gate on `profile` alone |
| [`src/app/dashboard/page.tsx`](src/app/dashboard/page.tsx) | `[edit]` | profileless gate |
| [`src/features/profile/get-profile.ts`](src/features/profile/get-profile.ts) | `[edit]` | `Domain \| null` |
| [`src/features/profile/get-public-profile.ts`](src/features/profile/get-public-profile.ts) | `[edit]` | null guard on heatmap lookup |
| [`src/features/dashboard/get-dashboard-data.ts`](src/features/dashboard/get-dashboard-data.ts) | `[edit]` | `domain: string \| null` |
| [`src/app/profile/page.tsx`](src/app/profile/page.tsx) | `[edit]` | null branch on the badge |
| [`src/app/students/[id]/page.tsx`](src/app/students/[id]/page.tsx) | `[edit]` | null branch on the badge |
| [`src/app/admin/students/[id]/page.tsx`](src/app/admin/students/[id]/page.tsx) | `[edit]` | null branch on the badge |
| [`src/components/challenge/track-page.tsx`](src/components/challenge/track-page.tsx) | `[edit]` | drop 3 `as Domain` casts |
| [`src/app/actions/admin-export-actions.ts`](src/app/actions/admin-export-actions.ts) | `[edit]` | `""` for null domain |
| [`src/features/admin/get-students.ts`](src/features/admin/get-students.ts), [`get-referrals-report.ts`](src/features/admin/get-referrals-report.ts), [`get-student-detail.ts`](src/features/admin/get-student-detail.ts), [`get-user-with-profile.ts`](src/features/user/get-user-with-profile.ts), [`get-recruiter-profile.ts`](src/features/recruiter/get-recruiter-profile.ts), [`get-job-applicants.ts`](src/features/jobs/get-job-applicants.ts), [`api/claude-recent-signups/route.ts`](src/app/api/claude-recent-signups/route.ts) | `[edit]` | type-only null propagation |

**No new files.** No change to `middleware.ts`, `auth.ts`, `auth.config.ts`,
hero/CTA/footer, `/program`, `/talent`, hackathon, workshop, or program code.

## 5. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `LandingNav` | Client | already `"use client"`; only a static href string changes |
| `RegisterPage` | Server | reads session + `searchParams` |
| `RegistrationForm` | Client | receives `initialName`, `initialRef`, `otpVerificationRequired`, and a new `enrollDomain?: string` — all serializable primitives |
| `completeRegistrationAction` | Server Action | returns `{ ok: true, redirectTo: string }` — a plain string, not a redirect, so the client keeps `router.push` + `router.refresh` |
| `DashboardPage` | Server | gate runs before render |
| `TrackPage`, `/profile`, `/students/[id]` | Server | type-only null handling |

`claudeEnabled` / `initialDomain` props on `RegistrationForm` are removed. No
new Server→Client boundary; no functions, icons, or class instances crossed.

## 6. Steps

### Step 1 — Nav href (independent, ship-able alone)

In [`landing-content.ts`](src/components/landing/site/landing-content.ts:12):

```ts
export const GET_STARTED_ITEMS = [
  { href: "/register", label: "Candidates" },
  { href: "/talent", label: "Recruiter" },
] as const;
```

Nothing else in the nav changes. **Do not touch
[`hero-section.tsx:204`](src/components/landing/site/hero-section.tsx:204)** —
the hero primary CTA stays `/program`, per decision.

### Step 2 — Schema

`StudentProfile.domain` → `Domain?`. Keep `@@index([domain, createdAt(sort: Desc)])`.
Migration body is exactly:

```sql
ALTER TABLE "StudentProfile" ALTER COLUMN "domain" DROP NOT NULL;
```

No backfill. No data is rewritten. See §7 before running it.

### Step 3 — Validation

In [`register.ts`](src/lib/validations/register.ts), remove `domain: domainSchema`
from `registerPayloadBase`. Keep the exported `domainSchema` — Step 5 reuses it
for the separate `enrollDomain` parse. Leave the legacy `registerSchema` object
alone; it is unused by this flow.

### Step 4 — Registration form

In [`registration-form.tsx`](src/app/register/registration-form.tsx):

- Delete the `domainCards` array, `domainCardList` memo, the `Domain` `<Label>` +
  card grid, the `selectedDomain === "CLAUDE"` notice block, and the
  `domain` entries in `RegistrationFormValues` / `defaultValues`.
- Delete the now-unused imports: `BarChart3`, `BrainCircuit`, `Code2`,
  `Sparkles`, `Badge`, `CardHeader`, `CardTitle`, `useMemo`.
- Drop the `claudeEnabled` and `initialDomain` props; add
  `enrollDomain?: string` (raw, from `?domain=`).
- In `onSubmit`: stop appending `domain`; append `enrollDomain` when present.
- Keep the `claude-day0-share-pending` localStorage write, but key it off
  `enrollDomain === "CLAUDE"`.
- Replace `router.push("/dashboard")` with `router.push(res.redirectTo)`.

`Card` is still imported for the userType radio cards — keep it.

### Step 5 — Registration action

In [`registration-actions.ts`](src/app/actions/registration-actions.ts):

- Remove `domain` from the `registerPayloadSchema.safeParse` input.
- Parse `enrollDomain` separately with `domainSchema.safeParse(...)`; on failure
  treat it as absent (never error the whole registration on a bad URL param).
- Apply the existing Claude gate to `enrollDomain` only:
  `if (enrollDomain === "CLAUDE" && !isClaudeEnabled()) enrollDomain = undefined;`
- Pass `enrollDomain` to `completeRegistration`.
- Keep the `claudeWelcomeEmail` `after()` block, keyed on `enrollDomain === "CLAUDE"`.
- Return `{ ok: true, redirectTo }` where `redirectTo` is
  `CORE_TRACK_PATH[enrollDomain]` for AI/DS/SE, `"/claude"` for CLAUDE, else
  `"/dashboard"`.
- Keep `revalidatePath("/dashboard")`.

### Step 6 — `completeRegistration`

In [`complete-registration.ts`](src/features/registration/complete-registration.ts):

- Signature gains `enrollDomain?: Domain` (via `opts`).
- **Replace lines 44–54 entirely.** New rule:
  ```
  if (existingProfile) → { ok: false, reason: "already_registered" }
  ```
  **Delete the `existingProfile && !existingEnrollment → studentProfile.delete()`
  branch.** Under the new model that is the normal state of every fresh
  registrant; leaving it in would delete real profiles.
- Write `domain: enrollDomain ?? null` on the profile.
- Look up `Challenge` and create the `Enrollment` **only when `enrollDomain` is
  set**. When it is unset, skip the challenge lookup entirely — do not fail
  registration because a challenge row is missing.
- Keep everything else in the transaction unchanged: the `user.update`
  synergy-points lock, referral handling, `recordLegalConsents`,
  `recordNewsletterOptIn`, `clearRefCookie`.

### Step 7 — `/register` page gate

In [`register/page.tsx`](src/app/register/page.tsx):

- Change the completeness gate from `profile && enrollmentCount > 0` to
  **`profile`** (drop the `enrollment.count` query).
- The `isCoreDomain(requestedDomain)` fast-path (lines 52–74) stays exactly as
  written — it is what dashboard Roadmaps "Join" links depend on.
- **Delete lines 78–83** (`if (profile && enrollmentCount === 0) → delete`).
- Keep `initialRef` / cookie handling. Replace the `initialDomain` prop with
  `enrollDomain={params.domain}` passed through raw.
- Drop the `claudeEnabled` prop; keep `isClaudeEnabled()` only if still used.

### Step 8 — `/login` page gate

In [`login/page.tsx:66`](src/app/login/page.tsx:66), change
`if (profile && enrollment)` to `if (profile)` and drop the `enrollment` query.
Leave the hackathon escape hatch and `registerHrefWithRef` untouched.

> Note for the executor: this branch is currently **unreachable** —
> [`middleware.ts:150`](middleware.ts:150) redirects logged-in users away from
> `/login` before the page runs. Fix it for correctness; do not "fix" the
> middleware, and do not rely on this branch in verification.

### Step 9 — `/dashboard` profileless gate

In [`dashboard/page.tsx`](src/app/dashboard/page.tsx), after the existing
`if (!data.hasUser)` check, add — **in this precedence order**:

```
if (!data.profile) {
  if (data.isHackathonRegistered) redirect("/hackathon/dashboard");
  if (data.hasProgramMembership)  redirect("/program/dashboard");
  redirect("/register");
}
```

`isHackathonRegistered` and `hasProgramMembership` are **already returned by
`getHubData`** — no new query. The ordering matters: without the first two
checks, hackathon-only and program-only members get trapped in a redirect to a
student registration form they never asked for.

Recruiters (`role === "RECRUITER"`) are not special-cased: they reach `/talent`
directly and `/dashboard` is not part of their flow.

### Step 10 — Null-domain propagation

Apply the type + render changes from §3a across the 13 listed files. Every one
is a display or type change; **no query logic changes.** Where a badge would
render a null domain, render nothing rather than a placeholder.

## 7. DB safety

This is the only schema change and it is reversible, but do it deliberately.

1. Commit everything up to Step 1 first. Record the commit hash in the PR body.
2. Take a **Neon branch snapshot** of production before running the migration.
3. `npx prisma migrate dev --name student_profile_domain_optional`
4. Confirm the generated SQL is the single `DROP NOT NULL` statement in Step 2
   and nothing else. If Prisma proposes a table rewrite, drop-and-recreate, or
   any `Enrollment` change, **stop** and hand it back.
5. `npx prisma generate`
6. Rollback if needed: `ALTER TABLE "StudentProfile" ALTER COLUMN "domain" SET NOT NULL;`
   — safe only while no null rows exist, i.e. before the first profile-only
   registration. After that, rollback requires a backfill decision.

Steps 3–10 of §6 must all be in place before deploying the migration: a
deployed `Domain?` schema with the old `profile && enrollment` gate still live
would let `/register` delete fresh profiles.

## 8. Verification

**Primary flow (signed out, incognito):**
1. `/` → Get Started → Candidates → lands on `/login?from=/register`
2. Accept Terms + Privacy → Sign in with Google → lands on `/register`
3. Form shows **no domain cards**; complete it → lands on `/dashboard`
4. DB: `StudentProfile` row exists with `domain = NULL`; **zero** `Enrollment` rows
5. Dashboard → Challenge Tracks → "Join" on SE → lands on `/se` with an SE enrollment

**Regression checks:**
- `/challenges` → pick DS → Join → (signed out) Google → `/register?domain=DS` → submit → lands on **`/ds`**, DS enrollment created
- `/claude-signup` signed out → Google → `/register?domain=CLAUDE` → submit → lands on **`/claude`**, CLAUDE enrollment created, welcome email sent
- Returning fully-registered user clicks Get Started → `/register` → redirects to `/dashboard`
- **Revisit `/register` directly after registering** → redirects to `/dashboard`, and the `StudentProfile` row **still exists** (this is the orphan-delete regression; check the DB, not just the redirect)
- Signed-in, no profile, hackathon registrant → `/dashboard` → `/hackathon/dashboard`
- Signed-in, no profile, program member → `/dashboard` → `/program/dashboard`
- `/profile` for a null-domain user renders without the domain badge and does not crash
- `/students/<id>` and `/admin/students/<id>` for a null-domain user render
- Existing user with a domain + enrollments: `/dashboard`, `/se`, `/profile`, leaderboard, admin student list, admin CSV export all unchanged
- Signed-in landing nav still shows `LandingUserMenu`, no Get Started
- Hero "Get Started" still goes to `/program`

**Build:** `npx tsc --noEmit` and `npm run build` must both pass. Expect the
compiler to surface every null-domain site in §3a — treat any remaining
`as Domain` cast as a missed one.

**Changed files** should be exactly the §4 list plus the migration directory.

## 9. Guardrails for Cursor (DO NOT)

- **DO NOT** keep the `studentProfile.delete()` calls in
  [`register/page.tsx:81`](src/app/register/page.tsx:81) or
  [`complete-registration.ts:53`](src/features/registration/complete-registration.ts:53).
  Under this change a profile without an enrollment is the normal state; those
  two lines would delete real user profiles.
- **DO NOT** write a default domain (`SE` or otherwise) to satisfy the column —
  make it nullable as specified.
- **DO NOT** modify `middleware.ts` or anything it imports. `/register` is
  already in `protectedPaths`; that is the whole mechanism.
- **DO NOT** change `auth.ts` / `auth.config.ts`, or make the nav call
  `signIn("google")` directly — that would bypass the Terms/Privacy gate and the
  `abtalks_newsletter_pref` cookie that `events.createUser` reads.
- **DO NOT** change the hero CTA, CTA band, Cohorts cards, or footer. `/program`
  must stay reachable from all three.
- **DO NOT** touch `Enrollment`, `Challenge`, `Submission`, or any program /
  hackathon / workshop / talent model or code path.
- **DO NOT** change `resolve-dashboard-enrollment.ts` — it already handles a
  null profile domain.
- **DO NOT** change leaderboard, admin domain-count, or admin-filter queries.
  They read `Enrollment.domain` and are correct as-is.
- **DO NOT** add an abstraction file for the redirect-target mapping — inline it
  in the action using the existing `CORE_TRACK_PATH`.
- **DO NOT** use `<Button asChild>` / `<Button render={<Link>}>`; use
  `buttonVariants` on `<Link>`.
- **DO NOT** add `requireRole` / `requireAdmin` to `/register`, `/login`, or the
  Auth.js handler.
- **DO NOT** use `console.error` — use `lib/logger.ts`.
- Append **one** dated line to `docs/CHANGELOG.md` under `## Pending reconcile`
  (this one is architectural).

## 10. Follow-ups (not in this plan)

- **Admin blind spot:** profile-only users never appear in `/admin/students`
  (§3c). Needs either a "Registered, no track" tab or a profile-driven query.
- **Track-selection prompt:** `/dashboard` currently shows Challenge Tracks as
  one section among many. Consider promoting it for zero-enrollment users.
- `/challenges` and `/claude-signup` still carry `?domain=`; once the dashboard
  is the canonical track-picker, those could be simplified.

## 11. Commit message

```
Route nav Get Started to registration and decouple profile from enrollment

Candidates now goes to /register (Google auth -> profile -> dashboard).
Registration creates a StudentProfile only; track enrollment moves to the
dashboard. StudentProfile.domain becomes nullable. /dashboard now sends
profileless users back to /register, with hackathon and program escape hatches.
```
