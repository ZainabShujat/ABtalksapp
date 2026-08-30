# 072 — Interview Agent V2: adaptive brain, voice, evidence, report

Supersedes the V1 scope in `067-cohort-milestone-interviews.md` for everything
after the vertical slice. Proctoring, face/ID verification, room scan,
tab-switch monitoring and recruiter surfaces are **explicitly out of scope**.

Nothing in `src/features/interview/` is deleted. Every phase is additive or an
in-place widening of an existing module.

---

## 1. Goal

Turn the working assessment engine into an interview that investigates the
candidate: grounded in what they actually built in the AI Cohort, adaptive in
depth to demonstrated competence, voice-first, and producing a traceable report
where every conclusion points at a specific answer or submission.

---

## 2. Current behavior — the audit

### 2.1 Exists and is good (keep)

| Concern | Where | Verdict |
| --- | --- | --- |
| Turn state machine (budgets, stuck-exit, advance) | `state.ts` `advanceTurn` | Keep unchanged. Pure, correct. |
| Graph: receive → analyze → route → branch → update | `agent/graph.ts`, `nodes.ts` | Keep. One LLM call/turn, no cross-request memory. |
| Model-proposes / server-disposes | `agent/policy.ts` | Keep. This is why adaptivity can be added safely. |
| Provider seam + registry | `agent/llm/*` | Keep. |
| Fixed banks, 21 questions, day-scoped, assert-on-load | `cohort/question-bank.ts` | Keep and extend (§4.1). |
| Deterministic plan freeze + rubric snapshot | `cohort/planner.ts` | Keep, extended. |
| Eligibility: every scope day PASSED | `cohort/eligibility-rules.ts` | Keep unchanged. |
| Attempt lifecycle; INVALID never consumes | `repository.ts`, `service.ts` | Keep. |
| Rubric + weighted aggregation in code | `rubric.ts`, `scoring.ts` | Keep. |
| Result precedence DAY_31 → DAY_15 → legacy | `read-model.ts` | Keep. |

### 2.2 Missing, against the product spec

| Requirement | Status | Gap |
| --- | --- | --- |
| Knows what the candidate built | Absent | `planCohortInterview(blueprint)` never receives a member id. `candidate-context.ts` reads `Enrollment`/`Submission` (60-day challenge), not `ProgramMember`. |
| Live progress vs scope | Absent | `getMemberProgressDay` never called from this feature. |
| Adaptive difficulty | Absent | `difficulty` is a label never read at runtime. |
| Depth escalation on a strong answer | Absent | Follow-up fires only on a *gap*; a complete answer always ends the question. |
| Targeted follow-ups | Partial | Model drafts one; no ladder, fallback is a single static prompt. |
| Semantic off-topic | Partial | LLM flag good; degraded path is 10 hardcoded regexes incl. the literal Prime-Minister case the spec forbids. No PARTIAL state. |
| Question modes | Partial | Covered by wording, no `mode` field ⇒ unenforced, unreportable. |
| Voice | Absent | `<textarea>`. Legacy Realtime route unusable (OpenAI owns the conversation). |
| Structured evidence | Weak | 3 booleans. Which `expectedEvidence` items matched is never captured. |
| Module scoring | Absent | `sourceDays` stored, `modules.json` never imported here. |
| Report | Absent | 5 ints + a summary string. |
| Turn/report persistence | Absent | JSON blobs on one row. |
| Report retrieval | Absent | Rendered inline, lost on navigation. |

### 2.3 Two facts that shape the plan

1. **Migration `20260813000000_general_interview` has never been applied
   anywhere** (`docs/plans/070`) ⇒ editable in place; new tables fold into it.
2. **Branch not merged, predecessor reverted** (`f86245d`). Nothing is live.

---

## 3. Architecture: four layers, kept separate

```
CONVERSATION   agent/graph.ts + nodes + policy      what is said next
ASSESSMENT     evidence → competency → module       what it was worth
VOICE          stt/tts routes + recorder client     transport only
PERSISTENCE    repository.ts + Prisma               authority on state
```

Two rules never relaxed:

- **The model proposes, the server disposes.** Model output is Zod-validated,
  then re-decided by pure code holding the counters. New actions are routed by
  `policy.ts`, never taken directly from the model.
- **The core spine is identical for every candidate.** Adaptivity may change
  *how deep* a question goes and *what is asked beyond the milestone*, never
  *which core questions are asked*.

---

## 4. Phase plan

### PHASE 1 — The adaptive interview brain

#### 4.1 Extend the bank — `cohort/question-bank.ts` [edit]

Add to `CoreQuestion`: `mode` (CONCEPTUAL | IMPLEMENTATION | DECISION |
DEBUGGING | SCENARIO | TRADEOFF | EVIDENCE | REFLECTION | TRANSFER),
`deepProbes[]` (escalation rungs, level 2/3, own `expectedEvidence`),
`scaffoldProbes[]` (simplification, targets one expected item), `groundsOn`
(optional grounding slot). `followUpPrompt` stays the last-resort probe.

Authoring: drafted from `days.json`; **reviewed before it scores anyone**.

#### 4.2 Candidate context — `cohort/candidate-context.ts` [new, server-only]

`ProgramMember` + `ProgramMissionSubmission` + `ProgramProject` +
`collectPassSkipSets` / `getMemberProgressDay` / `getMemberCurrentModuleNumber`.
Yields progressDay, passedDays, currentModule, per-module rollup, submissions
with repo refs, projects, and `beyondScopePassedDays`.

**Non-invention rule, enforced in code:** grounding text is assembled by string
template from these fields, never generated. Missing artifact ⇒ clause omitted.

#### 4.3 Grounded rendering — `cohort/grounding.ts` [new, pure]

At most one factual clause prepended to the **verbatim** bank text. The graded
question is unchanged; only the pointer in front of it is personal.

#### 4.4 Depth ladder — `agent/depth.ts` [new, pure] + `policy.ts` [edit]

New state: `depthLevel: 1|2|3`, `competenceSignal` per competency. New action
`ESCALATE`.

| Answer outcome | Move |
| --- | --- |
| matched ≥ `minEvidence`, rung remains, depth budget left | `ESCALATE` |
| matched ≥ `minEvidence`, no rung | `NEXT_QUESTION` |
| matched < `minEvidence`, follow-up budget, not stuck | `FOLLOW_UP` (scaffold at depth 1) |
| stuck / evasive | `NEXT_QUESTION` |

Two consecutive strong answers in a competency raise its escalation ceiling; two
consecutive weak drop it to scaffold-only for one question, then it recovers.
**A single weak answer never suppresses escalation.**

#### 4.5 Live progress vs scope — extension questions

`planCohortInterview(blueprint, context)` appends ≤2 **EXTENSION** questions from
`beyondScopePassedDays`. `PlannedQuestion.tier: "CORE" | "EXTENSION"`. CORE is
the only input to the comparable overall score; EXTENSION is reported separately.
No beyond-scope days ⇒ plan byte-identical to today's.

#### 4.6 Semantic relevance — `agent/types.ts`, `llm/prompt.ts`, `heuristics.ts`

Add `relevance: "ON_TOPIC" | "PARTIAL" | "OFF_TOPIC"`. OFF_TOPIC → REDIRECT
(no evidence, no budget). PARTIAL → FOLLOW_UP if affordable. ON_TOPIC → ladder.
**Delete the topical regexes from `heuristics.ts`**; degraded path keeps only
structural signals (blank, "I don't know", repeat requests).

### PHASE 2 — Voice (turn-based)  [renumbered: shipped THIRD, see §12]

TTS(question) → play → MediaRecorder → `POST /api/interview/stt` → transcript →
existing action → agent turn → `POST /api/interview/tts`. Graph/service/actions
unchanged. Text fallback always available. Behind `isInterviewVoiceEnabled()`.

### PHASE 3 — Evidence & marking

`AnswerEvidence` gains `matchedEvidence: number[]`, `missingEvidence: number[]`,
`relevance`, and `quote` (≤200 chars, verbatim — the traceability anchor).
Booleans retained so existing consumers keep working.

### PHASE 4 — Module-wise evaluation

`cohort/curriculum.ts` (day→module from `modules.json`) + `module-scoring.ts`.
Unassessed modules report `null`, never 0.

### PHASE 5 — Report

Deterministic skeleton; one bounded LLM pass for prose only. Every strength /
improvement must return `evidenceRefs`; unresolvable refs are **dropped in
code**. That rule is what structurally prevents generic AI fluff.

### PHASE 6 — Persistence

`InterviewTurn` + `InterviewReport` tables, folded into the unapplied migration.

### PHASE 7 — Dashboard

Report page + card link. Reuses numbered-rows / stat / kicker patterns per
`docs/design-system.md`.

---

## 5. Files to touch (Phase 1)

| Path | | Note |
| --- | --- | --- |
| `cohort/curriculum.ts` | [new] | pure day→module map (pulled forward from Phase 4; context needs it) |
| `cohort/candidate-context.ts` | [new] | server-only member context |
| `cohort/grounding.ts` | [new] | pure factual clause |
| `agent/depth.ts` | [new] | pure ladder |
| `cohort/question-bank.ts` | [edit] | `mode`, probes, `groundsOn` |
| `cohort/planner.ts` | [edit] | context arg, CORE/EXTENSION |
| `agent/policy.ts` | [edit] | route ESCALATE, relevance |
| `agent/nodes.ts` | [edit] | `applyEscalate` |
| `agent/graph.ts` | [edit] | one node + edge |
| `agent/types.ts` | [edit] | ESCALATE, relevance, schema |
| `agent/llm/prompt.ts` | [edit] | relevance + escalation |
| `agent/llm/heuristics.ts` | [edit] | remove topical regexes |
| `agent/llm/mock-provider.ts` | [edit] | drive demo scenarios |
| `state.ts` | [edit] | depth, competenceSignal, ESCALATE arm |
| `types.ts` | [edit] | tier, mode, relevance |
| `constants.ts` | [edit] | depth cap |
| `session.ts`, `service.ts` | [edit] | thread memberId into the planner |

---

## 6. Server vs Client

Phase 1 touches no components. All new modules are pure except
`candidate-context.ts` (`server-only`). `ClientQuestion` continues to withhold
`expectedEvidence`, `minEvidence`, `deepProbes`, `scaffoldProbes` — a candidate
who could read the ladder could game it.

---

## 7. DB safety

Phase 1 makes **no schema change**. Migration edits belong to Phase 6, run only
against the separate Neon test DB per `docs/plans/070`, after
`node scripts/db-preflight.mjs` exits 0.

---

## 8. Verification

`npx tsc --noEmit`, `npm run lint`, existing `scripts/verify-*.ts` suites, plus
new adaptive checks: escalation only above `minEvidence`; escalation capped;
one weak answer does not suppress the next escalation, two do; EXTENSION never
enters the overall score; DAY_15 never plans `sourceDays > 15`; PARTIAL never
redirects; OFF_TOPIC records no evidence; every interview terminates.

Plus a runnable local demo (`npm run demo:interview`) showing the decisions.

---

## 9. Decisions — settled 2026-08-20

1. **DAY_31 supersedes** the legacy exit interview. No rows deleted, no table
   dropped; `read-model.ts` already prefers DAY_31 with legacy fallback. Anything
   the legacy implementation does better is harvested — §10.
2. **Storage:** two tables (`InterviewTurn`, `InterviewReport`).
3. **Bank authoring:** drafted here, reviewed before it scores anyone.

## 10. Harvest map — legacy `ProgramInterview`

| Legacy asset | Where | Disposition |
| --- | --- | --- |
| Per-module progress rollup (`passed/total` from `getMemberDayStates` + `modules.json`) | `features/program/interview.ts:80-125` | **Port near-verbatim** into `cohort/candidate-context.ts`. Do not re-derive differently. |
| Project titles from writeups (first line, 120 chars, `adminScore ?? aiScore`) | same | **Port.** Real project name to ground an EVIDENCE question on. |
| `safetyIdentifier` = `sha256(memberId).slice(0,64)` | `interview.ts` + session route | **Port verbatim** into Phase 2 STT/TTS routes. Pseudonymous, no PII. |
| Session client scaffolding: mic permission, countdown + auto-finish, min-duration guard, transcript accumulation, expectations copy | `components/program/interview-client.tsx` | **Port the scaffolding, not the transport.** `RTCPeerConnection` Realtime is deliberately NOT reused — it bypasses LangGraph, the banks and `policy.ts`. |
| Admin reset (`resetCount` cap + `AdminAction` audit) | `adminResetInterview` | **Note only.** `GeneralInterview` needs one eventually; admin surfaces out of scope. |
| Free-form LLM interview where the model returns the scores | `buildInterviewInstructions`, `evaluateInterview` | **Correctly replaced.** A model that both asks and grades produces numbers no two candidates share a scale on. |

---

## 12. Delivery log

Phases were delivered in the order the work was requested, which differs from
the numbering above. Recorded here so the plan and the repository agree.

| Delivered | Plan phases | State |
| --- | --- | --- |
| 1st | Phase 1 — adaptive brain | Done. 37 checks. |
| 2nd | Phases 3–6 — evidence, module scoring, competency scoring, report, persistence, retrieval | Done. 38 checks. |
| 3rd | Phase 2 — voice STT/TTS | Routes, transport and runner done. 12 contract checks. Upstream calls unexecuted (no `OPENAI_API_KEY`). |
| Later | Phase 7 — dashboard report page | Not started. |

### What is verified, and what is not

Verified end to end (`npm run demo:interview:report`): plan → conversation
through the real graph → evidence → scoring → report document → validate on
write → read back → validate on read → traceability audit. 183 checks pass
across six suites; typecheck and lint clean.

**Not executed against a database.** `scripts/db-preflight.mjs` still reports
the only configured `DATABASE_URL` as production (12,613 users), so the two new
tables have never been created and `repository.ts`'s Prisma calls are
typechecked against the generated client but unrun. The e2e uses an in-memory
store performing the identical validate-on-write / validate-on-read. Applying
the migration to a real test database is the first task of the next session.

**Voice upstream calls unexecuted.** No `OPENAI_API_KEY` is configured, so
transcription and synthesis have never been called. The routes, auth, upload
gate and client loop are written and typechecked; the flag
`ENABLE_INTERVIEW_VOICE` is off by default.

## 11. Commit message

```
feat(interview): adaptive depth ladder, grounded questions, semantic relevance

Phase 1 of docs/plans/072. Extends the existing bank, graph and policy rather
than replacing them: the core question spine stays identical for every
candidate, adaptivity lives in depth escalation, scaffolding and
beyond-milestone extension questions.
```
