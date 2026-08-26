# Plan 078 — sample validation and production rollout

**Status (2026-08-26).**

- Production **Phase 5 is complete** (pass #1 `2026-08-24T15:57:57Z`, pass #2
  clean 2026-08-26: V1–V10, drift, extras, 200-user shadow, interval checks).
- Production **Phase 6 CREDENTIAL is complete**. `ENABLE_NEW_CREDENTIAL=true`.
- Production **Phase 6 POINTS is complete**. `ENABLE_NEW_POINTS=true`. Keep
  `ENABLE_DUAL_WRITE=true`. Do not change legacy writes. Remaining flags one
  at a time per `docs/plans/095-phase6-read-switches.md` (next:
  `ENABLE_NEW_CANDIDATE`).
- `plan-078-phase1` remains the **sample-validation test bed**. Do not
  full-backfill it. Do not run Phase 6 there.
- Production is never written as part of rehearsal.

Preserve on the sample child: `PHASE2_SAMPLE=1` tests, sample drift, upsert
catch-up, direct-connection dual-write, this runbook.

## Sample child (`plan-078-phase1`)

```bash
npm run db:migrate:078:phase2:sample
npm run db:check:078:drift:sample
# dual-write: DIRECT connection string, not -pooler
npm run db:check:078:dual-write
```

## Rehearsal child (from latest production)

Direct (non-pooler) `DATABASE_URL` only. Refuse production host
`ep-nameless-term-ams9a5e3`. Full Phase 2 refuses the sample child host
`ep-summer-field-amyzx79e`.

1. Create child: `neonctl branches create --name plan-078-rehearsal --parent production --project-id little-fog-11679677`
2. Apply Phase 1 SQL + Phase 2 audit SQL via `prisma db execute` (do not
   `migrate deploy` — production has leftover `20260813000000_general_interview`)
3. `npm run db:seed:platform-taxonomy`
4. `npm run db:migrate:078:phase2` (unscoped, idempotent upserts)
5. `npx tsx prisma/scripts/migrate-078-verify.ts` (V1–V10 unscoped)
6. `npm run db:check:078:phase5` (points, visibility count+leak, member
   statuses, shortlist, 200-user shadow)
7. `npm run db:check:078:dual-write:rehearsal` then `npm run db:check:078:drift`
8. Record as Phase 5 **pass #1**. Repeat after the required interval for pass #2.

## Production rollout runbook

Do this on production only after the fresh-child rehearsal passes twice:

1. Additive schema (Phase 1 + audit tables)
2. Dual-write on (`ENABLE_DUAL_WRITE=true`); legacy remains authoritative
3. Online full historical backfill (Phase 2, idempotent upsert / catch-up)
4. Short maintenance / write freeze
5. Final delta / catch-up rerun
6. Zero-drift verification (V1–V10 unscoped, points, visibility count+leak,
   200-user shadow)
7. Reopen
8. Gradually enable `ENABLE_NEW_*` repositories one flag at a time
   (CREDENTIAL → POINTS → CANDIDATE → LEARNING → PROGRESS → TALENT last).
   Keep `ENABLE_DUAL_WRITE=true`. Do not start Phase 7 until every switch is stable. See plan 095.
9. Phase 7 — new-only writes (stop writing legacy)
10. Observation period
11. Phase 8 — legacy cleanup

Neon transaction-mode pooling can drop Prisma interactive transactions that use
`SAVEPOINT`. Migration and dual-write use the **direct** endpoint.
