# 103 — Interview Platform: architecture and Phase 1

**Status:** plan. Nothing here is implemented.
**Depends on:** the interview engine documented in `docs/architecture/interview-agent-architecture.md`.
**Supersedes for general interviews:** the dormant general-interviewer path from plan 066.

> ### Revision 2 — corrected against branch `more-mock-interviews` @ `ff64817`
>
> Revision 1 was written against branch `interview-agent-2.0`. The implementation branch is
> `more-mock-interviews`, which is cut from `master` and **does not contain plan 083**. Three
> corrections, all verified in source:
>
> 1. **`agent/target-planner.ts`, `agent/coverage.ts` and `cohort/concepts.ts` do not exist here.**
>    `state.ts:152` advances with `currentQuestionIndex + 1`; there is no conversation planner and
>    no `askedQuestionIds` field. **Consequence:** the "planner goes inert" blocker is moot, Step 5
>    (`platform/concepts.ts`) is **dropped**, and mock interviews walk their pack in authored order.
>    Adaptive *depth* — escalate / scaffold / follow-up / redirect / repeat / clarify — is fully
>    present and unaffected. See §3.8.
> 2. **`interview-room.tsx` is NOT uncoupled.** Revision 1 was wrong. It hard-imports the three
>    cohort Server Actions (lines 42–46) and fetches `/api/interview/tts` (line 657). See §4.1.
> 3. **`RunTurnInput.blueprint` is typed `InterviewBlueprintKey`.** A narrow type-only widening is
>    required; do **not** pass a fake `"DAY_15"`. See §4.2.
>
> Verified unchanged from Revision 1: the graph is the same 11 nodes with the same names and edges;
> `blueprint` is carried as a graph channel but **read by zero nodes**; baseline `npx tsc --noEmit`
> is clean.

---

## 1. Goal

Turn the AI Cohort interview engine into an **extensible interview platform**: many domain-specific interviews, open to any registered ABTalks user (no cohort enrollment), repeatable, voice-first, served from a HackerRank-style catalogue at `/mock-interviews`.

Phase 1 ships the **architecture and two live domains**. The remaining six domains register as `COMING_SOON`. Code execution, whiteboard, FDE scenario interviews, an in-app pack-review UI, and an event log are **deliberately out of Phase 1** — but every seam they need is defined here so they land as additions, not restructures.

---

## 2. Current behavior

The engine already works and is domain-blind. What is cohort-bound is the shell around it.

**Reusable today, unchanged** (verified by reading, not assumed):

- the 11-node LangGraph (`agent/graph.ts`, `agent/nodes.ts`) — branches on nothing cohort-specific
- `agent/policy.ts`, `agent/depth.ts`, `state.ts` — pure, operate on `InterviewPlan` + `InterviewState`
- `module-scoring.ts:scoreQuestion` — with empty `sourceDays` it returns `moduleNumbers: []` and is otherwise correct
- `report-analysis.ts` — every function takes `(plan, state, turns)`; fully domain-blind
- `report-provider.ts:askForReport` — reusable as-is for narrative drafting
- `/api/interview/stt` — reads no interview row; it is stateless transcription behind an auth check

`components/interview/cohort/interview-room.tsx` is **not** in this list. Revision 1 wrongly claimed
it was. Its *props* are domain-blind, but its *imports* are not — see §4.1.

**Cohort-bound, and why each blocks the platform:**

| Blocker | Location | Consequence |
|---|---|---|
| `GeneralInterview.memberId` is an FK to `ProgramMember`; `User` has no interview relation | `prisma/schema.prisma:1301`, `features/interview/provider.ts` | A registered non-enrolled user cannot hold an interview row |
| Partial unique index `GeneralInterview_one_completed_per_blueprint` | `prisma/migrations/20260813000000_general_interview/migration.sql:49` | One completion per (member, blueprint), enforced in the database. Retakes are structurally impossible |
| `assertCanStart` rejects `taken`; `startCohortInterview` abandons any open attempt | `cohort-eligibility.ts`, `service.ts` | Not resumable, not repeatable — correct for a credential, wrong for practice |
| `scopeFrom: z.number().int().min(1).max(31)` | `lib/validations/interview.ts:138` | A report with no cohort day range **fails validation on write**. `report-assembly.ts:397` computes `Math.min(...scopeDays)` → `Infinity` when empty |
| `scoreModules` groups by cohort `MODULES` via `moduleForDay` | `module-scoring.ts` | Module reports are meaningless outside the 31-day curriculum |
| `RUBRIC` is a module-level const; `Competency` is a fixed 5-value union; `GeneralInterview` stores per-competency **named columns** | `rubric.ts`, `types.ts:3`, `schema.prisma:1329-1334` | Per-domain rubrics cannot be expressed. Behavioral and Coding/DSA need different competencies than the cohort's five |
| `deriveCommunicationTier` is selected by a hard-coded `competency === "COMMUNICATION"` check | `evidence.ts` | A rubric without COMMUNICATION silently misbehaves |
| `resolveSpeakableLine` queries `prisma.generalInterview` | `voice.ts` | The TTS route cannot voice a platform attempt |
| `interview-room.tsx` hard-imports the three cohort Server Actions and `/api/interview/tts` | `interview-room.tsx:42-46`, `:657` | The room cannot be reused by a non-cohort caller as-is. **§4.1** |
| `RunTurnInput.blueprint: InterviewBlueprintKey` | `agent/graph.ts:179`, `agent/types.ts:187` | A platform attempt has no blueprint. **§4.2** |
| `openingLine` is typed `Record<"DAY_15" \| "DAY_31", …>` | `agent/policy.ts` | A new domain is a compile error until its opening lines are authored |

---

## 3. Architecture

### 3.1 The central move: unbundle `blueprint`

Today `blueprint` is one value doing five jobs: **who may take it**, **what it covers**, **which questions**, **how often**, and **how it is scored and reported**. Every future capability in the brief is blocked by that bundling. The platform separates them into an `InterviewDomain` config, resolved by slug:

```
InterviewDomain {
  slug                  "ai-fluency"
  label, blurb, family  catalogue presentation
  status                LIVE | COMING_SOON | RETIRED
  rubricId              → RubricDefinition (per-domain competencies + weights)
  strategy              QuestionStrategy id ("AUTHORED_PACK" in Phase 1)
  packRef               { packId, version } — pinned, never "latest"
  durationSec           per-domain, not a global constant
  capabilities          Capability[] — ["VOICE"] in Phase 1
  reportProfile         which report sections render
  conceptVocabularyId   → the token source for planner continuity
  resumable             boolean
  maxAttempts           number | null (null = unlimited)
}
```

Everything that reads `blueprint` today reads a resolved `InterviewDomain` instead. The registry is **code, not a database table** — same reasoning as `question-bank.ts`: a malformed domain becomes a compile error rather than a production incident, and it is reviewable in a diff.

### 3.2 Six seams that prevent future restructuring

These exist so the deferred capabilities are additive. Each is cheap now and expensive later.

**Seam 1 — `QuestionStrategy` interface.** `planCohortInterview` hard-calls `getQuestionBank(blueprint)`. The platform calls a strategy:

```
QuestionStrategy.buildPlan(domain, context) → InterviewPlan
```

Phase 1 implements `AuthoredPackStrategy` only. **FDE scenario interviews** later become `ScenarioStrategy` (a scenario brief plus staged reveals rather than a flat question list) with no change to the graph, the policy, or scoring. This is the seam that makes "scenario/problem-solving rather than simple Q&A" an implementation, not a rewrite.

**Seam 2 — `capabilities`, frozen into the plan at open.** The room mounts workspaces from `plan.capabilities`, exactly as `rubricSnapshot` is frozen today. Phase 1 declares `["VOICE"]` and the room ignores the rest. Adding `CODE_SANDBOX` or `WHITEBOARD` later means a new workspace component plus a capability value — the room's turn loop is untouched.

Freezing matters: a domain config edited mid-flight must not change a running attempt. Same rule already applied to `plan` and `rubricSnapshot`.

**Seam 3 — `TurnSubmission` instead of a bare answer string.** This is **the highest-value decision in the plan.** Today the whole chain is `answerText: string` — Server Action → service → graph channel → `InterviewTurn.answerText`. A code sandbox or whiteboard produces evidence that is not a sentence. Introduce now, while only `text` is populated:

```
TurnSubmission {
  text: string                  // spoken transcript, or typed fallback
  artifacts?: TurnArtifact[]    // Phase 1: always absent
}
TurnArtifact = { kind: "CODE" | "DIAGRAM" | "FILE", mime, content, meta }
```

If this is deferred, adding a sandbox later rewrites the action signature, the graph's entry channel, the turn record, and every evidence path at once. Introducing the wrapper now costs one type and a field.

**Seam 4 — string-keyed competencies, JSON-stored.** `GeneralInterview` stores five **named columns** (`conceptualScore`, `practicalScore`, …). That cannot express a Behavioral rubric or a Coding/DSA rubric. The platform table stores `competencyScores Json` keyed by string competency id, with a denormalized `overallScore Int` for listing and sorting only.

**Seam 5 — assessment scope as an opaque descriptor.** Replace the cohort's `{ scopeFrom, scopeTo }` day range with `coverage: { label, sections: {id, label}[] }` supplied by the pack. Module reports group by **pack section**, not by cohort module. This is what unblocks the report schema (`min(1).max(31)`).

**Seam 6 — append-only turn rows are already the event log.** `InterviewTurn` is append-only, ordered by an explicit `turnIndex`, and stores prompt, answer, evidence, action, depth, `degraded` and `latencyMs`. The platform's equivalent gets the same shape plus `artifacts` and `clientEventsJson`. **Do not build a separate `InterviewEvent` table in Phase 1** — the recovery and behavioural-analysis requirements are already served by these rows plus the state blob. Revisit only when a concrete analysis query cannot be answered from them.

### 3.3 Concurrency — already satisfied, do not "fix" it

Worth stating so nobody rearchitects for it: the graph holds **no cross-request memory**. One invocation handles one answer; the database is authoritative; the compiled graph is cached per provider instance in a `WeakMap`. Per-candidate isolation is structural, and concurrent sessions already work.

The real concurrency risks are elsewhere and are **operational, not architectural**:

- **Provider rate limits.** `agent/llm/registry.ts` documents that Gemini's free tier allows ~15 requests/day against ~30 per interview, and that Groq rate-limits under load. Open registration multiplies this. Phase 1 must add a per-user concurrent-attempt cap (one open attempt per user) and surface a queue/backoff message rather than degrading a candidate mid-interview.
- **Cost.** Voice-only at open-registration volume means every attempt pays STT + TTS + ~30 LLM calls + one report call. `scripts/measure-interview-cost.ts` exists — run it before launch and set a per-user daily attempt cap.

### 3.4 Voice-only — one honest caveat

The brief specifies voice only, and Phase 1 follows that: the catalogue states a microphone is required, and `MicCheck` gates entry as it does for the cohort.

**However**, the typed path must remain as a *failure* fallback, not as a product mode. The existing room already needs it: `send()` handles an empty transcript, STT returns 422 on silence, and there is a 90-second processing watchdog. Removing the text input entirely means a candidate whose microphone dies mid-interview loses the attempt with no way to finish. Since attempts are unlimited here that is less severe than for the cohort credential — but it still produces an abandoned session and a bad first impression.

**Recommendation:** voice-only in presentation and defaults; keep the typed input reachable after two consecutive STT failures on the same question. Flagged for your decision — if you want it strictly voice-only with no fallback at all, say so and the plan drops it.

### 3.5 Packs: versioned, generated, human-reviewed — as code

You chose LLM-generated with human review. Phase 1 implements review **as pull-request review of committed pack files**, not as an in-app CMS:

- `scripts/generate-interview-pack.ts` drafts a pack from a domain spec and writes `src/features/interview/platform/packs/<slug>/v1.ts`
- a human edits and approves it in a PR
- `assertPackIntegrity` runs at module load, mirroring `question-bank.ts:assertBankIntegrity`
- a published pack version is **immutable**; changes create `v2`. Domains pin `{ packId, version }`

This is the right Phase 1 shape because reports cite question ids permanently — a mutable pack would silently invalidate historical reports. An admin review UI (Phase 3) can later write the same versioned rows to a table; the pinning contract does not change.

**This remains the largest cost in the project.** The cohort bank is 1,256 lines of hand-authored questions with `expectedEvidence`, `minEvidence`, `deepProbes` and `scaffoldProbes` — and that checklist is the only reason a score is defensible. Generation drafts it; it does not remove the review burden. Budget accordingly: two solid packs beats eight thin ones.

### 3.6 Phase 1 domain roster

All eight register; two are `LIVE`.

| Slug | Status | Strategy | Capabilities | Why this status |
|---|---|---|---|---|
| `ai-fluency` | **LIVE** | AUTHORED_PACK | VOICE | Pure conversational; no sandbox needed |
| `behavioral` | **LIVE** | AUTHORED_PACK | VOICE | Pure conversational; exercises a *different* rubric, proving the registry |
| `ai-engineering` | COMING_SOON | AUTHORED_PACK | VOICE | Pack authoring only |
| `technical-screen` | COMING_SOON | AUTHORED_PACK | VOICE | Pack authoring only |
| `ai-system-design` | COMING_SOON | AUTHORED_PACK | VOICE, WHITEBOARD | Needs Seam 2 workspace |
| `agentic-coding` | COMING_SOON | AUTHORED_PACK | VOICE, CODE_SANDBOX | Needs Seam 2 + sandbox |
| `coding-dsa` | COMING_SOON | AUTHORED_PACK | VOICE, CODE_SANDBOX | Needs Seam 2 + sandbox |
| `forward-deployed-ai-engineer` | COMING_SOON | SCENARIO | VOICE | Needs Seam 1 `ScenarioStrategy` |

Picking `ai-fluency` and `behavioral` as the two live domains is deliberate: they need no new capability, and their rubrics differ from each other, which is what actually proves the config layer works.

### 3.7 Later role tracks

Frontend/React, Backend/Node, Full Stack/MERN, ML Engineer become **domain entries with their own packs and rubrics**, not new systems. No architectural work is required beyond authoring, provided Seams 1–5 land in Phase 1.

---

### 3.8 What this branch does NOT have (plan 083)

`more-mock-interviews` is cut from `master`, before the adaptive conversation planner landed on
`interview-agent-2.0`. Absent here: `agent/target-planner.ts`, `agent/coverage.ts`,
`cohort/concepts.ts`, and `InterviewState.askedQuestionIds`. `state.ts:152` advances with
`currentQuestionIndex + 1`.

**What this means for mock interviews, stated plainly so nobody is surprised at demo time:**

- **Adaptive depth works fully.** A strong answer earns a banked deep probe; a weak one earns a
  scaffold; off-topic earns a redirect; "say that again" earns a repeat; "what do you mean by X"
  earns a clarification. Calibration and the competence signal shape the escalation ceiling. This is
  the majority of what makes it feel like an interview.
- **Adaptive ordering does not exist.** Questions are asked in pack order. A candidate who volunteers
  a topic later in the pack will not be routed toward it early.

Do **not** port plan 083 into this branch as part of Phase 1. If adaptive ordering is wanted for mock
interviews, it is a separate plan, and it should land on the cohort path first where it was designed
and reviewed.

---

## 4. Corrections forcing a decision

### 4.1 The room is coupled — pick one

`interview-room.tsx` is 2,072 lines and contains the subtlest code in the system: the analyser wiring,
the `stepTurn` turn machine integration, the processing watchdog, the progressive reveal, and the
audio-vs-transcript reconciliation. It hard-imports `submitInterviewAnswerAction`,
`finishInterviewAction`, `abandonInterviewAction` and calls `/api/interview/tts`.

**Option A — fork it** into `components/mock-interview/mock-interview-room.tsx`.
Honours "do not touch the cohort path" literally. Cost: ~2,072 duplicated lines, and every future
room fix must be made twice in the most bug-prone file in the feature. That divergence is close to
certain, not hypothetical.

**Option B — inject the dependencies (recommended).** Add four optional props to the existing room:

```
submitAnswerAction?  default: submitInterviewAnswerAction
finishAction?        default: finishInterviewAction
abandonAction?       default: abandonInterviewAction
ttsEndpoint?         default: "/api/interview/tts"
```

The cohort call site passes nothing and is byte-identical in behaviour. ~10 lines changed, one shared
room. This *does* edit a cohort-path file, so it is a deliberate, narrow exception to Guardrail 1 —
not a licence to refactor the room.

**DECIDED: Option B** (user, this session). Single shared room, minimum optional DI props, cohort
defaults preserved. No headless-hook extraction in Phase 1 — revisit only after the platform is
working and covered by regression tests. **Hard requirement:** a full cohort interview regression run
after the change, verifying the cohort room behaves exactly as before.

**Rationale kept for the record: B.** Guardrail 1 exists to protect the *credential's correctness*, and
dependency injection with defaults cannot change cohort behaviour — whereas a 2,072-line fork
degrades both rooms over time. If B is chosen, Verification §9 must include a full cohort interview
run as the gate.

### 4.2 `blueprint` — widen the type, do not fake a value

`blueprint` is carried as a graph channel and read by **zero nodes** (verified: `grep -c blueprint
nodes.ts` → 0). It is used only by `policy.ts:openingLine`, which the graph never calls —
`orchestrator.ts:beginInterview` does.

**Do not pass `"DAY_15"` for a mock interview.** It is false data that flows into `InterviewAgentState`
and any future logging or replay, and it directly violates Guardrail 9.

**Do this instead** — a type-only widening, zero runtime change, two lines:

- `agent/graph.ts:179` — `blueprint: InterviewBlueprintKey | string`
- `agent/types.ts:187` — same

The platform passes its `domainSlug`. Nothing reads it; it becomes honest provenance rather than a
lie. If a reviewer prefers stronger typing, introduce
`export type InterviewTrackKey = InterviewBlueprintKey | (string & {})` in `agent/types.ts` and use
that in both places.

---

## 5. Files to touch

### New — platform core

| Path | Note |
|---|---|
| `src/features/interview/platform/types.ts` | `InterviewDomain`, `Capability`, `RubricDefinition`, `TurnSubmission`, `TurnArtifact`, `PlatformPlanContext`, `PackRef` |
| `src/features/interview/platform/domains.ts` | The eight-domain registry + `getDomain(slug)`, `listLiveDomains()`, load-time assertion that every LIVE domain resolves a pack and rubric |
| `src/features/interview/platform/rubrics.ts` | Per-domain `RubricDefinition`s, string-keyed competencies with weights summing to 100 |
| `src/features/interview/platform/question-strategy.ts` | `QuestionStrategy` interface + `AuthoredPackStrategy` |
| `src/features/interview/platform/packs/index.ts` | Pack registry, `getPack(packId, version)`, `assertPackIntegrity` |
| `src/features/interview/platform/packs/ai-fluency/v1.ts` | Authored pack |
| `src/features/interview/platform/packs/behavioral/v1.ts` | Authored pack |
| `src/features/interview/platform/concepts.ts` | Pack-declared concept vocabulary → keeps planner continuity alive (fixes the silent-degradation blocker) |
| `src/features/interview/platform/planner.ts` | `buildPlatformPlan(domain, user)` + `platformOpeningLine(domain, firstName, seed)` |
| `src/features/interview/platform/scoring.ts` | String-keyed competency aggregation. **Copied from `scoring.ts`, not shared** — see guardrails |
| `src/features/interview/platform/report-assembly.ts` | `AssessmentReportDocument` with a `coverage` block instead of `milestone` |
| `src/features/interview/platform/report.ts` | Narrative call; reuses `askForReport` from `report-provider.ts` unchanged |
| `src/features/interview/platform/repository.ts` | All `MockInterview` / `MockInterviewTurn` / `MockInterviewReport` access, every query scoped by `userId` |
| `src/features/interview/platform/service.ts` | start / answer / finish / abandon / catalogue / report reads |
| `src/features/interview/platform/provider.ts` | `resolvePlatformUserId()` — session only, **no enrollment requirement** |
| `src/lib/validations/mock-interview.ts` | Zod at every boundary + `assessmentReportSchema` (no 1–31 day cap) |

### New — routes, actions, UI

| Path | Note |
|---|---|
| `src/app/actions/mock-interview-actions.ts` | `startMockInterviewAction`, `submitMockAnswerAction`, `finishMockInterviewAction`, `abandonMockInterviewAction` |
| `src/app/api/mock-interview/tts/route.ts` | Separate from the cohort TTS route — it reads a different table. Same no-client-text contract |
| `src/app/mock-interviews/page.tsx` | Catalogue (Server Component) |
| `src/app/mock-interviews/[slug]/page.tsx` | Domain detail + start (Server Component) |
| `src/app/mock-interviews/[slug]/attempt/[attemptId]/report/page.tsx` | Report **per attempt** — retakes make a per-domain report ambiguous |
| `src/app/mock-interviews/history/page.tsx` | Past attempts across domains |
| `src/components/mock-interview/catalog.tsx` | Domain cards, LIVE vs COMING_SOON |
| `src/components/mock-interview/session.tsx` | brief → live → done; wraps the **existing** `InterviewRoom` |
| `src/components/mock-interview/report-view.tsx` | Renders `AssessmentReportDocument` |

### New — scripts

| Path | Note |
|---|---|
| `scripts/generate-interview-pack.ts` | Drafts a pack file from a domain spec for PR review |
| `scripts/verify-interview-packs.ts` | Integrity + rubric-coverage checks across all packs |
| `scripts/verify-mock-interview-e2e.ts` | Mock-provider run of a full attempt, no network |

### Edited — narrow and enumerated

| Path | Edit |
|---|---|
| `prisma/schema.prisma` | **Add** `MockInterview`, `MockInterviewTurn`, `MockInterviewReport`. **No change to `GeneralInterview`, `InterviewTurn`, `InterviewReport`, or any existing enum** |
| `src/app/api/interview/stt/route.ts` | Widen auth: accept any signed-in user, not only an enrolled member. Safe because this route **reads no interview row** — it is stateless transcription |
| `src/components/shared/app-footer.tsx` | Add `/mock-interviews` to the chrome-hiding path check, matching the existing `/program/cohort-interview` entry |
| Main navigation component | One catalogue link |

### Explicitly NOT edited

`agent/**` (all 11 nodes, policy, depth, target-planner, coverage, llm/**), `state.ts`, `orchestrator.ts`, `evidence.ts`, `module-scoring.ts`, `scoring.ts`, `rubric.ts`, `report-analysis.ts`, `report-assembly.ts`, `report-provider.ts`, `repository.ts`, `service.ts`, `session.ts`, `cohort/**`, `voice.ts`, `/api/interview/tts`, and every cohort component.

The platform calls `runInterviewTurn` from `agent/index.ts` **directly**, so `orchestrator.ts` needs no edit. `report-analysis.ts` and `report-provider.ts` are imported as-is.

---

## 6. Server vs Client

| Component | Boundary | Notes |
|---|---|---|
| `app/mock-interviews/page.tsx` | **Server** | Calls `listLiveDomains()` + `service.listAttemptsForUser`. Passes plain data only |
| `app/mock-interviews/[slug]/page.tsx` | **Server** | Auth → resolve domain → render. Passes `{ slug, label, blurb, durationSec, questionCount, capabilities }` — all serialisable |
| `app/mock-interviews/[slug]/attempt/[id]/report/page.tsx` | **Server** | Loads and validates the stored document. No client JS, matching the cohort report page |
| `app/mock-interviews/history/page.tsx` | **Server** | Read-only list |
| `components/mock-interview/catalog.tsx` | **Client** | Needs hover/filter state. Receives arrays of plain objects |
| `components/mock-interview/session.tsx` | **Client** | Owns brief → live → done, calls Server Actions |
| `components/interview/cohort/interview-room.tsx` | **Client** (unchanged) | Already accepts only plain props plus two callbacks |
| `components/mock-interview/report-view.tsx` | **Server** | Pure render, mirroring `report-view.tsx` |

**Server→Client prop audit.** Only strings, numbers, booleans, plain arrays and plain objects cross. No functions, no icon components, no class instances, no `Date` objects (serialise to ISO strings), no `InterviewDomain` objects carrying strategy functions — the page must project a domain to a plain DTO before passing it. `onFinishedAction` / `onAbandonedAction` are defined **inside** the client `session.tsx`, never passed from a Server Component.

---

## 7. Steps

Ordered. Each step is independently reviewable.

1. **`platform/types.ts`** — define `Capability` (`"VOICE" | "CODE_SANDBOX" | "WHITEBOARD"`), `TurnSubmission`, `TurnArtifact`, `RubricDefinition`, `PackRef`, `InterviewDomain`, `PlatformPlanContext` (a third variant alongside `CohortPlanContext` / `GeneralPlanContext`, discriminated by `kind: "PLATFORM"`).

2. **`platform/rubrics.ts`** — two rubrics: `ai-fluency-v1` and `behavioral-v1`. Competencies are **string ids**, weights sum to 100, each carries `observedAcrossAnswers: boolean` (replacing the hard-coded COMMUNICATION check). Assert the weight sum at module load.

3. **`platform/packs/index.ts` + `assertPackIntegrity`** — mirror `question-bank.ts:assertBankIntegrity`: no duplicate question ids, `minEvidence` satisfiable against `expectedEvidence.length`, `maxFollowUps > 0` requires a `followUpPrompt`, deep probes ascend by level and each declares evidence, scaffolds target a real checklist item, scaffolds require a non-zero follow-up budget. **Additionally:** every question's `competency` must exist in the domain's rubric, and every rubric competency that is not `observedAcrossAnswers` must have at least one question.

4. **`platform/packs/ai-fluency/v1.ts`, `platform/packs/behavioral/v1.ts`** — authored content. Each declares `sections: {id,label}[]`, and each question declares `sectionId` and `conceptTokens: string[]`. Drafted by `scripts/generate-interview-pack.ts`, then human-edited.

5. **`platform/domains.ts`** — the eight-entry registry. Load-time assertion: every `LIVE` domain resolves a pack version and a rubric, and every non-`VOICE` capability belongs to a `COMING_SOON` domain (Phase 1 cannot serve them).

6. **`platform/question-strategy.ts`** — the interface plus `AuthoredPackStrategy`, which maps pack questions to `PlannedQuestion[]` with `sourceRef: { source: "PLATFORM_PACK", label: section label, sourceDays: [] }`.

7. **`platform/planner.ts`** — `buildPlatformPlan(domain, user)` returns `InterviewPlan` with `contextSummary.kind === "PLATFORM"`, `rubricSnapshot` from the domain rubric, and frozen `capabilities` + `packRef`. Plus `platformOpeningLine(domain, firstName, seed)` following the seeded-pool pattern in `policy.ts:openingLine` — **do not** widen `OPENING_FRAMINGS`, which is cohort-typed.

8. **Prisma models + migration** — see §8.

9. **`platform/repository.ts`** — every function takes `userId` and puts it in the `WHERE` clause. `saveTurn` guards on `status: "IN_PROGRESS"` via `updateMany` and swallows a duplicate-`turnIndex` `P2002`, exactly as `repository.ts:saveTurn` does. **No unique index on completion.**

11. **`platform/scoring.ts` + `platform/report-assembly.ts`** — string-keyed aggregation; `coverage` block instead of `milestone`; `filterNarrative` reused **by copy** with the same contract (drop any narrative item whose citations do not resolve to an answered question).

12. **`platform/report.ts`** — one narrative call through the existing `askForReport`. Same prompt contract: the model is shown no scores and must cite question ids.

13. **`lib/validations/mock-interview.ts`** — action schemas + `assessmentReportSchema`. Validate the report on **write and read**, matching `repository.ts`.

14. **`platform/service.ts`** — start (one open attempt per user; abandon-and-restart), answer, finish, abandon, catalogue reads, report reads. Attempt numbering is `max(attemptNumber) + 1` per (user, domain).

15. **`platform/provider.ts` + `app/actions/mock-interview-actions.ts`** — `resolvePlatformUserId()` reads `auth()` only and requires a non-deleted `User`. Actions pass ids downward and never accept a plan, state, score, or question index.

16. **`app/api/mock-interview/tts/route.ts`** — copy the cohort route's contract exactly: body is `{ attemptId, line: enum, variant: int }` with **no text field**; the line is composed server-side from the attempt's own transcript or a `room-lines.ts` constant; `Cache-Control: no-store, private`; `X-Interview-Line` header.

17. **Widen `/api/interview/stt` auth** — accept any signed-in user. Keep auth before `request.formData()`, keep every upload guard.

18. **Routes and UI** — catalogue, domain page, session wrapper around the existing `InterviewRoom`, per-attempt report, history.

19. **Scripts** — `verify-interview-packs.ts`, `verify-mock-interview-e2e.ts` (mock provider, no network), and `generate-interview-pack.ts`.

20. **Navigation + footer** — catalogue link; add `/mock-interviews` to the footer path check.

---

## 8. DB safety

Schema and data change, so this section is mandatory.

**Before any migration:**

1. Commit all work and record the hash: `git rev-parse HEAD` → note it in the PR description.
2. Take a Neon branch snapshot of production **before** running anything.
3. Confirm `DATABASE_URL` points at the intended environment. This repo has no dev/test DB boundary in code (see §"Not implemented" in the architecture doc), so this is a manual check.

**The migration is purely additive.** Three new tables, one new enum. It does **not** touch `GeneralInterview`, `InterviewTurn`, `InterviewReport`, `InterviewBlueprint`, `GeneralInterviewStatus`, or the partial unique index. There is no data backfill and no destructive statement.

```
MockInterview
  id, userId (FK User, onDelete Cascade)
  domainSlug String            -- resolved against the code registry, not an enum
  packId String, packVersion Int
  attemptNumber Int            -- max+1 per (userId, domainSlug)
  status MockInterviewStatus   -- NOT_STARTED|IN_PROGRESS|COMPLETED|ABANDONED|INVALID
  plan Json, state Json, transcript Json, evidence Json
  capabilities String[]        -- frozen at open
  competencyScores Json        -- string-keyed; NOT named columns
  overallScore Int?            -- denormalized for listing/sorting only
  summary String?
  durationSec Int?, invalidReason String?
  startedAt, endedAt, evaluatedAt, createdAt, updatedAt
  @@index([userId, status])
  @@index([userId, domainSlug])
  -- NO unique index on completion: retakes are the point

MockInterviewTurn
  id, interviewId (FK Cascade)
  turnIndex Int, questionId String, sectionId String
  depthLevel Int, action String
  promptText String, answerText String
  artifacts Json?              -- Seam 3; always null in Phase 1
  clientEvents Json?           -- Seam 6; always null in Phase 1
  evidence Json?, degraded Boolean, latencyMs Int?
  @@unique([interviewId, turnIndex])
  @@index([interviewId, questionId])

MockInterviewReport
  id, interviewId (FK Cascade) @unique
  version Int, overallScore Int
  report Json, narrativeDegraded Boolean, generatedAt
```

**`User` gains one relation:** `mockInterviews MockInterview[]`. Verify this does not collide with the Plan 078 relations already on `User` (lines 321+).

**Migration steps, in order:**

1. Edit `prisma/schema.prisma` (additive only).
2. `npx prisma migrate dev --name mock_interview_platform` on a **branch database**.
3. `npx prisma generate`.
4. Run `scripts/verify-mock-interview-e2e.ts` against the branch DB with `INTERVIEW_LLM_PROVIDER=mock`.
5. Confirm the cohort interview still opens, answers and completes against the branch DB — this is the regression that matters.
6. Only then apply to production.

**Plan 078 note.** `MockInterview.userId` is a direct `User` FK and does **not** pass through `repositories/`. That is correct: 078 covers candidate/learning/progress/talent/points/credential data, and a mock interview attempt is none of those. Do not route it through the repository layer, and do not use `programMember` anywhere in `platform/**`.

---

## 9. Verification

**Must pass:**

- `npx tsc --noEmit` clean
- `npm run build` clean
- `scripts/verify-interview-packs.ts` — integrity + rubric coverage for both live packs
- `scripts/verify-mock-interview-e2e.ts` — full attempt with the mock provider, asserting: attempt row created, N turn rows written in order, report generated and validated, `attemptNumber` increments on a second run

**Manual:**

1. Sign in as a user with **no cohort enrollment** → `/mock-interviews` renders, two LIVE cards, six COMING_SOON.
2. Start `ai-fluency` → mic check → room opens → first question is spoken.
3. Answer three questions by voice → confirm follow-ups/escalations occur and `MockInterviewTurn` rows accumulate.
4. Finish → report renders at `/mock-interviews/ai-fluency/attempt/<id>/report`.
5. **Retake the same domain** → succeeds, `attemptNumber = 2`, both attempts visible in `/mock-interviews/history`.
6. Start `behavioral` → confirm its **different rubric** appears in the report competencies.
7. **Cohort regression:** open a Day 15 interview as an enrolled member, answer, complete, view the report. Nothing changed.
8. Confirm `/api/interview/tts` still refuses a `text` field, and `/api/mock-interview/tts` does too.
9. Attempt to read another user's attempt report by id → resolves to "not available", not their report.

**Exactly these files should have changed:** everything in §4 under New and Edited. If a diff touches anything in the "Explicitly NOT edited" list, stop and re-read this plan.

---

## 10. Guardrails for Cursor (DO NOT)

1. **DO NOT modify anything on the cohort execution path.** The list in §4 is exhaustive. A cohort interview is a once-per-lifetime credential; a mock interview is practice. Never make the credential riskier to serve practice.
2. **DO NOT relax, drop, or make conditional the `GeneralInterview_one_completed_per_blueprint` index.** If retakes seem to require it, you are editing the wrong table.
3. **DO NOT add `requireRole` / `requireAdmin` to public surfaces.** `/mock-interviews` and `/mock-interviews/[slug]` are for any signed-in user; the catalogue itself may be viewed signed-out. Mark public routes explicitly.
4. **DO NOT import anything from `@/lib/*` into `middleware.ts` or its import graph.** If a new route needs matcher changes, flag it — the 1 MB Edge bundle limit is real.
5. **DO NOT accept text in the TTS route.** The body is `{ attemptId, line, variant }`. Accepting text turns a paid speech API into an open TTS service for any registered user. `variant` is a bounded integer taken modulo an authored pool.
6. **DO NOT let a client send a plan, state, score, question index, rubric, domain config, or capability list.** The only client contributions are: a domain slug, an attempt id, a question id, and answer text.
7. **DO NOT resolve identity from a parameter.** `resolvePlatformUserId()` takes no arguments, exactly as `resolveInterviewMemberId()` does.
8. **DO NOT share `scoring.ts` / `report-assembly.ts` between cohort and platform by refactoring them to be generic.** Copy the ~80 lines. A shared refactor puts a live graded assessment behind every future platform change, and 078 is already in flight nearby. Duplication is the cheaper risk here; note it in the file header so it is a decision, not an accident.
9. **DO NOT introduce a `blueprint` value, a cohort day number, or `ProgramMember` anywhere under `platform/**`.**
10. **DO NOT make packs mutable.** A published pack version is frozen; changes create a new version. Reports cite question ids permanently.
11. **DO NOT let a model choose questions, competencies, scores, or whether to escalate.** Generation drafts pack *content* offline for human review; at runtime the model only reads answers and writes prose. `LLM_ACTIONS` stays as it is.
12. **DO NOT create new abstraction files beyond those listed.** No `platform/utils.ts`, no generic `InterviewFactory`. If a helper is trivial, inline it.
13. **DO NOT implement code execution, whiteboard, scenario strategy, an event table, or an admin pack-review UI.** Define the seams (§3.2) and stop. Adding them is a later plan.
14. **DO NOT persist `TargetChoice.reason`/`considered[]`** in Phase 1 — it is a known future improvement tracked against the cohort path, not something to fork here.
15. **When a build error contradicts an assumption in this plan, trust the error**, gather data, and report back rather than working around it.
16. **Confirm the files were actually written and `npm run build` passes before reporting done.**

---

## 10a. Phase 3 decisions (recorded during implementation)

Two behaviours differ from the cohort path. Both were raised at Phase 3 review and
decided by the user; they are recorded here so the difference reads as a decision.

**Re-weighting the overall score — KEPT.** `overallFromPlatformCompetencies`
excludes unassessed competencies from *both* sides of the division, where the
cohort's `overallFromCompetencies` always divides by the full rubric weight. The
cohort can do that because every candidate is asked every question; a mock
interview can end at any point, and dividing by full weight would report someone
who answered four of seven questions well as having scored badly.

**`MIN_ANSWERED_TO_SCORE = 3`** (revised up from 1). The re-weighting above is
correct and has a failure mode at the low end: with one answer it produces a
confident-looking competency breakdown derived from a single response —
arithmetically sound, completely misleading. Three is the point at which the
average has something to average and a reader sees a pattern rather than an
incident. A candidate may still leave earlier; the attempt closes INVALID,
consumes nothing, and says plainly why.

Counted in ANSWERED QUESTIONS, not evidence keys — deep-probe evidence is filed
under `${id}@L2`, so counting keys would let one question that escalated twice
clear the bar alone.

**Phase 4 note:** the room's exit dialog must warn against leaving below this
threshold, the way the cohort room warns below 50%. `MIN_ANSWERED_TO_SCORE` is
exported from `platform/service.ts` for that purpose — do not re-hardcode it.

---

## 11. Commit message

```
feat(interview): interview platform architecture + mock interview Phase 1

Adds a domain-configurable interview platform on top of the existing
LangGraph engine, open to any registered user rather than cohort members.

- InterviewDomain registry unbundles blueprint into rubric, pack, capabilities,
  duration, report profile and retake policy
- QuestionStrategy seam (AuthoredPackStrategy now, ScenarioStrategy later)
- TurnSubmission wrapper so code/diagram artifacts are additive
- capabilities frozen into the plan, so workspaces mount without touching the loop
- versioned, immutable, PR-reviewed question packs
- MockInterview/Turn/Report tables keyed on userId, unlimited retakes
- two live domains: ai-fluency, behavioral; six registered as COMING_SOON

The cohort interview path is untouched. Code execution, whiteboard, FDE
scenarios, the event log and the pack-review UI are deliberately deferred;
their seams are defined in docs/plans/103.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
