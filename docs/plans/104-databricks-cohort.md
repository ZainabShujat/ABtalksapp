# 104 — Databricks Cohort (078-native, open enrolment)

> Supersedes the scope of `103-databricks-module-page.md` (locked catalogue slice).
> 103's guardrails still hold: no Databricks rows in `ProgramModule` / `ProgramDay` /
> `ProgramMember` / `ProgramCohort`. This plan turns that catalogue into a working track.

---

## 1. Goal

Ship the **31-Day Databricks Data Engineering Cohort** as a self-serve track at
`/program/databricks` — enrolment form, rolling per-learner day unlock in IST,
day pages, server-verified missions with GitHub file verification, and a
modular dashboard — built **entirely on the 078 learning spine**
(`LearningProgram` → `ProgramVersion` → `Cohort` → `Module` → `Activity` →
`ProgramEnrollment` → `ActivityAttempt` → `ActivityEvaluation`). Open to
everyone with a completed platform registration: no join code, no capacity, no
admin cohort panel, no entry exam.

---

## 2. Current behavior

### What already exists (staged on `ab-dev`, from plan 103)

| Thing | State |
|---|---|
| `prisma/content/Databricks/*.json` | 9 modules · 31 days · 372 mission pts · 29 SHIP_IT + 2 DATA_ROOM · `isProjectDay` on 16/26/31 · videos/concept-questions/exercises/entry/rubrics also present |
| `prisma/seed-databricks.ts` | Seeds `ProgramCategory` + `LearningProgram(slug "databricks")` + `ProgramVersion` v1 + 9 `Module` + 31 `Activity`(`act_dbx_day_NN`) + `ContentActivityConfig` + a **DRAFT / FIXED** `Cohort(slug "databricks-dev")` |
| `npm run db:seed:databricks` | Wired in `package.json` |
| `src/app/program/databricks/{layout,page}.tsx` | Flag-gated (`ENABLE_DATABRICKS`), logo-only header, all-days-locked module accordion |
| `src/features/program/databricks-catalog.ts` | Thin wrapper over `listCurriculumForProgramSlug` |
| `src/features/program/constants.ts` | `PROGRAM_DATABRICKS_BASE`, `DATABRICKS_PROGRAM_SLUG`, `DATABRICKS_TOTAL_DAYS` |
| `src/repositories/learning.ts` | `listCurriculumForProgramSlug(slug)` — 078-native, **not** gated on `ENABLE_NEW_LEARNING` |
| `src/lib/feature-flags.ts` | `isDatabricksEnabled()` |

There is **no** enrolment, no day route, no mission verification, and no
progress for Databricks today. Every day renders LOCKED.

### What the AI Cohort does that Databricks must NOT copy

The AI Cohort (`/program/ai-cohort`) runs entirely on **legacy** tables —
`ProgramMember`, `ProgramCohort`, `ProgramModule`, `ProgramDay`,
`ProgramMissionSubmission` — with 078 dual-writes mirrored alongside. Its
`features/program/{missions,days,progression,dashboard,leaderboard}.ts` all read
`programMember` / `prisma.programDay` / `prisma.programMissionSubmission`.
**None of that is reusable for Databricks**, which has no legacy side and must
read and write 078 directly. `ProgramModule.number` is globally unique and
already occupies 1–8; Databricks has 9 modules and would collide.

### The one thing that IS directly reusable

`src/features/program/verify-mission.ts` is pure and framework-free. Its
`verifyMission(day, payload, { githubRepoUrl })` takes a structural
`Pick<ProgramDay, "missionType" | "missionSpec" | "dayNumber">`, which we can
build from an `Activity` + `ContentActivityConfig` row. It already implements
exactly the two mission types Databricks uses:

- `DATA_ROOM` — `missionSpec.answers[]`, fixed values, `caseInsensitive`, all must match.
- `SHIP_IT` — `missionSpec.repoChecks[]` against `https://api.github.com/repos/{owner}/{repo}/contents/{path}`, **plus** `missionSpec.answers[]` when present (Databricks days have both). Both halves must pass.

`parseBriefMd`, `DaySectionCard`, `DayBuildSteps`, `DayShell`, `CheckList` and
`programMdComponents` are presentational and reusable.

### Decisions taken from the user (do not re-derive)

1. **Rolling per learner.** Enrolment date (IST) is Day 1. Day N unlocks on
   anchor + (N−1) days, still gated on passing Day N−1. Falling behind pace is
   *marked and shown*, never blocking. Passing a day after its own unlock date
   marks that day LATE; if Day 31 is passed late, **overall completion is
   marked late**.
2. **Scope:** full day content (mission brief, objectives, tools, repo layout,
   build steps, submit-your-answers) — **no videos**, and **no Videos or
   Leaderboard tabs in the header**. Dashboard looks modular like the AI Cohort
   dashboard as it is now, plus a **permanently locked Mock Interview** card.
3. **Enrolment requires a completed `/register` profile first**, then a
   Databricks form with the same field set as the AI Cohort apply form.
4. **`/program/databricks` is the single route** — it lands on the dashboard.
   The **Prep Kit** section on `/dashboard` gains a second card for Databricks.

### Consequences of scope (2) — stated, not assumed

Out of v1 and **left seeded-but-unread** for a later plan: `videos.json`,
`concept-questions.json`, `exercises.json`, `entry-questions.json`,
`rubrics.json` (module projects / AI grading), AI mentor, commit-polling cron,
leaderboard, certificates. The seed does not load them; `days.json` and
`modules.json` are the only files consumed.

Points therefore total **372** (31 × 12 mission points). There is no concept /
commit / project bucket.

---

## 3. Files to touch

### Content & seed

| Path | | Note |
|---|---|---|
| `prisma/seed-databricks.ts` | `[edit]` | Cohort becomes ROLLING/ENROLLING/open; `DATA_ROOM → ASSIGNMENT`; populate `ProgramVersion.totalPoints` / `requiredActivityCount` |

### Repository layer (the 078 read/write boundary)

| Path | | Note |
|---|---|---|
| `src/repositories/learning.ts` | `[edit]` | Add 078-native `getDayShellForProgramSlug(slug, dayNumber)` + `getActivityVerificationForDay(slug, dayNumber)` (server-only spec) |
| `src/repositories/databricks.ts` | `[new]` | Cohort / enrolment / attempt / progress reads + writes for the Databricks cohort |
| `src/repositories/candidate.ts` | `[edit]` | Export `updateCandidateLinks(userId, {linkedinUrl, githubUsername, skills})` |

### Feature module

| Path | | Note |
|---|---|---|
| `src/features/databricks/constants.ts` | `[new]` | Base path, slugs, TZ, totals, rate limits |
| `src/features/databricks/progression.ts` | `[new]` | Pure IST day math: anchor, unlock key, day state, behind-by, lateness |
| `src/features/databricks/enroll.ts` | `[new]` | Entry state + `createDatabricksEnrollment` |
| `src/features/databricks/days.ts` | `[new]` | Day shell + per-learner state |
| `src/features/databricks/missions.ts` | `[new]` | Mission state, rate limit, verify, attempt write, progress recompute |
| `src/features/databricks/dashboard.ts` | `[new]` | Dashboard view model |
| `src/features/program/databricks-catalog.ts` | `[delete]` | Superseded by `features/databricks/*` |
| `src/features/program/constants.ts` | `[edit]` | Remove the 3 Databricks constants (moved) |

### Validation & actions

| Path | | Note |
|---|---|---|
| `src/lib/validations/databricks.ts` | `[new]` | `databricksEnrollSchema`, `databricksMissionDaySchema`, `databricksSubmitMissionSchema` |
| `src/app/actions/databricks-actions.ts` | `[new]` | `enrollInDatabricksAction`, `submitDatabricksMissionAction` |

### Routes

| Path | | Note |
|---|---|---|
| `src/app/program/databricks/layout.tsx` | `[unchanged]` | Already flag-gated, logo-only, **no nav tabs** — which is what scope (2) requires |
| `src/app/program/databricks/page.tsx` | `[edit]` | Server Component: gate → enrol screen **or** dashboard |
| `src/app/program/databricks/day/[day]/page.tsx` | `[new]` | Server Component day page |
| `middleware.ts` | `[edit]` | Add `"/program/databricks"` to `protectedPaths` (string only — edge-safe) |

### Components

| Path | | Note |
|---|---|---|
| `src/components/program/program-module-list.tsx` | `[edit]` | Add optional `basePath` prop (defaults to `PROGRAM_AI_COHORT_BASE`) |
| `src/components/program/day-shell.tsx` | `[edit]` | Thread optional `basePath` |
| `src/components/program/day-sidebar.tsx` | `[edit]` | Thread optional `basePath` |
| `src/components/program/program-day-client.tsx` | `[edit]` | Thread optional `basePath` |
| `src/components/databricks/databricks-enroll-form.tsx` | `[new]` | Client — RHF + zodResolver |
| `src/components/databricks/databricks-dashboard-view.tsx` | `[new]` | Client — continue card, modules, VIEW STATS, locked Mock Interview |
| `src/components/databricks/databricks-stats-panel.tsx` | `[new]` | Client — mission points, cleared, behind-by, late days |
| `src/components/databricks/databricks-mission-panel.tsx` | `[new]` | Client — answers + Verify + verdict list |
| `src/components/dashboard-hub/roadmaps.tsx` | `[edit]` | Second Prep Kit card → `/program/databricks` |

### Env / docs

| Path | | Note |
|---|---|---|
| `.env.example` | `[edit]` | `ENABLE_DATABRICKS` reworded as the launch switch, not local-only |
| `src/lib/feature-flags.ts` | `[edit]` | Update the `isDatabricksEnabled` doc comment |
| `docs/CHANGELOG.md` | `[edit]` | One dated line under `## Pending reconcile` |

---

## 4. Server vs Client

**Server Components / server-only modules**

- `src/app/program/databricks/page.tsx`, `.../day/[day]/page.tsx`, `layout.tsx`
- every file under `src/features/databricks/` — all start with `import "server-only"`
- `src/repositories/databricks.ts`, the `learning.ts` additions
- `src/app/actions/databricks-actions.ts` (`"use server"`)

**Client Components** (`"use client"`)

- `databricks-enroll-form.tsx`, `databricks-dashboard-view.tsx`,
  `databricks-stats-panel.tsx`, `databricks-mission-panel.tsx`
- reused: `program-module-list.tsx`, `day-shell.tsx`, `day-sidebar.tsx`,
  `program-day-client.tsx`, `CheckList`

**Server → Client prop boundary — only plain JSON crosses.**

- Dates are serialised to ISO strings or pre-formatted labels **on the server**.
  No `Date` object, function, icon component or class instance is passed.
- `missionSpec` / `Activity.verificationSpec` is **server-only and must never be
  a prop**. Only these derived, client-safe values leave the server:
  `shipItHints: { check, path }[]` (paths only, via `getShipItHints`) and
  `dataRoomQuestionCount: number`. The submit questions themselves come from
  `parseBriefMd(briefMd).submitQuestions`, which is public brief text.
- `ProgramModuleList` / `DayShell` / `DaySidebar` receive `basePath` as a
  **string literal prop** from the server page, not an imported constant inside
  the client bundle.

---

## 5. Steps

### Step 1 — `src/features/databricks/constants.ts` `[new]`

```ts
export const DATABRICKS_BASE = "/program/databricks";
export const DATABRICKS_PROGRAM_SLUG = "databricks";
export const DATABRICKS_COHORT_SLUG = "databricks-open";
export const DATABRICKS_TOTAL_DAYS = 31;
/** Day boundaries for this track. Read this, never hard-code the zone. */
export const DATABRICKS_TZ = "Asia/Kolkata";
export const DATABRICKS_MISSION_POINTS_PER_DAY = 12;
export const DATABRICKS_MAX_MISSION_POINTS = 372;
export const DATABRICKS_MAX_RUNS_PER_DAY = 30;
export const DATABRICKS_MIN_RUN_INTERVAL_MS = 15_000;
```

No `"use client"`, no `"server-only"` — it is imported by both sides.

### Step 2 — `src/features/program/constants.ts` `[edit]`

Delete `PROGRAM_DATABRICKS_BASE`, `DATABRICKS_PROGRAM_SLUG`,
`DATABRICKS_TOTAL_DAYS`. Nothing else in that file changes. Fix the two
importers (`src/app/program/databricks/page.tsx`,
`src/features/program/databricks-catalog.ts` — the latter is deleted in Step 12).

### Step 3 — `prisma/seed-databricks.ts` `[edit]`

1. `const COHORT_SLUG = "databricks-open";`
2. Cohort upsert `create`/`update` becomes:
   ```ts
   {
     programVersionId: version.id,
     name: "Databricks Data Engineering",
     startMode: CohortStartMode.ROLLING,
     startsAt: null,        // pure rolling: every enrolment is its own anchor
     endsAt: null,
     timezone: "Asia/Kolkata",
     status: CohortStatus.ENROLLING,
     capacity: null,
     requiresJoinCode: false,
     joinCode: null,
   }
   ```
3. `missionActivityType`: change the `DATA_ROOM` arm from `ActivityType.CODING`
   to `ActivityType.ASSIGNMENT` (there is no `CodingActivityConfig` and no code
   runner). Leave `SHIP_IT → EXTERNAL_SUBMISSION` and `isProjectDay → PROJECT`
   exactly as they are — the verify path branches on `contentConfig.missionType`,
   never on `ActivityType`, and keeping `PROJECT` on days 16/26/31 preserves the
   flag for a future projects slice.
4. After the day loop, write the version totals:
   ```ts
   await prisma.programVersion.update({
     where: { id: version.id },
     data: {
       totalPoints: days.reduce((sum, d) => sum + (d.missionPoints ?? 12), 0), // 372
       requiredActivityCount: days.length,                                     // 31
     },
   });
   ```
5. Leave `assertNotProduction()` and the `SEED_ALLOW_PRODUCTION` escape hatch
   exactly as they are.

The stale local `Cohort(slug "databricks-dev")` row is DRAFT with zero
enrolments. Leave it in place — do not add delete logic to a seed.

### Step 4 — `src/repositories/learning.ts` `[edit]`

Add two 078-native functions next to `listCurriculumForProgramSlug`, following
its documented precedent (**not** gated on `ENABLE_NEW_LEARNING` — these
programs have no legacy table):

```ts
export type ProgramSlugDayShell = {
  activityId: string;
  dayNumber: number;
  title: string;
  missionType: ProgramMissionType;
  briefMd: string;
  objectives: string[];
  tools: string[];
  estimatedMin: number;
  missionPoints: number;
  isProjectDay: boolean;
  module: { number: number; title: string; color: string };
};

/** Client-safe day content. Deliberately EXCLUDES verificationSpec. */
export async function getDayShellForProgramSlug(
  slug: string,
  dayNumber: number,
): Promise<ProgramSlugDayShell | null>
```

Query: `prisma.activity.findFirst({ where: { dayNumber, module: { programVersion: { program: { slug } } } }, select: {...} })`.
Map `contentConfig.bodyMarkdown → briefMd`, `contentConfig.objectives → objectives`,
`tags → tools`, `estimatedMinutes → estimatedMin`, `points → missionPoints`,
`module.position/title/colorToken → module`. Return `null` when
`contentConfig.missionType` is absent. **`verificationSpec` must not appear in
this select.**

```ts
export type ActivityVerification = {
  activityId: string;
  dayNumber: number;
  missionType: ProgramMissionType;
  missionSpec: Prisma.JsonValue | null;
  missionPoints: number;
  moduleNumber: number;
};

/** SERVER-ONLY. The verification spec. Never reaches a client component. */
export async function getActivityVerificationForDay(
  slug: string,
  dayNumber: number,
): Promise<ActivityVerification | null>
```

Do **not** touch any existing function in this file.

### Step 5 — `src/repositories/databricks.ts` `[new]`

`import "server-only"`. This is the only place Databricks touches
`Cohort` / `ProgramEnrollment` / `ActivityAttempt` / `ActivityEvaluation` /
`EnrollmentProgress` / `EnrollmentDayActivity`.

```ts
getDatabricksCohort(): Promise<{ id: string; status: CohortStatus; timezone: string } | null>
findDatabricksEnrollment(userId): Promise<DatabricksEnrollment | null>
createDatabricksEnrollmentRow(tx, { userId, cohortId, githubRepoUrl }): Promise<{ id: string }>
listDatabricksProgress(enrollmentId): Promise<{ dayNumber, passed, lateness }[]>
listDatabricksAttemptsForDay(enrollmentId, dayNumber): Promise<DatabricksAttemptRow[]>
countDatabricksAttemptsForDay(enrollmentId, dayNumber): Promise<number>
recordDatabricksAttempt(tx, {...}): Promise<{ id: string; createdAt: Date }>
recomputeDatabricksProgress(tx, enrollmentId): Promise<void>
```

Rules that make this safe alongside the in-flight 078 migration:

- **Ids are plain cuids.** Databricks rows are *native* 078 rows, not migration
  mirrors. They must NOT carry the `pe_pm_` / `pe_enr_` / `aa_ms_` / `aa_sub_`
  prefixes. Those prefixes are how `repositories/progress.ts` and
  `repositories/learning.ts` recognise mirrored legacy rows; a Databricks row
  wearing one would be read as an AI Cohort or challenge row.
- Activity ids are `act_dbx_day_NN` — already outside `act_pd_` / `act_dt_` /
  `act_quiz_` / `act_vid_`, so no existing repository query can pick them up.
  Scope every Databricks query by the cohort/program slug anyway.
- Writes go through `writeClient()` (the direct, non-pooler client) inside
  `$transaction`, per §3 of `docs/project-context.md`.
- **No `dualWrite*` call anywhere.** There is no legacy Databricks side.
- **No `PointsAccount` / `PointsTransaction` / `SynergyEvent` write.** Databricks
  mission points live in `EnrollmentProgress.pointsEarned` only.

`recordDatabricksAttempt` writes, in one transaction:

1. `ActivityAttempt` — `enrollmentId`, `activityId`, `attemptNumber`,
   `status: EVALUATED`, `lateness`, `payload`, `passed`, `pointsAwarded`,
   `submittedAt: now`.
2. `ActivityEvaluation` — `attemptId`, `evaluatorType: AUTO`, `passed`,
   `detailJson: verdict`, `isAuthoritative: true`.
   Only one authoritative row per attempt (there is a partial unique index).
3. On a **first** pass for that activity, `EnrollmentDayActivity.upsert` on
   `(enrollmentId, activityDate = today's IST date, source: SUBMISSION)`,
   incrementing `activityCount` and `pointsEarned`.

`recomputeDatabricksProgress` upserts `EnrollmentProgress` from the attempts —
it is a cache, never an input to an unlock decision:

| Field | Value |
|---|---|
| `cohortId` | the Databricks cohort id (denormalised) |
| `completedActivities` | distinct activities with an authoritative passed evaluation |
| `totalActivities` | 31 |
| `percentCompleteBp` | `round(completed / 31 * 10000)` |
| `pointsEarned` | `SUM(pointsAwarded)` |
| `pointsPossible` | 372 |
| `unlockedThroughPosition` | highest passed `dayNumber` |
| `currentActivityId` / `nextActivityId` | first AVAILABLE / first LOCKED activity id |
| `currentStreak` / `longestStreak` | consecutive IST dates in `EnrollmentDayActivity` ending today or yesterday |
| `lastActivityAt`, `recomputedAt` | now |

### Step 6 — `src/features/databricks/progression.ts` `[new]`

Pure functions over `DATABRICKS_TZ`, using `formatInTimeZone` from `date-fns-tz`
and `addCalendarDaysToKey` / `parseCalendarKeyToUtcDate` from `@/lib/date-utils`
(the same helpers the program track uses — this is what stops a timezone
reformat from dropping day 0).

```ts
export type DatabricksDayState = "LOCKED" | "AVAILABLE" | "PASSED";

/** IST calendar key of the learner's Day 1. */
anchorKey(startedAt: Date): string

/** IST key on which `dayNumber` unlocks: anchor + (dayNumber - 1). */
unlockKeyForDay(startedAt: Date, dayNumber: number): string

/** Uncapped elapsed day (1-based). Day 32+ is real and means "past the plan". */
elapsedDay(startedAt: Date): number

/** Display/unlock ceiling: min(31, elapsedDay). */
maxUnlockedDay(startedAt: Date): number

/** Calendar cap + sequential gate. No skip tokens on this track. */
deriveDayState(
  dayNumber: number,
  maxUnlockedDay: number,
  passedDays: Set<number>,
  bypassLocks: boolean,
): DatabricksDayState

/** ON_TIME when the pass lands on or before that day's own unlock key. */
latenessForPass(startedAt: Date, dayNumber: number, at: Date): AttemptLateness

/** max(0, min(31, elapsedDay) - highestPassedDay). Marked, never blocking. */
behindByDays(startedAt: Date, highestPassedDay: number): number
```

`deriveDayState` mirrors `features/program/progression.ts` exactly minus
`SKIPPED`: `PASSED` wins; `bypassLocks` (from `isDayLockBypassEnabled()`,
dev-only) returns `AVAILABLE`; `dayNumber > maxUnlockedDay` is `LOCKED`;
`dayNumber > 1 && !passedDays.has(dayNumber - 1)` is `LOCKED`; else `AVAILABLE`.

Overall completion lateness is **derived, not stored**: the enrolment completed
late iff the passing Day-31 attempt's `lateness === LATE`.

### Step 7 — `src/lib/validations/databricks.ts` `[new]`

```ts
const githubUsernameRegex = /^[a-zA-Z0-9-]{1,39}$/;
const githubRepoRegex = /^https:\/\/github\.com\/([a-zA-Z0-9-]{1,39})\/([a-zA-Z0-9._-]{1,100})\/?$/;

export const databricksEnrollSchema = z.object({
  linkedinUrl: /* trimmed url, must contain linkedin.com */,
  skills: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  githubUsername: z.string().trim().regex(githubUsernameRegex, ...),
  githubRepoUrl: z.string().trim().regex(githubRepoRegex, ...),
  hasLaptopAndAccount: z.literal(true, { error: "Confirm you're set up for this cohort" }),
}).refine(/* repo owner must equal githubUsername, case-insensitive */, {
  path: ["githubRepoUrl"],
  message: "The repo owner must match your GitHub username",
});

export const databricksMissionDaySchema = z.object({
  dayNumber: z.number().int().min(1).max(DATABRICKS_TOTAL_DAYS),
});

export const databricksSubmitMissionSchema = z.object({
  dayNumber: z.number().int().min(1).max(DATABRICKS_TOTAL_DAYS),
  payload: z.union([
    z.object({ answers: z.array(z.union([z.string().max(500), z.number()])).max(20) }),
    z.object({}),
  ]),
});
```

Deliberately its own file: the two products stay decoupled, and
`src/lib/validations/program.ts` bounds day numbers by `PROGRAM_TOTAL_DAYS`.

**No recruiter-visibility checkbox.** Under 078 §5 recruiter discoverability is
a platform default, not a user toggle — and the AI Cohort's own field is already
documented as accepted-and-ignored. A checkbox that changes nothing is worse
than no checkbox. v1 writes no `CandidateVisibility` row.

### Step 8 — `src/repositories/candidate.ts` `[edit]`

Add one exported function, reusing the existing private
`ensureCandidateProfile(tx, userId)` helper:

```ts
export async function updateCandidateLinks(
  userId: string,
  data: { linkedinUrl: string; githubUsername: string; skills: string[] },
): Promise<void>
```

Inside one `writeClient().$transaction`:
- `ensureCandidateProfile` then update `CandidateProfile.linkedinUrl` +
  `.githubUsername` (078 canonical identity)
- update the same three fields on `StudentProfile` through the existing
  `studentProfile` legacy adapter — that is still where the platform reads
  skills from while `ENABLE_NEW_CANDIDATE` is off.

Skills are **not** written to `CandidateSkill` in v1: that needs the Skill
taxonomy resolution and is out of scope.

### Step 9 — `src/features/databricks/enroll.ts` `[new]`

```ts
export type DatabricksEntryState =
  | { screen: "needs_profile" }
  | { screen: "closed" }
  | { screen: "form" }
  | { screen: "enrolled"; enrollmentId: string };

export async function getDatabricksEntryState(userId: string): Promise<DatabricksEntryState>
export async function createDatabricksEnrollment(
  userId: string,
  input: DatabricksEnrollInput,
): Promise<{ ok: true; enrollmentId: string } | { ok: false; message: string }>
```

`getDatabricksEntryState`:
1. `findDatabricksEnrollment(userId)` → `enrolled` when status is `ACTIVE` or `COMPLETED`.
2. `getProfileSummary(userId)` (candidate repository) → `needs_profile` when null.
3. `getDatabricksCohort()` → `closed` when missing or status is not
   `ENROLLING` / `ACTIVE`.
4. else `form`.

`createDatabricksEnrollment` re-checks profile + cohort server-side (never trust
the rendered screen), then in one `writeClient().$transaction`:
- `updateCandidateLinks(...)`
- `ProgramEnrollment.upsert` on `(userId, cohortId)` →
  `status: ACTIVE`, `startedAt: now` (**this timestamp is the rolling anchor**),
  `enrolledAt: now`, `githubRepoUrl: input.githubRepoUrl`
- `EnrollmentProgress.create` with `totalActivities: 31`,
  `pointsPossible: 372`, everything else zero

`upsert` (not `create`) so a re-submit is idempotent rather than a P2002. An
existing ACTIVE enrolment is rejected before the transaction, so `startedAt` can
never be reset by a second submit.

### Step 10 — `src/features/databricks/days.ts` and `missions.ts` `[new]`

`days.ts`:
```ts
export async function getDatabricksDayShell(
  enrollment: DatabricksEnrollment,
  dayNumber: number,
): Promise<{ day: ProgramSlugDayShell; state: DatabricksDayState } | null>
```
Composes `getDayShellForProgramSlug(DATABRICKS_PROGRAM_SLUG, dayNumber)` with
`listDatabricksProgress` → `passedDays` → `deriveDayState`.

`missions.ts`:
```ts
export type DatabricksMissionState = {
  dayState: DatabricksDayState;
  passed: boolean;
  failedRunCount: number;
  runs: { attemptNumber: number; passed: boolean; verdict: VerdictLine[]; createdAt: string }[];
  shipItHints?: { check: string; path: string }[];
  dataRoomQuestionCount?: number;
};

export async function getDatabricksMissionState(enrollment, dayNumber): Promise<DatabricksMissionState | null>
export async function submitDatabricksMissionRun(enrollment, dayNumber, payload): Promise<SubmitOk | { ok: false; message: string }>
```

`submitDatabricksMissionRun`, in order:

1. **Availability.** Recompute `deriveDayState` server-side. Reject `LOCKED`
   ("This day is locked.") and `PASSED` ("You already passed this mission.").
2. **Rate limit.** `countDatabricksAttemptsForDay >= 30` → "Daily run limit
   reached for this mission."; newest attempt younger than 15 s → "Please wait
   15 seconds between runs."
3. **Load the spec.** `getActivityVerificationForDay(DATABRICKS_PROGRAM_SLUG, dayNumber)`.
4. **Verify.** Reuse the program verifier unchanged:
   ```ts
   const verdict = await verifyMission(
     { missionType: v.missionType, missionSpec: v.missionSpec, dayNumber: v.dayNumber },
     payload,
     { githubRepoUrl: enrollment.githubRepoUrl ?? "" },
   );
   ```
   `verifyMission`'s parameter is a structural `Pick<>`; an object literal with
   those three fields satisfies it without touching `verify-mission.ts`.
5. **Write** via `recordDatabricksAttempt` + `recomputeDatabricksProgress` in one
   `writeClient().$transaction`. Points are awarded **only on the first pass** for
   that activity (`pointsAwarded = missionPoints`, else 0);
   `lateness = latenessForPass(enrollment.startedAt, dayNumber, now)`.
6. **Completion.** When `dayNumber === 31` and the run passes, set
   `ProgramEnrollment.status = COMPLETED`, `completedAt = now` in the same
   transaction.
7. Return `{ passed, verdict, pointsAwarded, attemptNumber, unlockedDay?, lateness }`
   where `unlockedDay` is `dayNumber + 1` only when its recomputed state is
   `AVAILABLE`.

**Known limitation, stated deliberately:** `verify-mission.ts` has
`SHIP_IT_CONTENT_CHECKS = false`, so `repoChecks` of kind `contentMatches` /
`minLines` / `notebookParses` pass on *file existence* alone. Databricks
inherits that behaviour. **Do not flip that constant** — it would tighten
verification under the live AI Cohort mid-run. Enabling per-track content checks
is a separate plan.

### Step 11 — `src/features/databricks/dashboard.ts` `[new]`

```ts
export type DatabricksDashboard = {
  modules: CurriculumModule[];
  days: { dayNumber; title; missionType; moduleNumber; state; late: boolean }[];
  currentDay: { dayNumber; title; missionType } | null;
  nextLockedDay: number | null;
  nextUnlockDateLabel: string | null;   // "d MMM", pre-formatted on the server
  clearedCount: number;
  totalDays: 31;
  missionPoints: number;
  maxMissionPoints: 372;
  memberDay: number;      // highest passed day
  elapsedDay: number;     // uncapped
  behindBy: number;
  lateDayCount: number;
  isComplete: boolean;
  completedLate: boolean;
  recentVerdicts: { dayNumber; passed; checks: VerdictLine[]; createdAt: string }[];
};
```

Reads `listCurriculumForProgramSlug(DATABRICKS_PROGRAM_SLUG)` +
`listDatabricksProgress` + `EnrollmentProgress`. Every `Date` is converted to a
string here — nothing downstream re-derives one.

### Step 12 — delete `src/features/program/databricks-catalog.ts`

Its only caller is `src/app/program/databricks/page.tsx`, rewritten in Step 13.

### Step 13 — `src/app/program/databricks/page.tsx` `[edit]`

Server Component. `layout.tsx` already handles the `ENABLE_DATABRICKS` gate and
renders the logo-only header with **no nav tabs** — leave it alone.

```
session? no  → redirect(`/login?from=/program/databricks`)
getDatabricksEntryState(userId):
  needs_profile → redirect("/register")
  closed        → closed card
  form          → header + <DatabricksEnrollForm />
  enrolled      → getDatabricksDashboard(...) → <DatabricksDashboardView />
```

One route, state-dependent, as decided. Keep the existing breadcrumb
(`Dashboard > Databricks`) and page header copy.

On the `form` screen, also render `<ProgramModuleList modules={...} days={...}
lockAllDays basePath="/program/databricks" />` beneath the form so a
prospective learner can see the 9-module curriculum before enrolling — that is
what the route renders today and it should not regress.

### Step 14 — `src/app/program/databricks/day/[day]/page.tsx` `[new]`

Server Component, structurally the AI Cohort day page minus videos:

1. Session → enrolment; not enrolled → `redirect("/program/databricks")`.
2. Parse `day`; out of `1..31` → `redirect("/program/databricks")`.
3. `getDatabricksDayShell`; `null` or `LOCKED` → `redirect("/program/databricks")`.
4. `getDatabricksMissionState`.
5. `parseBriefMd(day.briefMd)`.
6. Render inside `<ProgramDayClient basePath="/program/databricks" …>`:
   - `DaySectionCard "Mission"` → `brief.missionTitle` + `brief.missionBodyMd`
   - `DaySectionCard "Objectives"` → `day.objectives` + `day.tools` chips
   - `DaySectionCard "Your Repo Layout (set this up first!)"` → `brief.repoLayoutMd`
   - `<DayBuildSteps steps={brief.buildSteps} />`
   - `<DatabricksMissionPanel … dataRoomQuestions={brief.submitQuestions} verifyIntro={brief.submitIntroMd} />`

**Omit the "Reference Resources" video block entirely** — no videos, per scope (2).

### Step 15 — components

`program-module-list.tsx`, `day-shell.tsx`, `day-sidebar.tsx`,
`program-day-client.tsx` `[edit]` — add
`basePath?: string` defaulting to `PROGRAM_AI_COHORT_BASE`, and replace the
hard-coded `${PROGRAM_AI_COHORT_BASE}/day/${n}` hrefs with `${basePath}/day/${n}`.
Behaviour for the AI Cohort is unchanged because the default is the old value.
Do not change any styling in these four files.

`databricks-enroll-form.tsx` `[new]` — client, RHF + `zodResolver(databricksEnrollSchema)`,
laid out like `apply-form.tsx`: LinkedIn URL, skills chips (Enter/comma to add,
max 8), GitHub username, **Program repo URL** with the amber "this repository
will be used throughout the cohort for verification" callout, and the setup
confirmation checkbox. Calls `enrollInDatabricksAction`, toasts, `router.refresh()`.

`databricks-dashboard-view.tsx` `[new]` — client, same shell as
`program-dashboard-view.tsx`:
breadcrumb → `Dashboard > Databricks`; header "Databricks" + subtitle;
Continue card (GET STARTED / CONTINUE WHERE YOU LEFT OFF / UP NEXT with the
`nextUnlockDateLabel` line / ALL CAUGHT UP), plus a **"You're N days behind"**
line when `behindBy > 0` and, when `isComplete`, "Completed" or "Completed late";
`<ProgramModuleList basePath="/program/databricks" />`; a **VIEW STATS**
disclosure wrapping `DatabricksStatsPanel`; and a **Mock Interview** disclosure
rendered **permanently Locked** — grey `Mic`, "Locked" chip, body copy only, no
`CohortInterviewCard`, no link, no action.

`databricks-stats-panel.tsx` `[new]` — client: stat cards for mission points
(`x/372`), days cleared (`x/31`), current streak, days behind, late days; one
score bar for mission points; and the recent-verdict list. Do **not** reuse
`ProgramStatsPanel` — it is typed to `MemberDashboard` and renders commit /
project / AI-recommendation sections that do not exist here.

`databricks-mission-panel.tsx` `[new]` — client, modelled on `mission-panel.tsx`:
- `dataRoomQuestions.length > 0` → one `<Input>` per question; numeric-looking
  answers coerced to `Number` before submit (same rule as the AI Cohort).
- `shipItHints` → render `check` + `path` as the "files we'll look for" list.
- Verify button → `submitDatabricksMissionAction`; render the returned verdict
  through `CheckList`; confetti + points banner on pass; "Continue to Day N+1"
  link when `unlockedDay` is returned.
- No CODE_SPRINT / PROMPT_FORGE / BOSS_BUILD branches — this curriculum has
  only `SHIP_IT` and `DATA_ROOM`.
- No AI-mentor button (out of scope).

### Step 16 — `src/app/actions/databricks-actions.ts` `[new]`

`"use server"`. Both actions: `auth()` → resolve enrolment → Zod parse → feature
call → `revalidatePath`. Return the standard envelope
`{ ok: true, data } | { ok: false, message }`.

```ts
export async function enrollInDatabricksAction(input: unknown)
export async function submitDatabricksMissionAction(input: unknown)
```

`submitDatabricksMissionAction` revalidates `/program/databricks` and
`/program/databricks/day/${dayNumber}` only. **Never** `requireProgramMember()`
— that resolves an AI Cohort membership and would redirect a Databricks learner
to `/program/ai-cohort`.

### Step 17 — `middleware.ts` `[edit]`

Add `"/program/databricks"` to `protectedPaths`, after the
`/program/ai-cohort/*` entries. **String literal only** — no import, no helper,
nothing from `@/lib/*`. The prefix covers `/program/databricks/day/N`.

### Step 18 — `src/components/dashboard-hub/roadmaps.tsx` `[edit]`

Turn the single Prep Kit card into a two-card grid
(`grid gap-3 sm:grid-cols-2`), reusing the existing card markup and
`HUB_CARD_HOVER_CLASS` / `HUB_BUTTON_CLASS`:

| Card | Copy | Href |
|---|---|---|
| 31 Days AI Cohort | unchanged | unchanged (`hasProgramMembership ? …/dashboard : …/apply`) |
| 31 Days Databricks | "Build a healthcare-claims Lakehouse on Databricks Free Edition in 31 days." | `/program/databricks` — always, one URL |

New prop `showDatabricks: boolean`. In
`src/features/dashboard/get-hub-data.ts` add `hasDatabricksAccess:
isDatabricksEnabled()` to `HubData` and pass it through
`src/app/dashboard/page.tsx`. The CTA label is always "Open" — the page itself
decides between enrol and dashboard, so the hub never has to query the
enrolment. Do **not** add a Databricks redirect to
`src/app/dashboard/page.tsx:46-50`; that block exists for profile-less users and
Databricks requires a profile.

### Step 19 — env, flag doc, changelog

`.env.example` — replace the 103 comment with:
```
# Databricks cohort at /program/databricks. Unset/false 404s the route and
# hides the Prep Kit card. Set to true in Vercel to launch.
# ENABLE_DATABRICKS=true
```
`src/lib/feature-flags.ts` — update the `isDatabricksEnabled` doc comment to
match (drop "local-only" / "Do not set in Vercel").

`docs/CHANGELOG.md` — append ONE line under `## Pending reconcile`:
```
- 2026-08-31 [schema|rule|convention] Databricks cohort (plan 104) ships 078-native at /program/databricks: LearningProgram "databricks" + ROLLING open Cohort "databricks-open", ProgramEnrollment/ActivityAttempt/ActivityEvaluation/EnrollmentProgress/EnrollmentDayActivity with PLAIN CUID ids (never pe_*/aa_* migration prefixes), no dual-write and no legacy ProgramMember/ProgramDay row. Day 1 = enrolment date in IST, day N unlocks anchor+(N-1) and still needs day N-1 passed; late passes are marked per day and a late day 31 marks overall completion late. Missions reuse features/program/verify-mission.ts unchanged (SHIP_IT existence-only checks + DATA_ROOM answers), 12 pts/day, 372 max, 30 runs/day, 15s spacing. No join code, capacity, admin panel, entry exam, videos, leaderboard, concepts, exercises, projects or certificates. Gated by ENABLE_DATABRICKS, now the launch switch rather than local-only.
```

---

## 6. Guardrails for Cursor (DO NOT)

**078 migration safety — the highest-risk area in this plan**

- DO NOT give any Databricks `ProgramEnrollment` / `ActivityAttempt` an id with
  the `pe_pm_`, `pe_enr_`, `aa_ms_`, `aa_sub_` or `aa_qa_` prefix. Those prefixes
  identify migration mirrors of legacy rows; `repositories/progress.ts` and
  `repositories/learning.ts` filter on them. Plain cuids only.
- DO NOT call anything from `src/repositories/dual-write.ts`. Databricks has no
  legacy side to mirror.
- DO NOT flip `ENABLE_DUAL_WRITE` or any `ENABLE_NEW_*` flag, and DO NOT add a
  flag branch to any Databricks code path.
- DO NOT write `ProgramMember`, `ProgramCohort`, `ProgramModule`, `ProgramDay`,
  `ProgramMissionSubmission`, `ProgramProject`, `ProgramCommitDay`,
  `ProgramVideo`, `ProgramConceptQuestion`, `Enrollment` or `Submission` rows
  for Databricks. `ProgramModule.number` is globally unique and 1–8 are taken.
- DO NOT write `PointsAccount`, `PointsTransaction`, `SynergyEvent` or
  `User.synergyPoints` from Databricks. Mission points live only in
  `EnrollmentProgress`.
- DO NOT change any existing function in `repositories/learning.ts`,
  `repositories/progress.ts` or `repositories/candidate.ts` — only add.
- DO NOT add a Prisma migration. Every table this plan needs already exists in
  production.

**Product scope**

- DO NOT add Videos or Leaderboard — not as routes, not as header tabs, not as
  dashboard sections. The day page renders **no** video block.
- DO NOT seed or read `videos.json`, `concept-questions.json`,
  `exercises.json`, `entry-questions.json` or `rubrics.json`.
- DO NOT add a join code, capacity check, waitlist, entry assessment, admin
  cohort panel, admin member list, AI mentor, commit cron or certificate.
- DO NOT make the Mock Interview card functional. It is a locked, inert
  disclosure — no `CohortInterviewCard`, no link, no action.
- DO NOT block a learner for being behind pace. Lateness is marked and
  displayed; every day stays completable.

**Cross-product isolation**

- DO NOT call `requireProgramMember()`, `resolveProgramMemberForUser()`,
  `findActiveMembership()` or `getProgramUnlockFloor()` from Databricks code —
  they resolve AI Cohort membership and redirect to `/program/ai-cohort`.
- DO NOT edit `features/program/verify-mission.ts`. In particular DO NOT flip
  `SHIP_IT_CONTENT_CHECKS` — the AI Cohort is live and mid-run.
- DO NOT change the behaviour of `program-module-list.tsx`, `day-shell.tsx`,
  `day-sidebar.tsx` or `program-day-client.tsx` for the AI Cohort. `basePath`
  is **optional** and defaults to `PROGRAM_AI_COHORT_BASE`.
- DO NOT hard-code `"Asia/Kolkata"` anywhere. Read `DATABRICKS_TZ`.

**Platform rules**

- DO NOT import `@/lib/*` into `middleware.ts`. The only change there is one
  string in the `protectedPaths` array.
- DO NOT pass `missionSpec` / `verificationSpec` to a client component. Only
  `shipItHints` (paths) and `dataRoomQuestionCount` cross the boundary.
- DO NOT pass `Date` objects, functions or Lucide icon components across the
  Server → Client boundary. Format on the server.
- DO NOT use `<Button asChild>` or `<Button render={<Link>}>`. Use
  `buttonVariants` / `dsButtonVariants` directly on the `<Link>`.
- DO NOT use `console.error`. Use `lib/logger.ts`.
- DO NOT return full Prisma records. Every query uses `select`. Every multi-step
  write is wrapped in a transaction on `writeClient()`.
- DO NOT create files this plan does not list.

---

## 7. DB safety

No schema change and no Prisma migration. All 078 tables involved
(`Cohort`, `Module`, `Activity`, `ContentActivityConfig`, `ProgramEnrollment`,
`EnrollmentProgress`, `ActivityAttempt`, `ActivityEvaluation`,
`EnrollmentDayActivity`) were applied to production by
`20260820120000_platform_data_architecture_phase1`.

**Before running the seed anywhere:**

1. `git add -A && git commit -m "checkpoint before databricks cohort"` — note the hash.
2. Create a Neon branch from `production` as the snapshot; record the branch id.

**Local / branch:**

```bash
npm run db:seed:databricks
```

The script refuses production via `PRODUCTION_NEON_HOST_ID`
(`ep-nameless-term-ams9a5e3`) unless `SEED_ALLOW_PRODUCTION=true`.

**Production content seed — requires explicit authorisation at the time, and is
not pre-approved by this plan.** It is additive-only (upserts on
`ProgramCategory.slug`, `LearningProgram.slug`,
`ProgramVersion(programId, versionNumber)`, `Module(programVersionId, position)`,
`Activity.id`, `ContentActivityConfig.activityId`, `Cohort.slug`) and writes no
user rows. Run against the **direct, non-pooler** `DATABASE_URL` — the pooler
drops the interactive transactions this touches:

```bash
SEED_ALLOW_PRODUCTION=true npm run db:seed:databricks
```

Then verify before flipping `ENABLE_DATABRICKS=true` in Vercel:

```sql
SELECT (SELECT count(*) FROM "Module" m
        JOIN "ProgramVersion" v ON v.id = m."programVersionId"
        JOIN "LearningProgram" p ON p.id = v."programId"
        WHERE p.slug = 'databricks') AS modules,          -- expect 9
       (SELECT count(*) FROM "Activity"
        WHERE id LIKE 'act_dbx_day_%') AS activities,     -- expect 31
       (SELECT status FROM "Cohort" WHERE slug = 'databricks-open') AS cohort_status;
```

Expect `9 | 31 | ENROLLING`. If `modules` is not 9 or `activities` is not 31,
**do not** enable the flag — re-run the seed, it is idempotent.

---

## 8. Verification

### Build

```bash
npx prisma generate && npm run build && npm run lint
```

Must pass with no `any` and no new TypeScript errors.

### Manual — enrolment

1. `ENABLE_DATABRICKS=true` in `.env.local`, `npm run db:seed:databricks`.
2. Signed out → `/program/databricks` redirects to
   `/login?from=%2Fprogram%2Fdatabricks`.
3. Signed in with no `StudentProfile` → redirects to `/register`.
4. Signed in with a profile → enrolment form + the locked 9-module list below it.
5. Repo URL `https://github.com/someone-else/repo` with username `you` → inline
   error "The repo owner must match your GitHub username".
6. Valid submit → page becomes the dashboard. Verify in the DB:
   `ProgramEnrollment` row has a **plain cuid** id (no `pe_` prefix),
   `status = ACTIVE`, `githubRepoUrl` set, `startedAt` = now;
   `EnrollmentProgress` has `totalActivities = 31`, `pointsPossible = 372`;
   `CandidateProfile.githubUsername` and `.linkedinUrl` updated.
7. Re-submitting the form does not reset `startedAt`.

### Manual — day unlock and lateness

8. On enrolment day: Day 1 `AVAILABLE`, Days 2–31 `LOCKED`; the Continue card
   reads "GET STARTED".
9. Day 2 stays LOCKED until Day 1 passes **and** the IST calendar has advanced —
   confirm the "UP NEXT … Unlocks *d MMM*" copy. Verify the boundary rolls at IST
   midnight, not UTC.
10. Set `BYPASS_DAY_LOCKS=true` to walk forward locally; confirm it is read only
    through `isDayLockBypassEnabled()` and never leaks into a production path.
11. Back-date an enrolment's `startedAt` by 5 days on a branch DB: Days 1–5 are
    unlockable in sequence, the dashboard shows "5 days behind", and a Day-1 pass
    records `ActivityAttempt.lateness = LATE`.
12. Pass Day 31 late → `ProgramEnrollment.status = COMPLETED` and the dashboard
    reads "Completed late". Pass it on time → "Completed".

### Manual — mission verification

13. Day 1 (`DATA_ROOM`): submit wrong answers → per-answer fail lines, no points,
    day stays AVAILABLE. Submit `%sql` / `serverless` /
    `day01_hello_lakehouse.py` (case-insensitive) → pass, +12, Day 2 unlock path.
14. Day 5 (`SHIP_IT` + answers): with `notebooks/day05_delta_fundamentals.py`
    **absent** from the repo → the verdict shows
    "Not found at https://github.com/…/notebooks/day05_delta_fundamentals.py".
    Commit the file, re-verify → pass. Confirm this works with **and** without
    `GITHUB_API_TOKEN` set (unauthenticated rate limits apply).
15. Points are awarded **once**: re-verifying a passed day is refused with
    "You already passed this mission." and `EnrollmentProgress.pointsEarned`
    does not move.
16. Two verifies inside 15 s → "Please wait 15 seconds between runs."
17. Confirm the network payload for the day page contains **no** `answers`,
    `repoChecks` or `verificationSpec` — only `check`/`path` hints.

### Manual — no regression on the AI Cohort

18. As an AI Cohort member: `/program/ai-cohort/dashboard`, a day page, mission
    submit, Videos and Leaderboard all behave exactly as before. Day links still
    point at `/program/ai-cohort/day/N` (the `basePath` default).
19. `/dashboard` Prep Kit shows both cards; the AI Cohort card's href logic is
    unchanged.
20. With `ENABLE_DATABRICKS` unset: `/program/databricks` 404s and the Databricks
    Prep Kit card is absent.

### Exactly these files should have changed

```
new:      src/features/databricks/{constants,progression,enroll,days,missions,dashboard}.ts
          src/repositories/databricks.ts
          src/lib/validations/databricks.ts
          src/app/actions/databricks-actions.ts
          src/app/program/databricks/day/[day]/page.tsx
          src/components/databricks/{databricks-enroll-form,databricks-dashboard-view,
                                     databricks-stats-panel,databricks-mission-panel}.tsx
          docs/plans/104-databricks-cohort.md
deleted:  src/features/program/databricks-catalog.ts
edited:   prisma/seed-databricks.ts
          src/repositories/{learning,candidate}.ts
          src/features/program/constants.ts
          src/features/dashboard/get-hub-data.ts
          src/app/dashboard/page.tsx
          src/app/program/databricks/page.tsx
          src/components/dashboard-hub/roadmaps.tsx
          src/components/program/{program-module-list,day-shell,day-sidebar,program-day-client}.tsx
          src/lib/feature-flags.ts
          middleware.ts
          .env.example
          docs/CHANGELOG.md
unchanged: prisma/schema.prisma, src/features/program/verify-mission.ts,
           src/app/program/databricks/layout.tsx, every src/app/program/ai-cohort/** file
```

---

## 9. Commit message

```
feat(databricks): 078-native Databricks cohort with rolling IST unlock and GitHub verification

Ships /program/databricks as a self-serve 31-day track built entirely on the
078 learning spine — no legacy ProgramMember/ProgramDay row and no dual-write.

- open enrolment (no join code, capacity or admin panel) behind a /register
  profile; repo URL stored on ProgramEnrollment.githubRepoUrl, GitHub username
  and LinkedIn on CandidateProfile
- rolling unlock: enrolment date is Day 1 in IST, day N unlocks anchor+(N-1)
  and still needs day N-1 passed; late passes are marked per day and a late
  day 31 marks overall completion late
- missions reuse features/program/verify-mission.ts unchanged (SHIP_IT repo
  file checks + DATA_ROOM answers), 12 pts/day, 372 max, 30 runs/day, 15s
  spacing; attempts land in ActivityAttempt/ActivityEvaluation with plain cuid
  ids so no migration-mirror query can pick them up
- dashboard mirrors the AI Cohort layout (continue card, module accordion,
  VIEW STATS, locked Mock Interview); no videos, no leaderboard, no tabs
- Prep Kit on /dashboard gains a Databricks card; ENABLE_DATABRICKS is now the
  launch switch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
