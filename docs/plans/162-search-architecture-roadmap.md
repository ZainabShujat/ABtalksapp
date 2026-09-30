# 162 — Evidence-backed search: what exists, what is missing, what to build in what order

Date: 2026-09-29 · Author: Sohail
Status: **Roadmap, not an implementation plan.** Each phase becomes its own
numbered plan when it is started.

---

## 1. Goal

Assess the proposed hybrid-retrieval architecture (intent parser → structured
filters + vector search → merge → rerank) against what ABTalks actually has
today, and sequence the work so each phase is justified by a measurement rather
than by the architecture diagram.

---

## 2. What already exists

Verified in source on 2026-09-29. Six of the twelve proposed steps are built.

| Proposed | Status | Where |
|---|---|---|
| 2. NL query → structured search plan | **Built** | Scout produces a `JobSpec`; `matchTracks` requires the recruiter's own words to corroborate any filter the model proposes — a two-key rule the proposal does not have |
| 5. Skill normalization / canonical dictionary | **Built** | `Skill.slug` + `Skill.aliases[]` + a GIN index on aliases; the normalizer runs at write time in `candidate-profile-actions.ts` and `recruiter-jobs/service.ts` |
| 6. Weighted hybrid score | **Built, and better than proposed** | `BASE_WEIGHTS` over seven dimensions (`stack 25, missions 20, cleanPass 15, projects 15, consistency 10, interview 10, experience 5`, plus `role 20` when a role is named), then `reweight()` rescales by what evidence the pool actually has. Fixed weights would score a missing dimension as zero; this removes it and redistributes |
| 8. Conversational refinement over a query state | **Built** | Search sessions (plan 133) hold one spec per session; follow-ups amend the spec rather than restarting |
| 11. Pagination | **Built** (plan 158) | Client-side over the returned set. Cursor pagination is a different-scale problem — see §5 |
| 12. Don't run an LLM per result | **Built** | `explainMatches` makes **one** batched `askGroqJson` call for the whole match set, not N |
| Latency instrumentation | **Built** | `search-qa/audit.ts` already records `searchLatencyMs` p50/p95/p99 |
| Typo-tolerant text matching | **Partly built** | Trigram GIN indexes exist on `CandidateProfile.fullName`, `headline`, `institutionName`, `Skill.aliases`, `Organization.name` |

**Conclusion:** the architecture is largely already in place. The gap is not
retrieval design.

---

## 3. What is actually blocking

### 3a. The pool is 86 people (fixed in code, not yet applied)

Plan 161 measured it: 10,980 candidate profiles, 113 passing the visibility
gate, 86 reaching the pool. No retrieval architecture improves a pool of 86.

**Nothing in this roadmap is worth starting before
`npm run db:backfill:visibility -- --apply` has run.** It is the single change
with the largest effect on search quality, and it is already written.

### 3b. `SkillEvidence` has no live writer — this is the real blocker

Re-verified today: the only writer in the repository is
`prisma/scripts/migrate-2i-achievements.ts`. CLAUDE.md records this as P0-0 in
plan 112, and it still holds.

That matters more than anything else on the proposed list, because the
proposal's strongest idea — §7, "claimed skill vs demonstrated skill" — is built
entirely on `SkillEvidence` and its two caches, `CandidateSkill.evidenceScore`
and `CandidateSkill.verified`. Both are **frozen at backfill time**.

So today:

- A candidate finishes a cohort, ships a hackathon project, passes challenge
  days, connects GitHub — and `evidenceScore` does not move.
- `verified` means "was true when the migration ran", not "is demonstrated".
- Any ranking, badge or filter built on "verified skill" is describing a
  snapshot from a backfill.

Building semantic search on top of that would make the search *feel* smarter
while the differentiating signal stays dead. **Evidence writers come before
embeddings.**

### 3c. The pool filter matches skill names, not aliases

Plan 161 pushed the brief's skills into SQL, matching `Skill.name`. The
normalization layer already folds `React / ReactJS / React.js` into one
canonical row with `aliases[]` — but the filter does not consult the alias
array, so a brief saying "ReactJS" can still miss candidates stored as
"React.js". Cheap to fix, and it is the proposal's §5 payoff.

---

## 4. Sequenced phases

Each phase has an exit measurement. Do not start the next one until the
previous one's measurement moves.

### Phase 0 — apply the visibility backfill *(ready now, plan 161)*
Run the dry run, snapshot Neon, apply.
**Exit:** the §2a funnel in plan 161 moves from 86 to the thousands.

### Phase 1 — resolve the brief's skills through the alias table
Resolve each brief skill to a canonical `Skill` via `slug`, `name` **and**
`aliases`, then filter on `skillId`. One repository change plus a resolver.
**Exit:** a search for "ReactJS", "React.js" and "react js" returns identical
candidate sets. Add that as a `search-qa` golden case.

### Phase 2 — make `SkillEvidence` live *(the P0-0 item; the highest-value work here)*
Write evidence rows when evidence actually occurs: challenge submissions,
cohort mission passes, hackathon submissions, graded projects, assessment
scores, connected GitHub. Recompute the `evidenceScore` / `verified` caches on
insert, as the model doc already says they should be.
This is its own plan and touches candidate-skills and evidence, which are
**Shivansh's** module — it needs his sign-off before any of it is written.
**Exit:** `evidenceScore` changes for a candidate who completes new work, and
`search-qa`'s data-quality report stops reporting frozen caches.

### Phase 3 — expose demonstrated vs claimed in the brief and the card
Only once Phase 2 makes the signal real: let a recruiter ask for
"demonstrated React", boost verified evidence in `score-candidate.ts`, and show
the evidence chips the proposal describes. The scorer already has a `stack`
dimension and a reweighting mechanism — this is a change to inputs, not a new
ranking engine.
**Exit:** the QA harness shows demonstrated-skill queries ranking
evidence-backed candidates above claim-only ones, without regressing the
existing golden set.

### Phase 4 — precompute the derived numbers
Profile completion, evidence score, candidate quality, experience months,
normalized skill ids — computed on write, read on search. Some already are.
**Exit:** `searchLatencyMs` p95 in `search-qa` drops, measurably.

### Phase 5 — semantic layer, **only if measured to be needed**
pgvector on Neon over résumé text, project and experience descriptions; retrieve
by structured filter first, then rank within that set.
**Entry condition, not a date:** `search-qa` shows a class of briefs that
structured filters plus the alias resolver demonstrably cannot serve — for
example "built production RAG systems", where no skill token expresses the ask.
Until such cases are counted, this is cost and complexity with no measured
benefit.

### Phase 6 — caching and cursor pagination
Cache common search signatures; move to keyset pagination.
**Entry condition:** p95 latency or result depth actually hurts. At 60 results
per search, `OFFSET` is not the bottleneck.

---

## 5. What NOT to build, and why

- **A separate `candidate_search_index` table.** It is a second source of truth
  requiring sync on every profile write, and the `src/repositories/` boundary
  already gives one place to change queries. Denormalized columns on
  `CandidateProfile` solve the same problem at this scale without a sync
  pipeline. Revisit if Phase 4 is insufficient.
- **Embeddings before Phase 2.** Semantic similarity over résumé prose would
  rank on what candidates *wrote*, while ABTalks' actual advantage is what they
  *did*. Wiring evidence first is what makes the search defensible.
- **Elasticsearch / OpenSearch / Typesense.** Agreed with the proposal: not at
  this size. Postgres and pgvector cover it.
- **A fixed `0.35 semantic + 0.25 skill + …` formula.** `reweight()` already
  does something more careful — it drops dimensions the pool cannot evidence and
  redistributes, instead of scoring an absent dimension as zero. Replacing it
  with fixed weights would be a regression.
- **Per-result LLM explanations.** Already avoided — one batched call. Worth
  re-checking after plan 161 raised the result limit to 60, since that payload
  now carries three times as many matches.

---

## 6. Ownership

Candidate search and search ranking are mine. **Phase 2 is not** — candidate
skills and evidence belong to Shivansh, and it is the phase that matters most,
so it needs his agreement before it is scheduled, not after it is written.

---

## 7. The one-line summary

The retrieval architecture is mostly built. Search is weak because the pool was
99% closed (plan 161, fixed in code, not yet applied) and because the evidence
layer that would make it distinctive has no live writer. Fix those two, resolve
skills through the alias table, and re-measure before adding a vector database.
