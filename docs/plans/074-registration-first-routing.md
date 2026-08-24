# 074 — Registration-first routing + short cohort apply form

> **Baseline:** plan 073 is implemented and committed (verified in
> `register/page.tsx`, `get-hub-data.ts`, `roadmaps.tsx`,
> `dashboard-hub/join-claude-button.tsx`). This plan builds on that code.

## 1. Goal

Make `/register` the single front door: every new user completes a student
profile before reaching any track, then enrols from `/dashboard`. Strip the
cohort apply form down to the four things registration can't already supply, and
drop domain selection from registration.

## 2. Current behavior

### 2.1 Why `/register` is skipped today

"Get Started" points at `/program` —
[hero-section.tsx:204](../../src/components/landing/site/hero-section.tsx:204) and
[landing-nav.tsx:116](../../src/components/landing/site/landing-nav.tsx:116) (twice: the
inline nav CTA at `:116` and the `nav__cta` at `:136`). So the funnel is:

```
landing → Get Started → /program → "Apply now" → /program/apply
        → middleware bounces to /login?from=/program/apply → Google
        → /program/apply → join code → cohort form
```

`/register` is never on that path. The result is a user with a `User` row and a
`ProgramMember` row but **no `StudentProfile`**. Nothing caught it because
`/program/*` never reads `StudentProfile` — verified: `program-auth.ts` resolves
membership purely from `ProgramMember`, and a grep for `studentProfile` under
`src/app/program/**` returns nothing.

### 2.2 The idiom that will break — read this before writing any code

Four places treat **"registered" as "has a StudentProfile **and** an
Enrollment"**, because registration has always created both in one transaction
([complete-registration.ts:193](../../src/features/registration/complete-registration.ts:193)):

| Where | Line | What it does today |
|---|---|---|
| `src/app/login/page.tsx` | `:66-77` | `profile && enrollment` → go to destination; **else → `/register`** |
| `src/features/registration/complete-registration.ts` | `:39-54` | `profile && enrollment` → `already_registered`; **`profile && !enrollment` → DELETE the profile** |
| `src/app/register/page.tsx` | `:48-84` | `enrollmentCount > 0` → treat as registered; **`=== 0` → DELETE the profile** |
| `src/features/landing/get-landing-state.ts` | `:70-72` | `challengeCta` shown when an enrollment exists |

Once registration stops creating an enrollment, all four misfire. The two
`DELETE` branches are the dangerous ones, and `login/page.tsx` is an outright
**infinite dead end**: register → profile created, no enrollment → any later
login → `profile && enrollment` is false → back to `/register`, forever. Step 4
fixes all four together; none may be skipped.

### 2.3 Required columns that block the form changes

- `StudentProfile.domain Domain` — **NOT NULL, no default**
  ([schema.prisma:232](../../prisma/schema.prisma:232)). Read in ~20 places.
- `ProgramMember.jobRole`, `.company`, `.yearsExperience` — **NOT NULL**
  ([schema.prisma:703-705](../../prisma/schema.prisma:703)). A STUDENT registrant has
  none of these in their profile.
- `ProgramMember.fullName`, `.githubUsername`, `.githubRepoUrl` — NOT NULL and
  **stay** NOT NULL: `fullName` comes from the profile, the other two stay on
  the form.

### 2.4 Current cohort apply form

[apply-form.tsx](../../src/components/program/apply-form.tsx) collects 14 fields.
[applyProfileSchema](../../src/lib/validations/program.ts:10) validates them and
merges `legalAcceptanceSchema`; `createApplication`
([entry.ts:262](../../src/features/program/entry.ts:262)) writes them plus a
`program_apply` consent row and a newsletter opt-in row.

## 3. Decisions taken (answered by product owner)

| # | Decision |
|---|---|
| D1 | `StudentProfile.domain` becomes **nullable**; set to the first track the user joins ("primary track"). |
| D2 | `ProgramMember.jobRole` / `.company` / `.yearsExperience` become **nullable**; filled from the profile for PROFESSIONAL registrants, left null for students. |
| D3 | Registration **always** ends on `/dashboard`. No return-to, even for cohort-intent users. |
| D4 | Builds on plan 073 (already landed). |
| D5 | Legacy `ProgramMember`-without-`StudentProfile` users are **left as-is** — nothing forces them to register, and their cohort access is never interrupted. |
| D6 | New apply form keeps: GitHub username, GitHub repo URL, LinkedIn (prefilled), skills (prefilled, mandatory), 8 GB laptop confirmation, recruiter-visibility opt-in. Everything else is removed. |
| D7 | The T&C / newsletter block is **dropped** from apply — `/register` already records consent. |
| D8 | Dashboard AI Cohort card links straight to `/program/apply`. |

## 4. Files to touch

**Schema + data**

| File | | Note |
|---|---|---|
| `prisma/schema.prisma` | `[edit]` | 4 columns drop NOT NULL. |
| `prisma/migrations/<ts>_nullable_domain_and_program_profile/migration.sql` | `[new]` | 4 `ALTER COLUMN … DROP NOT NULL`. |

**Registration write path**

| File | | Note |
|---|---|---|
| `src/lib/validations/register.ts` | `[edit]` | Drop `domain` from `registerPayloadBase`. |
| `src/features/registration/complete-registration.ts` | `[edit]` | No challenge lookup, no enrollment create, `domain: null`; gate on profile only. |
| `src/app/actions/registration-actions.ts` | `[edit]` | Stop sending/validating `domain`. |
| `src/app/register/registration-form.tsx` | `[edit]` | Remove the domain card picker entirely. |
| `src/app/register/page.tsx` | `[edit]` | Registered = profile only; keep 073's `?domain=` join flow. |

**"Registered" gates**

| File | | Note |
|---|---|---|
| `src/app/login/page.tsx` | `[edit]` | `profile && enrollment` → `profile`. **The dead-end fix.** |
| `src/features/landing/get-landing-state.ts` | `[edit]` | Profile-based `challengeCta`; add `getStartedHref`. |

**Primary-track sync**

| File | | Note |
|---|---|---|
| `src/features/enrollment/create-core-enrollment.ts` | `[edit]` | Set `profile.domain` when null, in a transaction. |
| `src/features/enrollment/create-claude-enrollment.ts` | `[edit]` | Same. |

**Cohort apply**

| File | | Note |
|---|---|---|
| `src/lib/validations/program.ts` | `[edit]` | Shrink `applyProfileSchema` to 6 fields. |
| `src/components/program/apply-form.tsx` | `[edit]` | Delete 8 field blocks; add prefill props. |
| `src/app/program/apply/page.tsx` | `[edit]` | Profile gate for new applicants + prefill fetch. |
| `src/features/program/entry.ts` | `[edit]` | `createApplication` sources profile fields; drop consent writes. |

**Landing + dashboard routing**

| File | | Note |
|---|---|---|
| `src/components/landing/site/landing-page.tsx` | `[edit]` | Thread `getStartedHref`. |
| `src/components/landing/site/hero-section.tsx` | `[edit]` | CTA uses the prop. |
| `src/components/landing/site/landing-nav.tsx` | `[edit]` | Both CTAs use the prop. |
| `src/components/dashboard-hub/roadmaps.tsx` | `[edit]` | Cohort card → `/program/apply` (D8). |

**Null-domain sweep** — an unknown number of read sites; Step 3 makes the
compiler enumerate them. No new files anywhere in this plan.

## 5. Server vs Client

| Component | | Note |
|---|---|---|
| `RegistrationForm` | Client | loses `domain` from its RHF model and both domain-related props |
| `RegisterPage` | Server | unchanged boundary |
| `LoginPage` | Server | unchanged boundary |
| `ProgramApplyPage` | Server | gains a profile fetch; passes two plain values down |
| `ApplyForm` | Client | gains `initialLinkedinUrl: string`, `initialSkills: string[]` — plain string/array, safe |
| `LandingPage` | Server | gains `getStartedHref: string`, forwards it |
| `HeroSection` | **Client** | gains `getStartedHref: string` — plain string, safe |
| `LandingNav` | **Client** | gains `getStartedHref: string` — plain string, safe |
| `Roadmaps` | Server | href literal change only |

No functions, icons, or class instances cross a Server→Client boundary.

## 6. Steps

Do them in this order — Step 3's typecheck failures are the map for Step 4.

### Step 1 — `prisma/schema.prisma`

```prisma
// StudentProfile
domain          Domain?   // null until the user joins their first track

// ProgramMember
jobRole         String?
company         String?
yearsExperience Int?
```

Nothing else changes. `@@index([domain, createdAt(sort: Desc)])` on
`StudentProfile` stays — Postgres indexes nullable columns fine.

### Step 2 — migration

See §7 for the DB-safety sequence that wraps this. New folder
`prisma/migrations/<YYYYMMDDHHMMSS>_nullable_domain_and_program_profile/migration.sql`
(match the existing `20260818130000_add_notifications` timestamp format):

```sql
ALTER TABLE "StudentProfile" ALTER COLUMN "domain" DROP NOT NULL;
ALTER TABLE "ProgramMember" ALTER COLUMN "jobRole" DROP NOT NULL;
ALTER TABLE "ProgramMember" ALTER COLUMN "company" DROP NOT NULL;
ALTER TABLE "ProgramMember" ALTER COLUMN "yearsExperience" DROP NOT NULL;
```

Relaxing only — no column drops, no data loss, existing rows keep every value.

### Step 3 — regenerate the client, then let TypeScript find the read sites

```bash
npx prisma generate
```

```bash
npx tsc --noEmit
```

`StudentProfile.domain` is now `Domain | null`, so **every** site that types it
as `Domain` fails. That error list is exhaustive and authoritative — work
through it rather than trusting any hand-written list. Known clusters:

- `src/features/user/get-user-with-profile.ts`, `src/features/dashboard/get-dashboard-data.ts`
  (`:112` and the `resolveDashboardEnrollment` argument at `:128` — that
  parameter is already `Domain | null`, so it just passes through)
- `src/app/profile/page.tsx` (`:148` header prop, `:176` display name — `AppHeader.domain`
  is **already** `Domain | null`, so only `domainDisplayName` needs a null branch)
- `src/features/profile/get-public-profile.ts` (`:35-47` — uses `profile.domain` to
  find the enrollment; with null, return the profile without the domain-matched
  enrollment rather than returning `null` for the whole profile)
- `src/features/recruiter/get-recruiter-profile.ts`, `src/features/jobs/get-job-applicants.ts`
- admin: `get-students.ts`, `get-student-detail.ts`, `get-analytics-data.ts`,
  `get-referrals-report.ts`, `admin-export-actions.ts`, `campus-ambassadors/page.tsx`,
  `admin/students/[id]/page.tsx`

Rendering rule for all of them: show `—` (or omit the badge) when null. **Never**
substitute a default domain, and never filter a null-domain user out of an admin
list — they are real registered users.

`ProgramMember.jobRole` / `.company` / `.yearsExperience` become nullable too;
apply the same `—` treatment on admin and `/talent` surfaces.

### Step 4 — the four "registered" gates (do all four in one pass)

**4a. `src/app/login/page.tsx` — the dead-end fix.** Delete the enrollment query
at `:66-69` and change the test at `:71`:

```ts
const profile = await prisma.studentProfile.findUnique({
  where: { userId: session.user.id },
  select: { id: true },
});

// Registered = has a StudentProfile. Registration no longer creates an
// enrollment, so requiring one here would loop every new user back to /register.
if (profile) {
  redirect(redirectTo);
}
```

Leave `:52-60` (program/talent/hackathon/dashboard passthrough) and the
`hackathonRedirectForProfilelessUser` fallback at `:75-77` exactly as they are —
`:52-60` is what keeps D5's legacy cohort members out of the `/register` redirect.

**4b. `src/features/registration/complete-registration.ts`.** Delete the
`existingEnrollment` query at `:39-42`. Then:

```ts
if (existingProfile) {
  return { ok: false, reason: "already_registered", message: "You are already registered." };
}
```

Delete the `existingProfile && !existingEnrollment` **profile-delete** branch at
`:52-54` outright — it cannot be reached now that a profile alone means
registered, and leaving it would delete real profiles.

Also delete the CLAUDE feature-flag check at `:56-62` and the challenge lookup at
`:91-101` (both exist only to serve `input.domain`).

**4c. same file, the transaction.** In `studentProfile.create`, both branches set
`domain: null`. Delete the `tx.enrollment.create({...})` block at `:193-200`
entirely. The transaction now creates the profile only.

**4d. `src/app/register/page.tsx`.** Replace 073's `enrollmentCount` gate:

```ts
// Registered = has a StudentProfile (registration no longer creates an enrollment).
if (profile) {
  // …073's isCoreDomain(requestedDomain) join block, UNCHANGED…
  redirect("/dashboard");
}
```

Delete the `prisma.enrollment.count` call at `:48-50` and the
`profile && enrollmentCount === 0` **profile-delete** branch at `:80-84`.

073's `?domain=` join flow at `:53-75` is **untouched** — `/register?domain=AI`
must keep working as a one-click join for already-registered users. Only the
*form* loses domain selection; the *route* keeps its join behaviour.

**4e. `src/features/landing/get-landing-state.ts`.** Replace the first
`prisma.enrollment.findFirst` at `:53-57` with a `studentProfile.findUnique`
(`select: { id: true }`) and make `challengeCta` depend on the profile.

### Step 5 — remove domain from the registration form

**5a. `src/lib/validations/register.ts`** — delete `domain: domainSchema` from
`registerPayloadBase` (`:61`). Leave the legacy `registerSchema` (`:18-32`) and
`domainSchema` alone unless `tsc` proves them unused.

**5b. `src/app/register/registration-form.tsx`** — delete: the `domain` field from
`RegistrationFormValues` (`:54`) and `defaultValues` (`:150`), the `domainCards`
array (`:80-112`), `domainCardList` (`:130-136`), `selectedDomain` (`:173`), the
`claudeEnabled` + `initialDomain` props (`:70-73`), the `fd.append("domain", …)`
line (`:242`), the CLAUDE localStorage block (`:271-277`), the domain-card JSX
section, and the now-unused `Sparkles`/`Code2`/`BarChart3`/`BrainCircuit` imports.
Keep `router.push("/dashboard")` (D3).

**5c. `src/app/actions/registration-actions.ts`** — remove `domain` from the
`safeParse` payload (`:90`) and delete the CLAUDE flag check at `:108-110`. Keep
the Claude welcome email block at `:119-147` **only if** `tsc` shows another
source for `parsed.data.domain`; it no longer has one, so delete that block too
and drop the now-unused `readFileSync`/`join`/`claudeWelcomeEmail`/`sendEmail`/
`after`/`isClaudeEnabled` imports. Keep 073's `revalidatePath("/dashboard")`.

**5d. `src/app/register/page.tsx`** — delete the `initialDomain` computation
(`:88-93`) and stop passing `claudeEnabled` / `initialDomain` to
`<RegistrationForm>`.

### Step 6 — primary-track sync (D1)

In `create-core-enrollment.ts`, wrap the existing `enrollment.create` (073 left it
at `:73`) in a transaction that also backfills the profile's domain:

```ts
await prisma.$transaction(async (tx) => {
  await tx.enrollment.create({ data: { userId, challengeId: challenge.id, domain, status: EnrollmentStatus.ACTIVE, daysCompleted: 0, currentStreak: 0, longestStreak: 0 } });
  // First track joined becomes the profile's primary domain. Never overwrite.
  await tx.studentProfile.updateMany({
    where: { userId, domain: null },
    data: { domain },
  });
});
```

`updateMany` with `domain: null` in the `where` is deliberate: it is a no-op for
every existing user (whose domain is already set) and needs no pre-read.

Apply the identical change in `create-claude-enrollment.ts` with `Domain.CLAUDE`.

### Step 7 — shrink the apply schema

`src/lib/validations/program.ts`, `applyProfileSchema` keeps exactly six keys:
`skills`, `linkedinUrl`, `githubUsername`, `githubRepoUrl`, `hasLaptop8Gb`,
`recruiterVisibilityConsent` — with their current rules, including the
`githubRepoUrl` owner-matches-username `.refine()` at `:58-68`.

Delete: `fullName`, `jobRole`, `company`, `yearsExperience`, `education`,
`university`, `graduationYear`, `resumeUrl`, `phone`, and the
`.merge(legalAcceptanceSchema)` at `:57` (D7). Drop the `optionalPhoneSchema` /
`legalAcceptanceSchema` imports if `tsc` says they are now unused in this file.

`applyToProgramSchema` (`:79-81`) is unchanged in shape — it still intersects
with `joinCode`.

### Step 8 — `src/components/program/apply-form.tsx`

Props become `{ joinCode: string; initialLinkedinUrl: string; initialSkills: string[] }`.

`defaultValues`: `skills: initialSkills`, `linkedinUrl: initialLinkedinUrl`,
`githubUsername: ""`, `githubRepoUrl: ""` (explicitly **not** prefilled —
the repo is cohort-specific and must be typed deliberately), `hasLaptop8Gb`
unchecked, `recruiterVisibilityConsent: false`.

Delete the JSX blocks for full name (`:132-136`), role/company (`:138-149`),
years/graduation year (`:151-174`), education/university (`:176-187`), resume URL
(`:230-234`), phone (`:237-241`), and the `<LegalConsentFields>` wrapper
(`:293-318`) — but **keep the recruiter-visibility checkbox** that currently
lives inside it (D6); lift it out as a standalone block.

Remove `legalConsent` state, `legalConsentAccepted`, and the consent fields from
the `applyToProgramAction` payload and the submit-button `disabled` test (`:322`).
Keep `recruiterVisibility` state.

Field order after the edit: LinkedIn → skills → GitHub username → repo URL →
8 GB laptop → recruiter opt-in → submit.

### Step 9 — `src/app/program/apply/page.tsx`

Add the profile gate **after** `getEntryState` (line `:42`), never before:

```ts
const state = await getEntryState(session.user.id, code);

// Only gate people who are about to apply. Existing members (enrolled /
// waitlisted / closed / status screens) must never be bounced to /register —
// legacy cohort members have no StudentProfile and keep full access (D5).
const profile =
  state.screen === "form"
    ? await prisma.studentProfile.findUnique({
        where: { userId: session.user.id },
        select: { linkedinUrl: true, skills: true },
      })
    : null;

if (state.screen === "form" && !profile) {
  redirect("/register");
}
```

Then pass prefill down:

```tsx
<ApplyForm
  joinCode={state.joinCode}
  initialLinkedinUrl={profile?.linkedinUrl ?? ""}
  initialSkills={profile?.skills ?? []}
/>
```

Leave every other branch of this file (including 073's Step-14 status card) as-is.

### Step 10 — `createApplication` in `src/features/program/entry.ts`

Signature drops the removed fields. At the top, load the profile once:

```ts
const profile = await prisma.studentProfile.findUnique({
  where: { userId },
  select: {
    fullName: true, role: true, organization: true, yearsExperience: true,
    college: true, graduationYear: true, phone: true, resumeUrl: true,
  },
});
if (!profile) {
  return { ok: false, message: "Complete your registration before applying." };
}
```

Build `data` as:

| ProgramMember column | Source |
|---|---|
| `fullName` | `profile.fullName` (stays NOT NULL) |
| `jobRole` | `profile.role` (null for students) |
| `company` | `profile.organization` (null for students) |
| `yearsExperience` | `profile.yearsExperience` (null for students) |
| `university` | `profile.college` |
| `graduationYear` | `profile.graduationYear` |
| `education` | `null` |
| `phone` | `profile.phone` |
| `resumeUrl` | `profile.resumeUrl` |
| `skills`, `linkedinUrl`, `githubUsername`, `githubRepoUrl` | form |
| `recruiterVisibilityConsentAt` | form (unchanged logic) |

Delete the `recordLegalConsents({ source: "program_apply" })` call at `:332-336`
and the `recordNewsletterOptIn` call at `:338-343`, plus the `user.email` lookup
at `:328-331` that exists only to feed them, and their imports if unused (D7).

`getEntryState`'s `existingProfile: EntryProfile | null` stays as-is (it is
already always `null`); the page does the prefill fetch.

### Step 11 — landing CTAs

**11a. `get-landing-state.ts`** — add `getStartedHref: string` to `LandingState`:

- no session → `/login?from=%2Fregister`
- session, no profile → `/register`
- session with profile → `/dashboard`

Give `EMPTY_CTAS` and the `catch` fallback at `:86-89` the signed-out value so a
DB failure still yields a working button.

**11b. `landing-page.tsx`** — pass `getStartedHref={state.getStartedHref}` to
`<LandingNav>` (`:77`) and `<HeroSection>` (`:79`).

**11c. `hero-section.tsx`** — take `getStartedHref: string` as a prop and use it
at `:204`. Leave "Post a requirement" → `/talent`.

**11d. `landing-nav.tsx`** — same prop, used at **both** `:116` and `:136`.

`/program` stays reachable from the Cohorts section — this only redirects the
generic top-of-funnel button.

### Step 12 — `src/components/dashboard-hub/roadmaps.tsx` (D8)

Cohort card href at `:98`:

```tsx
href={hasProgramMembership ? "/program/dashboard" : "/program/apply"}
```

Label logic unchanged (`Continue` / `Start`).

## 7. DB safety

1. Commit everything up to Step 1 first; **record the commit hash in the PR
   description**. That hash is the rollback point.
2. In the Neon console, create a **branch snapshot of production** before
   applying anything. Name it `pre-074-nullable-columns`.
3. Apply to the **branch** first:
   `npx prisma migrate deploy` against the branch `DATABASE_URL`, then run the
   §8 matrix against it.
4. Only then apply to production. Never point `migrate dev` at production.
5. Rollback: the migration only drops NOT NULL, so reverting means restoring the
   Neon branch (any row written since would violate the re-added constraint).
   Do **not** hand-write a `SET NOT NULL` reversal — new rows will legitimately
   hold nulls.

No seed changes. No data backfill — D1 fills `domain` lazily on first enrolment,
and D5 leaves legacy cohort members untouched.

## 8. Verification

`npx tsc --noEmit` and `npm run build` must both pass. Expect a large error list
after Step 3 — that is the sweep, not a failure.

| # | Setup | Expected |
|---|---|---|
| 1 | Brand-new Google account | Landing → Get Started → `/login` → Google → **`/register`** (no domain picker) → submit → `/dashboard`. Profile exists, **zero** enrollments, `domain` is null. |
| 2 | …then sign out and back in | Lands on the destination, **not** `/register`. This is the dead-end regression test — run it. |
| 3 | New user from #1 | Dashboard → AI card → `/register?domain=AI` → joins → `/ai`. `StudentProfile.domain` is now `AI`. |
| 4 | User from #3 joins DS | `/ds` works; `StudentProfile.domain` stays **`AI`** (never overwritten). |
| 5 | **Existing** user (profile + enrollments, domain set) | Dashboard, `/ai`, `/profile`, header all render exactly as before. Domain badge unchanged. |
| 6 | **Existing** cohort member with no StudentProfile (D5) | `/program`, `/program/dashboard`, `/program/day/*` all work untouched. `/dashboard` renders its reduced state. Never redirected to `/register`. |
| 7 | Registered user, no cohort | Dashboard cohort card → `/program/apply` → short form: LinkedIn + skills prefilled, GitHub fields empty, 8 GB + recruiter opt-in present, **no** name/role/company/T&C. Submit → ProgramMember created. |
| 8 | STUDENT registrant applies | Application succeeds with `jobRole`/`company`/`yearsExperience` null. Admin + `/talent` render `—`, not a crash. |
| 9 | PROFESSIONAL registrant applies | Those three columns are populated from the profile. |
| 10 | Not-registered user opens `/program/apply` | Redirected to `/register`. After registering, `/dashboard` (D3). |
| 11 | Admin surfaces | `/admin/students`, student detail, CSV export, analytics, referrals all include a null-domain user without crashing or dropping them. |
| 12 | `/claude-signup`, `/challenges`, `/hackathon/register` | Still reachable; no redirect loops. |

Files changed should be exactly those in §4 plus whatever Step 3's typecheck
surfaced — nothing else.

## 9. Guardrails for Cursor (DO NOT)

- **DO NOT** do Step 4 partially. `login/page.tsx`, `complete-registration.ts`,
  `register/page.tsx` and `get-landing-state.ts` change together or not at all.
  Half of it is a login loop that locks out every new user.
- **DO NOT** leave either profile-delete branch in place
  (`complete-registration.ts:52-54`, `register/page.tsx:80-84`). Both delete real
  profiles once registration stops creating enrollments.
- **DO NOT** substitute a default `Domain` for a null one. Null means "hasn't
  joined a track yet" and must render as `—`.
- **DO NOT** filter null-domain users out of any admin list, export, or count.
- **DO NOT** put the `/program/apply` profile gate before `getEntryState`, and do
  not gate any screen other than `form` — that breaks D5's legacy members.
- **DO NOT** remove `/register`'s `?domain=` join handling (073's work). Only the
  form loses domain selection.
- **DO NOT** prefill the GitHub username or repo URL on the apply form.
- **DO NOT** add a `SET NOT NULL` down-migration.
- **DO NOT** touch `middleware.ts` or anything it imports.
- **DO NOT** add any new file. Every change lands in an existing one.
- **DO NOT** modify `getEntryState`'s resolution order or the `EntryState` union.
- Keep `buttonVariants` / `dsButtonVariants` usage on `<Link>` directly; no
  `<Button asChild>`.
- `logger`, never `console.error`. `select` on every Prisma query. Zod at every
  boundary.

## 10. Commit message

```
feat(registration): make /register the single front door

Get Started pointed at /program, so new users went straight into the cohort
funnel and never reached /register — leaving them with a ProgramMember and no
StudentProfile. Route the top-of-funnel through registration instead, and let
users enrol in tracks from the dashboard.

- registration no longer picks a domain or creates an enrollment;
  StudentProfile.domain is nullable and set to the first track joined
- "registered" now means "has a StudentProfile" everywhere (login, register,
  complete-registration, landing) — requiring an enrollment would have looped
  every new user back to /register
- cohort apply form reduced to GitHub username + repo, LinkedIn and skills
  (both prefilled from registration), laptop confirmation and recruiter opt-in;
  the rest is sourced from StudentProfile
- ProgramMember.jobRole/company/yearsExperience nullable for student applicants

Existing users are unaffected: their domain and enrollments are untouched, and
cohort members without a StudentProfile keep full /program access.
```
