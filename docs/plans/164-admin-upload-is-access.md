# 164 — An admin upload is sufficient: remove the contact gate on imported candidates

Date: 2026-09-29 · Author: Sohail
**Supersedes plan 163**, which is reverted — see §2c.

---

## 1. Goal

A recruiter can unlock an admin-imported candidate's contact details without
that candidate having signed in. The admin's decision to upload the résumé is
the basis; no separate consent record is required.

---

## 2. Current behavior

### 2a. The gate

`src/features/hire/unlock-transaction.ts:150`, before any price lookup or
charge:

```ts
// Plan 154: a student an admin imported from a résumé has not signed in, so
// has not agreed to their contact details going to anyone. Paying cannot
// stand in for that. Checked before any money moves.
if (await hasUnclaimedImportForUser(candidateUserId)) {
  return { ok: false, reason: "CANDIDATE_NOT_CLAIMED", ... };
}
```

Recruiter sees:

> "This candidate hasn't activated their account yet, so their contact details
> can't be shared. Nothing was charged."

`hasUnclaimedImportForUser` counts `ResumeImport` rows at `status: "REGISTERED"`
— *"A User + CandidateProfile exist for it; nobody has signed in as them yet."*

### 2b. Blast radius is small and contained

`CANDIDATE_NOT_CLAIMED` appears in exactly two files: the transaction that
raises it, and one assertion in `import.test.ts`. Nothing else branches on it.

Current data: **17 imports, 16 `REGISTERED`** — so 16 candidates become
unlockable the moment this ships.

### 2c. Plan 163 is reverted

163 added a `ResumeImportConsentBasis` field so an admin could record *why*
ABTalks may pass the details on, and gated contact on it. This plan removes the
gate altogether, which makes that field a consent apparatus for a decision that
no longer needs one — an unused column and a dropdown an admin would click
through without reading, which is a worse record than none.

It was never committed and its migration was never applied, so the revert is a
`git checkout` with no database consequence.

### 2d. What is NOT changing

- **`hasUnclaimedImportForUser` stays.** `claim.ts` uses it to decide whether a
  Google sign-in on the résumé's email may claim the account. It is not only an
  unlock gate, and removing it would break account claiming.
- **The "Imported résumé · not yet claimed" badge stays.** It tells the
  recruiter the data is unverified résumé content, which remains true and is
  honest. It is provenance, not a gate.
- **The admin consent attestation at registration stays.** It covers profile
  creation and recruiter visibility, which is a separate question from contact
  release, and it is already audited.

---

## 3. Files to touch

| File | | Note |
|---|---|---|
| `src/features/hire/unlock-transaction.ts` | `[edit]` | Remove the gate, the reason and the message. |
| `src/features/resume/import/import.test.ts` | `[edit]` | T13 currently asserts the gate exists; it must assert the opposite. |
| `src/features/resume/import/import-e2e.test.ts` | `[edit]` | The "contact locked" step no longer holds. |
| `src/app/admin/resume-imports/import-table.tsx` | `[edit]` | Copy promises contact stays locked — now false. |
| `src/components/hire/match-card.tsx` | `[edit]` | Same stale promise in a doc comment. |
| `docs/plans/164-admin-upload-is-access.md` | `[new]` | This file, as the recorded decision. |

No schema change, no migration, no backfill. The behaviour change is immediate
on deploy for all 16 existing imports.

---

## 4. Server vs Client

`unlock-transaction.ts` and the tests are server-side. `import-table.tsx` and
`match-card.tsx` are Client Components but only their **copy** changes — no
props, no state, no Server→Client boundary change.

---

## 5. Steps

**S1. `unlock-transaction.ts`** — remove three things and nothing else:

1. `import { hasUnclaimedImportForUser } from "@/repositories/resume-import";`
2. The `if (await hasUnclaimedImportForUser(...))` block.
3. `"CANDIDATE_NOT_CLAIMED"` from the `reason` union and from `REFUSAL_MESSAGE`.

Leave every other refusal exactly as it is, and leave the ordering of the
remaining checks alone — `INSUFFICIENT_CREDITS` and `UNAVAILABLE` must still be
decided before `applyCreditChange`, which is what keeps a failed unlock from
charging.

**S2. `import.test.ts`** — T13 is titled *"contact stays locked until claim"*
and asserts the gate's position and reason. Replace it with a test that asserts
the decision, so a future edit that silently reinstates the gate fails:

- `unlock-transaction.ts` contains no `hasUnclaimedImportForUser` and no
  `CANDIDATE_NOT_CLAIMED`.
- `claim.ts` still calls `hasUnclaimedImportForUser` — the claim path is
  untouched.
- The remaining refusals still precede `applyCreditChange`.

**S3. `import-e2e.test.ts`** — the step asserting `"unlock gate closed"` for a
registered-but-unclaimed user is now wrong. Assert instead that an unclaimed
import is recruiter-visible *and* unlockable, and that claiming still works.

**S4. Copy.** Two places promise something that stops being true:

- `import-table.tsx`: *"Contact details stay locked until they do."* Replace
  with an accurate statement that registering makes the candidate contactable.
  The admin is the one making that decision and should see it in plain words.
- `match-card.tsx` doc comment: *"and contact stays locked until they do."*

**S5. Record the decision** where the next person will look — a comment at the
point where the gate used to be, naming this plan. A removed guard with no
explanation is how it gets re-added by someone reading plan 154's comment.

---

## 6. Guardrails (DO NOT)

- **DO NOT** remove or change `hasUnclaimedImportForUser` itself. `claim.ts`
  depends on it; this plan only stops the *unlock path* from consulting it.
- **DO NOT** remove the "not yet claimed" badge. The recruiter is buying
  contact details attached to unverified résumé data, and hiding that would be
  a second, worse change than the one being made.
- **DO NOT** move the remaining refusals after `applyCreditChange`. A failed
  unlock must still cost nothing.
- **DO NOT** reintroduce plan 163's `consentBasis` column.
- **DO NOT** touch `src/features/notification/**`.
- **DO NOT** leave the stale copy in place. Two surfaces currently tell a human
  that contact stays locked; shipping the behaviour change without the words is
  how an admin makes a promise to a candidate that the product then breaks.

---

## 7. DB safety

None required. No schema change, no migration, no data change. The effect is
immediate on deploy and is reversed by reverting the commit.

The operational lever if a candidate objects is unchanged and already exists:
`applyVisibilityChange(kind: "admin_withdraw")` sets
`CandidateVisibility.withdrawnAt`, which removes them from every recruiter
surface — `searchableUserWhere()` excludes withdrawn rows, so they become
neither findable nor unlockable. Worth knowing before this ships, because it is
now the only stop.

---

## 8. Verification

```
npx tsc --noEmit && npm run lint && npm run build
npm run test:resume-import
```

Manual, against a non-production database:

1. Import a résumé from admin and register it. Do **not** sign in as them.
2. As a recruiter, find them in search and unlock — succeeds, charges once,
   contact details appear.
3. Unlock the same candidate again — free, no second charge.
4. A recruiter with no credits still gets `INSUFFICIENT_CREDITS` and is not
   charged.
5. That candidate then signs in with Google on the résumé's email — claiming
   still works and still flips the import to `CLAIMED`.
6. Admin-withdraw the candidate — they disappear from search and can no longer
   be unlocked.

**Exactly these files should have changed**

```
docs/plans/164-admin-upload-is-access.md       [new]
src/features/hire/unlock-transaction.ts
src/features/resume/import/import.test.ts
src/features/resume/import/import-e2e.test.ts
src/app/admin/resume-imports/import-table.tsx
src/components/hire/match-card.tsx
```

No `prisma/`, no new scripts, no `package.json`.

---

## 9. Commit message

```
feat(hire): an admin upload is sufficient to unlock an imported candidate

Contact unlock refused any candidate whose résumé an admin imported until
that candidate signed in, on the grounds that they had not agreed to their
details being shared. The platform's position is now that the admin's
decision to import the résumé is itself the basis, so the gate is removed
and imported candidates unlock like anyone else.

hasUnclaimedImportForUser stays: claim.ts uses it to decide whether a
Google sign-in may claim the account, and only the unlock path stops
consulting it. The "Imported résumé · not yet claimed" badge stays too —
the recruiter is buying contact details attached to unverified résumé
data and should see that.

Two surfaces told a human that contact stays locked until the candidate
signs in. Both are corrected rather than left to make a promise the
product no longer keeps.

The remaining stop, if a candidate objects, is admin_withdraw:
CandidateVisibility.withdrawnAt removes them from every recruiter surface.
```

---

## 10. Ownership and the recorded decision

```
TASK:    Remove the contact gate on admin-imported candidates
MODULE:  Contact unlock + Resume Import + Hire side — Zainab's
         (.github/CODEOWNERS: /src/features/hire/, /src/features/resume/ →
         @zainabshujat)
FILES I OWN: none of them
```

```
CROSS-MODULE CHANGE REQUIRED

Owner:   Zainab (@zainabshujat)
Module:  Contact unlock, Resume Parsing & Import
Files:   src/features/hire/unlock-transaction.ts
         src/features/resume/import/import.test.ts
         src/features/resume/import/import-e2e.test.ts
         src/app/admin/resume-imports/import-table.tsx
Why:     The gate lives in her unlock path. There is no way to change this
         behaviour from a module I own.
Proposed: Delete the gate, the reason and the message; correct the two
         surfaces whose copy describes it. Nothing else in the unlock path
         changes.
Status:  Directed and approved by Sohail on 2026-09-29. CODEOWNERS still
         requires @zainabshujat's review on the PR.
```

**The decision, recorded deliberately (rule 9: never silently change existing
behaviour).** Plan 154 introduced this gate with the reasoning *"a student an
admin imported from a résumé has not signed in, so has not agreed to their
contact details going to anyone. Paying cannot stand in for that."* That
reasoning is not being refuted — it is being overridden. The position is now
that an admin uploading a résumé is a sufficient basis for ABTalks to pass on
the contact details in it.

The consequence, stated plainly so it is on the record and not a surprise: from
this change, a recruiter can obtain the email and phone of a person who has
never visited ABTalks, never created an account and may not know they are
listed. The 16 existing imports are affected on deploy. `admin_withdraw` is the
only remaining stop.

Raised once, decided by the owner, implemented in full.
