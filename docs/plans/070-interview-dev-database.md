# 070 — Development database policy for the Interview Agent

Supersedes the "Neon branch" assumption in 069 §5.3 and in the smoke-test
prerequisites of the earlier plans.

## 1. Policy

Interview Agent development and testing run against a **separate Neon database
owned by the developer**, not a branch of production and not production itself.

| Environment | Used for | Who applies migrations |
| --- | --- | --- |
| Separate Neon test DB | migrations, seeds, smoke tests, throwaway users/interviews | this workstream, freely |
| ABTalks production | nothing during development | Sohail sir, once the Interview Agent is verified |

A Neon *branch* is explicitly **not required** — a fully separate database is
already available and is a stronger boundary than a branch.

## 2. What happened, and why the guard exists

`DATABASE_URL` in `.env.local` pointed at **production**. A read-only inspection
found 12,603 users, 46 program members across 5 cohorts, 518 mission
submissions, and production migration history. No migration or smoke test was
run against it.

Two things would have gone wrong had it proceeded: the migration adds a table
and two enums to the live schema, and the smoke test **creates and then deletes
a real `User` row** with enrollments and submissions.

To make that class of mistake structurally hard rather than a matter of
attention, `scripts/db-preflight.mjs` refuses to proceed against a
production-shaped target:

```bash
node scripts/db-preflight.mjs
```

- Exit 0 — target holds few enough rows to be a disposable test database.
- Exit 1 — target looks like production, or is unreachable.

Thresholds: more than **500 users** or **200 mission submissions** fails.
Production tripped both by a wide margin (12,603 / 518).

The check is on **data shape, not a hostname allowlist** — hostnames rotate, and
hard-coding the production host would put infrastructure detail into source
control. Row counts need no secret to compare and cannot go stale.

Verified working: run against the current (production) config it exits 1 and
prints the reason.

## 3. Setup, once the test database exists

In `.env.local` (gitignored — confirmed at `.gitignore:37`):

```
DATABASE_URL="postgresql://…test-db…"
DIRECT_URL="postgresql://…test-db…"
```

**`DIRECT_URL` is required** — `schema.prisma` declares `directUrl` and Prisma
migrations fail without it. It was missing while `DATABASE_URL` pointed at
production, so `prisma migrate deploy` would have errored regardless.

Then, in order:

```bash
node scripts/db-preflight.mjs      # must print PASS before anything below
npx prisma migrate deploy          # applies 20260813000000_general_interview
npm run db:seed:program            # cohort curriculum: days, modules, questions
```

The smoke test additionally requires its own explicit opt-in, unchanged:

```
SMOKE_DATABASE_URL=…   SMOKE_CONFIRM=yes
```

Two independent gates — preflight on data shape, and a dedicated variable the
smoke test reads instead of `DATABASE_URL` — so neither alone can send test
writes to the wrong database.

## 4. Production rollout

Development never touches production. When the Interview Agent is verified on
the test database, Sohail sir applies the same, already-written migration:

```
prisma/migrations/20260813000000_general_interview/migration.sql
```

It is additive only — `CREATE TYPE` ×2, `CREATE TABLE`, two indexes, one foreign
key, and one partial unique index. No `ALTER` or `DROP` against any existing
table, so `ProgramInterview` and every other model are untouched.

## 5. Finding that de-risks the DAY_31 replacement

Production holds **46 `ProgramInterview` rows, all `NOT_STARTED`, none scored**.

They exist only because `getInterviewEligibility` calls `ensureInterviewRecord`,
which *upserts* a row merely for viewing the page — they are placeholders, not
attempts. **No member has ever completed the legacy exit interview.**

So "the existing voice interview is not fully executed" is confirmed, and more
strongly than assumed. There is no interview data at risk in the DAY_31
replacement. The deprecate-don't-delete sequence in 069 §5.3 still stands — but
now for rollback safety, not for data preservation, which lowers its urgency.

## 6. Next steps once the test DB is configured

1. `db-preflight` → PASS
2. `prisma migrate deploy` → `GeneralInterview` + `InterviewBlueprint` created
3. Seed cohort curriculum, then a test member with mission submissions
4. **New** cohort smoke test verifying:
   - `GeneralInterview` schema shape
   - DAY_15 eligibility — passes only when days 1–15 are all `passed`
   - DAY_31 eligibility — passes only when days 1–31 are all `passed`
   - a scattered 15 passes does **not** unlock DAY_15
   - the partial unique index rejects a second COMPLETED row per blueprint
   - ABANDONED / INVALID do not consume a milestone and may repeat
   - legacy `ProgramInterview` fallback in `read-model.ts` resolves correctly
5. Report actual runtime results

The existing `scripts/smoke-general-interview.ts` is **not** reusable — it tests
the superseded 30-new-submissions retake rule against a `userId`-keyed schema
and is one of the files currently failing typecheck (069 addendum). Step 4 needs
a new script written against the cohort model.
