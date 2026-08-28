# 083 — Adaptive interview intelligence: audit and migration plan

> **Status:** Audit + proposal. No code changed by this document.
> **Out of scope, untouched:** silence/audio, orb/UI, report, scoring arithmetic,
> database schema, migrations.

---

## Part A — Audit

### A. Where CORE questions live

`src/features/interview/cohort/question-bank.ts` — 1,251 lines, hand-authored
TypeScript, `QUESTION_BANK_VERSION = "2026-08-20.1"`.

- **DAY_15:** 10 CORE questions (`d15-q01`…`q10`)
- **DAY_31:** 11 CORE questions (`d31-q01`…`q12`)
- 43 deep probes (escalation rungs, `level: 2 | 3`), 21 scaffold probes

Each `CoreQuestion` carries: `competency`, `difficulty`, `text`, `sourceDays`,
`sourceLabel`, `expectedEvidence`, `minEvidence`, `maxFollowUps`,
`followUpPrompt`, `mode`, optional `groundsOn`, `deepProbes`, `scaffoldProbes`.

Deliberately code, not data: *"a malformed bank is a compile error rather than a
production incident."*

### B. Does the system use `days.json`?

**No — not at runtime, not for the interview.**

`days.json` (163 KB) is referenced in exactly two interview files, and in both it
appears **only inside a comment**:

- `question-bank.ts` — a provenance note saying content was transcribed from
  `docs/plans/068-day15-day31-question-banks.md`, which grounds each question in
  a day of `days.json`.
- `curriculum.ts` — an explicit statement that it *"deliberately does NOT import
  `days.json` (163 KB of mission briefs)"*, using `modules.json` instead.

Real consumers of `days.json` are `prisma/seed-program.ts` and
`scripts/generate-kb-embeddings.ts`. **The question bank is fully independent of
curriculum content**; the link is editorial, made once by a human, and would not
break if `days.json` changed tomorrow.

### C. How DAY_15 / DAY_31 targets are derived

Not derived — **selected in bank order**. `planner.ts` filters the bank by
`BLUEPRINT_SCOPE` (a structural guard: DAY_15 can never reference day 16+) and
takes them in array order. Explicitly LLM-free: *"WHICH questions are asked comes
from the fixed bank, in bank order; the wording is used verbatim."* Two
candidates at the same milestone get byte-identical question sets.

Competency and module come from the authored `competency` field and
`moduleForDay(sourceDays)` against `modules.json`.

### D. DAY_15 taken on Day 26

Handled, and handled well:

- The 10 CORE questions remain DAY_15 only. The milestone does not drift.
- `selectExtensionQuestions` adds up to `MAX_EXTENSION_QUESTIONS = 2` questions
  from the **DAY_31 bank**, filtered to `sourceDays.every(day => passed)` — so
  only work they have genuinely completed.
- Extensions are `tier: "EXTENSION"`, reported but **never scored**; only CORE
  questions feed the comparable number.

Nothing to change here.

### E–F. Calibration — and whether it changes anything

`updateCalibration` (depth.ts) counts strong/weak over the first
`CALIBRATION_ANSWERS = 3` answers, then sets `FOUNDATIONS | WORKING | ADVANCED`.

What it actually affects, exhaustively:

| Effect | Where |
|---|---|
| Escalation ceiling: ADVANCED 2, WORKING 1, FOUNDATIONS 0 | `escalationCeilingFor` |
| Model **tone** when drafting acknowledgements/follow-ups | prompt line 91 |

And the prompt says, verbatim: *"This changes your TONE and phrasing only."*

**So: no.** Answering your question F directly — calibration does **not** make
later questions meaningfully different. The CORE question text is identical for a
FOUNDATIONS and an ADVANCED candidate. Only the depth ceiling and the wording of
the connective tissue move. This is the single biggest gap against your brief.

### G. Are questions banked verbatim?

Yes, absolutely. `grounding.ts`: *"The bank question text is NEVER rewritten. The
graded question is byte-identical for every candidate; only the pointer in front
of it is personal."* The only personalisation is a factual grounding clause
("You pushed day11_solution.py for Day 11 — …"), built by template from a
database row with no model involved.

### H. Can the LLM generate natural question wording?

**No.** There is no code path where the model writes a CORE question. It may
write: `acknowledgement`, `followUpQuestion`, `clarification`, `bridge`. All four
are length-capped and rejected if they contain a question mark where they should
not.

### I. Answer-specific follow-ups?

**Yes, partially.** On a PARTIAL answer the model's `followUpQuestion` is
preferred; on a WEAK answer the banked scaffold wins (deliberately — a model's
contextual probe is often as hard as the thing they already could not answer).
Escalations are always the authored rung, never model-written, with a
model-written one-sentence bridge in front.

### J. Memory

**Yes, and it is real.** `memory.ts` builds up to 10 lines from
`evidenceByQuestionId` — for each answered question: topic, the authored evidence
items they covered, and a ≤120-char verbatim quote. Deterministic, no extra model
call. The prompt instructs: *"Never re-ask something they have already
established."*

This satisfies §10 of your brief already.

### K. Behaviour by answer type

| Answer | Current behaviour |
|---|---|
| Excellent | Depth ladder escalates to an authored rung, with a model bridge. No praise — prompt bans it. |
| Good | Acknowledgement + next question, with a bridge. |
| Vague (PARTIAL) | Model-drafted follow-up targeting the missing evidence item. |
| Incomplete | Same path — follow-up on the uncovered item. |
| Incorrect | `factually_wrong` is flagged but **routes identically to any other answer**. No challenge, no "let me come at that another way." |
| "I don't know" | One banked scaffold, then moves on. Accepting acknowledgement pool. |
| Off-topic | First occurrence restates the question; subsequent ones get the redirect line, capped at 3. |

### L. What makes it feel like a questionnaire

1. **Verbatim CORE questions.** The dominant cause. Every candidate hears the
   same ten sentences in the same order, so the conversational layer reads as
   commentary wrapped around a form.
2. **Calibration is cosmetic** (E–F).
3. **`factually_wrong` has no distinct response** — a wrong answer is treated
   like a thin one.
4. **Follow-ups target evidence items, not statements.** The probe aims at *"the
   uncovered checklist item"*, which is often adjacent to, rather than continuous
   with, what the candidate just said.
5. **Fixed order.** Bank order never varies, so the interview cannot follow a
   thread the candidate opened.

### M. Already good — leave alone

- The deterministic policy boundary (`routeDecision`) and all budgets.
- Evidence extraction, `matchedEvidence` indices, scoring, report.
- Grounding by template (structurally cannot hallucinate an artifact).
- Extension mechanism for live progress (D).
- Memory (J).
- Scaffolds for weak answers, clarification handling, off-topic handling,
  silence/audio, orb.

### N. What needs to change

Four things, in order of impact: question **generation** from a target;
calibration that **actually** changes difficulty; a distinct response to a wrong
answer; follow-ups anchored to the candidate's statement.

---

## Part B — Proposed architecture

The change is to split what is currently one object — "the question" — into
**target** (authoritative, comparable, auditable) and **utterance** (generated,
natural, frozen).

```
CoreQuestion  ──►  AssessmentTarget   (competency, expectedEvidence, minEvidence,
   (bank)              │               sourceDays, difficulty band, authored text
                       │               as fallback)
                       ▼
             generateQuestion(target, level, memory, grounding)
                       │  LLM, validated, ONE call
                       ▼
              frozen into plan.questions[i].spokenText
```

### Layer table

| # | Layer | Status |
|---|---|---|
| 1 | Curriculum source (`modules.json`, `days.json`) | **Exists.** Stays editorial. No runtime coupling proposed — deriving targets from 163 KB of prose at runtime would trade an auditable bank for an unauditable one. |
| 2 | Assessment target selection | **Exists** (`planner.ts`, bank order). Add: reorder within a module when the candidate opens a thread. |
| 3 | Candidate live context | **Exists** (`candidate-context.ts`, extensions). No change. |
| 4 | Initial calibration | **Exists** (`updateCalibration`). No change to the classifier. |
| 5 | Difficulty controller | **NEW.** Maps level → question framing band, feeding layer 6. |
| 6 | LLM question generation | **NEW.** The core of this plan. |
| 7 | Answer analysis | **Exists.** Add a `factually_wrong` branch. |
| 8 | Natural interviewer response | **Exists** (acknowledgement/bridge). Minor prompt work. |
| 9 | Targeted follow-up | **Exists.** Re-anchor to the candidate's statement. |
| 10 | Policy / budgets | **Exists. Untouched.** |
| 11 | Evidence capture | **Exists. Untouched.** |
| 12 | Scoring | **Exists. Untouched.** |
| 13 | Report | **Exists. Untouched.** |

### B1. Question generation (layer 6)

**When:** once per CORE question, at plan build time — not mid-interview. The
whole plan is generated in one batched call when the interview opens, so the
candidate never waits for question wording mid-conversation, and the plan stays
the frozen artifact it is today.

**Input per target:** competency, `expectedEvidence`, difficulty band from
calibration, the grounding fact, and the authored text as a reference.

**Output:** one sentence. Validated hard before it is accepted:

| Guard | Rule |
|---|---|
| Length | ≤ 200 chars, one question mark |
| Single question | rejected if it contains a second `?` or " and " joining two interrogatives |
| Evidence-preserving | must not name any `expectedEvidence` item (that would hand over the answer) |
| On-target | must share a minimum token overlap with the authored text's content words |
| Fallback | any failure → the authored question, verbatim |

**Auditability:** the generated string is written to `plan.questions[i].spokenText`
and to the transcript, exactly as the grounded text is today. The report already
reads `spokenText`. `text` remains the authored target, so every score still
traces to a fixed target.

**Calibration timing problem, and the answer.** Calibration is only known after
three answers, but the plan is built at open. Proposal: generate questions 1–3 at
the authored level (they are the calibration probes and *should* be identical for
everyone), then regenerate the wording of the remaining targets once at the
calibration boundary. One extra call per interview, at a natural pause.

### B2. Difficulty that actually bites (layer 5)

Level changes the **framing band** the generator is asked for, against the same
target and the same `expectedEvidence`:

| Level | Framing |
|---|---|
| FOUNDATIONS | concrete, about what they personally did, one clause, grounded in their artifact |
| WORKING | why/how, implementation choice, one trade-off |
| ADVANCED | failure modes, scale, what breaks, design alternatives |

`minEvidence` and scoring are **unchanged** — this is how deeply the same target
is explored, not a different bar. Comparability is preserved because the target
and its checklist are identical; only the route in varies.

### B3. Wrong answers (layer 7)

`factually_wrong` currently routes like any other answer. Proposal: when flagged
and follow-up budget allows, take the **scaffold** path with a re-approach framing
— *"Let me come at that another way. What would you expect to happen when that
component fails?"* — never a correction, never "that's incorrect". Bounded by the
existing follow-up budget; no new budget.

### B4. Follow-ups anchored to the statement (layer 9)

Prompt change only. The follow-up must quote or name something in the
candidate's last answer, and target the missing evidence item **through** it.
Rejected and fallen back to the banked probe if it names no content word from
their answer.

---

## Part C — What I recommend against

**Deriving targets from `days.json` at runtime.** The brief asks whether the bank
should come from curriculum content. My recommendation is no: the bank's value is
that it is a reviewed, versioned, compile-checked artifact where each question's
`expectedEvidence` was written by a human who knew what a good answer contains.
Generating targets from mission prose would move that judgement to inference and
make two cohorts' scores incomparable. Keep the editorial link — regenerate the
bank from `days.json` **offline**, reviewed, as plan 068 did.

**Letting the LLM choose which target comes next.** Coverage must stay
deterministic. Reordering *within* a module is safe; choosing what to assess is
not.

---

## Part D — Risk register

| Risk | Mitigation |
|---|---|
| Generated question drifts off-target | Token-overlap check + evidence-name ban + authored fallback |
| Generated question leaks the answer | Explicit ban on naming `expectedEvidence` items |
| Two candidates get materially different difficulty | Same target and `minEvidence`; only framing varies; both recorded in the plan for audit |
| Provider outage at plan build | Falls back to authored text — i.e. exactly today's behaviour |
| Added latency | One batched call at open, one at the calibration boundary; never mid-turn |
| Regression in the 223 passing checks | Generator is pure and mockable; bank remains the fallback path the existing tests exercise |

---

## Part E — Verification (when approved)

Existing suites must stay green unchanged — they assert the authored path, which
remains the fallback. New deterministic tests, mock provider only:

1. A generated question that names an expected-evidence item is rejected.
2. A two-question generation is rejected.
3. An off-target generation is rejected.
4. Every rejection falls back to the authored text verbatim.
5. FOUNDATIONS / WORKING / ADVANCED produce different framing for the same target.
6. `minEvidence` and competency are identical across all three levels.
7. `spokenText` is frozen into the plan and appears in the transcript.
8. `factually_wrong` takes the re-approach path once, then moves on.

No live API calls, no evaluation sweeps.
