# 062 — Scout at `/hire`: evidence-based hiring agent (master plan)

> **Branch:** `feat/hire-scout-evidence-matching` (from `upstream/master` @ `d207033`)  
> **Route:** `/hire` · **Agent product name:** **Scout**  
> **Sibling surface:** `/talent` = browse & filter the published pool · `/hire` = gather a real requirement and let Scout rank people by **verified platform evidence**  
> **Status:** Architecture locked · ready for phased execution · **empty-DB path is a first-class product path, not an edge case**

---

## 0. How to use this document

| Audience | Read |
|---|---|
| Owner / CEO | §1–2, §4 (demand loop), §15 (phases overview), §18 (out of scope) |
| Executor (Cursor) | §6–14, §16–17, §19–20 — do **not** invent schema or agent architecture |
| Parallel developer (candidate availability) | §5.1 only + verification in §17 |

**Non-negotiable product thesis**

ABTalks does **not** hire from resumes. We hire from **what people did on this platform under verification**:

- Server-run mission checks (`ProgramMissionSubmission.verdict`)
- First-attempt quality (`cleanPassCount`)
- Real GitHub commit days (`ProgramCommitDay`)
- Rubric-graded projects (`ProgramProject.aiScore` + `aiRubricJson` + `adminScore`)
- Scored exit interview dimensions (`ProgramInterview.commScore` / `techScore` / `problemScore`)

Research on structured / evidence-based hiring (OPM structured interviews; industrial-org psychology meta-analyses) consistently finds that **work samples + structured scores** beat unstructured resume screens. Scout is the product expression of that: define success up front → evaluate every candidate against the same evidence columns → show the trail.

---

## 1. Goal (one paragraph)

Give **approved recruiters** a conversational agent (**Scout**) at `/hire` that asks the few questions that actually change a shortlist (role, stack, evidence priority, compensation, logistics), then searches the ABTalks database and returns candidates ranked by **demonstrable work**, with a written rationale that cites only real rows. When the pool is empty or thin — **today’s normal case** — the requirement is still captured as demand, the recruiter sees an honest gap report, and ABTalks can train / fill against real employer stacks via an admin demand board.

**Success = working end-to-end on day one of empty DB:**  
recruiter chats → requirement saved → “no verified matches yet” + gap story → demand visible to admin → later, when evidence exists, same requirement can re-match.

---

## 2. Product surfaces (naming)

| Surface | URL | Who | Purpose |
|---|---|---|---|
| **Scout** | `/hire` | Approved `Role.RECRUITER` | Conversational intake + match + gap + “train a cohort for this” |
| Resume a search | `/hire/[requestId]` | Same | Transcript + frozen matches + re-run |
| Talent pool (existing) | `/talent` | Same | Manual browse / shortlist (unchanged) |
| Candidate profile (existing) | `/talent/members/[id]` | Same | Deep evidence page — Scout links here, does not rebuild it |
| Demand board | `/admin/hire-demand` | Admin | Aggregated employer demand → curriculum signal |
| Candidate availability | Program dashboard + `/profile` | Learner | Opt-in salary / notice / mode / city (**parallel track §5.1**) |

**Why `/hire` not `/new` / `/recruit` / `/scout`:** short verb, no collision with Next.js conventions, pairs with “Hire with ABTalks” marketing, agent nickname **Scout** lives in UI copy not the path.

---

## 3. Current platform state (what we reuse)

### 3.1 Recruiter spine — already built

| Piece | Where | Scout reuses as |
|---|---|---|
| Recruiter registration + admin approval | `RecruiterProfile`, `src/features/talent-pool/recruiter-registration.ts` | Gate for `/hire` — **no second recruiter model** |
| `requireRecruiter()` | `src/lib/program-auth.ts` | Same gate as `/talent` |
| Consent gate | `ProgramMember.recruiterVisibilityConsentAt` enforced in `pool.ts` | **AND-gate on every Scout query** |
| Cohort publish gate | `ProgramCohort.resultsPublishedAt` | Same — unpublished cohort = invisible |
| Shortlist | `RecruiterShortlistItem` + `toggleShortlist` in `pool.ts` | Results shortlist through existing action |
| Pool filters (manual) | `/talent` + `PoolFilters` | Stay; Scout is the *conversational* path, not a replacement day-one |
| Claude grading helper | `src/lib/anthropic.ts` (`askClaudeJson`) | **Leave untouched** for program grading; Scout gets `src/lib/claude-agent.ts` |

### 3.2 Evidence inventory (the moat)

| Evidence | Model | Proves |
|---|---|---|
| Mission check verdicts | `ProgramMissionSubmission.verdict` | Named server checks passed — not self-report |
| First-attempt passes | `ProgramMember.cleanPassCount` | Quality vs grind |
| Commit consistency | `ProgramCommitDay` | Real calendar days with commits (cron-polled) |
| Project quality | `ProgramProject` scores + rubric JSON | Rubric-grounded quality |
| Interview | `ProgramInterview` dimension scores + `summary` | Comm / tech / problem (no full transcript to recruiters) |
| Mission shape | `ProgramMissionType` enum | CODE_SPRINT, SHIP_IT, DATA_ROOM, PROMPT_FORGE, BOSS_BUILD |
| Challenge track (weaker) | `Submission`, `QuizAttempt`, `Certificate`, streaks | Real but thinner — cap at PARTIAL tier |

### 3.3 The structural gap (must design around, not ignore)

A recruiter will ask for **salary, notice period, location, work mode**.  
A grep of the schema for those candidate fields returns **nothing**.

| Option | Verdict |
|---|---|
| Invent match from thin air | **Forbidden** — matching engine that lies |
| Collect as recruiter-side outreach notes only | Honest but weak shortlist |
| **CandidateAvailability** opt-in model | **Chosen** — parallel track §5.1 |

Until §5.1 ships, Scout **collects** logistics from the recruiter and labels candidate logistics as **“not verified — confirm at outreach”** (`availabilityUnknown: true`). Ability ranking still works.

### 3.4 Empty database reality

- Shared Neon is often empty of *consenting, published, evidenced* members.
- Correct behaviour is **gap report + demand capture**, not a spinner with zero UX.
- Seed fixtures (§5.3) exist so ranking can be tested; production UX must not depend on seed.

---

## 4. End-to-end product loop (why phases connect)

```text
 ┌──────────────┐     ┌──────────────┐     ┌────────────────┐
 │  A. CONVERSE │ ──► │  B. SEARCH   │ ──► │  C. EXPLAIN    │
 │  Claude      │     │  TS+Prisma   │     │  Claude        │
 │  → JobSpec   │     │  deterministic│     │  grounded only │
 └──────────────┘     └──────────────┘     └────────────────┘
        │                     │                      │
        ▼                     ▼                      ▼
  TalentRequest          scored rows           rationale / gaps
  + messages             TalentRequestMatch    match cards OR
                                               gap report
        │                                            │
        │         if STRONG/PARTIAL matches          │
        │──────────────── shortlist ─────────────────┤
        │                                            │
        │         if NONE / empty pool               │
        ▼                                            ▼
  status ACTIVE + alertWhenAvailable          "Train this cohort"
        │                                            │
        ▼                                            ▼
  /admin/hire-demand  ── curriculum ──►  train kids on stack ──► re-match later
```

**CEO framing:** Scout is not a chat toy. It is a **demand capture system with a matching front-end**. Matching quality improves as the program pool fills; **demand value exists from day one**.

---

## 5. Prerequisites & parallel tracks

### 5.1 Candidate availability — **parallel developer, can start immediately**

**Why:** Without this, salary / notice / mode / city never become real filters.

**Deliverable:** model `CandidateAvailability` (§7), one shared form component, one server action, privacy copy.

| Field | Type | Rules |
|---|---|---|
| `openToWork` | Boolean | Default **false**. Master switch. |
| `expectedSalaryMin/Max` | Int? | Whole currency units; max ≥ min when both set |
| `salaryCurrency` | String | Default `INR` |
| `noticePeriodDays` | Int? | Chips: 0 / 15 / 30 / 60 / 90; store int |
| `preferredWorkMode` | enum? | ONSITE / HYBRID / REMOTE / FLEXIBLE |
| `preferredCities` | String[] | Max 5, trim + title-case |
| `openToRelocate` | Boolean | Default false; true cancels city hard-fail |

**Surfaces (non-blocking):**

- Program: card after results publish is meaningful; optional on program profile
- Challenge: `/profile` only if `Certificate` exists or `isReadyForInterview`

**Privacy (non-negotiable):**

- Opt-in only; no pre-ticked “open to work”
- Visible to recruiters only when **also** `recruiterVisibilityConsentAt` set (**AND**)
- Turning `openToWork` off removes from availability filters immediately
- Update `content/legal/privacy.md` + bump `PRIVACY_VERSION` (triggers reconsent banner)

**Zod:** salary bounds, notice 0–180, cities ≤5 × ≤60 chars. Result envelope. Prisma `select`.

### 5.2 Recruiter prerequisites (built)

- `User.role = RECRUITER` + `RecruiterProfile.approved = true`
- Same rejection UX as `/talent` for pending / none

### 5.3 Seed fixtures (required for ranking QA)

Script `prisma/seed-hire-fixtures.ts` produces **≥3** program members:

1. **Strong all-round** — high cleanPass, projects, interview, broad stack  
2. **Narrow stack specialist** — excellent on one stack, weak elsewhere  
3. **Consistency beast** — many commit days, moderate scores  

All must have: visibility consent + published cohort + real evidence rows. Identical clones prove nothing about ranking.

### 5.4 Environment

| Item | Status | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | exists | Used by program grading |
| `@anthropic-ai/sdk` | **add** | Multi-turn + structured output for Scout |
| Neon **dev branch** | **must create** | §16 — never migrate prod accidentally |
| Model id | plan on `claude-opus-5` or current project default | Confirm against live Anthropic model list at implement time; pin in env `HIRE_ANTHROPIC_MODEL` |

### 5.5 Legal

- New personal data categories for §5.1 require privacy update  
- Scout ranks; **human decides** — no auto-reject (DPDP automated-decision posture)  
- Never expose to recruiters: `ProgramMember.phone`, `ProgramInterview.transcript`, `RecruiterReview.logistics` / `.compensation`

---

## 6. Architecture — three phases, not an agent tool-loop

### Why not “Claude with tools that query the DB”

Hiring shortlists must be:

1. **Reproducible** — same spec → same candidate set  
2. **Auditable** — every rank explainable from columns  
3. **Safe** — model cannot invent a mission score  

So:

| Phase | Owner | Output |
|---|---|---|
| **A CONVERSE** | Claude, structured JSON, multi-turn, **no tools** | Partial `JobSpec`, next question, option chips, `readyToSearch` |
| **B SEARCH** | Pure TypeScript + Prisma | Scored candidates + frozen evidence snapshots |
| **C EXPLAIN** | Claude, given **only** Phase B rows | Per-candidate rationale + overall gaps |

Re-search = edit spec → B → C again.

### Claude client

- **New** `src/lib/claude-agent.ts` with `@anthropic-ai/sdk`  
- **Do not** modify `src/lib/anthropic.ts` or its callers  
- Structured output via schema; cache system prompt when supported  
- Degrade path: if Claude down, show a **plain form** over the same `JobSpec` fields (requirement is the artefact)

### Conversation UX rules (product)

- **One question per turn**  
- **≤ 6 turns** before offering “Search now”  
- Every question: **tappable chips + free-text escape**  
- Live **editable spec chip row** (role, stack, salary, mode, …)  
- Never invent a candidate name or score in chat  

---

## 7. What Scout asks (parameter set)

### Always high information-gain (usually always asked)

1. **Role + seniority** — title; Intern / Junior 0–2 / Mid 2–5 / Senior 5+ / Lead; openings  
2. **Must-have stack** — blocking filter; *highest signal*  
3. **Evidence priority** — unique to ABTalks: code correctness · ship speed · consistency · communication · data/SQL · AI/prompting → reweights score  
4. **Compensation band** — min/max, currency, period  

### Asked when relevant

5. Work mode + location (+ hybrid office days if hybrid)  
6. Notice ceiling (0 / 15 / 30 / 60 / 90)  
7. Employment type (FT / contract / internship / part-time)  
8. Experience band (if not inferred from seniority)  
9. Min evidence bar (must have graded project / interview / min clean-pass rate)  

### Defaulted, shown as chips

- openings = 1  
- education requirement = **none (evidence only)** — product thesis  
- urgency = normal  

### Nice-to-have stack

Scoring only, never hard-filters.

---

## 8. Schema (additive only)

```prisma
enum TalentRequestStatus { DRAFT  ACTIVE  MATCHED  FULFILLED  CLOSED }
enum TalentWorkMode      { ONSITE  HYBRID  REMOTE  FLEXIBLE }
enum TalentEmploymentType{ FULL_TIME  CONTRACT  INTERNSHIP  PART_TIME }
enum TalentSeniority     { INTERN  JUNIOR  MID  SENIOR  LEAD }
enum TalentMatchTier     { STRONG  PARTIAL  NONE }

model TalentRequest {
  id                 String                @id @default(cuid())
  recruiterUserId    String
  status             TalentRequestStatus   @default(DRAFT)
  title              String
  seniority          TalentSeniority?
  openings           Int                   @default(1)
  mustHaveStack      String[]              @default([])
  niceToHaveStack    String[]              @default([])
  evidencePriority   String[]              @default([])
  salaryMin          Int?
  salaryMax          Int?
  salaryCurrency     String                @default("INR")
  salaryPeriod       String                @default("ANNUAL")
  workMode           TalentWorkMode?
  locationCity       String?
  employmentType     TalentEmploymentType?
  noticePeriodDays   Int?
  minExperience      Int?
  maxExperience      Int?
  requiresDegree     Boolean               @default(false)
  extra              Json?                 // never used for matching
  alertWhenAvailable Boolean               @default(false)
  createdAt          DateTime              @default(now())
  updatedAt          DateTime              @updatedAt
  recruiter          User                  @relation(...)
  messages           TalentRequestMessage[]
  matches            TalentRequestMatch[]

  @@index([recruiterUserId, createdAt(sort: Desc)])
  @@index([status, createdAt(sort: Desc)])
}

model TalentRequestMessage {
  id        String   @id @default(cuid())
  requestId String
  role      String   // "user" | "assistant"
  content   String
  options   Json?
  createdAt DateTime @default(now())
  request   TalentRequest @relation(...)
  @@index([requestId, createdAt])
}

model TalentRequestMatch {
  id              String  @id @default(cuid())
  requestId       String
  programMemberId String?
  studentUserId   String?
  score           Int
  tier            TalentMatchTier
  scoreBreakdown  Json
  evidence        Json
  rationale       String?
  gaps            String[] @default([])
  availabilityUnknown Boolean @default(true)
  createdAt       DateTime @default(now())
  request         TalentRequest @relation(...)
  programMember   ProgramMember? @relation(...)
  @@index([requestId, score(sort: Desc)])
  @@index([programMemberId])
}

model CandidateAvailability {
  id                String  @id @default(cuid())
  userId            String  @unique
  openToWork        Boolean @default(false)
  expectedSalaryMin Int?
  expectedSalaryMax Int?
  salaryCurrency    String  @default("INR")
  noticePeriodDays  Int?
  preferredWorkMode TalentWorkMode?
  preferredCities   String[] @default([])
  openToRelocate    Boolean @default(false)
  updatedAt         DateTime @updatedAt
  user              User @relation(...)
  @@index([openToWork, updatedAt(sort: Desc)])
}
```

Back-relations: `User.talentRequests`, `User.candidateAvailability`, `ProgramMember.requestMatches`.

**No `TalentDemand` table** — demand board = `groupBy` on `TalentRequest`.

---

## 9. Scoring (deterministic, weighted, explainable)

Implemented in `src/features/hire/score-candidate.ts` — **zero LLM**.

### Hard filters (fail any → never returned)

1. `recruiterVisibilityConsentAt != null`  
2. Cohort `resultsPublishedAt != null`  
3. `status ∈ {ENROLLED, COMPLETED}`  
4. Every `mustHaveStack` token present in `skills[]` (case-insensitive) **or** found in project writeups when explicitly allowed by config  
5. If `CandidateAvailability` exists and `openToWork`: salary / notice / mode / city rules; if row **absent**, do **not** exclude — set `availabilityUnknown: true`

### Weights (0–100), reordered by `evidencePriority`

| Dimension | Default weight | Source |
|---|---:|---|
| Stack overlap | 25 | skills + optional project writeup tokens |
| Verified missions | 20 | missionPoints, pass ratios |
| First-attempt quality | 15 | cleanPassCount / attempted |
| Project quality | 15 | best/mean aiScore & adminScore |
| Consistency | 10 | distinct ProgramCommitDay |
| Interview | 10 | mean of three scores if published |
| Experience fit | 5 | yearsExperience vs band |

`evidencePriority` applies **1.5×** to chosen dimension(s) then renormalises.

### Tiers

| Tier | Rule |
|---|---|
| STRONG | score ≥ 70 and all must-haves |
| PARTIAL | 40–69 **or** near-miss must-have (shown with gaps) |
| NONE | < 40 — used for gap analysis inputs, not shortlist hero |

Challenge-track candidates: reduced model, **cap at PARTIAL**.

Every component → `scoreBreakdown` JSON for audit.

---

## 10. When nothing matches — demand loop (design first)

1. **Persist always.** First message → `TalentRequest` `DRAFT`; first search → `ACTIVE`. Abandon mid-chat still leaves signal.  
2. **Honest gap analysis.** Phase C gets near-miss rows: *“4 people match Python+SQL; none has production Airflow. Closest: ETL project 84/100 with Prefect.”* Never bare “0 results”.  
3. **Train CTA.** “Train this cohort for me” → `alertWhenAvailable = true` + admin-visible flag.  
4. **Demand board** `/admin/hire-demand`: top stacks, request counts, median salary, seniority mix, unmet ratio → **curriculum input**.  
5. **Alerts (later in phase plan).** Nightly job: if new consenting member clears bar for ACTIVE alert requests → email via existing `src/lib/email.ts`.

---

## 11. Files to touch (complete map)

| Path | New/Edit | Server/Client | Note |
|---|---|---|---|
| `prisma/schema.prisma` | edit | — | Models §8 |
| `prisma/migrations/<ts>_talent_requests/` | new | — | Additive SQL only |
| `src/lib/claude-agent.ts` | new | server | Official SDK wrapper |
| `src/lib/validations/hire.ts` | new | shared | Zod boundaries |
| `src/features/hire/scout-conversation.ts` | new | server | Phase A |
| `src/features/hire/search-candidates.ts` | new | server | Phase B query |
| `src/features/hire/score-candidate.ts` | new | server | Phase B score |
| `src/features/hire/explain-matches.ts` | new | server | Phase C |
| `src/features/hire/demand-board.ts` | new | server | Admin aggregates |
| `src/app/actions/hire-actions.ts` | new | server | send message, match, save, train CTA |
| `src/app/hire/page.tsx` | new | **Server** | Gate + create/load draft |
| `src/app/hire/[requestId]/page.tsx` | new | **Server** | Resume + results |
| `src/app/hire/layout.tsx` | new | Server | Shared chrome if needed |
| `src/components/hire/scout-chat.tsx` | new | **Client** | Transcript + chips |
| `src/components/hire/spec-summary.tsx` | new | **Client** | Editable chip row |
| `src/components/hire/match-card.tsx` | new | **Client** | Evidence + shortlist |
| `src/components/hire/gap-report.tsx` | new | **Client** | Empty/partial path |
| `src/app/admin/hire-demand/page.tsx` | new | **Server** | `requireAdmin` |
| `middleware.ts` | edit | edge | Add `/hire` to `protectedPaths` only — **no `@/lib/*`** |
| `package.json` | edit | — | `@anthropic-ai/sdk` |
| `prisma/seed-hire-fixtures.ts` | new | — | 3 varied members |
| `src/components/talent/availability-form.tsx` | new | Client | **§5.1 parallel** |
| `src/app/actions/talent-actions.ts` or hire availability action | edit/new | server | **§5.1** |
| `content/legal/privacy.md` + `legal-constants.ts` | edit | — | **§5.1** |
| Nav / talent landing links | edit | — | “Find with Scout” → `/hire` |

**Server → Client prop rule:** pass plain data only (serializable). No functions, icons as components, or class instances across the boundary.

---

## 12. Phase plan (ordered, context-linked)

Each phase states **inputs from previous**, **outputs for next**, **definition of done**.

### Phase 0 — Branch, Neon safety, baseline  
**Branch:** `feat/hire-scout-evidence-matching` (created from `upstream/master`).

| Step | Action |
|---|---|
| 0.1 | Confirm branch tip tracks intended base |
| 0.2 | Create **Neon branch** from prod; set **both** `DATABASE_URL` and `DIRECT_URL` in `.env.local` to branch |
| 0.3 | `npx prisma migrate status` — host must be branch, not prod |
| 0.4 | Commit checkpoint hash before any migrate |

**Outputs → Phase 1:** safe DB target, clean working tree for schema work.  
**DoD:** documented Neon branch name; migrate status shows non-prod host.

---

### Phase 1 — Schema + migration  
**Depends on:** Phase 0.

| Step | Action |
|---|---|
| 1.1 | Add enums + 4 models (+ CandidateAvailability if shipping in same migrate — preferred single additive migrate) |
| 1.2 | Back-relations on User / ProgramMember |
| 1.3 | `prisma migrate dev --name talent_requests` — **review SQL** (CREATE only) |
| 1.4 | `prisma generate` |

**Outputs → Phase 2/3:** tables exist for messages, requests, matches.  
**DoD:** migrate applies cleanly on Neon branch; no DROP; generate succeeds.

---

### Phase 2 — Deterministic search + scoring (**no LLM**)  
**Depends on:** Phase 1. **Critical path.**

| Step | Action |
|---|---|
| 2.1 | `search-candidates.ts` — consent + publish gates, stack filters |
| 2.2 | `score-candidate.ts` — weights, tiers, `availabilityUnknown` |
| 2.3 | Unit tests / fixture-driven checks without network |
| 2.4 | Seed script `seed-hire-fixtures.ts` |

**Context from Phase 1:** tables ready to store matches later.  
**Outputs → Phase 4–5:** pure function `(JobSpec, members) → ranked matches`.  
**DoD:**

- Member without consent never appears  
- Missing must-have never STRONG  
- `evidencePriority` reorders scores  
- Empty pool returns `[]` not throw  
- `availabilityUnknown` true when no CandidateAvailability  

---

### Phase 3 — Candidate availability (§5.1)  
**Depends on:** Phase 1. **Parallel with 2–5.**

| Step | Action |
|---|---|
| 3.1 | Form component + actions |
| 3.2 | Wire program + profile surfaces |
| 3.3 | Privacy.md + PRIVACY_VERSION bump |
| 3.4 | Wire filters in `score-candidate` when row present |

**Outputs → Phase 5 UI:** real logistics filters when data exists.  
**DoD:** see §17 §5.1 checklist.

---

### Phase 4 — Scout conversation (Phase A)  
**Depends on:** Phase 1 (persist), Phase 2 (spec shape). **Does not require seed.**

| Step | Action |
|---|---|
| 4.1 | Add `@anthropic-ai/sdk`; `claude-agent.ts` |
| 4.2 | `scout-conversation.ts` + Zod response schema |
| 4.3 | `sendScoutMessage` action — creates DRAFT, appends messages, updates partial spec |
| 4.4 | `scout-chat.tsx` + `spec-summary.tsx` |
| 4.5 | `/hire` + `/hire/[requestId]` shells |
| 4.6 | Middleware `/hire` protection |
| 4.7 | Claude-down **form fallback** |

**Response schema (locked):**

```ts
{
  spec: PartialJobSpec;
  nextQuestion: string | null;
  options: { label: string; value: string }[];
  allowFreeText: boolean;
  readyToSearch: boolean;
  summary: string;
}
```

**Outputs → Phase 5:** complete `JobSpec` + `readyToSearch`.  
**DoD:** ≤6 turns; chips+freetext; no invented candidates; DRAFT persists on abandon.

---

### Phase 5 — Match run + explain + results UI (B + C)  
**Depends on:** Phase 2 (score), Phase 4 (spec).

| Step | Action |
|---|---|
| 5.1 | `runMatch` action: B then C; write `TalentRequestMatch`; status ACTIVE / MATCHED |
| 5.2 | `explain-matches.ts` — cite-only rule in system prompt |
| 5.3 | `match-card.tsx` — evidence chips, link to `/talent/members/[id]`, shortlist |
| 5.4 | `gap-report.tsx` — empty + partial primary UX |
| 5.5 | “Train this cohort” → `alertWhenAvailable` |

**Outputs → Phase 6:** filled requests + matches for aggregation.  
**DoD:**

- Empty DB: gap report + ACTIVE request, zero fabricated people  
- Seeded: every rationale number traces to a field  
- Phone / transcript / logistics never in payload  

---

### Phase 6 — Demand board + nav polish  
**Depends on:** Phase 5 data.

| Step | Action |
|---|---|
| 6.1 | `demand-board.ts` + `/admin/hire-demand` |
| 6.2 | Link from talent shell: “Find with Scout” |
| 6.3 | Recruiter history list of past `TalentRequest`s on `/hire` |

**Outputs → Phase 7:** curriculum-visible demand.  
**DoD:** admin-only; stacks ranked by request frequency; unmet ratio correct.

---

### Phase 7 — Alerts + harden (working production bar)  
**Depends on:** Phase 5–6.

| Step | Action |
|---|---|
| 7.1 | Nightly or cron-compatible job: match ACTIVE+alert against new members → email |
| 7.2 | Rate-limit Scout sends (disable input in-flight; debounce) |
| 7.3 | Cost/latency pass: low effort, cached system prompt |
| 7.4 | Manual E2E script in plan verification |

**DoD:** end-to-end recruiter demo scriptable in &lt;10 minutes including empty-pool path.

---

## 13. Phase dependency graph

```text
Phase 0 (Neon + branch)
    │
    ▼
Phase 1 (schema) ─────────────────────────────┐
    │                                           │
    ├──────────► Phase 2 (score, no LLM) ──┐   │
    │                                       │   │
    ├──────────► Phase 3 (availability) ───┼───┤  (parallel)
    │                                       │   │
    └──────────► Phase 4 (Scout chat) ──────┤   │
                                            ▼   │
                                      Phase 5 (match UI)
                                            │
                                      Phase 6 (demand board)
                                            │
                                      Phase 7 (alerts + harden)
```

**MVP that still “works” (shippable internal demo):** Phases 0–2 + 4–5 (gap path + seeded match).  
**Full product loop (CEO bar):** + Phase 3 + 6 + 7.

---

## 14. Guardrails for Cursor (DO NOT)

1. **DO NOT** let the LLM choose filters or invent candidate attributes. Phase B is TS only.  
2. **DO NOT** return members without consent + published cohort.  
3. **DO NOT** expose phone, interview transcript, admin logistics/compensation.  
4. **DO NOT** treat missing `CandidateAvailability` as a match on salary/notice/mode.  
5. **DO NOT** modify `src/lib/anthropic.ts` callers; new client only.  
6. **DO NOT** run `prisma migrate reset` or destructive SQL — shared Neon.  
7. **DO NOT** migrate with prod `DIRECT_URL`.  
8. **DO NOT** import `@/lib/*` in `middleware.ts`.  
9. **DO NOT** create `TalentDemand` denormalised table.  
10. **DO NOT** parse resumes or scrape LinkedIn — out of product thesis.  
11. Always: Zod boundaries, result envelope, Prisma `select`, `lib/logger.ts`, `buttonVariants` on Link.  
12. When build errors contradict assumptions, trust the error and re-check models/APIs.

---

## 15. DB safety (Neon) — expand

Owner report: migrate creates tables on real DB because **`.env.local` points at production**.

**Before Phase 1:**

1. Neon console → Branch from production (name e.g. `hire-scout-dev`)  
2. Copy **pooled** URL → `DATABASE_URL`  
3. Copy **direct** URL → `DIRECT_URL`  
4. Both must change  
5. `npx prisma migrate status` — verify host substring  
6. Commit code checkpoint  
7. Migrate → read SQL → generate  

**Deploy:** production migration only via controlled deploy path (`build:deploy` / explicit migrate), never casual local against prod.

Additive only: CREATE TABLE / INDEX / FK. No DROP COLUMN.

---

## 16. Verification matrix

| # | Check |
|---|---|
| V1 | `tsc --noEmit` + production build pass |
| V2 | Scoring unit tests: consent, must-have, priority reorder, empty set |
| V3 | `/hire` rejects student / unapproved recruiter |
| V4 | Conversation ≤6 turns, chips + free text, editable summary |
| V5 | **Empty DB:** gap report + ACTIVE `TalentRequest`, no invented people |
| V6 | Seeded match: every rationale figure maps to a column |
| V7 | Fabrication probe: unknown stack never claimed present |
| V8 | Network payload excludes phone / transcript / logistics |
| V9 | Admin demand board gated + aggregates |
| V10 | `availabilityUnknown` banner on every match when no availability rows |
| V11 | migrate status host = Neon **branch** during dev |
| V12 | Shortlist from match card uses existing shortlist action |

**§5.1 verification:** set/edit/clear availability; openToWork false excludes; consent AND gate; FLEXIBLE/relocate rules; privacy bump.

---

## 17. UX copy anchors (Scout voice)

- Opening: *“I’m Scout. Tell me the role you’re filling — I’ll match people by verified work on ABTalks, not resumes.”*  
- Empty pool: *“No one in the published pool meets this yet. I’ve saved your requirement so we can train and alert you when they do.”*  
- Partial: *“These candidates match most of your stack. Gaps are listed — confirm availability offline.”*  
- Availability: *“Salary / notice / location not shared by this candidate — confirm at outreach.”*

---

## 18. Deliberately out of scope (v1)

- In-app messaging / interview scheduling  
- Auto-reject or auto-advance without human  
- Paid job posts / billing  
- Resume parsing / LinkedIn scrape  
- Replacing `/talent` browse entirely  
- Multi-tenant enterprise SSO for agencies (later)

---

## 19. Suggested PR slices (if stacking)

| PR | Content |
|---|---|
| PR-A | Schema + seed + score/search pure TS + tests |
| PR-B | `/hire` chat + Claude agent + draft persistence |
| PR-C | Match UI + gap report + shortlist wiring |
| PR-D | Admin demand board + talent nav link |
| PR-E | CandidateAvailability + privacy bump |
| PR-F | Alerts cron + rate limits |

All on **`feat/hire-scout-evidence-matching`** until first merge; stack only if review needs smaller chunks.

---

## 20. Commit message (feature complete)

```
feat(hire): Scout — evidence-based hiring agent at /hire

Conversational requirement gathering, deterministic matching on verified
program evidence, and demand capture when the pool is empty.

- TalentRequest / Message / Match persist specs and frozen shortlists
- CandidateAvailability (opt-in) enables salary/notice/mode filters later
- Scoring is pure TypeScript over missions, clean passes, commits,
  projects, interviews; LLM never picks filters
- Empty-pool path is primary: gap report + demand board + train CTA
- Reuses recruiter approval, consent, publish, and shortlist from /talent
```

---

## 21. First executor session — concrete start order

1. Confirm Neon branch URLs in `.env.local`  
2. Schema PR-A through migrate on branch  
3. Implement `score-candidate` + `search-candidates` + seed + tests  
4. Only then `claude-agent` + chat UI  
5. Wire empty-pool gap report before polishing match cards  
6. Demand board last among core; alerts after demo works  

**Do not** start with chat UI against empty scoring — you will fake matches under pressure.

---

## 22. Changelog note (when shipping)

Append one line under `## Pending reconcile` in `docs/CHANGELOG.md`:

`YYYY-MM-DD | hire: Scout at /hire — TalentRequest pipeline, evidence scoring, demand board`

---

*This plan is the single source of truth for `feat/hire-scout-evidence-matching`. Prefer amending this file over inventing parallel docs.*
