# Plan 111 — Cap submission synergy at 10 SP per IST calendar day

## 1. Goal

Stop synergy inflation from multi-challenge enrolment: a user holding up to four
enrolments (AI / DS / SE / CLAUDE) can currently earn up to 23 SP **per
enrolment per day**. Cap submission synergy at a flat **10 SP per IST calendar
day per user**, across every challenge — first paid submission of the day wins,
every later submission that day earns 0. Forward-only; no existing balance is
touched.

## 2. Current behavior

- `Challenge.domain` is `@unique` and `Enrollment` is `@@unique([userId, challengeId])`,
  so one user can hold **4 concurrent enrolments**.
- `computeSubmissionSynergy` (`src/features/synergy/scoring.ts`) returns
  `10 base + 5 GitHub + 8 LinkedIn` = **up to 23 SP per submission**.
- `Submission` is `@@unique([enrollmentId, dayNumber])` — the only existing
  guard is per-enrolment, so 4 enrolments × 60 days × 23 = **up to 5,520 SP**
  for one user.
- `awardSubmissionSynergy` is called from exactly one place,
  `src/features/submission/submit-day.ts:229`, and only on the `!existing`
  branch (a re-submit of the same day never re-awards).
- Grants flow through `applyPointsChange` (`src/repositories/points.ts`). With
  `ENABLE_NEW_POINTS_WRITES` **off**, credits land in legacy `SynergyEvent`
  (`type: "SUBMISSION"`) + `User.synergyPoints`, and dual-write mirrors to
  `PointsTransaction`. With the flag on, `PointsTransaction`
  (`sourceType: ACTIVITY_ATTEMPT`) is authoritative and legacy is the mirror.
- `src/components/marketplace/earning-pills.tsx` publicly advertises
  "Share on LinkedIn +8 SP" and "Contribute on GitHub +5 SP", bound directly to
  the `SYNERGY_PROOF_*` constants.
- Two toast sites render `+${synergyAwarded} synergy`:
  `day-submit-panel.tsx:70` and `submission-flow.tsx:134`.

## 3. Decisions locked (do not re-litigate)

| Question | Decision |
| --- | --- |
| Cap unit | **10 SP per IST calendar day, across all challenges** |
| Proof bonuses | **Hard ceiling of 10** — `+5` GitHub / `+8` LinkedIn are removed entirely |
| Tie-break | **First paid submission of the IST day wins**; later ones award 0 |
| Retroactivity | **Forward-only from deploy** — no backfill, no clawback, no recompute |
| Past-day backfills | **Count against today's cap** — a backfill submitted today competes with today's submission |
| Referral (+3) / admin grants | **Uncapped** — the cap lives in the submission path only |

Consequence accepted by the product owner: a *single-challenge* student with full
proof drops from 23 SP/day to 10 SP/day. The two proof pills must come out of the
marketplace UI in the same change so the advertised rate stays truthful.

## 4. Files to touch

| File | | Note |
| --- | --- | --- |
| `src/features/synergy/scoring.ts` | `[edit]` | Drop the two proof constants and `computeSubmissionSynergy`; add `SYNERGY_DAILY_SUBMISSION_CAP = 10` |
| `src/repositories/points.ts` | `[edit]` | Add flag-aware `hasEarnedSubmissionPointsOnIstDate` next to `submissionAwardTotal` |
| `src/repositories/index.ts` | `[edit]` | Re-export the new reader alongside `applyPointsChange` |
| `src/features/synergy/award-submission-synergy.ts` | `[edit]` | Take `istDateKey`; short-circuit to 0 when the day is already paid |
| `src/features/submission/submit-day.ts` | `[edit]` | Pass the already-computed `submittedAtIst`; stop passing `hasGithub`/`hasLinkedin` |
| `src/components/marketplace/earning-pills.tsx` | `[edit]` | Remove the LinkedIn and GitHub pills |
| `src/components/challenge/day-submit-panel.tsx` | `[edit]` | Toast copy when `synergyAwarded === 0` |
| `src/components/challenge/submission-flow.tsx` | `[edit]` | Same toast branch |
| `src/features/synergy/synergy-cap.test.ts` | `[new]` | Source-scan + pure-logic test, matching the `points-writes.test.ts` idiom |
| `package.json` | `[edit]` | Add `test:synergy-cap` script |

No schema change. No migration. Section 7 (DB safety) does not apply.

## 5. Server vs Client

| Component / module | Boundary |
| --- | --- |
| `scoring.ts`, `points.ts`, `award-submission-synergy.ts`, `submit-day.ts` | Server only (`points.ts` is already `import "server-only"`) |
| `earning-pills.tsx` | **Server Component** today — no `"use client"`. Keep it that way; it only maps a static array. Do **not** add `"use client"`. |
| `day-submit-panel.tsx`, `submission-flow.tsx` | Already Client Components; the change is a string branch on an existing `number` field |

No Server→Client prop passing changes. `synergyAwarded` is already a plain
`number | undefined` crossing the action boundary — no functions, icons, or
class instances are added.

## 6. Steps

### Step 1 — `src/features/synergy/scoring.ts`

Replace the whole file with:

```ts
/** Flat synergy for one paid submission. Also the per-IST-day ceiling. */
export const SYNERGY_BASE_SUBMISSION = 10;
export const SYNERGY_REFERRAL = 3;

/**
 * A user earns submission synergy at most once per IST calendar day, across
 * every challenge they are enrolled in. See plan 111.
 */
export const SYNERGY_DAILY_SUBMISSION_CAP = SYNERGY_BASE_SUBMISSION;
```

Deleted: `SYNERGY_PROOF_GITHUB`, `SYNERGY_PROOF_LINKEDIN`,
`computeSubmissionSynergy`. With a hard ceiling of 10 the function is a constant,
so it is not worth keeping as an indirection.

### Step 2 — `src/repositories/points.ts`

Add this exported function immediately after `submissionAwardTotal`. Mirror that
function's flag-aware shape exactly — it is the established pattern in this file
for reading points under the in-flight 078 migration.

```ts
/**
 * Has this user already been paid submission synergy inside the given IST
 * calendar day? Flag-aware: reads the authoritative store for the current
 * cutover state. Positive-amount filter keeps reconciliation debits from
 * masking a genuine unpaid day.
 */
export async function hasEarnedSubmissionPointsOnIstDate(
  tx: Tx,
  opts: { userId: string; istDateKey: string },
): Promise<boolean> {
  const { startUtc, endExclusiveUtc } = istDateRangeToUtc(
    opts.istDateKey,
    opts.istDateKey,
  );
  if (!startUtc || !endExclusiveUtc) return false;
  const createdAt = { gte: startUtc, lt: endExclusiveUtc };

  if (isNewPointsWritesEnabled()) {
    const hit = await tx.pointsTransaction.findFirst({
      where: {
        userId: opts.userId,
        sourceType: PointsSourceType.ACTIVITY_ATTEMPT,
        amount: { gt: 0 },
        createdAt,
      },
      select: { id: true },
    });
    return hit !== null;
  }

  const hit = await tx.synergyEvent.findFirst({
    where: {
      userId: opts.userId,
      type: "SUBMISSION",
      points: { gt: 0 },
      createdAt,
    },
    select: { id: true },
  });
  return hit !== null;
}
```

Add the import at the top of the file:
`import { istDateRangeToUtc } from "@/lib/date-utils";`

Index note — no migration needed. The legacy read uses
`SynergyEvent @@index([userId])`; a single user has at most ~240 submission
events, so the residual filter is trivial. The new-path read is covered by
`PointsTransaction @@index([userId, createdAt(sort: Desc)])`.

### Step 3 — `src/repositories/index.ts`

Add `hasEarnedSubmissionPointsOnIstDate` to the existing export block that
already carries `applyPointsChange` (around line 26). Do not create a new block.

### Step 4 — `src/features/synergy/award-submission-synergy.ts`

- Remove `hasGithub` / `hasLinkedin` from the args type.
- Add `istDateKey: string` to the args type.
- Import `SYNERGY_DAILY_SUBMISSION_CAP` from `./scoring` (drop the
  `computeSubmissionSynergy` import) and `hasEarnedSubmissionPointsOnIstDate`
  from `@/repositories/points`.
- Take the wallet lock **before** the read, then short-circuit. Without the
  lock, two concurrent submissions in different challenges both read "unpaid"
  under READ COMMITTED and both grant — the exact stacking this cap exists to
  stop. `lockWalletBalance` is flag-aware and locks the same row
  `applyPointsChange` later updates, so there is no lock-order hazard:

```ts
await lockWalletBalance(tx, args.userId);
const alreadyPaid = await hasEarnedSubmissionPointsOnIstDate(tx, {
  userId: args.userId,
  istDateKey: args.istDateKey,
});
if (alreadyPaid) {
  logger.info("[synergy] daily submission cap reached; awarding 0", {
    userId: args.userId,
    submissionId: args.submissionId,
    istDateKey: args.istDateKey,
  });
  return 0;
}
```

- The grant below it becomes a flat
  `amount: SYNERGY_DAILY_SUBMISSION_CAP`. Everything else (mode, sourceType,
  `idempotencyKey: \`submission:${args.submissionId}\``, `legacyEvent`) is
  unchanged.
- Return `SYNERGY_DAILY_SUBMISSION_CAP` instead of the computed `points`.
- Use `logger` from `@/lib/logger` — never `console`.

Short-circuit rather than calling `applyPointsChange` with `amount: 0`. A zero
credit is already a silent no-op on both paths, but skipping the call avoids a
pointless `tx.user.findUnique` inside the submission transaction.

### Step 5 — `src/features/submission/submit-day.ts`

At the `awardSubmissionSynergy` call (line ~229):

- Delete the `hasGithub,` and `hasLinkedin,` argument lines.
- Add `istDateKey: submittedAtIst,`.

`submittedAtIst` is **already computed at line 182** as
`formatInTimeZone(new Date(), IST, "yyyy-MM-dd")` — reuse that binding. Do not
add a new date helper, do not recompute it, and do not import anything new here.

Keep `hasGithub` — it still gates URL normalization and validation at line 162.
**Delete the `hasLinkedin` binding** (line ~114): the award call was its only
consumer, so it becomes an unused-variable lint warning. `linkedinStored` stays;
it is still written to the submission row.

`dualWriteSubmissionAttempt` already receives `pointsAwarded: synergyAwarded ?? 0`,
so a capped submission dual-writes 0 with no drift. No change there.

### Step 6 — `src/components/marketplace/earning-pills.tsx`

- Delete the `"Share on LinkedIn"` and `"Contribute on GitHub"` entries from the
  `pills` array.
- Remove the now-unused `SYNERGY_PROOF_GITHUB` / `SYNERGY_PROOF_LINKEDIN`
  imports and the now-unused `GitBranch` / `Share2` lucide imports.
- The remaining two pills ("Complete Task" +10, "Refer a Friend" +3) stay as-is.
- Change the "Complete Task" label to **"Complete a Daily Task"** and leave the
  value bound to `SYNERGY_BASE_SUBMISSION`.

### Step 7 — the two toast sites

`src/components/challenge/day-submit-panel.tsx` (~line 70) and
`src/components/challenge/submission-flow.tsx` (~line 134) both currently do a
two-way `undefined` check. Make each three-way, keeping that file's existing
wording ("submitted!" vs "complete!"):

```ts
const synergyMsg =
  result.synergyAwarded === undefined
    ? `Day ${dayNumber} submitted!`
    : result.synergyAwarded > 0
      ? `Day ${dayNumber} submitted! +${result.synergyAwarded} synergy`
      : `Day ${dayNumber} submitted! You've already earned today's synergy.`;
```

Do not introduce a shared helper for this — two call sites with different copy
do not justify a new file.

### Step 8 — `src/features/synergy/synergy-cap.test.ts` [new]

Follow the `src/repositories/points-writes.test.ts` idiom exactly: plain `tsx`
script, local `assert` / `suite` helpers, `readFileSync` source scans, exit
non-zero on failure. No DB access. Cases:

1. `SYNERGY_DAILY_SUBMISSION_CAP === 10` and `SYNERGY_BASE_SUBMISSION === 10`.
2. `scoring.ts` source no longer contains `SYNERGY_PROOF_GITHUB`,
   `SYNERGY_PROOF_LINKEDIN`, or `computeSubmissionSynergy`.
3. `award-submission-synergy.ts` source contains
   `hasEarnedSubmissionPointsOnIstDate` and returns `0` before reaching
   `applyPointsChange`.
4. `submit-day.ts` source passes `istDateKey: submittedAtIst` and no longer
   passes `hasGithub` to the award call.
5. `award-submission-synergy.ts` calls `lockWalletBalance` *before*
   `hasEarnedSubmissionPointsOnIstDate` (pins the concurrency fix).
6. `points.ts` source branches on `isNewPointsWritesEnabled()` inside
   `hasEarnedSubmissionPointsOnIstDate` (guards against a legacy-only read
   silently breaking after the 078 cutover).
7. `earning-pills.tsx` source contains neither `SYNERGY_PROOF_` nor `Share2`.
8. `istDateRangeToUtc("2026-09-04", "2026-09-04")` yields a 24-hour window whose
   start is `2026-09-03T18:30:00.000Z` (IST is UTC+5:30) — pins the day boundary.

Add to `package.json` scripts, matching the existing style:

```
"test:synergy-cap": "NODE_OPTIONS=--conditions=react-server tsx src/features/synergy/synergy-cap.test.ts"
```

## 7. DB safety

Not applicable — no schema change, no migration, no data backfill. The decision
is explicitly forward-only: **do not** write a script that recomputes or claws
back historical `SynergyEvent` / `PointsTransaction` rows.

## 8. Known behavior to accept (do not "fix" these)

- **Admin reject/reset then re-submit on the same day** awards 0, because the
  original positive `SynergyEvent` stays in the append-only ledger. The admin
  manual grant path is uncapped and is the intended remedy.
- **Catch-up backfills earn nothing** if the student already earned that
  calendar day. This is the chosen rule, not a bug.
- **A student who never enrolled in a second challenge still drops to 10/day.**
  Accepted; that is why step 6 removes the advertised bonuses.

## 9. Guardrails for Cursor (DO NOT)

- **DO NOT** touch `middleware.ts` or `auth.config.ts`. `date-utils.ts` is now
  imported by `points.ts`, which is `server-only` and is not in the edge path —
  keep it that way; do not import `points.ts` or `date-utils.ts` from anything
  middleware reaches.
- **DO NOT** create new files beyond the one test file listed in section 4. No
  `synergy-cap.ts`, no `daily-cap-utils.ts`, no shared toast helper.
- **DO NOT** add a new date helper. `submit-day.ts:182` already computes the IST
  day key; pass it down.
- **DO NOT** move the cap into `applyPointsChange`. Referral and admin grants
  must stay uncapped, and that function is the shared wallet boundary for
  redemptions too.
- **DO NOT** change the `idempotencyKey` shape (`submission:<id>`). It is load
  bearing for 078 dedupe and for `submissionAwardTotal` clawbacks.
- **DO NOT** write a migration, edit `prisma/schema.prisma`, or run
  `db:seed` / `db:cleanup` / `migrate`.
- **DO NOT** flip any `ENABLE_NEW_*` or `ENABLE_DUAL_WRITE` flag. Legacy stays
  authoritative; the new reader must work correctly under **both** flag states.
- **DO NOT** use `console.error` / `console.log` — use `lib/logger.ts`.
- **DO NOT** add `"use client"` to `earning-pills.tsx`.
- **DO NOT** return a full record from any new Prisma query — the reader above
  uses `select: { id: true }` deliberately.
- **DO NOT** change the `{ ok, data } | { ok, message }` envelope of
  `submitDay`; `synergyAwarded` stays an optional `number`.

## 10. Verification

Build / typecheck:

```bash
npx prisma generate && npm run lint && npx tsc --noEmit && npm run build
```

Known local blockers, both pre-existing and unrelated to this change — do not
try to "fix" them inside this task:
- `npm run build` fails on `Cannot resolve '@vercel/blob'`. It is declared in
  `package.json` but absent from `node_modules`; run `npm install` first.
- `npx tsc --noEmit` reports 4 errors: two stale `.next` route-type artifacts
  and two from the same missing `@vercel/blob`. Zero should come from the files
  in section 4.
- `npm run test:078-dual-write` has one pre-existing failure
  ("program apply prefill through getCandidateProfile") — it scans for
  `src/app/program/apply/page.tsx`, deleted in commit `83b08e4`.

The build must surface zero unused-import errors — if `GitBranch`, `Share2`, or
the `SYNERGY_PROOF_*` imports survive in `earning-pills.tsx`, step 6 was done
incompletely.

Unit:

```bash
npm run test:synergy-cap && npm run test:078-points-writes && npm run test:078-dual-write
```

The two 078 suites must still pass — they source-scan the points write boundary
and will catch an accidental bypass of `applyPointsChange`.

Manual (local, seeded test users — `npm run db:seed` gives 10 `@abtalks.dev` users):

1. Enrol one test user in **two** challenges (e.g. AI and SE).
2. Submit today's day in challenge A with both GitHub and LinkedIn URLs →
   toast reads **"+10 synergy"** (not +23). Wallet increases by exactly 10.
3. Submit today's day in challenge B, same user → toast reads
   **"You've already earned today's synergy."** Wallet is **unchanged**.
4. Confirm exactly **one** `SynergyEvent` row with `type: "SUBMISSION"` exists
   for that user for today, and that the capped submission produced **no** row.
5. Trigger a referral for the same user on the same day → wallet increases by
   **+3** (proves referrals are outside the cap).
6. Open `/marketplace` → only two earning pills render, "+10 SP" and "+3 SP".
   No LinkedIn or GitHub pill.
7. Re-submit day A (edit the URL) → still no new grant, as before this change.

Exactly these files should show in `git diff --name-only`:

```
docs/plans/111-synergy-daily-cap.md
package.json
src/components/challenge/day-submit-panel.tsx
src/components/challenge/submission-flow.tsx
src/components/marketplace/earning-pills.tsx
src/features/submission/submit-day.ts
src/features/synergy/award-submission-synergy.ts
src/features/synergy/scoring.ts
src/features/synergy/synergy-cap.test.ts
src/repositories/index.ts
src/repositories/points.ts
```

Anything else in that list — especially `prisma/schema.prisma`, a migration
folder, or `middleware.ts` — means the plan was exceeded. Stop and report.

## 11. Commit message

```
feat(synergy): cap submission points at 10 SP per IST day

A user can hold up to four enrolments (AI/DS/SE/CLAUDE), and submission
synergy was scored per enrolment at 10 base + 5 GitHub + 8 LinkedIn, so a
multi-challenge user could earn up to 92 SP a day and 5,520 over a cohort.

Submission synergy is now a flat 10 SP granted at most once per IST calendar
day across every challenge; the first paid submission of the day wins and
later ones award 0. The GitHub and LinkedIn proof bonuses are removed, along
with the marketplace pills that advertised them. Referral and admin grants are
deliberately outside the cap.

The daily read is flag-aware so it stays correct on both sides of the 078
points cutover. Forward-only: no historical grant is recomputed or clawed back.
```

## 12. Reconcile line for `docs/CHANGELOG.md`

Cursor appends under `## Pending reconcile`:

```
- 2026-09-04 — Submission synergy capped at 10 SP per IST calendar day per user across all enrolments (plan 111); GitHub/LinkedIn proof bonuses removed; referral + admin grants remain uncapped; forward-only, no backfill.
```
