# 077 — Hub calendar-day streak card

## 1. Goal

Upgrade the `/dashboard` hero streak card into a real calendar-day streak
system computed server-side from the same IST submission activity as the
heatmap. Heatmap stays an independent sibling. Challenge `dayNumber` streaks
on track pages stay unchanged. No schema change.

## 2. Current behavior

`/dashboard` already places `ActivityHeatmap` and `StreakCard` side by side
in `src/app/dashboard/page.tsx` (`lg:grid-cols-[1fr_320px]`, `max-w-[1020px]`,
`lg:items-center`).

Gaps:

- Card numbers are `Math.max` of `Enrollment.currentStreak` / `longestStreak`
  (challenge `dayNumber` runs). Weekly ticks are IST calendar days from
  `submittedAt`. Those can disagree after backfills or missed calendar days.
- No streak-broken UI. Current `0` is just “0 days”.
- Week ticks are boolean only — cannot mark the missed day that broke the
  run, today, or future days.
- Copy and milestones are static. Milestones skip 3; no singular/plural;
  no empty / at-risk / broken messages.
- Hero is `max-w-[1020px]` with extra column padding, so the pair sits in a
  narrow left block on 1920px and the streak is vertically centered.

Hub “active day” is already defined in `get-activity-heatmap.ts`: ≥1
`Submission` whose `submittedAt` falls on that IST calendar date, across all
enrollments. Multiple submissions on one IST day already collapse to one cell.

## 3. Files to touch

- `src/features/dashboard/compute-activity-streak.ts` [new] — pure stats +
  week statuses + `STREAK_MILESTONES`
- `src/features/dashboard/get-activity-heatmap.ts` [edit] — attach `streak`;
  drop `weekTicks: boolean[]`
- `src/features/dashboard/get-hub-data.ts` [edit] — `streak` from heatmap
  helper; keep enrollment streaks only on `HubEnrollment`
- `src/components/dashboard-hub/streak-card.tsx` [edit] — full UI
- `src/components/dashboard-hub/streak-ring.tsx` [new] — tiny `"use client"`
  ring animation
- `src/app/dashboard/page.tsx` [edit] — layout + pass streak DTO + CTA href
- `src/components/dashboard-hub/activity-heatmap.tsx` [edit] — drop min-height
  stretch only
- `docs/CHANGELOG.md` [edit] — one Pending reconcile line
- `docs/plans/077-hub-activity-streak.md` [new] — this plan

## 4. Server vs Client

- `computeActivityStreak` / `getActivityHeatmap` / `getHubData` — server
- `StreakCard` — Server Component; receives compact DTO + `restartHref`
- `StreakRing` — Client (one-shot stroke animation, `motion-safe`)
- `ActivityHeatmap` — Client (unchanged except min-height)
- `DashboardPage` — Server; no functions/icons across the boundary

## 5. Steps

1. Add `computeActivityStreak(countByDate, todayKey)`:
   - Active day = count > 0; ignore keys `> todayKey`; duplicates already
     collapsed by the map.
   - Current streak: walk back from today if today is active, else from
     yesterday if yesterday is active (grace), else 0.
   - Longest: max consecutive run over all distinct active keys.
   - Milestones `[3, 7, 14, 30, 60, 100]`; next = first `> current`, else 100.
   - State: `empty` / `broken` / `active`.
   - Week Mon–Sun: `complete` | `future` | `today` | `broken` | `idle`.
     One `broken` day: the first gap after the previous live run, if it
     falls in the current IST week.
2. Call it from `getActivityHeatmap` (same `countByDate`, no extra query).
   Drop `weekTicks`. `getHubData` copies `heatmap.streak` and stops using
   enrollment max for the hub card.
3. Rebuild `StreakCard` (header, ring, weekly, stats, milestone) +
   `StreakRing`. White card, hub tokens, derived copy, `formatDayCount`,
   `Start again →` to first ACTIVE track else `/challenges`.
4. Hero layout: `max-w-6xl`, stack by default, `xl:grid-cols-[minmax(0,1fr)_18rem]
   xl:items-start`, drop extra column padding and heatmap `lg:min-h-[350px]`.
5. Changelog one-liner. Typecheck + build.

## 6. Guardrails for Cursor (DO NOT)

- Do not add a Streak table, migration, or denormalized hub-streak columns.
- Do not change `computeStreakStats`, submit/reject paths, or track-page stats.
- Do not fetch submissions to the client.
- Do not restyle or replace `ActivityHeatmap` (colors, 4-month window, cell grid).
- Do not put the streak card inside the heatmap.
- Do not use `lg:grid-cols` two-column (too tight with sidebar); two-column
  starts at `xl`.
- Do not add celebration/pulse animations or new font/color tokens.
- Do not import `@/lib/*` into middleware.
- Do not edit `CLAUDE.md` or `docs/project-context.md`.
- Do not touch landing, program dashboard, or auth.

## 7. DB safety

None. No schema or data mutation.

## 8. Verification

- Empty user: all zeros, empty week, start copy, next milestone 3.
- One active day today: current 1, today checked.
- Mon–Thu complete, Friday missed, Saturday today not done: `STREAK BROKEN`,
  Friday X, current 0, longest preserved, “Start again →”.
- Same gap then Saturday submit: current 1, Friday still X, not in broken
  card state.
- Today incomplete after yesterday complete: current still > 0, today
  outlined, keep-alive copy.
- Two submissions one IST day: one active day.
- `1 day` vs `2 days`.
- Stacked layout < xl; two-column at 1366 and 1920; no page horizontal scroll.
- `npx tsc --noEmit` and `npm run build` pass.
- Files changed: only the list in §3.

## 9. Commit message

`feat(dashboard): calendar-day hub streak card beside the activity heatmap`
