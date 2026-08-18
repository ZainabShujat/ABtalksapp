# 067 — Cohort milestone interviews (DAY_15 / DAY_30)

Supersedes the candidate-specific design in `066` for V1. The general
candidate-specific interview is not deleted — it is deferred behind the same
seam (§9).

## 1. Goal

Two standardized interview blueprints for the 31-Day AI Cohort. Every candidate
at a milestone answers the **same core questions**, drawn only from curriculum
they have completed. The LLM never decides structure and never invents a core
question; it only judges evidence and, when the bank says evidence is missing,
asks one scripted-purpose follow-up.

The point is comparability: a score means something because every candidate
faced the same instrument.

## 2. Current behavior (what exists after 065/066)

Built and passing (33 pure checks, typecheck, lint):

| Module | Fate under this plan |
| --- | --- |
| `state.ts` (`advanceTurn`) | **Keep as-is** — already implements ASK → ANSWER → CHECK → FOLLOW-UP → NEXT |
| `evidence.ts`, `scoring.ts`, `rubric.ts` | **Keep** — evidence tiers and weighted aggregation are unchanged |
| `orchestrator.ts` | **Keep**, minor edit (follow-up budget comes from the bank, not a global constant) |
| `provider.ts`, mock/prisma providers, UI stages 1–5 | **Keep** — the seam and the journey survive the pivot |
| `evaluation.ts` | **Rework** — judge against per-question expected evidence, not free-form |
| `question-rules.ts` | **Replace** — static bank selection, no per-candidate planning |
| `question-generation.ts` (`phraseQuestions`) | **Delete from the live path** — the LLM must not phrase core questions |
| `eligibility.ts` + its 12 checks | **Replace** — milestone rule, not 30-new-submissions |
| `candidate-context.ts`, `challenge-context.ts` | **Replace** — read `ProgramMember`, not `Enrollment`/`Submission` |
| `GeneralInterview` model (migration unapplied) | **Reshape** — free, nothing deployed |

## 3. The question bank

One TS module per blueprint, checked into the repo and reviewed like content —
not generated at runtime.

```ts
type BankQuestion = {
  id: string;                    // stable, e.g. "d15-q03"
  order: number;                 // deterministic ordering
  competency: Competency;        // maps to the existing 5-axis rubric
  sourceDays: number[];          // provenance; must be within blueprint scope
  text: string;                  // asked verbatim
  expectedEvidence: string[];    // what a full answer contains
  minimumEvidence: number;       // how many expected items clear the bar
  followUpWhenMissing: string | null;  // null = never follow up on this question
  maxFollowUps: 0 | 1 | 2;
};
```

`followUpWhenMissing: null` + `maxFollowUps: 0` is a first-class case: recall
questions should not be probed. Follow-ups are the exception, not the rhythm.

- `DAY_15` — scope days 1–15 only.
- `DAY_30` — scope days 1–30, and must probe application/reasoning, not recall.
  Enforced by composition: DAY_30 skews to `PROBLEM_SOLVING` / `TECHNICAL_DEPTH`
  and its `minimumEvidence` thresholds sit higher.

A build-time check asserts every `sourceDays` entry is inside the blueprint's
range, so a DAY_15 interview can never reference day 22 content.

## 4. Runtime loop (deterministic except two calls)

```
ASK (from bank, fixed order)
  ↓
ANSWER
  ↓
CHECK EVIDENCE            ← LLM call 1: which expectedEvidence items are present
  ↓
met >= minimumEvidence?
  ├── YES ─────────────→ NEXT
  └── NO
       ├── followUpWhenMissing == null → NEXT
       ├── followUpsAsked >= maxFollowUps → NEXT
       └── otherwise → FOLLOW-UP   ← LLM call 2: phrase the probe
                          ↓
                       ANSWER → re-check → NEXT
```

Cost: one call per answer, plus one per follow-up, plus one final judgment.
Strictly fewer than 066 (no phrasing pass).

## 5. Eligibility (milestone, not date)

```
Attempt DAY_15  unlocks when highestCompletedDay >= 15
Attempt DAY_30  unlocks when highestCompletedDay >= 30
```

- Each blueprint may be taken **once**. Enforced by
  `@@unique([memberId, blueprint])` on completed attempts.
- Attempts never expire. Taking DAY_15 on day 22 still asks days 1–15.
- `ABANDONED` / `INVALID` still consume nothing — same invariant, now expressed
  as "did not claim the blueprint".

**Open question (§10.2): "unlocked" vs "completed".** The program distinguishes
day *availability* (an unlock ceiling) from days actually **PASSED**
(`getMemberProgressDay` → highest passed day). Using availability would let a
member be interviewed on missions they never did, contradicting the
assess-only-completed-work rule. This plan assumes **highest PASSED day** and
needs that confirmed.

## 6. Files to touch

| Path | | Note |
| --- | --- | --- |
| `src/features/interview/banks/day-15.ts` | `[new]` | DAY_15 question bank |
| `src/features/interview/banks/day-30.ts` | `[new]` | DAY_30 question bank |
| `src/features/interview/banks/index.ts` | `[new]` | Blueprint selection + scope assertion |
| `src/features/interview/blueprint.ts` | `[new]` | `selectBlueprint(highestCompletedDay, taken)` |
| `src/features/interview/eligibility.ts` | `[edit]` | Milestone rule replaces set-difference |
| `src/features/interview/evaluation.ts` | `[edit]` | Judge against `expectedEvidence` |
| `src/features/interview/state.ts` | `[edit]` | Follow-up budget per question |
| `src/features/interview/member-context.ts` | `[new]` | Reads `ProgramMember` + missions |
| `src/features/interview/candidate-context.ts` | `[delete]` | Replaced by the above |
| `src/features/interview/challenge-context.ts` | `[delete]` | 60-day challenge, out of scope |
| `src/features/interview/question-rules.ts` | `[delete]` | Static banks replace planning |
| `src/features/interview/question-generation.ts` | `[delete]` | LLM must not phrase core questions |
| `prisma/schema.prisma` | `[edit]` | Reshape `GeneralInterview` (§7) |
| `scripts/verify-interview-domain.ts` | `[edit]` | Rewrite eligibility + add bank checks |

## 7. Schema (migration still unapplied — reshape is free)

```prisma
enum InterviewBlueprint { DAY_15  DAY_30 }
```

On the interview model, replacing the consumption fields:

```prisma
  memberId  String                  // ProgramMember, not User
  blueprint InterviewBlueprint
  // attemptNumber/eligibleSubmissionIds/consumedSubmissionIds all removed:
  // a blueprint is claimed once, so the unique constraint IS the attempt rule.
  @@unique([memberId, blueprint])   // partial: only COMPLETED rows
```

Postgres cannot express "unique only when COMPLETED" via Prisma's `@@unique`, so
this needs a raw partial index in the migration:

```sql
CREATE UNIQUE INDEX "one_completed_attempt_per_blueprint"
  ON "GeneralInterview" ("memberId", "blueprint")
  WHERE "status" = 'COMPLETED';
```

That keeps unlimited abandoned/invalid rows while making a second completed
DAY_15 impossible at the database level rather than only in code.

## 8. Proctoring / media (needs scoping — §10.4)

Requested: keep audio/WebRTC, camera, consent, room-scan, proctoring from the
standalone repo. Recommended V1 split:

- **In V1, no new storage:** consent gate, camera + mic check, WebRTC voice
  session (reuse `/api/program/interview/session`'s ephemeral-secret pattern
  verbatim — it already works in production), and proctor *signals*
  (tab-blur, focus-loss, fullscreen-exit) recorded as counts on the interview row.
- **Deferred to its own plan:** room-scan and ID capture. Both mean storing
  images of a person's face and home. That needs a storage decision (no blob
  storage exists in ABTalks today), a retention/purge policy, and consent copy
  — it is a compliance feature, not a UI feature.

Proctoring stays advisory: it annotates a result, never auto-rejects.

## 9. Extensibility (explicitly preserved)

`InterviewBlueprint` is an enum, and bank selection is one deterministic
function. Adding `GENERAL` later means adding a bank source that is computed
per candidate rather than static — the loop, scoring, state machine, provider
seam and UI do not change. The 066 planner is deleted from the live path but its
approach is recorded here and in 066 for that future.

## 10. Decisions needed before implementation

1. **Collision with `ProgramInterview`.** The cohort already has a 15-minute
   voice exit interview (`ProgramInterview`, gated on program completion, scored
   comm/tech/problem). DAY_30 lands at the same milestone. Which is it?
   (a) DAY_30 replaces the exit interview; (b) both exist and a member does two
   interviews at day 30; (c) `ProgramInterview` is migrated into this system as
   the DAY_30 blueprint. I was previously told to keep `ProgramInterview`
   untouched — (a) and (c) both break that, so this needs an explicit call.
   **Recommendation: (c)**, migrating it in, so members are not interviewed twice
   about the same curriculum.
2. **`highestUnlockedDay` = highest PASSED day?** See §5.
3. **Who authors the banks?** I can draft both from `prisma/content/program/days.json`,
   but expected/minimum evidence is assessment design and should be reviewed
   before it scores anyone. Draft-then-review, or do you supply them?
4. **Media scope for V1** — confirm the §8 split, specifically that room-scan
   and ID capture are deferred.
5. **Existing 60-day challenge work.** `challenge-context.ts` and the
   30-new-submissions retake rule are cohort-irrelevant now. Delete (recoverable
   from git), or keep dormant behind the seam for the general interview later?
   **Recommendation: delete from the live path**; 066 records the design.
