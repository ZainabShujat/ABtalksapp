# 081 — Interviewer conversational realism + animated AI orb

> **Status:** Plan. No code changed by this document.
> **Scope:** the live interview only. No report, no question bank, no scoring, no
> schema, no LangGraph replacement, no realtime voice.

---

## 0. Architecture inspection — where everything actually happens

| Concern | Location | Notes |
|---|---|---|
| **Interviewer response text** | `agent/nodes.ts:370-373` (next question + acknowledgement), `agent/policy.ts` (`REDIRECT_LINE`, `REPEAT_LINE`, `CLOSING_LINE`, `openingLine()`, `resolveAcknowledgement`, `resolveFollowUpText`), `orchestrator.ts:75-87` (opening) | All spoken text is assembled server-side. The model only *drafts* an acknowledgement and a follow-up; both pass through policy filters. |
| **Answer analysis** | `agent/llm/prompt.ts` (`ANALYZE_SYSTEM_PROMPT` + `buildAnalyzeUserMessage`), `agent/llm/json-provider.ts` (parse/validate), `evaluation.ts` (deterministic fallback), `evidence.ts` (evidence arithmetic) | Exactly one LLM call per turn. Returns relevance, matched evidence indices, three axes, flags, a proposed action. |
| **Follow-up / escalate / redirect decisions** | `agent/policy.ts:routeDecision` (authoritative), `agent/depth.ts:decideLadderMove` (direction), `state.ts:advanceTurn` (budgets/termination) | The model's action is a *request*. Policy downgrades it if unaffordable. `ESCALATE` and `COMPLETE` are withheld from the model entirely. |
| **TTS trigger** | `components/interview/cohort/interview-room.tsx:speak()` — `POST /api/interview/tts`, browser `speechSynthesis` fallback | Called on mount for the opening, and after each turn with `turn.data.prompt`. |
| **Interview UI state** | `interview-room.tsx` — `Phase = "idle" \| "listening" \| "processing" \| "speaking"`, plus `turns`, `question`, `progress`, `elapsed`, `error` | `PHASE_COPY` maps phase → label/hint. |
| **Microphone / audio state** | `interview-room.tsx` — `recorderRef` (`MediaRecorder`), `streamRef`, `chunksRef`, `audioRef` | **No `AnalyserNode` exists.** There is currently no amplitude signal anywhere, which Part 2 needs. |

### What already satisfies the brief

Worth stating so we don't rebuild it:

- **Scaffolds are wired.** `question-bank.ts` defines `ScaffoldProbe`;
  `depth.ts:nextScaffoldProbe` prefers one targeting an *uncovered* expected item;
  `policy.ts:217-223` prefers the banked scaffold on a WEAK answer. Requirements
  3 and 9 are already implemented.
- **Praise is already banned** in the prompt ("Do NOT say whether the answer was
  good, complete, correct or wrong… 'Great answer!' … not").
- **Depth escalation on strong answers** — `depth.ts` ladder, requirement 8.
- **"I don't know"** — fixed earlier this session: stuck is checked *before*
  relevance in `routeDecision`, with its own acknowledgement pool.
- **Budgets** — `MAX_FOLLOW_UPS_PER_QUESTION` 2, `MAX_ESCALATIONS_PER_QUESTION` 2,
  `MAX_REDIRECTS_PER_QUESTION` 3, `MAX_REPEATS_PER_QUESTION` 2,
  `STUCK_ANSWERS_BEFORE_EARLY_END` 3. Requirement "time management" needs no change.

### The one genuine behavioural gap

**Requirement 6 — clarification requests.** Today `REPEAT` covers "repeat,
rephrase or clarify the question", and `REPEAT_LINE` is `"Sure — here's the
question again."` — it restates and nothing more. A *content* clarification
("What do you mean by locally?") has nowhere to go: the prompt explicitly says
*"you do not answer the candidate's questions"*, so the model either forces it
into REPEAT (restated, question unanswered) or into OFF_TOPIC (redirect — the
candidate gets told off for asking a reasonable question).

That is the only requirement with no mechanism behind it.

---

## 1. PART 1 — implementation plan

### 1.1 New bounded action: `CLARIFY`

Add `"CLARIFY"` to `AGENT_ACTIONS` and to the model-proposable subset.

**Semantics:** the candidate asked what something in the question *means*. The
interviewer answers briefly, restates the question, and the question stays on the
floor.

**Bounds — all enforced in `policy.ts`, not the prompt:**

| Rule | Value |
|---|---|
| Cap | `MAX_CLARIFICATIONS_PER_QUESTION = 2` (new constant), over cap → `REPEAT`, then `NEXT_QUESTION` |
| Evidence | none recorded — joins `REDIRECT`/`REPEAT` in the no-evidence branch at `nodes.ts:247` |
| Budget | spends no follow-up or escalation budget |
| Scoring | cannot affect it — no evidence, no attempt consumed |
| Length | model gloss capped like acknowledgements (~200 chars), no question mark permitted inside it |
| Leak guard | prompt forbids naming expected-evidence items; the restatement is the **verbatim banked question**, never a reworded one |

Spoken shape: `<one-sentence gloss>\n\n<verbatim question text>`. If the model
drafts nothing usable, it degrades to today's `REPEAT_LINE` — so a provider
failure never leaves the candidate without an answer.

**Why the model may draft here when it may not elsewhere:** a gloss is
conversation, not assessment. It records no evidence and moves no score. The
banked question text is still what gets asked.

### 1.2 Prompt changes (`prompt.ts` only)

1. Split clarification out of `REPEAT`: `REPEAT` = "could not hear / say it
   again"; `CLARIFY` = "what does X mean". Add an explicit line that a
   clarification request is **never** `OFF_TOPIC` and **never** penalised.
2. Add to the acknowledgement rules: *do not repeat the candidate's answer back
   to them; refer to at most one concrete thing they said.*
3. Add: *if `ALREADY ESTABLISHED ON THIS QUESTION` already covers an item, do not
   draft a follow-up targeting it* (requirement 7, within-question).
4. Add `"CLARIFY"` to the JSON schema line and a `clarification` string field.

`json-provider.ts` and `agent/types.ts` gain the `clarification` field and the
widened action enum. No other parsing changes.

### 1.3 Opening (`policy.ts:openingLine`)

Already greets by name, frames the milestone, states length and that follow-ups
happen, and gives permission to think out loud / say "I don't know". **Add one
clause**: that they can ask to repeat or clarify at any point. Requirement asks
for "explain that it will ask about their submitted work" — add a half-clause for
that too. Target stays ~4 short sentences; it is spoken, not a T&C.

### 1.4 Explicitly NOT doing: skipping banked questions

Requirement 7 taken to its limit — "don't ask a question they already answered" —
would mean **skipping planned questions**. That breaks the assessment: two
candidates must answer a byte-identical CORE set for scores to be comparable
(`planner.ts` is explicit about this). So requirement 7 is implemented
*within* a question — no re-probing a covered item — and **not** across
questions. Flagging as a decision, not an omission.

---

## 2. PART 2 — the orb

### 2.1 Amplitude — the missing signal

`startRecording()` currently creates a `MediaRecorder` only. Add, on the same
stream: `AudioContext` → `createAnalyser()` (fftSize 256) → `getByteTimeDomainData`
in a `requestAnimationFrame` loop, writing RMS into a **ref**, not state.

State would re-render the transcript sixty times a second. The orb reads the ref
inside its own rAF loop and writes a CSS custom property, so React never
re-renders on audio. Teardown on `recorder.onstop` and on unmount, alongside the
existing track cleanup.

### 2.2 Component

`src/components/interview/cohort/interview-orb.tsx` `[new]` — one presentational
component, no data access:

```ts
type OrbState = "idle" | "speaking" | "listening" | "candidate" | "evaluating";
{ state: OrbState; amplitudeRef?: RefObject<number> }
```

Mapping from the existing `Phase` — no new state machine:

| Phase | OrbState |
|---|---|
| `speaking` | `speaking` |
| `listening` + amplitude ≈ 0 | `listening` |
| `listening` + amplitude > threshold | `candidate` |
| `processing` | `evaluating` |
| `idle` | `idle` |

### 2.3 Visual behaviour

| State | Motion |
|---|---|
| Speaking | 4.5s ease-in-out scale 1 → 1.06, glow opacity tracks a slow noise curve. Alive, not a spinner. |
| Listening | 6s breathing, scale 1 → 1.02, ring at rest. Clearly "your floor". |
| Candidate | ring radius driven by the amplitude custom property, damped (`transition: 90ms`) so it reads as a soft ripple rather than a VU meter. |
| Evaluating | 2.4s restrained pulse, opacity only, no scale — deliberately reads as thinking, not loading. |
| Idle | 8s, scale 1 → 1.01. Almost static. |

Transitions: a single `transition: transform 600ms cubic-bezier(.22,1,.36,1), opacity 400ms` on the wrapper, so state changes cross-fade rather than snap.

### 2.4 Design tokens — reuse only

Everything comes from `interview.css` `--iv-*`, which is already the ABTalks 2.0
palette: `--iv-accent` `#E05226`, `--iv-accent-soft` `#FFECE3`, `--iv-surface`
`#FFFFFF`, `--iv-border` `#E0E0E0`.

Orb = concentric SVG circles: a soft `#FFECE3` halo, an `#E05226` core at low
opacity, a thin `--iv-border` ring. **No** purple, gradients beyond a single
same-hue radial, glassmorphism, neon, particles, or new fonts.

### 2.5 Reduced motion

`interview.css` already has a `prefers-reduced-motion` block; extend it to the
orb classes. Reduced motion → **all keyframes off**, state conveyed by opacity
step-changes plus the existing text label. Amplitude reactivity is disabled
entirely (it is motion by definition).

### 2.6 Surrounding UI

Unchanged except the orb replacing the current mic-circle block. Keeps: title/
milestone, timer, current question, state label, mic control, transcript, End
interview. Nothing added.

---

## 3. Files to touch

| File | Change |
|---|---|
| `src/features/interview/constants.ts` | `[edit]` `MAX_CLARIFICATIONS_PER_QUESTION = 2` |
| `src/features/interview/agent/types.ts` | `[edit]` `CLARIFY` in `AGENT_ACTIONS` + proposable subset; `clarification` field |
| `src/features/interview/agent/llm/prompt.ts` | `[edit]` §1.2 |
| `src/features/interview/agent/llm/json-provider.ts` | `[edit]` parse `clarification` |
| `src/features/interview/agent/policy.ts` | `[edit]` clarification branch + cap; `resolveClarification()`; opening clause |
| `src/features/interview/agent/nodes.ts` | `[edit]` `CLARIFY` joins the no-evidence branch |
| `src/features/interview/agent/mock-provider.ts` | `[edit]` emit a CLARIFY case so tests cover it offline |
| `src/components/interview/cohort/interview-orb.tsx` | `[new]` the orb |
| `src/components/interview/cohort/interview-room.tsx` | `[edit]` analyser + rAF amplitude ref; render orb; phase→OrbState |
| `src/components/interview/cohort/interview.css` | `[edit]` orb keyframes + reduced-motion |
| `scripts/verify-interview-adaptive.ts` | `[edit]` cases for clarification cap and no-evidence guarantee |

**Server vs Client:** orb is `"use client"`, presentational, receives a
`RefObject<number>` and a string union — no functions, no class instances, no
icons across the boundary. Everything under `features/` stays server-side.

---

## 4. Guardrails (DO NOT)

- **DO NOT** let `CLARIFY` record evidence, spend follow-up/escalation budget, or
  count as an answer.
- **DO NOT** let the model reword the banked question — the restatement is verbatim.
- **DO NOT** let the model reveal expected evidence in a gloss.
- **DO NOT** add model-proposable `ESCALATE` or `COMPLETE`.
- **DO NOT** skip planned CORE questions.
- **DO NOT** touch the question bank, rubric, scoring, evidence arithmetic, report,
  or any `report-*.ts`.
- **DO NOT** change the schema or add a migration.
- **DO NOT** drive the orb from React state on every audio frame.
- **DO NOT** introduce new colour tokens, fonts, gradients, glassmorphism or
  particles; `--iv-*` only.
- **DO NOT** touch files outside §3.

---

## 5. Verification

1. `npx tsc --noEmit`
2. `npx eslint src/features/interview src/components/interview`
3. `npm run test:interview` (5 runnable verifiers; voice one needs `OPENAI_API_KEY`)
4. `npm run test:interview:adaptive` — eval harness
5. Opening: greeting, coverage, submitted-work mention, follow-up warning, clarify permission, then question — as its own paragraph
6. Strong answer → escalation, no praise
7. Vague answer → banked scaffold targeting an uncovered item
8. **"What do you mean by locally?"** → gloss + verbatim restatement, no redirect, no evidence recorded, question still on the floor
9. Off-topic → single standard redirect line, not argumentative
10. "I don't know" → accepting acknowledgement, moves on, recorded unanswered
11. Orb: speaking → listening → candidate → evaluating → speaking, smooth throughout
12. `prefers-reduced-motion: reduce` → no keyframes, state still legible

Manual passes run on the sample DB with `npm run dev:interview`.

---

## 6. Commit message

```
feat(interview): clarification handling + animated interviewer orb

Conversation: adds a bounded CLARIFY action so "what do you mean by X"
is answered and the question restated, instead of being redirected as
off-topic or silently repeated. Records no evidence, spends no budget,
capped at 2 per question. Opening now mentions submitted work and the
right to ask for clarification.

UI: adds an amplitude-reactive interviewer orb (speaking / listening /
candidate / evaluating / idle) on the existing --iv-* tokens, driven by
an AnalyserNode through a ref so audio never re-renders React. Honours
prefers-reduced-motion.

No change to the question bank, rubric, scoring, report or schema. The
model still cannot escalate, complete, or score.
```
