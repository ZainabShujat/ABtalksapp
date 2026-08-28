# 074 — Landing page from dev onto student-dashboard

## 1. Goal

Put `dev`'s new landing hub design on `feature/student-dashboard` without changing student dashboard, program/cohort, day pages, or multi-enrollment wiring.

## 2. Current behavior

- `src/app/page.tsx` is identical on both branches (`getLandingState` → `<LandingHub />`).
- On `feature/student-dashboard`, `landing-hub.tsx` is the older track-card / waitlist hub.
- On `dev`, the same file composes `src/components/landing/hub/*` plus `public/landing/` assets and local fonts under `src/fonts/`.
- Dashboard depends on `--font-jakarta` / `--font-fredoka`; root layout mounts `NotificationProvider`. Taking `dev`'s `layout.tsx` wholesale would drop both.

## 3. Files to touch

- `[overwrite]` `src/components/landing/landing-hub.tsx` — from `dev`
- `[new]` `src/components/landing/hub/**` — from `dev`
- `[new]` `src/components/landing/testimonials-data.ts` — from `dev`
- `[new]` `public/landing/**` — from `dev`
- `[new]` `src/fonts/**` — from `dev`
- `[edit]` `src/app/layout.tsx` — hand-merge hub local fonts + keep NotificationProvider + jakarta/fredoka
- `[edit]` `src/app/globals.css` — hand-merge hub tokens + keep heading/display tokens

## 4. Server vs Client

- `src/app/page.tsx` — Server (unchanged)
- `landing-hub.tsx` and `hub/*` — mix per file; props from page remain `claudeEnabled`, `state`

## 5. Steps

1. Confirm on `feature/student-dashboard`.
2. `git checkout dev --` landing paths (hub, assets, fonts).
3. Hand-merge `layout.tsx` and `globals.css`.
4. Typecheck/build; smoke-test `/`, `/dashboard`, program day, track route.
5. Append one CHANGELOG line under `## Pending reconcile`.

## 6. Guardrails for Cursor (DO NOT)

- Do not `git merge dev` or reset this branch onto `dev`.
- Do not overwrite `layout.tsx` / `globals.css` with `dev` versions wholesale.
- Do not change middleware, enrollment, dashboard-hub, program day components, or notification wiring.
- Do not bring `modernist/` into the live homepage.
- Do not edit `CLAUDE.md` or `docs/project-context.md`.
- Do not delete unused old landing files (`waitlist-track-card.tsx`, etc.) in this pass.

## 7. DB safety

None — no schema or data changes.

## 8. Verification

- `npx tsc --noEmit` and `npm run build` pass.
- `/` shows new hub (bridge / how-it-works / hub CSS).
- `/dashboard`, program day, enrollment/track pages unchanged in behavior.

## 9. Commit message

```
Bring new landing hub from dev onto student-dashboard.

Selective path checkout of hub UI, assets, and fonts; hand-merge root layout fonts while keeping NotificationProvider and dashboard typography.
```
