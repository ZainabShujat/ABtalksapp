# 101 — W1-B Points mirror prep (audit + repair; do not stop writes)

## 1. Goal

Prepare W1-B without stopping `User.synergyPoints` / `SynergyEvent` writes:
inventory every remaining production read of those two, and add a targeted
repair that copies `PointsAccount.balance` onto the User (and StudentProfile)
compatibility mirrors. Do not start W2. Do not drop tables. Dual-write stays
on.

## 2. Current behavior

W1-A (`ENABLE_NEW_POINTS_WRITES`) inverts write authority to
`PointsAccount` + `PointsTransaction` when the flag is `"true"`. User /
`SynergyEvent` / `StudentProfile.synergyPoints` stay post-commit mirrors.
`ENABLE_NEW_POINTS` (reads) is already on in production: `getBalance` reads
the account.

Flag-off path (still in source, used if the writes flag is unset): User is
still the debit/credit guard; `dualWritePoints` copies User onto the
account; reset/reject clawback still `SUM(SynergyEvent)`.

There is no student or admin **transaction history** UI. Marketplace history
is `Redemption`. Header / marketplace / admin student balance all go through
`getBalance` → `PointsAccount` when the read flag is on.

## 3. Files to touch (this prep pass)

- `docs/plans/101-phase7-w1b-points-mirror-prep.md` [new] — this audit
- `prisma/scripts/repair-078-points-legacy-mirror.ts` [new] — PA → User/SP
  copy; never mutates `PointsAccount` or `PointsTransaction`
- `package.json` [edit] — `db:repair:078:points-legacy-mirror` (+ production)
- `src/repositories/points.ts` [edit] — flag-on `lockWalletBalance` returns
  `PointsAccount.balance` or `0`; no User fallback
- `src/repositories/points-writes.test.ts` [edit] — lock + repair scans
- `docs/CHANGELOG.md` [edit] — one pending-reconcile line

Do not edit talent leftovers. Do not stop mirror writes. Do not start W2.

## 4. Server vs Client

All server-only. Repair is a Prisma script. No client components. No
middleware / env reads in `middleware.ts`.

## 5. Audit (re-checked against `src/` on 2026-08-28)

### 5.1 `User.synergyPoints` — every `src/` hit

| Location | Kind | Category | W1-B note |
|---|---|---|---|
| `getBalance` (`points.ts`) when `ENABLE_NEW_POINTS` off | read | **live display / decision** (flag-off only) | Prod read flag is ON → `PointsAccount`. Keep as rollback. |
| `lockWalletBalance` (`points.ts`) when writes flag off, or writes on and no `PointsAccount` | read | **live business decision** | Registration copies this onto `StudentProfile.synergyPoints`. Flag-on missing-account fallthrough to User is removed in this prep (return `0`). Flag-off still locks User. |
| `applyLegacyAuthoritative` (`points.ts`) `updateMany` `gte` / lock / decrement | read+write | **live business decision** (writes flag off) | Redeem / clamp debit. Not live when writes flag is on. Do not delete this path in this pass. |
| `writeLegacyWalletOnly` (`points.ts`) increment/decrement | write | compatibility mirror | Keep until a later W1-B stop plan. |
| `dualWritePoints` (`dual-write.ts`) `select: { synergyPoints }` then upsert account | read | **live business decision** (writes flag off) | Copies User onto `PointsAccount`. Not called from the flag-on invert. Keep. |
| `complete-registration.ts` copies `lockWalletBalance` onto SP create | write of SP | not a User wallet read after lock helper | Flag-on: copies PA (or 0). |
| `get-student-detail.ts` view field `user.synergyPoints` | display | **live display — already migrated** | Value from `getBalance`, not `user.synergyPoints` column. |
| `admin/students/[id]/page.tsx` `{data.user.synergyPoints}` | display | **live display — already migrated** | Same getBalance value. Field name is leftover. |
| `get-student-detail.ts` `user.findUnique` + `include: { studentProfile: true }` | incidental SQL | **admin/analytics — retain for now** | Full User + SP rows include the columns; UI does not use `profile.synergyPoints` or the raw User column. Narrow `select` later; not a wallet authority. |
| `feature-flags.ts` comment | n/a | dead as a read | comment only |
| `points-writes.test.ts` / `dual-write.test.ts` source scans | test | not production | keep |

**Not found in** `src/app` marketplace (except getMySynergy), dashboards,
analytics, referral reports, CSV student lists, hub, public profile, recruiter
PDF (that “Synergy Score” is the hire assessment composite, not SP).

`get-user-with-profile`, `get-dashboard-data`, `get-hub-data`, `get-profile`,
`get-public-profile`, `get-referrals-report`, workshop analytics, marketplace
page user lookup: all use `select` **without** `synergyPoints`.

### 5.2 `SynergyEvent` — every `src/` hit

| Location | Kind | Category | W1-B note |
|---|---|---|---|
| `submissionAwardTotal` (`points.ts`) `aggregate` / `findUnique` | read | **live business decision** (writes flag off) | Reset/reject clawback amount. Flag-on uses `PointsTransaction` `ACTIVITY_ATTEMPT`. **Do not use SUM(SynergyEvent) as wallet authority when writes are on.** |
| `writeLegacyEventOnly` / clamp `BALANCE_RECONCILIATION` create | write | compatibility mirror | Keep until W1-B stop. |
| `drift.ts` `COUNT(*)` SynergyEvent vs PointsTransaction (excludes `reconciliation:phase2:*`) | count | **admin/analytics historical — retain** | Recon/drift, not a wallet. Explicitly approved compatibility. |
| Admin actions feed `GRANT_SYNERGY` | n/a | not SynergyEvent | Reads `AdminAction`. |
| Marketplace redemptions | n/a | not SynergyEvent | Reads `Redemption`. |
| Student/admin ledger UI | — | **dead / does not exist** | No `findMany` of events in product. When a history view is added, it must use `PointsTransaction`. |

Prisma scripts (`check-078-*`, `migrate-2f-points`, `rehearse-078-points-writes`,
`migrate-078-shared`) read both tables for backfill/recon. Not live product.
Do not treat them as W1-B blockers. Repair script must not “fix” ledger drift
by rewriting `PointsTransaction`.

### 5.3 Related: `StudentProfile.synergyPoints`

Not in the user-asked inventory, but it is the rollback mirror written with
User. No product display reads it (`get-student-detail` loads the full
profile object; the SP number shown is `data.user.synergyPoints` from
`getBalance`). Repair also sets SP = `PointsAccount.balance` so the two
mirrors stay in lockstep while writes continue.

### 5.4 Surfaces checked with **zero** wallet reads of User / SynergyEvent

Dashboard / hub / public profile / referral UI / admin analytics / student
list / marketplace catalog+redeem display (balance via `getMySynergy`) /
synergy chip (`getMySynergyAction`) / recruiter PDF.

## 6. W1-B approval gates (not claimed met in this pass)

Before a later plan may **stop** legacy Points writes:

1. Zero live wallet **decisions or displays** from `User.synergyPoints`
   (flag-off branches may remain in source only while the writes flag stays
   the rollback; production must be on the invert).
2. Zero live wallet-history dependencies on `SynergyEvent`, except
   explicitly approved historical/admin compatibility (`drift.ts` counts).
3. `pointsAccountVsUserSynergy` = 0.
4. `pointsLedgerVsAccount` = 0.
5. No unhandled `[points] legacy mirror failed; new wallet kept` in
   production logs after the invert observe window. Repair any User drift
   with the script in §7 — never by editing `PointsTransaction`.

This pass does **not** stop mirrors and does **not** enable the writes flag.

## 7. Steps

1. Write this audit.
2. Add `prisma/scripts/repair-078-points-legacy-mirror.ts`:
   - `assertChildBranch()` (production only with `PHASE2_ALLOW_PRODUCTION=1`
     + direct host `ep-nameless-term-ams9a5e3`, no `-pooler`).
   - Dry-run default. `--apply` required to mutate.
   - Authoritative: `PointsAccount.balance`.
   - Repair: `User.synergyPoints = balance`; `StudentProfile.synergyPoints =
     balance` where a profile exists.
   - Never `UPDATE` `PointsAccount` or `PointsTransaction`. Never create a
     `PointsAccount` from User. Report nonzero User rows with no account;
     leave them.
   - Print pre/post mismatch counts and ledger-vs-account (informational).
3. Flag-on `lockWalletBalance`: if no account, return `0` (do not read User).
4. Source-scan tests for (2) and (3).
5. Changelog one line. Do not start W2. Do not stop mirrors.

## 8. Guardrails for Cursor (DO NOT)

- Do not set `ENABLE_DUAL_WRITE` false.
- Do not stop `User.synergyPoints` / `SynergyEvent` / SP synergy writes.
- Do not set `ENABLE_NEW_POINTS_WRITES=true` in this pass.
- Do not drop legacy tables.
- Do not start W2 (visibility) or W1-B write-stop.
- Do not `UPDATE` / delete `PointsTransaction` to match User.
- Do not create `PointsAccount` from `User.synergyPoints`.
- Do not use `SUM(SynergyEvent)` as wallet authority on the writes-on path.
- Do not copy `StudentProfile.domain` onto `CandidateProfile`.
- Do not live-recompute streaks.
- Do not mix Phase 6 talent leftovers into this pass.
- Do not edit `CLAUDE.md` or `docs/project-context.md`.
- Keep `middleware.ts` free of `@/lib/*`.
- Neon: repair `--apply` only on a proven child, or production only when the
  user authorizes that exact production write in the current request.

## 9. DB safety

No schema migration. Repair is a data copy onto legacy mirrors only.
Default dry-run. Child by default. Production `--apply` requires explicit
authorization in that request.

## 10. Verification

- `npm run test:078-points-writes` passes.
- `npx tsc --noEmit` passes.
- Repair script dry-run against a child prints counts and does not mutate.
- Files changed: only the list in section 3.

## 11. Commit message

```
docs+chore: W1-B Points mirror audit and User=PointsAccount repair

Inventory remaining User.synergyPoints / SynergyEvent reads. Add a
legacy-mirror repair that copies PointsAccount.balance onto User/SP and
never touches PointsTransaction. Do not stop mirrors; do not start W2.
```
