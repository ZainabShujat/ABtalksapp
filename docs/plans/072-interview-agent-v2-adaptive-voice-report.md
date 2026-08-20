# 072 — Interview Agent V2: adaptive brain, voice, evidence, report

Supersedes the V1 scope in `067-cohort-milestone-interviews.md` for everything
after the vertical slice. Proctoring, face/ID verification, room scan,
tab-switch monitoring and recruiter surfaces are **explicitly out of scope** and
are not deferred items inside this plan — they get their own plan later.

Nothing in `src/features/interview/` is deleted by this plan. Every phase is
additive or an in-place widening of an existing module.

---

## 1. Goal

Turn the working assessment engine into an interview that investigates the
candidate: grounded in what they actually built in the AI Cohort, adaptive in
depth to demonstrated competence, voice-first, and producing a traceable report
where every conclusion points at a specific answer or submission.

---

## 2. Current behavior — the audit

### 2.1 What already exists and is genuinely good

| Concern | Where | Verdict |
| --- | --- | --- |
| Turn state machine (budgets, stuck-exit, question advance) | `state.ts` `advanceTurn` | **Keep unchanged.** Pure, tested, correct. |
| Graph: receive → analyze → route → branch → update → continue? | `agent/graph.ts`, `agent/nodes.ts` | **Keep.** Correct seam; one LLM call per turn; no cross-request memory. |
| Model-proposes / server-disposes policy | `agent/policy.ts` `routeDecision` | **Keep.** This is the reason adaptivity can be added safely. |
| Provider seam + registry (Gemini / Anthropic / mock) | `agent/llm/*` | **Keep.** Swap-by-file already works. |
| Fixed question banks, 21 questions, day-scoped, assert-on-load | `cohort/question-bank.ts` | **Keep and extend** (§4.1). Never regenerate at runtime. |
| Deterministic plan freeze + rubric snapshot | `cohort/planner.ts` | **Keep**, extended for extension questions. |
| Eligibility: every scope day PASSED, pure rules + server gate | `cohort/eligibility-rules.ts`, `cohort-eligibility.ts` | **Keep unchanged.** |
| Attempt lifecycle: stale sweep, resume, INVALID never consumes | `repository.ts`, `service.ts` | **Keep.** Security posture is already right. |
| Rubric + weighted aggregation in code, never from the model | `rubric.ts`, `scoring.ts` | **Keep** as the competency layer; extended by module layer (§4.4). |
| Legacy result precedence DAY_31 → DAY_15 → ProgramInterview | `read-model.ts` | **Keep.** Makes the migration non-breaking. |

### 2.2 What is missing, measured against the product spec

| Requirement | Status | Gap |
| --- | --- | --- |
| Interviewer knows what the candidate built | **Absent** | `cohort/` has no candidate context at all. `candidate-context.ts` reads `Enrollment`/`Submission` (60-day challenge), not `ProgramMember`. The plan is built from `blueprint` alone — the member id is never read. |
| Live progress vs assessment scope | **Absent** | Nothing reads `getMemberProgressDay`. A member interviewing on day 18 is indistinguishable from one on day 15. |
| Adaptive difficulty | **Absent** | Order is fixed bank order; difficulty is a static label never read at runtime. Strong and weak answers produce the same next question. |
| Depth escalation on a strong answer | **Absent** | Follow-up fires only on a *gap*. A complete answer always ends the question. There is no "go one level deeper". |
| Targeted follow-ups | **Partial** | The model drafts one, but with no ladder and no context beyond the last 6 transcript lines; fallback is a single static `followUpPrompt`. |
| Semantic off-topic | **Partial** | LLM path returns an `off_topic` flag (good). Degraded path is 10 hardcoded regexes including the literal Prime-Minister case (spec says do not do this). No partial-relevance state. |
| Question modes (debugging / scenario / trade-off / transfer / reflection) | **Partial** | Bank content covers some by wording; there is no `mode` field, so composition is unenforced and unreportable. |
| Voice | **Absent** | Runner is a `<textarea>`. `/api/program/interview/session` exists but serves the *legacy* Realtime exit interview, where OpenAI owns the conversation — not usable as-is, because LangGraph must own turn logic. |
| Structured per-answer evidence | **Weak** | Three booleans + issue flags. `expectedEvidence` is sent to the model but which items were *matched* is never captured, so nothing can say "could not explain evaluation methodology". |
| Module-wise scoring | **Absent** | `sourceDays` is stored but never mapped to a module. `modules.json` (8 modules, startDay/endDay) is not imported anywhere in `features/interview/`. |
| Report | **Absent** | End state is five competency ints + a 1000-char summary string. No strengths, no gaps, no evidence trail, no recommendation. |
| Persistence of turns/report | **Absent** | Everything is JSON blobs on one row. No `InterviewTurn`. Report has nowhere to live. |
| Dashboard/report retrieval | **Absent** | Result renders inline in the runner and is lost on navigation. |

### 2.3 Two facts that shape the plan

1. **The migration `20260813000000_general_interview` has never been applied
   anywhere** — not production, not a test DB (`docs/plans/070`). It is
   therefore *editable in place*. New tables in this plan fold into that same
   migration rather than stacking a second one on an unapplied first.
2. **The branch is not merged and its predecessor was reverted** (`f86245d`
   reverted PR #168 off `master`). Nothing here is live; there is no production
   data to migrate or protect.

---

## 3. Architecture: the four layers, kept separate

Already true, and this plan preserves it:

```
CONVERSATION   agent/graph.ts + nodes + policy      decides what is said next
ASSESSMENT     evidence → competency → module       decides what it was worth
VOICE          stt/tts routes + recorder client     transport only
PERSISTENCE    repository.ts + Prisma               the authority on state
```

Two rules carried forward from V1 and never relaxed:

- **The model proposes, the server disposes.** Everything the model returns is a
  request validated against a Zod schema and then re-decided by pure code that
  holds the counters. Adaptivity is added *inside* that envelope — new actions
  are routed by `policy.ts`, never taken directly from the model.
- **The core spine is identical for every candidate.** Comparability is the
  product. Adaptivity is allowed to change *how deep* a question goes and *what
  is asked beyond the milestone*, never *which core questions are asked*.

---

## 4. Phase plan

### PHASE 1 — The adaptive interview brain

**Goal:** a candidate who answers well gets pushed deeper; one who struggles gets
scaffolded; both hear questions grounded in work they actually submitted.

#### 4.1 Extend the bank, do not replace it — `cohort/question-bank.ts` [edit]

Add to `CoreQuestion` (all optional except `mode`, so existing entries stay
valid and the compile stays green):

```ts
mode: "CONCEPTUAL" | "IMPLEMENTATION" | "DECISION" | "DEBUGGING"
    | "SCENARIO" | "TRADEOFF" | "EVIDENCE" | "REFLECTION" | "TRANSFER";

/** Escalation ladder. Asked when the answer already cleared minEvidence. */
deepProbes?: { level: 2 | 3; mode: QuestionMode; text: string;
               expectedEvidence: string[] }[];

/** Scaffold ladder. Asked when the answer is below minEvidence. */
scaffoldProbes?: { text: string; targets: string /* which expected item */ }[];

/** Optional grounding slot, filled from real data or omitted entirely. */
groundsOn?: { day: number; artifact: "repo" | "submission" | "project" };
```

`followUpPrompt` stays as the last-resort deterministic probe.

Authoring: I draft `deepProbes` (2 per medium/hard question) and
`scaffoldProbes` (1 per question with `maxFollowUps > 0`) from
`prisma/content/program/days.json`, then **you review before it scores anyone** —
same rule as plan 067 §10.3. Bank version bumps to `2026-08-20.1`.

#### 4.2 Candidate context — `cohort/candidate-context.ts` [new, server-only]

The missing piece. One function, one batched read:

```ts
type CohortCandidateContext = {
  memberId: string; fullName: string; jobRole: string; yearsExperience: number;
  cohortName: string;
  progressDay: number;          // getMemberProgressDay(passedDays)
  passedDays: number[];         // ProgramMissionSubmission.passed
  currentModule: number;        // getMemberCurrentModuleNumber
  submissions: { day: number; title: string; passed: boolean;
                 attempts: number; repoRef: string | null;
                 cleanPass: boolean; submittedAt: Date }[];
  projects: { moduleNumber: number; repoUrl: string;
              writeupExcerpt: string; aiScore: number | null }[];
  githubRepoUrl: string;
  scopeDays: number[];          // from the blueprint
  beyondScopePassedDays: number[]; // passed days > maxScopeDay — §4.5
};
```

Sources, all existing: `ProgramMember`, `ProgramMissionSubmission`
(`payload`, `verdict`, `attemptNumber`), `ProgramProject`, plus
`collectPassSkipSets` / `getMemberProgressDay` / `getMemberCurrentModuleNumber`
from `features/program/progression.ts`. Prisma `select` only.

**Non-invention rule, enforced in code:** grounding text is assembled by string
template from these fields, never generated. If `submissions[day].repoRef` is
null, the grounding clause is *omitted*, not softened. The LLM never receives a
"describe their work" instruction — it receives facts or nothing.

#### 4.3 Grounded question rendering — `cohort/grounding.ts` [new, pure]

`groundQuestion(question, context): { spoken: string; grounded: boolean }`.

Prepends at most one factual clause to the bank text when `groundsOn` matches
real data:

> "You pushed `rag_chatbot.py` for Day 11 on 3 August. " + *verbatim bank text*

The bank text itself is **never rewritten** — comparability survives because the
graded question is identical; only the pointer in front of it is personal. A
question with no matching artifact is spoken exactly as banked.

#### 4.4 Depth ladder — `agent/depth.ts` [new, pure] + `policy.ts` [edit]

New per-question runtime field on `InterviewState`:

```ts
depthLevel: 1 | 2 | 3;              // 1 = core question as banked
competenceSignal: Record<Competency, { strong: number; weak: number }>;
```

New agent action `ESCALATE` (LLM may propose; policy decides), joining
`FOLLOW_UP | NEXT_QUESTION | REDIRECT | REPEAT`.

Deterministic ladder in `depth.ts`, called from `routeDecision`:

| Answer outcome | Next move | Budget consumed |
| --- | --- | --- |
| matched ≥ `minEvidence` **and** a `deepProbes` rung remains **and** depth budget left | `ESCALATE` to level+1 | depth budget (max 2 per question, hard cap in `constants.ts`) |
| matched ≥ `minEvidence`, no rung left | `NEXT_QUESTION` | — |
| matched < `minEvidence`, follow-up budget left, not stuck | `FOLLOW_UP` (scaffold if depth 1, targeted if the model drafted one) | follow-up budget |
| stuck / evasive | `NEXT_QUESTION` | — (unchanged: probing a blank is cruelty) |

The *interview-level* difficulty response falls out of `competenceSignal`: two
consecutive strong questions in a competency raises the escalation ceiling for
that competency by one; two consecutive weak lowers it to zero (scaffold-only)
for the next question in that competency, then it recovers. **A single weak
answer never suppresses escalation** — the spec's "do not punish indefinitely",
expressed as an explicit recovery rule rather than a prompt instruction.

`state.ts` `advanceTurn` gains an `ESCALATE` arm that holds the question index
and increments `depthLevel`; every existing arm is untouched.

#### 4.5 Live progress vs blueprint scope — extension questions

`planCohortInterview(blueprint, context)` gains the context argument and appends
at most **2 EXTENSION questions** drawn from bank entries whose `sourceDays` fall
in `beyondScopePassedDays` (days the member has passed *after* the milestone).

```ts
PlannedQuestion.tier: "CORE" | "EXTENSION";
```

- CORE: fixed, identical for everyone, **the only input to the comparable
  overall score**.
- EXTENSION: current-progress questions, evidence recorded, reported in their own
  "Beyond the milestone" report section, **excluded from the overall score**.

This is the direct answer to "bounded by its blueprint mainly, but add
additional questions based on current progress" — without an extension question
silently making two DAY_15 scores incomparable. If no beyond-scope days are
passed (the member interviewed on time), the plan is byte-identical to today's.

#### 4.6 Semantic relevance — `agent/types.ts`, `llm/prompt.ts`, `heuristics.ts` [edit]

Add to the decision schema:

```ts
relevance: "ON_TOPIC" | "PARTIAL" | "OFF_TOPIC";
```

Routing: `OFF_TOPIC` → REDIRECT (question stays open, no evidence, no budget —
unchanged). `PARTIAL` → FOLLOW_UP if budget allows, else NEXT_QUESTION.
`ON_TOPIC` → the depth ladder decides. Prompt states plainly: judge relevance to
the question on the floor, not by keywords; an on-topic answer containing an
unrelated word is ON_TOPIC.

`heuristics.ts`: **delete `OFF_TOPIC_PATTERNS` and `looksOffTopic`'s topical
regexes**. The degraded path keeps only structural signals that need no
semantics — blank, "I don't know", explicit repeat requests — and returns
`relevance: "ON_TOPIC"` with `NEXT_QUESTION`. Rationale: a keyword list is the
thing the spec forbids, and a *wrong* redirect on a good answer is worse than a
missed redirect during a model outage.

---

### PHASE 2 — Voice interviewer (turn-based)

**Reuse assessment:** the Realtime route at `/api/program/interview/session`
cannot be reused as an implementation — it hands the whole conversation to
OpenAI, which would bypass LangGraph, the banks and the policy. Its *ephemeral
key + server-gate + safety-identifier pattern* is reused verbatim; the transport
is not.

Turn-based loop, one HTTP round trip per turn:

```
TTS(question) → play → MediaRecorder → POST /api/interview/stt
   → transcript → submitInterviewAnswerAction (unchanged) → agent turn
   → prompt text → TTS → play → repeat
```

- `src/app/api/interview/stt/route.ts` [new] — multipart audio → OpenAI
  `gpt-4o-mini-transcribe`. Node runtime, auth + member gate reusing
  `resolveInterviewMemberId`, 25 MB / 120 s cap, returns `{ ok, data: { text } }`.
- `src/app/api/interview/tts/route.ts` [new] — text → audio stream. Text comes
  **only** from the server-held prompt for that interview id (client sends
  `interviewId`, never arbitrary text) so the endpoint cannot be used as a free
  TTS service.
- `src/components/program/interview-voice-runner.tsx` [new, client] — mic
  permission, record/stop, waveform, playback, live transcript, and a **text
  fallback that is always available** (accessibility, and mic failure must not
  burn an attempt).
- `lib/feature-flags.ts` [edit] — `isInterviewVoiceEnabled()`; flag off ⇒ the
  existing text runner renders, unchanged.

The graph, service and actions do not change at all in this phase. Voice is
transport, and the audit confirms the seam already holds: `AnswerTurnData.action`
is already returned "so the voice layer can choose delivery".

---

### PHASE 3 — Evidence & marking

Widen `AnswerEvidence` from three booleans to itemised matching:

```ts
type AnswerEvidence = {
  matchedEvidence: number[];   // indices into question.expectedEvidence
  missingEvidence: number[];
  conceptualFound: boolean;    // kept — existing consumers unchanged
  practicalFound: boolean;
  tradeoffsFound: boolean;
  relevance: Relevance;
  flaggedIssues: IssueType[];
  quote: string | null;        // ≤200 chars, verbatim, the traceability anchor
  reasoning: string;
};
```

`quote` is what makes the report defensible: every later claim cites a real
sentence the candidate said. `mergeEvidence` unions the matched sets (already
OR-semantics — same rule, wider type). `evidence.ts` and `scoring.ts` keep their
current arithmetic; tier derivation gains an itemised path (`matched/expected`
ratio) with the boolean path retained as fallback.

No LLM is trusted with a number anywhere in this phase.

---

### PHASE 4 — Module-wise evaluation

- `cohort/curriculum.ts` [new, pure] — imports `prisma/content/program/modules.json`
  (8 modules, `startDay`/`endDay`) and `days.json`; exports `moduleForDay(day)`,
  `MODULES`, `dayTitle(day)`. Asserts at module load that every day 1..31 maps to
  exactly one module.
- `module-scoring.ts` [new, pure] — every question already carries `sourceDays`;
  map → module, aggregate matched-evidence ratios per module, weight by question
  count, emit `ModuleAssessment[]`:

```ts
{ moduleNumber, title, questionsAsked, score /*0-100*/,
  tier, evidenceRefs: string[] /* questionIds */, note }
```

Modules with no question in the blueprint report `score: null` ("not assessed"),
never 0 — a module the instrument did not cover must not look like a failure.

---

### PHASE 5 — The final report

`report.ts` [new, server-only]. Deterministic skeleton, one bounded LLM pass for
prose only.

Computed in code (never from the model): overall score, competency scores,
module scores, duration, counts, question-by-question evidence table.

LLM pass (`askClaudeJson`, one call) produces only: 3–5 strengths, 3–5 areas to
improve, a 3-sentence summary, and a recommendation — **each item required to
return `evidenceRefs: string[]`** naming the question ids it rests on. Items
whose refs do not resolve to a real answered question are **dropped in code**,
not trusted. That single rule is what stops generic AI fluff structurally.

```ts
type InterviewReport = {
  version: 1;
  candidate: { name, cohort, jobRole };
  milestone: { blueprint, label, scopeDays, takenOnCohortDay, progressDay };
  overall: { score, band, durationSec, questionsAnswered, followUps, escalations };
  modules: ModuleAssessment[];
  competencies: { competency, label, score, tier, justification, evidenceRefs }[];
  strengths: { text, evidenceRefs }[];
  improvements: { text, evidenceRefs, suggestedDays: number[] }[];
  skills: { demonstrated: string[]; partial: string[]; notShown: string[] };
  beyondMilestone: { day, note, evidenceRefs }[] | null;   // EXTENSION answers
  evidence: { questionId, question, mode, module, answerQuote,
              matched: string[], missing: string[], score }[];
  summary: string;
  recommendation: string;
};
```

`suggestedDays` turns every weakness into a concrete "revisit Day 9" — the part
that actually helps the student.

---

### PHASE 6 — Persistence & retrieval

**Recommendation (needs your approval — schema change):** two new tables, not
five. The user-sketched chain is preserved as *typed structure*, but module and
competency assessments live inside the report JSON because they are written
once, always read together with the report, and never queried independently —
five tables would mean five joins for one page and a schema churn we cannot undo
cheaply.

```prisma
model InterviewTurn {
  id            String   @id @default(cuid())
  interviewId   String
  turnIndex     Int
  questionId    String
  tier          String   // CORE | EXTENSION
  depthLevel    Int      @default(1)
  action        String   // NEXT_QUESTION | FOLLOW_UP | ESCALATE | REDIRECT | REPEAT
  promptText    String
  answerText    String
  evidence      Json     // AnswerEvidence, Zod-validated on write
  degraded      Boolean  @default(false)
  latencyMs     Int?
  createdAt     DateTime @default(now())
  interview     GeneralInterview @relation(fields: [interviewId], references: [id], onDelete: Cascade)
  @@unique([interviewId, turnIndex])
  @@index([interviewId])
}

model InterviewReport {
  id           String   @id @default(cuid())
  interviewId  String   @unique
  version      Int      @default(1)
  overallScore Int
  report       Json     // InterviewReport, Zod-validated on write and on read
  generatedAt  DateTime @default(now())
  interview    GeneralInterview @relation(fields: [interviewId], references: [id], onDelete: Cascade)
}
```

`GeneralInterview` keeps `state` as the authoritative runtime blob (unchanged);
`InterviewTurn` is the durable audit trail written inside the same transaction as
`saveTurn`. Both fold into the **existing unapplied migration**
`20260813000000_general_interview` — no second migration, because the first was
never applied (§2.3).

Retrieval: `getInterviewReport(memberId, blueprint)` in `read-model.ts`,
`select`-only, member-scoped.

---

### PHASE 7 — Dashboard integration

- `src/app/program/(app)/cohort-interview/[blueprint]/report/page.tsx` [new,
  Server Component] — the persisted report, permanently retrievable.
- `cohort-interview-card.tsx` [edit] — completed state shows score + "View
  report".
- `program-dashboard-view.tsx` [edit] — one line, links the report.

**Design conformance:** reuses the existing **numbered rows** pattern
(`src/components/design/`) for module scores, **stat** for the overall score and
competency figures, and **kicker** for section heads. Color and type come from
`--foreground` / `--muted-foreground` / `--border` tokens; accent
(`hsl(var(--primary))`) is spent in exactly one place — the overall score stat.
No new pattern is introduced. Standing violations pre-empted: no rounded
corners, no centered headings, no hairline borders, no `dark:` variants, no
gradients, no second font, no accent body text.

---

## 5. Files to touch

**Phase 1**
| Path | | Note |
| --- | --- | --- |
| `src/features/interview/cohort/question-bank.ts` | [edit] | `mode`, `deepProbes`, `scaffoldProbes`, `groundsOn`; version bump |
| `src/features/interview/cohort/candidate-context.ts` | [new] | server-only; the missing member context |
| `src/features/interview/cohort/curriculum.ts` | [new] | pure day→module map from `modules.json` |
| `src/features/interview/cohort/grounding.ts` | [new] | pure; factual clause, never generated |
| `src/features/interview/cohort/planner.ts` | [edit] | takes context; CORE/EXTENSION tiers |
| `src/features/interview/agent/depth.ts` | [new] | pure escalate/scaffold ladder |
| `src/features/interview/agent/policy.ts` | [edit] | route `ESCALATE`; relevance routing |
| `src/features/interview/agent/nodes.ts` | [edit] | `applyEscalate` node |
| `src/features/interview/agent/graph.ts` | [edit] | one new edge |
| `src/features/interview/agent/types.ts` | [edit] | `ESCALATE`, `relevance`, schema |
| `src/features/interview/agent/llm/prompt.ts` | [edit] | relevance + escalation + grounding facts |
| `src/features/interview/agent/llm/heuristics.ts` | [edit] | **remove topical regexes** |
| `src/features/interview/state.ts` | [edit] | `depthLevel`, `competenceSignal`, `ESCALATE` arm |
| `src/features/interview/constants.ts` | [edit] | `MAX_DEPTH_ESCALATIONS_PER_QUESTION = 2` |
| `src/features/interview/types.ts` | [edit] | `tier`, `mode`, widened evidence |

**Phase 2** — `src/app/api/interview/stt/route.ts` [new],
`src/app/api/interview/tts/route.ts` [new],
`src/components/program/interview-voice-runner.tsx` [new],
`src/lib/feature-flags.ts` [edit], `cohort-interview-runner.tsx` [edit: keep as
the text fallback].

**Phases 3–4** — `evidence.ts` [edit], `scoring.ts` [edit],
`module-scoring.ts` [new].

**Phase 5** — `report.ts` [new], `orchestrator.ts` [edit: finalize also builds
the report], `lib/validations/interview.ts` [edit: report Zod schema].

**Phase 6** — `prisma/schema.prisma` [edit — **ask first**],
`prisma/migrations/20260813000000_general_interview/migration.sql` [edit],
`repository.ts` [edit], `read-model.ts` [edit].

**Phase 7** — report page [new], two components [edit].

---

## 6. Server vs Client

| Component | Boundary |
| --- | --- |
| `cohort-interview/[blueprint]/page.tsx` | **Server** — unchanged |
| `.../report/page.tsx` | **Server** — renders the report, no client JS |
| `interview-voice-runner.tsx` | **Client** — needs MediaRecorder + audio |
| `cohort-interview-runner.tsx` | **Client** — unchanged |
| everything in `features/interview/` | **Server** (`server-only` except the pure modules: `state`, `evidence`, `scoring`, `rubric`, `depth`, `policy`, `curriculum`, `grounding`, `question-bank`, `blueprint`, `eligibility-rules`, `module-scoring`) |

Server→Client props stay plain JSON: `CohortInterviewOverview`, `ClientQuestion`,
`InterviewReport`. **No functions, icons or class instances cross the boundary.**
`ClientQuestion` continues to withhold `expectedEvidence`, `minEvidence`,
`deepProbes` and `scaffoldProbes` — a candidate who could read the ladder could
game it.

---

## 7. DB safety

1. Commit checkpoint before any schema edit; record the hash in this file.
2. `node scripts/db-preflight.mjs` must exit 0 — development runs against the
   separate Neon test database per `docs/plans/070`, never production.
3. The migration is **edited in place**, not stacked: `20260813000000` has never
   been applied anywhere (verified — the revert commit `f86245d` removed it from
   `master` and `docs/CHANGELOG.md` records "do not apply/drop that schema on
   production").
4. `npx prisma migrate dev` against the test DB only. I do not run it; I hand you
   the exact command.
5. Production application is Sohail sir's call, after verification.

---

## 8. Verification

Per phase, before "done" is said:

- `npx tsc --noEmit` and `npm run lint` clean; `npm run build` passes.
- Pure-logic checks extended in `scripts/verify-interview-agent.ts`: escalation
  fires only above `minEvidence`; escalation is capped at 2; a single weak answer
  does not suppress the next escalation; two weak answers do; EXTENSION questions
  never enter the overall score; DAY_15 never plans a question with
  `sourceDays > 15`; PARTIAL never redirects; OFF_TOPIC never records evidence.
- `scripts/verify-cohort-interview.ts` extended: full run against the test DB
  producing a persisted report; report items with unresolvable `evidenceRefs`
  are dropped.
- Manual: one strong-answer run (expect escalation, higher module scores), one
  weak run (expect scaffolds, no punishment spiral, honest low report), one
  off-topic run (expect redirect, never an answer), one mic-denied run (expect
  text fallback, attempt survives).

---

## 9. Decisions — settled 2026-08-20

1. **`ProgramInterview` collision.** DAY_31 **supersedes** the legacy exit
   interview. No rows deleted, no table dropped: `read-model.ts` already prefers
   DAY_31 and falls back to legacy, so existing results keep resolving. New
   members stop being routed to the legacy screen. **Anything the legacy
   implementation does better is harvested rather than reinvented — see §11.**
2. **Storage.** Two tables (`InterviewTurn`, `InterviewReport`), folded into the
   unapplied migration.
3. **Bank authoring.** I draft `mode` / `deepProbes` / `scaffoldProbes` for all
   21 questions from `days.json`; **you review before it scores anyone.** The
   machinery ships behind the existing `followUpPrompt` until that review passes.

## 10. Harvest map — what the legacy `ProgramInterview` already does better

Read in full before superseding it. Four things are genuinely better there and
are ported rather than rewritten; the rest is correctly replaced.

| Legacy asset | Where | Disposition |
| --- | --- | --- |
| **Per-module progress rollup** — `loadMemberContext` builds `moduleScores` (`passed/total` per module) from `getMemberDayStates` + `modules.json`/`days.json` | `features/program/interview.ts:80-125` | **Port into `cohort/candidate-context.ts` near-verbatim.** This is exactly the module context Phase 1 needs and Phase 4 scores against. Do not re-derive it differently. |
| **Project titles from writeups** — first line of `ProgramProject.writeup`, capped at 120 chars, with `adminScore ?? aiScore` | same, `projectTitles` | **Port.** Gives the interviewer a real project name to ground an EVIDENCE question on. |
| **`safetyIdentifier`** — `sha256(memberId).slice(0,64)`, sent to OpenAI as `OpenAI-Safety-Identifier` | `features/program/interview.ts` + `api/program/interview/session/route.ts` | **Port verbatim into the Phase 2 STT/TTS routes.** Pseudonymous abuse identifier with no PII — already the right call. |
| **Session client scaffolding** — mic permission flow, 15-min countdown with auto-finish, min-duration guard before submit, transcript-line accumulation, pre-interview expectations copy | `components/program/interview-client.tsx` (447 lines) | **Port the scaffolding, not the transport.** The `RTCPeerConnection` full-duplex Realtime path is deliberately NOT reused — it hands conversation control to OpenAI, which would bypass LangGraph, the banks and `policy.ts`. Everything around it is reusable. |
| Admin reset with `resetCount` cap + `AdminAction` audit row | `adminResetInterview` | **Note only.** `GeneralInterview` has no reset path and will eventually need one, but admin surfaces are out of scope for this plan. Recorded here so it is not rediscovered later. |
| Free-form 15-minute LLM-authored interview; model returns the scores directly | `buildInterviewInstructions`, `evaluateInterview` | **Correctly replaced.** A model that both asks and grades produces numbers no two candidates share a scale on. The bank + rubric + code-side aggregation exists precisely to fix this. |

---

## 11. Commit message

```
feat(interview): adaptive depth ladder, grounded questions, voice, evidence report

Phase-by-phase per docs/plans/072. Extends the existing bank, graph and
policy rather than replacing them: core question spine stays identical for
every candidate, adaptivity lives in depth escalation, scaffolding and
beyond-milestone extension questions.
```
