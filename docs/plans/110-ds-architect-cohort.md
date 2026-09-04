# 110 — Data Solutions Architect Cohort (Databricks clone)

> Clone of the **live** Databricks implementation at `/program/databricks` (plan 104 as shipped, including later videos-on-day-page). Same 078 spine, rolling IST unlock, GitHub verification, enrol vs dashboard screens. **Do not generalize Databricks into a shared kit** — copy the files and swap constants/copy/content.

## 1. Goal

Ship **Data Solutions Architect** as a self-serve track at `/program/ds-architect`: enrolment form, rolling per-learner day unlock in IST, day pages with server-verified missions (`missionSpec` stored and graded), modular dashboard. Open to anyone with a completed `/register` profile. No join code, capacity, admin panel, or entry exam.

## 2. Current behavior

Databricks is already a working 078-native track. Reuse these **without editing them**:

- `src/repositories/learning.ts` — `listCurriculumForProgramSlug(slug)`, `getDayShellForProgramSlug(slug, day)`, `getActivityVerificationForDay(slug, day)` (already slug-generic; `verificationSpec` is server-only)
- `src/repositories/candidate.ts` — `updateCandidateLinks`
- `src/features/program/verify-mission.ts` — unchanged
- `src/components/program/program-module-list.tsx` / `day-shell.tsx` / `day-sidebar.tsx` / `program-day-client.tsx` — already take `basePath`

Content to seed (read-only; **do not edit JSON**):

| File | Used? |
|---|---|
| `prisma/content/Data-Sol-Architect/modules.json` | yes — 7 modules |
| `prisma/content/Data-Sol-Architect/days.json` | yes — 10 days; **full `missionSpec` → `Activity.verificationSpec`** |
| `prisma/content/Data-Sol-Architect/videos.json` | yes — seed VIDEO activities like Databricks; render on the day page when present |
| concept-questions / exercises / entry-questions / rubrics | **no** — seeded-but-unread later, same as Databricks |

Curriculum facts (from JSON, do not hard-code a flat 12 pts/day):

- 10 days, 7 modules
- Day 1 `DATA_ROOM` (10 pts); days 2–8 `SHIP_IT` (15/15/15/15/20/15/15); days 9–10 `SHIP_IT` + `isProjectDay` (25 + 30)
- **Max points = 175**
- Day 1 `missionSpec` also has `repoChecks`. `verifyMission` for `DATA_ROOM` grades **answers only** (Databricks Day 1 has no repoChecks). Store the full spec anyway. In the DSA mission-state mapper, attach `shipItHints` **only when `missionType === SHIP_IT`** so Day 1 does not advertise GitHub file checks that will not run. Days 2–10 run answers + repo file-existence (`SHIP_IT_CONTENT_CHECKS` stays false — do not flip it).

## 3. Files to touch

See the implementation. Canonical route: `/program/ds-architect`. Day pages: `/program/ds-architect/day/[day]`.

## 4. Server vs Client

Same split as Databricks. Every `src/features/ds-architect/*` file except `constants.ts` starts with `import "server-only"`. `constants.ts` has neither directive.

**Nothing from `missionSpec` / `verificationSpec` crosses to the client.** Only `shipItHints` (SHIP_IT days) and `dataRoomQuestionCount` plus `parseBriefMd(briefMd).submitQuestions`. Dates as ISO strings / pre-formatted labels. `basePath="/program/ds-architect"` as a string prop.

## 5. Steps

Clone Databricks files, substituting slugs/copy/constants as specified in the Cursor plan. Seed from `prisma/content/Data-Sol-Architect` only (modules, days including `missionSpec`, videos). Gate with `ENABLE_DS_ARCHITECT`.

## 6. Guardrails for Cursor (DO NOT)

- DO NOT edit Databricks files, `verify-mission.ts`, `SHIP_IT_CONTENT_CHECKS`, Prisma schema, or add a migration.
- DO NOT write DSA rows to `ProgramMember` / `ProgramCohort` / `ProgramModule` / `ProgramDay` / `ProgramMissionSubmission`.
- DO NOT call `dualWrite*`, `requireProgramMember()`, `resolveProgramMemberForUser()`, or any `ENABLE_NEW_*` / `ENABLE_DUAL_WRITE` branch.
- DO NOT prefix 078 ids with `pe_` / `aa_`. Activity ids must be `act_dsa_day_*` / `act_dsa_vid_*` only.
- DO NOT hard-code `"Asia/Kolkata"` outside the seed timezone field — application code reads `DS_ARCHITECT_TZ`.
- DO NOT import `@/lib/*` into `middleware.ts`.
- DO NOT pass `missionSpec` / `verificationSpec` to a client component.
- DO NOT seed or read concept-questions / exercises / entry-questions / rubrics.
- DO NOT add Videos/Leaderboard routes or header tabs. Do NOT make Mock Interview functional.
- DO NOT block learners for being behind pace. Do NOT edit Data-Sol-Architect JSON.
- DO NOT create a shared “open cohort” abstraction. DO NOT create files this plan does not list.
- DO NOT use `<Button asChild>`. DO NOT `console.error` — use `lib/logger.ts`.
- DO NOT edit `CLAUDE.md` or `docs/project-context.md`.

## 7. DB safety

No schema change. Seed only.

Before any seed: Neon **child branch from production**; target that child only (branch id or child connection string). Refuse production host `ep-nameless-term-ams9a5e3` unless the user later explicitly authorizes `SEED_ALLOW_PRODUCTION=true` in that request. This plan does **not** pre-authorize production.

```bash
npm run db:seed:ds-architect
```

Expect `7 | 10 | ENROLLING` for modules / `act_dsa_day_%` activities / `ds-architect-open` cohort status.

## 8. Verification

```bash
npx prisma generate && npm run build && npm run lint
```

Unenrolled + profile → enrol hero + locked modules + Register form. Enrolled → dashboard. Flag unset → 404.

## 9. Commit message

```
feat(ds-architect): 078-native Data Solutions Architect cohort at /program/ds-architect

Clones the Databricks track onto a 10-day AWS architecture cohort seeded from
prisma/content/Data-Sol-Architect (modules, days.missionSpec, videos), with
rolling IST unlock, GitHub verification, and enrol vs dashboard screens.
```
