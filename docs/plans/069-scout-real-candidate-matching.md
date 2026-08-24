# 069 — Scout on real data: candidate dossiers, honest selection, retrieval-grounded agent

> **Branch:** `fix/hire-scout-conversation` (confirmed current, tip `e12c3c5`)
> **Supersedes the open questions in:** `062-hire-evidence-based-matching-agent.md` (§3.3, §3.4, §9, §10)
> **Status:** architecture locked against measured production data · phased, each phase independently shippable
> **One-line thesis:** Scout already works. It returns nothing because the *gates* are written for a finished cohort and the *scoring* is written for evidence that does not exist yet. Fix the gates, make the scoring coverage-aware, give every field a provenance label, and let the agent read real pool facts instead of guessing.

---

## 0. How to use this document

Written for the implementer (me or Cursor), not for the owner. Every phase states what it changes, what it must not break, and how it is verified. Phases 1–5 are the product answer to "on what basis is a candidate selected". Phase 0 is a prerequisite that nothing works without.

**Read §1 before writing a single line.** The plan is shaped entirely by what the live database actually contains, and several "obvious" implementations are ruled out by that data.

---

## 1. Ground truth — measured, not assumed

Read-only inventory run against the Neon branch in `.env.local`
(`ep-proud-band-am3sduhv…`, branched from production) on 2026-08-13.

### 1.1 The hire feature is not deployed at all

The branch has **52 tables**. Missing from them:

`TalentRequest`, `TalentRequestMessage`, `TalentRequestMatch`, `CandidateAvailability`,
`TalentEngagementRequest`, `TalentEngagementMessage`, `RecruiterSeat` (whatever the
seat migration adds).

Three local migrations are unapplied here:

| Migration | Present locally | Applied on this DB |
|---|---|---|
| `20260811140000_talent_requests_hire_scout` | yes | **no** |
| `20260812120000_hire_engagement_requests_and_seats` | yes | **no** |
| `20260812190000_recruiter_email_otp_baseline` | yes | **no** |

Since the branch came from production, **production does not have these tables either**.
Every `try/catch` in `hire-actions.ts` that says "apply the hire migration if tables are
missing" is currently the live code path. This is Phase 0 and it blocks everything.

### 1.2 The pool gate can never open today

```
ProgramCohort              5 rows,  resultsPublishedAt IS NULL on ALL 5
```

`searchCandidates()` (`src/features/hire/search-candidates.ts:31-51`) starts by finding a
cohort with `resultsPublishedAt != null`. There is none → it returns
`{ matches: [], nearMisses: [], totalEligible: 0 }` before it looks at a single member.
**This single line is why the recruiter always sees the template/gap report.** Same gate in
`pool.ts:assertPoolAccess` and in `hire-request-actions.ts`.

### 1.3 The cohort is mid-flight, not finished

| Signal | Value |
|---|---|
| ProgramMember | **46**, all `ENROLLED`, zero `COMPLETED` |
| `highestUnlockedDay` | max **4** (of 30) |
| ProgramMissionSubmission | 518 rows — **361 passed**, 157 failed |
| `missionPoints` | min 36 · avg 94 · max 324 |
| `cleanPassCount` | avg 6.4 |
| ProgramCommitDay | 304 rows, all 46 members have ≥1 |
| **ProgramProject** | **0 rows** |
| **ProgramInterview** | 46 rows, **all `NOT_STARTED`**, every score NULL |
| `recruiterVisibilityConsentAt` | **5 yes / 41 no** |
| `resumeUrl` | 4 of 46 |
| `linkedinUrl` | 46 of 46 |
| education / university / gradYear | 25 / 21 / 35 of 46 |

### 1.4 Therefore the current scoring is miscalibrated, not merely empty

`score-candidate.ts` weights: stack 25, missions 20, cleanPass 15, **projects 15**,
consistency 10, **interview 10**, experience 5.

Projects and interviews are structurally **0 for every member in this cohort**. 25 points of
the 100 are dead weight. Work the arithmetic for the single best possible member today —
full stack match, top missionPoints, near-perfect clean pass:

```
stack       25 × 1.00 = 25.0
missions    20 × 1.00 = 20.0   (324/240, clamped)
cleanPass   15 × 0.90 = 13.5
projects    15 × 0.00 =  0.0
consistency 10 × 0.33 =  3.3   (~6.6 commit days / 20)
interview   10 × 0.00 =  0.0
experience   5 × 1.00 =  5.0
                        ─────
                        66.8  → PARTIAL
```

**Nobody in the cohort can reach STRONG (≥70), ever, no matter how good they are.** A typical
member lands 35–45 → `NONE`, and `searchCandidates` filters `tier !== "NONE"` out of matches
entirely. So even after the cohort gate is opened, the recruiter would see an almost-empty
list of "partial" people. Fixing the gate without fixing calibration produces a *worse*
product than the honest gap report.

### 1.5 Declared data is real and usable; resume data is not

Skills across 46 members (top): `python 31 · sql 16 · java 12 · javascript 5 · power bi 4 ·
git 4 · rag 4 · aws 4 · react 3 · langchain 3 · c++ 3 · terraform 2 · pandas 2 · mongodb 2 · …`

`jobRole` is free text and dirty: `Student 16`, `student 3`, `STUDENT 2`, `Fresher 2`,
`AI Engineer 2`, `B.Tech 3rd year Student`, `Software (Data) Engineer`, `Credit Risk Analyst
Intern`, `Senior Program Manager`, … → needs normalisation into a **role family**, never shown
raw as a job title.

`yearsExperience`: 23 members at 0, 5 at 1, 7 at 2 → **a student-heavy pool**, plus a long tail
(12, 13, 14, 18, 20). Seniority bands must not be tuned as if this were a professional pool.

**Resume: do not build a parser.** 4 of 46 program members and 24 of 2863 challenge students
have a `resumeUrl`. A resume-extraction pipeline would serve ~1% of the pool while creating a
new unverified-data surface. The dossier keeps a `resumeUrl` field with provenance `DECLARED`
and links it out. Revisit only if resume coverage passes ~40%.

**Mission payloads carry no code.** `ProgramMissionSubmission.payload` keys across all 518 rows
are only `answers`, `reason`, `waived`. There is no source code to mine for "which language did
they actually write". Language evidence must come from `ProgramDay.language` (days 3+ are
`PYTHON`) crossed with which days the member passed — that is real and verifiable, and it is
the honest version of the owner's "kis language me kaam kiya" question.

### 1.5b The decisive finding: `missionPoints` is not evidence

Days 1–3 are **waived at enrolment** — every member carries three passed
submissions with payload `{"reason": "cohort_start_day", "waived": true}`, worth
36 mission points and 3 "clean passes" for doing nothing.

| Passed | Waived | Rows |
|---|---|---|
| true | true | **138** (46 members × 3 days) |
| true | false | 223 |
| false | false | 157 |

Earned (non-waived) passes per member:

| Earned passes | Members |
|---:|---:|
| 0 | **25** |
| 1–2 | 5 |
| 3–5 | 3 |
| 6–10 | 4 |
| 11+ | 9 |

So the real candidate pool is **~16 people with any earned pass**, not 46. Any
score derived from `missionPoints` or `cleanPassCount` ranks the 25 who have
done nothing alongside the 9 who have done everything.

**And the intersection that decides the product:**

| | Consent = yes | Consent = no |
|---|---:|---:|
| Earned passes ≥ 1 | **0** | 16 |
| Earned passes = 0 | **5** | 25 |

All five consenting members have **zero** earned passes (36 points, 3 clean, 3
commit days — the enrolment freebies). Every one of the top twelve performers
has consent = **false**. Opening the pool without a consent drive shows a
recruiter five empty profiles and hides everybody who did the work.

**This makes the consent toggle the critical path, not a Phase 6 nicety.**

### 1.6 The challenge track is a 60× larger pool with no consent field

| Signal | Value |
|---|---|
| Users | 12,602 (all `STUDENT` role — **zero RECRUITER, zero ADMIN rows in this branch**) |
| StudentProfile | 2,863 · 2,099 with skills · 844 LinkedIn · 588 GitHub · 24 resumes |
| userType | 2,317 STUDENT / 546 PROFESSIONAL |
| Enrollments | CLAUDE 2,633 active + **74 completed** · SE 146 · AI 108 · DS 43 |
| Submission | **14,696** — 176 users with 45+ submissions, 54 with 30–44 |
| Certificate | **94**, all `CLAUDE_CHALLENGE` |
| `isReadyForInterview` | **75** true |

`TalentCandidateSource` already enumerates `PROGRAM | CHALLENGE_60 | CLAUDE | HACKATHON`, so the
schema anticipated this. But `StudentProfile` has **no recruiter-visibility consent field**, so
these 2,863 people are legally off-limits until they opt in. That is Phase 7, not today.

### 1.7 Consent is write-once at signup

`recruiterVisibilityConsentAt` is set in exactly one place — `features/program/entry.ts:308`,
from the application form. **There is no way for a member to opt in afterwards.** 41 of 46
members are permanently invisible to `/hire` and `/talent` through a checkbox they saw once.
Adding a self-service toggle is the highest-leverage, lowest-risk change in this plan: it can
multiply the eligible pool by ~9× without touching the matching engine.

### 1.8 The LLM in use is Groq, not Claude

`.env.local` has `GROQ_API_KEY` + `HIRE_GROQ_MODEL` and **no `ANTHROPIC_API_KEY`**.
`scout-conversation.ts` and `explain-matches.ts` both call `askGroqJson`
(`openai/gpt-oss-120b`, 8s timeout, JSON-schema structured output).
`src/lib/claude-agent.ts` exists and is **imported by nothing** — dead code from plan 062.

Consequence for this plan: build the agent's tool layer on Groq's OpenAI-compatible tool
calling, keep the existing deterministic fallback, and leave `claude-agent.ts` alone (deleting
it is out of scope; note it and move on).

---

## 2. Goal

Make Scout select and present **real people from real evidence**, with three properties:

1. **Honest** — every fact carries where it came from and whether the platform verified it.
2. **Calibrated** — ranking works for a cohort on day 4 and still works on day 30, without
   re-tuning by hand.
3. **Grounded** — the agent may *read* pool facts to talk about them, but ranking stays pure
   TypeScript and no number reaches a recruiter that the platform did not produce.

Non-goal: making the pool bigger by lowering the consent bar. Consent is untouchable.

---

## 3. The three product answers

### 3.1 "On what basis is a candidate selected?" → the **Candidate Dossier**

One normalised, source-agnostic object assembled by one builder, consumed by scoring, the
agent's tools, the match card, and admin. Every field carries **provenance**:

| Provenance | Meaning | Examples |
|---|---|---|
| `VERIFIED` | The platform ran a check and recorded the result | passed missions, clean passes, commit days, graded project scores, interview scores |
| `DECLARED` | The person typed it about themselves | skills, jobRole, company, education, yearsExperience, LinkedIn, resume |
| `DERIVED` | ABTalks computed it from the above | role family, working languages, evidence tier, salary estimate, activity recency |

The recruiter UI renders the three differently (badge/colour), the agent is told the difference
in its system prompt, and the rationale generator may only quote `VERIFIED` and `DERIVED`
figures. This is the whole answer to "kis basis pe chayan" — and it is defensible to a
candidate, a recruiter, and a regulator.

### 3.2 "What about expected salary?" → a labelled **estimate**, never a claim

Zero `CandidateAvailability` rows exist (the table itself is missing). So:

- Compute an **ABTalks indicative band** from `roleFamily × yearsExperienceBand × evidenceTier`
  (+ optional city tier), with an explicit `confidence: LOW | MEDIUM`.
- Label it in UI exactly as: *"ABTalks indicative band — not the candidate's ask. The offer
  you make is the number that counts."*
- If a real `CandidateAvailability` row exists later, it **replaces** the estimate and flips the
  label to "shared by candidate". Never blend the two.
- The estimate never hard-filters anybody. It is display + a soft budget-fit signal only.

### 3.3 "Make the chatbot advanced" → retrieval, not a bigger prompt

The current bot is a deterministic slot machine with an LLM polish layer. That is *why* it is
reliable, so it stays. What is added is **grounded retrieval**: three read-only tools whose
outputs are produced by existing deterministic code, exposed to the model via Groq tool
calling. The model may call them to answer off-script questions and to open the conversation
with a true statement about the pool. It still cannot rank, filter, or invent.

Explicitly **not** building: pgvector, an embedding pipeline, or "RAG" in the vector sense.
With 46 members, ~2,900 profiles and no free-text corpus worth chunking (§1.5), structured
retrieval strictly dominates. Revisit only when there is real unstructured text (graded project
writeups at volume). **Do not let this become an embeddings project.**

---

## 4. Files to touch (complete map)

| Path | New/Edit | Server/Client | Note |
|---|---|---|---|
| `prisma/schema.prisma` | edit | — | `ProgramCohort.talentPoolOpenAt`; `ProgramMember.recruiterVisibilityConsentAt` unchanged |
| `prisma/migrations/<ts>_talent_pool_open/` | new | — | Additive: one nullable column |
| `src/features/hire/dossier.ts` | **new** | server | The Dossier type + builder (§5) |
| `src/features/hire/dossier-provenance.ts` | **new** | shared | `Provenance` enum + `Fact<T>` wrapper — tiny, no logic |
| `src/features/hire/pool-policy.ts` | **new** | server | Single source of truth for who is eligible (§6) |
| `src/features/hire/compensation.ts` | **new** | server | Indicative band + confidence (§8) |
| `src/features/hire/role-family.ts` | **new** | shared | Dirty `jobRole` → role family + working languages |
| `src/features/hire/score-candidate.ts` | edit | shared | Coverage-aware reweighting + tiers (§7) |
| `src/features/hire/score-candidate.test.ts` | edit | — | New cases (§7.4) |
| `src/features/hire/search-candidates.ts` | edit | server | Use pool-policy + dossier; keep result shape |
| `src/features/hire/types.ts` | edit | shared | `ScoreableMember` gains coverage + dossier ref |
| `src/features/hire/pool-facts.ts` | **new** | server | `poolSnapshot()` / `previewMatch()` / `dossierCard()` (§9) |
| `src/features/hire/scout-tools.ts` | **new** | server | Groq tool definitions + dispatcher (§9) |
| `src/features/hire/scout-conversation.ts` | edit | server | Opening line from snapshot; tool loop; live match count |
| `src/features/hire/explain-matches.ts` | edit | server | Provenance-aware prompt; extend grounding guard |
| `src/features/hire/to-public-match.ts` | edit | server | Map dossier → card (still no name/company/userId) |
| `src/lib/validations/hire.ts` | edit | shared | Zod for tool args + dossier card |
| `src/lib/groq.ts` | edit | server | Add optional `tools` + `tool_choice` passthrough |
| `src/components/hire/match-card.tsx` | edit | **Client** | Provenance badges, salary band, coverage note |
| `src/components/hire/gap-report.tsx` | edit | **Client** | Real pool numbers instead of generic copy |
| `src/components/hire/scout-chat.tsx` | edit | **Client** | Live "N candidates match so far" strip |
| `src/app/actions/hire-actions.ts` | edit | server | Pass coverage + estimate through |
| `src/app/actions/hire-guest-actions.ts` | edit | server | Same, guest path parity |
| `src/app/actions/talent-actions.ts` | edit | server | `setRecruiterVisibilityAction` (§10) |
| `src/components/program/visibility-toggle.tsx` | **new** | **Client** | Opt-in / opt-out card |
| `src/app/program/dashboard/page.tsx` (or its profile tab) | edit | Server | Mount the toggle |
| `src/features/program/admin.ts` | edit | server | Pool-readiness figures + `talentPoolOpenAt` toggle |
| `src/app/admin/program/…` cohort page | edit | Server | Surface the toggle + consent coverage |
| `docs/CHANGELOG.md` | edit | — | One line under `## Pending reconcile` |

**Server → Client boundary:** everything crossing is plain JSON — no `Date` objects (ISO
strings), no functions, no icon components, no Prisma model instances. `MatchCardData` remains
the only shape that reaches the browser for a candidate.

---

## 5. Phase 1 — The Candidate Dossier

### 5.1 Shape (`src/features/hire/dossier.ts`)

```ts
export type Provenance = "VERIFIED" | "DECLARED" | "DERIVED";
export type Fact<T> = { value: T; provenance: Provenance; asOf: string | null };

export type CandidateDossier = {
  // ── identity: public only. No fullName, no email, no phone, no company here.
  publicId: string;              // candidatePublicId(programMemberId) — existing helper
  source: "PROGRAM" | "CHALLENGE_60";
  programMemberId: string | null;
  userId: string | null;

  // ── declared profile
  roleFamily: Fact<RoleFamily>;          // DERIVED from dirty jobRole
  rawRoleLabel: Fact<string>;            // DECLARED, shown only as "self-described as …"
  yearsExperience: Fact<number>;
  education: Fact<{ level: string | null; university: string | null; gradYear: number | null }>;
  declaredSkills: Fact<string[]>;
  links: Fact<{ linkedin: boolean; github: boolean; resume: boolean }>; // booleans, not URLs

  // ── verified evidence
  evidence: {
    missionsPassed: Fact<number>;
    missionsAttempted: Fact<number>;
    missionPoints: Fact<number>;
    cleanPassCount: Fact<number>;
    cleanPassPct: Fact<number>;
    commitDays: Fact<number>;
    activeDaysSpan: Fact<number>;          // last commit − first commit, in days
    lastActiveAt: Fact<string | null>;
    projectScores: Fact<number[]>;
    interview: Fact<{ overall: number|null; comm: number|null; tech: number|null; problem: number|null } | null>;
    workingLanguages: Fact<string[]>;      // DERIVED: ProgramDay.language ∩ passed days
    missionTypesPassed: Fact<string[]>;    // CODE_SPRINT / SHIP_IT / DATA_ROOM / …
    cohortProgress: Fact<{ day: number; ofDays: number }>;
  };

  // ── coverage: which dimensions this cohort can even produce (§7)
  coverage: {
    dimensions: Record<ScoreDimension, boolean>;
    note: string;                          // "Projects and interviews start after day 7."
  };

  // ── compensation
  compensation: {
    declared: { min: number; max: number; currency: string } | null;  // from CandidateAvailability
    estimate: { min: number; max: number; currency: string; confidence: "LOW" | "MEDIUM" } | null;
  };

  availability: AvailabilitySnapshot;      // existing type; null ⇒ availabilityUnknown
};
```

### 5.2 Builder rules

- **One query batch, not N+1.** `buildDossiers(memberIds)` loads members + commitDays +
  projects + interview + availability + the `ProgramDay` language map in a fixed number of
  queries and returns a `Map<id, CandidateDossier>`. `buildDossier(id)` is a thin wrapper over
  it. Always `select`, never full records.
- **Never include** `fullName`, `phone`, `email`, raw `company`, interview transcript, or any
  URL. `links` is booleans only — "has a GitHub" is a signal, the URL is contact data and is
  released solely through the existing `TalentEngagementRequest` → `CONTACT_SHARED` flow
  (`features/hire/contact-access.ts`). This is already the rule in `pool.ts:16-35`; do not
  regress it.
- `asOf` is an ISO string or null. No `Date` objects — this object crosses to the client
  (redacted) and into LLM payloads.
- `workingLanguages`: join the member's **passed** mission days to `ProgramDay.language`,
  dedupe, drop nulls. Today that yields `PYTHON` for anyone past day 3 — correct and honest.
  Do **not** merge declared skills into this field; declared skills already have their own slot.
- `roleFamily`: `role-family.ts` maps a lower-cased, trimmed `jobRole` through an ordered
  keyword table → `STUDENT | DATA | AI_ML | BACKEND | FRONTEND | FULLSTACK | ANALYST |
  MANAGER | OTHER`. Anything unmatched is `OTHER`, never a guess. Keep the table in that one
  file so it is tunable without hunting.

### 5.3 Definition of done

`buildDossiers` returns correct dossiers for the 5 consenting members with zero PII fields
present in the JSON, in a bounded number of queries, and `tsc --noEmit` passes. Nothing else
changes behaviour yet — this phase ships dark.

---

## 6. Phase 2 — Pool eligibility policy

### 6.1 The problem restated

Three different files re-implement "who may a recruiter see" and one of them
(`resultsPublishedAt`) closes the whole product (§1.2).

### 6.2 `src/features/hire/pool-policy.ts` — the only answer

```ts
export type PoolGateResult =
  | { ok: true; cohortId: string; cohortName: string; stage: "PUBLISHED" | "IN_PROGRESS" }
  | { ok: false; reason: "NO_COHORT" | "POOL_CLOSED"; message: string };

export async function resolvePoolCohort(): Promise<PoolGateResult>;
export function memberEligibilityWhere(cohortId: string): Prisma.ProgramMemberWhereInput;
```

Rules, in order:

1. **Consent — absolute.** `recruiterVisibilityConsentAt != null`. No flag, no admin override,
   no exception. It is the one gate that never becomes configurable.
2. **Cohort stage.** A cohort is open to `/hire` when
   `resultsPublishedAt != null` **OR** `talentPoolOpenAt != null` (new nullable column, admin
   toggled). Stage is reported so the UI can say which. `/talent` **keeps using
   `resultsPublishedAt` alone** — do not touch `pool.ts:assertPoolAccess`. That is the whole
   point of a separate policy file.
3. **Status** ∈ `{ENROLLED, COMPLETED}` — unchanged.
4. **Minimum evidence floor:** at least `MIN_PASSED_MISSIONS = 3` passed missions. A member who
   applied and did nothing is not a candidate, consent or not. All 46 current members clear
   this (min missionPoints 36 ≈ 3 missions), so it costs nothing today and prevents an empty
   profile appearing the day a new cohort opens.

### 6.3 Wiring

- `search-candidates.ts` calls `resolvePoolCohort()`; on `ok: false` it returns the existing
  empty-with-message shape (the gap report path already handles it) plus `stage` for copy.
- `hire-request-actions.ts` (2 call sites) reuses `memberEligibilityWhere` so a recruiter can
  never raise an engagement request against someone Scout would not have shown.
- Admin toggles `talentPoolOpenAt` per cohort (§10).

### 6.4 Definition of done

With `talentPoolOpenAt` set on the live cohort, `searchCandidates` returns the **5 consenting
members** instead of `[]`. With it unset, behaviour is byte-identical to today. `/talent`
behaviour is unchanged in both cases.

---

## 7. Phase 3 — Coverage-aware scoring (the calibration fix)

### 7.1 Principle

**A candidate is never penalised for evidence the cohort has not had the chance to produce.**
If no member of the open cohort has a graded project, the projects dimension is not "0 for
everyone" — it is *out of scope for this cohort*, its weight is redistributed across the
dimensions that exist, and the recruiter is told which dimensions the ranking actually used.

### 7.2 Algorithm (in `score-candidate.ts`, still pure, still no LLM)

1. Compute `coverage: Record<ScoreDimension, boolean>` **once per search**, from the loaded
   pool, not per candidate:
   `projects` covered ⟺ any member has ≥1 graded project score;
   `interview` covered ⟺ any member has ≥1 non-null interview score;
   `stack`, `missions`, `cleanPass`, `consistency`, `experience` are always covered.
2. `reweight(priority, coverage)`: start from `BASE_WEIGHTS`, apply the existing ×1.5
   `evidencePriority` boost, then **zero every uncovered dimension** and renormalise the
   remainder to 100. Today that redistributes 25 points across stack/missions/cleanPass/
   consistency/experience.
3. Score exactly as now. The best member above now lands ≈ **89** (STRONG); a typical member
   ≈ 55–65 (PARTIAL) instead of NONE. That is the honest ranking of a day-4 cohort.
4. **Recalibrate `consistencyScore`.** `commitDays / 20` assumes a finished cohort. Use
   `commitDays / max(6, cohortDay - 1)` — commit days available so far, floored so an early
   cohort cannot produce a divide-by-tiny. Pass `cohortDay` in via the spec context.
5. `missionScore`: `missionPoints / 240` likewise assumes 20 missions. Use
   `missionPoints / max(36, cohortDay × 12)`. Day 4 ⇒ /48, so a member with 36 pts scores 0.75
   rather than 0.15.
6. **Tiers get a coverage caveat, not a moved threshold.** Keep STRONG ≥ 70 / PARTIAL ≥ 40, but
   attach `tierBasis: { dimensionsUsed: string[]; ofTotal: number }` to the breakdown and
   render it. When coverage < 5 of 7 dimensions, the card shows
   *"Ranked on 5 of 7 evidence dimensions — projects and interviews start after day 7."*
7. `scoreBreakdown` keeps every raw dimension score **including uncovered ones** (as `null`,
   not `0`) so the audit trail stays complete.

### 7.3 What must not change

- Hard filters (consent, status, availability rules) — untouched.
- Missing must-have stack still blocks STRONG via `tierFor`.
- The `nearMisses` / gap-report path still receives hard-filtered and `NONE` rows.
- `rankCandidates` signature stays compatible; coverage arrives as an optional third
  argument with a fully-covered default, so existing tests keep passing.

### 7.4 Tests to add (`score-candidate.test.ts`, no network)

| # | Case |
|---|---|
| T1 | Uncovered projects+interview ⇒ weights renormalise to 100 and no dimension is negative |
| T2 | Same member scores strictly higher under partial coverage than under full coverage |
| T3 | A member with zero projects in a **covered** cohort is still penalised (regression guard) |
| T4 | `cohortDay = 4` ⇒ 36 missionPoints scores > 0.5; `cohortDay = 30` ⇒ same 36 scores < 0.2 |
| T5 | `evidencePriority` boost still reorders after coverage renormalisation |
| T6 | Missing must-have never yields STRONG under any coverage |
| T7 | Empty pool ⇒ `[]`, no throw |

---

## 8. Phase 4 — Indicative compensation

`src/features/hire/compensation.ts`, pure, no DB:

```ts
export function estimateCompensation(input: {
  roleFamily: RoleFamily;
  yearsExperience: number;
  evidenceTier: "STRONG" | "PARTIAL" | "NONE";
  city?: string | null;
}): { min: number; max: number; currency: "INR"; confidence: "LOW" | "MEDIUM" } | null;
```

- Base bands live in **one exported table** in this file, annual INR, by
  `roleFamily × experienceBand (0-1 / 2-3 / 4-6 / 7+)`. Internships/0-experience rows are
  expressed annually and rendered monthly by the UI when
  `spec.employmentType === "INTERNSHIP"` (the monthly/annual logic already exists in
  `scout-conversation.ts:parseMoney` — reuse its convention, do not invent a second one).
- `evidenceTier` shifts the band by a fixed ±10%, nothing cleverer.
- `confidence` is `MEDIUM` only when `roleFamily !== "OTHER"` **and** the member has ≥8 passed
  missions; otherwise `LOW`.
- Returns `null` for `roleFamily === "OTHER"` with low evidence — **no band is better than a
  made-up band**.
- Never used as a hard filter. Never persisted onto the member. Recomputed per render.
- Copy is fixed and non-negotiable:
  *"ABTalks indicative band, from role and verified evidence — not the candidate's ask."*

---

## 9. Phase 5 — Grounded retrieval for the agent

### 9.1 `pool-facts.ts` — deterministic, the only thing the model may read

```ts
poolSnapshot(): {
  stage, cohortName, cohortDay, ofDays,
  eligibleCount,               // consent + policy
  totalMembers,                // for the honest "of N" line
  topSkills: {skill,count}[],  // top 12
  experienceMix, roleFamilyMix,
  coverage, coverageNote,
}
previewMatch(spec): { strong: number; partial: number; none: number; topMissingMustHave: string[] }
dossierCard(publicId): redacted single-candidate card (dossier minus identity)
```

All three are thin wrappers over `pool-policy` + `dossier` + `rankCandidates`. **No new SQL
lives here that is not one of those.** `previewMatch` calls the same ranking the real search
calls — so a number the agent quotes mid-conversation cannot disagree with the final result.

Cache `poolSnapshot()` per request (module-level memo keyed by cohortId + a 60s timestamp) —
it runs on every Scout turn and must not add a query storm.

### 9.2 Tool calling

- `src/lib/groq.ts`: add optional `tools` and `tool_choice` passthrough to the existing
  request body, and return `tool_calls` when present. **Do not change any existing call
  signature or default** — `askGroqJson` keeps behaving exactly as today for its current
  callers (`explain-matches`, existing `scout-conversation` paths).
- `src/features/hire/scout-tools.ts`: the three JSON tool schemas + a dispatcher that Zod-parses
  arguments and calls `pool-facts`. Loop cap: **2 tool round-trips per turn**, then answer with
  what it has. Total turn budget stays inside the existing 8s Groq timeout; on timeout or tool
  error, fall through to the current deterministic turn — the conversation must never stall.
- The model may call tools **only** to describe the pool and answer questions. It still cannot
  set slots, filter, rank, or name a candidate.

### 9.3 Conversation upgrades (all inside `scout-conversation.ts`)

1. **Opening line from reality.** Replace the static intro with one built from `poolSnapshot()`:
   *"I'm Scout. Right now I can search 5 consenting people from the AI Cohort — day 4 of 30,
   strongest in Python and SQL. Tell me the role you're filling."*
   If `eligibleCount === 0`, keep today's honest empty-pool copy verbatim.
2. **Live match count.** After each filled slot, run `previewMatch` and return
   `matchPreview: { strong, partial }` in the turn payload; `scout-chat.tsx` renders a small
   strip: *"12 → 4 candidates still match."* This is the single most convincing "advanced"
   signal and it costs no LLM call.
3. **Off-script questions answered.** "Do you have anyone with Airflow?" mid-flow → tool call →
   grounded answer → then re-ask the pending slot. The slot machine still owns the sequence;
   the tools only let the model answer without leaving it.
4. **Stack suggestions from real skills.** When asking for must-have stack, source the chips
   from `topSkills` instead of a hardcoded list — the recruiter picks from what actually exists.

### 9.4 Grounding guard extension (`explain-matches.ts`)

`groundedFigures()` currently whitelists digits from the candidate's evidence payload. Extend
the allowed set with digits from the tool outputs handed to that same model call, and add
provenance instruction to the system prompt:

> Skills, role and experience are **self-declared** — write them as "declared". Missions, clean
> passes, commit days, project and interview scores are **verified by the platform** — those you
> may state as fact. The salary band is an **ABTalks estimate**, never the candidate's ask.

The existing `inventsFigures` discard-and-fall-back-to-deterministic behaviour stays exactly as
is. Do not weaken it.

---

## 10. Phase 6 — Consent self-service + admin pool readiness

### 10.1 Member-side visibility toggle (unblocks 41 of 46 people)

- `setRecruiterVisibilityAction(enabled: boolean)` in `talent-actions.ts`: Zod boolean, session
  user must own a `ProgramMember` row, sets `recruiterVisibilityConsentAt` to `new Date()` or
  `null`. Result envelope, `logger`, `revalidatePath`.
- `visibility-toggle.tsx` (Client) mounted on the program dashboard profile area. Copy states
  plainly what becomes visible (verified evidence + declared skills + role family) and what
  never does (name, email, phone, resume, links — released only when the member's contact is
  shared through an accepted engagement request).
- **Off by default. Never pre-ticked. Turning it off removes the member from the pool on the
  next search** — verify this, it is the promise the copy makes.
- Existing consent timestamps are not touched by this phase.

### 10.2 Admin

- Cohort admin gains: consent coverage (`5 / 46`), evidence coverage per dimension, eligible
  count after the policy, and a **"Open talent pool"** toggle writing `talentPoolOpenAt`.
- Copy next to the toggle: *"Opens /hire matching for consenting members of a cohort that is
  still running. /talent stays closed until results are published."*
- Reuse `requireAdmin`. No new admin route — extend the existing cohort page.

---

## 11. Phase 7 — Challenge-track candidates (explicitly deferred)

Not today, and the reason is legal not technical: 2,863 `StudentProfile` rows have **no
consent field**. When it happens: add `StudentProfile.recruiterVisibilityConsentAt`, add the
same self-service toggle, gate on `Certificate` issued **or** `isReadyForInterview` **or** ≥30
submissions (176 + 54 users qualify on volume alone), build a `source: "CHALLENGE_60"` dossier
from `Submission`/`DailyTask.domain`/`Certificate.metadata`, and cap the tier at PARTIAL as
plan 062 §9 specifies. `TalentCandidateSource` already has the enum values. **Do not start this
until phases 0–6 are live and observed.**

---

## 12. Phase order and dependencies

```
Phase 0  DB safety + apply 3 pending migrations           ← blocks everything
   │
   ├── Phase 1  Dossier + provenance + role-family        (ships dark)
   │      │
   │      ├── Phase 2  pool-policy + talentPoolOpenAt     ← first visible change
   │      │      │
   │      │      └── Phase 3  coverage-aware scoring      ← makes the list correct
   │      │             │
   │      │             ├── Phase 4  compensation estimate
   │      │             └── Phase 5  pool-facts + tools + chat upgrades
   │      │                    │
   │      └────────────────────┴── Phase 6  consent toggle + admin readiness
   │
   └── Phase 7  challenge source (deferred)
```

**Minimum shippable today:** 0 → 1 → 2 → 3. That alone turns "always the template" into a real
ranked list of the consenting members, correctly calibrated for a day-4 cohort.
**Full answer to the ask:** + 4, 5, 6.

---

## 13. DB safety (schema/data changes present — read before touching Prisma)

Commit checkpoint first: record the hash of `fix/hire-scout-conversation` tip before any
migrate command, in this file's changelog line.

**Phase 0 — applying the three pending migrations:**

1. Confirm `DATABASE_URL` **and** `DIRECT_URL` in `.env.local` both point at the **Neon branch**,
   not production. Both. `DIRECT_URL` was the trap called out in plan 062 §15.
2. `npx prisma migrate status` — read the host substring out loud before continuing.
3. `npx prisma migrate deploy` on the branch. All three migrations are additive
   (CREATE TABLE / TYPE / INDEX). **Read the SQL before running.** If any statement contains
   `DROP`, stop and report — that is not the expected content.
4. `npx prisma generate`.
5. Verify the 7 tables from §1.1 now exist.

**Phase 2 — the one new column:**

```prisma
model ProgramCohort {
  // …
  /// Opens /hire matching for a cohort that is still running. /talent continues
  /// to gate on resultsPublishedAt alone.
  talentPoolOpenAt DateTime?
}
```

`prisma migrate dev --name talent_pool_open` → expect exactly one
`ALTER TABLE "ProgramCohort" ADD COLUMN "talentPoolOpenAt" TIMESTAMP(3);`. Nullable, no default,
no backfill, no data touched.

**Never:** `migrate reset`, `db push`, any `DROP`, or a migrate run while `DIRECT_URL` points at
production. Production migration happens only through the controlled deploy path.

---

## 14. Guardrails (DO NOT)

1. **DO NOT** weaken, bypass, or auto-set `recruiterVisibilityConsentAt`. Ever. Not for a demo.
2. **DO NOT** change `/talent`'s gate. `pool.ts:assertPoolAccess` keeps using
   `resultsPublishedAt` alone. Only `/hire` reads `pool-policy`.
3. **DO NOT** put `fullName`, `company`, email, phone, resume URL, LinkedIn/GitHub URLs, or
   interview transcript into a dossier, an LLM payload, or anything crossing to the client.
   Contact release stays exclusively in the `TalentEngagementRequest` → `CONTACT_SHARED` path.
4. **DO NOT** let the LLM pick filters, rank, or set slots. Tools are read-only; ranking is
   `score-candidate.ts`; the slot machine owns the question order.
5. **DO NOT** remove or weaken `inventsFigures` / `groundedFigures` in `explain-matches.ts`.
6. **DO NOT** build embeddings, pgvector, or a resume parser (§1.5, §3.3).
7. **DO NOT** break the guest path. `hire-guest-actions.ts` must receive every change
   `hire-actions.ts` receives — the two paths render the same cards.
8. **DO NOT** change existing `askGroqJson` behaviour for its current callers when adding tools.
9. **DO NOT** modify `src/lib/anthropic.ts` or its program-grading callers.
   `src/lib/claude-agent.ts` is dead code — leave it alone, do not extend it, do not delete it
   in this branch.
10. **DO NOT** import `@/lib/*` in `middleware.ts`. `/hire` is already in the protected list;
    nothing here changes it.
11. **DO NOT** create abstraction files beyond those listed in §4. If logic is trivial, inline it.
12. Always: Zod at every boundary, `{ ok: true, data } | { ok: false, message }`, Prisma
    `select`, `lib/logger.ts` (never `console.error`), `buttonVariants` on `<Link>` (never
    `<Button asChild>`), Server Components by default, strict TS with no `any`.
13. When a build error contradicts an assumption in this plan, **trust the error**, re-check the
    model/API, and correct the plan — do not defend the plan.

---

## 15. Verification

| # | Check | How |
|---|---|---|
| V0 | 7 hire tables exist on the Neon branch; `migrate status` host is the branch | psql / prisma |
| V1 | `tsc --noEmit` and production build pass | `npm run build` |
| V2 | Scoring tests T1–T7 pass with no network | `npm test` (or the project's runner) |
| V3 | `talentPoolOpenAt` unset ⇒ `/hire` behaves **exactly** as today (gap report) | manual |
| V4 | `talentPoolOpenAt` set ⇒ exactly the **5 consenting** members appear, 41 do not | manual + count |
| V5 | Best current member reaches STRONG; the ranking order is defensible by hand | inspect breakdown |
| V6 | Every card shows the coverage note "ranked on N of 7 dimensions" | manual |
| V7 | Every displayed fact carries a provenance badge; declared vs verified are visually distinct | manual |
| V8 | Salary band renders with the exact estimate wording; never a hard filter | manual |
| V9 | Network payload (DevTools) contains **no** name, company, email, phone, or URL | inspect |
| V10 | Scout's opening line quotes the real eligible count and real top skills | manual |
| V11 | Live match count after each answer equals the final match count for the same spec | manual |
| V12 | Off-script question ("anyone with Airflow?") answered from tools, then the pending slot is re-asked | manual |
| V13 | LLM unreachable (unset `GROQ_API_KEY` locally) ⇒ conversation, matching and rationales all still work | manual |
| V14 | Member toggles visibility off ⇒ disappears from the next search | manual |
| V15 | Guest `/hire` path renders the same cards as the signed-in path | manual |
| V16 | `/talent` pool, profile and shortlist behave exactly as before | manual regression |
| V17 | Engagement request flow (shortlist → request → contact shared) unchanged | manual regression |

**Files that should have changed** at the end: exactly those in §4 and nothing else.
Confirm with `git status` before reporting done.

---

## 16. Commit messages (one per phase, not one big commit)

```
Phase 0  chore(db): apply pending hire migrations on the cohort branch
Phase 1  feat(hire): candidate dossier with per-field provenance
Phase 2  feat(hire): one pool-eligibility policy, openable mid-cohort
Phase 3  fix(hire): rank on the evidence a cohort has actually produced
Phase 4  feat(hire): indicative compensation band, labelled as an estimate
Phase 5  feat(hire): Scout reads real pool facts instead of guessing
Phase 6  feat(program): members can turn recruiter visibility on themselves
```

Body for Phase 3 (the one that needs explaining):

```
fix(hire): rank on the evidence a cohort has actually produced

Projects and interviews are worth 25 of 100 points and no member of a
day-4 cohort can have either, so the best candidate on the platform
topped out at 67 and never reached STRONG. Dimensions the open cohort
cannot produce now drop out of the weighting and the rest renormalise,
and mission/commit expectations scale with the cohort day rather than
with a finished 30-day run. The recruiter is told which dimensions the
ranking used.
```

---

## 17. Changelog line (append when shipping, under `## Pending reconcile`)

```
2026-08-13 | hire: candidate dossiers with provenance, coverage-aware scoring, mid-cohort pool policy, grounded Scout retrieval, member visibility toggle
```

---

## 17b. Build log — what actually shipped (2026-08-13)

Implemented on `fix/hire-scout-conversation`. `tsc --noEmit` clean, production
build passes, 15/15 scoring tests pass.

| Phase | Status | Notes |
|---|---|---|
| 0 — migrations | **blocked** | `prisma migrate deploy` denied by the local permission classifier. Owner must run it; see §19. |
| 1 — dossier | done | `dossier-provenance.ts`, `role-family.ts`, `dossier.ts`, types in `types.ts` |
| 2 — pool policy | done | `pool-policy.ts`. **Env flag, not a schema column** — see below |
| 3 — coverage scoring | done | `score-candidate.ts` reworked; T1–T8 added |
| 4 — compensation | done | `compensation.ts`, wired into card and stored-match load |
| 5 — pool facts | done | `pool-facts.ts`; honest opening line wired into `/hire` |
| 5 — Groq tool loop | **not built** | See "deliberately not built" below |
| 6 — consent toggle | done | `setRecruiterVisibilityAction` + `visibility-toggle.tsx` on the program dashboard |
| 6 — admin readiness | not built | Follow-up |

**Deviation from §6.2 — the gate is an env flag, not `talentPoolOpenAt`.**
Three migrations were already unapplied and blocked; adding a fourth would have
made the release strictly harder to land. `HIRE_OPEN_COHORT_IDS` (comma-separated
cohort ids, or `all`) opens a running cohort to `/hire`. Unset = today's
published-only behaviour, so the default path is unchanged. The admin toggle and
the column remain the right long-term shape — do them once migrations flow again.

**Deliberately not built: the Groq tool-calling loop.** `pool-facts.ts` exists
and feeds the honest opening line, but the model is not yet given tools. With
zero consenting candidates who have evidence, an agent that can query the pool
has nothing to say that the opening line does not already say. Build it after
the consent drive, when `previewMatch` returns numbers that move.

**Verified against live data.** Simulating the new weights over the real cohort
(must-have Python+SQL, projects/interview uncovered) produces a genuine spread —
82, 82, 81, 77, 74, 73, 71 (STRONG), then 66 down to 38. Under the old rubric the
same people all scored below 70 and most filtered out as `NONE`.

---

## 19. Owner run-book (in order)

1. **Apply the migrations** — required; `/hire` throws without these tables:
   ```
   PGURL=$(grep '^DATABASE_URL' .env.local | sed 's/DATABASE_URL=//' | tr -d '"')
   DATABASE_URL="$PGURL" DIRECT_URL="$PGURL" npx prisma migrate deploy
   ```
   All three are CREATE TABLE / TYPE / INDEX and ALTER ADD only — verified, no
   DROP. Also add `DIRECT_URL` to `.env.local` (same value as `DATABASE_URL` —
   this Neon endpoint is already the direct one) so Prisma commands stop failing
   on the missing variable.

2. **Run the consent drive.** This is the release, not a follow-up. Point cohort
   members at `/program/dashboard`, where the new *Recruiter visibility* card
   explains exactly what a recruiter sees and never sees. Until people opt in,
   the shortlist is empty by design.

3. **Open the pool** once consent numbers justify it:
   ```
   HIRE_OPEN_COHORT_IDS=cms969sax000jkv04sd9tmk42,cmrp9r3wt000cjx04eeugfxyp
   ```
   (India Aug 26 = 27 members, USA = 19.) Leave unset to keep `/hire` closed.

4. **Watch the first search.** `belowEvidenceFloor` in the gap paragraph tells
   you whether the bottleneck is consent or evidence.

---

## 18. Open decisions for the owner (do not block on these)

1. **Open the pool now?** Setting `talentPoolOpenAt` shows a day-4 cohort to recruiters. The
   copy is honest about it, but it is a business call. Default in this plan: build the toggle,
   leave it **off**, let the owner flip it.
2. **Consent drive.** The toggle makes opting in possible; an email or dashboard nudge makes it
   happen. Out of scope here — worth a separate small plan.
3. **Challenge pool (2,863 people).** Needs a consent field and a nudge campaign before it is
   worth any engineering. Phase 7.
