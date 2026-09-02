# 105 — Remove the legacy `/program/interview` exit-interview page

**Status:** plan. Nothing here is implemented.
**Verified against:** branch `more-mock-interviews` @ `5d33f99`. Every dependency claim below was
established by grep over `src/`, not assumed.

---

## 1. Goal

Delete the stale candidate-facing exit-interview page at `/program/interview` and the code that only
it reaches. The page is unreachable from any navigation, runs the superseded OpenAI Realtime
architecture, and its eligibility gate lets any member of an ended cohort in regardless of whether
they completed the program.

**No database change. No data deleted.** `ProgramInterview` rows stay, and the admin panel that reads
them stays.

---

## 2. Current behaviour

### 2.1 The eligibility defect

`features/program/interview.ts:226-232`:

```ts
const programComplete = progressDay >= PROGRAM_TOTAL_DAYS;
const cohortEnded = new Date() > member.cohort.endsAt;

if (!programComplete && !cohortEnded) {
  return { state: "locked", reason: `Reach Day ${PROGRAM_TOTAL_DAYS} to unlock your exit interview.` };
}
```

The condition unlocks on `programComplete || cohortEnded`. `cohortEnded` is a pure clock comparison
against `cohort.endsAt` and carries no progress signal, so **once a cohort's end date passes the gate
opens for every member of it**, including one with zero passed days. Every cohort whose `endsAt` is in
the past is currently in this state. This is the reported symptom.

The gate is being deleted along with the page, so it is not being repaired. If the page were being
kept, the fix would be `&&` — recorded here because the same shape may exist elsewhere.

### 2.2 How the page is reached

It is **not linked from anywhere**. `app/program/(app)/layout.tsx:6-10` defines the nav as Dashboard,
Videos, Leaderboard only. A repo-wide grep for `href="/program/interview"` returns nothing — the only
textual matches are `revalidatePath` calls and `/program/interview-key.png`, an image. The page is
reachable by direct URL, bookmark or history only.

### 2.3 What it runs

`InterviewClient` opens an OpenAI Realtime session via `/api/program/interview/session`, which mints
an ephemeral client secret for `gpt-realtime`. This is the architecture rejected in plan 104 §3C: the
model runs the conversation, so there is no question bank, no depth ladder, no evidence and no
comparability. **This page is the only OpenAI Realtime usage in the codebase**; removing it removes
that dependency entirely.

---

## 3. Dependency analysis

Established by grep. Each "sole caller" claim is the complete result set.

| Symbol | Sole caller | Verdict |
|---|---|---|
| `app/program/(app)/interview/page.tsx` | nothing — direct URL only | **delete** |
| `components/program/interview-client.tsx` | that page (1 import) | **delete** |
| `app/api/program/interview/session/route.ts` | `interview-client.tsx:233` | **delete** |
| `completeInterviewAction` | `interview-client.tsx:143` | **delete** |
| `prepareInterviewStart` | `session/route.ts:56` | **delete** |
| `getInterviewEligibility` | `getInterviewDashboardCard` | **keep** — see §3.1 |
| `getInterviewMemberView` | that page only | **delete** |
| `listInterviewsForAdmin` | `app/admin/program/interviews/page.tsx` | **keep** |
| `getInterviewDashboardCard` | `app/program/(app)/dashboard/page.tsx:24` | **keep** |
| `adminEvaluateInterviewAction`, `adminResetInterviewAction` | `admin-interviews-panel.tsx` | **keep** |
| `features/program/interview.ts` (module) | admin + dashboard | **keep the file** |

### 3.1 One thing deliberately left alone

`program-dashboard-view.tsx:49-52` records that `interviewCard` is "still accepted (and passed by the
page) but the body of the disclosure now renders `CohortInterviewCard`". So `getInterviewDashboardCard`
— and through it `getInterviewEligibility`, carrying the defective gate — is **computed on every
dashboard load and may render nothing**.

That is a second cleanup with its own blast radius (a dashboard prop contract), and folding it into a
page deletion is how a small removal becomes a regression. **Out of scope here.** Tracked in §7.

---

## 4. Files to touch

**Deleted**

- `src/app/program/(app)/interview/page.tsx` `[delete]` — the page. Leaves the `(app)/interview`
  directory empty; remove the directory too.
- `src/components/program/interview-client.tsx` `[delete]` — the Realtime client.
- `src/app/api/program/interview/session/route.ts` `[delete]` — ephemeral-token mint. Leaves
  `api/program/interview/session` empty; remove the directory.

**Edited — narrow and enumerated**

- `src/app/actions/program-interview-actions.ts` `[edit]` — remove `completeInterviewAction` (lines
  35-63) and its now-unused imports. **Keep both admin actions.** Remove the three
  `revalidatePath("/program/interview")` calls at lines 53, 61, 78, 99 that point at the deleted
  route; keep `revalidatePath("/admin/program/interviews")`.
- `src/features/program/interview.ts` `[edit]` — remove `prepareInterviewStart` (line 343) and
  `getInterviewMemberView` (~line 270) plus any type now unreferenced (`InterviewMemberView`).
  **Do not touch** `getInterviewEligibility`, `getInterviewDashboardCard`, `listInterviewsForAdmin`,
  or `ensureInterviewRecord`.

**Explicitly NOT edited**

`prisma/schema.prisma`, any migration, `app/admin/program/interviews/**`,
`components/program/admin-interviews-panel.tsx`, `app/program/(app)/dashboard/page.tsx`,
`components/program/program-dashboard-view.tsx`, `components/program/cohort-interview-*.tsx`, the
program nav, and everything under `features/interview/**` (the cohort and platform engines are
unrelated to this page).

---

## 5. Server vs Client

All three deleted files are server-rendered or server-only except `interview-client.tsx`, which is the
only `"use client"` file in the set and is deleted whole. No Server→Client prop boundary is created,
changed, or crossed. The two edited files are `"use server"` / `server-only` and stay that way.

---

## 6. Steps

1. Delete `src/app/api/program/interview/session/route.ts` and its now-empty parent directory.
2. Delete `src/components/program/interview-client.tsx`.
3. Delete `src/app/program/(app)/interview/page.tsx` and its now-empty parent directory.
4. Edit `src/app/actions/program-interview-actions.ts` — drop `completeInterviewAction`, the stale
   `revalidatePath("/program/interview")` lines, and any import left unused.
5. Edit `src/features/program/interview.ts` — drop `prepareInterviewStart`, `getInterviewMemberView`,
   and any type left unreferenced.
6. `npx tsc --noEmit` — must be clean. Any error here means a dependency this plan missed; **report it
   rather than deleting more files to satisfy the compiler.**
7. `npm run build` — must succeed.

---

## 7. Guardrails for Cursor (DO NOT)

1. **DO NOT delete `src/features/program/interview.ts`.** The admin page and the dashboard import from
   it. Remove only the two named functions.
2. **DO NOT delete `adminEvaluateInterviewAction` or `adminResetInterviewAction`.**
   `admin-interviews-panel.tsx` imports both.
3. **DO NOT touch the Prisma schema or write a migration.** `ProgramInterview` rows are historical
   assessment records and the admin panel still reads them. This change deletes no data.
4. **DO NOT "fix" the `&&`/`||` gate on the way past.** The gate is being deleted with the page.
   Changing it and deleting it in one commit makes the diff unreviewable.
5. **DO NOT extend the cleanup to `getInterviewDashboardCard` or the dashboard's `interviewCard`
   prop.** See §3.1 — separate change, separate review.
6. **DO NOT add a redirect from `/program/interview`.** A 404 is the correct answer for a removed
   page; a redirect to the dashboard hides the removal from anyone holding a stale bookmark. Raise it
   if the user wants one.
7. **DO NOT touch anything under `src/features/interview/**` or `src/app/mock-interviews/**`.**
   Different system entirely.
8. If `tsc` reports an unused import or symbol not listed in §4, **stop and report it**.

---

## 8. DB safety

Not applicable. No schema change, no migration, no seed, no data deletion.

---

## 9. Verification

1. `npx tsc --noEmit` clean; `npm run build` succeeds.
2. `GET /program/interview` returns 404.
3. `/program/dashboard` renders unchanged for a member who has NOT completed the program, and for one
   who has.
4. `/admin/program/interviews` still lists interviews, and Evaluate and Reset both still work.
5. `grep -rn "program/interview" src` returns only `/admin/program/interviews`,
   `/program/interview-key.png`, and imports of `features/program/interview.ts`.
6. `grep -rn "realtime" src` returns nothing outside `features/interview/voice.ts` comments —
   confirming the OpenAI Realtime dependency is gone.
7. Exactly these files changed: 3 deleted, 2 edited. Nothing else.

---

## 10. Open question for the user

This removes the **candidate-facing page only**. Still live afterwards: the `ProgramInterview` table,
`/admin/program/interviews`, the admin evaluate/reset actions, and `getInterviewDashboardCard` on the
dashboard.

If the intent is to retire the legacy exit interview **as a feature**, that is a second, larger change
— admin surface, dashboard card, and a decision about the historical rows. Say so and it gets its own
plan.

---

## 11. Commit message

```
chore(program): remove stale exit-interview page and its Realtime session route

The page was reachable by direct URL only — no nav entry and no inbound link —
and its eligibility gate unlocked on `programComplete || cohortEnded`, so any
member of a cohort past its end date could open it regardless of days completed.

Deletes the page, the Realtime client and the ephemeral-token route, plus the
two functions only they called. The admin panel, the ProgramInterview table and
the dashboard card are untouched.

Removes the last OpenAI Realtime dependency in the codebase.
```
