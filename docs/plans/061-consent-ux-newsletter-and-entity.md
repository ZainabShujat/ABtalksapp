# 061 — Consent UX, newsletter opt-in, and entity details

> **Branch:** `feat/legal-compliance-hardening` (continue on it — do **not** cut a new branch).
> Plan 060 created the cookie modal and `LEGAL_ENTITY` on that branch and neither exists on `master`, so a branch cut from `master` would have nothing to edit. The same branch also keeps this to one PR for the upstream owner.

---

## 1. Goal

Four owner-requested changes on top of plan 060: move the cookie chooser from a blocking centre modal to a small bottom-corner banner, add a pre-checked newsletter opt-in to the signup forms, and fill in the now-available registered entity details. The privacy checkbox requirement turned out to be already satisfied — see §2.

---

## 2. Current behavior

**Already done — no work needed.** The owner asked for "privacy checkbox must be ticked before the user can proceed". This exists:

- All three consent values default to `false` (e.g. `src/components/program/apply-form.tsx:36-38`) — nothing is pre-ticked.
- `legalConsentAccepted()` gates the submit button at **12 call sites** across the five shared forms (`registration-form.tsx:726`, `hackathon/registration-form.tsx:588` and `:608`, `program/apply-form.tsx:326`, `workshop/RegistrationForm.tsx:452`, `talent/recruiter-register-form.tsx:110`), plus pre-submit guards.
- `legalAcceptanceSchema` re-validates server-side, so a tampered client cannot bypass it.

The two cohort forms (`talent-hunt/application-form.tsx`, `-india.tsx`) carry their own inline equivalents on step 4.

**Needs changing:**

| Area | Today |
|---|---|
| Cookie chooser | `src/components/legal/cookie-consent-modal.tsx:103` — `fixed inset-0 flex items-center justify-center` with a `bg-black/60` overlay and `max-w-lg` card. Blocks the page until a choice is made. |
| Newsletter | Nothing. No field, model, or UI anywhere — confirmed by grep over `prisma/schema.prisma`. |
| Entity details | `LEGAL_ENTITY` in `src/lib/legal-constants.ts` holds `<<FILL: …>>` markers, rendered literally on `/contact`, `/terms`, `/privacy`. |

---

## 3. Files to touch

| Path | | Note |
|---|---|---|
| `src/components/legal/cookie-consent-modal.tsx` | `[edit]` | Blocking centre modal → compact bottom-corner banner |
| `src/lib/legal-constants.ts` | `[edit]` | Real entity values replace the `<<FILL>>` markers |
| `content/legal/terms.md` | `[edit]` | Same values inline; marketing-email clause |
| `content/legal/privacy.md` | `[edit]` | Same values inline; §3 corrected for marketing email |
| `prisma/schema.prisma` | `[edit]` | New `NewsletterSubscription` model + `User` back-relation |
| `prisma/migrations/<ts>_newsletter_subscription/migration.sql` | `[new]` | Generated, not hand-written |
| `src/components/legal/legal-consent-fields.tsx` | `[edit]` | Fourth checkbox, pre-checked, **not** part of the submit gate |
| `src/lib/validations/legal.ts` | `[edit]` | `newsletterOptIn` added to `legalAcceptanceSchema` |
| `src/features/legal/record-newsletter-optin.ts` | `[new]` | Upsert helper |
| Seven funnel forms + their actions | `[edit]` | Thread the new value through |
| `docs/legal/business-decisions.md` | `[edit]` | Record v3 decisions incl. the pre-checked call |

---

## 4. Server vs Client

| Component | Boundary |
|---|---|
| `cookie-consent-modal.tsx` | **Client** (unchanged) — consumes the existing provider |
| `legal-consent-fields.tsx` | **Client** (unchanged) — controlled checkboxes |
| `record-newsletter-optin.ts` | **Server** — `import "server-only"`, called from Server Actions |
| `/contact` | **Server** — reads `LEGAL_ENTITY`, a plain object |

No new Server→Client prop crossings. `LegalConsentValues` gains one boolean — still fully serializable.

---

## 5. Steps

### Phase 1 — Entity details (no schema, zero risk, do first)

Replace the markers in `src/lib/legal-constants.ts`:

```ts
export const LEGAL_ENTITY = {
  name: "ABTalksOnAI",
  proprietor: "Suman Shukla",
  entityType: "Sole Proprietorship",
  tradingName: "ABTalks",
  address:
    "Crossing Republic, Ghaziabad, Uttar Pradesh 201016, India",
  registrationNumber: "UDYAM-UP-29-0250625",
  registrationType: "Udyam Registration (MSME)",
  email: "team@abtalks.in",
  grievanceOfficer: {
    name: "Suman Shukla",
    designation: "Proprietor and Grievance Officer",
    email: "team@abtalks.in",
    acknowledgeWithin: "24 hours",
    resolveWithin: "15 days",
  },
} as const;
```

Mirror the same values into the entity tables in `content/legal/terms.md` and `content/legal/privacy.md`. Add `proprietor` and `entityType` rows to the `/contact` table in `src/app/contact/page.tsx`.

**Never publish, anywhere in the repo or the docs:** PAN, bank account number, IFSC code, or the personal mobile number. They appear on the Udyam certificate but must not reach a public page — publishing them invites impersonation and payment fraud. Only name, entity type, address, Udyam number and the team email go out.

### Phase 2 — Cookie banner: centre → bottom corner

Rewrite the presentation layer of `cookie-consent-modal.tsx`. Provider, cookie contract, Server Action and middleware gating all stay **exactly** as they are.

- Container: `fixed bottom-4 right-4 z-[100] w-[calc(100%-2rem)] max-w-sm` — no `inset-0`, **no overlay**, page stays scrollable and clickable.
- `role="region"` + `aria-label="Cookie choices"` instead of `role="dialog"` / `aria-modal` — it no longer traps the page, so dialog semantics would be wrong.
- Remove the focus trap and the `document.body.style.overflow = "hidden"` lock. Keep the Escape handler only for the reopened-from-`/cookies` case.
- Compact layout: one line of copy, then three small buttons in a row — **Allow all** (primary), **Limited**, **Deny** — with a link to `/cookies` for the detail. Drop the per-option descriptions; they belong on `/cookies`.
- Mobile: full width above the bottom nav — `bottom-20 md:bottom-4` to clear `BottomNavGate`.

**Behaviour on ignore (owner's choice):** the banner persists and **no attribution cookies are set until a choice is made**. This needs no middleware change — `withTracking` already returns early when consent is `null`. Referral attribution is lost for visitors who never choose; that is the accepted trade-off.

### Phase 3 — Newsletter opt-in

**Schema.** Add to `prisma/schema.prisma`:

```prisma
/// Marketing-email opt-in. Kept separate from StudentProfile because the
/// checkbox appears on every funnel, including workshop / hackathon / cohort
/// signups where no StudentProfile exists.
model NewsletterSubscription {
  id             String    @id @default(cuid())
  userId         String?
  email          String    @unique
  subscribed     Boolean   @default(true)
  source         String
  subscribedAt   DateTime  @default(now())
  unsubscribedAt DateTime?
  user           User?     @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([subscribed, subscribedAt(sort: Desc)])
}
```

Add `newsletterSubscription NewsletterSubscription?` to `model User`.

`email` is the unique key, not `userId` — the cohort funnels write to Supabase and may have no `User` row at all.

**UI.** In `legal-consent-fields.tsx`, extend `LegalConsentValues` with `newsletterOptIn: boolean` and render a fourth checkbox below the age line:

> Send me occasional updates about new challenges, workshops and opportunities.

**Pre-checked** — every funnel initialises it to `true`. It is **deliberately excluded** from `legalConsentAccepted()`: the submit gate must keep depending only on the three legal boxes, so unticking the newsletter can never block signup.

**Persistence.** `record-newsletter-optin.ts` upserts by lowercased email: on `true`, set `subscribed: true` and clear `unsubscribedAt`; on `false`, do nothing on insert but flip an existing row to `subscribed: false` with `unsubscribedAt: now()`. Call it beside each existing `recordLegalConsents` call, inside the same `try/catch` shape so a failure never fails the signup.

**Docs must match the behaviour.** `content/legal/privacy.md` §3 currently reads "*Send **transactional** email/SMS … not marketing lists unless you separately opt in later*". With a pre-ticked box that sentence becomes false, and a policy that contradicts the product is worse than no policy. Replace with wording that states plainly: a newsletter opt-in is presented at signup **already selected**, the user may untick it there or unsubscribe at any time, and it is never a condition of using the Service. Add the same to the Terms marketing clause and to `/contact`.

**Owner decision on record:** the pre-ticked default was raised as non-compliant with DPDP §6(1), which requires consent by "clear affirmative action", and the owner chose to keep it. Logged in `docs/legal/business-decisions.md` so the decision and its date are traceable.

**Required before the first marketing email is actually sent** (not built here): a working one-click unsubscribe link in every campaign. Storing the opt-in is safe; sending without unsubscribe is not.

### Phase 4 — Migration

See §7. Run **after** Phases 1–3 are committed.

---

## 6. Guardrails for Cursor (DO NOT)

- **DO NOT** publish PAN, bank account, IFSC, or the personal mobile number — not in code, docs, comments, or commit messages.
- **DO NOT** add `newsletterOptIn` to `legalConsentAccepted()` or to any submit-disabled condition.
- **DO NOT** touch the cookie **contract**: `abtalks_consent` name, `<choice>.<version>` format, the Server Action, or the middleware gating. Phase 2 is presentation only.
- **DO NOT** import `@/lib/*` in `middleware.ts`. It is not in scope here — if you find yourself editing it, stop.
- **DO NOT** import `@/lib/legal` from a Client Component — it pulls `node:fs/promises` into the browser bundle and fails the build. Use `@/lib/legal-constants`.
- **DO NOT** hand-write the migration SQL; generate it with Prisma.
- **DO NOT** run `prisma migrate reset`, or any destructive command, against the Neon database — dev and prod share it.
- **DO NOT** remove the age/Terms/Privacy checkboxes or change their defaults; they are already correct.
- **DO NOT** use `console.error` — use `lib/logger.ts`. Prisma queries always use `select`.

---

## 7. DB safety

This is the first schema change in this branch, and the Neon instance is shared by dev and prod.

1. Commit all of Phases 1–3 first; record the commit hash.
2. Take a **Neon branch snapshot** before migrating.
3. `npx prisma migrate dev --name newsletter_subscription` locally to generate and apply.
4. `npx prisma generate`.
5. Review the generated SQL — it must be **additive only**: `CREATE TABLE "NewsletterSubscription"`, its indexes, and the FK. No `DROP`, no `ALTER … DROP COLUMN`.

**Note the build change.** `fix/build-safety-and-dashboard` is merged into this branch, so `npm run build` **no longer** applies migrations — it is a pure compile now. Migrations run via `npm run build:deploy`, which `vercel.json` calls on deploy.

**Two migrations are pending, not one.** `20260808120000_legal_consent_and_rights` (from plan 057) has still never been applied, so `LegalConsent` and `DataRightsRequest` do not exist. The next `migrate deploy` applies **both** it and the newsletter migration. Verify both landed, then confirm the previously-degraded paths come alive: `/admin/data-requests` loads, and the reconsent banner and OAuth consent hook stop logging failures.

---

## 8. Verification

- `npx tsc --noEmit` and `next build` pass.
- `/contact`, `/terms`, `/privacy` show **ABTalksOnAI**, Suman Shukla, the Ghaziabad address and `UDYAM-UP-29-0250625`. **Zero** `<<FILL` occurrences remain: `grep -rn "<<FILL" src/ content/ docs/` returns nothing.
- Grep the repo for the PAN, bank account number, IFSC code and personal mobile from the Udyam certificate — each must return **nothing**. (Deliberately not reproduced here: writing them into a tracked file is itself the leak this check exists to prevent. Read them off the certificate when running the check.)
- Fresh incognito: banner sits in the bottom-right, page scrolls and is clickable behind it, no dark overlay. Devtools shows no `abtalks_ref` / `abtalks_src` while the banner is ignored. Allow all → both appear; Deny → neither, and existing ones expire. Reload → no re-prompt. `/cookies` → Manage preferences reopens it.
- Mobile viewport: banner clears the bottom nav.
- `/register`: newsletter box is **ticked** on load; the three legal boxes are **unticked** and submit stays disabled until all three are ticked; unticking newsletter alone leaves submit enabled.
- After migration: a signup writes one `NewsletterSubscription` row; unticking writes none; re-signing with the same email does not duplicate.
- `prisma/schema.prisma` diff is additive only.
- Log one dated line under `## Pending reconcile` in `docs/CHANGELOG.md`.

---

## 9. Commit message

```
feat(legal): corner cookie banner, newsletter opt-in, real entity details

- Cookie chooser moved from a blocking centre modal to a compact bottom-right
  banner: no overlay, no focus trap, page stays usable. Cookie contract,
  Server Action and middleware gating unchanged. Attribution still waits for
  an explicit choice.
- Entity details published: ABTalksOnAI (sole proprietorship, proprietor
  Suman Shukla), Ghaziabad address, Udyam UDYAM-UP-29-0250625. PAN, bank and
  personal mobile deliberately excluded.
- NewsletterSubscription model + pre-checked opt-in on every signup form.
  Excluded from the submit gate so it can never block registration.
- Privacy and Terms updated to describe marketing email accurately — the
  previous "transactional only" wording no longer matched the product.

The pre-ticked default was flagged as inconsistent with DPDP s6(1) and kept
at the owner's direction; recorded in docs/legal/business-decisions.md.
```
