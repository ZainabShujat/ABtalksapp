# 066 — General Interviewer Agent, Phase 1 (domain core)

Follows `065-interviewer-agent-extraction-map.md`. Product decision is locked:
this is a **general AB Talks AI interview**, not job-specific — a standardized,
comparable talent signal built from the candidate's own verified AB Talks
context.

Phase 1 = **backend/domain only**. No UI, no recruiter surface, no scheduling,
no job matching. Milestone: take a real AB Talks student and produce a valid
General Interview session from their existing profile context.

## 1. Blocker found during inspection: there is no parsed resume

The spec assumes "parsed resume stored in their AB Talks profile." That does not
exist anywhere in ABTalks today.

- `StudentProfile.resumeUrl` (`prisma/schema.prisma:212`) is a **plain URL string**.
  Every consumer (`features/profile/get-profile.ts`, `talent-pool/pool.ts`,
  `app/profile/page.tsx`, admin pages) renders it as an `<a href>` link. Nothing
  ever fetches it, downloads it, or parses it. There is no stored resume text, no
  extracted structure, no file upload — `resumeUrl` is user-typed.
- The only resume-*shaped* structured data is `RecruiterReview`
  (`schema.prisma:430`): `skillGroups`, `education`, `experience`, `projects`,
  `achievements[]`. But it is **admin/human-entered**, exists for only a small
  subset of students, and is challenge-track only.
- No `pdf-parse` / `mammoth` / text-extraction dependency exists in the repo.

**Decision taken for Phase 1** (flagging for your confirmation): resume context
is an **optional, degrading input**, not a required one. `buildResumeContext`
reads, in priority order: `RecruiterReview` structured JSON → `StudentProfile`
fields (`skills[]`, `role`, `organization`, `yearsExperience`, `college`) →
nothing. It returns a `hasStructuredResume` flag. **Challenge context is the
primary and always-present signal**, which is the right default anyway — it's
verified platform data rather than self-reported claims.

Real resume parsing (upload → extract text → LLM structure → persist) is its own
phase. It needs a storage decision and touches the schema, so it is deliberately
out of Phase 1.

## 2. Data sources — where verified context actually comes from

Completion is defined by the existence of a `Submission` row. There is no
"partially complete" state in the challenge schema — a day is either submitted
or it is not, which makes the "only assess completed work" rule clean.

| Signal | Source | Note |
| --- | --- | --- |
| Completed challenge days | `Submission` (`@@unique([enrollmentId, dayNumber])`) | One row per completed day. `status` is `ON_TIME`/`LATE` — both count as completed. |
| What that day taught | `DailyTask` via `Submission.dailyTaskId` | `title`, `problemStatement`, `learningObjectives[]`, `tags[]`, `difficulty` — this is the question-generation substrate. |
| Proof of work | `Submission.githubUrl`, `.linkedinUrl` | Presence boosts a task's interview-worthiness (mirrors the reference repo's verified-submission boost). |
| Ongoing progress | `Enrollment.daysCompleted`, `.currentStreak`, `.status`, `.startedAt` | Ongoing enrollments contribute only their completed days. |
| Track | `Enrollment.domain` / `Challenge.domain` (`SE`/`DS`/`AI`/`CLAUDE`) | Multiple enrollments per user are supported and combined. |
| Quiz signal | `QuizAttempt.score` | Weak secondary signal; included in context, not scored. |
| Profile | `StudentProfile` | Name, role, experience, self-reported `skills[]`. |

**The 30/60 rule falls out naturally**: we select from `Submission` rows only, so
a student 30 days into a 60-day challenge yields exactly 30 eligible tasks. Days
without a submission are never visible to the question planner.

## 3. Deterministic vs LLM split (enforced by file boundary)

Deterministic code owns everything that must be reproducible and comparable:

- `candidate-context.ts`, `challenge-context.ts`, `resume-context.ts` — retrieval
- `rubric.ts` — the fixed competency set and weights (identical for every candidate)
- `question-rules.ts` — which competencies get asked, in what order, sourced from what
- `state.ts` — turn advancement, follow-up budget, termination
- `scoring.ts` — aggregation, weighting, clamping, final score
- `eligibility.ts` — attempt counting and the 30-new-days retake rule

LLM is used at exactly three call sites, each with a deterministic fallback so a
failed call degrades the interview instead of breaking it:

- `question-generation.ts` — phrasing a question for a slot the rules already chose
- `evaluation.ts` — extracting evidence from an answer + deciding follow-up
- `evaluation.ts` — final per-competency semantic judgment on the transcript

The LLM never decides *which* competency to assess, never decides the score
weighting, and never produces the final number. It returns per-competency
evidence judgments; `scoring.ts` aggregates them in code.

**Live-interview LLM budget**: one call per answered question (evidence +
follow-up decision in a single call, as the reference repo does), plus one
planning call at session start and one evaluation call at the end. A 10-question
interview is ~12 LLM calls, not one per utterance.

## 4. Standardized rubric (comparability requirement)

Five fixed competencies, fixed weights, identical for every candidate regardless
of track or resume. Personalization happens in the *questions*, never in the
*rubric* — that is what makes scores comparable.

| Competency | Weight |
| --- | --- |
| Conceptual understanding | 25 |
| Practical application | 25 |
| Problem solving & reasoning | 20 |
| Code & technical depth | 20 |
| Communication clarity | 10 |

Each competency scores 0–100 from evidence tiers (none / claimed / explained /
demonstrated-with-specifics). Overall = weighted mean, computed in code.

## 5. Files (all new, all under `src/features/interview/`)

| Path | Note |
| --- | --- |
| `constants.ts` | Durations, question counts, retake threshold (30), follow-up budget |
| `types.ts` | Domain types + Zod schemas at every boundary |
| `rubric.ts` | Fixed competency/weight definition + evidence tiers |
| `challenge-context.ts` | Completed-only extraction from Enrollment/Submission/DailyTask |
| `resume-context.ts` | Degrading resume loader (§1) |
| `candidate-context.ts` | Orchestrator → one `CandidateContext` |
| `question-rules.ts` | Deterministic slot plan: competency → source → candidate task |
| `question-generation.ts` | LLM phrasing, deterministic template fallback |
| `state.ts` | Interview state machine + turn advancement |
| `evaluation.ts` | Evidence extraction, follow-up decision, final judgment |
| `scoring.ts` | Deterministic aggregation → final scores |
| `eligibility.ts` | Attempt/retake logic incl. the 30-new-days rule |
| `session.ts` | Phase 1 entry point: build a full session for a userId |

Nothing under `src/features/program/` is touched. `ProgramInterview` keeps
working exactly as-is.

## 6. Retake rule — how "30 NEW days" is enforced without double counting

Each **official completed attempt** records the exact set of `Submission` ids it
consumed (`consumedSubmissionIds`). Eligibility for a new attempt =
`(all completed submission ids for the user) − (union of all previously consumed ids)`
must be **≥ 30**.

This satisfies every stated constraint directly:
- Progress combines freely across challenges (it's a flat id set, not per-enrollment).
- The same day can never count twice (set difference).
- Waiting does not help — only new submissions grow the set.
- Failed/abandoned/invalid sessions consume nothing, because ids are recorded
  only on transition to `COMPLETED`.

First attempt is gated on a minimum of 30 completed days total, so there is one
consistent threshold.

## 7. Persistence — needs your sign-off before I touch the schema

Per `CLAUDE.md` I have not modified `prisma/schema.prisma`. Phase 1 code is
written so the domain core is fully functional and typechecked **without** the
new models: `session.ts` builds a complete session in memory from real student
data. Only persistence of attempts/answers/scores is deferred.

Proposed models (for review, not yet written):

```prisma
model GeneralInterview {
  id                    String    @id @default(cuid())
  userId                String
  attemptNumber         Int
  status                GeneralInterviewStatus @default(NOT_STARTED)
  plan                  Json      // frozen question plan + rubric snapshot
  transcript            Json?
  consumedSubmissionIds String[]  @default([])   // §6 — set only on COMPLETED
  conceptualScore       Int?
  practicalScore        Int?
  problemSolvingScore   Int?
  technicalDepthScore   Int?
  communicationScore    Int?
  overallScore          Int?
  summary               String?
  startedAt             DateTime?
  endedAt               DateTime?
  evaluatedAt           DateTime?
  createdAt             DateTime  @default(now())
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, attemptNumber])
  @@index([userId, status])
}

enum GeneralInterviewStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
  ABANDONED
  INVALID   // technical failure — never consumes an attempt
}
```

A rubric snapshot is stored in `plan` on purpose: if the rubric is ever
reweighted, historical scores stay interpretable rather than silently changing
meaning.

Say the word and I'll add these + run the migration. Until then Phase 1 runs
in-memory.

## 8. Verification

`npx tsc --noEmit` and `npm run lint` must pass. Manual check: call
`buildInterviewSession(userId)` for a seeded student with submissions and confirm
it returns a plan whose challenge-sourced questions reference only days that
student actually submitted.

## 9. Commit message

`Add General Interviewer Agent domain core (Phase 1)`
