# 079 — Interview Agent × `abtalks/2.0` Integration (Migration Plan)

> **Status:** Plan only. No code, schema, migration or dependency has been
> changed by this document.
> **Compared:** local `interview-agent` (HEAD `1bdb570`) against
> `upstream/abtalks/2.0` (`0de8453`), merge-base `f610df0`.
> **Scope guard:** the interview design, the report, and the question bank are
> explicitly OUT of scope. No unrelated UI/UX work.

---

## 1. Goal

Make the cohort interview agent run unchanged on top of the plan-078 platform
data architecture that `abtalks/2.0` introduces, by (a) routing its legacy-table
reads through the new `src/repositories` seam, and (b) making the one identity
assumption it holds — "a member id is a `ProgramMember.id`" — survive the
`ENABLE_NEW_LEARNING` cutover. Everything else about the agent stays as built.

---

## 2. What `abtalks/2.0` actually changed

42 commits, 217 files, +24,409/−2,350. Two independent workstreams landed on one
branch. Both matter to us, for different reasons.

### 2.1 Workstream A — plan 078 platform data architecture (the architectural change)

Documented in `docs/plans/078-platform-data-architecture-redesign.md` and
`docs/plans/078-sample-validation-and-rollout.md`. Phases 1–5 are in code.

| # | Change | Shape |
|---|---|---|
| A1 | **New unified learning spine**, additive alongside legacy: `LearningProgram → ProgramVersion → Cohort → Module → Activity`, with `ProgramEnrollment → ActivityAttempt → ActivityEvaluation → EnrollmentProgress / EnrollmentDayActivity`. | 49 new models, 30 new enums, +1,314 lines of `schema.prisma`. |
| A2 | **Canonical candidate identity**: `CandidateProfile` (+ `CandidateVisibility`, Education/Experience/Project/Certification/Preference, `Skill`/`CandidateSkill`/`SkillEvidence`) replacing the five duplicate identity stores. | New models. |
| A3 | **Credentials / points / talent / assessment**: `Credential`, `PointsAccount` + `PointsTransaction`, `Organization` + `TalentList` + `TalentListItem`, and `AssessmentReport` + `AssessmentScore` + `AssessmentReportShare`. | New models. |
| A4 | **Repository seam.** `src/repositories/*` is now the only sanctioned data access for the migrated domains. Features no longer call `prisma.programMember` / `prisma.studentProfile` directly — they import `programMember` / `studentProfile` from `src/repositories/legacy/*`. Real repository functions (`getCandidateProfile`, `findActiveMembership`, `listChallengeEnrollments`, `getDashboardPrograms`, `searchCandidates`, `getBalance`, `getByPublicId`) branch on a flag: new tables when on, legacy when off. | 13 new files under `src/repositories/`. 33 existing feature files rewritten to use them — including `src/features/program/interview.ts`. |
| A5 | **Feature flags** `ENABLE_NEW_CANDIDATE`, `ENABLE_NEW_LEARNING`, `ENABLE_NEW_PROGRESS`, `ENABLE_NEW_TALENT`, `ENABLE_NEW_POINTS`, `ENABLE_NEW_CREDENTIAL`, `ENABLE_DUAL_WRITE` — **all default off.** Legacy tables are still authoritative today. | `src/lib/feature-flags.ts`. |
| A6 | **Dual-write + audit + drift**: `src/repositories/dual-write.ts` (savepoint-wrapped, failure-tolerant), `MigrationRun` / `MigrationConflict` / `MigrationQuarantine`, `/api/cron/078-drift`, 9 `prisma/scripts/migrate-2*.ts` backfills and 4 `check-078-*` verifiers. | Additive. |
| A7 | **Delete-safety**: `Certificate.userId`, `SynergyEvent.userId`, `RecruiterShortlistItem.memberId` moved Cascade → `Restrict`; actor FKs (`Job.createdByAdminId`, `HackathonRemoval.removedByUserId`, `RecruiterProfile.approvedByAdminId`, `Notification.createdByAdminId`) → `SetNull`; `User.deletedAt` / `User.anonymizedAt` added. | `20260820120000_platform_data_architecture_phase1`. |

**Nothing legacy was deleted.** `ProgramMember`, `ProgramMissionSubmission`,
`ProgramProject`, `ProgramInterview`, `StudentProfile`, `Enrollment`,
`Submission`, `RecruiterReview` all still exist with the same columns. This is
the single most important fact for us: **2.0 is additive, and the cutover has
not happened.** The rollout doc is explicit — `ENABLE_NEW_*` stay off until two
clean Phase-5 rehearsal passes on a fresh Neon child, 24h apart.

### 2.2 Workstream B — design system / dashboard / landing (not architectural, but it collides)

- `src/components/program/program-dashboard-view.tsx` **rebuilt** (−400/+186) into
  a cream/orange collapsible module view. This is where our interview card lives.
- New `src/components/dashboard-hub/*` (17 files) + `src/features/dashboard/get-hub-data.ts`
  for the student dashboard hub; `src/app/dashboard/page.tsx` rewritten.
- Landing rebuilt as `src/components/landing/site/*`; **`src/components/landing/landing-hub.tsx` deleted** — "previous hub landing retired".
- New track pages `/ai`, `/ds`, `/se`, `/claude` + a middleware fix so those
  exact paths are protected without capturing `/ai-workshop`, `/ai-cohort-*`, `/claude-signup`.
- New candidate signup flow, nav dropdown, `gsap` dependency.

### 2.3 One entry in `docs/CHANGELOG.md` that concerns us directly

> `2026-08-18 [schema] Reverted PR #168 AI cohort interview foundation from master (code + unused 20260813000000 migration file; do not apply/drop that schema on production)`

and, in the rollout doc:

> "Apply Phase 1 SQL + Phase 2 audit SQL via `prisma db execute` (do not
> `migrate deploy` — **production has leftover `20260813000000_general_interview`**)"

So: our first migration's *row* exists in production `_prisma_migrations` while
its *tables do not*, and the file was removed from master. Re-introducing it via
this branch is correct, but the production apply path is not a plain
`migrate deploy`. See §8.

---

## 3. What the interview agent depends on that 2.0 changes

The agent is **93 new files** and is otherwise self-contained. Its coupling to
the old architecture is narrow and enumerable — 13 Prisma call sites across 7
files, plus one identity assumption and one UI mount point.

### 3.1 Direct legacy-table reads (must move behind the repository seam — A4)

| File | Line | Call | 2.0 replacement |
|---|---|---|---|
| `src/features/interview/provider.ts` | 44 | `prisma.programMember.findFirst` | `programMember` from `@/repositories/legacy/program-member` — **plus** the peId bridge (§3.2) |
| `src/features/interview/cohort/candidate-context.ts` | 121 | `prisma.programMember.findUnique` | `@/repositories/legacy/program-member` |
| `src/features/interview/cohort/candidate-context.ts` | 132 | `prisma.programMissionSubmission.findMany` | no shim yet — leave on `prisma`, note in §5.2 |
| `src/features/interview/cohort/candidate-context.ts` | 143 | `prisma.programProject.findMany` | no shim yet — leave on `prisma` |
| `src/features/interview/cohort-eligibility.ts` | 77, 130 | `prisma.programMissionSubmission.findMany` | no shim yet — leave on `prisma` |
| `src/features/interview/candidate-context.ts` | 15 | `prisma.studentProfile.findUnique` | `getCandidateProfile()` from `@/repositories/candidate` |
| `src/features/interview/resume-context.ts` | 26 | `prisma.studentProfile.findUnique` | `getCandidateProfile()` |
| `src/features/interview/resume-context.ts` | 30 | `prisma.recruiterReview.findUnique` | no shim yet — leave on `prisma` |
| `src/features/interview/challenge-context.ts` | 78 | `prisma.enrollment.findMany` | `listChallengeEnrollments()` from `@/repositories/learning` **if** the selected fields match; otherwise leave |
| `src/features/interview/challenge-context.ts` | 90 | `prisma.submission.findMany` | no shim yet — leave on `prisma` |
| `src/features/interview/read-model.ts` | 149, 173 | `prisma.programInterview.*` | unchanged — legacy `ProgramInterview` is untouched by 2.0 |

`prisma.generalInterview` (16 sites), `prisma.interviewTurn` (3), `prisma.interviewReport` (2)
are **our own tables** and stay on `prisma` directly. 2.0's seam only covers the
domains it migrated.

### 3.2 The one real breakage: member identity

`GeneralInterview.memberId` is an FK to `ProgramMember.id`. Every interview
action resolves that id, today, from `ProgramMember`.

2.0 rewrote `resolveProgramMemberForUser()` in `src/lib/program-auth.ts` to
delegate to `findActiveMembership()` in `src/repositories/learning.ts`. Under
`ENABLE_NEW_LEARNING=true` that function returns:

```ts
member: { id: pe.id, ... }   // ← a ProgramEnrollment id, NOT a ProgramMember id
```

and `src/repositories/ids.ts` defines the mapping:

```ts
export function peIdForMember(memberId: string) { return `pe_pm_${memberId}`; }
```

**Consequence.** The moment `ENABLE_NEW_LEARNING` is turned on, any interview
code path that takes a member id from `requireProgramMember()` / this repository
and writes it to `GeneralInterview.memberId` will violate the foreign key. Today
the flag is off, so nothing breaks — but our code must be flag-correct *before*
the cutover, not after.

**Fix (small, local, reversible).** One helper next to `resolveInterviewMemberId()`
that normalises whatever the repository returns back to a `ProgramMember.id`:
strip the `pe_pm_` prefix when present, pass through otherwise. `provider.ts`
becomes the only file in the interview module that knows this rule.

### 3.3 UI mount point

Our card replaces 2.0's "Voice Interview" section in
`src/components/program/program-dashboard-view.tsx`. 2.0 rebuilt that file
wholesale: the interview block is now a collapsible "Mock Interview" disclosure
(`interviewOpen` state, lines ~139–175) on the cream/orange design system, and
`src/app/program/(app)/dashboard/page.tsx` does **not** fetch
`getCohortInterviewState`. Our edit to the old dark-theme version cannot be
carried over as a diff; it has to be re-applied as a small insertion into the
new component.

### 3.4 Route protection gap (pre-existing, worth closing during this merge)

`/program/cohort-interview` is not in `protectedPaths` in `middleware.ts` — our
branch never added it, and 2.0 just reworked that array. It relies on in-page
auth today. Adding the prefix is a one-line, edge-safe change and belongs in this
merge while the file is already being looked at.

### 3.5 Merge mechanics

`git merge-tree` says **8 conflicting files**. None of them is an interview file:

```
prisma/schema.prisma                              trivial (a stray blank line vs 2.0's new User relations)
src/lib/feature-flags.ts                          trivial (both appended; keep both)
src/app/globals.css                               design-system: take 2.0
src/app/layout.tsx                                design-system + fonts: take 2.0
src/app/dashboard/page.tsx                        take 2.0 (dashboard-hub rewrite)
src/components/landing/testimonials-carousel.tsx  take 2.0
src/components/program/program-dashboard-view.tsx take 2.0, then re-apply §3.3
src/features/talent-pool/pool.ts                  take 2.0 (repository-backed)
public/landing/step3.jpeg                         binary add/add — take 2.0
```

The whole of `src/features/interview/**`, `src/components/interview/**`,
`src/app/actions/interview-actions.ts`, `src/app/api/interview/**`,
`src/app/interview/**` and `src/app/program/(app)/cohort-interview/**` merges
clean, because 2.0 never touched those paths.

`package.json` auto-merges (both sides moved `@xenova/transformers`; 2.0 adds
`gsap`, we add `@langchain/*`, `three`, `@fontsource/*`).

---

## 4. REQUIRED INTEGRATION CHANGES

Ordered. Nothing here alters interview behaviour, scoring, questions or report
content.

**R1** — Merge `upstream/abtalks/2.0` into `interview-agent`, resolving the 8
conflicts as listed in §3.5.

**R2** — Route the interview module's legacy reads through the repository seam
(§3.1). Mechanical import swaps only. `programMember`/`studentProfile` → the
legacy shims; `studentProfile.findUnique` in `candidate-context.ts` and
`resume-context.ts` → `getCandidateProfile()` where the field set matches
`CandidateProfileView` (`fullName`, `phone`, `phoneVerified`, `linkedinUrl`,
`githubUsername`, `resumeUrl`, `skills`, `isReadyForInterview`, `referralCode`).
Where our select asks for a column `CandidateProfileView` does not carry, keep
the shim call and leave a one-line comment saying why.

**R3** — Add the `pe_pm_` normalisation helper in
`src/features/interview/provider.ts` (§3.2) and use it at the single point where
a member id enters the interview module.

**R4** — Re-apply the dashboard card mount into 2.0's rebuilt
`program-dashboard-view.tsx` (§3.3) and re-add the `getCohortInterviewState`
fetch to `src/app/program/(app)/dashboard/page.tsx`.

**R5** — Add `/program/cohort-interview` to `protectedPaths` in `middleware.ts`
(§3.4). Edge-safe: array literal only, no `@/lib/*` import.

**R6** — Confirm the two interview migrations sit correctly after the merge, and
record the production apply caveat (§8). No new migration.

**R7** — Append the reconcile lines to `docs/CHANGELOG.md` under
`## Pending reconcile`.

---

## 5. Explicit separation

### 5.1 UI changes — exactly one, and it is a re-application, not a redesign

- `src/components/program/program-dashboard-view.tsx` — replace 2.0's inline
  "Mock Interview" disclosure body with `<CohortInterviewCard state={…} />`,
  **keeping 2.0's cream/orange collapsible chrome**. The card's own styling
  (`src/components/program/cohort-interview-card.tsx`) may need its palette
  tokens aligned to `docs/design-system.md` so it does not render dark-on-cream —
  that is a token swap, not a layout change.
- `src/app/program/(app)/dashboard/page.tsx` — one added `Promise.all` entry and
  one added prop.

Nothing else. The interview room, mic check, stages, and report view are not
touched: they are full-page routes that do not inherit the dashboard shell.

### 5.2 Database / schema changes — **none required**

- Our three models (`GeneralInterview`, `InterviewTurn`, `InterviewReport`) and
  two enums (`InterviewBlueprint`, `GeneralInterviewStatus`) survive the merge
  intact; the only `schema.prisma` conflict is a blank line.
- Our two migrations (`20260813000000_general_interview`,
  `20260820000000_interview_turn_report`) are timestamped **before** 2.0's
  (`20260820120000`, `20260820130000`), so ordering is already correct.
- 2.0's Phase-1 migration touches `Certificate`, `SynergyEvent`,
  `RecruiterShortlistItem`, `Job`, `HackathonRemoval`, `RecruiterProfile`,
  `Notification`, `User` — **not** `ProgramMember`'s columns and none of ours.
- `ProgramMissionSubmission`, `ProgramProject`, `RecruiterReview`, `Submission`
  have no repository shim in 2.0 yet. Leaving them on `prisma` is the correct
  choice, not an oversight — inventing shims 2.0 did not write would be new
  abstraction for trivial logic.

**Deliberately deferred to a later plan (do NOT do it now):** re-homing the
interview onto the new spine — `Activity{type: INTERVIEW}` + `ActivityAttempt` +
`ActivityEvaluation{evaluatorType: AI}`, and mirroring `InterviewReport` into
`AssessmentReport` + `AssessmentScore` (with `SkillEvidence` rows and
`CredentialSourceType.ASSESSMENT_REPORT`). 2.0 clearly built the seats for it —
`ActivityType.INTERVIEW`, `EvaluatorType.AI`, `EvidenceSourceType.ASSESSMENT_SCORE`
all exist. But that is a *report* change and a *schema* change, both out of scope
here, and it cannot be validated until Phase 6 runs. Record it, do not build it.

### 5.3 Agent / runtime changes — **none**

`src/features/interview/agent/**` (graph, nodes, policy, depth, types, the LLM
provider registry and heuristics), `question-bank.ts`, `question-generation.ts`,
`question-rules.ts`, `rubric.ts`, `scoring.ts`, `module-scoring.ts`,
`evaluation.ts`, `report-analysis.ts`, `report-assembly.ts`, `report.ts`,
`state.ts`, `session.ts`, `orchestrator.ts`, `voice.ts`, `voice-contract.ts` are
untouched. 2.0 changed nothing they depend on. `@langchain/langgraph` and
`@langchain/core` are ours alone; 2.0 adds no conflicting dependency.

### 5.4 API / provider changes — **none**

- `src/app/api/interview/stt/route.ts` and `.../tts/route.ts` keep their
  contracts. 2.0 added only `/api/cron/078-drift` and touched no API route of ours.
- `INTERVIEW_LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GEMINI_MODEL`,
  `GROQ_API_KEY`/`GROQ_MODEL`, `OPENAI_API_KEY`, `INTERVIEW_STT_MODEL`,
  `INTERVIEW_TTS_MODEL`, `INTERVIEW_TTS_VOICE` — unchanged. The provider registry
  and cascade stay as built.
- 2.0 adds six `ENABLE_NEW_*` env vars plus `ENABLE_DUAL_WRITE`. We consume none
  of them directly; we only have to be *correct* when `ENABLE_NEW_LEARNING`
  flips, which R3 handles.

### 5.5 Files that must remain untouched

- All of `src/features/interview/agent/**`.
- `src/features/interview/cohort/question-bank.ts`, `blueprint.ts`,
  `curriculum.ts`, `planner.ts`, `grounding.ts`, `eligibility-rules.ts`.
- Every report file: `report.ts`, `report-analysis.ts`, `report-assembly.ts`,
  `report-provider.ts`, `rubric.ts`, `scoring.ts`, `module-scoring.ts`,
  `evaluation.ts`, `src/components/interview/cohort/report-view.tsx`.
- `src/components/interview/**` except the palette tokens noted in §5.1.
- `src/app/api/interview/**`, `src/app/actions/interview-actions.ts` (behaviour;
  R2 may change imports only).
- All of `src/repositories/**`, `prisma/scripts/migrate-078-*`,
  `prisma/scripts/migrate-2*`, `prisma/scripts/check-078-*`,
  `prisma/seed-platform-taxonomy.ts`, `src/app/api/cron/078-drift/route.ts` —
  **these are Sohail sir's. Take them as-is.**
- `src/components/landing/site/**`, `src/components/dashboard-hub/**`.
- `agent packages/**` (untracked local clones).

**Casualty to flag, not to fix here:** 2.0 deletes
`src/components/landing/landing-hub.tsx`, retiring the hub landing. Our
`src/components/landing/hub/*` additions (ghost cursor, tilt card, collage,
testimonials, `landing-hub.css`) and the `src/fonts/**` + `public/landing/**`
assets become orphaned after the merge. They are unrelated to the interview
agent. Leave them in place for this merge; propose removal separately.

---

## 6. Steps

1. **Branch and snapshot.** `git checkout -b interview-agent-2.0` from
   `interview-agent`. Record the HEAD hash in the commit message.
2. **Merge.** `git merge upstream/abtalks/2.0`. Resolve the 8 conflicts exactly
   per §3.5. For `prisma/schema.prisma`: keep 2.0's Phase-1 `User` relation block
   **and** our `ProgramMember.generalInterviews` line — verify the merged file
   still contains `model GeneralInterview`, `model InterviewTurn`,
   `model InterviewReport`, `enum InterviewBlueprint`, `enum GeneralInterviewStatus`.
   For `src/lib/feature-flags.ts`: keep both sides' appended functions.
3. **`npx prisma generate`**, then `npx tsc --noEmit`. Fix only type breaks
   caused by the merge. Record the list before touching anything.
4. **R2** — import swaps, file by file, in the order of the §3.1 table. One
   commit. No behaviour change; the shims are literally `prisma.programMember`.
5. **R3** — add the member-id normaliser to `provider.ts`. Unit-check it against
   both shapes (`cm…` and `pe_pm_cm…`).
6. **R4** — re-apply the dashboard mount. Compare against 2.0's disclosure block
   so the card sits inside the existing collapsible, not beside it.
7. **R5** — `middleware.ts` one-line addition.
8. **R7** — CHANGELOG lines.
9. Build, then verification (§9).

---

## 7. Guardrails for Cursor (DO NOT)

- **DO NOT** change any interview question, rubric weight, scoring formula,
  report section, prompt, or agent graph node. This merge is plumbing.
- **DO NOT** write new files under `src/repositories/`. Use what 2.0 shipped.
  If a domain has no shim, keep the direct `prisma` call and comment why.
- **DO NOT** create a `GeneralInterview → ProgramEnrollment` FK, or migrate the
  interview onto `Activity`/`ActivityAttempt`/`AssessmentReport`. That is §5.2's
  deferred work and needs its own plan.
- **DO NOT** write a new migration. The schema is unchanged by this plan.
- **DO NOT** run `prisma migrate deploy` against production — production carries
  a leftover `20260813000000_general_interview` history row with no tables
  behind it (§2.3, §8).
- **DO NOT** enable any `ENABLE_NEW_*` or `ENABLE_DUAL_WRITE` flag. They are
  Sohail sir's rollout gate and stay off.
- **DO NOT** import `@/lib/*` into `middleware.ts` — Edge 1 MB bundle limit.
- **DO NOT** restyle the interview room, report view, or any stage component.
  §5.1 is the entire UI budget: one card mount + palette tokens.
- **DO NOT** resurrect `src/components/landing/landing-hub.tsx` or fight 2.0's
  landing/dashboard rewrite. Take 2.0 on every design-system conflict.
- **DO NOT** modify anything under `src/repositories/`, `prisma/scripts/`,
  `src/components/landing/site/`, `src/components/dashboard-hub/`.
- If a build error contradicts an assumption in this plan, trust the error and
  report it — do not paper over it with a cast or an `any`.

---

## 8. DB safety

**No schema change is proposed**, so there is no migration step. Two facts must
still be carried forward:

1. **Production has a phantom migration row.** `20260813000000_general_interview`
   is recorded in production `_prisma_migrations` (from reverted PR #168) with no
   tables created. A plain `migrate deploy` from this branch will therefore skip
   creating our tables and leave the app broken at runtime. Whenever this branch
   is deployed, the `GeneralInterview` / `InterviewTurn` / `InterviewReport` DDL
   must be applied explicitly via `prisma db execute` against a **production
   child branch first**, and the history row reconciled. Flag this to Sohail sir
   before any production deploy — his 078 rollout runbook already assumes the
   direct (non-pooler) endpoint for exactly this class of operation.
2. **Test on a Neon child, never production.** Create a child from production,
   apply our two migrations plus 2.0's Phase-1 + Phase-2 audit SQL in timestamp
   order, then run the interview smoke suite. Do not run any `migrate-078-*` or
   `check-078-*` script — those are Sohail sir's rehearsal, on his own children
   (`plan-078-phase1`, `plan-078-rehearsal`).

Commit checkpoint before the merge; note the hash.

---

## 9. Verification

- `npx prisma generate` clean; `npx tsc --noEmit` clean; `npm run build` clean.
- `npm run test:interview` passes (verify-cohort-interview, -domain, -agent,
  -adaptive, -report, -voice) — these are deterministic and must be
  **byte-identical** in output to a pre-merge run. Capture both and diff. Any
  difference means the merge changed agent behaviour and must be investigated,
  not accepted.
- `npm run test:interview:db` against the Neon child: start → answer → finish →
  report, end to end.
- Manual: `/program/dashboard` renders the interview card inside 2.0's
  collapsible on cream/orange with no dark-on-cream artefact; locked and unlocked
  states both correct; `/program/cohort-interview/DAY_15` runs a full session;
  the report page renders unchanged from pre-merge.
- Manual, flag-correctness: with `ENABLE_NEW_LEARNING` **off** (the real config),
  confirm behaviour is identical to pre-merge. The `pe_pm_` normaliser is
  exercised by a unit check, not by flipping the flag.
- Files changed should be: the 8 conflict resolutions, the 7 files in §3.1 that
  take shim imports, `provider.ts`, `program-dashboard-view.tsx`,
  `program/(app)/dashboard/page.tsx`, `middleware.ts`, `docs/CHANGELOG.md`, and
  this plan. Anything under `src/features/interview/agent/**`,
  `question-bank.ts`, or any `report-*.ts` appearing in the diff is a defect.

---

## 10. Commit message

```
merge: integrate interview agent with abtalks/2.0 platform architecture

Merges upstream/abtalks/2.0 (plan 078 platform data architecture + the
cream/orange dashboard and landing rebuild) into the interview agent branch.

- routes the interview module's ProgramMember/StudentProfile reads through
  the new src/repositories seam instead of calling prisma directly
- normalises repository member ids back to ProgramMember.id (pe_pm_ prefix)
  so GeneralInterview.memberId stays valid after the ENABLE_NEW_LEARNING
  cutover
- re-applies the cohort interview card into 2.0's rebuilt program dashboard
- protects /program/cohort-interview in middleware

No schema change. No change to the interview flow, question banks, rubric,
scoring or report. ENABLE_NEW_* and ENABLE_DUAL_WRITE remain off.
```
