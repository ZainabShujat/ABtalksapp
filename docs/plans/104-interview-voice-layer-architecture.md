# 104 — Interview voice layer: realtime transport vs. the LangGraph brain

**Status:** architecture decision. Nothing here is implemented. **No code was changed to produce it.**
**Blocks:** plan 103 Phase 4 (the mock-interview room).
**Verified against:** branch `more-mock-interviews` @ `5d33f99`. Every repository claim below was read,
not assumed. External vendor claims are cited with the doc page they came from.

---

## 1. Goal

Answer one question before Phase 4 is built: **can a realtime conversational voice layer
(LiveKit Agents, Deepgram Voice Agent, or a native speech-to-speech model) be introduced while
LangGraph remains the authoritative interview brain — and is it cheaper than what we run today?**

Short answer: **yes to the architecture, no to the cost premise.** The diagram you drew is buildable,
and exactly one of the two candidates is buildable *on our current stack*. But every realtime voice
product on the market is **5–10× more expensive per interview than the turn-based STT/TTS we already
run**, because they bill wall-clock connection time while we bill only the seconds someone actually
speaks. The realtime layer buys latency and barge-in, not savings.

---

## 2. Current behaviour — the actual data flow

This is traced from source, file and line.

### 2.1 The graph

`src/features/interview/agent/graph.ts:117` builds an 11-node `StateGraph` over an
`Annotation.Root` with 22 channels (`graph.ts:59-88`): `plan`, `interviewState`, `currentQuestionId`,
`evidence`, `followUpCount`, `maxFollowUps`, `depthLevel`, `escalationsAsked`, `decision`,
`nextPrompt`, `finished`, and so on. Topology:

```
START → receiveAnswer → (guard) → analyzeAnswer → routeResponse
          ↓ abort=END                                  ↓ actionBranch
                    followUp | escalate | nextQuestion | redirect | repeat | clarify
                                        ↓
                                   updateState → shouldContinue → complete | END
```

Three properties of this graph decide everything downstream:

1. **It is one-turn, not one-conversation.** `graph.ts:44-48`: *"One invocation handles ONE candidate
   answer and returns the interviewer's next line plus the new persisted state. The graph is not the
   interview loop."* There is no checkpointer, no thread id, no cross-request memory. The database is
   the memory.
2. **It emits a finished utterance, not a token stream.** `runInterviewTurn` (`graph.ts:212`) streams
   internally only to capture executed node names for the trace; the return value is
   `data.prompt: string | null` — a single, complete interviewer line.
3. **Only a bounded subset of decisions is delegated to a model.** `agent/types.ts:57` — `LLM_ACTIONS`
   is `FOLLOW_UP | NEXT_QUESTION | REDIRECT | REPEAT | CLARIFY`. `ESCALATE` and `COMPLETE` are
   *withheld from the model by construction* and decided by `depth.ts` and the budget machine. The
   model reports what it saw; policy decides what that earns.

### 2.2 How a candidate answer enters the graph

Two callers, both server-side, both reload plan and state from the database first:

| Track | Entry | Path |
|---|---|---|
| Cohort | `submitInterviewAnswerAction` → `orchestrator.ts:submitAnswer` (`orchestrator.ts:121`) | resolves provider, calls `runInterviewTurn` |
| Mock platform | `submitMockAnswerAction` → `platform/service.ts:recordAnswer` (`service.ts:337`) | calls `runInterviewTurn` **directly**, deliberately skipping the orchestrator (`service.ts:332-335`) |

`recordAnswer` is the richer of the two and is the one Phase 4 uses. In order it:
`repo.loadActiveAttempt` → derive `minutesLeft` **from the persisted `startedAt`, never the client**
(`service.ts:369-380`) → `runInterviewTurn` → build a `TurnRecord` (evidence keyed
`${questionId}@L${depth}` above L1) → `repo.saveTurn` → return
`{ action, prompt, question, finished, progress }`.

**The security shape matters for everything below.** `mock-interview-actions.ts:22-33` states the
complete set of things a client may send: a domain slug, an attempt id, a question id, answer text,
optional artifacts. Identity comes from `resolvePlatformUserId()`, which takes no arguments. Plan,
state, rubric, scores and capabilities never cross the boundary inbound.

### 2.3 How the graph's response becomes audio

`components/interview/cohort/interview-room.tsx` (2,057 lines) is the transport today:

- **Capture** — `getUserMedia` with explicit constraints, `MediaRecorder` at 64 kbps Opus,
  **no timeslice** (`interview-room.tsx:866`, and the comment at ~1050 explaining that `start(1000)`
  produced headless WebM containers the provider rejected).
- **Turn detection** — one `AnalyserNode` on the same stream (`attachAnalyser`, line 1123) feeding
  the pure state machine in `features/interview/turn-state.ts`: `WAITING_FOR_SPEECH →
  CANDIDATE_SPEAKING → CANDIDATE_PAUSED → ANSWER_FINALIZING`. Thresholds are
  `SPEECH_ON_RMS 0.018 / SPEECH_OFF_RMS 0.012 / SPEECH_SUSTAIN_MS 180`, silence window
  `INTERVIEW_SILENCE_MS 10_000`, no-answer nudge at `NO_ANSWER_MS`. This is **our own VAD and
  endpointing**, already written and already tested headlessly.
- **STT** — `onstop` POSTs the blob to `/api/interview/stt` (line 949). The route
  (`app/api/interview/stt/route.ts`) authenticates *before* reading the body, validates the container
  (rejects anything not starting `1a45dfa3`), calls `transcribeAnswer`, then applies the English-only
  gate and returns `{ text, english }`. **It never submits the answer** — by design
  (`stt/route.ts:26-30`), so spoken and typed answers traverse identical validation.
- **Graph** — the room then calls `send(text)` → the Server Action → `recordAnswer` → `runInterviewTurn`.
- **TTS** — `/api/interview/tts` accepts an **interview id and a line KIND, and no text**
  (`tts/route.ts:20-27`). Every line is composed server-side by `voice.ts:resolveSpeakableLine` from
  the persisted transcript, the open question, or a fixed constant. The synthesized words come back
  in the `X-Interview-Line` header so the room can correct its own transcript to match the audio.
- **Fallback** — if TTS is unconfigured or times out (12 s), the room reads the line with
  `window.speechSynthesis` (`interview-room.tsx:624`).

`features/interview/voice.ts:26-33` already states the position this document is re-testing:
*"Realtime hands the conversation to the model… Realtime is the right tool for a chat; it is the
wrong tool for an assessment."*

### 2.4 The precedent already in the repo

`app/api/program/interview/session/route.ts` mints an OpenAI Realtime ephemeral client secret
(`gpt-realtime`, voice `marin`) for the legacy program exit interview, driven by
`components/program/interview-client.tsx`. That path is **architecture C in production today** — and
it has no LangGraph, no question bank, no depth ladder and no evidence. It is the counterexample, not
the model.

---

## 3. The three architectures, judged against this code

### A. Current — record → STT → graph → TTS

**Authority:** total. The graph is the only thing that decides anything.
**Weakness:** the gap. After the candidate stops talking the room does upload → Whisper → Server
Action → one LLM call → DB write → TTS request → audio decode. On a 90-second answer that is
**roughly 4–9 seconds of silence**, and none of it is interruptible. There is no barge-in: the
microphone is closed while the interviewer speaks (`INTERVIEWER_SPEAKING` closes it by construction).

### B. Realtime transport wrapped around LangGraph

The voice vendor owns audio, VAD, endpointing, barge-in and playback. When it has a finished user
turn it calls **out** to us; whatever text we return is spoken. It never selects a question.

**This is compatible with our graph in principle, and the reason is `LLM_ACTIONS`.** The voice layer
cannot escalate, cannot complete, cannot choose a question, because those actions do not exist
anywhere outside `depth.ts`, `policy.ts` and `state.ts` — all server-side, all reached only through
`runInterviewTurn`. A voice vendor that can only supply a string and receive a string is
structurally incapable of the seven forbidden decisions.

The two hard parts are **identity** and **shape**, covered per-vendor in §4 and §5.

### C. Native speech-to-speech with LangGraph "supervising"

**Not feasible as described, and the reason is structural rather than a missing feature.**

A speech-to-speech model (OpenAI Realtime, Gemini Live) produces audio directly from audio. There is
no text checkpoint between "it decided what to say" and "the candidate heard it". Supervision would
have to be one of:

- *Pre-authorise every utterance* — the model asks the graph for permission before speaking. That is
  architecture B with extra steps, and it forfeits the only thing S2S is bought for (sub-second
  response), because the graph turn is the latency.
- *Instruct and audit* — put the plan in the system prompt, let it run, compare the transcript to the
  plan afterwards. This is what the legacy exit interview does. It **loses**: guaranteed question
  order, the follow-up budget (`followUpBudgetFor`), the depth ladder and escalation gating, the
  `matchedEvidence` checklist that scoring is computed from, `REDIRECT`/`REPEAT` semantics that
  deliberately record no evidence and spend no budget, the English-only gate, and the
  degraded-provider flag the report depends on. `finalizeInterview` (`orchestrator.ts:184`) scores
  **entirely from recorded evidence with no model involved** — an S2S interview produces no evidence
  rows to score, so the report would have to be regenerated from a transcript by a model, which is
  precisely the "score a model can nudge" that `orchestrator.ts:167-176` exists to reject.

**Verdict on C: reject.** Not "later" — it is incompatible with the thing that makes this product an
assessment rather than a chat. Note it also fails the cost brief: OpenAI Realtime is the most
expensive option on this list.

---

## 4. LiveKit specifically

**The integration exists. It does not fit our graph, and the reasons are not fixable by configuration.**

`livekit-plugins-langchain` provides `LLMAdapter(graph=compiled_graph)`, which implements LiveKit's
`llm.LLM` interface by wrapping a compiled LangGraph, converting LiveKit's chat context into
LangChain messages and streaming token output back into the voice pipeline. Four blockers, in order
of severity:

1. **Python only.** The LiveKit docs mark the LangChain integration *Available in: Python*, Node.js
   unavailable. Our graph is `@langchain/langgraph` **1.4.10 in TypeScript**, compiled inside a
   Next.js server bundle, importing `@/lib/db`, `@/lib/logger` and eight feature modules. There is no
   port of `graph.ts` + `nodes.ts` + `policy.ts` + `depth.ts` + `state.ts` to Python that is not a
   second implementation of the assessment — which is the exact failure mode `voice.ts:26` was
   written to prevent.
2. **State shape.** The adapter expects a graph whose state carries a `messages` channel
   (`Annotated[list[BaseMessage], add_messages]`) and explicitly *"does not support non-graph
   patterns"*. Our root annotation has **no messages channel at all**. It carries `plan`,
   `interviewState`, `evidence`, `depthLevel`, budgets. Our transcript is a `TranscriptLine[]` inside
   the persisted state, not a chat history the adapter can populate.
3. **Streaming contract.** The adapter streams `stream_mode="messages"` token output. Our nodes emit
   no tokens; `nextPrompt` is assembled by `policy.ts` from an authored question plus an
   acknowledgement, and `applyEscalate` speaks **authored probe text that is never model-written**
   (`agent/types.ts:141-146`). There is nothing to stream.
4. **It would bypass the service layer even if 1–3 were solved.** The adapter calls the *graph*.
   Everything that makes a turn real — `loadActiveAttempt`, server-derived `minutesLeft`,
   `nextTurnIndex`, the `TurnRecord`, `saveTurn`, the evidence key `${id}@L${depth}` — lives in
   `platform/service.ts:recordAnswer`, **above** the graph. An adapter-driven interview would run the
   graph and persist nothing.

**What a LiveKit bridge would therefore actually be:** not `LLMAdapter`, but a Python LiveKit agent
worker whose `llm` is a thin custom `llm.LLM` that HTTP-POSTs the finished user turn to our Next.js
app and yields the returned string as a single chunk. LangGraph never runs inside LiveKit; LiveKit
never sees the graph. That works — and at that point LiveKit's LangGraph integration is providing
nothing, and we are paying for a Python worker process.

**Deployment cost, which is decisive here:** LiveKit Agents is a long-lived worker process. We are
Vercel serverless + Neon on free tiers. That means a second always-on host, in a second language,
with its own deploy, secrets and monitoring, for a solo developer. LiveKit Cloud's free Build tier is
1,000 agent minutes/month and **5 concurrent agent sessions**, hard-capped with no overage — 1,000
minutes is about **50 twenty-minute interviews a month**, and 5 concurrency is a real ceiling on a
cohort day.

---

## 5. Deepgram Voice Agent specifically

**This one fits, and it is the only candidate that fits our stack.**

Deepgram's Voice Agent API accepts a BYO LLM: any endpoint conforming to the **OpenAI Chat
Completions format** works, configured as `think.provider` with `endpoint.url` and optional
`endpoint.headers`. Deepgram owns the WebSocket, STT, endpointing, barge-in and TTS; when it has a
finished user turn it calls our endpoint and speaks the reply.

Why it fits where LiveKit does not:

- **No new language and no new process.** The endpoint is a Next.js route handler, in TypeScript,
  in this repo, importing `platform/service.ts` exactly as the Server Action does.
- **No new infrastructure.** The browser holds the WebSocket to Deepgram; Deepgram calls our HTTPS
  endpoint. Nothing of ours needs to be always-on. This preserves the free-tier hosting constraint.
- **Identity has a documented carrier.** `endpoint.headers` is configurable per session. We mint a
  short-lived, single-attempt signed token server-side (the same place we already mint the Deepgram
  session config) and Deepgram presents it on every call. The attempt id therefore comes from *our*
  server, never from the conversation.

Three constraints to design against, all real:

1. **The request body is a chat history, not our turn envelope.** Deepgram sends `messages[]`. We do
   **not** trust it for anything except the last user message. The shim reads the token header →
   resolves `{ userId, attemptId }` → calls `service.getOpenQuestion(attemptId)` for the question id
   → calls `service.recordAnswer(userId, attemptId, openQuestionId, { text: lastUserMessage })`. The
   history is discarded. This keeps the §2.2 security shape byte-for-byte: the client (here,
   Deepgram) supplies **only answer text**.
2. **Deepgram's docs do not state streaming requirements for custom endpoints.** Plan for SSE: return
   one `chat.completion.chunk` carrying the whole `prompt`, then `[DONE]`. Our graph has nothing to
   stream anyway (§4.3). **This must be spiked before it is planned as done** — it is the single
   unverified assumption in this document, and it is cheap to test against the $200 free credit.
3. **Barge-in truncates our line.** If the candidate interrupts, the audio they heard is a prefix of
   what we persisted. The room already has machinery for exactly this mismatch —
   `X-Interview-Line` reconciliation — and the equivalent must exist here, or the transcript in the
   report will claim the candidate heard a question they cut off.

The graph's authority is untouched: Deepgram receives a string and returns audio. It cannot escalate,
scaffold, choose a competency, or end the interview, because `finished` is computed by
`shouldContinue` in our process and is the only thing that closes the session.

---

## 6. Is the diagram you drew possible? Yes — here is the exact boundary

```
Candidate 🎙 ──ws──► Deepgram Voice Agent  (audio, VAD, endpointing, barge-in, TTS)
                              │  POST /api/interview/agent/turn   (OpenAI chat-completions shape,
                              │                                    Bearer = signed attempt token)
                              ▼
        [NEW] route: verify token → getOpenQuestion → recordAnswer(...)   ← the ONLY new server code
                              │
                              ▼
                    platform/service.ts:recordAnswer      (unchanged)
                              │
                              ▼
                    runInterviewTurn → LangGraph          (unchanged)
                              │
                              ▼
        prompt: string ──► SSE chunk ──► Deepgram TTS ──► Candidate
```

**The integration boundary is one function call: `service.recordAnswer`.** Everything above it is
transport; everything below it is the assessment. That boundary already exists and is already the
seam both existing callers use — `orchestrator.ts:submitAnswer` and `mock-interview-actions.ts` are
each ~15 lines of glue around it. The voice layer becomes a third caller of the same seam.

**The blocker that is not architectural but is real: latency.** A voice transport does not make the
graph faster. `recordAnswer` logs `llmMs` for exactly this reason (`service.ts:417`) — pull that
metric from production before committing. If a turn is 3–6 s, a realtime transport buys you an
*interruptible* 3–6 s silence, not a conversation. Mitigation is a server-composed thinking line from
`room-lines.ts` spoken while the graph runs — which is architecture-neutral and worth doing in
architecture A regardless.

---

## 7. Cost — the premise is inverted

Per **20-minute interview**, ~8 min candidate speech, ~5 min interviewer speech (~4,500 characters).

| Path | Billing basis | Per interview |
|---|---|---|
| **Current (OpenAI)** — whisper-1 + gpt-4o-mini-tts | seconds of audio | **~$0.12** |
| **Current (Groq)** — whisper-large-v3, browser TTS | seconds of audio | **~$0.02** |
| **Deepgram Voice Agent, BYO-LLM** | **websocket connection time**, $0.050/min | **~$1.00** |
| **Deepgram Voice Agent, standard** | connection time, $0.056/min | ~$1.12 |
| **LiveKit Cloud agent session** | session minutes, $0.010/min after 1,000 free | ~$0.20 + STT + TTS + a host |
| **OpenAI Realtime (legacy path)** | audio in/out tokens | highest of all |
| **Deepgram à la carte** — Nova-3 streaming $0.0048/min + Aura-2 $0.030/1k chars | seconds of audio | **~$0.17** |

LangGraph's own LLM calls (~10–30 per interview) are on top of all rows equally and do not change the
ranking.

**Realtime voice layers are 8–50× more expensive than what we run**, because they bill the wall clock
including every second of thinking, reading and silence, while turn-based billing charges only speech.
There is no free tier that survives contact with a cohort: LiveKit Build is 1,000 agent-minutes and 5
concurrent sessions; Deepgram's $200 credit is genuinely generous (~200 interviews at Voice Agent
rates, ~1,000 at à-la-carte rates) but it is a credit, not a tier.

**If the goal is "cheaper than OpenAI Realtime", we already achieved that in Phase 1 by not using it.**

---

## 8. Evaluation matrix

| | Current (A) | Deepgram Voice Agent (B) | LiveKit Agents (B) | Native S2S (C) |
|---|---|---|---|---|
| Latency after speech ends | 4–9 s | graph time + ~0.5 s | graph time + ~0.5 s | <1 s |
| Barge-in | none | yes | yes | yes |
| VAD / turn detection | ours, `turn-state.ts`, tested | vendor | vendor | vendor |
| Transcript | full, gated for English | full, from vendor | full, from vendor | partial/unreliable |
| Concurrent interviews | limited by LLM provider only | connection-billed, no hard cap | **5 on free tier** | vendor caps |
| Browser support | any browser with `MediaRecorder` | WebSocket, broad | WebRTC, broad | WebRTC |
| New infrastructure | none | **none** | Python worker, always-on | none |
| LangGraph authority | total | total, via §6 shim | total, but adapter unusable | **lost** |
| Cost / 20-min interview | $0.02–0.12 | ~$1.00 | ~$0.20 + hosting | highest |
| Work to reach Phase 4 | wiring already written | new route + token + room rewrite | + a second codebase | rewrite |

---

## 9. Recommendation

**Ship Phase 4 on architecture A, and close the latency gap inside A rather than buying a voice
product to hide it.** Specifically:

1. **Phase 4 as planned in 103 §4.1 Option B** — the mock room is the existing `InterviewRoom` with
   four injected props. No voice vendor involved. This is the deliverable that is currently blocked,
   and nothing in this document should delay it.
2. **Then A+: streaming STT.** Replace the record-then-upload round trip with a browser WebSocket to
   Deepgram Nova-3 streaming, so the final transcript is ready **at the moment speech ends** instead
   of 3–5 s later. This deletes the largest single component of the gap, costs ~$0.04 per interview,
   requires no new infrastructure, and does not touch `turn-state.ts`, the graph, or the service
   layer — `/api/interview/stt` gains a sibling that mints a short-lived Deepgram key.
3. **Then A++: a spoken thinking line** while `recordAnswer` runs, composed server-side in
   `room-lines.ts` like every other room line. Cheap, and it removes the "is it frozen?" reading of
   the remaining silence.
4. **Revisit full realtime only if a measured requirement appears** — specifically if candidates need
   to interrupt the interviewer. If that day comes, **Deepgram Voice Agent with BYO-LLM via §6**,
   never LiveKit's LangGraph adapter, and never native speech-to-speech.

### 9.1 Why this preserves LangGraph authority

Because the seven forbidden decisions are not delegable in this codebase even by accident. Question
selection is `state.ts:currentQuestionIndex + 1`; probing depth is `depth.ts` reading a cleared
evidence checklist; escalation and completion are **removed from the model's action vocabulary** at
`agent/types.ts:57`; scaffolding is `resolveSimplified` validating against the authored question;
competency assignment is the frozen `rubricSnapshot`; termination is `shouldContinue`; and scoring is
`finalizeInterview` with **no model in the path at all**. A transport that can only hand us a string
and receive a string cannot reach any of them. In every option kept here — A, A+, A++, and B if it is
ever built — the transport is on the far side of `recordAnswer`.

### 9.2 Files that would change

**For Phase 4 (recommended, now):**
- `src/components/interview/cohort/interview-room.tsx` `[edit]` — the four DI props from 103 §4.1.
- `src/components/mock-interview/mock-interview-session.tsx` `[new]` — the mock journey shell.
- `src/app/mock-interviews/[slug]/attempt/[attemptId]/page.tsx` `[new]` — the live room route.
- `src/app/api/interview/tts/route.ts` `[edit]` — `resolveSpeakableLine` currently queries
  `prisma.generalInterview` only (`voice.ts:315`); mock attempts need the platform repository.
  **This is a hard blocker for Phase 4 and is already flagged in 103 §2.**

**Additionally, if A+ is taken:**
- `src/app/api/interview/stt/token/route.ts` `[new]` — mints a scoped, short-lived Deepgram key.
- `interview-room.tsx` `[edit]` — a streaming transcript source alongside `MediaRecorder`.

**Additionally, only if B is ever taken:**
- `src/app/api/interview/agent/turn/route.ts` `[new]` — the OpenAI-shaped shim of §6.
- `src/lib/interview-agent-token.ts` `[new]` — mint/verify the per-attempt bearer token.
- `src/app/api/interview/agent/session/route.ts` `[new]` — Deepgram session config + headers.
- a new voice room component `[new]` — the existing room's capture and turn machine become dead code
  on that path.

### 9.3 What does not change, in any option

`agent/**` (graph, nodes, policy, depth, llm/**), `state.ts`, `evidence.ts`, `module-scoring.ts`,
`scoring.ts`, `rubric.ts`, `turn-state.ts`, `orchestrator.ts`, `platform/service.ts`,
`platform/repository.ts`, every pack and rubric, and the entire cohort path. **The graph is not
touched by any option in this document.**

---

## 10. Proposed Phase 4 sequence

| Step | What | Gate |
|---|---|---|
| 4.0 | Pull `llmMs` from production `[mock-interview] turn latency` logs | a number, before any latency work |
| 4.1 | `resolveSpeakableLine` reads platform attempts (103 §2 blocker) | mock TTS speaks the right line |
| 4.2 | DI props on `InterviewRoom` (103 §4.1 Option B) | **full cohort regression run** — the 103 hard requirement |
| 4.3 | Mock attempt route + session shell; exit dialog warns below `MIN_ANSWERED_TO_SCORE` (103 §10a) | a mock interview completes end to end by voice |
| 4.4 | Spoken thinking line during `recordAnswer` | the gap no longer reads as a freeze |
| 4.5 | *Optional* streaming STT (A+) behind a flag, cohort path unchanged | measured reduction in post-speech silence |
| — | Realtime voice layer | **not scheduled.** Reopen only on a measured barge-in requirement |

Steps 4.1–4.3 are plan 103's Phase 4 unchanged. Nothing in this document adds work to it.

---

## 11. Open question for you

One decision is genuinely yours and I have not made it: **is candidate barge-in a requirement?** If
interrupting the interviewer is a product requirement, §6 is the design and it costs ~$1/interview.
If it is not — and in a graded assessment where every candidate should hear the same complete
question, there is a defensible argument that it should not be — then architecture A with steps
4.4–4.5 is strictly better on every axis in §8 except barge-in itself.

---

## Sources

- [LangChain integration guide | LiveKit Documentation](https://docs.livekit.io/agents/models/llm/langchain/)
- [livekit-plugins-langchain · PyPI](https://pypi.org/project/livekit-plugins-langchain/)
- [LiveKit Pricing](https://livekit.com/pricing)
- [LLM Models | Deepgram Docs (BYO / custom endpoint)](https://developers.deepgram.com/docs/voice-agent-llm-models)
- [Voice Agent — Getting Started | Deepgram Docs](https://developers.deepgram.com/docs/voice-agent)
- [Deepgram Pricing](https://deepgram.com/pricing)
