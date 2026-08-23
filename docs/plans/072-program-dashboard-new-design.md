# 072 — Program dashboard: HackerRank-style module view on the new design system

## 1. Goal

Rebuild `/program/dashboard` as a clean, light, HackerRank-prep-kit-style page like the webpage: https://www.hackerrank.com/prep-kit/software-engineer: a
breadcrumb, one "continue / start" card, eight collapsible module sections whose
day rows carry per-day state and actions, a collapsible **VIEW STATS** panel that
absorbs every statistical block currently on the page, and a permanently locked
**Mock Interview** section. Styling follows
[docs/design-system.md](../design-system.md) (cream `#FBF9F7` / orange `#E05226`,
Fredoka headings + Inter body) — the same language as the student dashboard hub
(`src/components/dashboard-hub/*`).

Approved deviation from the design system: the content column is **~1500px**, not
the spec'd 1280px (§11). This is a deliberate call by the product owner for this
page. Every other token (spacing scale, radii, type scale, button heights,
colors) follows the spec.

---

## 2. Current behavior

`src/app/program/(app)/dashboard/page.tsx` (Server Component) fetches five things
in parallel — `getMemberDashboard`, `getMemberAtRiskStatus`,
`getMemberProjectsSummary`, `getMemberRecommendation`,
`getInterviewDashboardCard` — and hands them to
`src/components/program/program-dashboard-view.tsx` (Client Component).

That view renders, on a dark `#040A12` full-bleed surface with purple `#7364E6`
accents:

1. Header "Mission control" + day counter, at-risk badge on the right.
2. Five stat cards: Total score, Rank, Commit pts, Cohort day, Clean passes.
3. Mission progress heatmap (`MissionHeatmap`) + Today's Mission + Voice Interview.
4. Score breakdown (three `ScoreBar`s).
5. Module progress — 8 static cards, `passed/total` + bar, **not** expandable, no
   day-level detail and no links.
6. AI mentor note (conditional), Boss Build projects (conditional), Recent runs.

Supporting facts confirmed in code:

- **8 modules** are seeded (`prisma/content/program/modules.json`), covering days
  1–31 (`startDay`/`endDay` per module).
- `getMemberDayStates(memberId)` (`src/features/program/progression.ts`) already
  returns `modules: CurriculumModule[]` (number, title, subtitle, color, startDay,
  endDay) and `days: CurriculumDay[]` (dayNumber, title, missionType, isProjectDay,
  moduleNumber, **state**). `getMemberDashboard` already calls it internally.
- `DayState` is `LOCKED | AVAILABLE | PASSED | SKIPPED`.
- `getDayShell` only redirects on `LOCKED`, so **PASSED and SKIPPED days are
  already viewable** at `/program/day/[day]` — "view the day" needs no backend work.
- Days 1–3 can be waived as PASSED by `db:bootstrap:program-start-day`
  (`PROGRAM_MEMBER_START_DAY = 4`); waived submissions are marked
  `payload.waived === true`. So "has the member started?" must ignore waived rows.
- `/program` pages each paint their own full-bleed dark background
  (`day-shell.tsx` `#030712`, `program-leaderboard-view.tsx` `#040A12`); the
  **videos**, **interview** and **curriculum** pages do **not** — they inherit the
  layout's dark bg + `text-white`.
- `mission-heatmap.tsx` is also used by `/talent/members/[id]` — it must stay.

---

## 3. Decisions taken (answered by the product owner — do not re-litigate)

| Question | Decision |
| --- | --- |
| Shell chrome | Restyle the `/program` (app) layout to the light system. Videos / Leaderboard / Day keep their existing dark content for now. |
| Content width | ~**1500px** module column, with left/right margin inside it. |
| VIEW STATS scope | **Everything** statistical goes inside: stat cards, score breakdown, recent runs, at-risk, AI mentor note, Boss Build projects. |
| "Not started" card label | `Start Day {first unlocked day}` — uses the real first AVAILABLE day (Day 4 for waived members), never a hardcoded Day 1. |
| Breadcrumb | `/program/dashboard` only (`Dashboard > AI Cohort`). The Day page stays untouched. |
| Mock interview | Reuse `getInterviewDashboardCard` data but render **always locked**, no link out. |
| Caught-up state | Show a card in the same slot with "all caught up" copy and no CTA. |
| Heatmap + Curriculum | Hidden from the dashboard / nav, **kept** in the codebase. |

---

## 4. Files to touch

| File | Change |
| --- | --- |
| `src/features/program/progression.ts` | `[edit]` add `isWaivedPayload()` helper next to `isSkippedPayload()`. |
| `src/features/program/dashboard.ts` | `[edit]` extend `MemberDashboard` with `modules`, `days`, `hasStarted`, `nextLockedDay`; return them (data already in scope). |
| `src/components/program/program-dashboard-view.tsx` | `[edit]` full rewrite of the layout in the new design system; keeps its name and existing props, gains nothing new (all new data arrives inside `data`). |
| `src/components/program/program-module-list.tsx` | `[new]` collapsible module sections + day rows (Client). |
| `src/components/program/program-stats-panel.tsx` | `[new]` VIEW STATS body — stat cards, score breakdown, recent runs, at-risk, mentor note, projects (Client). |
| `src/app/program/(app)/dashboard/page.tsx` | `[edit]` no data changes; unchanged call list. Touch only if a prop signature shifts. |
| `src/app/program/(app)/layout.tsx` | `[edit]` light shell (cream bg, white header), remove the **Curriculum** nav item, widen `main` to `max-w-[1536px]`. |
| `src/components/program/program-nav.tsx` | `[edit]` active/inactive colors → new palette. |
| `src/app/program/(app)/videos/page.tsx` | `[edit]` wrap content in an explicit dark full-bleed wrapper so it keeps today's look under the light shell. |
| `src/app/program/(app)/interview/page.tsx` | `[edit]` same containment wrapper. |

**Do not touch:** `src/components/program/mission-heatmap.tsx`,
`src/components/program/curriculum-map.tsx`,
`src/app/program/(app)/curriculum/page.tsx`,
`src/app/program/(app)/day/[day]/page.tsx`, `day-shell.tsx`, `mission-panel.tsx`,
`program-leaderboard-view.tsx`, anything under `src/components/ui/`,
`prisma/schema.prisma`.

---

## 5. Server vs Client

| Component | Boundary | Notes |
| --- | --- | --- |
| `app/program/(app)/dashboard/page.tsx` | **Server** | Unchanged: `requireProgramMember()` + `Promise.all` of 5 feature calls. |
| `app/program/(app)/layout.tsx` | **Server** | ClassName-only edits + nav array. |
| `program-dashboard-view.tsx` | **Client** (`"use client"`, already) | Receives only plain serializable objects. |
| `program-module-list.tsx` | **Client** | Owns the open/closed `Set<number>` state. |
| `program-stats-panel.tsx` | **Client** | Child of a client component; owns nothing but is rendered inside the collapsible. |
| `program-nav.tsx` | **Client** (already) | `usePathname`. |

**Server → Client prop rule:** every prop crossing into
`ProgramDashboardView` is a plain object/array/string/number/boolean. Do **not**
pass `LucideIcon` references, functions, `Date` instances or Prisma model
instances across the boundary. `CurriculumDay.missionType` is a string enum — safe.
Icons are imported *inside* the client components.

---

## 6. Steps

### Step 1 — `src/features/program/progression.ts` `[edit]`

Add directly below `isSkippedPayload`:

```ts
export function isWaivedPayload(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as { waived?: unknown }).waived === true
  );
}
```

No other change in this file.

### Step 2 — `src/features/program/dashboard.ts` `[edit]`

1. Import `type CurriculumDay`, `type CurriculumModule`, `isWaivedPayload` from
   `@/features/program/progression`.
2. Extend the `MemberDashboard` type with:

```ts
  /** All 8 modules, ordered by number. */
  modules: CurriculumModule[];
  /** All 31 days with their per-member state, ordered by dayNumber. */
  days: CurriculumDay[];
  /** True when at least one non-waived day has been passed. */
  hasStarted: boolean;
  /** Lowest LOCKED day number, or null when nothing is locked. */
  nextLockedDay: number | null;
```

Keep `missionHeatmap`, `moduleProgress`, `scoreBreakdown` and every existing field
exactly as they are — other consumers and the stats panel still use them.

3. Add one query to the existing `Promise.all` (it must stay a single
   `Promise.all` — no sequential awaits), using `select` as always:

```ts
prisma.programMissionSubmission.findMany({
  where: { memberId, passed: true },
  select: { payload: true },
}),
```

4. Compute, after `getMemberDayStates` has resolved:

```ts
const hasStarted = passedRows.some((r) => !isWaivedPayload(r.payload));
const nextLockedDay =
  days.find((d) => d.state === "LOCKED")?.dayNumber ?? null;
```

5. Return `modules`, `days`, `hasStarted`, `nextLockedDay` alongside the current
   fields.

### Step 3 — `src/components/program/program-stats-panel.tsx` `[new]` (Client)

`"use client"`. Exports `ProgramStatsPanel({ data, atRisk, projects, aiRec })`
with the same prop types as the current view (import `MemberDashboard` from
`@/features/program/dashboard`). This is a **restyle + move**, not a rewrite of
logic — carry over the existing values and conditionals verbatim:

- **At-risk strip** (only when `atRisk.atRisk`) — first item in the panel.
  `rounded-[12px] border border-[#E05226] bg-[#FFECE3] px-4 py-3`,
  `AlertTriangle` 20px `#E05226`, text `#4B4B4B` 14/21.
- **Stat tiles** — `grid gap-4 sm:grid-cols-2 lg:grid-cols-5`. Small card: white,
  `rounded-[12px]`, `border border-[#E0E0E0]`, `p-5` (20px),
  `shadow-[0_2px_8px_rgba(0,0,0,0.06)]`. Label 13/18/600 uppercase `#8F8F8F`,
  value 32/36/700 `#111111` in `font-heading`. Same five tiles as today: Total
  score, Rank, Commit pts (`PROGRAM_MAX_COMMIT_POINTS`), Cohort day
  (`PROGRAM_TOTAL_DAYS`), Clean passes.
- **Score breakdown** — keep the `ScoreBar` sub-component; recolor: track
  `#E0E0E0`, fill `#E05226`, labels 14/21 `#4B4B4B`. Keep the
  `PROGRAM_COMMIT_UI_ENABLED` guard around the Commits bar and the
  `Max {PROGRAM_MAX_TOTAL_POINTS} pts` caption (12/16 `#8F8F8F`).
- **AI mentor note** (only when `aiRec.recommendation`) — standard card (24px
  padding, 12px radius), body 17/28 `#4B4B4B`, timestamp 12/16 `#8F8F8F`. Keep the
  existing `toLocaleDateString("en-IN", …)` formatting.
- **Boss Build projects** (only when `projects.length > 0`) — same rows, white
  card, score in `font-heading` `#E05226`.
- **Recent runs** (only when `data.recentVerdicts.length > 0`) — same rows;
  passed → `#2E7D32`, failed → `#C9411C`, meta `#8F8F8F`.

Vertical rhythm inside the panel: `space-y-6` (24px).

### Step 4 — `src/components/program/program-module-list.tsx` `[new]` (Client)

`"use client"`. Props:

```ts
type Props = {
  modules: CurriculumModule[];
  days: CurriculumDay[];
  /** dayNumber of the first AVAILABLE day, used to auto-open its module. */
  currentDayNumber: number | null;
};
```

Behavior:

- `const [open, setOpen] = useState<Set<number>>(...)` seeded with the module that
  contains `currentDayNumber`; if that is null, seed with the first module that
  still has an unfinished day; if all are done, seed with module 1. Modules toggle
  **independently** — more than one may be open.
- Each module renders as one card: white, `rounded-[12px]`,
  `border border-[#E0E0E0]`, `shadow-[0_2px_8px_rgba(0,0,0,0.06)]`, list spacing
  `space-y-4` (16px) between modules.
- **Header** is a `<button type="button">` filling the card width, `px-6 py-5`,
  `aria-expanded={isOpen}` + `aria-controls={panelId}`, focus ring
  `focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4`:
  - left: a 10px dot in `module.color`, then `Module {number} · {title}` in
    `font-heading` 20/26/600 `#111111`, and `{subtitle}` below at 14/21/400
    `#8F8F8F`, plus `Day {startDay}–{endDay}` as a caption 12/16 `#8F8F8F`.
  - right: `{passed}/{total} completed` 14/21 `#4B4B4B`, then the **small progress
    bar** (width `w-32`, `h-1.5`, track `#E0E0E0`, fill `#E05226`,
    `role="progressbar"` + `aria-valuenow/min/max` + `aria-label`), then a
    `ChevronDown` 20px that rotates 180° when open (`transition-transform`).
  - `passed` counts `state === "PASSED"` days of that module; `total` is that
    module's day count. Guard division by zero.
- **Panel** (`id={panelId}`, rendered only when open) — `border-t border-[#E0E0E0]`,
  day rows separated by `divide-y divide-[#E0E0E0]`, each row `px-6 py-4`,
  `flex items-center justify-between gap-4`:
  - left: `Day {dayNumber}` caption 12/16/600 uppercase `#8F8F8F`, then
    `{title}` 17/28/400 `#111111`, then a mission-type chip —
    `rounded-[4px] bg-[#FFECE3] px-2 py-0.5 text-[12px] font-semibold text-[#E05226]`
    using the same `MISSION_LABEL` map that `curriculum-map.tsx` uses (copy the map
    into this file — do **not** create a shared constants file for it).
  - right, by `state`:

    | State | Right-hand content |
    | --- | --- |
    | `AVAILABLE` | `<Link href={/program/day/N}>` styled with `buttonVariants` → **Start Challenge**, 36px (`h-9`), orange, 8px radius. |
    | `PASSED` | `CheckCircle2` 20px `#2E7D32` + `Completed` 14/21/600 `#2E7D32`, then a **View** text link (`text-[#E05226] hover:underline`) to `/program/day/N`. |
    | `SKIPPED` | `SkipForward` 20px `#8F8F8F` + `Skipped` 14/21 `#8F8F8F`, then the same **View** link. |
    | `LOCKED` | `Lock` 16px `#8F8F8F` + `Day not unlocked` 14/21 `#8F8F8F`. No link, no button, whole row at `opacity-70`. |

- Empty state (no modules): a single card with
  `The curriculum is being prepared. Check back soon.` at 17/28 `#4B4B4B`.

Buttons follow the repo rule: `buttonVariants` applied directly to `<Link>` via
`cn(...)` — never `<Button asChild>` / `<Button render={<Link>}>`.
Orange override pattern, copied from the student hub:

```ts
cn(
  buttonVariants({ variant: "default" }),
  "h-9 rounded-lg bg-[#E05226] px-4 text-sm font-semibold text-white hover:scale-100 hover:bg-[#C9411C] hover:shadow-none active:scale-100",
)
```

### Step 5 — `src/components/program/program-dashboard-view.tsx` `[edit]` (Client)

Replace the whole render tree. Props stay exactly as they are today
(`data`, `atRisk`, `projects`, `aiRec`, `interviewCard`). Delete the now-unused
`MissionHeatmap` import, `SectionIcon`/`SectionHeading`/`StatCard`/`ScoreBar`
helpers (the latter two move into the stats panel), `figmaBtn` and `cardClass`.

Root wrapper (full-bleed light surface + the ~1500px column):

```tsx
<div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#FBF9F7] px-5 py-8 font-content text-[#111111] sm:px-8">
  <div className="mx-auto w-full max-w-[1500px]">
    …
  </div>
</div>
```

Sections, top to bottom, `space-y-8` (32px) between them:

**5a. Breadcrumb** (top-left). Plain markup, no new UI primitive:

```tsx
<nav aria-label="Breadcrumb">
  <ol className="flex flex-wrap items-center gap-2 text-sm">
    <li><Link href="/dashboard" className="text-[#8F8F8F] hover:text-[#E05226]">Dashboard</Link></li>
    <li aria-hidden className="text-[#8F8F8F]">/</li>
    <li aria-current="page" className="font-semibold text-[#111111]">AI Cohort</li>
  </ol>
</nav>
```

Keep the separator as a real element so a future `Day {n}` crumb slots in
identically. Do **not** add a crumb to the Day page in this plan.

**5b. Continue / Start card** — one large card (32px padding, 16px radius, white,
`border border-[#E0E0E0]`, `shadow-[0_2px_8px_rgba(0,0,0,0.06)]`), three mutually
exclusive states driven by `data.hasStarted` and `data.currentDay`:

| Condition | Eyebrow (13/18/600 uppercase `#E05226`) | Title (`font-heading` 24/30/600) | CTA |
| --- | --- | --- | --- |
| `!hasStarted && currentDay` | `GET STARTED` | `Day {n}: {title}` | `Start Day {n}` — 48px (`h-12`) orange |
| `hasStarted && currentDay` | `CONTINUE WHERE YOU LEFT OFF` | `Day {n}: {title}` | `Continue Day {n}` — 48px orange |
| `currentDay === null` | `ALL CAUGHT UP` | `You're all caught up` | none |

For the caught-up state the supporting line is
`Day {data.nextLockedDay} unlocks soon.` when `nextLockedDay !== null`, otherwise
`You've completed all {PROGRAM_TOTAL_DAYS} days.`. CTA links to
`/program/day/{data.currentDay.dayNumber}`. Also show the mission-type chip
(same styling as the day rows) under the title when `currentDay` exists.

**5c. Modules** — section label `MODULES` (13/18/600 uppercase `#E05226`), 12px
gap to an `H2` `Your 31-day path` (`font-heading` 40/48/700, mobile 32/36), then
`<ProgramModuleList modules={data.modules} days={data.days} currentDayNumber={data.currentDay?.dayNumber ?? null} />`.

**5d. VIEW STATS collapsible** — one card matching a module card exactly (white,
12px radius, `#E0E0E0` border) so the page reads as one system. Header button with
`BarChart3` 20px + `VIEW STATS` (`font-heading` 20/26/600) + `ChevronDown` that
rotates; `aria-expanded` / `aria-controls`; **closed by default**
(`useState(false)`). Body renders `<ProgramStatsPanel … />` inside
`border-t border-[#E0E0E0] px-6 py-6`.

**5e. Mock Interview collapsible** — same card chrome, always locked:

- Header: `Mic` 20px `#8F8F8F` + `Mock Interview` (`font-heading` 20/26/600
  `#8F8F8F`) + a `Lock` 16px badge with text `Locked`
  (`rounded-[4px] bg-[#F5F5F5] px-2 py-0.5 text-[12px] font-semibold text-[#8F8F8F]`).
  It **still expands** (so the copy is reachable) but never links out.
- Body: one paragraph 17/28 `#4B4B4B` —
  `A 15-minute voice interview, scored separately from your leaderboard total.` —
  plus the state line:
  `interviewCard.state === "locked" ? interviewCard.label : "Unlocks after the program ends"`.
- No `<Link>` to `/program/interview` anywhere in this view.

**Removed from the page** (kept in the codebase): `MissionHeatmap` render, the
"Today's Mission" panel (superseded by 5b), the Voice Interview CTA, and the
"Mission control" header block.

### Step 6 — `src/app/program/(app)/layout.tsx` `[edit]` (Server)

1. `navItems` → remove the Curriculum entry, leaving
   `Dashboard`, `Videos`, `Leaderboard`. Do not delete the route.
2. Root `div`: `min-h-svh bg-[#FBF9F7] font-content text-[#111111]`.
3. `header`: `sticky top-0 z-40 border-b border-[#E0E0E0] bg-white/95 backdrop-blur`;
   inner row height 68px desktop / 64px mobile (`h-17 md:h-[68px]` → use
   `py-3 md:py-4` to land on the spec without inventing a radius/height token).
4. The `AI Cohort` wordmark: `AI` in `#E05226`, `Cohort` in `#111111`.
5. `main`: `container mx-auto` → `mx-auto w-full min-w-0 max-w-[1536px] px-4 py-6`.
   This is what lets the dashboard reach ~1500px. **Consequence to accept:** on
   viewports between 1280px and 1536px the Leaderboard and Day pages get a wider
   canvas than today; they still paint their own dark full-bleed background, so
   nothing breaks visually. If that turns out to be unwanted, the revert is to
   restore `container mx-auto` and let the dashboard cap at ~1312px.

### Step 7 — `src/components/program/program-nav.tsx` `[edit]` (Client)

Colors only — structure, `usePathname` and `isActive` stay:

- active: `bg-[#FFECE3] text-[#E05226]`
- inactive: `text-[#4B4B4B] hover:bg-[#FBF9F7] hover:text-[#111111]`
- keep `rounded-lg px-3 py-2 text-sm font-medium`.

### Step 8 — containment for the two pages that have no background of their own

`src/app/program/(app)/videos/page.tsx` and
`src/app/program/(app)/interview/page.tsx` currently inherit the layout's dark
background and `text-white`. Under the light shell they would render unreadable.
Wrap each page's existing returned JSX — **content unchanged** — in:

```tsx
<div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#040A12] px-4 py-6 text-white md:px-6">
  {/* existing JSX, untouched */}
</div>
```

This preserves exactly today's appearance for those two pages. It is deliberately
*not* a restyle — those screens get their own plan later.

---

## 7. DB safety

Not applicable — no schema change, no migration, no seed, no data backfill. Every
value the new UI shows already exists in `ProgramModule`, `ProgramDay` and
`ProgramMissionSubmission`.

---

## 8. Guardrails for Cursor (DO NOT)

- **DO NOT** delete or modify `src/components/program/mission-heatmap.tsx` — it is
  still used by `/talent/members/[id]`. The dashboard only stops rendering it.
  Likewise keep the `missionHeatmap` field on `MemberDashboard`.
- **DO NOT** delete the `/program/curriculum` route or `curriculum-map.tsx`. Only
  the nav item disappears. `/program/day/[day]` redirects to
  `/program/curriculum` for locked days and must keep working.
- **DO NOT** touch `/program/day/[day]/page.tsx`, `day-shell.tsx`,
  `day-build-steps.tsx`, `day-section-card.tsx`, `mission-panel.tsx` or
  `program-leaderboard-view.tsx` — the Day page design is out of scope.
- **DO NOT** add a breadcrumb to the Day page in this pass.
- **DO NOT** link to `/program/interview` from the dashboard. The Mock Interview
  section is locked in every interview state.
- **DO NOT** modify anything in `src/components/ui/` and do not add a new shadcn
  primitive (no `breadcrumb.tsx`, no `accordion.tsx`) — the collapsibles are plain
  `useState` + `<button aria-expanded>`.
- **DO NOT** create shared constant/util files for the mission-type label map,
  the card class strings, or the state icons. Inline them in the component that
  uses them; only the three files listed in §4 as `[new]` may be created.
- **DO NOT** introduce a new font family or new colors. Only the tokens in
  `docs/design-system.md` §2 plus `#2E7D32` for the passed/success state, which
  must be used for nothing else.
- **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>` — apply
  `buttonVariants` directly to `<Link>` (Base UI button semantics).
- **DO NOT** pass icon components, functions or class instances from the Server
  page into the Client view.
- **DO NOT** add `console.error` — use `lib/logger.ts` if logging is ever needed
  (it should not be, this is presentational).
- **DO NOT** add `any`; `CurriculumDay`/`CurriculumModule`/`MemberDashboard` are
  already exported types — import them.
- **DO NOT** touch `middleware.ts`, `auth.config.ts`, `auth.ts` or add
  `requireRole`/`requireAdmin` anywhere — `requireProgramMember()` in the layout
  and page already gates this area, and nothing here is a public surface.
- **DO NOT** turn the dashboard page into a Client Component or move its data
  fetching into an API route.
- **DO NOT** run migrations, seeds or `db:*` scripts for this change.

---

## 9. Verification

**Build / typecheck**

```bash
npm run lint
```

```bash
npm run build
```

Both must pass clean. `npm run build` runs `prisma generate` first, so the new
`MemberDashboard` fields must typecheck against the generated client.

**Manual test matrix** (`/program/dashboard`, desktop 1440px + mobile 390px):

1. **Fresh member, nothing passed** → top card reads `Start Day 1` (or the first
   AVAILABLE day). Module 1 auto-expanded. Days after the unlock ceiling show
   `Day not unlocked` with no link.
2. **Waived member** (after `db:bootstrap:program-start-day`) → Days 1–3 show
   `Completed` + working **View** links; top card reads `Start Day 4`, *not*
   `Continue`.
3. **Mid-cohort member** → top card reads `Continue Day {n}`; that day's module is
   the one auto-expanded; its row shows `Start Challenge`.
4. **Caught-up member** (passed everything currently unlocked) → card shows
   `You're all caught up` + `Day {n} unlocks soon`, no CTA.
5. **Collapsibles** → every module toggles independently; VIEW STATS is closed on
   load and opens to reveal stat cards, score breakdown, recent runs, at-risk (when
   applicable), mentor note and projects; Mock Interview shows the `Locked` badge
   and never links out.
6. **Progress bars** → each module header bar matches `{passed}/{total}`; a module
   with 0 days does not divide by zero.
7. **Not on the page anywhere:** heatmap, Curriculum nav item, Today's Mission
   panel, Voice Interview CTA.
8. **Keyboard/a11y** → Tab reaches every module header, the VIEW STATS header and
   every Start/View control; focus ring is visible orange; headers announce
   expanded/collapsed.
9. **Regression** → `/program/videos`, `/program/interview`, `/program/leaderboard`
   and `/program/day/{unlocked}` still look exactly as before; `/program/curriculum`
   still loads when typed directly; `/talent/members/{id}` still renders its
   heatmap.

**Exactly these files should show as changed** (10):

```text
src/features/program/progression.ts
src/features/program/dashboard.ts
src/components/program/program-dashboard-view.tsx
src/components/program/program-module-list.tsx        (new)
src/components/program/program-stats-panel.tsx        (new)
src/app/program/(app)/dashboard/page.tsx              (only if a prop signature changed)
src/app/program/(app)/layout.tsx
src/components/program/program-nav.tsx
src/app/program/(app)/videos/page.tsx
src/app/program/(app)/interview/page.tsx
```

Nothing under `prisma/`, `src/components/ui/`, `middleware.ts` or `src/auth*`.

---

## 10. Commit message

```text
feat(program): rebuild dashboard as collapsible module view on the new design system

- 8 collapsible modules with per-day state, Start Challenge / Completed / locked rows
- continue-or-start card driven by first unlocked day and non-waived progress
- stats (top cards, score breakdown, recent runs, at-risk, mentor note, projects)
  moved into a collapsible VIEW STATS panel
- mock interview section rendered permanently locked
- heatmap and curriculum tab hidden from the dashboard (kept in the codebase)
- /program shell restyled to the cream/orange design system
```
