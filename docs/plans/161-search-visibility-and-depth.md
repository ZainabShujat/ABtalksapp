# 161 — Why 10,980 profiles search as 86, and why pagination stops at 2

Date: 2026-09-29 · Author: Sohail

---

## 1. Goal

Two reported symptoms, one measured cause each. Make imported and registered
candidates actually reachable in recruiter search, and make the result depth
reflect the pool instead of a hardcoded 20.

---

## 2. Diagnosis (measured, not inferred)

Every number below is from the live database, read-only.

### 2a. The funnel

```
 13,045  active users
 10,980  ...with a CandidateProfile
    113  ...passing the VISIBILITY gate      <-- 99% of the pool is lost here
    113  ...with a non-empty fullName
     86  ...AND a claimed skill              <-- THE ENTIRE SEARCHABLE POOL
```

The gate is `searchableUserWhere()` in `src/repositories/talent.ts`:

```ts
visibility: { is: { searchableByRecruiters: true, withdrawnAt: null } }
```

`claimedByCandidate` blocks **zero** candidates — every searchable candidate
holding a skill row holds a claimed one. The loss is entirely at the visibility
gate.

### 2b. Where the closed rows came from

```
searchable=false  consentSource=(null)                 12,734
searchable=true   consentSource=platform_default           74
searchable=true   consentSource=program_apply_migrated     23
searchable=true   consentSource=admin_resume_import        16
```

All 12,734 closed rows carry `consentSource = NULL` and were created inside a
**49-second window on 2026-08-24 (14:37:17 → 14:38:06)**. That is
`prisma/scripts/migrate-2b-visibility.ts`, whose "legacy" branch writes exactly
this shape:

```ts
{ userId: u.id, searchableByRecruiters: false, consentSource: null, consentedAt: null }
```

Its header states the intent: *"Other legacy users stay closed."* At the time
the column's default was `false`; migration `20260824153000` flipped the default
to `true` 52 minutes later and says so in its own comment — *"Production Phase 1
created this column as DEFAULT false; new candidate rows should be
recruiter-searchable by platform default"* — while explicitly noting it *"does
not rewrite existing CandidateVisibility rows."*

So the closed population is a **frozen artifact of a superseded policy**. The
policy that replaced it is written in two places in today's source:

- `CandidateVisibility.searchableByRecruiters` — *"Enforcement switch… New rows
  default true; **not a user-facing opt-in**."*
- `searchableUserWhere()` — *"Recruiter discovery is not a candidate preference
  (plan 133 / D-02)."*

Under the current policy these 12,734 rows should be open. Nothing re-opened
them, because of 2c.

### 2c. Nothing in the product can ever re-open a closed row

`applyVisibilityChange` handles `usable_profile`, `admin_import` and
`challenge_enroll` with a single create-only branch:

```ts
if (existing) {
  return { ..., skipped: true, skipReason: "already_exists" };
}
```

A candidate who already has the August row can save their profile, be imported
from a résumé, or enrol in a track, and the answer is always
`skipped: "already_exists"`. There is **no code path in the product that opens
a closed `CandidateVisibility` row.** Only `probe_restore` does, and it is
test-only.

This is the defect behind the reported symptom: an admin import that *means*
"this person should be discoverable" silently no-ops for anyone who pre-existed
2026-08-24.

### 2d. Recent registrations get no row at all

Candidate profiles created since 2026-09-01, with their visibility row:

```
NO ROW  sohail            NO ROW  Shivansh Rai      NO ROW  Sohail Khan
NO ROW  shivansh
true    admin_resume_import  Ajay Kedare      (and 7 more imports, all true)
```

Imports work. Self-registration does not: `ensureDiscoveryRecordAfterProfileSave`
only runs from `repositories/candidate-detail.ts`, so a candidate who registers
but never reaches those save paths never gets a row, and a missing row fails
`visibility: { is: … }` exactly like a closed one. `search-qa/audit.ts` already
raises this as *"PRODUCT DECISION REQUIRED — N candidate(s) have a usable
profile but no CandidateVisibility row… these existing profiles need that save
or a backfill."*

### 2e. The Snowflake test, specifically

```
19  candidate skill rows for "Snowflake"
15  reachable by recruiter search
 4  blocked by a closed visibility row
```

So Snowflake candidates are partly reachable — but see 2g: being reachable is
not the same as being *reached*.

### 2f. Why only 2 pages

Nothing to do with the pagination added in plan 158. Every signed-in search runs

```ts
const search = await searchCandidates(spec, { limit: 20 });   // hire-actions.ts:374
```

20 results ÷ `MATCHES_PER_PAGE = 10` = **exactly 2 pages**. The pager is
reporting the truth; the truth is capped at 20. Raising the pool alone changes
nothing here.

### 2g. The pool is a recency window, not a search

`listProfileCandidates` (`repositories/hire.ts:585`) is:

```ts
orderBy: { createdAt: "desc" },
take,                              // CHALLENGE_POOL_CAP = 600
```

It loads **the newest N candidates**, then ranks them in memory. With 86
searchable people that is harmless. After 2b is repaired it is not: 10,847
candidates and a 600-row window means an older candidate is unrankable no
matter how well they match, because scoring never sees them. The Snowflake
résumé stays missable after the backfill unless this is fixed too.

---

## 3. Files to touch

| File | | Note |
|---|---|---|
| `prisma/scripts/backfill-visibility-legacy.ts` | `[new]` | One-shot repair of the August rows. Dry-run by default. |
| `src/repositories/visibility.ts` | `[edit]` | Let the three opening intents heal a closed, never-decided row. |
| `src/repositories/hire.ts` | `[edit]` | Filter the profile pool by the brief's skills in SQL, not by recency. |
| `src/features/hire/search-candidates.ts` | `[edit]` | Pass the spec's skills to the loader; raise `CHALLENGE_POOL_CAP`. |
| `src/features/hire/track-loaders.ts` | `[edit]` | Thread the skill filter through `TrackLoadOpts`. |
| `src/features/hire/profile-dossier.ts` | `[edit]` | Same threading. |
| `src/app/actions/hire-actions.ts` | `[edit]` | Raise the per-search result limit from 20. |
| `src/features/hire/search-visibility.test.ts` | `[new]` | Regression assertions for every cause above. |
| `package.json` | `[edit]` | `test:search-visibility`, `db:backfill:visibility`. |

No Prisma schema change. The column default is already `true`.

---

## 4. Server vs Client

Everything here is server-side: repositories, a feature module, a Server Action
and a `tsx` script. **No component changes and no Server→Client prop changes.**
The pager built in plan 158 is already correct and is deliberately untouched —
it will simply be handed more results.

---

## 5. Steps

### S1. `src/repositories/visibility.ts` `[edit]` — let the open-intents heal

In the `challenge_enroll | usable_profile | admin_import` branch, replace the
unconditional create-only early return with:

```ts
if (existing) {
  // A row that carries a real decision is left alone. A row with no
  // consentSource was never a decision — it is the 2026-08-24 migrate-2b
  // artifact, written when the column still defaulted to false. An intent that
  // MEANS "this person is discoverable" must be able to open it, or an admin
  // import can silently no-op forever (plan 161 §2c).
  const neverDecided =
    existing.consentSource === null && !existing.searchableByRecruiters;
  if (!neverDecided) {
    return { ...skipped "already_exists" };
  }
  await tx.candidateVisibility.update({
    where: { userId: input.userId },
    data: { searchableByRecruiters: true, consentSource, consentedAt: now },
  });
  return { ...updated };
}
```

`withdrawnAt` is already returned earlier in the function, so a withdrawn row
can never reach this. Keep that ordering — it is what stops this healing an
admin moderation decision.

### S2. `prisma/scripts/backfill-visibility-legacy.ts` `[new]`

```
npm run db:backfill:visibility          # dry run: counts only, no writes
npm run db:backfill:visibility -- --apply
```

The predicate is deliberately narrow:

```ts
where: {
  searchableByRecruiters: false,
  consentSource: null,     // never an explicit decision
  withdrawnAt: null,       // never moderated or deleted
}
```

Sets `searchableByRecruiters: true` and `consentSource: "legacy_backfill_161"`
so the repaired rows are distinguishable from both the artifact and a genuine
platform default, forever.

Chunked (1,000 ids per `updateMany`) with a progress line, because this is
~12.7K rows over Neon. Prints the before/after funnel from §2a so the operator
sees what changed. Refuses to run without `--apply` unless `--dry-run` is
explicit.

### S3. `src/repositories/hire.ts` `[edit]` — search the pool, don't sample it

`listProfileCandidates(take)` becomes
`listProfileCandidates(take, opts?: { skills?: string[] })`:

```ts
where: {
  ...searchableUserWhere(),
  candidateProfile: {
    is: {
      fullName: { not: "" },
      skills: {
        some: {
          claimedByCandidate: true,
          // When the brief names skills, the POOL is people who have them.
          // Without this the pool is "the newest 600 candidates" and an older
          // match is unrankable no matter how good (plan 161 §2g).
          ...(skills?.length
            ? { skill: { name: { in: skills, mode: "insensitive" } } }
            : {}),
        },
      },
    },
  },
},
```

Keep `orderBy: { createdAt: "desc" }` as the tiebreaker within the filtered set —
it is a stable order, and with the filter applied it is no longer *the*
selection. When the brief names no skills, behaviour is exactly as today.

Match on `Skill.name` **and** `Skill.aliases` if that is cheap to express;
otherwise name only, and note the gap. Do not invent a new matching algorithm
here — ranking still belongs to `score-candidate.ts`.

### S4. Thread the filter — `track-loaders.ts`, `profile-dossier.ts`, `search-candidates.ts` `[edit]`

Add `skills?: string[]` to `TrackLoadOpts`, pass it through
`buildProfileDossierSet` to `listProfileCandidates`, and in `searchCandidates`
populate it from the spec's must-have stack:

```ts
const wantedSkills = [...(spec.mustHaveStack ?? []), ...(spec.niceToHaveStack ?? [])];
```

Check the real field names on `JobSpec` before writing this — `mustHaveStack`
is used elsewhere in that file; confirm the second one exists rather than
assuming it.

Raise `CHALLENGE_POOL_CAP` from 600. Its own comment justifies 600 as "well
above the whole eligible cohort today (320…)", which stops being true the moment
S2 runs. 2,000 is the value to use, and update that comment to say why.

### S5. `src/app/actions/hire-actions.ts` `[edit]` — result depth

`searchCandidates(spec, { limit: 20 })` → `{ limit: SEARCH_RESULT_LIMIT }`, a
named export set to **60** (6 pages at the pager's 10 per page).

Not unbounded, and the reason matters: every returned match is persisted as a
`TalentRequestMatch` row by the same function, and `explainMatches` runs over
the set. 60 is a real depth for a recruiter without turning one search into
hundreds of rows. Leave the guest path at 20 — it is a signed-out preview.

Also raise `ADOPTION_SEARCH_LIMIT`'s sibling call only if it reads the same
constant today; do not change alert runs (`run-hire-alerts.ts` uses 5
deliberately).

### S6. `src/features/hire/search-visibility.test.ts` `[new]` + `package.json`

Regression assertions, one per cause:

- `searchableUserWhere()` still requires `searchableByRecruiters` **and**
  `withdrawnAt: null` — the gate is not being loosened by this plan.
- `applyVisibilityChange` opens a `consentSource === null && !searchable` row
  for all three opening intents…
- …and still skips a row with any non-null `consentSource`.
- …and the `withdrawnAt` early return still precedes the healing branch
  (index comparison) — a withdrawn row must never be healed.
- `admin_withdraw` still sets `searchableByRecruiters: false`.
- The backfill script's predicate contains all three of
  `searchableByRecruiters: false`, `consentSource: null`, `withdrawnAt: null`,
  and the script does not write without `--apply`.
- `listProfileCandidates` applies a skill filter when given skills, and its
  `orderBy` is no longer the only selection.
- The signed-in search limit is greater than `MATCHES_PER_PAGE` so more than one
  page is reachable, and `CHALLENGE_POOL_CAP` is at least the limit.

---

## 6. Guardrails for Cursor (DO NOT)

- **DO NOT** loosen `searchableUserWhere()`. The gate is correct; the data
  behind it is wrong. Removing the visibility condition would expose deleted,
  disabled and withdrawn candidates, which is the one outcome worse than the
  bug.
- **DO NOT** heal a row with `withdrawnAt` set. That is an admin moderation or
  deletion decision (`anonymizeUser`, plan 160). The existing early return must
  stay **above** the new branch.
- **DO NOT** heal a row with a non-null `consentSource`. Those record a real
  decision — including `admin_resume_import` and `program_apply_migrated`.
- **DO NOT** make visibility a candidate-facing toggle. Plan 133 / D-02 is
  explicit that recruiter discovery is a platform default, not a preference,
  and `RECRUITER_FIELD_POLICY` replaced the per-candidate `show*` columns for
  the same reason.
- **DO NOT** run the backfill from application code, a Server Action, a route
  handler or a migration. It is an operator script, run deliberately, with a
  dry run first.
- **DO NOT** let the backfill touch `CandidateVisibility` rows outside the three
  predicate conditions, and do not delete any row.
- **DO NOT** "fix" the pool by removing `take` entirely. 10,847 dossiers
  assembled in memory per search is a different outage.
- **DO NOT** change `src/components/hire/match-results.tsx`,
  `match-pagination.ts` or the pager CSS. The pagination is correct and is not
  the bug — §2f.
- **DO NOT** touch `src/features/notification/**`.
- **DO NOT** change `prisma/schema.prisma` or add a migration.
- **DO NOT** edit `prisma/scripts/migrate-2b-visibility.ts`. It is a historical
  migration record; the repair is a new script.
- **DO NOT** change `run-hire-alerts.ts`'s limit of 5, or the guest search's 20.
- **DO NOT** add `any` or use `console.*` in application code (a `tsx` operator
  script may print).

---

## 7. DB safety

This plan contains the **largest data change in this series**: ~12.7K rows, and
the local `DATABASE_URL` points at **production**.

1. Commit checkpoint and a Neon branch snapshot **before** the backfill; note
   the commit hash.
2. Run `npm run db:backfill:visibility` (dry run) first and read the counts.
   Expect ≈12,734 candidate rows, of which ≈10,847 belong to active users with
   a `CandidateProfile`.
3. Run it against the Neon branch, verify the §2a funnel moves from 86 to the
   thousands, and spot-check that a withdrawn row and an
   `admin_resume_import` row are untouched.
4. Only then `-- --apply` against production.
5. Rollback is the inverse predicate — `consentSource: "legacy_backfill_161"`
   identifies exactly the rows this touched, which is why it is stamped.

The code changes in S1 and S3–S5 are independently deployable and safe without
the backfill; the backfill is what moves the number.

---

## 8. Verification

**Build / typecheck / lint**

```
npx tsc --noEmit && npm run lint && npm run build
```

**Suites**

```
npm run test:search-visibility     # new
npm run test:hire-score            # ranking must be unchanged
npm run test:hire-pagination       # the pager is untouched
```

**Measured — the funnel must move**

Re-run the §2a counts before and after. Success is step 3 going from 113 to
≈10,900 and step 5 from 86 to a comparable figure.

**Manual**

1. Import a résumé for a candidate whose user pre-dates 2026-08-24. Before S1
   their row stays closed; after S1 the import opens it. This is the reported
   bug, reproduced and fixed.
2. Search a skill held by an older candidate outside the newest 600 — they are
   now reachable (S3).
3. A search with many matches shows **more than 2 pages**, and the pager's
   "N–M of T" matches the result count.
4. A candidate withdrawn by an admin stays hidden after the backfill **and**
   after a subsequent profile save.
5. A `/hire` search still returns in a reasonable time with the larger pool —
   check `searchCandidates` latency in `search-qa` if it feels slow.

**Exactly these files should have changed**

```
docs/plans/161-search-visibility-and-depth.md    [new]
prisma/scripts/backfill-visibility-legacy.ts     [new]
src/features/hire/search-visibility.test.ts      [new]
src/repositories/visibility.ts
src/repositories/hire.ts
src/features/hire/search-candidates.ts
src/features/hire/track-loaders.ts
src/features/hire/profile-dossier.ts
src/app/actions/hire-actions.ts
package.json
```

---

## 9. Commit message

```
fix(hire): 10,980 profiles searched as 86 — open the legacy visibility rows

Measured: of 10,980 candidate profiles only 113 passed the recruiter
visibility gate and 86 reached the pool. All 12,734 closed rows carry
consentSource NULL and were written in a 49-second window on 2026-08-24
by migrate-2b-visibility's "legacy users stay closed" branch, when the
column still defaulted to false. The default was flipped 52 minutes later
by a migration that deliberately did not rewrite existing rows, and
nothing has re-opened them since: every opening intent in
applyVisibilityChange is create-only, so an admin resume import for a
pre-existing user silently no-ops.

Those three intents now heal a row that was never an explicit decision —
consentSource NULL and not withdrawn — while a real decision and any
withdrawal are still left alone. A one-shot operator script repairs the
existing rows and stamps them legacy_backfill_161.

Separately, the profile pool was "the newest 600 by createdAt", which is a
recency window rather than a search; it now filters on the brief's skills
in SQL. And every signed-in search was capped at 20 results, which is why
pagination stopped at 2 pages regardless of pool size.
```

---

## 10. Ownership

Candidate search, search ranking and database conventions are mine. No
cross-module approval is needed for S3–S6.

**One flag, not an approval request:** §2b shows the closed population was a
deliberate choice at the time ("Other legacy users stay closed"), superseded by
plan 133 / D-02 and by the column's own current documentation. The backfill is
therefore a policy *realignment*, and it makes ~10,847 people discoverable to
recruiters who are not discoverable today. That is a DPDP-relevant change of
state on real people and is called out here so it is a recorded decision rather
than a side effect of a bug fix.
