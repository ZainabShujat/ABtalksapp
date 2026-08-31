# 103 — Databricks module page (078-native, local-only)

## 1. Goal

Ship a single module catalog at `/program/databricks` that looks like the AI Cohort dashboard’s module accordion (`program-module-list.tsx`), with no Videos/Leaderboard tabs. Expanding a module lists day titles from the Databricks content; every day is LOCKED (no Start/View, no day routes yet). Hidden in production via `ENABLE_DATABRICKS`.

## 2. Current behavior

- AI Cohort enrolled UI lives at `/program/ai-cohort/dashboard` with header tabs (Dashboard / Videos / Leaderboard) and `ProgramDashboardView` (Continue + modules + VIEW STATS + Mock Interview).
- Claude is a different product: hub `DashboardShell` at `/claude`.
- Legacy `ProgramModule.number` is **globally unique** — AI Cohort already occupies 1–8. Databricks has 9 modules. **Do not write Databricks into `ProgramModule` / `ProgramDay`.**
- 078 spine already exists: `ProgramCategory` → `LearningProgram` → `ProgramVersion` → `Module` → `Activity` (+ `ContentActivityConfig`). AI Cohort 078 slug is `ai-cohort-program`.
- Content JSON is ready at `prisma/content/Databricks/` (`modules.json` 9 modules, `days.json` 31 days). Videos / concept-questions / exercises / entry / rubrics stay unused this slice.
- Databricks has no legacy table, so its reads go **straight at 078** and are not gated on `ENABLE_NEW_LEARNING`.

## 3. Files to touch

See the implementation. Canonical route: `/program/databricks`. Day pages later: `/program/databricks/day/[day]`.

## 4. Guardrails

- Do not write Databricks rows to `ProgramModule` / `ProgramDay` / `ProgramMember` / `ProgramCohort`.
- Do not flip `ENABLE_NEW_LEARNING` / any `ENABLE_NEW_*` / `ENABLE_DUAL_WRITE`.
- Do not call `requireProgramMember()`.
- Do not import `@/lib/*` from `middleware.ts`.
- Do not add Videos, Leaderboard, Continue, Stats, Interview, apply, or day pages.
- Do not seed videos/concept-questions/exercises/entry/rubrics JSON.
- Do not add a hub/landing/roadmap link.
- Do not edit `CLAUDE.md` or `docs/project-context.md`.

## 5. DB safety

No Prisma schema change, no migration. Seed only. Refuse production Neon host `ep-nameless-term-ams9a5e3`. Never seed production in this plan.

## 6. Commit message

`add local-only /program/databricks module catalog on 078 LearningProgram`
