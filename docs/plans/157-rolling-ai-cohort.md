# 157 — AI Cohort: rolling, always-open, no stale dates

## 1. Goal

Make the AI Cohort behave like every other `/program/*` track: open to join on any
day, day pacing anchored on the **learner's own start date**, and never frozen by
a cohort end date. Then remove the stale month labels it shows today, and add a
guard so no track can be date-frozen again.

## 2. Current behavior

### 2.1 What the user sees, and why

Two symptoms, three distinct causes.

**Symptom A — "AI cohort is not taking submissions."**

`src/features/program/missions.ts:103` and `src/features/program/mentor.ts:73`
both gate on `isCohortFrozen(member.cohort)`. That resolves to
`isCohortPastEndsAt` (`progression.ts:146`) — `new Date() > cohort.endsAt`.

Production (read-only query, `ep-young-shadow-amawetjy`, 2026-09-28):

| canonical `Cohort` slug | name | mode | startsAt | endsAt | enrollments |
|---|---|---|---|---|---|
| `legacy-program-cms969sax…` | AI Cohort India Aug 26 | **FIXED** | 2026-07-31 | **2026-09-02** | 50 |
| `legacy-program-cmrp9r3wt…` | AI Cohort USA | **FIXED** | 2026-07-17 | **2026-08-19** | 19 |
| `databricks-open`, `snowflake-open`, `powerbi-open`, `ds-architect-open`, `databricks-ai-open` | — | ROLLING | null | null | 8 |
| `legacy-se`, `legacy-ds`, `legacy-ai`, `legacy-claude` | 60-day challenge | ROLLING | null / 2026-05-31 | null | 3,340 |

The open-enrollment cohort ended **2026-09-02**. Every mission submit since then
returns `"This cohort has ended — submissions are closed."` The USA cohort is
past its end date too and survives only by the `PROGRAM_HOLD_OPEN_COHORT_NAME`
name-string hack in `constants.ts:28`, which matches the literal string
`"AI Cohort USA"`.

**The AI Cohort is the only remaining FIXED track on the platform.**

**Symptom B — "some august date is showing."** Two sources:

- `src/components/talent-hunt/hero.tsx:40,48` — hardcoded chips
  `Launch: 15 Jul 2026` and `Completion: 30 Aug 2026`, rendered on both
  `/ai-cohort-register` and `/ai-cohort-india`.
- The cohort **name** itself, `"AI Cohort India Aug 26"`, rendered at
  `src/app/program/ai-cohort/apply/page.tsx:172` (`Apply to {state.cohortName}`)
  and `:97` (the closed screen).

**Latent cause C — pacing is cohort-anchored, not learner-anchored.**
`getCohortCalendarDay` (`progression.ts:135`) measures IST days since the
*shared* `Cohort.startsAt` and clamps to 31. Because both live cohorts started in
July, that clamp pins every member at day 31, so all 31 days sit unlocked and
`deriveDayState`'s sequential rule is the only brake. Late joiners (the India
cohort has joins through **2026-09-09**, a week past its own end date) get no
pacing at all. A cohort created today would instead lock a late joiner out of
days they should already have.

### 2.2 Two traps that must be handled in the same pass

**Trap 1 — `endsAt ?? new Date(0)`.** Three mappers coerce a null cohort date to
the Unix epoch:

- `src/repositories/program-state.ts:795-796`
- `src/repositories/learning.ts:697-698`, `877-878`

So nulling the dates in the database *without* the code change leaves
`isCohortPastEndsAt` comparing against **1970** — still frozen, now permanently
and for every rolling track that maps through these helpers. Fix the code first.

**Trap 2 — admin cohort edits never reach members.**
`createOrUpdateCohort` / `setCohortStatus` / `regenerateJoinCode`
(`src/features/program/admin.ts`) write **only** `prisma.programCohort`. Every
member-facing read comes from the canonical `Cohort` table
(`getCohortByJoinCode`, `getOpenEnrollmentCohort`, `findActiveMembership`,
`findAiCohortMembershipByMemberId`). There is **no runtime write path to
`Cohort`** anywhere in `src/` — only `prisma/seed-*.ts` and
`prisma/scripts/migrate-2d-learning-content.ts`. The two tables happen to agree
today because the 078 migration created them together. An admin fixing the end
date in `/admin/program` right now would change nothing.

### 2.3 What is safe to change

All 69 live AI-cohort enrollments are `ACTIVE` with **`missionPoints = 0`** —
nobody has passed a single mission, so no progress or score is at risk.
`ProgramEnrollment.startedAt == joinedAt` on **69/69** rows (real join
timestamps, not a cohort calendar), so `startedAt` is already a valid
per-learner anchor with no backfill needed. `unlockFloorDay = 4` on every row,
which `effectiveUnlockFloor` (`progression.ts:88`) already neutralises.

`isProgramEntryBypassEnabled()` returns `true` unconditionally
(`feature-flags.ts:67`), so applying already auto-enrolls — the entry gate is
not part of this problem.

### 2.4 Reference implementation to follow

`src/features/snowflake/progression.ts` is the house pattern: `anchorKey(startedAt)`,
`unlockKeyForDay(startedAt, n)`, `elapsedDay(startedAt)`, `maxUnlockedDay`,
`behindByDays` — all per-learner, and `enroll.ts` gates on cohort **status**
(`ENROLLING` or `ACTIVE`) with no date arithmetic. Mirror it.

## 3. Files to touch

### Core pacing

| File | | Note |
|---|---|---|
| `src/features/program/progression.ts` | `[edit]` | Re-anchor all day math on `startedAt`; `isCohortFrozen` gates on status only. |
| `src/features/program/constants.ts` | `[edit]` | Delete `PROGRAM_HOLD_OPEN_COHORT_NAME`. |

### Repository boundary (nullable dates + expose the anchor)

| File | | Note |
|---|---|---|
| `src/repositories/program-state.ts` | `[edit]` | Add `startedAt` to `PE_MEMBERSHIP_SELECT` + `AiCohortMembershipRow`; drop `?? new Date(0)`, make dates `Date \| null`. |
| `src/repositories/learning.ts` | `[edit]` | Same for `PE_COHORT_SELECT` / `membershipFromPe` / `ProgramMembership` / `getCohortByJoinCode`; accept `ACTIVE` in `getOpenEnrollmentCohort`. |

### Call sites

| File | | Note |
|---|---|---|
| `src/features/program/missions.ts` | `[edit]` | 3 `getMaxContentDay` calls + the freeze guard take `startedAt`. |
| `src/features/program/days.ts` | `[edit]` | `getMaxContentDay(member.startedAt, …)`. |
| `src/features/program/dashboard.ts` | `[edit]` | `memberDay` / `behindBy` / `nextUnlockDateLabel` from `startedAt`; drop the `programCohort.findUnique`. |
| `src/features/program/mentor.ts` | `[edit]` | Freeze guard. |
| `src/features/program/commits.ts` | `[edit]` | Credit window = learner's 31 days, not the cohort window. |
| `src/features/program/bootstrap-start-day.ts` | `[edit]` | `seedEarlyCommitDays` window from `startedAt`. |
| `src/features/program/recommendations.ts` | `[edit]` | `calendarDay` → member's own day. |
| `src/features/program/admin.ts` | `[edit]` | Per-member day; `dailyEngagement` re-based on each member's offset. |
| `src/features/program/entry.ts` | `[edit]` | Accept `ENROLLING` **or** `ACTIVE` at the 4 status checks. |
| `src/features/hire/dossier.ts` | `[edit]` | `cohortDay` → member day from `startedAt`. |
| `src/app/actions/admin-program-export-actions.ts` | `[edit]` | Per-member day in the at-risk export. |
| `src/app/program/ai-cohort/(app)/videos/page.tsx` | `[edit]` | Learner day + copy. |

### Copy

| File | | Note |
|---|---|---|
| `src/components/talent-hunt/hero.tsx` | `[edit]` | **CROSS-MODULE (Shallika)** — replace the two hardcoded date chips. |

### Admin write path (Trap 2)

| File | | Note |
|---|---|---|
| `src/features/program/admin.ts` | `[edit]` | Mirror cohort writes onto canonical `Cohort`; dates optional. |
| `src/lib/validations/program.ts` | `[edit]` | `cohortFormSchema`: `startsAt` / `endsAt` optional. |
| `src/app/actions/admin-program-actions.ts` | `[edit]` | Pass `null` through when blank. |
| `src/components/program/program-cohort-panel.tsx` | `[edit]` | **Client** — dates optional, labelled "optional (rolling cohort)". |

### Data + guard

| File | | Note |
|---|---|---|
| `prisma/scripts/make-ai-cohort-rolling.ts` | `[new]` | Flip the two live cohorts to ROLLING, null the dates, rename, raise capacity, mirror to `ProgramCohort`. `--dry-run` default. |
| `src/features/program/rolling-cohort-invariants.test.ts` | `[new]` | Source-scanning guard: no track may freeze on a date, no `?? new Date(0)` date coercion. |
| `package.json` | `[edit]` | Add `test:rolling-cohort` script. |
| `docs/project-context.md` | `[edit]` | §4 / §18 — record the AI cohort as ROLLING. |
| `docs/CHANGELOG.md` | `[edit]` | One dated line under `## Pending reconcile`. |

## 4. Server vs Client

Everything above is a **Server Component / server module** except:

- `src/components/program/program-cohort-panel.tsx` — **Client** (`"use client"`,
  already). Receives `rawStartsAt` / `rawEndsAt` as `string | null`. Plain
  strings only; no functions, icons or class instances cross the boundary.
- `src/components/talent-hunt/hero.tsx` — **Client**? No: it is a plain
  presentational component with no `"use client"`; it stays a Server Component.
  Only literal strings change.
- `src/app/program/ai-cohort/(app)/videos/page.tsx` — **Server**; passes plain
  `{ ...video, locked: boolean }` objects to the existing Client
  `VideoLibraryFilters`. Shape unchanged.

No new Server→Client prop crossings.

## 5. Steps

### Step 1 — `src/features/program/progression.ts`

This is the whole fix. Replace the cohort-anchored helpers with learner-anchored
ones. Keep the exported names where call sites are numerous; change the first
parameter from a cohort to an anchor.

1. Add at the top of the day-math section:

   ```ts
   /** The learner's own Day-1 anchor. Every AI-cohort day boundary derives from this. */
   export type ProgramAnchor = { startedAt: Date };
   ```

2. `getCohortCalendarDay(cohort)` → **rename to** `getMemberCalendarDay(anchor: ProgramAnchor)`.
   Body unchanged except `cohort.startsAt` → `anchor.startedAt`. Keep the
   `Math.min(PROGRAM_TOTAL_DAYS, Math.max(1, diff + 1))` clamp.

3. `getContentDayUnlockKey(cohort, dayNumber)` → `getContentDayUnlockKey(anchor: ProgramAnchor, dayNumber)`.
   `cohort.startsAt` → `anchor.startedAt`.

4. `getMaxContentDay(cohort, highestUnlockedDay)` → `getMaxContentDay(anchor: ProgramAnchor, highestUnlockedDay)`.
   Body calls `getCalendarDerivedMaxContentDay(getMemberCalendarDay(anchor))`.
   `getCalendarDerivedMaxContentDay` is unchanged.

5. `getBehindByDays(cohort, progressDay)` → `getBehindByDays(anchor: ProgramAnchor, progressDay)`.

6. **Delete** `isCohortPastEndsAt` entirely, and rewrite `isCohortFrozen` as a
   pure, synchronous status check — no dates, no DB, no name matching:

   ```ts
   /**
    * A cohort freezes only when an admin archives or completes it. Never on a
    * date: this track is rolling, so every member has their own calendar and a
    * shared end date would cut late joiners off mid-programme (plan 157).
    */
   export function isCohortFrozen(cohort: { status: ProgramCohortStatus }): boolean {
     return cohort.status === "ARCHIVED" || cohort.status === "COMPLETED";
   }
   ```

   Confirm the exact member names of `ProgramCohortStatus` in
   `prisma/schema.prisma` before writing the comparison; use only members that
   exist. It becomes synchronous — drop the `await` at both call sites.

7. Remove the now-unused imports: `PROGRAM_HOLD_OPEN_COHORT_NAME`,
   `listCanonicalProgramMemberIds`, `peIdForMember`, `prisma`,
   `ProgramCohortStatus` if unreferenced. Run the build to find them; do not
   guess.

8. `getMemberDayStates` and `getMemberCurrentModuleNumber` already load the
   membership — change `getMaxContentDay(member.cohort, …)` to
   `getMaxContentDay(member, …)` once `startedAt` is on the row (Step 2).

### Step 2 — `src/repositories/program-state.ts`

1. Add `startedAt: true` to `PE_MEMBERSHIP_SELECT`.
2. Add `startedAt: Date` to `AiCohortMembershipRow` (top level, beside
   `createdAt`) and to `hydrateAiCohortMembership`'s parameter type.
3. In the returned object add `startedAt: pe.startedAt`.
4. In the `cohort:` sub-object, change `startsAt: pe.cohort.startsAt ?? new Date(0)`
   to `startsAt: pe.cohort.startsAt` and the same for `endsAt`; widen both to
   `Date | null` in `AiCohortMembershipRow`. Add a comment:
   `// Never coerce a null cohort date to the epoch — that reads as "ended in 1970" (plan 157).`
5. Apply the same to any other mapper in this file that does the epoch coercion
   (grep `new Date(0)` in the file).

### Step 3 — `src/repositories/learning.ts`

1. Add `startedAt: true` to the `findActiveMembership` / `findAppliedMembership`
   selects (the enrollment-level select, not `PE_COHORT_SELECT`).
2. `ProgramMembership.member` gains `startedAt: Date`; `ProgramMembership.cohort`
   `startsAt` / `endsAt` become `Date | null`.
3. `membershipFromPe`: pass `startedAt` through, drop both `?? new Date(0)`.
4. `getCohortByJoinCode`: `startsAt` / `endsAt` become `Date | null`, drop the
   epoch defaults; update `ProgramCohortCatalog`.
5. `getCohortByJoinCode` and `getOpenEnrollmentCohort`: widen the status filter
   to `{ in: ["ENROLLING", "ACTIVE"] }`, matching `getSnowflakeCohort`. Leave
   `requiresJoinCode: false` on `getOpenEnrollmentCohort`.
6. `getOpenEnrollmentCohort` currently returns `null` when `joinCode` is null.
   An open cohort still has one today, so leave that guard alone.

### Step 4 — mission + mentor gates

`src/features/program/missions.ts`:
- `getDayAvailability`: `if (isCohortFrozen(member.cohort))` — no `await`.
  Keep the message but make it accurate: `"This cohort is closed — submissions are no longer accepted."`
- The three `getMaxContentDay(member.cohort, unlockFloor)` calls (lines ~114,
  ~174, ~299) become `getMaxContentDay(member, unlockFloor)`. At ~299, check
  which object is in scope in that closure and pass the one carrying `startedAt`.

`src/features/program/mentor.ts:73`: same de-`await`ed guard.

`src/features/program/days.ts:65`: `getMaxContentDay(member, unlockFloor)`.

### Step 5 — `src/features/program/dashboard.ts`

- Drop the `prisma.programCohort.findUnique({ select: { startsAt: true } })`
  from the `Promise.all` and the `if (!member || !cohort)` guard's cohort half —
  the anchor now comes from `member.startedAt`.
- `getMemberCalendarDay(member)`, `getBehindByDays(member, progressDay)`,
  `getMaxContentDay(member, unlockFloor)`, `getContentDayUnlockKey(member, nextLockedDay)`.
- Rename the `cohortDay` field on `MemberDashboard` to `memberCalendarDay`, and
  update the one consumer at `src/components/program/program-dashboard-view.tsx:217-218`.
  Change that copy from `` `The cohort is on day ${…}.` `` to
  `` `You're on day ${…} of ${PROGRAM_TOTAL_DAYS}.` `` — with rolling pacing there
  is no single cohort day. Keep `includeCohortPace` as the flag name or rename
  it to `includePace`; if renaming, update every reference in that file.

### Step 6 — `src/features/program/commits.ts`

Commit credit is windowed to the cohort (`isDateKeyInCohortWindow`,
`recomputeCommitPointsInTx`), which silently stops crediting after `endsAt`.
Re-window on the learner:

- Replace the `cohort: { startsAt: Date; endsAt: Date }` parameter on
  `isDateKeyInCohortWindow`, `recomputeCommitPointsInTx`,
  `recomputeCommitPointsForMember`, `creditCommitDayInTx` and the other
  window helpers with `anchor: ProgramAnchor`.
- The window is `[anchorKey, anchorKey + (PROGRAM_TOTAL_DAYS - 1)]`, built with
  `addCalendarDaysToKey` — the same shape as the existing key math.
- Rename `isDateKeyInCohortWindow` → `isDateKeyInMemberWindow`.
- The two `getBehindByDays(cohort, progressDay)` calls (lines ~451, ~524) take
  the anchor.
- `PROGRAM_COMMIT_UI_ENABLED` is `false`, so this is backend-only today. Fix it
  anyway — a stale window is exactly the bug being removed.

### Step 7 — `src/features/program/bootstrap-start-day.ts`

`seedEarlyCommitDays` clamps to the cohort window. Change its parameter to
`ProgramAnchor` and build the window from `startedAt`. Select `startedAt`
instead of `cohort: { select: { startsAt, endsAt } }` in the
`programEnrollment.findUnique`, and drop the `member.cohort` field.

`EARLY_COMMIT_DAY_COUNT` is `0` today (`PROGRAM_MEMBER_START_DAY = 1`), so this
path is dead — keep it correct, do not delete it.

### Step 8 — admin + analytics call sites

`src/features/program/admin.ts`:
- `~line 459` `getCohortCalendarDay(cohort)` in the cohort overview: a rolling
  cohort has no single calendar day. Replace `calendarDay` with
  `Math.max(...members.map(getMemberCalendarDay))` (1 when there are no members)
  so the `dailyEngagement` loop still has a ceiling.
- The `dailyEngagement` `dayOffset` arithmetic inside that loop is computed from
  `cohort.startsAt`. Re-base it per member: build a
  `Map<memberId, startKey>` from each member's `startedAt` before the loop, then
  compute `dayOffset` against that member's own start key. Keep the existing
  `86_400_000` offset arithmetic; only the start key changes.
- `~line 626` `getBehindByDays(cohort, progressDay)` → `getBehindByDays(m, progressDay)`
  (each `m` in the `scoped.map`).
- `~lines 917-918` already have `member.cohort`; use `member`.

`src/features/program/recommendations.ts:87`: `getMemberCalendarDay(member)`.

`src/features/hire/dossier.ts:289`:
`getCohortCalendarDay({ startsAt: m.cohort.startsAt })` →
`getMemberCalendarDay({ startedAt: m.startedAt })`. Rename the local
`cohortDay` / `cohortDayByMember` to `memberDay` / `memberDayByMember` and
follow the renames through the file. Confirm the dossier row type carries
`startedAt`; it comes from `listAiCohortMemberships`, which uses
`PE_MEMBERSHIP_SELECT` — so Step 2 covers it.

`src/app/actions/admin-program-export-actions.ts:71-77`: drop the
`programCohort.findUnique` and compute each row's day from its own member.

### Step 9 — `src/app/program/ai-cohort/(app)/videos/page.tsx`

- `const memberDay = getMemberCalendarDay(member);` — `requireProgramMember()`
  returns `{ member, cohort, userId }`, so destructure `member` and rely on the
  `startedAt` added in Step 3.
- `locked: v.dayNumber > memberDay`.
- Copy: `Content unlocks with the cohort calendar (day {cohortDay}/31).` →
  `Content unlocks one day at a time from your start date (day {memberDay}/31).`

### Step 10 — `src/features/program/entry.ts`

Four `cohort.status !== "ENROLLING"` checks (`getEntryState`'s applied branch and
join-code branch, `createApplication`, `startEntryAttempt`, `peekJoinCode`).
Replace each with a single local helper at the top of the file — inline, no new
file:

```ts
/** Open to join while an admin keeps it enrolling or active (plan 157). */
function isCohortOpen(status: string): boolean {
  return status === "ENROLLING" || status === "ACTIVE";
}
```

Leave the capacity/waitlist logic in `enrollOrWaitlist` alone — capacity is an
admin lever, and Step 12 raises it in data rather than in code.

### Step 11 — `src/components/talent-hunt/hero.tsx` (CROSS-MODULE)

Replace the two date chips (lines ~33-51) with rolling-cohort copy, keeping the
existing markup, `CalendarDays` icon and classes exactly as they are:

- chip 1: `Start any day` — icon `CalendarDays`
- chip 2: `31 days, paced from your start` — icon `CalendarDays`

No other change in this file. Nothing computed, nothing dated.

### Step 12 — `src/features/program/admin.ts` write path (Trap 2)

Make the admin panel's cohort edits actually reach members, and stop forcing a
required end date.

1. `createOrUpdateCohort`: change the `data` type's `startsAt` / `endsAt` to
   `Date | null`. Replace the `data.startsAt >= data.endsAt` guard with:
   `if (data.startsAt && data.endsAt && data.startsAt >= data.endsAt) return { ok: false, message: "Start date must be before end date." };`
2. Inside the same transaction, after each `tx.programCohort.create` /
   `.update`, mirror onto the canonical row by slug:

   ```ts
   await tx.cohort.update({
     where: { slug: cohortSlugForProgramCohort(cohortId) },
     data: {
       name: data.name,
       startsAt: data.startsAt,
       endsAt: data.endsAt,
       capacity: data.capacity,
       requiresJoinCode: data.requiresJoinCode,
       startMode: "ROLLING",
     },
   });
   ```

   Import `cohortSlugForProgramCohort` from `@/repositories/ids`. On the create
   branch the canonical row does not exist yet — a new `ProgramCohort` created
   from the admin panel has no `Cohort` twin, which is a pre-existing gap. Guard
   it: `findUnique` the slug first and skip the mirror when absent, and log via
   `logger.warn` that the cohort is not reachable by members until its canonical
   row exists. **Do not** create a `Cohort` here — it needs a
   `programVersionId`, and inventing one is out of scope for this plan.
3. `setCohortStatus` and `regenerateJoinCode`: mirror `status` / `joinCode` onto
   the canonical row the same way, same absent-row guard.
4. `getAdminProgramCohort` / `resolveAdminProgramCohort` read `ProgramCohort`;
   leave them, but confirm the admin page still renders with null dates
   (`formatDateTimeIST(cohort.endsAt)` at `admin.ts:539` — make it
   null-tolerant, returning `"—"`).

### Step 13 — validations + admin panel

`src/lib/validations/program.ts` `cohortFormSchema` (lines ~163-170):

```ts
startsAt: z.string().optional().default(""),
endsAt: z.string().optional().default(""),
```

and change the `.refine` to pass when either side is empty.

`src/app/actions/admin-program-actions.ts` `createOrUpdateCohortAction`:
`startsAt: parsed.data.startsAt ? fromZonedTime(parsed.data.startsAt, PROGRAM_TZ) : null`,
same for `endsAt`.

`src/components/program/program-cohort-panel.tsx`: keep the two datetime inputs,
drop any `required`, and label them
`Start date (optional — leave blank for a rolling cohort)` /
`End date (optional — blank means never freezes)`.

### Step 14 — `prisma/scripts/make-ai-cohort-rolling.ts` `[new]`

Idempotent, `--dry-run` by default, `--apply` to write. Print every row before
and after. For the two live AI-cohort slugs
(`legacy-program-cms969sax000jkv04sd9tmk42`,
`legacy-program-cmrp9r3wt000cjx04eeugfxyp`):

1. Canonical `Cohort`: `startMode = "ROLLING"`, `startsAt = null`,
   `endsAt = null`, `capacity = null` (unlimited — open enrollment),
   `status = "ENROLLING"`.
2. Rename `"AI Cohort India Aug 26"` → `"AI Cohort"` on both the canonical
   `Cohort` and its `ProgramCohort` twin. Leave `"AI Cohort USA"` named as-is.
3. Mirror `startsAt = null` / `endsAt = null` onto the `ProgramCohort` twins —
   **check `prisma/schema.prisma` first**: `ProgramCohort.startsAt` and
   `.endsAt` are currently **non-nullable** (`DateTime`, lines 709-710). Making
   them nullable is a schema migration. Rather than migrate a table that is only
   read by admin, set the `ProgramCohort` twins to a far-future `endsAt`
   (`2099-12-31`) and note in the script why. **Do not** add a migration for
   this table in this plan.
4. Raise `ProgramCohort.capacity` to `100000` on both (the capacity check in
   `entry.ts` reads `ProgramCohort`, not `Cohort`).
5. Assert afterwards: every `pe_pm_*` row has a non-null `startedAt`, and print
   `startedAt != joinedAt` counts (expected 0).

Add to `package.json`: `"db:rolling:ai-cohort": "tsx prisma/scripts/make-ai-cohort-rolling.ts"`.

### Step 15 — `src/features/program/rolling-cohort-invariants.test.ts` `[new]`

The "never again" guard. Follow the idiom in
`src/features/admin/programme-ops-coherence.test.ts` — `node:fs` source scan,
hand-rolled `assert` / `suite`, no test runner. Assert:

1. **No track freezes on a date.** For each of
   `src/features/{program,snowflake,databricks,databricks-ai,powerbi,ds-architect}/`
   and `src/features/challenge/`, no source file contains a comparison of `now`
   against a cohort end date — reject the patterns
   `new Date() > …endsAt`, `Date.now() > …endsAt`, `…endsAt < new Date()`,
   `isCohortPastEndsAt` (comments stripped first).
2. **No epoch date coercion.** `src/repositories/*.ts` contains no
   `endsAt: … ?? new Date(0)` or `startsAt: … ?? new Date(0)`.
3. **`isCohortFrozen` is status-only.** Its body in `progression.ts` mentions
   `status` and mentions neither `endsAt` nor `Date`.
4. **No cohort-name special-casing.** No source file references
   `PROGRAM_HOLD_OPEN_COHORT_NAME`, and `constants.ts` no longer exports it.
5. **Day math is learner-anchored.** `progression.ts` exports
   `getMemberCalendarDay` and does **not** export `getCohortCalendarDay`.
6. **No hardcoded programme dates in the funnel.** `src/components/talent-hunt/**`
   matches no `\b(Jan|Feb|…|Dec)[a-z]*\s+\d{1,2},?\s+20\d\d\b` and no
   `\b\d{1,2}\s+(Jan|…|Dec)\s+20\d\d\b`.

`package.json`: `"test:rolling-cohort": "tsx src/features/program/rolling-cohort-invariants.test.ts"`.

### Step 16 — docs

`docs/project-context.md` §4 / §18: record that the AI Cohort is ROLLING with a
per-enrollment `startedAt` anchor, that `isCohortFrozen` is status-only, that
`PROGRAM_HOLD_OPEN_COHORT_NAME` is retired, and that admin cohort writes now
mirror onto the canonical `Cohort`. Update the reconciled-through date.

`docs/CHANGELOG.md`: one dated line under `## Pending reconcile`.

## 6. Guardrails for Cursor (DO NOT)

- **DO NOT** touch `middleware.ts` or anything it imports. Nothing in this plan
  is in the edge path; if a build error points there, stop and report.
- **DO NOT** add `requireRole` / `requireAdmin` to any public surface. The
  `/ai-cohort-register`, `/ai-cohort-india`, `/program/ai-cohort` and
  `/program/ai-cohort/apply` pages are **public** and stay public.
- **DO NOT** create new abstraction files. `isCohortOpen` (Step 10) is a local
  function in `entry.ts`. The only new files are the two the plan lists.
- **DO NOT** add a Prisma migration. `ProgramCohort.startsAt` / `.endsAt` stay
  non-nullable; Step 14 works around that with a far-future date.
- **DO NOT** delete or rewrite `deriveDayState`'s sequential rule
  (`dayNumber > 1 && !passedDays.has(prev) → LOCKED`). Pacing changes; ordering
  does not.
- **DO NOT** remove the `capacity` / waitlist path in `enrollOrWaitlist`.
  Capacity is raised in data (Step 14), not deleted in code.
- **DO NOT** touch the other tracks' `progression.ts` files
  (snowflake / databricks / databricks-ai / powerbi / ds-architect) or the
  challenge track. They are already correct; the new test only reads them.
- **DO NOT** change `src/features/interview/**`. Its comments *mention*
  `getMaxContentDay` and `cohort.endsAt` but deliberately do not use them.
- **DO NOT** widen `src/components/talent-hunt/hero.tsx` beyond the two chips.
  It is Shallika's module; this is a factual-copy fix and nothing else.
- **DO NOT** run the data script without `--dry-run` first, and never against a
  database before the commit checkpoint in §7 exists.
- **DO NOT** use `console.error`; use `lib/logger.ts`.
- **DO NOT** introduce `any`. Every widened date becomes `Date | null`, and each
  consumer handles null explicitly.
- When a build error contradicts an assumption in this plan, trust the error and
  gather data — particularly around which fields `ProgramCohortStatus` actually
  has and which objects carry `startedAt` in scope.
- Confirm every file was written and `npm run build` passes before reporting done.

## 7. DB safety

Schema is **unchanged** — no Prisma migration. Step 14 mutates 4 rows across 2
tables (2 canonical `Cohort`, 2 `ProgramCohort`).

`.env` / `.env.local` in this checkout point at `ep-young-shadow-amawetjy`,
which is **production** (13,041 users). Treat every DB command here as
production.

Before running Step 14 with `--apply`:

1. `git add -A && git commit` the code changes — record the commit hash in the
   CHANGELOG line.
2. Take a Neon branch snapshot of `ep-young-shadow-amawetjy` and note its name.
3. `npm run db:rolling:ai-cohort` (dry run) — paste the before/after table into
   the PR.
4. `npm run db:rolling:ai-cohort -- --apply`.
5. Re-run the dry run; it must report zero pending changes (idempotent).

Investigation reads used the read-only session pattern
(`DIRECT_URL` + `options=-c default_transaction_read_only=on`).

## 8. Verification

**Build / typecheck**

```bash
npm run build
```

Must pass clean. The `Date | null` widening in Steps 2-3 will surface every
remaining consumer — that is the point; fix each explicitly, no `!` and no `any`.

**Tests**

```bash
npm run test:rolling-cohort
npm run test:program-state
npm run test:t276-programme-coherence
```

**Manual — the reported bug**

1. Sign in as a test account with no AI-cohort enrollment.
2. `/program/ai-cohort` → **Apply now** → `/program/ai-cohort/apply`. The heading
   must read `Apply to AI Cohort` — **no month, no year**.
3. Submit. Entry bypass auto-enrolls → `/program/ai-cohort/dashboard`.
4. Dashboard shows **Day 1 of 31**, `Day 1` AVAILABLE, `Day 2` LOCKED with
   `Unlocks <tomorrow's date>`.
5. Open Day 1, submit a mission. It must **grade** — not
   `"This cohort has ended"`. This is the regression that matters.
6. `/program/ai-cohort/videos` reads `day 1/31` and the new copy, with Day 2+
   locked.
7. As an existing India-cohort member (any of the 50, all at 0 points): Day 1
   AVAILABLE, submissions accepted. A member who joined 2026-09-09 sees days
   ~21-31 locked — expected under per-learner pacing; no passed work is lost
   because none exists.
8. `/ai-cohort-register` and `/ai-cohort-india` hero: `Start any day` /
   `31 days, paced from your start`. Grep the rendered HTML for `Aug` and
   `2026` — no programme dates.
9. `/admin/program`: save the cohort with **both dates blank**. Reload — it
   persists. Then confirm a member can still submit (this is the Trap-2 proof:
   the canonical row was mirrored).
10. `/admin/program` → set the cohort to `ARCHIVED`. A member submit must now be
    refused. Set it back to `ENROLLING`; submits work again. Freezing is an
    admin act, never a date.

**Exactly these files should have changed**

```
src/features/program/progression.ts
src/features/program/constants.ts
src/features/program/missions.ts
src/features/program/days.ts
src/features/program/dashboard.ts
src/features/program/mentor.ts
src/features/program/commits.ts
src/features/program/bootstrap-start-day.ts
src/features/program/recommendations.ts
src/features/program/admin.ts
src/features/program/entry.ts
src/features/program/rolling-cohort-invariants.test.ts   [new]
src/features/hire/dossier.ts
src/repositories/program-state.ts
src/repositories/learning.ts
src/app/actions/admin-program-actions.ts
src/app/actions/admin-program-export-actions.ts
src/app/program/ai-cohort/(app)/videos/page.tsx
src/components/program/program-dashboard-view.tsx
src/components/program/program-cohort-panel.tsx
src/components/talent-hunt/hero.tsx
src/lib/validations/program.ts
prisma/scripts/make-ai-cohort-rolling.ts                 [new]
package.json
docs/project-context.md
docs/CHANGELOG.md
```

Nothing under `middleware.ts`, `src/auth*`, `prisma/schema.prisma`,
`prisma/migrations/`, or the other tracks' `src/features/{snowflake,databricks,
databricks-ai,powerbi,ds-architect}/`.

## 9. Commit message

```
fix(program): AI cohort is rolling — no end-date freeze, no stale dates (plan 157)

The only FIXED track left on the platform. Its open cohort ended 2026-09-02,
so isCohortFrozen refused every mission submit and mentor review, while the
join-code cohort survived only on a literal cohort-name match. Day pacing came
from the shared Cohort.startsAt, so anyone joining late got no pacing at all.

Re-anchor all 31-day math on the learner's own ProgramEnrollment.startedAt, the
same way snowflake/databricks/powerbi/ds-architect already do. isCohortFrozen
now gates on cohort status alone — freezing is an admin act, never a date — and
PROGRAM_HOLD_OPEN_COHORT_NAME is retired.

Stop coercing a null cohort date to the Unix epoch in the repository mappers;
that read as "ended in 1970" and would have kept every rolling track frozen.

Mirror admin cohort writes onto the canonical Cohort table. They previously hit
ProgramCohort only, which members never read, so the end date could not be
fixed from /admin/program at all.

Drop the hardcoded "Launch: 15 Jul 2026" / "Completion: 30 Aug 2026" chips from
the cohort funnel hero, and rename "AI Cohort India Aug 26" to "AI Cohort".

Adds rolling-cohort-invariants.test.ts, which fails if any track reintroduces a
date-based submission freeze, an epoch date default, a cohort-name special case
or a hardcoded programme date.

No schema change. Data: prisma/scripts/make-ai-cohort-rolling.ts flips the two
live cohorts to ROLLING with null dates.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
