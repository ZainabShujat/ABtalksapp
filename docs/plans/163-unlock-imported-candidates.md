# 163 — Contact unlock for admin-imported candidates

Date: 2026-09-29 · Author: Sohail
Status: **Implemented 2026-09-29.** Option B. Sohail approved the cross-module
change; the PR still needs @zainabshujat as code owner. Migration written, NOT
yet applied to any database.

---

## 1. Goal

A recruiter unlocking a candidate an admin imported from a résumé is refused
with *"This candidate hasn't activated their account yet."* Decide whether and
how those candidates become unlockable like any other, without quietly removing
the consent checkpoint the refusal exists to enforce.

---

## 2. Current behavior

The refusal is deliberate, and the code says why.
`src/features/hire/unlock-transaction.ts:150`:

```ts
// Plan 154: a student an admin imported from a résumé has not signed in, so
// has not agreed to their contact details going to anyone. Paying cannot
// stand in for that. Checked before any money moves.
if (await hasUnclaimedImportForUser(candidateUserId)) {
  return { ok: false, reason: "CANDIDATE_NOT_CLAIMED", ... };
}
```

Message (`REFUSAL_MESSAGE.CANDIDATE_NOT_CLAIMED`):

> "This candidate hasn't activated their account yet, so their contact details
> can't be shared. Nothing was charged."

**The gate is one status check.** `hasUnclaimedImportForUser` counts
`ResumeImport` rows with `status: "REGISTERED"`, documented in the enum as
*"A User + CandidateProfile exist for it; nobody has signed in as them yet."*

**"Activated" means claimed**, and claiming is a real proof, not a formality
(`features/resume/import/claim.ts`): the person signs in with Google on the
**same verified email** as the résumé, on an account with no linked providers.
That proves the mailbox is theirs. The claim flips `REGISTERED → CLAIMED`, sets
`emailVerified`, and re-stamps the visibility consent as the student's own.

**What an unlock releases** (`features/hire/contact-access.ts`): `User.email`,
`CandidateProfile.phone`, `CandidateProfile.linkedinUrl`. For an imported
candidate every one of those came out of a PDF an admin uploaded — not from the
person.

**Not an inconsistency with plan 161.** Yesterday's backfill made ~10.8K legacy
candidates *discoverable*. `RECRUITER_FIELD_POLICY` is explicit that email and
phone are **not** part of discovery — *"released only at CONTACT_SHARED"*. So
the platform already separates findable from contactable, and this gate sits on
the second, higher bar. Removing it is not "restoring consistency"; it is
lowering that bar.

**Scale today:** 17 `ResumeImport` rows, 16 `REGISTERED`. Small enough that any
of the options below is cheap to apply retroactively.

---

## 3. The options

### Option A — delete the gate
Imported candidates unlock like anyone else. Matches the request literally,
~5 lines. **Consequence:** ABTalks sells the email and phone of people who have
never visited the site, never agreed to anything, and may not know they are
listed. That is the DPDP exposure the gate was written to avoid, and it applies
to every future import, not just the current 16.

### Option B — record the consent basis at import, then treat it as claimed *(recommended, if §10 allows)*
If the candidates gave ABTalks their résumé — a job fair, a form, an
application — that is a lawful basis, and the gate is simply over-conservative
because it only recognises *one* proof (a Google sign-in).

Add an explicit provenance/consent field the admin must set when importing
(e.g. `consentBasis: "candidate_submitted" | "event_collection" | "none"` plus a
free-text source note), and let the unlock gate accept a recorded basis as
equivalent to a claim. Imports where nobody can attest stay gated.

Auditable, defensible in a DPDP conversation, and it keeps the refusal for the
case it was actually written for.

### Option C — admin marks an individual import as consented
A per-import admin action moving it out of the gated state, written to
`AdminAction` with a reason. Narrowest, fully audited, and the admin takes
responsibility candidate by candidate. Tedious beyond a few dozen imports.

### Option D — unlock, then notify the candidate
Release the details and email the person that a recruiter received them, with a
one-click withdrawal. Good practice, but notification delivery is the **locked**
Manuvrtti module, so it cannot be built here without his approval.

**Recommendation: B**, with C as the escape hatch for one-off imports.
A only if §10 establishes there is no consent question to answer.

---

## 4. Files to touch (Option B)

| File | | Note |
|---|---|---|
| `prisma/schema.prisma` | `[edit]` | `ResumeImport.consentBasis` (enum) + `consentNote` (String?). |
| `prisma/migrations/<ts>_resume_import_consent/` | `[new]` | Additive, nullable, defaults to the gated value. |
| `src/repositories/resume-import.ts` | `[edit]` | `hasUnclaimedImportForUser` becomes "unclaimed **and** no recorded basis". |
| `src/features/resume/import/register.ts` | `[edit]` | Persist the basis captured at upload. |
| `src/app/admin/resume-imports/**` | `[edit]` | The admin picks a basis when importing. |
| `src/features/hire/unlock-transaction.ts` | `[edit]` | Message only, if the gate name changes. |
| `src/features/resume/import/import.test.ts` | `[edit]` | The existing gate assertions must move with it. |

**Every one of these paths is `@zainabshujat` in CODEOWNERS.** See §10.

---

## 5. Steps — as built

Option B, with one correction found during implementation and one during the
build:

1. `ResumeImportConsentBasis` enum (`NONE` | `CANDIDATE_SUBMITTED` |
   `EVENT_COLLECTION`) plus `consentBasis` / `consentNote` on `ResumeImport`.
   Default `NONE`, so nothing is unlocked by the migration itself.
2. **A NEW gate, not a changed one.** `hasUnclaimedImportForUser` is used by
   `claim.ts` to decide whether a Google sign-in may claim the account. Making
   it consent-aware would have meant that recording a basis stopped the
   candidate from ever claiming their own account — the opposite of the intent.
   So contact gating is a separate `isContactGatedImport(userId)`:
   `status REGISTERED AND consentBasis NONE`.
3. The basis is captured at **registration**, not upload. That is where
   `consentAttested: z.literal(true)` already lives — a checkbox that was being
   validated and then discarded. The basis is what the admin is actually
   attesting to, and now it is persisted and audited.
4. The admin UI copy said *"Contact details stay locked until they do"*. That
   promise becomes false for an import with a recorded basis, so it was
   rewritten rather than left to mislead.
5. `CONSENT_BASIS_OPTIONS` lives in a **pure** module, not `status.ts`:
   `status.ts` is `server-only`, and importing a value from it into the client
   import table pulled the whole import pipeline into the browser bundle (the
   build caught this). Same split as `features/hire/track-registry.ts`.
6. A host-guarded backfill records the basis for imports made before the field
   existed.

---

## 6. Guardrails (DO NOT)

- **DO NOT** remove the gate without an explicit decision recorded here. It is
  the last consent checkpoint before a real person's email and phone reach a
  third party, and the comment above it states the intent.
- **DO NOT** widen the gate by making the unlock *succeed but return nothing* —
  a recruiter charged for an empty payload is worse than an honest refusal.
  Note the current code already refuses **before** any money moves; keep that
  ordering whatever replaces it.
- **DO NOT** treat plan 161's discoverability backfill as precedent for
  releasing contact details. `RECRUITER_FIELD_POLICY` separates them on purpose.
- **DO NOT** weaken `claim.ts`. The Google-verified-email claim is the strongest
  proof in this flow and must keep working exactly as it does.
- **DO NOT** touch `src/features/notification/**` (Option D is out of scope
  without Manuvrtti's approval).
- **DO NOT** ship any of this without Zainab's review — CODEOWNERS will require
  it on the PR regardless.

---

## 7. DB safety (Option B)

Additive, nullable column with a default that preserves today's behaviour, so
existing rows stay gated until an admin records a basis. No backfill unless §10
establishes a basis for the existing 16, in which case it is a one-statement
update, stamped and reversible.

---

## 8. Verification

- A recruiter unlocking an import **with** a recorded basis succeeds and is
  charged once.
- An import **without** one still refuses, before any charge, with a message
  that names what is missing rather than "hasn't activated".
- A claimed candidate is unchanged.
- The existing `import.test.ts` assertion — *"unlock refuses an unclaimed import
  BEFORE any price lookup or charge"* — still passes in its updated form.
- `import-e2e.test.ts` steps for "contact locked" / "unlock now possible by
  policy" updated to match.

---

## 9. Commit message

See the commit on `feat/search-visibility-161`.

---

## 10. Ownership and the open question

```
TASK:        Let recruiters unlock contact for admin-imported candidates
MODULE:      Contact unlock + Resume Parsing & Import + Hire side — ALL Zainab's
             (CLAUDE.md "Modules I Do NOT Own"; .github/CODEOWNERS lines 13-14,
             35, 51 → @zainabshujat)
FILES I OWN: none of them
```

```
CROSS-MODULE CHANGE REQUIRED

Owner:   Zainab (@zainabshujat)
Module:  Contact unlock, Resume Parsing & Import, Hire side
Files:   src/features/hire/unlock-transaction.ts
         src/repositories/resume-import.ts
         src/features/resume/import/register.ts
         src/app/admin/resume-imports/**
         prisma/schema.prisma (ResumeImport)
Why:     The refusal lives in her unlock path and is driven by her import
         status. There is no way to change this behaviour from a module I own.
Proposed: Option B in §3 — record a consent basis at import and let the gate
         accept it, leaving the refusal in place for imports with none.
```

**The blocking question is not technical.** Which option is right depends on
where the résumés come from:

- Candidates handed them to ABTalks (event, form, application) → there is a
  lawful basis; the gate is over-conservative; **Option B**, and the existing 16
  can be backfilled.
- Sourced some other way (bought, scraped, forwarded by a third party) → there
  is no basis, and **Option A would be the wrong fix**; the honest answer is
  Option C per candidate, or leaving the gate.

I cannot determine this from the code — `ResumeImport` records the uploader, the
file and its hash, but nothing about where the document came from or on what
footing. That omission is itself worth fixing under Option B.

**Security note (my own area, per rule 8):** whichever option is chosen, the
gate must keep running before the credit charge, the decision must be recorded
per import rather than inferred, and "an admin uploaded it" must not by itself
become the consent basis — otherwise the basis is circular and the field
documents nothing.
