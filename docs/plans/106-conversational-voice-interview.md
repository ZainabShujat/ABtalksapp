# Plan 106 — Conversational voice interview: barge-in, two-stage phrasing, streamed speech

> Branch: `more-mock-interviews` (already checked out — this plan creates no branch and switches none).
> Scope: the **mock interview platform** (`/mock-interviews`, `features/interview/platform/**`).
> The **cohort** interview (`/program/ai-cohort/cohort-interview`, `features/interview/cohort/**`,
> `app/actions/interview-actions.ts`, `/api/interview/tts`) must behave **identically** after this
> plan as before it. Every shared file is changed by ADDING an opt-in seam, never by changing a
> default.

---

## 1. Goal

Make the mock interview sound like a person conducting an interview rather than a form being
processed: the candidate can interrupt the interviewer mid-sentence and be understood, the
interviewer's reactions are written from a structured reading of what was actually said, and the
silence between turns is cut and covered rather than endured.

---

## 2. Audit — what is actually causing each symptom

Every claim below is a line I read, not an inference.

### 2.1 Dead air / response delay

The post-answer gap is **fully serial and fully buffered**. Nothing overlaps.

```
T0  candidate stops       turn-state.ts emits "finalize" after silenceMs (4.5s in mock)
    |                     -- the 4.5s window is INSIDE T0; it is not counted below
    MediaRecorder.stop() is async; onstop builds ONE blob (no timeslice, deliberate)
T1  POST /api/interview/stt        whisper-1, whole file uploaded then transcribed
T2  submitMockAnswerAction         Server Action round trip
    repo.loadActiveAttempt         1 query (awaited BEFORE the model - not overlapped)
T3  runInterviewTurn -> gpt-4o     ONE call, ~3.5k-token prompt, temperature 0, max_tokens 1100
    repo.saveTurn                  1 write
T4  (no separate phrasing step - see 2.3)
T5  POST /api/mock-interview/tts   DB read + gpt-4o-mini-tts, FULL buffer
T6  client: await res.blob()       whole MP3 downloaded, THEN new Audio(url).play()
```

Four specific, fixable causes:

1. **TTS is buffered end to end, twice.** `synthesizeLine` does `await res.arrayBuffer()`
   (`voice.ts:396`) and the route sets `Content-Length` and returns the whole body
   (`api/mock-interview/tts/route.ts:124`). The client then does
   `URL.createObjectURL(await res.blob())` before `new Audio()` (`interview-room.tsx:857`).
   Time-to-first-audio is therefore *full synthesis + full download*, when it could be ~200 ms.
   This is the single largest self-inflicted delay and it needs no new vendor.
2. **The gap is unfilled.** Nothing is spoken or shown between T1 and T6. `processingLabel` is the
   word "Thinking" on screen; there is no audio. Silence of 4–9 s reads as a freeze.
3. **`loadActiveAttempt` is awaited before the model call** (`service.ts:379`). `nextTurnIndex` was
   correctly overlapped (`service.ts:428`) but the attempt load was not.
4. **A 350 ms sleep before re-opening the microphone** (`interview-room.tsx:1575`), plus the
   `phase === "idle" && speakingRef.current === null` gate. Becomes moot under barge-in, where the
   mic never closes.

Not fixable without a new vendor: **STT latency itself**. `whisper-1` is batch-only. Streaming STT
(Deepgram Nova-3) would return the transcript *at the moment speech ends*. Flagged in §9.

### 2.2 Robotic / overly short responses

`resolveAcknowledgement` (`policy.ts:568`) is well built and is **not** the cause — it correctly
drops hollow acks via `HOLLOW_ACK` and allows up to 200 chars. The cause is upstream: the model that
writes the acknowledgement is doing five other jobs in the same completion.

### 2.3 Mediocre follow-ups — the root cause

**One `gpt-4o` call at `temperature: 0` produces all of this simultaneously**
(`prompt.ts:ANALYZE_SYSTEM_PROMPT`, ~4,000 tokens of system instruction):

- relevance classification
- `matchedEvidence` against the checklist
- three evidence axes + flagged issues
- the routed action proposal
- `followUpReason` + `targetDetail`
- `followUpQuestion`
- `acknowledgement`
- `bridge`
- `clarification`
- `simplified`

`followUpReason` and `targetDetail` **already exist** (`types.ts`, `json-provider.ts:validate`) and
the prompt already instructs "decide them BEFORE you write the question." But there is no
enforcement that the question was written *from* them — it is one JSON object, so the model emits
all fields in one pass and nothing makes the reasoning precede the prose.

Two structural problems follow:

- **`temperature: 0` is correct for assessment and wrong for prose.** The comment on `AskJson`
  (`json-provider.ts:36`) says exactly this and applies the exception only to `phraseQuestions`. So
  every conversational line in the live interview is generated at temperature 0 — deterministic
  phrasing is precisely what makes an interviewer sound scripted.
- **Prose instructions dominate the assessment prompt.** Roughly 60% of `ANALYZE_SYSTEM_PROMPT` is
  "how to sound like a real interviewer". That token mass is charged on every turn and competes for
  attention with the evidence checklist.

### 2.4 Rigid question transitions

`resolveBridge` exists and is spoken (`nodes.ts:updateState`), so transitions are not bare. But the
bridge comes from the same temperature-0 call, and is capped and dropped by the same validators, so
in practice a meaningful share of turns fall through to `lead = ""` and the next banked question is
spoken cold.

### 2.5 "Day N" framing

**Already correct on the mock path.** `question-strategy.ts:70` sets `sourceDays: []`, and the
platform packs carry no day references. The day-number leakage the brief describes is a *cohort*
concern, and the cohort is explicitly out of scope. No change needed; a test will pin it.

### 2.6 Inability to interrupt TTS

Half-duplex by construction:

- `interview-room.tsx:1567-1576` — recording only starts when `phase === "idle"` **and**
  `speakingRef.current === null`. While the interviewer speaks the microphone is **not open at all**.
- `turn-state.ts:stepTurn` — `INTERVIEWER_SPEAKING` is in the early-return list; audio frames are
  discarded before any rule runs.
- The primitive is already written: `cancelSpeech()` (`interview-room.tsx:610`) cuts the `<audio>`
  element *and* `speechSynthesis`, with the comment "barge-in needs exactly this call the instant the
  candidate starts speaking."

The real obstacle is **acoustic, not architectural**: `getUserMedia` is opened with
`echoCancellation: true` (`interview-room.tsx:1040`) but TTS plays through a bare `new Audio(url)`
outside any WebAudio graph. Browser AEC references the system output, so it works, but imperfectly
on laptop speakers. If we simply open the mic during playback, the analyser hears the interviewer,
`hasSpoken` flips on our own voice, and the recorder feeds the question back into STT — the exact
failure the code comments warn about.

### 2.7 Cost baseline

`gpt-4o` judge, `whisper-1` STT, `gpt-4o-mini-tts` TTS, all via `OPENAI_API_KEY`.
`INTERVIEW_LLM_PROVIDER=openai`, `ENABLE_INTERVIEW_VOICE=true` locally. No Deepgram / ElevenLabs /
Cartesia key exists in this environment.

---

## 3. Files to touch

### New — full-duplex audio and barge-in

| Path | | Note |
|---|---|---|
| `src/features/interview/duplex.ts` | `[new]` | Pure. Barge-in detection rule over analyser frames while the interviewer speaks: onset threshold, sustain, and an echo guard keyed on interviewer output level. No DOM, `now` injected. |
| `src/features/interview/interruption.ts` | `[new]` | Pure. `InterruptionKind` union, the classifier's Zod schema, and the deterministic pre-classifier (regex for the unambiguous REPEAT/CLARIFY forms) that avoids an LLM call on the obvious cases. |
| `src/features/interview/agent/llm/interrupt-prompt.ts` | `[new]` | System + user prompt for interruption classification. |
| `src/features/interview/agent/llm/phrase-turn-prompt.ts` | `[new]` | System + user prompt for **stage 2** conversational phrasing, plus the curated few-shot set. |
| `src/features/interview/telemetry.ts` | `[new]` | One `recordSpan` / `readSpans` module for the T0–T6 marks, model/provider, retries, tokens, degraded state, interruption kind, estimated cost. Server-side, per-attempt, in-memory + `logger.info`. |
| `scripts/verify-interview-barge-in.ts` | `[new]` | Tests 1–13 of the brief. Deterministic, no network. |
| `scripts/verify-interview-phrasing.ts` | `[new]` | Tests 14–17: two-stage phrasing with an injected fake `askJson`. |
| `scripts/measure-mock-interview-cost.ts` | `[new]` | The `measure-interview-cost.ts` sibling for the **platform** path, so before/after cost is measured on the thing that changed. |

### Edited — conversational quality

| Path | | Note |
|---|---|---|
| `src/features/interview/agent/llm/prompt.ts` | `[edit]` | Split `ANALYZE_SYSTEM_PROMPT`: keep assessment, move all prose craft to the new stage-2 prompt. Shrinks the per-turn system block by roughly half. |
| `src/features/interview/agent/llm/provider.ts` | `[edit]` | Add optional `phraseTurn(input)` and `classifyInterruption(...)` to `InterviewLLM`. **Optional** — the cohort provider path is unaffected when they are absent. |
| `src/features/interview/agent/llm/json-provider.ts` | `[edit]` | Implement both new methods on the shared provider. Stage 2 runs at `temperature: 0.8`; stage 1 stays at 0. |
| `src/features/interview/agent/nodes.ts` | `[edit]` | `analyzeAnswer` keeps the single assessment call. A new `phraseTurn` node runs stage 2 **only** when the routed action needs prose and the caller opted in. |
| `src/features/interview/agent/graph.ts` | `[edit]` | Add the `phraseTurn` node between `routeResponse` and the branch nodes, conditional on `conversational: true` in `RunTurnInput`. Default false so the cohort graph is byte-identical in behaviour. |
| `src/features/interview/agent/policy.ts` | `[edit]` | `resolveAcknowledgement` / `resolveBridge` / `resolveFollowUpText` prefer stage-2 output when present, existing decision fields otherwise. Validators unchanged. |
| `src/features/interview/agent/types.ts` | `[edit]` | `TurnPhrasing` type, `recentMoves` on state, interruption fields on `InterviewDecision`. |
| `src/features/interview/state.ts` | `[edit]` | Track `recentMoves` (last 5) so stage 2 can be told not to repeat a conversational move. |

### Edited — barge-in, streaming, latency

| Path | | Note |
|---|---|---|
| `src/features/interview/turn-state.ts` | `[edit]` | `INTERVIEWER_SPEAKING` becomes audio-reactive **when `allowBargeIn` is set in `TurnInput`**. Emits a new `"bargeIn"` effect. Absent the flag, behaviour is exactly as today — this is what keeps the cohort safe. |
| `src/components/interview/cohort/interview-room.tsx` | `[edit]` | Full-duplex capture; TTS routed through WebAudio; streaming playback; `bargeIn` effect handling; truncated-line reconciliation; thinking line; new props `allowBargeIn`, `onInterruptionAction`, `thinkingLine`. All default off. |
| `src/features/interview/voice.ts` | `[edit]` | `synthesizeLineStream` returning a `ReadableStream`; keep `synthesizeLine` for the cohort. Add a TTS **provider seam** (`INTERVIEW_TTS_PROVIDER`) so a premium vendor drops in without touching the route. |
| `src/app/api/mock-interview/tts/route.ts` | `[edit]` | Stream the body (chunked, drop `Content-Length`). Keep `X-Interview-Line`. |
| `src/features/interview/platform/service.ts` | `[edit]` | `recordAnswer` gains `conversational: true`; new `recordInterruption(...)` that classifies and routes without advancing; telemetry spans; overlap the attempt load. |
| `src/features/interview/platform/repository.ts` | `[edit]` | Persist interruption turns (kind, interrupted line, char offset) on the existing turn record. |
| `src/app/actions/mock-interview-actions.ts` | `[edit]` | `submitMockInterruptionAction`. |
| `src/lib/validations/mock-interview.ts` | `[edit]` | Its Zod schema. |
| `src/components/mock-interview/session.tsx` | `[edit]` | Pass `allowBargeIn`, the interruption action, and the thinking line. |
| `package.json` | `[edit]` | `test:interview:barge-in`, `test:interview:phrasing`, `measure:mock-interview`. |
| `docs/CHANGELOG.md` | `[edit]` | One dated `## Pending reconcile` line. |

**No schema migration.** Interruption data rides on the existing `MockInterviewTurn` JSON columns.

---

## 4. Server vs Client

| Component | Boundary |
|---|---|
| `interview-room.tsx` | **Client.** Already `"use client"`. Receives `allowBargeIn: boolean`, `thinkingLine: string`, and `onInterruptionAction` — a serialisable Server Action reference, matching the existing `submitAnswerAction` prop shape. |
| `session.tsx` (mock) | **Client.** Wraps actions in `useCallback`, as today. |
| `duplex.ts`, `interruption.ts`, `turn-state.ts` | Pure, no `server-only` — imported by both client and test scripts. |
| `telemetry.ts`, `voice.ts`, `service.ts` | **Server only** (`import "server-only"`). |
| `/mock-interviews/[slug]/page.tsx` | **Server.** Passes `MIN_ANSWERED_TO_SCORE` down as today. |

No functions, icons or class instances cross the boundary. The new props are booleans, strings, and
Server Action references — the same three kinds already crossing it.

---

## 5. Steps

### Phase 0 — measure before touching anything (gate: a number)

1. `scripts/measure-mock-interview-cost.ts` — drives the **real** platform graph with a scripted
   mixed-answer set, reads `usage` back from OpenAI, prices speech from the duration constants.
   Records LLM calls/turn, tokens, and $/interview.
2. `telemetry.ts` + spans in `service.ts`, `voice.ts` and both routes. Instrument T0–T6 plus
   STT/evaluator/planner/phrasing/TTS-TTFB.
3. Run 5 local interviews end to end and record p50/p90. **This is the before-number every later
   claim is measured against.** No optimisation happens before this step produces output.

### Phase A — kill the buffering (largest latency win, no new vendor)

4. `voice.ts`: `synthesizeLineStream` — same request, return `res.body` rather than
   `await res.arrayBuffer()`.
5. `api/mock-interview/tts/route.ts`: return the stream. Drop `Content-Length`. `X-Interview-Line` is
   available before the first byte, so the header contract is unchanged.
6. `interview-room.tsx`: replace `await res.blob()` then `new Audio(objectUrl)` with a streaming sink.
   `MediaSource` + `SourceBuffer` for `audio/mpeg` where supported; fall back to the current
   buffered path where it is not, so nothing regresses.
7. Re-measure TTFB. Expected: full-synthesis-then-download becomes first audio at ~200–400 ms.

### Phase B — full duplex and barge-in

8. `interview-room.tsx`: route TTS playback through the existing `AudioContext` via
   `createMediaElementSource`, and keep a **live output-level ref**. This is what makes the echo
   guard possible: the mic analyser's reading is compared against known interviewer output rather
   than against a fixed threshold.
9. Keep the microphone stream and analyser **open across the whole turn**. `startRecording` no
   longer waits on `speakingRef.current`. `getUserMedia` constraints stay
   `echoCancellation / noiseSuppression / autoGainControl: true, channelCount: 1` — AEC is doing
   real work here and must not be relaxed for a livelier waveform.
10. `duplex.ts` — `stepBargeIn(ctx, { micRms, ttsOutputLevel, now })`:
    - require sustained mic energy over `BARGE_IN_SUSTAIN_MS` (start 300 ms, tuned in step 12)
    - require the mic level to exceed the interviewer's output level by a **margin ratio**, so
      residual echo (which tracks output) cannot trigger it while a real voice (which does not) can
    - a hard floor so a silent room with loud TTS can never trip
11. `turn-state.ts`: when `allowBargeIn` is set, `INTERVIEWER_SPEAKING` consults `stepBargeIn` and
    emits `"bargeIn"`. Without the flag the early return is untouched.
12. **Tune against real audio.** Not a guess: capture analyser traces from a real machine speaking
    over real TTS at three speaker volumes, and pick thresholds off those traces. The brief's "do
    not blindly use arbitrary RMS thresholds" is the acceptance bar for this step.
13. Room `bargeIn` handling, in this order and synchronously:
    - `cancelSpeech()` (already exists — cuts audio element and `speechSynthesis`)
    - abort any in-flight TTS fetch (`AbortController`), so queued audio never arrives
    - `stopReveal()` and **freeze the transcript at the revealed char count** — do NOT run the
      `finally` block's full-line reveal. Persist the truncation offset.
    - mark the line non-resumable (a generation bump; `speakGenRef` already provides this)
    - `openTurn(now)` and switch UI to candidate-speaking
    - the recorder is already running, so capture is continuous — no restart, no lost onset

### Phase C — understand the interruption

14. `interruption.ts`: deterministic pre-classifier for unambiguous forms ("say that again",
    "repeat that", "what do you mean by X", "sorry, what") to REPEAT / CLARIFY with **no LLM call**.
    Everything else goes to the model.
15. `classifyInterruption` on the provider: given the **truncated** interviewer line, the full
    question on the floor, recent transcript and the utterance, return
    `CLARIFY | REPEAT | ANSWER | CORRECT | ADD_INFORMATION | OTHER` plus a short reason.
    Small prompt, small output, `temperature: 0`.
16. `service.recordInterruption` routing:
    - **REPEAT** — re-speak the server's current question via the existing `repeat` line kind.
      Nothing advances, no evidence, no budget.
    - **CLARIFY** — reuse the existing `CLARIFY` path (`resolveClarification` + verbatim restatement).
      Nothing advances.
    - **ANSWER** — hand to `recordAnswer` unchanged. It is an answer that arrived early.
    - **CORRECT / ADD_INFORMATION** — append to transcript as candidate context and re-merge evidence
      on the open question via `mergeEvidence`; the question stays on the floor.
    - **OTHER** — treated as REDIRECT under the existing redirect budget.
    Enforced invariant: **only the ANSWER branch may call `advanceTurn`.** A test asserts the
    question index and evidence keys are unchanged on the other five.
17. Duplicate-submission guard: an interruption carries the `speakGenRef` generation it interrupted;
    the server rejects a second submission bearing the same generation.

### Phase D — two-stage conversational phrasing

18. Split `prompt.ts`. Stage 1 keeps relevance, `matchedEvidence`, the three axes, flags, the action
    proposal, `followUpReason` and `targetDetail`. All prose craft moves out.
19. `phrase-turn-prompt.ts` — stage 2 receives the **structured intent**, exactly as the brief
    specifies: `candidateAnswer`, `followUpReason`, `targetDetail`, `whatIsKnown` (merged prior
    evidence), `whatIsMissing` (unmatched checklist items, **paraphrased so no evidence item leaks
    verbatim**), `currentQuestion`, `recentConversation`, `recentMoves`. Returns
    `{ acknowledgement, bridge, followUpQuestion, move }`.
20. Curated few-shot set — 8–10 real interviewer follow-ups drawn from the good/bad pairs already in
    `ANALYZE_SYSTEM_PROMPT`, kept in one exported const so the wording that shapes every interview is
    reviewable in one diff.
21. `temperature: 0.8` on stage 2 only. Stage 1 stays at 0 — assessment must stay reproducible.
22. `recentMoves` in state (last 5), fed to stage 2 as "do not repeat these moves." Complements the
    existing `recentOpeners`, which varies wording; this varies the *move*.
23. Stage 2 is **skipped** when the action is REPEAT, REDIRECT or ESCALATE (all banked text) and when
    the answer was a non-response — so it costs nothing on the turns that do not need it.
24. Stage 2 output flows through the **existing** validators unchanged (`speakable`,
    `acknowledgesSomething`, the 200-char cap, the no-question rule). A stage-2 failure falls back to
    the stage-1 fields, which fall back to the deterministic pools. Three levels, no new failure mode.

### Phase E — cover the remaining gap

25. Thinking line: as soon as the room enters `processing`, speak one server-composed line from
    `room-lines.ts` (new `thinking` kind, several authored variants, chosen by the existing variant
    counter). Interruptible like any other line. **Only when the measured gap exceeds ~1.5 s**, so a
    fast turn is not padded with chatter.
26. Overlap `loadActiveAttempt` with the incoming request parse in `recordAnswer`.
27. Enable OpenAI **prompt caching** by keeping the stage-1 system block byte-stable and putting all
    variable content in the user message. At least 1024 stable tokens are cached at a 50% input
    discount — this makes the split *cheaper*, not just better.

### Phase F — verify

28. `verify-interview-barge-in.ts` — brief tests 1–13, deterministic, synthetic analyser frames
    including a recorded echo trace for test 12 and a recorded room-noise trace for test 13.
29. `verify-interview-phrasing.ts` — brief tests 14–17 with an injected fake `askJson`; asserts the
    follow-up contains a token from `targetDetail`, that no expected-evidence item leaks, and that
    stage-1 evidence output is byte-identical to today's for a fixed input.
30. Existing suites, all must pass unchanged: `verify-interview-turn-state`,
    `verify-interview-turntaking`, `verify-interview-agent`, `verify-interview-conversation`,
    `verify-interview-adaptive`, `verify-interview-grounding`, `verify-interview-packs`,
    `verify-interview-report`, `verify-interview-voice`, `verify-mock-interview-e2e`,
    **`verify-cohort-interview`** and **`smoke-cohort-interview`** (test 19 — the cohort regression).
31. `npx tsc --noEmit` and `npm run build`.
32. Re-run `measure-mock-interview-cost` and the 5-interview latency pack. Report before/after.

### Phase G — real browser acceptance

33. Run the dev server through the Browser pane and sit interviews A–K from the brief. Record the
    measured candidate-stop to interviewer-start latency from the telemetry spans, not by feel.
    Nothing is reported complete on a green build alone.

---

## 6. Guardrails (DO NOT)

- **DO NOT create or switch branches.** Work stays on `more-mock-interviews`.
- **DO NOT change cohort behaviour.** `allowBargeIn`, `conversational` and `phraseTurn` all default
  off/absent. If `verify-cohort-interview` or `smoke-cohort-interview` changes output, the change is
  wrong.
- **DO NOT touch `agent/depth.ts`, `policy.ts:routeDecision`, `state.ts:advanceTurn`, `evidence.ts`,
  `scoring.ts`, `module-scoring.ts`, `rubric.ts`, or any pack.** Question selection, budgets,
  escalation and scoring are not in scope. Stage 2 writes prose only.
- **DO NOT let stage 2 influence assessment.** It runs *after* routing and receives no ability to
  change the action, the evidence, or the question. Its output passes the existing validators.
- **DO NOT raise stage-1 temperature above 0.**
- **DO NOT let an interruption advance the question index** except on the ANSWER branch.
- **DO NOT resume interrupted TTS**, ever, on any path.
- **DO NOT relax the `getUserMedia` constraints** to make the waveform livelier. AEC is load-bearing.
- **DO NOT pick barge-in thresholds by guessing.** They come from captured traces (step 12).
- **DO NOT add `requireRole` / `requireAdmin` to the TTS or STT routes.** They gate on session +
  ownership in the WHERE clause, which is correct and deliberate.
- **DO NOT let the TTS route accept text.** It takes an id and a line KIND. Interruption handling must
  not become a hole in that.
- **DO NOT hide provider failures.** 429, timeout, truncation, invalid JSON and quota each get their
  own logged reason, as `json-provider.ts` and `openai-provider.ts` already do. No new generic catch.
- **DO NOT add abstraction files beyond the eight listed in §3.**
- **DO NOT import `@/lib/*` into anything reachable from `middleware.ts`.** `duplex.ts`,
  `interruption.ts` and `turn-state.ts` are client-reachable and must stay dependency-free.
- **DO NOT replace real behaviour with mocks to make a test pass.**

---

## 7. DB safety

None required. No schema change, no migration, no seed, no data mutation. Interruption records ride
on existing JSON columns of `MockInterviewTurn`.

---

## 8. Verification

**Must pass:** every script in step 30, `npx tsc --noEmit`, `npm run build`.

**Files that should have changed:** exactly those in §3 and nothing else. In particular
`prisma/schema.prisma`, `middleware.ts`, `auth.ts`, `auth.config.ts`, `src/repositories/**` and every
cohort-only module must be untouched.

**Manual:** brief items A–K in a real browser, with measured latency.

---

## 9. Open dependency — premium speech vendors

No Deepgram, ElevenLabs or Cartesia key exists here. Two upgrades are therefore **designed for but
not shipped** by this plan:

- **Streaming STT (Deepgram Nova-3).** Would return the transcript at the moment speech ends,
  removing 1–3 s from every turn. This is the largest remaining latency item after Phase A.
- **Premium TTS (ElevenLabs Flash v2.5 / Cartesia Sonic / Deepgram Aura-2).** Materially more natural
  than `gpt-4o-mini-tts`, with 40–200 ms time-to-first-byte.

Phase A step 4 puts a provider seam behind `INTERVIEW_TTS_PROVIDER` so either drops in as one adapter
file plus an env var, with no route or room change.

---

## 10. Cost

See the chat summary accompanying this plan. Headline: the shippable path moves the interview from
roughly $0.08 to roughly **$0.11–0.14** per completed interview. Adding premium streaming speech
(§9) would take it to roughly **$0.25–0.35**.

---

## 11. Commit message

```
feat(mock-interview): barge-in, two-stage conversational phrasing, streamed speech

Full-duplex audio with echo-guarded barge-in detection, an interruption
classifier that cannot advance the interview, a phrasing stage separated from
the assessment call, and streamed TTS. Cohort interview behaviour is unchanged:
every seam is opt-in and defaults off.
```
