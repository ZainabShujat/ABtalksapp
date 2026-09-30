# 156 — Admin cohort enrollment view

## 1. Goal
Give Platform Admin a first-class view of **which cohort every candidate is in and
when they joined it** — a cohort index with per-cohort headcount and a per-cohort
roster with real join dates and CSV export. Today this data exists only in
`ProgramEnrollment` and is not readable from any admin surface.

## 2. Current behavior

There is **no admin surface that answers "how many students are in cohort X"**.
What exists:

| Surface | Shows | Gap |
| --- | --- | --- |
| `/admin` overview | Total candidates / recruiters / credits / emails | No cohort dimension at all |
| `/admin/students` | Flat candidate list, filters by `track` (`CHALLENGE`/`HACKATHON`) and `domain` | No cohort column, no cohort filter. `Joined` column shows `User.createdAt` (account creation), not cohort join |
| `/admin/program/members` | Roster for **one** AI-cohort `ProgramCohort` | Only the `/program` track; nothing for the 60-day challenge or the 6 newer data cohorts |
| `/admin/ai-cohort` | Cohort *applications* from Supabase | Applications, not enrollments |

Production today (read-only query against `ep-young-shadow-amawetjy`, 2026-09-28)
has **14 cohorts across 10 programs and 3,417 `ProgramEnrollment` rows**:

```
legacy-claude    60-Day Claude AI Mastery Challenge    ACTIVE    ROLLING   enr=2836
legacy-se        60 Days of Code — Software Eng.       ACTIVE    ROLLING   enr=213
legacy-ai        60 Days of Code — AI                  ACTIVE    ROLLING   enr=202
legacy-ds        60 Days of Code — Data Science        ACTIVE    ROLLING   enr=89
legacy-program-cms969sax…  AI Cohort India Aug 26      ENROLLING FIXED     enr=50
legacy-program-cmrp9r3wt…  AI Cohort USA               ENROLLING FIXED     enr=19
databricks-open  Databricks Data Engineering           ENROLLING ROLLING   enr=4
ds-architect-open Data Solutions Architect             ENROLLING ROLLING   enr=2
snowflake-open   Snowflake Data & AI Engineering       ENROLLING ROLLING   enr=2
powerbi-open / databricks-ai-open / 3 archived         …                   enr=0
```

None of it is visible to an admin.

### 2a. The timestamp trap (read this before writing any query)

`ProgramEnrollment` carries four dates. They are **not** interchangeable:

| Column | What it actually holds in production |
| --- | --- |
| `createdAt` | **The plan-078 backfill date.** All 3,340 `pe_enr_*` rows say `2026-08-24`. Useless as a join date. |
| `joinedAt` | **The real join/order timestamp.** Spans `2026-04-30 → 2026-09-12`. 100% populated. |
| `enrolledAt` | Also 100% populated, tracks `joinedAt`. |
| `startedAt` | Rolling day-math anchor. For `FIXED` cohorts day math ignores it. Not a join date. |

Evidence: on `legacy-claude`, only 27 of 2,836 rows have
`date_trunc('day', joinedAt) = date_trunc('day', createdAt)` — the other 2,809
were backfilled. **"When they joined" is `joinedAt` and nothing else.**
The same trap applies to `/admin/students`' `Joined` column, which currently
shows `User.createdAt`; this plan does not change that column, it adds a
correct one on the new surface.

### 2b. The month-bucket timezone trap

`joinedAt` is `timestamp without time zone` holding UTC, and every roster row is
rendered with `formatDateIST`. Truncating the month in UTC therefore disagrees
with the date printed on the row: **21 production rows** currently fall in a
different month under UTC than under IST. Bucket with
`date_trunc('month', "joinedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`.
(The 7/30-day figures are rolling windows, not calendar boundaries, so plain UTC
arithmetic is correct there.)

## 3. Files to touch

**New**

| Path | Note |
| --- | --- |
| `src/features/admin/get-cohorts.ts` | `[new]` Server-only reads: cohort index rows + per-cohort roster + join-trend buckets. |
| `src/features/admin/get-cohorts.test.ts` | `[new]` Tests for the pure helpers + source guards. Plain `tsx` harness — this repo has no vitest. |
| `src/app/admin/cohorts/page.tsx` | `[new]` Server Component — cohort index. |
| `src/app/admin/cohorts/[cohortId]/page.tsx` | `[new]` Server Component — one cohort's roster. |
| `src/components/admin/cohort-roster-filters.tsx` | `[new]` Client — search/status URL params + CSV export button. |

**Edited**

| Path | Note |
| --- | --- |
| `src/features/admin/admin-nav.ts` | `[edit]` One item: `Cohorts → /admin/cohorts` in the `console` group, after Candidates. |
| `src/app/actions/admin-export-actions.ts` | `[edit]` Add `getCohortRosterForExport`, reusing the existing `requireAdminExport()` rate-limited wrapper. |
| `package.json` | `[edit]` One script: `test:cohorts`. |

No schema change. No migration. No seed.

## 4. Server vs Client

| Component | Kind | Notes |
| --- | --- | --- |
| `app/admin/cohorts/page.tsx` | **Server** | `await requireAdmin()`, then `getCohortIndex()`. |
| `app/admin/cohorts/[cohortId]/page.tsx` | **Server** | `await requireAdmin()`, then `getCohortDetail()`. `notFound()` on unknown id. |
| `components/admin/cohort-roster-filters.tsx` | **Client** (`"use client"`) | Only primitives cross the boundary: `cohortId: string`, `cohortName: string`, `statusCounts: Record<string, number>`. No functions, no icons, no Date objects, no class instances. |
| `StatCard`, `AdminPageHeader`, `Table`, `Badge` | existing | Reused unchanged. |

Dates are formatted **on the server** with `formatDateIST` and passed as strings,
so no `Date` crosses into the client component.

## 5. Steps

### Step 1 — `src/features/admin/get-cohorts.ts` [new]

Server-only module (no `"use server"`; it is imported by Server Components).

```ts
import { prisma } from "@/lib/db";
import { formatDateIST } from "@/lib/date-utils";
import { listCandidateProfiles } from "@/repositories/candidate";
import type { EnrollmentStatusV2 } from "@prisma/client";
```

Exports:

1. `export const COHORT_STATUSES = ["APPLIED","WAITLISTED","ACTIVE","COMPLETED","DROPPED","REMOVED"] as const;`
   and `export type CohortEnrollmentStatus = (typeof COHORT_STATUSES)[number];`

2. `export type CohortIndexRow = { id, slug, name, programSlug, programTitle, programFormat, status, startMode, timezone, startsAtLabel: string | null, capacity: number | null, total: number, byStatus: Record<CohortEnrollmentStatus, number>, joinedLast7: number, joinedLast30: number, firstJoinedLabel: string | null, lastJoinedLabel: string | null }`

3. `export async function getCohortIndex(): Promise<{ rows: CohortIndexRow[]; totals: { cohorts: number; enrollments: number; active: number; joinedLast30: number } }>`

   Implementation — **three queries, no per-cohort N+1**:
   - `prisma.cohort.findMany({ select: { id, slug, name, status, startMode, startsAt, timezone, capacity, programVersion: { select: { versionNumber, program: { select: { slug, title, format } } } } }, orderBy: { createdAt: "asc" } })`
     (field names verified against the live client: it is `programVersion.versionNumber` and `program.title` — **not** `.version` / `.name`.)
   - `prisma.programEnrollment.groupBy({ by: ["cohortId", "status"], _count: { _all: true } })` → fold into `byStatus` + `total`.
   - `prisma.programEnrollment.groupBy({ by: ["cohortId"], _min: { joinedAt: true }, _max: { joinedAt: true } })` → first/last join.
   - Two scalar windows: `prisma.programEnrollment.groupBy({ by: ["cohortId"], where: { joinedAt: { gte: <7d ago> } }, _count: { _all: true } })` and the same for 30 days.

   Sort `rows` by `total` descending so the 2,836-row Claude cohort is first.

4. `export type CohortRosterRow = { enrollmentId, userId, fullName, email, status, joinedAtLabel, joinedAtIso, completedActivities, totalActivities, currentStreak, githubRepoUrl }`

5. `export async function getCohortDetail(input: { cohortId: string; search?: string; status?: CohortEnrollmentStatus | "ALL"; limit?: number })`
   returning `{ cohort: {...}, statusCounts, monthly: { key: string; label: string; count: number }[], rows: CohortRosterRow[], truncated: boolean } | null`.

   - `prisma.cohort.findUnique` with the same select as above; return `null` if missing.
   - `prisma.programEnrollment.findMany({ where: { cohortId, status?, user: { deletedAt: null } }, orderBy: { joinedAt: "desc" }, take: limit + 1, select: { id, userId, status, joinedAt, githubRepoUrl, trackCurrentStreak, progress: { select: { completedActivities: true, totalActivities: true } }, user: { select: { id: true, email: true, deletedAt: true } } } })`.
     `limit` defaults to `200`; `truncated = rows.length > limit`, then slice.
   - Names come from `listCandidateProfiles(userIds)` (the canonical candidate read boundary), **not** from `User.name`.
   - Search: apply on the fetched page against `fullName`/`email` **only after** the identity overlay, because names live in `CandidateProfile`, not `User`. To keep search honest on a 2,836-row cohort, when `search` is set widen the DB `take` to `2000` and filter in memory before slicing to `limit`. Document that cap in a comment.
   - `statusCounts`: one `groupBy(["status"])` scoped to the cohort — always the **unfiltered** totals, so the filter chips keep showing real numbers.
   - `monthly`: one `groupBy` is not enough (Prisma cannot bucket by month), so use a single `$queryRaw` with `date_trunc('month', "joinedAt" AT TIME ZONE 'UTC')`. Return at most the last 12 buckets, oldest first.

6. Pure helpers exported for testing: `foldStatusCounts(rows)` and `monthLabel(key)`.

**Guard:** every Prisma call uses an explicit `select`. No `include`. No full-record returns.

### Step 2 — `src/app/admin/cohorts/page.tsx` [new]

```tsx
export default async function AdminCohortsPage() {
  const [, data] = await Promise.all([requireAdmin(), getCohortIndex()]);
  …
}
```

- `AdminPageHeader` — title `"Cohorts"`, description
  `` `${data.totals.cohorts} cohorts · ${data.totals.enrollments} enrollments` ``.
- Four `StatCard`s: Total cohorts, Total enrollments, Active enrollments,
  Joined last 30 days (`accent` values from the existing `"green" | "orange" | "blue"` union only).
- One `Table` (desktop, `hidden md:block`) + stacked cards (`md:hidden`), matching
  `/admin/students`' responsive pattern exactly. Columns:
  `Cohort` (name + program title, links to `/admin/cohorts/{id}`) ·
  `Format` · `Status` · `Start` · `Enrolled` · `Active` · `Completed` ·
  `Last 30d` · `First join` · `Latest join`.
- Empty state when `rows.length === 0`.

### Step 3 — `src/app/admin/cohorts/[cohortId]/page.tsx` [new]

- `params: Promise<{ cohortId: string }>` and `searchParams: Promise<{ q?: string; status?: string }>` — Next 15 async params.
- Validate `status` against `COHORT_STATUSES` before use; anything else → `"ALL"`.
- `notFound()` when `getCohortDetail` returns `null`.
- Header: cohort name, program title, start mode + start date + timezone, capacity.
- A **"Joins by month"** strip: horizontal bars from `monthly`, widths as inline
  `style={{ width: \`${(count / max) * 100}%\` }}` percentages. This is the
  "when they joined" answer at a glance.
- `<CohortRosterFilters …/>`.
- Roster table: `Candidate` (name + email, links to `/admin/students/{userId}`) ·
  `Status` · `Joined` (IST, from `joinedAt`) · `Progress` (`completed/total`) ·
  `Streak` · `Repo`.
- When `truncated`, render a muted line: `Showing first 200 of N — export for the full list.`

### Step 4 — `src/components/admin/cohort-roster-filters.tsx` [new]

Model it on `students-filters.tsx`, but simpler — a search `Input`, a row of
status chips built from `COHORT_STATUSES` + `ALL` with counts, and an
`Export CSV` button. Same `pushWith()` URL-param pattern
(`router.push(\`${pathname}?${params.toString()}\`)`, drop params equal to the default).
Export calls `getCohortRosterForExport`, then `toCSV` + `downloadCSV` from
`@/lib/csv`, filename `abtalks-cohort-${slug}-${YYYY-MM-DD}.csv`, `toast` on
success/empty/failure — identical to the students export.

### Step 5 — `src/app/actions/admin-export-actions.ts` [edit]

Append one export, reusing the existing private `requireAdminExport()`
(which already does `requireAdmin()` + `assertRateLimit({ bucket: "EXPORT" })`):

```ts
export async function getCohortRosterForExport(filters: {
  cohortId: string;
  status?: string;
  search?: string;
}) {
  await requireAdminExport();
  const parsed = cohortExportSchema.parse(filters);   // Zod at the boundary
  const detail = await getCohortDetail({ ...parsed, limit: COHORT_EXPORT_CAP });
  if (!detail) return [];
  return detail.rows.map((r) => ({ … flat scalars only … }));
}
```

`const COHORT_EXPORT_CAP = 10_000;` mirroring `SUBMISSIONS_EXPORT_CAP`.
CSV columns: `name, email, status, joinedAt (ISO), completedActivities,
totalActivities, currentStreak, githubRepoUrl, userId, enrollmentId`.

### Step 6 — `src/features/admin/admin-nav.ts` [edit]

One item in the `console` group, directly after Candidates:

```ts
{ href: "/admin/cohorts", label: "Cohorts", icon: "cohort", match: ["/admin/cohorts"] },
```

`"cohort"` is already in the `AdminNavIcon` union and already mapped to
`GraduationCap` in both `admin-sidebar.tsx` and `admin-mobile-nav.tsx` — **no
icon-map change is needed in either file.** Verify `admin-mobile-nav.tsx`
reads from `ADMIN_NAV_GROUPS` too; if it has its own list, add the same entry there.

### Step 7 — `src/features/admin/get-cohorts.test.ts` [new]

**This repo has no vitest.** Tests are standalone files run with `tsx` and a
hand-rolled `assert`/`suite` harness (see `src/features/admin/audit.test.ts`);
copy that harness exactly. Because `get-cohorts.ts` reaches `server-only`
through the candidate repository, the script needs
`NODE_OPTIONS=--conditions=react-server`. Add to `package.json`:

```json
"test:cohorts": "cross-env NODE_OPTIONS=--conditions=react-server tsx src/features/admin/get-cohorts.test.ts",
```

Pure functions plus source guards, no DB:
- `emptyStatusCounts` / `foldStatusCounts` fill absent statuses with zero and
  sum duplicate rows.
- `monthLabel("2026-05")` → `"May 2026"`; junk passes through.
- Guard: the module never reads `createdAt` on a `ProgramEnrollment` query (§2a).
- Guard: month buckets convert to IST before `date_trunc` (§2b).
- Guard: no `include:`, and no `await prisma` inside a loop or `.map`.

## 6. Guardrails for Cursor (DO NOT)

1. **DO NOT use `ProgramEnrollment.createdAt` as the join date.** It is the
   plan-078 backfill timestamp (`2026-08-24` for 3,340 rows). Use `joinedAt`.
   Do not "improve" this by falling back to `createdAt` when `joinedAt` is null —
   it is never null in production.
2. **DO NOT touch `ProgramCohort`.** That is the `/program` track's own table and
   is not the canonical cohort. This feature reads `Cohort`.
3. **DO NOT modify `/admin/students`, `get-students.ts`, `students-filters.tsx`,
   or `/admin/program/*`.** This is an additive surface. Existing behavior stays
   byte-identical.
4. **DO NOT add `requireRole`/`requireAdmin` to anything public.** `requireAdmin()`
   goes in the two new page components only.
5. **DO NOT import anything new into `middleware.ts` or `auth.config.ts`.** Nothing
   in this plan is in the edge path; if a build error suggests otherwise, stop.
6. **DO NOT use `<Button asChild>` or `<Button render={<Link>}>`.** Use
   `buttonVariants` on `<Link>` (Base UI button semantics).
7. **DO NOT use `console.error`.** Use `lib/logger.ts`.
8. **DO NOT return full Prisma records.** Every query carries an explicit `select`.
9. **DO NOT create extra abstraction files.** Only the five new files listed in §3.
10. **DO NOT change the Prisma schema, write a migration, or run a seed.** This is
    read-only; there is no `prisma/` change in this plan.
11. **DO NOT value-import from `get-cohorts.ts` into the client component.** That
    module imports Prisma and `server-only`; a value import drags it into the
    browser bundle. Use `import type` and declare the status list locally with
    `satisfies readonly CohortEnrollmentStatus[]` to keep the two in sync.
12. **DO NOT truncate the month in UTC.** See §2b.
13. **DO NOT pass functions, icons, `Date` objects or class instances** from the
    Server pages into `cohort-roster-filters.tsx`. Format dates server-side.
14. **DO NOT loop a Prisma query per cohort.** The index page is three `groupBy`
    calls plus one `findMany`, regardless of cohort count.
15. **DO NOT guess Prisma field names.** It is `programVersion.versionNumber` and
    `program.title` / `program.format` — `.version` and `.name` do not exist and
    will fail at runtime, not at build time.
16. **DO NOT add an unauthenticated route.** `/admin/*` is admin-only; keep it that way.

## 7. DB safety

Not applicable — **no schema or data change**. Every query added is a read.
No migration, no seed, no backfill. (The production figures quoted in §2 were
gathered through a `default_transaction_read_only=on` session.)

## 8. Verification

**Build / typecheck**
```bash
npx tsc --noEmit && npm run lint && npm run build
```
and
```bash
npm run test:cohorts
```
Note: `npm run lint` and `npx tsc --noEmit` both have **pre-existing** failures on
master (2,879 lint errors repo-wide; tsc is clean only after `npx prisma generate`,
since a stale client reports four phantom errors in jobs / hackathon / rate-limit).
Scope the lint check to the changed files.

**Manual, signed in as a platform admin**
1. `/admin` → sidebar shows **Cohorts** under Platform Admin, between Candidates
   and Recruiters, with the graduation-cap icon; it highlights when active.
2. `/admin/cohorts` → 14 rows. Top row is the Claude challenge at **2,836**
   enrolled (2,743 active / 92 completed / 1 dropped). Stat cards read
   14 cohorts / 3,417 enrollments.
3. Row for `legacy-ds` shows 89 enrolled, 88 active, 1 dropped.
4. Click the Claude cohort → roster loads, `Joined` dates spread across
   **May–September 2026** (if every row says 24 Aug 2026, `createdAt` was used —
   that is the §2a bug).
5. "Joins by month" shows bars for May through Sep 2026.
6. Filter `status=COMPLETED` → 92 rows; the chip counts stay at the unfiltered
   totals; the URL carries `?status=COMPLETED`.
7. Search a known candidate's email → single row; clicking the name lands on
   `/admin/students/{userId}`.
8. `Export CSV` downloads `abtalks-cohort-legacy-claude-<date>.csv`; open it and
   confirm the `joinedAt` column is varied ISO timestamps, not all 2026-08-24.
9. Second export within the rate-limit window is refused with the standard
   message rather than a stack trace.
10. `/admin/cohorts/does-not-exist` → 404.
11. Sign out, hit `/admin/cohorts` → redirected, not rendered.
12. Mobile width (375px): index renders stacked cards, no horizontal page scroll.

**Exactly these files should have changed**
```
docs/plans/156-admin-cohort-enrollment-view.md      [new]
src/features/admin/get-cohorts.ts                   [new]
src/features/admin/get-cohorts.test.ts              [new]
src/app/admin/cohorts/page.tsx                      [new]
src/app/admin/cohorts/[cohortId]/page.tsx           [new]
src/components/admin/cohort-roster-filters.tsx      [new]
src/features/admin/admin-nav.ts                     [edit]
src/app/actions/admin-export-actions.ts             [edit]
package.json                                        [edit]
```

## 9. Commit message

```
feat(admin): cohort enrollment view — headcount per cohort and real join dates (plan 156)

Adds /admin/cohorts: an index of every canonical Cohort with enrollment
totals broken down by status and 7/30-day join windows, plus a per-cohort
roster with joins-by-month, status filters, search and CSV export.

Join dates read ProgramEnrollment.joinedAt. ProgramEnrollment.createdAt is
the plan-078 backfill timestamp (2026-08-24 on 3,340 rows) and is not a
join date.

Read-only: no schema change, no migration, no seed. Existing admin
surfaces are untouched.
```
