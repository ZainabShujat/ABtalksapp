# 163 — Raise new-recruiter starting credits to $20,000

Date: 2026-09-29 · Author: Sohail (contributor; credits owner: Zainab)

---

## 1. Goal

New recruiter workspaces receive **$20,000.00** (`2_000_000` USD cents) on
first provision. Existing balances stay unchanged (grant is frozen into the
ledger at create time).

## 2. Current behavior

- Amount comes from `PlatformConfig` key `credits.starting_grant_minor` via
  `getIntConfig` in `src/repositories/credits.ts` (`grantOnboardingCredits`).
- Code default today: `20_000` (= $200) in `src/lib/platform-config.ts`.
- Applied once inside `provisionRecruiterIdentity` when the workspace is
  created (sign-up / first hire access), not on every sign-in. Idempotent via
  ledger `idempotencyKey`.
- If a `PlatformConfig` row exists, **that row wins** over the code default.
  Admin can also edit it at `/admin/settings` or `/admin/credits`.

## 3. Files to touch

- `src/lib/platform-config.ts` `[edit]` — default `20_000` → `2_000_000`;
  update comments/description. Keep `max: 10_000_000`.
- `src/features/hire/credits.test.ts` `[edit]` — starting grant suite expects
  `$20,000.00` / `2_000_000`.
- `prisma/seed-demo-recruiter.ts` `[edit]` — comment T-228 $200 → $20,000.
- `docs/CHANGELOG.md` `[edit]` — one Pending reconcile line.
- `docs/plans/163-recruiter-starting-credits-20k.md` `[new]` — this plan.

Do **not** change unlock cost, low-balance thresholds, grant call sites, or
backfill existing orgs.

## 4. Server vs Client

Config and grant paths are server-only. No Client Component changes. No
Server→Client prop contract changes.

## 5. Steps

1. Write this plan file.
2. Change `PLATFORM_CONFIG_KEYS["credits.starting_grant_minor"].default` to
   `2_000_000` and refresh comments/description in `platform-config.ts`.
3. Update the starting-grant suite in `credits.test.ts` to expect `2_000_000`
   and `formatCreditsMinor` output (`$20,000.00`).
4. Fix the demo-seed comment only.
5. Append one CHANGELOG Pending reconcile line for the rule change.
6. **Live config row (if present):** If the target env already has a
   `PlatformConfig` row for `credits.starting_grant_minor`, upsert `intValue`
   to `2000000` — otherwise the old row keeps granting $200. Neon safety:
   child branch first; production write only with explicit authorization.
   Alternatively set via Admin → Credits/Settings UI.

## 6. Guardrails for Cursor (DO NOT)

- Do not hard-code `2_000_000` inside `grantOnboardingCredits` or provision
  paths — keep reading `getIntConfig(STARTING_GRANT_KEY)`.
- Do not backfill or top up existing recruiter balances.
- Do not change unlock cost or warning thresholds.
- Do not write production Neon without an explicit production-write
  authorization.
- Do not edit notification-locked paths or unrelated hire UI.
- Do not edit CLAUDE.md or docs/project-context.md.

## 7. DB safety

No schema change. Optional data write: upsert `PlatformConfig` for
`credits.starting_grant_minor` = `2000000` on a Neon child branch first; do
not write production unless the user authorizes that exact write.

## 8. Verification

- `npm run test:credits` — starting-grant suite green.
- Typecheck/build for touched TS files.
- Manual: register a **new** recruiter → balance pill shows $20,000.00;
  re-login does not double-grant; an existing recruiter still shows their old
  balance.
- If a PlatformConfig row existed at 20000, confirm post-upsert that a
  brand-new workspace gets 2000000.

## 9. Commit message

`feat(hire): raise new-recruiter starting credits to $20,000`
