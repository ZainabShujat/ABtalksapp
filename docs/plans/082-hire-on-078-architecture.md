# 082 — Land PR #200 (`/hire` Scout) on the 078 architecture

> **Status (2026-08-24):** implemented on branch `feat/hire-scout-078`, branched
> from PR #200 (`86da657`).
>
> | Workstream | State |
> |---|---|
> | W0 plan renumbering | **done** — 083–094 |
> | W1 `CandidateAvailability` → `CandidatePreference` | **done** |
> | W2 matches/engagements keyed on `User` | **done** |
> | W3 one visibility gate, every track | **done** |
> | W4 repository seam (`src/repositories/hire.ts`) | **done** — legacy branch live, 078 branch gated on `NEW_HIRE_POOL_READY` |
> | W5 recruiter identity onto 078 | **done** — both registration paths + admin approve |
> | W6 track registry → 078 cohort slugs | **done** |
> | W7 migrations corrected in place | **done** — **not applied to any database** |
> | W8 declared salary suppressed | **done** (took the §9 default) |
>
> **Verified:** `tsc --noEmit` clean · `prisma validate` clean · `npm run build`
> succeeds with all `/hire` routes · eslint clean on every touched path ·
> **112 tests pass** (the PR's 103, unmodified, plus 9 new visibility tests).
>
> **Not verified:** the corrected migrations have never been run. No Postgres or
> Docker is available on the dev machine, so `prisma migrate diff` against a
> shadow database is still outstanding — see §8. Migration columns were compared
> to schema fields by hand and match, which is not the same thing.
>
> **Deliberately out of scope, still true:** `src/app/actions/talent-actions.ts`
> and `src/features/program/entry.ts` still write
> `ProgramMember.recruiterVisibilityConsentAt`. Those are legacy `/talent` writes,
> not `/hire` gate reads, and changing them was not part of this plan.

---

## 1. Goal

PR #200 builds a genuinely good recruiter product — Scout, the desk, evidence
dossiers, the engagement flow. It was designed before plan 078 landed, so it
carries **a second, parallel recruiting data model** built directly on legacy
tables. Merging it as-is would make Phases 6–8 of the 078 migration
significantly harder and would ship a real privacy gap.

This plan keeps the product surface and the agent **entirely intact** and
changes only the data layer underneath it, so that `/hire`:

1. reads candidates through `src/repositories/`, and therefore flips to the new
   078 model on the same `ENABLE_NEW_TALENT` flag as everything else;
2. stops introducing models that 078 already has;
3. keys candidates on `User`, not on `ProgramMember` (078 §2.4);
4. applies **one** visibility gate to **every** track.

**This plan does not require Phase 6.** `/hire` reads legacy on day one, exactly
as it does in the PR today. The point is that the read lives behind the seam.

---

## 2. Current behavior

### 2.1 What `master` is (do not lose this context)

Per `docs/project-context.md` §4 and §18: the 078 additive schema is applied to
production, `ENABLE_DUAL_WRITE` is **on**, every `ENABLE_NEW_*` is **off**,
Phase 2 backfill is **incomplete** (stopped in 2e on a `P2032`), and legacy
tables are **authoritative for every read**. `src/repositories/` is the boundary
that makes Phase 6 a flag flip rather than a UI rewrite.

078 already defines the recruiting bounded context: `Organization`,
`OrganizationMember`, `RecruiterProfile`, `TalentList`, `TalentListItem`,
`CandidateNote`, `Job`, `JobApplication`, `JobSkill`, `AssessmentReport`,
`AssessmentScore`, `AssessmentReportShare` — plus the identity side
(`CandidateProfile`, `CandidateVisibility`, `CandidatePreference`,
`CandidateSkill`, `SkillEvidence`) and `UserRoleAssignment(RECRUITER)`.

### 2.2 What PR #200 adds

**Schema** (`prisma/schema.prisma`, +251 lines, 3 migrations):

| Model | Purpose |
|---|---|
| `TalentRequest`, `TalentRequestMessage` | the recruiter's requirement + Scout conversation |
| `TalentRequestMatch` | scored candidate snapshot, frozen at match time |
| `CandidateAvailability` | openToWork, salary expectation, notice period, work mode, cities, relocate |
| `TalentEngagementRequest`, `TalentEngagementMessage` | one recruiter/candidate ask; `CONTACT_SHARED` releases contact |
| `VerifiedRecruiterSeat` | email allowlist deciding who gets recruiter access |
| `RecruiterEmailOtp` | baseline of a table already in the DB from an unmerged migration |

Enums: `TalentRequestStatus`, `TalentWorkMode`, `TalentEmploymentType`,
`TalentSeniority`, `TalentMatchTier`, `TalentEngagementStatus`,
`TalentCandidateSource`.

**Reads.** `src/features/hire/*` calls `prisma.programMember`,
`prisma.enrollment`, `prisma.hackathonParticipant`, `prisma.submission`,
`prisma.programMissionSubmission`, `prisma.programDay` **directly**. Nothing in
`src/features/hire/` imports `src/repositories/`.

**Gate.** `memberEligibilityWhere()` in `features/hire/pool-policy.ts` builds its
own consent clause (`recruiterVisibilityConsentAt: { not: null }`) — a second
copy of the fragment that `repositories/talent.ts` documents as *"THE ONLY
visibility fragment for recruiter candidate search (§8.3)"*.

**Auth.** A `recruiter-otp` Credentials provider in `src/auth.ts`; recruiter
access decided by `VerifiedRecruiterSeat` lookup.

**Removals.** `getTalentPool` deleted with its only caller; `/talent` 404s;
`/talent/shortlist`, `/talent/register`, `/talent/pending`, evidence profiles
still serve.

---

## 3. The eight findings, and what each one costs

Ordered by severity. Findings 1–4 are merge blockers; 5–8 are required but
mechanical.

### F1 — `CandidateAvailability` is a 100% duplicate of `CandidatePreference` — BLOCKER

Every column has an existing home:

| `CandidateAvailability` | `CandidatePreference` (078, already in production) |
|---|---|
| `openToWork` | `openToWork` |
| `expectedSalaryMin` / `Max` | `expectedSalaryMin` / `Max` |
| `salaryCurrency` | `salaryCurrency` |
| `noticePeriodDays` | `noticePeriodDays` |
| `preferredWorkMode` | `remotePreference` |
| `preferredCities` | `preferredLocations` |
| `openToRelocate` | `willingToRelocate` |

There is **no gap to fill**. Shipping this creates a third `openToWork` on the
platform (`CandidatePreference`, `CandidateAvailability`, and the legacy
`ProgramMember` talent gate), which is exactly the "points exist in three
places" failure 078 §2.12 was written to stop.

The PR's own comment says `CandidateAvailability` is empty in production, so
there is **nothing to migrate** — the model can be deleted outright rather than
merged and then unwound in Phase 8.

**One real constraint:** `CandidatePreference.userId` FKs to
`CandidateProfile.userId`, not `User.id`. Phase 2a backfilled 10,913 of ~12,803
users, so ~1,890 users have no `CandidateProfile` row yet. The availability form
must **ensure the profile row exists** before writing the preference — the same
shape as `ensureCandidateVisibility` in `src/repositories/dual-write.ts`.

### F2 — Challenge and hackathon candidates enter the pool with no visibility gate at all — BLOCKER

`memberEligibilityWhere()` applies `recruiterVisibilityConsentAt` to **program
members only**. The challenge and hackathon paths do not apply it, or anything
equivalent:

- `features/hire/challenge-dossier.ts` → `buildChallengeDossierSet` selects
  `prisma.enrollment` filtered on `submissions: { some: {} }` and a day floor.
  No consent field, no `CandidateVisibility`, no `deletedAt` check.
- `features/hire/pool-policy.ts` → `resolveEligibleCandidates` re-tests
  `PROGRAM` refs against status **and** consent, but re-tests `CLAUDE`,
  `CHALLENGE_60` and `HACKATHON` refs against **only** the feature flag and a
  submission count.

So with `HIRE_CHALLENGE_POOL` enabled, every challenge participant above the day
floor becomes a recruiter-visible candidate, and a recruiter can raise a
`TalentEngagementRequest` against them. When an admin moves that request to
`CONTACT_SHARED`, their contact details are released — for a person who was
never gated on anything.

The PR argues the cards are pseudonymous (`AB-####`, no name), and that is true
of the *card*. It is not true of the engagement flow the same refs feed into.

**Routing through the 078 gate fixes this structurally**, because
`CandidateVisibility` hangs off `User` and therefore applies identically to every
track — 078 §10.1. This is the strongest single argument for the whole plan: the
new architecture makes a class of bug unrepresentable rather than patching four
call sites.

### F3 — Matches and engagements key on `ProgramMember`, not on a person — BLOCKER

`TalentRequestMatch.programMemberId → ProgramMember` and
`TalentEngagementRequest.programMemberId → ProgramMember` are precisely 078
§2.4, *"Recruiter shortlisting points at a cohort row, not a person"*, listed as
CRITICAL. Consequences already visible in the PR: `TalentRequestMatch` needs a
nullable `programMemberId` **and** a nullable `studentUserId` **and** a `source`
enum to say which one is real — three columns doing one column's job, because
the identity is a cohort row.

`TalentEngagementRequest` also denormalises `candidatePublicId` as a `String`
for cross-checking, which is a reasonable audit field but not an identity.

Under 078, a candidate **is** `User.id`, in every track, forever.

### F4 — Salary is exposed to recruiters, against a stated 078 privacy commitment — BLOCKER (decision needed)

`CandidatePreference.expectedSalaryMin/Max` carries this comment in the live
schema:

> `/// Private. Exposed only to admins, never on any recruiter or public surface.`

`features/hire/to-public-match.ts` surfaces `compensation.declared` — the
candidate's stated pay — to the recruiter card whenever it exists.

The PR's *estimated* band (`features/hire/compensation.ts`) is fine and is a nice
piece of work: it is derived from role family and evidence, explicitly labelled
as ABTalks' own number, and never filters anybody out. The conflict is only the
**declared** value.

This needs your decision (§9), not a unilateral rewrite. It is currently moot in
production — no candidate has ever filled one in — which makes it cheap to
decide correctly now rather than after someone does.

### F5 — Two recruiter identity systems

`VerifiedRecruiterSeat` (email allowlist) decides recruiter access. 078 decides
it with `UserRoleAssignment(RECRUITER)` + `RecruiterProfile` +
`OrganizationMember`.

`VerifiedRecruiterSeat` is not *pure* duplication. 078 already models invites —
`OrganizationMember.status` defaults to `INVITED` and it carries
`invitedByUserId` — but `OrganizationMember.userId` is a required FK to `User`,
so 078 can only invite **someone who already has an account**. The seat table
covers the case 078 cannot express: an allowlist entry for an email with no
`User` row yet.

So keep the table, narrow its job to *pre-registration invite*, and have
redemption provision the 078 rows (`OrganizationMember` included, which is where
the invite then lives).

### F6 — The track registry duplicates the 078 learning catalog

`features/hire/track-registry.ts` is a hand-rolled catalog of learning tracks.
078 Phase 2d already seeded the real one in production: 5 programs, 9 cohorts,
342 activities, with deterministic slugs `legacy-se` / `legacy-ds` / `legacy-ai`
/ `legacy-claude` and `legacy-program-<programCohortId>`.

The registry's *design* is right — tracks as data, read at runtime through
`list_tracks`, slugs as free strings rather than an enum. Two of its four wire
slugs are load-bearing (`encodeCandidateRef` writes `"CLAUDE:<id>"` into
localStorage carts and stored match rows, so renaming orphans recruiter data).
So: **keep the wire slugs, add the mapping**, and the eventual switch becomes a
lookup instead of a rename.

### F7 — Migrations cannot be applied as written

Three migrations are included and none has been run against any database (the PR
says so). After F1/F3 land, all three need regenerating. Additionally:

- `master` **cannot** run `prisma migrate deploy` against production — there is a
  leftover `20260813000000_general_interview` folder from the reverted PR #168.
  078 applies migrations with `prisma db execute` + `prisma migrate resolve
  --applied`. Same applies here.
- `20260812190000_recruiter_email_otp_baseline` baselines a table created by
  `20260810100124_recruiter_email_otp`, whose code was never merged. Confirm
  that table's DDL against `information_schema` on the **production** branch
  before assuming the baseline matches.

### F8 — Plan file numbers collide

The PR adds `docs/plans/078-scout-honor-stated-filters.md`, which collides with
the three 078 platform-architecture plans. It also adds 065, 066, 067, 076, 077,
079, 080, 081. `master` already carries plans at 065, 066, 067, 076, 077, 078,
079. Duplicated numbers already exist on `master`, so this is not new — but a
second `078-*` is actively confusing while the migration is the thing everyone is
reading about.

---

## 4. Files to touch

### Schema and migrations

| Path | | Note |
|---|---|---|
| `prisma/schema.prisma` | `[edit]` | delete `CandidateAvailability`; rework `TalentRequestMatch` / `TalentEngagementRequest` keys; rescope `VerifiedRecruiterSeat`; keep `RecruiterEmailOtp` |
| `prisma/migrations/20260811140000_talent_requests_hire_scout/` | `[edit]` | regenerate after schema rework |
| `prisma/migrations/20260812120000_hire_engagement_requests_and_seats/` | `[edit]` | regenerate |
| `prisma/migrations/20260812190000_recruiter_email_otp_baseline/` | `[edit]` | verify against production `information_schema` first |
| `prisma/seed-hire-fixtures.ts` | `[edit]` | write `CandidatePreference`, not `CandidateAvailability` |

### Repository layer (the seam)

| Path | | Note |
|---|---|---|
| `src/repositories/hire.ts` | `[new]` | **the only new abstraction this plan authorises.** Candidate pool + dossier reads for `/hire`, flag-branched on `isNewTalentRepoEnabled()` |
| `src/repositories/talent.ts` | `[edit]` | export the gate so `/hire` consumes it instead of copying it |
| `src/repositories/candidate.ts` | `[edit]` | add `getPreference` / `upsertPreference` (ensures `CandidateProfile` first) |
| `src/repositories/types.ts` | `[edit]` | add the hire pool return types — the Phase 6 contract |
| `src/repositories/index.ts` | `[edit]` | re-export |

### Hire feature (data layer only — leave the agent alone)

| Path | | Note |
|---|---|---|
| `src/features/hire/pool-policy.ts` | `[edit]` | delete the local consent clause; call the repository |
| `src/features/hire/challenge-dossier.ts` | `[edit]` | reads move behind the repository; gate applied |
| `src/features/hire/hackathon-dossier.ts` | `[edit]` | same |
| `src/features/hire/dossier.ts` | `[edit]` | same; `CandidateAvailability` → `CandidatePreference` |
| `src/features/hire/track-loaders.ts` | `[edit]` | same |
| `src/features/hire/track-registry.ts` | `[edit]` | add `cohortSlug` mapping field |
| `src/features/hire/candidate-ref.ts` | `[edit]` | refs carry `userId`; wire slugs unchanged |
| `src/features/hire/to-public-match.ts` | `[edit]` | declared-pay exposure per §9 decision |
| `src/features/hire/compensation.ts` | — | **leave alone**, the estimator is fine |
| `src/features/hire/recruiter-account.ts` | `[edit]` | seat redemption provisions 078 rows |
| `src/features/hire/scout-*.ts`, `score-candidate.ts`, `sample-card.ts`, `spec-fields.ts`, `role-family.ts`, `explain-matches.ts` | — | **leave alone**. Not the problem. |

### Actions

| Path | | Note |
|---|---|---|
| `src/app/actions/hire-actions.ts` | `[edit]` | resolve candidates via repository |
| `src/app/actions/hire-request-actions.ts` | `[edit]` | engagement rows key on `candidateUserId` |
| `src/app/actions/hire-guest-actions.ts` | `[edit]` | same |
| `src/app/actions/recruiter-auth-actions.ts` | `[edit]` | provision 078 rows on registration |
| `src/app/actions/recruiter-seat-actions.ts` | `[edit]` | seat = invite |

### Docs

| Path | | Note |
|---|---|---|
| `docs/plans/0XX-*.md` × 12 | `[edit]` | renumber into 083–094; keep contents byte-identical |
| `docs/CHANGELOG.md` | `[edit]` | one `## Pending reconcile` line, per `.cursorrules` |

---

## 5. Server vs Client

Everything in §4 is **server-side**. The rule that matters here is one the PR
already got right and that must survive the refactor:

- `features/hire/track-registry.ts` is **deliberately pure** — no Prisma, no
  `server-only`. `pool-brief.ts` imports it and is reachable from the client via
  `guest-matches-store`. **Adding the `cohortSlug` field must not turn this into
  a Prisma import.** The mapping is a literal; resolution happens in
  `track-loaders.ts`, which is `server-only`.
- `src/repositories/*` all carry `import "server-only"`. `src/repositories/hire.ts`
  must too.
- `features/hire/compensation.ts` is shared (the card renders it) — keep it pure.
- No Server→Client prop passing changes. The client components
  (`components/hire/*`) receive the same serialised shapes; if a return type
  changes in `repositories/types.ts`, the change stops at `to-public-match.ts`.

---

## 6. Steps

### W0 — Merge hygiene (no schema, do this first)

1. Renumber the 12 plan docs to `083`–`094`, preserving contents exactly.
   `078-scout-honor-stated-filters.md` → `090-scout-honor-stated-filters.md`.
2. Confirm the branch still merges cleanly onto `3b040d8`.

### W1 — Delete `CandidateAvailability`

3. Remove the model, its `User` relation, and the enum members only it uses,
   from `prisma/schema.prisma`.
4. Add to `src/repositories/candidate.ts`:
   - `getCandidatePreference(userId)` → reads `CandidatePreference`
   - `upsertCandidatePreference(userId, input)` → **ensures a `CandidateProfile`
     row exists first** (mirror `ensureCandidateVisibility` in
     `src/repositories/dual-write.ts`), then upserts, in one transaction.
5. Field mapping in `features/hire/dossier.ts` and `availability-form.tsx`:
   `preferredWorkMode` → `remotePreference`, `preferredCities` →
   `preferredLocations`, `openToRelocate` → `willingToRelocate`. Salary and
   notice-period names are already identical.
6. `prisma/seed-hire-fixtures.ts` writes `CandidatePreference`.

### W2 — Key candidates on `User`

7. `TalentRequestMatch`: **add** `candidateUserId String` — required, FK to
   `User`, `onDelete: Cascade` — and **drop** `studentUserId`. Keep
   `programMemberId String?` **as provenance only** — no FK relation, no query
   uses it — or drop it entirely if nothing reads it. Keep `source`; it stays
   useful for display and for the dedupe rule.
8. `TalentEngagementRequest`: `candidateUserId` already exists but is nullable —
   make it **required**, with `onDelete: Restrict` (an engagement is evidence of
   a recruiter interaction and must not vanish, consistent with the 078 Phase 1
   FK posture on `Certificate` / `SynergyEvent` / `RecruiterShortlistItem`).
   Demote `programMemberId` to provenance as in step 7. Keep
   `candidatePublicId` — it is an audit field, and it is a good one.
9. `candidate-ref.ts`: refs resolve to `{ source, userId }`. **The wire format
   `"<SLUG>:<id>"` does not change** — but audit whether any stored ref or
   localStorage cart holds a `ProgramMember.id` rather than a `User.id`, and if
   so write a one-shot translation at read time. Do not silently reinterpret an
   id.
10. Update the three actions in §4 accordingly.

### W3 — One gate, every track

11. In `src/repositories/talent.ts`, export the gate as the single source:
    - legacy branch → today's `visibleProgramMemberWhere()` semantics
    - new branch → `buildUserGate()` (`visibility: { is: { searchableByRecruiters: true } }`, `deletedAt: null`)
12. Delete the consent clause from `features/hire/pool-policy.ts`
    `memberEligibilityWhere()`. It calls the repository.
13. **Apply the gate to the challenge and hackathon paths**, which today have
    none — `challenge-dossier.ts`, `hackathon-dossier.ts`, and every branch of
    `resolveEligibleCandidates`. This is F2 and it is the point of the exercise.
14. Add a test asserting that a candidate with
    `CandidateVisibility.searchableByRecruiters = false` (or `withdrawnAt` set)
    is absent from **all four** track paths and cannot be resolved into an
    engagement request. The PR's 103 tests are a good base; this is the one they
    do not have.

### W4 — The repository seam

15. Create `src/repositories/hire.ts`, `import "server-only"`, with the pool and
    dossier reads `/hire` needs, each branching on `isNewTalentRepoEnabled()`.
    **Both branches must return the same shape** — that shape is the Phase 6
    contract (078 §8.2).
16. Legacy branch: move the existing queries in, unchanged apart from the gate.
17. New branch: `CandidateProfile` + `CandidateSkill`/`SkillEvidence` +
    `ProgramEnrollment`/`EnrollmentProgress` + `AssessmentReport`. **Write it,
    do not wire it live** — `ENABLE_NEW_TALENT` is off and the backfill is
    incomplete. It exists so the seam is real and typechecked, not aspirational.
18. Remove every direct `prisma.*` call from `src/features/hire/*`. After this
    step, `grep -rn "prisma\." src/features/hire/` returns nothing.

### W5 — Recruiter identity onto 078

19. Rescope `VerifiedRecruiterSeat` to a **pre-registration invite**: it decides
    who *may* register, and nothing else.
20. On redemption, in one transaction, provision:
    `UserRoleAssignment(RECRUITER)` · `RecruiterProfile` ·
    `Organization` (find-or-create by the seat's `company`) ·
    `OrganizationMember`.
21. Every recruiter surface authorises on `UserRoleAssignment` / `RecruiterProfile`,
    never by re-reading the seat table. The seat is spent at redemption.
22. `src/auth.ts`: keep the `recruiter-otp` provider as written. It is correct —
    including the detail that a valid code for an unregistered address must not
    become an account. **Do not add `requireRole` to it**; it is a public auth
    surface (standing guardrail).

### W6 — Track registry keyed to the 078 catalog

23. Add `cohortSlug: string | null` to `TrackDescriptor`, mapping each track to
    its seeded 078 cohort: `CLAUDE` → `legacy-claude`, `CHALLENGE_60` →
    `legacy-se` / `legacy-ds` / `legacy-ai`, `PROGRAM` →
    `legacy-program-<programCohortId>`, `HACKATHON` → `null` (hackathons are a
    separate bounded subsystem by design — 078 §3.4 — and reach the profile
    through `CandidateAchievement` / `Credential` / `SkillEvidence`).
24. `track-loaders.ts` resolves through `cohortSlug` in the new branch and
    through the legacy tables in the old one. **Wire slugs stay exactly as they
    are.**

### W7 — Migrations

25. Regenerate all three after W1/W2/W5.
26. Verify `RecruiterEmailOtp` DDL against production `information_schema` before
    trusting the baseline.
27. Apply per the 078 production convention: `prisma db execute` +
    `prisma migrate resolve --applied`. **Never `prisma migrate deploy` against
    production** while `20260813000000_general_interview` is present.

### W8 — Salary exposure

28. Implement whichever option §9 returns. Default if no answer arrives:
    **suppress declared pay on the recruiter surface, keep the estimated band.**
    That preserves the stated schema commitment and loses nothing today, because
    the field is empty in production.

---

## 7. Guardrails for Cursor — DO NOT

- **DO NOT** rewrite, refactor or "improve" the Scout agent, the scorer, sample
  cards, chips, role families, or `explain-matches`. Those files are out of
  scope. Touch only what §4 lists.
- **DO NOT** create `CandidateAvailability`, or any other model whose columns
  already exist on `CandidatePreference`.
- **DO NOT** add a second copy of the visibility gate. There is exactly one, in
  `src/repositories/talent.ts`. If you find yourself writing
  `searchableByRecruiters` or `recruiterVisibilityConsentAt` anywhere else, stop.
- **DO NOT** spread repeated `user:` keys in a Prisma where-clause. They
  silently overwrite each other and drop the gate — 078 §10.1. Merge into one
  `user` clause.
- **DO NOT** turn on any `ENABLE_NEW_*` flag. This plan ships with all of them
  off and legacy authoritative.
- **DO NOT** add `server-only` or a Prisma import to
  `features/hire/track-registry.ts` or `features/hire/compensation.ts`. Both are
  reachable from the client.
- **DO NOT** add `requireRole` / `requireAdmin` to `/talent/login`,
  `/talent/register`, the `recruiter-otp` provider, or the Auth.js handler.
  Public by design.
- **DO NOT** import `@/lib/*` into `middleware.ts`. The PR's middleware change is
  edge-safe (`next-auth`, `next/server`, `@/auth.config` only) — keep it that
  way, and keep both protections: the exact-match rule so `/ai` does not capture
  `/ai-workshop`, and the public recruiter entries.
- **DO NOT** rename the four legacy wire slugs (`PROGRAM`, `CLAUDE`,
  `CHALLENGE_60`, `HACKATHON`). They are written into localStorage carts and
  stored match rows.
- **DO NOT** run `prisma migrate deploy` against production.
- **DO NOT** create new abstraction files beyond `src/repositories/hire.ts`.
- **DO NOT** delete `getTalentPool`'s replacement path without checking
  `repositories/talent.ts` `searchCandidates` still compiles — it is the Phase 6
  seam and must survive the `/talent` pool removal.
- When a build or type error contradicts an assumption in this plan, **trust the
  error and gather data**. Report back rather than working around it.

---

## 8. DB safety

Schema and data both change. Before any DB-touching step:

1. `git add -A && git commit -m "checkpoint before 082 hire schema rework"` —
   note the hash.
2. Create a Neon child branch from `production` as a snapshot. Record name +
   id in this plan's commit message.
3. **All Neon mutations target a production child branch** unless that exact
   production write is explicitly authorised (standing rule, §17 of
   `project-context.md`).
4. Migration work uses the **direct, non-pooler** Neon host — the pooled endpoint
   drops interactive transactions that use `SAVEPOINT`.

Rehearse on the child, in order: apply the three regenerated migrations →
`npx prisma generate` → `npm run build` → run the hire test suite → smoke `/hire`
end to end → confirm `npm run db:check:078:drift` is unchanged.

**Do not run the 078 Phase 2 backfill from this branch.** It is mid-flight and
stopped in 2e for an unrelated reason.

### Interaction with the stalled 078 backfill

None of this plan depends on Phase 2 completing. `/hire` reads legacy. But note
for sequencing: `src/repositories/hire.ts`'s **new** branch cannot be validated
until 2e finishes and Phase 5 passes. Write it, typecheck it, leave it dark.

---

## 9. Decisions needed from you

Three, and they change what gets built:

1. **Declared salary on the recruiter card (F4).** Suppress it and keep only the
   estimated band? Show it and amend the `CandidatePreference` comment plus the
   privacy copy? Or show it only after `CONTACT_SHARED`? *(Default if unanswered:
   suppress.)*
2. **`HIRE_CHALLENGE_POOL` at launch.** Once the gate from W3 applies, the
   challenge pool is bounded by `CandidateVisibility` — which, per
   `project-context.md` §5, currently resolves to roughly **19 people** until the
   Phase 2b recruiter-visibility population is corrected. Ship `/hire` with the
   flag off until 2b is fixed, or treat fixing 2b as a dependency of this merge?
3. **`ProgramCohort.resultsPublishedAt` gate.** The PR deliberately loosens
   `/hire` to rank evidence-so-far from open cohorts, while `/talent` keeps the
   published-only gate. Confirm that is intended, because it becomes the platform
   default once `/talent`'s pool is removed.

---

## 10. Verification

**Must pass:**

- `npx tsc --noEmit` clean
- `npx prisma validate` clean
- `npm run build` succeeds; `/hire`, `/hire/matches`, `/hire/requests`,
  `/hire/evidence`, `/admin/hire` all present
- the PR's 103 tests still pass (22 hire-score, 52 scout, 29 sample) — this plan
  should not change a single scoring or agent assertion
- **new:** the visibility test from step 14, covering all four track paths
- `grep -rn "prisma\." src/features/hire/` returns **nothing**
- `grep -rn "CandidateAvailability" src/ prisma/` returns **nothing**
- `grep -rn "searchableByRecruiters\|recruiterVisibilityConsentAt" src/` returns
  hits **only** in `src/repositories/`
- `npm run db:check:078:drift` unchanged from before the merge

**Manually test:** recruiter registers via a seat → lands approved with
`RecruiterProfile` + `UserRoleAssignment` + `OrganizationMember` rows → Scout
returns matches → shortlist → engagement request → admin moves to
`CONTACT_SHARED` → contact appears. Then set a candidate's
`CandidateVisibility.searchableByRecruiters = false` and confirm they vanish from
search **and** cannot be resolved into a new engagement request.

**Files that should have changed:** exactly those in §4. Nothing under
`src/components/hire/` except `availability-form.tsx`; nothing under
`src/features/hire/` except the files listed.

---

## 11. Commit message

```
refactor(hire): land Scout on the 078 data architecture

Routes every /hire candidate read through src/repositories so the recruiter
desk flips on ENABLE_NEW_TALENT with everything else, and drops the parallel
recruiting models 078 already provides.

- CandidateAvailability deleted; availability lives on CandidatePreference
- matches and engagements key on User.id, not ProgramMember (078 s2.4)
- one visibility gate, applied to program, challenge and hackathon alike —
  the challenge and hackathon paths previously had none
- VerifiedRecruiterSeat rescoped to a pre-registration invite that provisions
  UserRoleAssignment(RECRUITER) + RecruiterProfile + OrganizationMember
- track registry mapped to the seeded 078 cohort slugs; wire slugs unchanged

Scout, the scorer and the desk UI are untouched. All ENABLE_NEW_* stay off;
legacy remains authoritative.
```
