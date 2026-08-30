# 078 — Interview Agent: Evaluation Pass, Model Selection, Quality Roadmap

Status: evaluation complete, no product changes made.
Date: 2026-08-21
Scope: the reasoning agent only (turn decisions, probes, evidence reading). No UI,
no report format, no schema, no LangGraph restructuring.

## 1. Goal

Sohail asked for three things: better response quality, a decision on which
reasoning model to use, and whether evals are feasible for this agent. This is the
evaluation-first pass that answers all three with measurements rather than
opinion. Nothing in `src/` was changed by this pass; the eval harness lives
entirely under `scripts/evals/`.

## 2. What was built to measure it

A deterministic, replayable eval harness.

- `scripts/evals/cases.ts` — 15 hand-written cases across families A–L, each
  pinned to a real question from the live cohort bank (`d15-q01`, `d15-q03`,
  `d15-q09`) so the checklist the model is graded against is the production one.
  Families: strong answer, partial, weak, off-topic, ambiguous, self-correcting,
  rambling, confidently wrong, repeated answer, empty/very short, work not
  submitted, and "can you repeat the question".
- `scripts/evals/scorecard.ts` — nine dimensions, each a deterministic predicate
  over the model's decision object. **No LLM judge**: an LLM grader adds a second
  unmeasured error source to an exercise whose whole purpose is measuring error,
  and it makes provider comparison circular. Dimensions are reported separately
  and never summed — a model that reads evidence well but invents probes is a
  different problem from one that is cautious but misses evidence, and one number
  hides exactly that.
- `scripts/evals/run-eval.ts` — runs every case against every provider, caches
  each raw response to `scripts/evals/.cache/responses.json` keyed
  `provider::caseId::run`, saved after every call. `--report` re-scores from cache
  with zero API spend, so the scorecard can be changed and re-applied for free.
- Adaptivity is scored on the **policy outcome**, not the model's proposal,
  because the policy decision is what the candidate actually experiences.

Answer to "can we use evals here": yes, and cheaply. The "model proposes, server
disposes" split is what makes it possible — the model emits a structured
observation object, which is directly assertable.

## 3. Results

Two runs per case per provider. Run 2 largely hit free-tier quota; degraded turns
(provider error → deterministic heuristic fallback) are excluded from quality
scoring and reported as reliability instead.

### Quality — pass rate per dimension

| Provider | Relev | Follow-up | Adapt | Ground | Evid | Tech | Conv | NoRep | Safety |
|---|---|---|---|---|---|---|---|---|---|
| gemini-3.5-flash-lite | **100%** | **100%** | **91%** | **100%** | **100%** | **100%** | **100%** | **100%** | **100%** |
| groq gpt-oss-120b | 90% | 100% | 88% | 83% | 95% | 100% | 100% | 100% | 95% |
| groq gpt-oss-20b | 73% | 89% | 64% | 100% | 93% | 100% | 100% | 100% | 100% |
| qwen3.6-27b | 60% | 100% | 75% | n/a | 100% | n/a | n/a | n/a | 100% |
| mock (baseline) | 87% | 89% | 82% | 100% | 80% | 100% | 100% | 100% | 100% |

`n/a` = the dimension never applied to a scorable turn (qwen degraded on 10 of 15).

### Operational

| Provider | Scored turns | Median | p90 | Degraded | Consistency | Cost / capacity |
|---|---|---|---|---|---|---|
| gemini-3.5-flash-lite | 15 | **1293 ms** | **1698 ms** | 15 (all quota) | not measurable | free tier ~15 req/day — **too small for one interview** |
| groq gpt-oss-120b | 21 | 3810 ms | 14178 ms | 9 | **6/7 identical** | free tier 8k TPM / 200k TPD — roughly 1–2 interviews/day |
| groq gpt-oss-20b | 15 | 9786 ms | 11644 ms | 0 | not measurable | same pool, cheaper per token |
| qwen3.6-27b | 5 | 26396 ms | 29272 ms | 10 | not measurable | unusable latency regardless |
| mock | 15 | 0 ms | 1 ms | 0 | deterministic | free |

**Cost caveat (honest gap):** per-turn token usage is not instrumented, so the
cost column reports observed rate-limit capacity, not money per interview. Any
budget decision needs token accounting added first — improvement #8.

**Consistency caveat:** Gemini's 15 degraded turns are all run-2 quota failures,
so its run-to-run consistency is **unmeasured**, not good. groq-120b is the only
provider with a real consistency figure (6 of 7 comparable turns byte-identical).

**Not evaluated:** Anthropic (HTTP 400, "credit balance is too low") and OpenAI
(no `OPENAI_API_KEY`). Both remain unknown quantities.

## 4. What is currently good

1. **The architectural split is sound, and is what made evals possible.** The
   model never produces a score. It reports observations; `policy.ts` and
   `depth.ts` decide the turn deterministically; scoring is arithmetic over a
   checklist.
2. **Evidence extraction is strong across every real model** (93–100%). The
   checklist-index format the models are asked to emit works.
3. **Grounding and non-invention hold up.** Across 60+ scored turns there was one
   grounding failure (groq-120b) and one unearned-credit event. No model invented
   a project, a repo, or a submission that was not in context.
4. **The confidently-wrong trap is handled by both strong models.** On H1 (chunk
   overlap explained backwards, stated with confidence) gemini and groq-120b both
   credited zero evidence, flagged `factually_wrong`, and probed the exact
   misconception. This is the behaviour that separates an interview from a quiz.
5. **Follow-up quality is effectively solved on the strong models** (100%). Probes
   target the specific gap and never restate the question.
6. **Degradation is safe.** When a provider fails, the heuristic fallback makes no
   checklist claim, and the `judged` flag keeps unjudged answers out of every
   aggregate. A candidate is never scored down for our outage.

## 5. What is currently weak

1. **`stuck_or_evasive` is a one-way exit.** `policy.ts:120` returns
   `NEXT_QUESTION` on any stuck flag, before the ladder runs. On E1 (vague "it got
   better after that change") both good models correctly drafted a scaffold and
   the policy threw it away. This is the clearest defect the eval found, and it is
   **ours, not the model's**.
2. **The models overload `stuck_or_evasive`.** They apply it both to "I don't
   know" (genuinely stuck) and to "it got better" (engaged but imprecise). The
   flag conflates refusal with vagueness, and #1 makes that conflation expensive.
3. **Small models over-redirect.** gpt-oss-20b called E1, I1, J2 and L1 OFF_TOPIC —
   including "can you repeat the question". A candidate on that model would be
   scolded for asking for a repeat.
4. **Work outside the submitted set reads as off-topic.** groq-120b sent K1 (real
   work, not submitted to the platform) to REDIRECT. Gemini handled it correctly
   and acknowledged the work before probing.
5. **Relevance is the weakest dimension overall** and the one that most damages
   the candidate's experience when wrong.
6. **No cost or token instrumentation.** We cannot currently price an interview.
7. **Free-tier capacity does not cover the product.** A real interview is 30–45
   turns; Gemini's free tier allows ~15 requests/day total.
8. **Run-to-run consistency is measured for one provider only.**

## 6. What the evals reveal

- The agent's reasoning quality is **better than its policy layer**. Two of the
  three surviving strong-model failures are the policy discarding a correct model
  proposal. Prompt tuning would never have found this; only scoring the *policy
  outcome* rather than the raw model output did.
- **Model choice matters most for relevance**, not for evidence reading. Evidence
  extraction is flat across models (93–100%); relevance spans 60–100%. That is
  where model spend actually buys quality.
- The **mock baseline scoring 87/89/82** is a useful floor: the harness is
  discriminating (real models beat it), but it also shows how much of the current
  behaviour is carried by deterministic logic rather than by the model.
- **Reliability, not quality, is the binding constraint today.** Every provider's
  worst number is its degraded count.

## 7. Recommendation

**Ship `openai/gpt-oss-120b` (Groq) as the default now; target Gemini
`3.5-flash-lite` on a paid key.**

- Gemini won every quality dimension outright and is roughly 3× faster
  (1293 ms vs 3810 ms median), which matters a great deal for a voice interview.
- But its free tier (~15 req/day) cannot complete a single 30–45 turn interview,
  and its consistency is unmeasured because quota prevented run 2. Calling it
  "best" on capacity would be unsupported by the data.
- groq-120b is the only provider with demonstrated run-to-run stability, has
  usable latency, and its quality gap to Gemini is concentrated in relevance
  (90% vs 100%) — which improvements #1–#4 attack at the prompt and policy layer,
  for free.

Do **not** ship gpt-oss-20b or qwen. 20b over-redirects; qwen degrades on two
thirds of turns at 26 s median.

**Decision gate:** re-run this exact harness against Gemini on a paid key, and
against Claude once credit is restored, before committing. Each run is ~15
requests, and the cache makes re-scoring free.

## 8. Highest-impact improvements (ranked, all derived from observed failures)

1. **Split `stuck_or_evasive` into `refused` and `vague`, and stop treating vague
   as terminal.** Only `refused` short-circuits to NEXT_QUESTION; `vague` falls
   through to the scaffold ladder. Fixes E1 on every model. Files:
   `agent/types.ts`, `agent/prompt.ts`, `agent/policy.ts:120`.
2. **Scaffold before abandoning.** Even on `refused`, offer one scaffold rung
   before moving on if none has been offered for that question. Probing a blank is
   cruelty; offering a hint once is teaching.
3. **Tighten the relevance definition in the prompt** with the three cases models
   actually get wrong: asking for a repeat or clarification is ON_TOPIC;
   describing real work that was not submitted is ON_TOPIC (probe it, do not
   redirect); re-stating a previous answer is ON_TOPIC-but-no-new-evidence. Fixes
   K1, L1, I1. Cheapest high-yield change on the list.
4. **Make REPEAT structurally unreachable from redirect.** `routeDecision` already
   checks REPEAT before relevance, which is why groq-120b's OFF_TOPIC read of L1
   did not hurt the candidate. Extend that protection to clarification requests
   generally.
5. **Consider a relevance-only fast path.** Relevance is the weakest and most
   consequential dimension; a small dedicated classification step would let a
   cheaper model carry the rest. Only do this if #3 fails to close the gap —
   measure first.
6. **Promote the harness to a gate.** Wire `run-eval.ts --report` into a pre-merge
   check on any change to `prompt.ts`, `policy.ts`, `depth.ts`, or a provider
   adapter. The cache makes it free; API cost is paid only when responses change.
7. **Expand to 40–50 cases** and add the families this pass lacks: partial credit
   at deep-probe rungs (`qid@L2` / `qid@L3` grading), candidate disputes the grade,
   candidate answers in Hinglish, and answers containing a prompt-injection
   attempt.
8. **Instrument tokens and cost per turn.** Capture usage from every provider
   response into the eval cache and into production turn records. Until this
   exists, no cost claim about the interview is defensible.
9. **Measure consistency properly.** Three runs, all providers, on a paid key, and
   report per-dimension variance rather than byte-identity — byte-identity is too
   strict a proxy for "made the same decision".
10. **Add a golden-transcript regression test.** One full 45-turn interview,
    cached, replayed on every change, asserting the final module scores and the
    readiness verdict do not move unless intended.

## 9. Concrete next implementation plan

Smallest risk first. Steps A–B are prompt and policy only — no schema, no UI.

- **Step A (half day, ~15 requests):** implement #1 and #3. `agent/types.ts` gains
  the split flag; `agent/prompt.ts` gains the three relevance clarifications;
  `agent/policy.ts` routes `vague` into the ladder. Re-run
  `run-eval.ts --providers groq-120b --runs 1` and confirm E1, K1 and L1 flip.
  Expected: groq-120b relevance 90% → ~100%, adaptivity 88% → ~95%.
- **Step B (quarter day, ~15 requests):** implement #2, re-run, confirm no
  regression in the J family — genuinely empty answers must still move on after
  one scaffold, not loop.
- **Step C (quarter day, no API spend):** implement #8 — token capture in the
  provider adapters and in the eval cache. Fill in the real cost column.
- **Step D (decision gate):** with a paid Gemini key and restored Claude credit,
  run all providers × 3 runs. Produce the final table with real consistency and
  real cost, then pick the production model on that evidence.
- **Step E:** implement #6 and #7 together, so the expanded suite lands already
  gated.

## 10. Guardrails for Cursor (DO NOT)

- Do **not** let the model produce, adjust, or influence a score. The split across
  `policy.ts` / `depth.ts` / `module-scoring.ts` is the product's integrity story.
- Do **not** change `module-scoring.ts` or the report format in this work. Scoring
  must never be tuned to improve eval numbers.
- Do **not** collapse the nine dimensions into a single score anywhere.
- Do **not** add an LLM judge to the eval harness.
- Do **not** remove or weaken the `judged` flag or the degraded-turn exclusion. An
  outage must never be scored as a candidate failure.
- Do **not** create files beyond those named in Steps A–C.
- Do **not** touch UI, schema, migrations, or the LangGraph structure.
- Do **not** re-run multi-provider evals casually; use `--report` (cached, free)
  unless prompt or policy actually changed.

## 11. Verification

- `npx tsx scripts/evals/run-eval.ts --report --runs 2` re-scores from cache with
  zero API calls and must reproduce the table in §3 before any change is made.
- After Step A, the same command must show E1, K1 and L1 passing for groq-120b
  with no new failures elsewhere.
- `npx tsc --noEmit` must pass. (`npm run build` currently fails on
  `/admin/ai-cohort` — `supabaseUrl is required`, missing local `SUPABASE_URL`.
  Unrelated to the interview agent and out of scope here.)
- Changed files after Step A must be exactly: `agent/types.ts`, `agent/prompt.ts`,
  `agent/policy.ts`.

## 12. Commit message

    feat(interview): relevance and scaffold fixes from the eval pass

    Split stuck_or_evasive into refused/vague so a vague-but-engaged answer
    reaches the scaffold ladder instead of terminating the question, and
    tighten the relevance definition for repeat requests, unsubmitted work,
    and re-stated answers.

    Both defects were found by scripts/evals: the policy layer was discarding
    correct model proposals, and relevance was the weakest dimension across
    every provider.
