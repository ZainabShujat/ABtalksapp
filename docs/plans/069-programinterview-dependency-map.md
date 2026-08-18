# 069 — `ProgramInterview` dependency map and repointing plan

Pre-implementation audit. Line-level, verified against the working tree — not a
grep summary. `ProgramInterview` keeps its data and model in this phase; only
consumers move.

**Why a text search is not enough:** most consumers reach the model through the
Prisma **relation name `interview`** on `ProgramMember`, so `grep ProgramInterview`
misses them. Every entry below was found by auditing the relation, the module's
exports, and its importers.

---

## 1. Complete consumer inventory

### Tier A — reads a *result* (repoint to `GeneralInterview`)

| # | File | Reads | Surface |
| --- | --- | --- | --- |
| A1 | `src/features/talent-pool/pool.ts:225` | `interview: { overallScore, status }` | `/talent` pool listing |
| A2 | `src/features/talent-pool/pool.ts:255` | `interviewOverall` = `status === "COMPLETED" ? overallScore : null` | pool ranking/display |
| A3 | `src/features/talent-pool/pool.ts:391` | `interview: { status, overallScore, commScore, techScore, problemScore, summary }` | `/talent` member profile |
| A4 | `src/features/talent-pool/pool.ts:474` | maps the same six fields onto the profile payload | `/talent` member profile |
| A5 | `src/features/program/admin.ts:584` | `interview: { status, overallScore }` | admin cohort roster |
| A6 | `src/features/program/admin.ts:955` | `interview: { status, overallScore, commScore, techScore, problemScore, summary, durationSec }` | admin member detail |
| A7 | `src/app/actions/admin-program-export-actions.ts:142` | `interview: { status, durationSec, commScore, … }` | admin CSV export |
| A8 | `src/app/admin/program/interviews/page.tsx:2` | `listInterviewsForAdmin(cohortId)` | admin interview list |

### Tier B — student-facing entry point (replace **last**, per your instruction)

| # | File | Role |
| --- | --- | --- |
| B1 | `src/app/program/(app)/dashboard/page.tsx:6` | imports `getInterviewDashboardCard` |
| B2 | `src/components/program/program-dashboard-view.tsx:30` | imports `type InterviewDashboardCard`, renders `interviewCard` |
| B3 | `src/app/program/(app)/interview/page.tsx:4` | `getInterviewMemberView` — the interview screen |
| B4 | `src/components/program/interview-client.tsx` | WebRTC voice client |
| B5 | `src/app/actions/program-interview-actions.ts` | start/complete Server Actions |
| B6 | `src/app/api/program/interview/session/route.ts` | OpenAI Realtime ephemeral-secret mint |

### Tier C — leave completely alone this phase

| # | File | Note |
| --- | --- | --- |
| C1 | `src/features/program/interview.ts` | domain logic — stays, still serves Tier B until B is cut over |
| C2 | `prisma/schema.prisma` — `ProgramInterview`, `ProgramInterviewStatus`, `ProgramMember.interview` | **model and data retained** |
| C3 | `src/components/program/admin-interviews-panel.tsx` | admin reset/review panel — follows A8 |
| C4 | `src/components/program/program-export-buttons.tsx:*` | calls A7; unchanged if A7 keeps its shape |

### Tier D — in-flight uncommitted work (§4)

| # | File | State |
| --- | --- | --- |
| D1 | `src/components/program/cohort-interview-card.tsx` | untracked — new dashboard card |
| D2 | `src/app/program/(app)/dashboard/page.tsx` | modified — stubs `cohortInterviewState` |
| D3 | `src/components/program/program-dashboard-view.tsx` | modified — renders D1 |

---

## 2. The field-shape problem

Tier A consumers read a score vocabulary that only partly exists in the new model.

| `ProgramInterview` | `GeneralInterview` | Mapping |
| --- | --- | --- |
| `overallScore` | `overallScore` | direct |
| `commScore` | `communicationScore` | direct |
| `techScore` | `technicalDepthScore` | direct |
| `problemScore` | `problemSolvingScore` | direct |
| — | `conceptualScore` | **new**, no old counterpart |
| — | `practicalScore` | **new**, no old counterpart |
| `status` | `status` | enum values differ: old has no `INVALID` |
| `durationSec` | `durationSec` | direct |
| `summary` | `summary` | direct |
| `transcript` | `transcript` | direct (A4 currently returns `[]` regardless) |
| — | `blueprint` | **new** — `DAY_15` \| `DAY_31` |

Three map cleanly, two are new, and `blueprint` has no analogue at all. Because a
member can now hold **two** results, every Tier A read must also answer "which
one?" — see §3.1.

---

## 3. Repointing plan

### 3.1 A single resolver, not per-call-site logic

Introduce one function so the "which result" rule lives in exactly one place:

```
src/features/interview/read-model.ts
  getInterviewSignal(memberId)  → InterviewSignal | null
  getInterviewSignals(memberIds) → Map<memberId, InterviewSignal>   // list views
```

Resolution rule: **prefer the completed `DAY_31` result; fall back to completed
`DAY_15`; fall back to the legacy `ProgramInterview`; otherwise null.** The
legacy fallback is what makes this non-breaking while both systems coexist, and
it is the single line deleted in the later cleanup phase.

`InterviewSignal` is a stable shape carrying both vocabularies:

```ts
type InterviewSignal = {
  source: "DAY_31" | "DAY_15" | "LEGACY";
  status: string;
  overallScore: number | null;
  communicationScore: number | null;   // ← legacy commScore
  technicalDepthScore: number | null;  // ← legacy techScore
  problemSolvingScore: number | null;  // ← legacy problemScore
  conceptualScore: number | null;      // null for LEGACY
  practicalScore: number | null;       // null for LEGACY
  summary: string | null;
  durationSec: number | null;
  evaluatedAt: Date | null;
};
```

Batching matters: A1/A5 run inside list queries over a whole cohort. A per-member
call there is an N+1. `getInterviewSignals` takes the id array and returns a map.

### 3.2 Per-consumer changes

| # | Change | Risk |
| --- | --- | --- |
| A1/A2 | Drop the `interview` relation from the select; resolve via `getInterviewSignals`. `interviewOverall` keeps its exact type (`number \| null`), so the `/talent` UI needs no change | low |
| A3/A4 | Replace the relation read; keep the payload key `interview` and its field names so the recruiter profile component is untouched. Populate `commScore`/`techScore`/`problemScore` from the mapped new fields | low |
| A5 | Same as A1, batched | low |
| A6 | Same as A3, single member | low |
| A7 | Keep the CSV **column headers unchanged**; source values from the signal. Adding `blueprint`/`conceptual`/`practical` columns is a deliberate follow-up, not part of repointing | low |
| A8 | `listInterviewsForAdmin` gains a sibling that lists `GeneralInterview` rows per blueprint. The old function stays until B is cut over | medium — admin UI shows two systems briefly |

Renaming payload keys is deliberately avoided: the goal is repointing the data
source, not reshaping recruiter-facing contracts. Every Tier A component compiles
unchanged.

### 3.3 Ordering

```
1. Add GeneralInterview model + migration        (no consumer change)
2. Build DAY_15 / DAY_31 banks + domain + flow   (no consumer change)
3. Add read-model.ts with the legacy fallback    (no consumer change)
4. Repoint A1–A7                                 (behaviour identical: legacy fallback)
5. Add A8 sibling listing                        (admin sees both)
6. Wire the dashboard card (D1–D3) to real eligibility
7. Cut over B3–B6 — student entry point moves to the new interview   ← LAST
8. [Separate later phase] delete Tier C code + model
```

Steps 1–5 are invisible to users: with no `GeneralInterview` rows yet, the
fallback returns exactly today's values. That is the property that makes this
safe to land incrementally.

---

## 4. Conflict in the uncommitted dashboard work

`cohort-interview-card.tsx` (D1) is a working stub with a TODO naming this exact
integration:

> *"Clean integration boundary for General Interview Agent. The backend service
> (getInterviewOverview) cannot be connected yet because the GeneralInterview
> Prisma model is not yet in the schema."*

Three things must change when it is wired:

**a) It is built for Day 30, not Day 31.** Props are `hasCompletedDay30`, copy
says "30-Day Final Interview", unlock is `completedDays >= 30`. Per the approved
design this becomes `DAY_31`. Renaming props and copy — mechanical, but it
touches your in-flight file, so I will not do it without a nod.

**b) It uses a count, which is the forbidden substitute.** The card receives
`completedDays={data.cleanPassCount}` and unlocks on `completedDays >= 15`.
`cleanPassCount` is a denormalised **count** of passed days — it does not prove
days *1 through 15* were passed. A member who passed 15 days scattered across the
programme would unlock the Day-15 interview under this rule. The approved rule is
explicit set membership:

```ts
[1..15].every(d => passedDays.has(d))
[1..31].every(d => passedDays.has(d))
```

So the card's prop should become a resolved eligibility object from the server,
not a raw count for the client to threshold.

**c) Prop naming is ambiguous.** `hasCompletedDay15` currently means "has already
taken the Day-15 *interview*", while `completedDays` means curriculum progress.
Two different senses of "completed" one line apart. Suggest
`day15: { unlocked, taken }`, `day31: { unlocked, taken }`.

**Proposed prop shape**, computed server-side and matching the existing
integration boundary:

```ts
cohortInterviewState: {
  day15: { unlocked: boolean; taken: boolean; score: number | null };
  day31: { unlocked: boolean; taken: boolean; score: number | null };
}
```

D2 already passes a `cohortInterviewState` object, so this slots into the seam
that is already there.

---

## 5. What is explicitly NOT touched

- `ProgramInterview` model, enum, relation, and **all existing rows** — retained.
- `src/features/program/interview.ts` — untouched; keeps serving Tier B.
- Student entry point (B3–B6) — cut over only at step 7, after the new interview
  works, per your instruction.
- `/talent` UI components — repointing keeps payload keys and types identical.
- The 60-day challenge track — entirely out of the V1 path.

---

## 6. Confirmations needed

1. **May I modify the three in-flight files** (D1–D3)? They are uncommitted work
   and the Day-30 → Day-31 rename plus the count → set-membership fix both land
   inside them. I will not touch them otherwise.
2. **`cleanPassCount` fix confirmed?** §4b is a real eligibility bug in the
   current stub, not a style preference.
3. **A8 admin dual-listing** — acceptable that `/admin/program/interviews` shows
   legacy and new interviews side by side between steps 5 and 7?
4. **CSV columns (A7)** — keep headers byte-identical for now, or add
   `blueprint` / `conceptualScore` / `practicalScore` immediately? Keeping them
   stable avoids breaking anything downstream that parses the export.
