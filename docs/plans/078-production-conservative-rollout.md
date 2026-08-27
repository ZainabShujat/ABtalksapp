# Plan 078 — conservative production rollout (2026-08-24)

**Current posture (2026-08-27).** Phase 2 backfill is done. Phase 5 is
**complete**. Phase 6 CREDENTIAL, POINTS, and CANDIDATE are **complete**:
`ENABLE_NEW_CREDENTIAL=true`, `ENABLE_NEW_POINTS=true`,
`ENABLE_NEW_CANDIDATE=true`. Keep `ENABLE_DUAL_WRITE=true` and **legacy
writes**. Next flag is `ENABLE_NEW_LEARNING`. Other `ENABLE_NEW_*` remain
off. Runbook: `docs/plans/095-phase6-read-switches.md`.

Gate checklist **before** any production write. Phase 6 **read switches** are
plan 095 (not this file). Phase 7 / new-only writes / drop legacy are **not**
this rollout. Until each 095 switch, legacy tables stay authoritative. New
078 tables are additive shadow storage. Dual-write stays on.

The running app reads these exact keys (do not invent aliases):

- `ENABLE_DUAL_WRITE`
- `ENABLE_NEW_CANDIDATE`
- `ENABLE_NEW_LEARNING`
- `ENABLE_NEW_PROGRESS`
- `ENABLE_NEW_TALENT`
- `ENABLE_NEW_POINTS`
- `ENABLE_NEW_CREDENTIAL`

## Confirmations

| Requirement | Status |
|---|---|
| No `DROP TABLE` / `DROP COLUMN` / `RENAME` in Phase 1 SQL | Confirmed (FK drop+re-add only) |
| All `ENABLE_NEW_*` above | Stay **unset/false** until the matching Phase 6 switch in plan 095 |
| `ENABLE_DUAL_WRITE` | **true** (keep). Do not change legacy writes |
| Historical backfill | Batched `INSERT … ON CONFLICT` (`PHASE2_BATCH_SIZE`, default 100), checkpoints, P1001 retry |
| Reads | Legacy only |
| Writes after dual-write on | Legacy authoritative + new secondary (`SAVEPOINT`) |
| Phase 7 / new-only writes / drop legacy | **Not this rollout.** Phase 6 reads: plan 095 |

## Connections

| Operation | Endpoint |
|---|---|
| App reads | Pooled `DATABASE_URL` (`-pooler` OK) |
| Dual-write interactive txs | `DIRECT_URL`. `writeClient()` uses it when dual-write is on; strips `-pooler.` if needed |
| Phase 1 DDL, Phase 2 backfill, drift | Direct host `ep-nameless-term-ams9a5e3` — **never** `-pooler` |
| Host guard | `PRODUCTION_NEON_HOST_ID` |

## Env

Vercel production — Phase 6 flips one `ENABLE_NEW_*` at a time (plan 095).
Until that switch: keep unset/false. Keep `ENABLE_DUAL_WRITE=true`.

After schema verify:

- `ENABLE_DUAL_WRITE=true`
- `DIRECT_URL=<same Neon db, non-pooler>`

Operator shell (not Vercel):

- `PHASE2_ALLOW_PRODUCTION=1`
- `PHASE2_BATCH_SIZE=100`
- `PHASE2_RESET_CHECKPOINT=1` only to ignore crash cursors
- `CONFIRM_PRODUCTION_DDL=078-phase1` for DDL

## DDL that will run

1. `prisma/migrations/20260820120000_platform_data_architecture_phase1/migration.sql`
   - `CREATE TYPE` enums
   - `User.anonymizedAt` / `User.deletedAt`
   - `DROP NOT NULL` on actor columns; NULL orphan actor ids (not delete rows)
   - Drop+re-add `Certificate` / `SynergyEvent` / `RecruiterShortlistItem` FKs as **RESTRICT**
   - Add SET NULL actor FKs on `Job` / `RecruiterProfile` / `HackathonRemoval` / `Notification`
   - `CREATE TABLE` for 078 models (`CandidateProfile`, `ProgramEnrollment`, …)
   - `CandidateVisibility.searchableByRecruiters` **DEFAULT true** (platform default for new rows; not a user preference). Phase 2b still inserts explicit `false` for pre-cutover users without `ProgramMember.recruiterVisibilityConsentAt` and does not rewrite existing discoverability. `openToWork` stays default false and is independent.
   - Indexes including pg_trgm on `College`
2. `prisma/migrations/20260820130000_phase2_migration_audit/migration.sql`
   - `MigrationRun` / `MigrationConflict` / `MigrationQuarantine`

Then `prisma migrate resolve --applied` for those two folders. Cannot
`migrate deploy` (production leftover `20260813000000_general_interview`).

**Behavior note:** those three FKs become ON DELETE RESTRICT. A hard user
delete that used to cascade those rows will fail instead. No live
user-delete path is part of this rollout.

## Rollback

| Step | Rollback |
|---|---|
| Snapshot child | Leave it. Restore from that Neon child if needed |
| Phase 1 DDL | Do **not** drop new tables. App ignores them while flags are off |
| `ENABLE_DUAL_WRITE=true` | Set `false` immediately — legacy writes continue |
| Phase 2 backfill | Stop process; rerun is idempotent |
| Dual-write new-side failure | Isolated by `SAVEPOINT`; legacy commit stands |

## Sequence (this rollout)

1. Neon snapshot/child from production (`plan-078-prod-snapshot-20260824`, `br-silent-art-amv1yn8s`, parent `production` / `br-soft-bread-amu5tms1`) — **created 2026-08-24**
2. Orphan preflight SELECT
3. Apply Phase 1 + audit DDL on production **direct**
4. Verify new tables empty (except taxonomy seed if run), legacy populated
5. Deploy 078 app with all `ENABLE_NEW_*` off, `ENABLE_DUAL_WRITE` still off
6. Enable `ENABLE_DUAL_WRITE=true` + `DIRECT_URL`
7. Smoke enroll / submit / mission verify / points award / redeem / refund if safe — row in **both**
8. Online Phase 2 (`PHASE2_ALLOW_PRODUCTION=1`, batch 100)
9. Periodic drift (do not flip reads on row counts)
10. Phase 5 pass #1 + pass #2 complete (2026-08-26). Phase 6: plan 095, one flag at a time; dual-write stays on; do not change legacy writes

## Operator commands

```bash
# Snapshot already exists (do not recreate):
#   name   plan-078-prod-snapshot-20260824
#   id     br-silent-art-amv1yn8s
#   parent production (br-soft-bread-amu5tms1)
#   project little-fog-11679677

# Direct URL (no -pooler). Preflight SELECTs already passed (all orphan counts 0).
DIRECT=$(neonctl connection-string production --project-id little-fog-11679677)
DIRECT="${DIRECT/-pooler./.}"

CONFIRM_PRODUCTION_DDL=078-phase1 DATABASE_URL="$DIRECT" DIRECT_URL="$DIRECT" \
  npm run db:078:preflight:production

# After dual-write smoke, historical backfill:
PHASE2_ALLOW_PRODUCTION=1 PHASE2_BATCH_SIZE=100 DATABASE_URL="$DIRECT" \
  npm run db:migrate:078:phase2:production

PHASE2_ALLOW_PRODUCTION=1 DATABASE_URL="$DIRECT" \
  npm run db:check:078:drift:production
```
