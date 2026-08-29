# 096 — Claude Challenge & Day Page Redesign

## 1. Goal

Restyle `/claude` and Claude day pages onto the hub sidebar + AI Cohort
cream/orange language, without schema changes, without restyling `/ai` `/ds`
`/se`, and with desktop sidebar collapse only on Claude routes.

## 2. Current behavior

- `/claude` renders shared `TrackPage` with `AppHeader`, heatmap, stats cards,
  quiz/recent activity, and `ClaudeFAQ`.
- Day pages live at `/challenge/[day]?challenge=` for all tracks.
- Hub `DashboardShell` is fixed `w-64` on desktop; mobile drawer only.
- 5-day window: `isWithinRelaxationWindow` + `assertPastDaySubmittable`.
- `getHeatmapData` already returns per-day status / `isRelaxable` / titles.

## 3. Decisions

| Question | Decision |
| --- | --- |
| Sidebar collapse | Claude-only via `DashboardShell collapsible`; `/dashboard` unchanged |
| Shell | Reuse hub `DashboardShell` + `DashboardFooter` |
| Day route | New `/claude/day/[day]`; redirect CLAUDE from `/challenge/[day]` |
| Heatmap / stats | Removed from Claude UI; keep heatmap code for other surfaces |
| Window closed | Label “Window closed”; View read-only; no Submit Again |

## 4. Files to touch

See implementation todos. No Prisma/schema changes.

## 5. Guardrails for Cursor (DO NOT)

- Do not edit `TrackPage` for AI/DS/SE behavior.
- Do not reimplement unlock / relaxation window in the UI.
- Do not change `submit-day.ts` backend rules.
- Do not mount `DashboardWalkthrough` on the new Claude shell.
- Do not null `AppFooter` for all `/challenge/*` (only Claude routes).
- Do not edit `CLAUDE.md` or `docs/project-context.md`.

## 6. DB safety

None — frontend/UI only.

## 7. Verification

- `/claude`: hub sidebar, no heatmap/stats/AppHeader Jobs nav
- Collapse only on Claude; `/dashboard` fixed width
- Day states match backend; View-only after window
- FAQ / recent runs / quiz history preserved
- `npx tsc --noEmit` / build pass
- CHANGELOG one convention line

## 8. Commit message

`restyle Claude Challenge onto hub shell and cream/orange day UI`
