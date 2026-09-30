# 160 — Permanent recruiter account deletion (self-service and admin)

Date: 2026-09-28 · Author: Sohail

---

## 1. Goal

Give a recruiter a way to permanently delete their own account from
`/hire/settings`, and an admin a way to permanently delete a recruiter's account
from `/admin/recruiters`. Today neither exists: the recruiter path is refused in
so many words, and the admin path was never built.

---

## 2. Current behavior

### 2a. Neither actor can delete a recruiter

|  | Candidate | Recruiter |
|---|---|---|
| Self-delete | `deleteOwnCandidateAccount` → real `tx.user.delete()` | **Refused by name** |
| Admin delete | `anonymizeUser` → soft-delete, "Never hard-deletes the User row" | **Not exposed at all** |

`src/features/profile/delete-own-account.ts` refuses recruiters explicitly:

> `"Recruiter accounts cannot be deleted from this screen."`

…and `anonymizeUser` never touches `RecruiterProfile`, `Organization` or
`OrganizationMember`, so even if it were pointed at a recruiter the workspace
would survive it. `/admin/recruiters` offers only `RecruiterAccountOps` —
disable / restore / secure, all reversible, none a deletion.

### 2b. A real `user.delete()` on a recruiter fails today

Verified against the **live database** (`information_schema`, read-only), not
just the schema file. Exactly three foreign keys into `User` / `Organization`
are `RESTRICT`; everything else is `CASCADE` or `SET NULL`:

```
RESTRICT   CreditAccount.organizationId     -> Organization
RESTRICT   CreditTransaction.organizationId -> Organization
RESTRICT   CreditTransaction.recruiterUserId -> User
```

All three are the credit ledger, and they are deliberate. The model doc:

> *"Append-only, financial-grade credit ledger… Rows are never updated and never
> deleted. A mistake is corrected with a compensating ADMIN_ADJUSTMENT or REFUND
> row, so the history stays true."*

`CreditTransactionType` includes `PURCHASE` and `REFUND`, so those rows can
represent real money. Every recruiter has at least the `GRANT_ONBOARDING` row
that `provisionRecruiterIdentity` writes, so **no recruiter can be row-deleted
without first weakening the ledger.**

**Decision (confirmed with the owner):** purge and anonymize, keep the ledger.
Row-level deletion of `User` / `Organization` is explicitly out of scope and
stays open as separate work with Zainab.

### 2c. Everything else already cascades cleanly

`TalentRequest`, `TalentEngagementRequest`, `OutreachThread`,
`RecruiterShortlistItem`, `RecruiterProfile`, `OrganizationMember` and
`UserRoleAssignment` all cascade from `User`; `TalentList`, `CandidateNote`,
`RecruiterAssessment` and `OutreachThread` cascade from `Organization`.

Because this plan **keeps** the `User` and `Organization` rows (2b), none of
those cascades will fire. Every one of them has to be deleted explicitly. That
is the single largest correctness risk in this plan, and §5 enumerates them.

**Notifications already cascade from `User`** — `UserNotification`,
`NotificationRead` and `NotificationPreference` are all `Cascade`. So this
feature needs **zero edits to the locked notification module**. See §6 for the
one consequence of keeping the `User` row.

### 2d. Existing patterns to follow

- `writeAudit(tx, …)` first, **while the PII is still readable** — `anonymizeUser`
  does exactly this and comments it.
- Anonymisation shape: `email` → `deleted+<userId>@deleted.local` (which frees
  the real address for re-registration, because `User.email` is unique),
  `name` → `"Deleted User"`, `image`/`password`/`emailVerified` → null, plus
  `deletedAt` / `anonymizedAt`.
- `sessionInvalidatedAt` is how `secureAccount` signs an account out everywhere.
- Confirmation UX: the candidate dialog requires typing `DELETE`, then
  `window.location.assign("/api/auth/signout?callbackUrl=/")`.
- Admin destructive actions take a `reason` of at least 8 characters
  (`accountOpsSchema`) and refuse `targetUserId === admin.userId` and any
  account with `hasPlatformAdmin`.

---

## 3. Files to touch

| File | | Note |
|---|---|---|
| `src/features/hire/delete-recruiter-account.ts` | `[new]` | The one purge routine both surfaces call. Server-only. |
| `src/app/actions/recruiter-account-actions.ts` | `[new]` | `deleteOwnRecruiterAccountAction` — self-service. |
| `src/app/actions/admin-recruiter-actions.ts` | `[edit]` | `deleteRecruiterAccountAction` — admin. Joins the file plan 159 created. |
| `src/components/hire/delete-recruiter-account-dialog.tsx` | `[new]` | Danger-zone dialog for `/hire/settings`. |
| `src/components/admin/delete-recruiter-dialog.tsx` | `[new]` | Admin dialog: reason + confirm. |
| `src/app/hire/settings/page.tsx` | `[edit]` | Danger-zone section; passes the purchased-credit balance. |
| `src/components/talent/admin-recruiters-panel.tsx` | `[edit]` | Mount the admin dialog per row. |
| `src/features/hire/delete-recruiter-account.test.ts` | `[new]` | Guards, ordering and coverage assertions. |
| `package.json` | `[edit]` | `test:recruiter-delete`. |

**No Prisma schema change and no migration.** That is the whole point of the
approach chosen in 2b.

---

## 4. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `delete-recruiter-account.ts` | **server-only** | Pure transaction body, takes a `tx`. Mirrors `anonymize-user.ts` / `delete-own-account.ts`. |
| Both action files | **Server Actions** | `"use server"`. Self-serve resolves the caller from the session; admin from `requireAdmin()`. |
| `/hire/settings/page.tsx` | **Server** | Already `requireRecruiter()`. Adds a credits read and passes **numbers and strings**. |
| `DeleteRecruiterAccountDialog` | **Client** | `{ purchasedBalanceMinor: number; company: string }`. |
| `AdminRecruitersPanel` | **Server** (unchanged kind) | Already mounts client children per row; adds one more. |
| `DeleteRecruiterDialog` | **Client** | `{ userId: string; name: string; company: string }`. |

Only primitives cross the boundary. No `Date` objects, no functions, no icons.

---

## 5. Steps

### S1. `src/features/hire/delete-recruiter-account.ts` `[new]`

```ts
export class DeleteRecruiterError extends Error {}

export type PurgeRecruiterInput = {
  userId: string;
  actorUserId: string;
  /** false = the recruiter deleting themselves. */
  byAdmin: boolean;
  reason: string;
};
/** The logo blob to delete AFTER the commit, if there was one. */
export type PurgeRecruiterResult = { organizationId: string; logoUrl: string | null };

export async function purgeRecruiterAccount(
  tx: Prisma.TransactionClient,
  input: PurgeRecruiterInput,
): Promise<PurgeRecruiterResult>;
```

**Guards, in this order, before any write:**

1. `byAdmin && userId === actorUserId` → refuse. An admin deletes other people
   here; deleting themselves is a different decision with a different blast
   radius. (`deleteUserAccountAction` refuses this too.)
2. `hasPlatformAdmin(userId)` → refuse. Same rule as `anonymizeUser` and
   `deleteOwnCandidateAccount`: a platform admin is never deleted from a product
   surface.
3. No `RecruiterProfile` → refuse "This is not a recruiter account." Keeps this
   routine from being pointed at a candidate, whose deletion is a different
   shape entirely.
4. `user.deletedAt` set → refuse "This account is already deleted."
5. **Self-delete only**: sum `CreditTransaction.amount WHERE type = 'PURCHASE'`
   against the current `CreditAccount.balance`; if the recruiter has ever
   purchased and the balance is above zero, refuse and name the amount. An admin
   is **not** blocked by this — they can delete and the forfeiture is recorded in
   the audit row. (Owner's decision.)

**Then, in this order:**

6. `writeAudit(tx, …)` **first**, while the PII is still readable:
   `actionType: "RECRUITER_ACCOUNT_DELETED"`, `entityType: "RecruiterProfile"`,
   `previousState: { emailDomain, company, organizationId, balanceMinor,
   purchasedMinor }`, `metadata: { byAdmin }`. Email **domain** only, never the
   address — that is what `deleteOwnCandidateAccount` records and the reason is
   the same.
7. Resolve the organization: `organizationMember.findFirst({ where: { userId } })`.
   Under T-226 that is exactly one workspace.
8. **Delete the organization's children explicitly.** They cascade from
   `Organization`, and the `Organization` is not being deleted:
   `recruiterAssessment`, `talentList` (its `TalentListItem`s cascade from it),
   `candidateNote`, `outreachThread` (its `OutreachMessage`s cascade).
9. **Delete the recruiter's own rows explicitly.** They cascade from `User`, and
   the `User` is not being deleted: `talentRequest` (its `TalentRequestMatch`es
   and search sessions cascade), `talentEngagementRequest`,
   `recruiterShortlistItem`, `outreachThread` by `recruiterUserId` (a thread in
   another org), `recruiterProfile`, `organizationMember`.
10. `userRoleAssignment.updateMany({ where: { userId, revokedAt: null } })` →
    `revokedAt`, `revokedReason`. Revoked rather than deleted, matching
    `anonymizeUser`: who held what and when is worth keeping.
11. **Anonymise the `Organization`** — it survives only to hold the ledger, so it
    must stop carrying company identity: `name` → `"Deleted workspace"`,
    `websiteUrl` / `industry` / `sizeBucket` / `location` / `logoUrl` → null,
    `isVerified` → false. Capture `logoUrl` first and return it.
12. **Anonymise the `User`**: `deletedAt`, `anonymizedAt`,
    `email` → `deleted+<userId>@deleted.local`, `name` → `"Deleted User"`,
    `image` / `password` / `emailVerified` → null,
    `sessionInvalidatedAt` → now.
13. `account.deleteMany` + `session.deleteMany` for that user — the OAuth links
    and any live session.

After step 12 the account cannot sign in by password (null), by Google (no
`Account` row), or by emailed code (the address no longer exists), and the real
address is free to register again.

### S2. `src/app/actions/recruiter-account-actions.ts` `[new]`

`deleteOwnRecruiterAccountAction({ confirm })`:
- `requireRecruiterWorkspace()` — the caller is resolved server-side; no id is
  accepted.
- `z.object({ confirm: z.literal("DELETE") })`, same literal the candidate dialog
  uses.
- `writeClient().$transaction(…, { maxWait: 20_000, timeout: 30_000 })` — the
  window every recruiter-workspace write uses, with the longer ceiling
  `deleteUserAccountAction` already uses for a purge.
- After the commit, delete the logo blob (best-effort, never fails the delete).
- Return `{ ok: true }`; the dialog does the sign-out.

### S3. `src/app/actions/admin-recruiter-actions.ts` `[edit]`

`deleteRecruiterAccountAction({ targetUserId, confirm, reason })`:
- `requireAdmin()`.
- `confirm: z.literal("DELETE")`, `reason: z.string().trim().min(8).max(500)` —
  the same floor `accountOpsSchema` sets for every other destructive admin op.
- Same transaction + blob cleanup, then `revalidatePath("/admin/recruiters")`
  and `revalidatePath("/admin/actions")`.

### S4. `src/components/hire/delete-recruiter-account-dialog.tsx` `[new]`

A destructive-variant dialog in a **Danger zone** card at the bottom of
`/hire/settings`. It must say, in plain words, what goes and what stays:
projects, searches, shortlists, outreach and assessments are deleted; the
billing record is kept; the account cannot be recovered. Type `DELETE` to
enable the button, then `window.location.assign("/api/auth/signout?callbackUrl=/")`
on success — the same hand-off the candidate dialog uses.

When `purchasedBalanceMinor > 0`, render the button **disabled** with the
balance and a line pointing at support, rather than letting the click fail — the
server refuses it either way (S1 guard 5), and a disabled control with a reason
is a better answer than an error toast.

### S5. `src/components/admin/delete-recruiter-dialog.tsx` `[new]`

Mounted per row in `AdminRecruitersPanel`, beside the existing
`RecruiterAccountOps`. Reason textarea + `DELETE` confirm + the recruiter's name
and company echoed back so the admin can see which row they are on. On success,
`router.refresh()`.

Note in the panel's doc comment that **disable** is the reversible option and
this one is not.

### S6. Tests — `src/features/hire/delete-recruiter-account.test.ts` `[new]`

- **Coverage of the explicit deletes.** Parse the Prisma schema for every model
  with a `Cascade` FK to `Organization` or a recruiter-ish FK to `User`, and
  assert the purge names each one. This is the test that matters: the whole risk
  of this plan is a table that used to be cleaned by a cascade and now is not,
  and a schema that grows a new recruiter-owned table should fail this suite
  rather than silently leak rows.
- Audit is written **before** the anonymising update (index comparison) and
  inside the transaction.
- The audit records `emailDomain`, never `email`.
- Every guard is present: self-admin, platform admin, non-recruiter, already
  deleted, purchased balance.
- The purchased-balance guard applies only when `byAdmin` is false.
- The email is rewritten to the `deleted+…@deleted.local` shape and
  `password` / `emailVerified` are nulled; `sessionInvalidatedAt` is set.
- **No `creditTransaction` or `creditAccount` delete or update anywhere** in the
  purge — the ledger is append-only and this is the line not to cross.
- No notification model is touched (see §6).
- Both actions require a `DELETE` literal; the admin one requires a reason.

Script: `"test:recruiter-delete": "cross-env NODE_OPTIONS=--conditions=react-server tsx src/features/hire/delete-recruiter-account.test.ts"`.

---

## 6. Guardrails for Cursor (DO NOT)

**Ownership.** Security, authorization, audit, recruiter isolation and Platform
Admin are mine. `RecruiterProfile` / `Organization` / credits are **Zainab's** —
declared in §10.

- **DO NOT** touch `src/features/notification/**`, `UserNotification`,
  `NotificationRead`, `NotificationPreference`, `NotificationDelivery` or
  `Notification`. They are locked to Manuvrtti. They already cascade from
  `User`, so nothing here needs them.
  **Known consequence, deliberately left alone:** because this keeps the `User`
  row, that cascade does not fire, so the deleted recruiter's notification rows
  remain — addressed to an anonymised account that can never sign in. Purging
  them needs Manuvrtti's approval; it is not in this plan. If a task asks for
  it, stop and output
  `NOTIFICATION MODULE LOCKED — approval required from Manuvrtti`.
- **DO NOT** delete or update any `CreditTransaction` or `CreditAccount` row.
  The ledger is append-only by design and its three `RESTRICT` FKs are what
  enforce it. A "cleanup" here is the one change that turns this feature into
  a financial-records incident.
- **DO NOT** change `prisma/schema.prisma` or write a migration. Making those
  FKs nullable is the separate decision §2b records as out of scope.
- **DO NOT** hard-delete the `User` or the `Organization`. It will fail, and
  the failure will be a partially-applied purge if it is attempted late in the
  transaction.
- **DO NOT** rely on a cascade for anything. The `User` and `Organization` rows
  survive, so every child row must be named. If a table is not in S1 steps 8–9,
  its rows are leaked.
- **DO NOT** write the audit row after the wipe. It records the email domain and
  company, and after step 11–12 neither is readable.
- **DO NOT** put the full email address in the audit row — domain only.
- **DO NOT** let the logo-blob delete run inside the transaction, and do not let
  its failure fail the purge.
- **DO NOT** accept a user id from the client on the self-service path; it comes
  from `requireRecruiterWorkspace()`.
- **DO NOT** let either path delete a platform admin, and do not let the admin
  path delete the caller.
- **DO NOT** skip the `DELETE` confirmation literal on either surface, or the
  reason on the admin surface.
- **DO NOT** reuse `anonymizeUser` or `deleteOwnCandidateAccount` for this.
  The first never removes a workspace; the second hard-deletes and refuses
  recruiters by name. Leave both exactly as they are — there are existing tests
  asserting `anonymizeUser` is reachable only from admin actions and that the
  candidate path does not call it.
- **DO NOT** add `any`, use `console.*`, or use `<Button asChild>`.
- **DO NOT** add files beyond the `[new]` entries in §3.

---

## 7. DB safety

**No schema change, no migration.** But this is the most destructive feature in
the last three plans, and the local `DATABASE_URL` points at **production**.

- Commit checkpoint + Neon branch snapshot before running it anywhere, and note
  the commit hash.
- Exercise it **only** against a Neon branch or a disposable database. Create a
  throwaway recruiter with plan 159's admin form, then delete it, and check the
  row counts before and after.
- The purge is irreversible by construction. `disableAccount` remains the
  reversible operation and the dialogs should say so.
- Rehearse the ledger invariant after a purge:
  `CreditAccount.balance == SUM(CreditTransaction.amount)` for that
  organization must still hold, because nothing in this plan writes either.

---

## 8. Verification

**Build / typecheck / lint**

```
npx tsc --noEmit
npm run lint
npm run build
```

**Suites**

```
npm run test:recruiter-delete          # new
npm run test:recruiter-profile         # unchanged
npm run test:admin-create-recruiter    # the action file gains a second export
```

Plus the two suites that police the neighbouring deletion paths, which must
still pass untouched: `src/features/profile/delete-own-account.test.ts` and
`src/features/hire/visibility.test.ts`.

**Manual — against a non-production database**

1. Create a throwaway recruiter with the plan-159 admin form. Sign in as them,
   run a search, shortlist someone, send an outreach message, create an
   assessment — so every table in S1 steps 8–9 has a row.
2. Record the row counts for those tables, and the `CreditAccount` /
   `CreditTransaction` rows for that organization.
3. `/hire/settings` → Danger zone → the dialog explains what goes. The button
   stays disabled until `DELETE` is typed.
4. Confirm → signed out and returned to `/`.
5. Re-check the counts: every table from steps 8–9 is empty for that recruiter;
   `CreditAccount` and `CreditTransaction` are **unchanged**.
6. The `User` row has `deletedAt`, `anonymizedAt`, `deleted+…@deleted.local`,
   null password and null `emailVerified`. The `Organization` reads "Deleted
   workspace" with null website/industry/location/logo.
7. Try to sign in with the old email and password → refused.
8. Register a **new** recruiter on that same email address → succeeds, proving
   the address was released.
9. `/admin/actions` → one `RECRUITER_ACCOUNT_DELETED` row, `byAdmin: false`,
   carrying the email **domain** and no address.
10. Repeat 1–2, then delete from `/admin/recruiters` instead: reason under 8
    characters is refused; a valid reason plus `DELETE` succeeds; the audit row
    says `byAdmin: true`.
11. Admin tries to delete their own account from that panel → refused.
12. Admin tries to delete a platform-admin recruiter → refused.
13. Give a recruiter a `PURCHASE` transaction and a positive balance: the
    self-service button is disabled with the amount; the admin path still works.
14. Sign in as a candidate who had been shortlisted by that recruiter — their
    own profile and history are intact.

**Exactly these files should have changed**

```
docs/plans/160-recruiter-account-deletion.md              [new]
src/features/hire/delete-recruiter-account.ts             [new]
src/features/hire/delete-recruiter-account.test.ts        [new]
src/app/actions/recruiter-account-actions.ts              [new]
src/components/hire/delete-recruiter-account-dialog.tsx   [new]
src/components/admin/delete-recruiter-dialog.tsx          [new]
src/app/actions/admin-recruiter-actions.ts
src/app/hire/settings/page.tsx
src/components/talent/admin-recruiters-panel.tsx
package.json
```

No `prisma/`, no `middleware.ts`, no `auth*.ts`, no
`src/features/notification/**`, no `anonymize-user.ts`, no
`delete-own-account.ts`.

---

## 9. Commit message

```
feat(hire): permanent recruiter account deletion, self-service and admin

Recruiters could not be deleted by anyone. The candidate self-delete
refused them by name, and the admin anonymiser never touched
RecruiterProfile or Organization, so /admin/recruiters offered only the
reversible disable / restore / secure.

A true row delete is refused by the database: CreditTransaction
.recruiterUserId, CreditTransaction.organizationId and
CreditAccount.organizationId are RESTRICT, which is what enforces the
append-only ledger, and every recruiter carries at least an onboarding
grant. So deletion purges instead: every project, search, shortlist,
outreach thread, note, assessment, membership and the RecruiterProfile
itself are removed, roles are revoked, the workspace loses its company
identity, and the User row is anonymised with its email released for
re-registration. The ledger is left exactly as it was.

Self-service refuses while a purchased balance remains; an admin can
still delete, and the audit row records the forfeiture. Both paths
require typing DELETE, the admin path also a reason, and neither can
touch a platform admin.
```

---

## 10. CROSS-MODULE CHANGE REQUIRED

```
Owner:   Zainab
Module:  Recruiter profile / Company identity / Credits
Files:   src/features/hire/delete-recruiter-account.ts  [new — deletes
                                                          RecruiterProfile,
                                                          anonymises Organization,
                                                          READS the credit ledger]
         src/app/hire/settings/page.tsx                 [edit — danger zone]

Why the change is required:
  Deleting a recruiter account IS deleting the RecruiterProfile and
  retiring the Organization. There is no way to offer deletion from a
  module I own without removing those rows.

Proposed change:
  The credit ledger is READ (to decide the purchased-balance guard) and
  never written — no CreditTransaction or CreditAccount row is created,
  updated or deleted, and the schema is untouched. The Organization row
  survives precisely so the ledger stays valid; it only loses its company
  identity fields. No existing registration, profile or credit code path
  changes behaviour.

Owner:   Manuvrtti — NOT requested, and nothing is edited
Module:  Notifications (LOCKED)
  Notification rows cascade from User. Because this keeps the User row,
  they will remain after a purge, addressed to an anonymised account that
  can never sign in. Purging them would mean touching locked models, so
  this plan does not. Raised here so the gap is a recorded decision rather
  than an oversight.

Security impact (Sohail, per rule 8):
  Irreversible and destructive, so: both paths require a typed DELETE
  literal; the admin path also a reason of at least 8 characters; neither
  accepts a user id from the client on the self-service side; neither can
  delete a platform admin; the admin cannot delete themselves. The audit
  row is written inside the same transaction and BEFORE the wipe, and
  records the email domain rather than the address. The purge nulls the
  password, drops Account and Session rows and sets sessionInvalidatedAt,
  so every credential and live session dies with it. Releasing the email
  address is intentional and is what makes re-registration possible; the
  anonymised row retains no PII that a new account on that address could
  reach.
```
