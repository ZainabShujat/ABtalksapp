# 079 — Dashboard large-screen width

## 1. Goal

On 1600px+ viewports, hub content grows into the main column. 1280–1440 laptop layout stays as it is. Sidebar, style, and behavior stay unchanged.

## 2. Current behavior

`DashboardShell` is already fluid (`flex-1 min-w-0`). The leftover right space came from `max-w-[1020px]` on the hero + activity wrapper in `src/app/dashboard/page.tsx`. Continue cards used a fixed `sm:w-[300px]` snap row. Challenge Tracks already used `sm:grid-cols-3` with no max-width.

## 3. Files to touch

- `src/app/dashboard/page.tsx` [edit] — raise inner max-width at 2xl; Activity/Streak columns at 2xl
- `src/components/dashboard-hub/continue-journey.tsx` [edit] — 3-col fluid grid at 2xl
- `src/components/dashboard-hub/roadmaps.tsx` [edit] — 3-col minmax + 2xl max-width on tracks and Prep Kit
- `docs/plans/079-dashboard-large-screen-width.md` [new]

## 4. Server vs Client

- `dashboard/page.tsx` — Server
- `continue-journey.tsx` / `roadmaps.tsx` — Server (no new client boundary)

## 5. Steps

1. Hero wrapper: `w-full max-w-[1020px] lg:ml-5 2xl:mx-auto 2xl:max-w-[1600px]`. Grid: keep `lg:grid-cols-[1fr_320px]`, add `2xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]`.
2. Continue: snap row below 2xl; at 2xl `grid grid-cols-3`, cards `w-full`.
3. Tracks: `2xl:grid-cols-[repeat(3,minmax(0,1fr))]`. Sections: `2xl:mx-auto 2xl:max-w-[1600px]` only (no 1020 cap).

## 6. Guardrails for Cursor (DO NOT)

- Do not change sidebar, colors, type, or `HUB_*` classes.
- Do not add `max-w-[1020px]` to Continue/Tracks/FAQ.
- Do not restyle mobile / `sm` / `lg` except additive `2xl:` classes.
- Do not edit `CLAUDE.md` / `project-context.md`.
- Do not touch Prisma, APIs, or auth.

## 7. Verification

| Viewport | Expected |
| --- | --- |
| 1280 / 1366 / 1440 | Same as today (1020 cap still active) |
| 1600 | Hero/activity start growing; Continue becomes 3 equal columns |
| 1920 | No large empty right gutter; activity expanded, streak ~320–360 |
| 2560 | Content capped at 1600 and centered |

## 8. Commit message

`fix(dashboard): use extra width on large desktops without changing laptop layout`
