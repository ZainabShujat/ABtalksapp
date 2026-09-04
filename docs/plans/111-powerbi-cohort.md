# 111 — Power BI & Analytics Cohort (Databricks / DS-Architect clone)

> Third instance of the same open-cohort shape shipped as plan 104 (Databricks) and
> plan 110 (Data Solutions Architect). Same 078 spine, rolling IST unlock, GitHub
> verification, enrol-vs-dashboard screens. **Do not generalize the three into a
> shared kit** — copy the files and swap constants / copy / content.

## 1. Goal

Ship **Power BI & Analytics** as a self-serve track at `/program/powerbi`:
enrolment form, rolling per-learner day unlock in IST, day pages with
server-verified missions (`missionSpec` stored and graded), modular dashboard.
Open to anyone with a completed `/register` profile. No join code, capacity,
admin panel, or entry exam.

## 2. Current behavior

Databricks and DS-Architect are working 078-native tracks. Reuse these **without
editing them**:

- `src/repositories/learning.ts` — `listCurriculumForProgramSlug(slug)`,
  `getDayShellForProgramSlug(slug, day)`, `getActivityVerificationForDay(slug, day)`
  (already slug-generic; `verificationSpec` is server-only, and the day-shell
  video mapper already drops rows whose `videoRef` is null)
- `src/repositories/candidate.ts` — `getProfileSummary`, `updateCandidateLinks`
- `src/features/program/verify-mission.ts` — unchanged
- `src/features/program/parse-brief.ts` — unchanged
- `src/components/program/program-module-list.tsx` / `program-day-client.tsx` /
  `day-section-card.tsx` / `day-build-steps.tsx` — already take `basePath`

Content to seed (read-only; **do not edit JSON**):

| File | Used? |
|---|---|
| `prisma/content/powerbi-cohort/modules.json` | yes — 6 modules |
| `prisma/content/powerbi-cohort/days.json` | yes — 7 days; **full `missionSpec` → `Activity.verificationSpec`** |
| `prisma/content/powerbi-cohort/videos.json` | yes — seed VIDEO activities; every `youtubeId` is currently `null`, so nothing renders until they are curated |
| concept-questions / exercises / entry-questions / rubrics | **no** — seeded-but-unread later, same as the other two tracks |

Curriculum facts (from JSON, do not hard-code a flat 15 pts/day):

- 7 days, 6 modules (module 6 spans days 6–7)
- Day 1 `DATA_ROOM` (10 pts); days 2–5 `SHIP_IT` (15 each); days 6–7 `SHIP_IT`
  + `isProjectDay` (25 + 30)
- **Max points = 125**
- Day 1 `missionSpec` also carries `repoChecks`. `verifyMission` for `DATA_ROOM`
  grades **answers only**. Store the full spec anyway. In the mission-state
  mapper, attach `shipItHints` **only when `missionType === SHIP_IT`** so Day 1
  does not advertise GitHub file checks that will not run. Days 2–7 run answers +
  repo file-existence (`SHIP_IT_CONTENT_CHECKS` stays false — do not flip it).
- Every day's `briefMd` has `## Mission:`, `### Build steps` and
  `### Submit your answers` (3 questions each). None has `### Your repo layout`,
  so that card simply does not render.

## 3. Files to touch

**New**

| Path | Note |
|---|---|
| `prisma/seed-powerbi.ts` | `[new]` seed program/version/modules/day+video activities/cohort |
| `src/features/powerbi/constants.ts` | `[new]` base path, slugs, 7 days, IST, 125 pts, run limits |
| `src/features/powerbi/progression.ts` | `[new]` IST anchor, unlock keys, day state, lateness |
| `src/features/powerbi/enroll.ts` | `[new]` entry state + enrolment write |
| `src/features/powerbi/days.ts` | `[new]` day shell + state |
| `src/features/powerbi/dashboard.ts` | `[new]` dashboard aggregate |
| `src/features/powerbi/missions.ts` | `[new]` mission state + submit run |
| `src/repositories/powerbi.ts` | `[new]` 078 reads/writes scoped to `act_pbi_day_*` |
| `src/lib/validations/powerbi.ts` | `[new]` zod enrol + mission schemas |
| `src/app/actions/powerbi-actions.ts` | `[new]` two server actions |
| `src/app/program/powerbi/layout.tsx` | `[new]` flag gate + light shell |
| `src/app/program/powerbi/page.tsx` | `[new]` enrol screen vs dashboard |
| `src/app/program/powerbi/day/[day]/page.tsx` | `[new]` day page |
| `src/components/powerbi/powerbi-enrol-hero.tsx` | `[new]` hero, uses `/powerbi-cohort/powerbi-hero.png` |
| `src/components/powerbi/powerbi-enroll-form.tsx` | `[new]` client enrol form |
| `src/components/powerbi/powerbi-dashboard-view.tsx` | `[new]` client dashboard |
| `src/components/powerbi/powerbi-stats-panel.tsx` | `[new]` client stats |
| `src/components/powerbi/powerbi-mission-panel.tsx` | `[new]` client verify panel |
| `docs/plans/111-powerbi-cohort.md` | `[new]` this file |

**Edited**

| Path | Note |
|---|---|
| `src/lib/feature-flags.ts` | `[edit]` add `isPowerBiEnabled()` |
| `middleware.ts` | `[edit]` add `/program/powerbi` to `protectedPaths` (no `@/lib/*` import) |
| `package.json` | `[edit]` add `db:seed:powerbi` |
| `.env.example` | `[edit]` document `ENABLE_POWERBI` |
| `src/features/dashboard/get-hub-data.ts` | `[edit]` `hasPowerBiAccess` |
| `src/features/dashboard/hub-search-index.ts` | `[edit]` Prep Kit search entry |
| `src/app/dashboard/page.tsx` | `[edit]` pass the flag through |
| `src/components/dashboard-hub/roadmaps.tsx` | `[edit]` 4th Prep Kit card + responsive grid |
| `src/repositories/progress.ts` | `[edit]` count `act_pbi_day_*` attempts in the hub heatmap |
| `docs/CHANGELOG.md` | `[edit]` one Pending-reconcile line |

**Deliberately NOT touched: `src/components/not-found/not-found-view.tsx`.**
The 404 page renders a hard-coded 2×2 of `KEYCAPS[0]`–`KEYCAPS[3]`, not a
`.map()` over the array. It already holds 5 entries, so `Workshops` at index 4
is dead config that never renders (it fell off when plan 110 inserted
DS-Architect at index 1). Appending a Power BI keycap would push
`CLAUDE CHALLENGE` out of the rendered four as a silent side effect. Adding one
means first making that grid render its array — a separate change, out of scope
here.

## 4. Server vs Client

Same split as the other two tracks. Every `src/features/powerbi/*` file except
`constants.ts` starts with `import "server-only"`. `constants.ts` has neither
directive (it is imported by the client mission panel and by zod validations).

Client components: `powerbi-dashboard-view`, `powerbi-stats-panel`,
`powerbi-mission-panel`, `powerbi-enroll-form`. Everything else is a Server
Component.

**Nothing from `missionSpec` / `verificationSpec` crosses to the client.** Only
`shipItHints` (SHIP_IT days) and `dataRoomQuestionCount`, plus
`parseBriefMd(briefMd).submitQuestions`. Dates as ISO strings / pre-formatted
labels. `basePath="/program/powerbi"` as a string prop.

## 5. Steps

1. `prisma/seed-powerbi.ts` — clone `seed-ds-architect.ts`; `CONTENT_DIR` →
   `prisma/content/powerbi-cohort`, `PROGRAM_SLUG` → `powerbi`, `COHORT_SLUG` →
   `powerbi-open`, activity ids `act_pbi_day_NN` / `act_pbi_vid_NN_NN`,
   `plannedDurationDays: 7`, `sortOrder: 40`, `colorToken: "powerbi"`,
   `timezone: "Asia/Kolkata"`. `VideoJson.youtubeId` is `string | null` here —
   the JSON ships nulls; write them through to the nullable
   `ContentActivityConfig.videoRef` and let the day-shell reader skip them.
   Keep the production-host guard.
2. `src/features/powerbi/constants.ts` — 7 days, 125 max points, `POWERBI_TZ`.
3. `progression.ts`, `days.ts`, `enroll.ts`, `dashboard.ts`, `missions.ts` —
   one-for-one clones with the `POWERBI_*` constants. `dashboard.ts` narrows
   `totalDays: 7` / `maxMissionPoints: 125` as literal types.
4. `src/repositories/powerbi.ts` — clone with `PBI_DAY_ACTIVITY_PREFIX =
   "act_pbi_day_"`.
5. `src/lib/validations/powerbi.ts` — same shape; day max = 7.
6. Actions, routes, components — clones with Power BI copy and the hero image.
7. Wiring edits from the table above.
8. Prep Kit grid becomes `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` so the
   fourth card wraps to its own row on narrow screens and sits inline on wide
   ones. No horizontal scroll container anywhere.

## 6. Guardrails for Cursor (DO NOT)

- DO NOT edit Databricks or DS-Architect files, `verify-mission.ts`,
  `parse-brief.ts`, `SHIP_IT_CONTENT_CHECKS`, `prisma/schema.prisma`, or add a
  migration.
- DO NOT write Power BI rows to `ProgramMember` / `ProgramCohort` /
  `ProgramModule` / `ProgramDay` / `ProgramMissionSubmission`.
- DO NOT call `dualWrite*`, `requireProgramMember()`,
  `resolveProgramMemberForUser()`, or any `ENABLE_NEW_*` / `ENABLE_DUAL_WRITE`
  branch.
- DO NOT prefix 078 ids with `pe_` / `aa_`. Activity ids must be
  `act_pbi_day_*` / `act_pbi_vid_*` only.
- DO NOT hard-code `"Asia/Kolkata"` outside the seed timezone field —
  application code reads `POWERBI_TZ`.
- DO NOT import `@/lib/*` into `middleware.ts`.
- DO NOT pass `missionSpec` / `verificationSpec` to a client component.
- DO NOT seed or read concept-questions / exercises / entry-questions / rubrics.
- DO NOT add Videos/Leaderboard routes or header tabs. Do NOT make Mock
  Interview functional.
- DO NOT block learners for being behind pace. Do NOT edit the powerbi-cohort
  JSON.
- DO NOT create a shared "open cohort" abstraction. DO NOT create files this
  plan does not list.
- DO NOT use `<Button asChild>`. DO NOT `console.error` — use `lib/logger.ts`.
- DO NOT make the Prep Kit row horizontally scrollable.

## 7. DB safety

No schema change. Seed only.

Before any seed: Neon **child branch from production**; target that child only
(branch id or child connection string). Refuse production host
`ep-nameless-term-ams9a5e3` unless the user later explicitly authorizes
`SEED_ALLOW_PRODUCTION=true` in that request. This plan does **not**
pre-authorize production.

```bash
npm run db:seed:powerbi
```

Expect `6 | 7 | 14 | ENROLLING` for modules / `act_pbi_day_%` activities /
`act_pbi_vid_%` activities / `powerbi-open` cohort status.

## 8. Verification

```bash
npx prisma generate && npm run build && npm run lint
```

- `ENABLE_POWERBI` unset → `/program/powerbi` 404s and the Prep Kit card is
  hidden.
- Flag on, unenrolled + profile → enrol hero + locked module list + Register
  form.
- Flag on, enrolled → dashboard, Day 1 available, Days 2–7 locked.
- Prep Kit at 4 cards: one column on mobile, two at `sm`, three at `lg`, four at
  `xl`. No horizontal scrollbar at any width.

## 9. Commit message

```
feat(powerbi): 078-native Power BI & Analytics cohort at /program/powerbi

Clones the DS-Architect track onto a 7-day Power BI recruitment cohort seeded
from prisma/content/powerbi-cohort (modules, days.missionSpec, videos), with
rolling IST unlock, GitHub verification, and enrol vs dashboard screens. The
Prep Kit row grows to four cards and wraps by breakpoint instead of scrolling.
```
