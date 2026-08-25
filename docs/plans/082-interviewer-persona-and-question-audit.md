# 082 — Interviewer persona & question-bank audit

> **Status:** Audit. **Nothing changed.** No code, no bank edits, no API calls.
> **Scope:** persona/prompt and CORE question quality. UI, orb, TTS/STT, scoring,
> report and schema untouched, and no candidate-specific LLM paraphrasing.

---

## PART A — Where the conversation still becomes scripted

Four findings. The first is the one that actually causes "ten independent
questions" and no amount of prompt wording fixes it.

### A1 — The interviewer can only see the last FOUR transcript lines (blocking)

`prompt.ts:119` — `recentTranscript.slice(-4)`.

Four lines is roughly two exchanges. By question six the interviewer has no idea
the candidate said "I chose FAISS because I needed local vector search" back at
question two.

Everything in your §5 (Memory) and the contradiction example in §4 is
**structurally impossible** right now, not badly prompted. `contradicts_earlier`
exists as a flaggable issue and can almost never fire, because the evidence for
it has already scrolled out of the window.

`priorEvidence` doesn't help: it is keyed per question (`evidenceByQuestionId`),
so it carries what was established on *this* question only.

**Proposal.** Add a compact, rolling **interview memory** to the user message,
separate from the transcript window:

- one line per ANSWERED core question: question id, topic, and the concrete
  nouns the candidate committed to (tools, numbers, decisions)
- built deterministically from evidence already stored, not by a second model call
- capped (~10 short lines) so the tokens-per-minute concern in that same comment
  still holds

Then the prompt can say: *use what they already told you; do not re-ask it; if
this answer contradicts something in the memory, ask them to reconcile it.*

### A2 — Only escalations get a bridge; ordinary transitions do not

`nodes.ts` composes `NEXT_QUESTION` as `acknowledgement + "\n\n" + question.text`.
`bridgeText` is populated **only** on the ESCALATE path (`policy.ts`).

So the most common transition in the whole interview — one core question to the
next — is an acknowledgement followed by an unconnected question. That is the
"question → answer → next question" feel, and it is a wiring gap.

**Proposal.** Allow the drafted `bridge` on `NEXT_QUESTION` too, under the same
guards it already has (no question mark, length-capped, dropped if unusable).
The banked question still follows verbatim. Your §7 example is exactly a bridge.

### A3 — Fallback pools are canned

`NEUTRAL_ACKNOWLEDGEMENTS` / `STUCK_ACKNOWLEDGEMENTS` fire whenever the model
returns nothing usable. "Thanks for walking me through that." is the most
generic line in the system and it appears whenever drafting fails.

**Proposal.** Keep them (a provider outage must not produce silence), but treat
a fallback as a signal to say *less*, not to say something generic — a bare
"Okay." reads as neutral; a canned thank-you reads as not listening.

### A4 — The opening ends on a stock handover

`openingLine` closes with "Let's start here." — serviceable, but it is a
transition phrase of exactly the kind §7 asks us to avoid.

**Proposal.** Drop the handover sentence; let the first question follow the
framing directly. Optionally end with "Ready?" as your §8 suggests — but note
that invites a spoken "yes" which would be consumed as the answer to question
one. **Recommend against it** unless we add a gate turn.

### A5 — Persona wording (already close)

`ANALYZE_SYSTEM_PROMPT` was rewritten last pass and already establishes: senior
engineer who has shipped this, calm, unhurried, no performed enthusiasm, follows
what is interesting, asks what they actually did, "on their side but not easily
satisfied." Praise is banned by example, assessment vocabulary is banned by
list, and em dashes are stripped by `speakable()`.

**Gaps against your §1/§4:** no instruction to **challenge** an answer, and no
instruction to **reconcile a contradiction**. Both are in your list and neither
is currently described. Small prompt additions, and A1 is a prerequisite for the
second.

---

## PART B — Question audit

21 CORE questions: 10 in DAY_15, 11 in DAY_31.

### B0 — The systemic finding, which matters more than any single question

| Bank | Evidence items | `minEvidence` |
|---|---|---|
| DAY_15 | 4 per question | 2 (three questions want 3) |
| DAY_31 | **5 per question** | **3 on every single question** |

**Every DAY_31 question asks a candidate to land three separate evidence items in
one spoken answer.** That is the structural driver of long answers — more than
any individual wording. A candidate optimising for the rubric is being pushed
toward a 90-second checklist recital, which is exactly the failure you described.

The architecture already has the fix: **every question has two deep probes and a
scaffold**. Evidence that currently must arrive in the core answer can be moved
to a probe, where it belongs, without touching scoring — the checklist stays the
same length, it is just gathered across turns rather than in one breath.

**Proposal:** lower DAY_31 `minEvidence` from 3 to 2 on the questions marked
NARROW below, and let the authored follow-up collect the third item. No scoring
change: `scoreQuestion` counts matched items either way.

### B1 — Questions that already fit the 45-second target (9)

No changes proposed.

| ID | Why it works |
|---|---|
| `d15-q09` | One question ("what changed once generation was added?"), long setup does the framing |
| `d15-q04` | One comparison, concrete |
| `d15-q05` | Decision + reason are one thought |
| `d15-q08` | Single, sharp, "what goes wrong if you skip that step" |
| `d15-q06` | A choice plus its reasoning — inseparable |
| `d31-q04` | A paired comparison, genuinely one question |
| `d31-q07` | The best question in the bank: one boundary, one "why" |
| `d31-q11` | Single, well-scoped contrast |
| `d31-q12` | Decision + reason, one thought |

### B2 — Questions needing revision (12)

---

**`d15-q03` — CONCEPTUAL**
**Current:** "Why did the program have you run a model locally with Ollama before using any hosted API?"
**Problem:** Asks the candidate to explain *the curriculum's* intent, not their own reasoning.
**Why it feels unnatural:** No interviewer asks "why did your course make you do this." It invites guessing at a syllabus author's motive, and a candidate who did the work but never wondered why it was assigned is penalised for the wrong thing.
**Proposed:** "What did running the model locally let you learn that a hosted API would have hidden from you?"
**Preserve:** local-vs-hosted contrast; all 4 evidence items; CONCEPTUAL; `minEvidence` 2.

---

**`d15-q01` — CONCEPTUAL** · currently 36 words, the longest in the bank
**Current:** "You split the policy documents into chunks of 500 characters with 50 characters of overlap before embedding them. Why does the overlap matter, and what would you expect to break if you set it to zero?"
**Problem:** Two questions joined by "and".
**Why:** The second half is a strictly better *probe* than a co-question — asked together, candidates answer one and forget the other.
**Proposed core:** "You embedded the policy docs in 500-character chunks with 50 characters of overlap. Why does that overlap matter?"
**Proposed follow-up:** "What would you expect to break if you set the overlap to zero?"
**Preserve:** the 500/50 numbers (grounding); all 4 evidence items across core + probe.

---

**`d15-q10` — PROBLEM_SOLVING**
**Current:** "Your local chatbot kept conversation history. Describe how you stored it, and what breaks in a long conversation."
**Problem:** Two independent questions — an implementation description and a failure analysis.
**Proposed core:** "How did your chatbot store conversation history?"
**Proposed follow-up:** "What starts to break once that conversation gets long?"
**Preserve:** both dimensions across core + probe.

---

**`d15-q07` — CONCEPTUAL**
**Current:** "You compared Chroma and Pinecone and chose Chroma. What was the reasoning, and what would make you switch?"
**Problem:** A past decision plus a hypothetical.
**Proposed core:** "You compared Chroma and Pinecone and chose Chroma. What decided it?"
**Proposed follow-up:** "What would make you switch to Pinecone?"
**Preserve:** the switch question is already a natural escalation.

---

**`d15-q02` — PRACTICAL** · `minEvidence` 3 of 4
**Current:** "On Day 10 you classified questions as structured, unstructured, or both. Give me an actual question from your test harness that needed both paths, and tell me what each path returned."
**Problem:** Recall a specific artifact from memory **and** describe two outputs, at min 3 of 4.
**Why:** Heaviest recall load in DAY_15. A candidate who cannot recall a specific test question fails on memory, not understanding.
**Proposed core:** "Give me a question from your test harness that needed both the structured and unstructured paths."
**Proposed follow-up:** "What did each path return for it?"
**Preserve:** the both-paths requirement; consider `minEvidence` 3 → 2.

---

**`d31-q01` — TECHNICAL_DEPTH** · the clearest monologue invitation
**Current:** "Walk me through what happens between a member pressing send and the first token appearing on their screen, in your streamed /chat."
**Problem:** "Walk me through everything that happens" with 5 evidence items, min 3.
**Why:** Literally your BAD example. The honest complete answer is a two-to-three-minute narration of the whole request path.
**Proposed core:** "In your streamed /chat, what has to finish before the model can write the first token?"
**Preserve:** ordering/dependency insight is the point. Retrieval-before-generation stays the core item; SSE mechanics and the Streamlit consumer move to the existing level-2 probe. Drop `minEvidence` 3 → 2.
**Note:** the level-2 probe ("first token now takes eight seconds, where do you instrument?") is excellent and already collects the rest.

---

**`d31-q06` — PRACTICAL** · **three** questions in one
**Current:** "Which RAGAS metric came out weakest, what was your hypothesis, and did your fix actually move it?"
**Problem:** Three sequential questions in one breath — worst offender in the bank.
**Why:** Nobody can hold three prompts through a spoken answer; candidates answer the first and last and drop the middle.
**Proposed core:** "Which RAGAS metric came out weakest for you?"
**Proposed follow-ups:** "What was your hypothesis for why?" → "Did the fix actually move it?"
**Preserve:** all three dimensions, sequenced. This one is nearly free — it is already a natural three-turn exchange.

---

**`d31-q02` — PROBLEM_SOLVING**
**Current:** "A member's conversation passes roughly 2000 tokens of history. What does your system do, and what is the risk of that strategy?"
**Proposed core:** "A member's conversation passes roughly 2000 tokens of history. What does your system do?"
**Proposed follow-up:** "What is the risk of handling it that way?"
**Preserve:** the risk dimension is what separates a strong answer — as a probe it does that better.

---

**`d31-q03` — CONCEPTUAL**
**Current:** "Why does PII redaction sit on the logging path specifically, and what does putting it there not protect against?"
**Proposed core:** "Why does your PII redaction sit on the logging path specifically?"
**Proposed follow-up:** "What does putting it there not protect against?"
**Preserve:** the negative-space question is the sharp one; keep it as the escalation.

---

**`d31-q05` — PRACTICAL** · borderline
**Current:** "You chaos-tested a broken tool and required that no raw 500 ever reaches the member. Tell me exactly what you broke and what the member saw."
**Problem:** Two parts, but tightly coupled (the break and its visible effect).
**Proposed:** Keep as one question; drop `minEvidence` 3 → 2 so it does not require a third item alongside both halves.

---

**`d31-q08` — PRACTICAL** · borderline
**Current:** "You containerised the app, then deployed it to Minikube with two backend replicas. What actually had to change between docker-compose and Kubernetes?"
**Problem:** Single question, but "what had to change" is open-ended across many things, at min 3 of 5.
**Proposed core:** "What was the biggest thing you had to change moving from docker-compose to Kubernetes?"
**Preserve:** "biggest" forces a decision instead of an inventory. Remaining items move to the probe. `minEvidence` 3 → 2.

---

**`d31-q10` — PROBLEM_SOLVING** · borderline
**Current:** "A member says an answer is wrong, but the bot cited a policy source. How do you investigate?"
**Problem:** Good scenario; "how do you investigate" is open-ended at min 3 of 5.
**Proposed core:** "A member says an answer is wrong, but the bot cited a policy source. What do you check first?"
**Preserve:** "first" makes it a decision rather than a full methodology. The rest is exactly what the probes are for. `minEvidence` 3 → 2.

---

### B3 — Summary

| Verdict | Count | IDs |
|---|---|---|
| Fits 45s as-is | 9 | q09, q04, q05, q08, q06 (D15); q04, q07, q11, q12 (D31) |
| Split into core + authored follow-up | 7 | d15-q01, d15-q10, d15-q07, d15-q02, d31-q06, d31-q02, d31-q03 |
| Narrow the core question | 4 | d15-q03, d31-q01, d31-q08, d31-q10 |
| Keep wording, lower `minEvidence` | 1 | d31-q05 |

**Expected answer length after revision:** 20–35 seconds for every core question,
with the deferred evidence gathered in one or two probes of 15–25 seconds each.

---

## PART C — Proposed persona / prompt changes

1. **Interview memory** (A1) — the rolling summary of what the candidate has
   already committed to. Prerequisite for continuity and contradiction.
2. **Bridge on `NEXT_QUESTION`** (A2) — same guards as the escalate bridge.
3. **Two prompt additions:** permission to *challenge* an answer, and an
   instruction to ask the candidate to *reconcile* a contradiction against the
   memory.
4. **Drop "Let's start here."** from the opening (A4).
5. **Closing** is already varied and human ("That's all my questions. Thanks for
   talking me through it.") — no change proposed.

---

## PART D — Explicitly unchanged

Scoring, `scoreQuestion`, rubric weights, report structure, schema, eligibility,
UI, orb, TTS/STT, provider selection, budgets, and the rule that a CORE question
is asked **verbatim** and identically to every candidate. Grounding continues to
add its factual clause. No candidate-specific LLM paraphrasing anywhere.

Bank edits are authored, reviewed in a diff, and identical for everyone — which
is the distinction that keeps two results comparable.

---

## Approval needed

Three separable decisions:

1. **Question rewrites** (B2) — 12 questions.
2. **`minEvidence` reductions on DAY_31** (B0) — the systemic fix. Changes no
   scoring code, but it does change how many items a candidate must land in the
   core answer, so it needs your explicit yes.
3. **Persona/prompt changes** (C) — including the interview-memory work, which is
   the largest engineering item here.

Any one can proceed without the others.
