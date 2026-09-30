# 159 — Admin creates recruiter accounts with credentials and company details

Date: 2026-09-28 · Author: Sohail

---

## 1. Goal

Let a Platform Admin create a working recruiter account end-to-end from
`/admin/recruiters`: person + company details (including the logo), a password
issued at creation and shown to the admin exactly once, and the full T-226
workspace provisioned in the same commit — so the recruiter can sign in at
`/recruiter-onboarding/signin` with the email and password the admin hands them.

---

## 2. Current behavior

**An admin cannot create a recruiter today.** The two things `/admin/recruiters`
offers are a read-only directory and a seat list, and neither makes an account:

- `src/app/admin/recruiters/page.tsx` renders `listRecruiters()` (directory) plus
  `RecruiterSeatsPanel` over `VerifiedRecruiterSeat`.
- `addRecruiterSeatAction` writes a `VerifiedRecruiterSeat`, but the code is
  explicit that this is **not** access: *"A seat is no longer an access grant —
  registering is. It survives as a pre-verified company name."* The admin
  pre-verifies an address and then waits for that person to self-register.
- `AdminRecruitersPanel` says so in its own doc comment: *"No password field."*

**The only path that creates a recruiter** is
`registerRecruiterWithOtpAction` (`src/app/actions/recruiter-auth-actions.ts:125`),
driven by the person themselves at `/recruiter-onboarding/signup`. It needs an
emailed OTP the admin cannot complete on someone else's behalf. Inside, it does
exactly the four things this plan needs, and is the template:

1. hashes the optional password **before** the transaction (scrypt is slow and
   must not eat the commit window — the comment says so);
2. creates/reuses the `User` with `role: "RECRUITER"` and `emailVerified`;
3. creates the `RecruiterProfile` (`approved: true`, `setupStep: "COMPLETE"` —
   written, never read as a gate);
4. calls `provisionRecruiterIdentity`, which creates `Organization` +
   `OrganizationMember` + the `RECRUITER` `UserRoleAssignment` **and grants the
   onboarding credits**, all in the same commit, with
   `{ maxWait: 20_000, timeout: 20_000 }` because Neon times out at Prisma's 5s
   default for this many sequential writes.

**Passwords.** `User.password` holds a scrypt hash from `src/lib/password.ts`
(`scrypt$…`, OWASP N=2^15/r=8/p=3, parameters stored in the hash).
`hashPassword` / `verifyPassword` / `isUsablePasswordHash` are the whole API.
Sign-in is the `password` Credentials provider (`src/auth.ts:95`) →
`authorizePassword` (`src/lib/email-auth.ts:267`), which requires
`isEmailLoginEnabled()`, requires `isRecruiterAuthEnabled()` for
`audience: "recruiter"`, rate-limits per account and per IP, and throws
`NotRecruiterSignIn` if the account has no `RecruiterProfile`. Both flags are
`true` in `.env.local`. The recruiter's password screen is
`src/components/recruiter-onboarding/signin-screen.tsx:118`.

**Work email.** `workEmailSchema` refuses consumer domains, and
`src/lib/validations/work-email.ts` states the rule has **no exception**:
*"on any path"*, with *"no environment variable, no database table and no admin
override"*. That settles a design question this feature would otherwise raise —
see §6.

**Company details.** `Organization.websiteUrl / industry / sizeBucket /
location / logoUrl` are writable today only by the recruiter themselves at
`/hire/settings`, through `updateRecruiterProfileAction` and (plan 158)
`uploadCompanyLogoAction`. `provisionRecruiterIdentity` sets only `name`, so an
admin-created workspace would otherwise start blank.

**Audit.** `writeAudit(tx, …)` → `AdminAction`, called inside the caller's
transaction. Repo tests already assert that admin mutations put the audit row in
the same transaction as the mutation.

---

## 3. Files to touch

| File | | Note |
|---|---|---|
| `src/lib/validations/admin-recruiter.ts` | `[new]` | `createRecruiterSchema` — `updateRecruiterProfileSchema.extend({ email: workEmailSchema, … })`, so the company rules are reused rather than restated. |
| `src/features/admin/create-recruiter.ts` | `[new]` | The creation itself: pre-flight refusals, the transaction, the audit row. Server-only. |
| `src/features/admin/generate-password.ts` | `[new]` | Rejection-sampled password generator over an unambiguous alphabet. |
| `src/app/actions/admin-recruiter-actions.ts` | `[new]` | `createRecruiterAction(formData)` — `requireAdmin`, Zod, logo attach, result envelope. |
| `src/components/admin/create-recruiter-form.tsx` | `[new]` | Client form + the one-time credentials panel. |
| `src/features/hire/org-logo-storage.ts` | `[edit]` | Add `readLogoUpload(file)` — the size / MIME / magic-byte validation, so it lives in ONE place instead of three. |
| `src/app/actions/recruiter-profile-actions.ts` | `[edit]` | Point `uploadCompanyLogoAction` at `readLogoUpload`; delete its local copy of the sniff. |
| `src/app/admin/recruiters/page.tsx` | `[edit]` | Render the form; pass `emailLoginEnabled`. |
| `src/features/admin/create-recruiter.test.ts` | `[new]` | Schema, generator and source-invariant assertions. |
| `src/features/hire/recruiter-profile.test.ts` | `[edit]` | Re-point the two sniff assertions at the shared helper. |
| `package.json` | `[edit]` | `test:admin-create-recruiter`. |

**No Prisma schema change and no migration.** `User.password`,
`RecruiterProfile`, `Organization` (with `logoUrl` from plan 158) and
`AdminAction` all already exist.

---

## 4. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `src/app/admin/recruiters/page.tsx` | **Server** | Already `await requireAdmin()`. Adds one `isEmailLoginEnabled()` call and passes a **boolean** down. |
| `CreateRecruiterForm` | **Client** (`"use client"`) | Owns the form state, the logo canvas downscale and the credentials panel. Receives only `emailLoginEnabled: boolean`. |
| `create-recruiter.ts`, `generate-password.ts`, `org-logo-storage.ts` | **server-only** | `import "server-only"`. Never reachable from the client. |
| `admin-recruiter-actions.ts` | **Server Action** | `"use server"`. Takes `FormData` (it carries the logo file), returns a plain object. |

**Server → Client boundary:** one boolean down; `FormData` up; a plain
`{ userId, email, password, logoAttached, logoMessage }` back. No functions, no
icons, no class instances, no `Date` objects.

---

## 5. Steps

**S1. `src/features/admin/generate-password.ts` `[new]`**

```ts
import "server-only";
import { randomBytes } from "node:crypto";

/** No 0/O/1/l/I — the admin reads this aloud or pastes it into a chat. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const GENERATED_PASSWORD_LENGTH = 20;

export function generateRecruiterPassword(
  length = GENERATED_PASSWORD_LENGTH,
): string;
```

**Rejection sampling, not `% ALPHABET.length`.** The alphabet is 55 characters,
which does not divide 256, so modulo would make the first 36 characters more
likely than the rest. Draw a byte, discard it when it lands in the short tail
(`byte >= 256 - (256 % len)`), otherwise take `byte % len`. Draw in blocks of 32
bytes so a discard does not cost a syscall.

`generateProgramJoinCode` in `lib/program-auth.ts` uses plain modulo and is
fine — its alphabet is exactly 32 characters. Do not copy that shape here.

**S2. `src/lib/validations/admin-recruiter.ts` `[new]`**

```ts
export const createRecruiterSchema = updateRecruiterProfileSchema.extend({
  // No admin override: src/lib/validations/work-email.ts says the rule holds
  // "on any path". An admin creating the row is not an exception to it.
  email: workEmailSchema,
  passwordMode: z.enum(["generate", "manual"]),
  password: z.string().optional(),
}).superRefine((value, ctx) => { /* manual ⇒ passwordSchema + passwordIsNotEmail */ });
```

Extending `updateRecruiterProfileSchema` is what reuses the existing `fullName`
(no digits), `phone`, `companyName`, `website` (auto-`https://`), `industry`,
`companySize` and `location` rules. Do not restate them. Note that
`logoUrl` is not in that schema by design (plan 158) — the logo arrives as a
file, never as text.

**S3. `src/features/hire/org-logo-storage.ts` `[edit]`**

Add the upload validation that `uploadCompanyLogoAction` currently holds inline,
so the admin path does not become a third copy of a **security control**:

```ts
export type LogoUploadResult =
  | { ok: true; bytes: Uint8Array; ext: string; mime: string; contentHash: string }
  | { ok: false; message: string };

export async function readLogoUpload(file: unknown): Promise<LogoUploadResult>;
```

It must keep every check exactly as plan 158 wrote it, in the same order: a
`File` with `size > 0`; `size <= LOGO_MAX_BYTES`; `image/svg+xml` refused
explicitly; `isAllowedLogoMimeType`; `arrayBuffer()` in try/catch; the
magic-byte sniff; and `sniffed.mime === file.type` required. It returns the
sha256 too, since every caller needs it. Move `sniffImageType` here as a private
function.

Do **not** touch `src/app/actions/candidate-profile-actions.ts` or
`src/features/profile/avatar-storage.ts` — the avatar copy belongs to the
candidate-profile module and is out of scope.

**S4. `src/app/actions/recruiter-profile-actions.ts` `[edit]`**

Replace the inline validation block and the local `sniffImageType` with a call
to `readLogoUpload(formData.get("file"))`. Behaviour, messages and order are
unchanged — this is a move, not a rewrite. Everything else in that file stays.

**S5. `src/features/admin/create-recruiter.ts` `[new]`**

```ts
export type CreateRecruiterInput = z.infer<typeof createRecruiterSchema> & {
  adminUserId: string;
  passwordHash: string;
};
export type CreateRecruiterResult =
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; message: string };

export async function createRecruiterAccount(input): Promise<CreateRecruiterResult>;
```

Pre-flight, before the transaction:

- Look up the `User` by the lowercased email, selecting
  `{ id, role, recruiterProfile: { id }, candidateProfile: { userId } }`.
- Already has a `recruiterProfile` → `"This email already has a recruiter account."`
- Has a `candidateProfile` → refuse with the same rule `registerRecruiter`
  states: a student challenge account cannot become a recruiter.
- An existing `User` with neither → reuse the row (it may be a bare account from
  a newsletter or a guest flow), same as the OTP path does.

Then one transaction, `{ maxWait: 20_000, timeout: 20_000 }` (the window every
other recruiter-provisioning path uses — Neon times out below it):

1. Create or update the `User`: `email` (lowercased), `name: fullName`,
   `role: "RECRUITER"`, `password: input.passwordHash`, `emailVerified: now`.
   `emailVerified` is set because the admin is vouching for the address — say so
   in a comment and record `emailVerifiedBy: "admin"` in the audit metadata, so
   the row does not later read as a proven address.
2. `tx.recruiterProfile.create` — `fullName`, `company`, `phone`,
   `approved: true`, `approvedAt`, `setupStep: "COMPLETE"`, `setupCompletedAt`.
   Same fields as the OTP path, for the same reason.
3. `provisionRecruiterIdentity(tx, { userId, company, grantedByUserId: adminUserId })`.
   Passing the admin is the difference from the self-serve path: the
   `OrganizationMember.invitedByUserId` and the `UserRoleAssignment.grantedByUserId`
   then record who granted it. This also grants the onboarding credits, so an
   admin-created workspace is funded exactly like a self-registered one.
4. `tx.organization.update` — `websiteUrl`, `industry`, `sizeBucket`, `location`.
   Provisioning only sets `name`, so without this the workspace starts blank.
5. `writeAudit(tx, { actorUserId: adminUserId, adminUserId, targetUserId: userId,
   entityType: "RecruiterProfile", entityId: profileId,
   actionType: "RECRUITER_CREATED_BY_ADMIN", reason, metadata: { email, company,
   passwordMode, emailVerifiedBy: "admin" } })` — **in the same transaction**,
   which is the repo's rule for admin mutations.

The password, hashed or plain, never goes into the audit row, the metadata or a
log line.

**S6. `src/app/actions/admin-recruiter-actions.ts` `[new]`**

`createRecruiterAction(formData: FormData)`:

1. `const admin = await requireAdmin();`
2. Build a plain object from the `FormData` fields and `createRecruiterSchema.safeParse`.
3. If `passwordMode === "manual"` and `!isEmailLoginEnabled()` → refuse with the
   message `registerRecruiterWithOtpAction` already uses for this case. If
   `generate` and the flag is off, still generate — but the form has already
   said the recruiter will sign in by emailed code (S7).
4. Resolve the plaintext: `password ?? generateRecruiterPassword()`.
5. `const passwordHash = await hashPassword(plain);` — **before** the
   transaction, for the reason the OTP path documents.
6. `await createRecruiterAccount({ …parsed.data, adminUserId: admin.userId, passwordHash })`.
7. **After** the commit, if `formData.get("logo")` is a file: `readLogoUpload` →
   `storeCompanyLogoFile({ organizationId, … })` → `organization.update({ logoUrl })`.
   Best-effort: a logo that fails to attach must **not** roll back or fail the
   account, because a blob upload cannot be inside a database transaction
   anyway. Report it instead — `{ logoAttached: false, logoMessage }` — and the
   admin can set it later, or the recruiter can at `/hire/settings`.
8. `revalidatePath("/admin/recruiters")`, `revalidatePath("/admin/actions")`.
9. Return `{ ok: true, data: { userId, email, password: plain, logoAttached, logoMessage } }`.

The plaintext crosses the wire exactly once, in this response, and is never
logged and never persisted. Say that in a comment on the return type.

**S7. `src/components/admin/create-recruiter-form.tsx` `[new]`**

A collapsed "Create recruiter" card above the directory, expanding to three
groups:

- **Recruiter** — full name\*, work email\*, phone.
- **Company** — name\*, website, industry, size, location, and a logo picker
  reusing plan 158's client-side treatment: reject SVG and >2 MB before
  uploading, fit inside 512 px preserving aspect ratio, export **PNG** (JPEG
  would flatten a transparent logo onto black), 72 px preview tile.
- **Access** — radio `Generate a password` (default) / `Set a password`, with the
  password field shown only for the second. When `emailLoginEnabled` is false,
  show a notice that password sign-in is currently off and this recruiter will
  sign in with an emailed code.

On success the form replaces itself with a **credentials panel**: the email and
the password in a monospace box, a copy button for each, and the line "This
password is shown once. Copy it now and send it to the recruiter." plus a
`Done` that clears it and `router.refresh()`es the directory.

Never put the password in a `toast`, a URL, a query string or `localStorage`.
Do not auto-email it — emailing a plaintext password is exactly the practice
this panel exists to avoid, and the admin is the channel by design.

**S8. `src/app/admin/recruiters/page.tsx` `[edit]`**

Render `<CreateRecruiterForm emailLoginEnabled={isEmailLoginEnabled()} />` in a
new section above "All recruiters". No other change.

**S9. Tests — `src/features/admin/create-recruiter.test.ts` `[new]` + `package.json`**

Same shape as the other `src/features/**/*.test.ts` suites. Cover:

*Schema* — a gmail/yahoo address is refused with `WORK_EMAIL_REQUIRED_MESSAGE`;
a work address passes; `fullName` with digits refused (inherited from
`updateRecruiterProfileSchema`); `manual` with a 7-character password refused;
`manual` with the password equal to the email refused; `generate` with no
password accepted; `website` without a scheme auto-prefixed.

*Generator* — length; alphabet membership; excludes `0 O 1 l I`; 200 draws are
all distinct; the source uses rejection sampling and **not** a bare
`% ALPHABET.length`.

*Source invariants* — `requireAdmin()` is called before anything else;
`hashPassword` is awaited **before** `prisma.$transaction` (index comparison);
`writeAudit` is inside the transaction; the audit metadata does not mention
`password`; no `logger` call takes the plaintext; `provisionRecruiterIdentity`
is called with `grantedByUserId`; the transaction passes
`timeout: 20_000`; the form never writes the password to `localStorage` or a
`toast`.

Script: `"test:admin-create-recruiter": "cross-env NODE_OPTIONS=--conditions=react-server tsx src/features/admin/create-recruiter.test.ts"`.

**S10. `src/features/hire/recruiter-profile.test.ts` `[edit]`**

Two assertions currently look for `function sniffImageType` and
`sniffed.mime !== file.type` inside `recruiter-profile-actions.ts`. After S3/S4
that logic lives in `org-logo-storage.ts` — re-point them there and assert the
action calls `readLogoUpload`. The checks themselves do not weaken.

---

## 6. Guardrails for Cursor (DO NOT)

**Ownership.** Platform Admin, authentication, authorization, security and audit
are mine and are the bulk of this. Creating `RecruiterProfile` + `Organization`
and triggering the onboarding credit grant is **Zainab's** module — declared in
§10, approval required before those writes are implemented.

- **DO NOT** touch `src/features/notification/**` or any locked notification
  path. Nothing here needs them. If something appears to, stop and output
  `NOTIFICATION MODULE LOCKED — approval required from Manuvrtti`.
- **DO NOT** add an admin override to the work-email rule — not a checkbox, not
  a flag, not an env var. `src/lib/validations/work-email.ts` states the rule
  holds on every path with no exception, and an admin form is precisely the
  exception mechanism T-225 removed. If an admin needs a consumer domain, that
  is a change to that file, reviewed as source.
- **DO NOT** log, persist, audit, email, toast or URL-encode the plaintext
  password. It appears in exactly one place: the success payload of
  `createRecruiterAction`, rendered once.
- **DO NOT** hash inside the transaction. scrypt is ~32 MiB and deliberately
  slow; the OTP path hashes first for this reason and so does this one.
- **DO NOT** use `Math.random()` for the password, and do not use
  `% ALPHABET.length` over a 55-character alphabet — that is a biased generator
  for a credential.
- **DO NOT** write the audit row outside the transaction that creates the
  account, and do not skip it.
- **DO NOT** accept a user id, organization id or role from the client. The
  admin comes from `requireAdmin()`; the new account's ids are produced server
  side.
- **DO NOT** set `role: "ADMIN"`, grant any `UserRoleAssignment` other than the
  `RECRUITER` one `provisionRecruiterIdentity` writes, or touch
  `isGoogleOnlyAccount` / the admin-email list. This form creates recruiters and
  nothing else.
- **DO NOT** re-implement `provisionRecruiterIdentity`. Call it, inside the
  transaction, with `grantedByUserId` — it is what makes the workspace and funds
  it, and duplicating it would double-grant or under-grant credits.
- **DO NOT** put the blob upload inside the transaction, and do not fail the
  account when the logo fails.
- **DO NOT** create or consume a `VerifiedRecruiterSeat`. A seat is a
  pre-verified company name for self-registration; an admin creating the account
  outright has no use for one, and spending one would silently change what the
  seat list means.
- **DO NOT** touch `middleware.ts`, `auth.config.ts` or `auth.ts`. Sign-in
  already works for any recruiter with a usable password hash; this feature adds
  no provider and no session change.
- **DO NOT** edit `src/app/actions/candidate-profile-actions.ts` or
  `src/features/profile/avatar-storage.ts`.
- **DO NOT** add `any`, use `console.*` (use `lib/logger.ts`), or use
  `<Button asChild>` / `<Button render={<Link>}>`.
- **DO NOT** add files beyond the `[new]` entries in §3.

---

## 7. DB safety

**No schema change and no migration.** Every column and model this uses already
exists: `User.password` / `User.role` / `User.emailVerified`, `RecruiterProfile`,
`Organization` (+`logoUrl` from plan 158), `OrganizationMember`,
`UserRoleAssignment`, `CreditAccount` / `CreditTransaction` (through
`grantOnboardingCredits`) and `AdminAction`.

**This writes real rows**, unlike plan 158's read-mostly change, and the local
`DATABASE_URL` points at **production**. So:

- Take a commit checkpoint and a Neon branch snapshot before running the feature
  against this database, and note the commit hash.
- Exercise it first against a Neon branch or a disposable database, not the
  production endpoint, and delete the test recruiter afterwards.
- The write is additive and idempotent-ish (`provisionRecruiterIdentity` is
  idempotent; the credit grant is exactly-once on its `idempotencyKey`), but a
  recruiter created by mistake is a real account with real credits — remove it
  deliberately, do not leave it.

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
npm run test:admin-create-recruiter   # new
npm run test:recruiter-profile        # the re-pointed logo assertions
npm run test:hire-pagination          # unchanged
```

**Manual — against a non-production database**

1. `/admin/recruiters` as an admin: the "Create recruiter" card is there. As a
   non-admin, `/admin/recruiters` still redirects — the form changes no gate.
2. Submit with a gmail address → refused with the work-email message, nothing
   created.
3. Submit with a name containing digits → refused.
4. `Set a password` with `abc123` → refused (under 8).
5. `Generate a password` + full company details + a PNG logo → success panel
   shows the email and a 20-character password; copy both.
6. `/admin/recruiters` now lists the recruiter with **Workspace ready**.
7. `/admin/recruiters/<userId>` shows the organization with the website,
   industry, size and location that were typed.
8. Sign out. At `/recruiter-onboarding/signin`, enter that email and the copied
   password → lands on `/hire`. This is the acceptance test for the whole
   feature.
9. `/hire/settings` as that recruiter: the company fields are prefilled and the
   logo tile shows the uploaded logo.
10. `/admin/actions` shows one `RECRUITER_CREATED_BY_ADMIN` row naming the admin
    and the target, and its metadata contains **no** password.
11. Create a second recruiter with the same email → refused, no duplicate.
12. Try an email belonging to an existing student account → refused with the
    student-account message.
13. Submit with a `.svg` renamed to `.png` as the logo → the account is still
    created, and the panel says the logo was not attached.
14. Check the recruiter's credit balance at `/hire/credits` — funded like a
    self-registered recruiter, and exactly once.

**Exactly these files should have changed**

```
docs/plans/159-admin-creates-recruiter-accounts.md   [new]
src/lib/validations/admin-recruiter.ts               [new]
src/features/admin/create-recruiter.ts               [new]
src/features/admin/generate-password.ts              [new]
src/features/admin/create-recruiter.test.ts          [new]
src/app/actions/admin-recruiter-actions.ts           [new]
src/components/admin/create-recruiter-form.tsx       [new]
src/features/hire/org-logo-storage.ts
src/app/actions/recruiter-profile-actions.ts
src/app/admin/recruiters/page.tsx
src/features/hire/recruiter-profile.test.ts
package.json
```

No `prisma/`, no `middleware.ts`, no `auth*.ts`, no
`src/features/notification/**`, no `candidate-profile-actions.ts`.

---

## 9. Commit message

```
feat(admin): create recruiter accounts with credentials from admin

An admin could pre-verify an email (VerifiedRecruiterSeat) but not make a
working recruiter — only the person themselves could, through the OTP
signup. /admin/recruiters now creates the account outright: person and
company details, an optional logo, and a password issued at creation and
shown once for the admin to hand over.

One transaction creates the User with a scrypt hash, the RecruiterProfile,
and — through provisionRecruiterIdentity with grantedByUserId — the
Organization, membership, RECRUITER role assignment and onboarding
credits, with the AdminAction audit row in the same commit. The plaintext
password is returned once and is never logged, persisted or emailed. The
work-email rule is enforced with no admin override, as work-email.ts
requires.

The logo upload validation (size, MIME, magic bytes) moves into
org-logo-storage.ts so the admin and recruiter paths share one copy of
that check instead of two.
```

---

## 10. CROSS-MODULE CHANGE REQUIRED

```
Owner:   Zainab
Module:  Recruiter registration / Recruiter profile / Company identity / Credits
Files:   src/features/admin/create-recruiter.ts        [new — writes RecruiterProfile,
                                                        Organization, and calls
                                                        provisionRecruiterIdentity,
                                                        which grants credits]
         src/app/actions/recruiter-profile-actions.ts  [edit — the logo validation
                                                        moves to a shared helper;
                                                        behaviour unchanged]

Why the change is required:
  A recruiter account IS a RecruiterProfile plus the T-226 workspace. There
  is no way to create one from a module I own without writing those rows,
  and re-implementing them outside her module would be worse — it would
  fork the provisioning rules and could double- or under-grant the
  onboarding credits.

Proposed change:
  Additive. No existing registration path, schema, validation rule or
  action signature changes. The new code calls her existing
  provisionRecruiterIdentity rather than reproducing it, and writes exactly
  the fields registerRecruiterWithOtpAction already writes. The one edit to
  an existing file of hers is a move of the logo-upload validation I added
  in plan 158 into a shared helper, with identical checks in identical
  order.

Security impact (Sohail, per rule 8):
  New privileged surface, so: requireAdmin() before anything; no id, role
  or organization accepted from the client; the work-email rule enforced
  with no override; scrypt hashing outside the commit window; the plaintext
  password returned exactly once and never logged, persisted, audited or
  emailed; a cryptographically uniform generator (rejection sampling, not
  modulo); an AdminAction row in the same transaction naming the actor and
  the target. Sign-in itself is unchanged — no new provider, no session
  change, and the existing per-account and per-IP password rate limits
  still apply to these accounts.
```
