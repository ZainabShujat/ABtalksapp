# 080 — Interview Agent: align with the 078 platform architecture

> **Status:** Plan. No code, schema or migration changed by this document.
> **Source of truth:** `docs/project-context.md` on `upstream/master` (`be45b9d`),
> §4 "Interviews — target mapping only" and §9 "Repository layer".
> **Scope:** adapt in place on `interview-agent-2.0`. No pull, no merge.

---

## 1. Goal

Make the cohort interview agent conform to the 078 architecture on two points it
currently violates: it binds its identity to a **retiring** model
(`ProgramMember`), and it produces assessment results that the recruiting context
**cannot see**. Nothing about the interview itself — flow, question banks, depth
ladder, scoring, report — changes.

---

## 2. What master's project-context.md actually requires

Three statements govern this work.

**§4, Interviews — target mapping only**

```
Activity(type = INTERVIEW) → ActivityAttempt → ActivityEvaluation
                           → AssessmentReport → AssessmentScore
```

> `ProgramInterview` … is still the **legacy, live** model and has **not** been
> migrated. Future interview-agent work should go through the repository layer
> and the new models rather than binding tightly to `ProgramInterview`.

**§4, the governing invariant**

> **learning WRITES evidence, recruiting READS evidence.** The two contexts share
> `User.id` and nothing else.

**§9, repository rules**

> New application code must not add direct dependencies on retiring models —
> `StudentProfile`, `ProgramMember` … wherever a repository function can be used
> instead.

**Constraint that shapes everything below (§18).** Phase 2 backfill is
**incomplete and stopped** (P2032, mid-2e). Phase 6 reads are **not enabled** —
every `ENABLE_NEW_*` is off. Legacy is authoritative for **every** read.
`ENABLE_DUAL_WRITE=true` is live in production.

So the correct move is **not** to re-home the interview onto
`ActivityAttempt` and read from it. Nothing reads those tables yet, and the rows
that would give them meaning have not finished migrating. The correct move is the
same one every other 078-adapted write path took: **keep the operational store
authoritative, and dual-write the outcome into the new models.**

---

## 3. Current behaviour — the three gaps

| # | Gap | Where | Why it violates the doc |
|---|---|---|---|
| G1 | `GeneralInterview.memberId` is an FK to **`ProgramMember.id`** | `prisma/schema.prisma`, `features/interview/provider.ts` | Binds a brand-new subsystem to a retiring model. §9 forbids it; the contexts are supposed to share `User.id` and nothing else. Also why plan 079 needed the `pe_pm_` normaliser — a workaround for a binding that should not exist. |
| G2 | Results land in `InterviewReport` only | `features/interview/repository.ts`, `report-assembly.ts` | Recruiting cannot see interview outcomes at all. §4 names `AssessmentReport` + `AssessmentScore` as the target; the invariant says learning must emit evidence recruiting can read. |
| G3 | `read-model.ts` reads `prisma.programInterview` directly | `features/interview/read-model.ts:149,173` | This is the legacy exit interview feeding the talent pool. Still live and authoritative, so it stays — but it must not gain new dependencies, and the new interview must not be plumbed through it. |

**Already compliant** (done in plan 079, keep as is): `ProgramMember` and
`StudentProfile` reads go through `@/repositories/legacy/*`;
`ProgramMissionSubmission`, `ProgramProject`, `Enrollment`, `Submission`,
`RecruiterReview` stay on `prisma` because 078 Phase 3 ships no shim for them.

---

## 4. Target design

### 4.1 Identity — key off `User.id` (fixes G1)

Add `userId` to `GeneralInterview` as an FK to `User`, and make `memberId`
**nullable**.

- `userId` becomes the identity the interview is scoped by.
- `memberId` is retained, nullable, as **cohort provenance** — which cohort run
  the interview belonged to — not as identity. It stops being load-bearing.
- `resolveInterviewMemberId()` in `provider.ts` becomes
  `resolveInterviewActor()`, returning `{ userId, memberId | null }`, resolved
  through the repository layer.
- `toProgramMemberId()` (the `pe_pm_` normaliser from 079) becomes **dead** once
  identity is `userId`, because `ProgramEnrollment.id` never enters the picture.
  Delete it in the same change, not later.

`onDelete` for `userId`: **`Restrict`**, matching what Phase 1 did to
`Certificate` and `SynergyEvent`. An interview result is recruiting evidence and
must outlive a careless delete.

### 4.2 Evidence — dual-write `AssessmentReport` + `AssessmentScore` (fixes G2)

On `finishCohortInterview`, after the report is written, emit the recruiting-side
projection **inside `runDualWrite`** from `@/repositories/dual-write.ts` — the
same `SAVEPOINT` wrapper every other 078 path uses, so a new-side failure logs
and rolls back without failing the candidate's request.

| New row | Value |
|---|---|
| `AssessmentReport.candidateUserId` | the interview's `userId` |
| `.title` | `BLUEPRINT_LABEL[blueprint]` — "Day 15 Checkpoint Interview" |
| `.status` | `PUBLISHED` |
| `.summary`, `.strengths`, `.areasForGrowth` | from the existing report document — **read, never recomputed** |
| `.assessorName` | `"ABTalks AI Interviewer"` |
| `.assessedAt` | `evaluatedAt` |
| `AssessmentScore` × 5 | one per competency: `dimension` = competency slug, `score` = 0–100, `maxScore` 100, `feedback` = that competency's note |

`@@unique([reportId, dimension])` makes the score rows naturally idempotent.
The report row needs an idempotency guard of its own — see §7.

**No new numbers are computed.** This is a projection of the existing report, so
the two can never disagree.

### 4.3 Deliberately NOT in scope

- **`Activity` / `ActivityAttempt` / `ActivityEvaluation`.** §4 calls this "the
  target representation, not the serving one" and states no live UI reads it.
  Writing interview attempts there now buys nothing readable and couples us to a
  backfill that is currently stopped. Revisit when Phase 2e completes and Phase 6
  is in sight.
- **`SkillEvidence` / `CandidateAchievement`.** Genuinely attractive — they are
  how an interview would reach the unified profile and `CandidateSkill.evidenceScore`.
  But the question bank has no skill taxonomy mapping today, so every row would
  need an invented `skillId`. That mapping is its own piece of work. Listed here
  so it is a decision, not an oversight.
- **`ProgramInterview`.** Untouched. Legacy, live, authoritative.
- Interview flow, banks, depth ladder, evidence arithmetic, scoring, report
  structure, voice, LLM providers, UI.

---

## 5. Files to touch

| File | Change |
|---|---|
| `prisma/schema.prisma` | `[edit]` `GeneralInterview`: add `userId String`, `user User @relation(onDelete: Restrict)`, make `memberId String?`, index `[userId, blueprint]` |
| `prisma/migrations/2026XXXXXXXXXX_interview_user_identity/migration.sql` | `[new]` add column, backfill from `ProgramMember`, add FK + index, drop NOT NULL on `memberId` |
| `src/features/interview/provider.ts` | `[edit]` `resolveInterviewActor()` returning `{ userId, memberId }`; delete `toProgramMemberId` |
| `src/features/interview/repository.ts` | `[edit]` scope every query by `userId`; write `userId` on create |
| `src/features/interview/service.ts` | `[edit]` thread `userId`; call the evidence bridge on finish |
| `src/features/interview/assessment-bridge.ts` | `[new]` the only file that knows about `AssessmentReport`/`AssessmentScore`; `runDualWrite`-wrapped |
| `src/features/interview/cohort-eligibility.ts` | `[edit]` take `userId`, resolve `memberId` internally for the mission-submission read |
| `src/app/actions/interview-actions.ts` | `[edit]` use `resolveInterviewActor()` |
| `src/app/program/(interview)/cohort-interview/[blueprint]/page.tsx` + `report/page.tsx` | `[edit]` drop `toProgramMemberId(...)` |
| `src/app/program/(app)/dashboard/page.tsx` | `[edit]` same |

**Server vs Client:** every file above is server-only. No Server→Client prop
changes; `CohortInterviewState` and `FinishInterviewData` keep their shapes, so
no client component changes at all.

---

## 6. Steps

1. Schema + migration (§7 first).
2. `provider.ts` — `resolveInterviewActor()`; delete the normaliser.
3. `repository.ts` — scope by `userId`, write it on create.
4. `cohort-eligibility.ts` — accept `userId`, resolve `memberId` internally.
5. Call sites — actions and the three routes.
6. `assessment-bridge.ts` — new file, then call it from `finishCohortInterview`.
7. `npx tsc --noEmit`, `npm run test:interview`, `npm run build`.
8. Manual: full interview on the sample DB; assert one `AssessmentReport` + 5
   `AssessmentScore` rows appear with `ENABLE_DUAL_WRITE=true`, and none with it
   off.

---

## 7. DB safety

Commit checkpoint before the migration; record the hash.

The migration is **additive**: `ADD COLUMN userId`, backfill
`UPDATE "GeneralInterview" g SET "userId" = m."userId" FROM "ProgramMember" m WHERE m.id = g."memberId"`,
then `SET NOT NULL`, add FK `ON DELETE RESTRICT`, add index, and
`ALTER COLUMN "memberId" DROP NOT NULL`. No drop, no rename.

Two hazards, both already known on this branch:

- **Production carries a phantom `20260813000000_general_interview` history row**
  with no tables behind it (plan 079 §8). Any production apply is
  `prisma db execute` on a child branch first, never `migrate deploy`.
- **Idempotency for the bridge.** `AssessmentReport` has no natural unique key.
  Guard on `(candidateUserId, title, assessedAt)` before insert, or add a
  nullable `sourceKey` — decide at implementation, but a re-finish must not
  create a second report.

Apply and test on `DATABASE_SAMPLE_URL` only.

---

## 8. Guardrails for Cursor (DO NOT)

- **DO NOT** touch question banks, depth ladder, evidence, scoring, report
  structure, voice, LLM providers, or any interview UI.
- **DO NOT** write to `Activity` / `ActivityAttempt` / `ActivityEvaluation`.
  §4 says nothing reads them; the backfill is stopped.
- **DO NOT** recompute scores for `AssessmentScore`. Project the existing report.
- **DO NOT** enable `ENABLE_NEW_*`. The bridge rides `ENABLE_DUAL_WRITE` only.
- **DO NOT** let a new-side failure fail the candidate's request — everything
  goes through `runDualWrite`.
- **DO NOT** add new reads of `ProgramInterview`, `ProgramMember` or
  `StudentProfile` outside `repositories/legacy/*`.
- **DO NOT** drop `memberId`. It becomes nullable provenance, not dead weight.
- **DO NOT** create files not listed in §5.

---

## 9. Verification

- `npx tsc --noEmit`, `npm run build` clean.
- `npm run test:interview` — byte-identical output to a pre-change run. Any
  difference means interview behaviour moved, which this plan forbids.
- Sample DB: finish an interview with `ENABLE_DUAL_WRITE=true` → exactly one
  `AssessmentReport` + 5 `AssessmentScore` rows, numbers matching the rendered
  report. Re-finish → still one report.
- With `ENABLE_DUAL_WRITE` unset → zero new rows, interview unaffected.
- `grep -rn "toProgramMemberId" src/` returns nothing.

---

## 10. Commit message

```
refactor(interview): key interviews off User.id and emit recruiting evidence

Aligns the interview agent with the 078 architecture described in
docs/project-context.md §4/§9.

- GeneralInterview is now scoped by userId; memberId becomes nullable
  cohort provenance rather than identity, removing the interview's
  dependency on the retiring ProgramMember model
- drops the pe_pm_ id normaliser, which only existed to work around it
- dual-writes AssessmentReport + AssessmentScore on completion, inside
  runDualWrite, so recruiting can read interview evidence

No change to interview flow, banks, scoring or report. Activity/
ActivityAttempt mapping deferred until Phase 2e completes.
```
