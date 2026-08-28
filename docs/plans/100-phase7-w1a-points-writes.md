# 100 — W1-A Points write-authority inversion

## 1. Goal

Make `PointsAccount` + `PointsTransaction` the write authority for every
balance-changing operation when `ENABLE_NEW_POINTS_WRITES=true`, while keeping
`User.synergyPoints` and `SynergyEvent` as compatibility mirrors. Do not stop
legacy writes. Do not disable `ENABLE_DUAL_WRITE`. Do not enable the new flag
on production in this pass.

## 2. Current behavior

`ENABLE_NEW_POINTS=true` (display). Writes are still User-first:
`redeem-item.ts` guards on `User.synergyPoints >= cost`, awards/grant/refund
increment User + SP + SynergyEvent, then `dualWritePoints` copies User onto
`PointsAccount`. Reset/reject derive clawback from `SynergyEvent`.

## 3. Files to touch

- `src/lib/feature-flags.ts` [edit] — `isNewPointsWritesEnabled()` (`=== "true"`, default off)
- `.env.example` [edit] — commented `ENABLE_NEW_POINTS_WRITES` (unset/false)
- `src/repositories/points.ts` [edit] — `applyPointsChange`, clawback helpers, legacy-mirror SAVEPOINT
- `src/repositories/index.ts` [edit] — export `applyPointsChange`
- `src/features/marketplace/redeem-item.ts` [edit] — preallocate redemption id; call `applyPointsChange`
- `src/features/synergy/award-submission-synergy.ts` [edit] — `applyPointsChange` only
- `src/features/synergy/award-referral-synergy.ts` [edit] — `applyPointsChange` only
- `src/app/actions/admin-redemption-actions.ts` [edit] — refund via `applyPointsChange`
- `src/app/actions/admin-actions.ts` [edit] — grant/reset/reject via `applyPointsChange`; no SynergyEvent sum when writes flag on
- `src/features/registration/complete-registration.ts` [edit] — lock/copy wallet via points helper (not a spend/award)
- `src/repositories/dual-write.test.ts` [edit] — redeem guard lives in `points.ts`
- `src/repositories/points-writes.test.ts` [new] — source scans + flag default
- `prisma/scripts/rehearse-078-points-writes.ts` [new] — child/test wallet; concurrent overspend
- `prisma/scripts/check-078-points-recon.ts` [new] — W1-A recon gate
- `package.json` [edit] — `test:078-points-writes`, `db:rehearse:078:points-writes`, `db:check:078:points-recon`
- `docs/CHANGELOG.md` [edit] — one env/convention line
- `docs/plans/100-phase7-w1a-points-writes.md` [new] — this file

## 4. Server vs Client

All server-only. No client components. No new env reads in `middleware.ts`.

## 5. Steps

1. Add `isNewPointsWritesEnabled()` next to `isNewPointsRepoEnabled()`. Do not
   couple them. Document that enabling writes without `ENABLE_NEW_POINTS` is
   unsupported.
2. Implement `applyPointsChange(tx, input)` in `points.ts`:
   - **Flag off:** current User/SP/SynergyEvent authority, then `dualWritePoints`.
     Strict debit uses `User.updateMany` `synergyPoints: { gte }`.
   - **Flag on:** (a) idempotencyKey lookup — if present, retry legacy mirror
     only; (b) ensure User exists; (c) upsert `PointsAccount` if missing;
     (d) conditional `PointsAccount.updateMany` (`balance >= cost` for strict
     debit; clamp for reset/reject; increment for credit); (e) insert
     `PointsTransaction`; (f) SAVEPOINT legacy User/SP/SynergyEvent mirror.
     Mirror failure: log `[points] legacy mirror failed; new wallet kept`, do
     not throw.
   - `debit_clamp` when flag on writes one compensating negative
     `RECONCILIATION` txn for the amount actually taken. Do not credit the
     wallet for shortfall. Do not delete/update existing ledger rows,
     including `reconciliation:phase2:*`.
3. Route every balance writer through `applyPointsChange`: redeem, submission
   award, referral award, admin grant, redemption refund, reset clawback,
   reject clawback. Preallocate redemption id (`crypto.randomUUID()`) so debit
   can use `redeem:${id}` before `redemption.create`. If debit fails, return
   without throwing after a no-op (do not create the redemption row first).
4. Reset/reject: when flag on, sum `PointsTransaction` `ACTIVITY_ATTEMPT`
   `sourceId IN submissionIds` (read before delete). When flag off, keep
   `SynergyEvent` aggregate / `findUnique`.
5. Source-scan tests: every writer calls `applyPointsChange`; `points.ts`
   contains both guards; `dual-write.ts` still has no `ENABLE_NEW_`; flag
   helper is `=== "true"`.
6. Rehearsal script: refuse production host; create disposable test user;
   `ENABLE_NEW_POINTS_WRITES=true`; grant/spend/refund/debit/reset; two
   concurrent strict debits that together exceed balance — exactly one
   succeeds; restore/delete test rows; assert `reconciliation:phase2:*` count
   unchanged.
7. Recon script (read-only): PA.balance vs User.synergyPoints = 0; SUM(txn)
   vs PA.balance = 0; User.synergyPoints≠0 missing PA = 0; print phase2 recon
   count (do not mutate).
8. Deploy posture: ship with flag unset/false. Run recon. Do not set
   `ENABLE_NEW_POINTS_WRITES=true`. Do not start W2.

## 6. Guardrails for Cursor (DO NOT)

- Do not set `ENABLE_DUAL_WRITE` false.
- Do not set `ENABLE_NEW_POINTS_WRITES=true` on production.
- Do not stop User.synergyPoints or SynergyEvent writes.
- Do not delete or rebuild `PointsTransaction` history.
- Do not derive flag-on reset amounts from `SynergyEvent`.
- Do not roll back a committed new-wallet change because a mirror failed
  (SAVEPOINT around legacy only).
- Do not leave redeem, grant, refund, or reset on User-first when the flag is on.
- Do not copy `StudentProfile.domain` anywhere. Do not touch W2–W8.
- Do not edit `CLAUDE.md` or `docs/project-context.md`.
- Keep `middleware.ts` free of `@/lib/*`.
- Neon: rehearsal must target a child or local non-production URL. Recon
  against production is read-only only, with `PHASE2_ALLOW_PRODUCTION=1` and
  the direct host.

## 7. DB safety

No schema migration. Rehearsal may insert/delete a disposable test user on a
**child** branch only. Production: no writes.

## 8. Verification

- `npm run test:078-points-writes` and `npm run test:078-dual-write` pass.
- `npx tsc --noEmit` passes.
- Rehearsal on a child: concurrent overspend → one winner; flag-off path
  unchanged in source (User `gte` still in `points.ts`).
- Recon script: three mismatch counts 0 before recommending enable (enable is
  a later request).
- Files changed: only the list in section 3.

## 9. Commit message

```
feat: invert Points write authority behind ENABLE_NEW_POINTS_WRITES

PointsAccount+PointsTransaction become the wallet when the flag is on;
User.synergyPoints and SynergyEvent stay compatibility mirrors. Flag stays
off; dual-write stays on.
```
