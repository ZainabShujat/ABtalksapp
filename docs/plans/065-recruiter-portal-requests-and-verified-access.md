# Plan 065 — Recruiter portal: anonymised candidates, requests, and verified access

> Renumbered from 063: the owner pushed their own `063-program-day-tz-ist-fix.md`
> and `064-program-behind-pace-calendar.md` while this was in flight.

> **Status — 2026-08-12.** Phases 1–5 and 7 are built, tested and on
> `fix/hire-scout-conversation`. The migration was applied to the shared
> database after review (additive only: 3 new tables, 2 enums, one defaulted
> column; existing row counts unchanged afterwards).
>
> | Phase | State |
> |---|---|
> | 1 · Recruiter chrome | **done** — logo, wordmark, theme toggle, inline pills |
> | 2 · Anonymity | **done** — AB-#### everywhere, contact removed from the query |
> | 3 · Request → ticket | **done** — `/hire/requests`, thread, recruiter comments |
> | 4 · Verified seats | **done** — gates registration, `/admin/recruiter-seats` |
> | 5 · Split entry | **done** — `/login?as=recruiter` |
> | 6 · Cross-track sources | **blocked on consent — see below** |
> | 7 · Admin queue | **done** — `/admin/hire-requests` |
> | 8 · Pool script | **done** — `npm run verify:hire-pool` |
>
> **Why Phase 6 is not built.** `recruiterVisibilityConsentAt` exists only on
> `ProgramMember`. The 60-day, Claude and hackathon tracks have no equivalent,
> so shipping those sources would show recruiters people who never agreed to be
> shown. `npm run verify:hire-pool` run against the shared database returns:
>
> ```
>   track                       total   eligible   consented
>   AI cohort (ProgramMember)       7          7           3
>   60-day · SE                    39          1           0
>   60-day · DS / AI / CLAUDE      53          0           0
>   Hackathon                       1          1           0
>   CandidateAvailability openToWork = true: 0
> ```
>
> Enabling the other sources today would add **zero** candidates while creating
> the exposure. The candidate-side availability form (062 §5.1) is the unblock.

Successor to `062-hire-evidence-based-matching-agent.md`. 062 built the Scout
conversation and the evidence ranker; this plan turns `/hire` into an actual
employer portal: candidates stay anonymous until a request is placed, the
request becomes something the ABTalks team works, and only pre-verified
recruiters can get in at all.

Reference walked for interaction patterns:
`https://rainbow-sundae-a233e5.netlify.app/` ("TalentBridge — Employer Portal").
Its four-step spine is worth copying because it matches the business model we
already have:

| Step | Reference | Ours today |
|---|---|---|
| 1 · Define requirement | Hiring Assistant + preset pills | **Built** — Scout at `/hire` |
| 2 · Matched profiles | anonymised list, `AB-7241` IDs, "Privacy protected" banner | Partial — `/hire/[requestId]` shows **full names** |
| 3 · Review & request | cart + per-candidate note → places a request | **Missing** |
| 4 · Tickets | recruiter tracks the request; team coordinates | **Missing** |

---

## 1. Goal

Stop `/hire` from being a directory a recruiter can bypass, and make it a funnel
the business controls: anonymised matches → shortlist with notes → a request the
admin team works → contact released only after the engagement is confirmed.
Alongside that, gate recruiter login on a pre-verified list, and widen the
candidate pool beyond the single AI cohort.

---

## 2. Current behaviour (verified in code, not assumed)

**The pool is one cohort.** `searchCandidates` reads
[search-candidates.ts:31-56](src/features/hire/search-candidates.ts#L31-L56) —
`programCohort.findFirst({ where: { resultsPublishedAt: { not: null } } })`, then
`ProgramMember` in that cohort. Nobody from the 60-day challenge
(`Enrollment`), the Claude track (`Domain.CLAUDE`), or the hackathon
(`HackathonParticipant`) can ever be returned.

**Contact details are already exposed.** `/talent/members/[id]` renders the
member's email as a `mailto:` link, plus LinkedIn and GitHub
([page.tsx:87-118](src/app/talent/members/[id]/page.tsx#L87-L118)). Any approved
recruiter can reach a candidate directly and never place a request. This is the
single biggest hole in the model.

**`MatchCard` shows `fullName`, `jobRole`, `company`**
([match-card.tsx:8-35](src/components/hire/match-card.tsx#L8-L35)). There is no
candidate-facing public ID anywhere in the schema.

**A shortlist exists but cannot become a request.** `RecruiterShortlistItem`
(schema:929) has `recruiterUserId`, `memberId`, `note` — the cart, essentially.
It has no status, no request grouping, and `memberId` is a hard FK to
`ProgramMember`, so it cannot hold a 60-day or hackathon candidate.

**Nothing represents a request or a ticket.** `TalentRequest` is the
*requirement* (the job spec), not a per-candidate ask. Admin has
`/admin/hire-demand` reading `TalentRequest`, and it is **linked from no
navigation anywhere** — confirmed by grep; the only references are two
`revalidatePath` calls. (`/admin/program/recruiters` *is* reachable, via the
Program sub-nav — [program-admin-nav.tsx:12](src/components/program/program-admin-nav.tsx#L12).)

**Recruiter access is self-signup plus an admin flip.** `RecruiterProfile`
(schema:916) has `approved`, `approvedAt`, `approvedByAdminId`. Anyone can
register at `/talent/register` and wait. There is no allowlist of companies or
seats that the credentials must match.

**`/hire` has its own bare header.**
[layout.tsx:12-35](src/app/hire/layout.tsx#L12-L35) renders "ABTalks Hire /
Scout" with two links. It does **not** use `AppHeader`, which is where
`ThemeToggle` lives ([app-header.tsx:155](src/components/shared/app-header.tsx#L155)) —
so the light/dark control and the logo are simply absent on `/hire`. The
component exists and works; it is only not mounted here.

**Login is one door.** `/login` offers Google plus dev credentials, with no
candidate/recruiter split.

---

## 3. Phases

Ordered so that every phase ships independently and nothing later is required
for something earlier to be correct.

### Phase 1 — Recruiter chrome *(no schema)*

Files:
- `src/app/hire/layout.tsx` `[edit]` — logo, wordmark, `ThemeToggle`, nav.
- `src/components/hire/scout-chat.tsx` `[edit]` — answer pills move under the
  assistant bubble.

The reference puts answer pills directly beneath the message that asked the
question, which reads as part of the conversation rather than as a toolbar. Ours
sit in the composer. Move them into the transcript, attached to the last
assistant turn.

Header gains: the ABTalks mark (`/logo.png` or whatever `AppHeader` uses —
**read it, do not invent a path**), the word "ABTalks", a "Hire" eyebrow, and
`<ThemeToggle />`. Keep `New search` and `Browse pool`.

`ThemeToggle` is a Client Component; `HireLayout` is async Server. Importing and
rendering `<ThemeToggle />` from a Server Component is fine — it is a component
reference, not a function prop. Do not pass any handler across the boundary.

### Phase 2 — Anonymity *(no schema)*

Files:
- `src/features/hire/public-id.ts` `[new]` — the one exception to "no new files
  for trivial logic": this identifier is rendered to recruiters, stored in
  requests, and quoted in admin, so it needs exactly one definition.
- `src/components/hire/match-card.tsx` `[edit]`
- `src/app/hire/[requestId]/page.tsx` `[edit]`
- `src/app/talent/members/[id]/page.tsx` `[edit]`
- `src/features/talent-pool/pool.ts` `[edit]`
- `src/components/hire/privacy-notice.tsx` `[new]` — the banner.

Public ID is **derived, not stored** — no migration, and it cannot drift:

```ts
// AB-#### from a stable hash of the internal id. Deterministic, collision-
// tolerant (it is a label, never a lookup key), and reveals nothing about
// the person or their row.
export function candidatePublicId(internalId: string): string {
  let h = 0;
  for (let i = 0; i < internalId.length; i++) {
    h = (h * 31 + internalId.charCodeAt(i)) | 0;
  }
  return `AB-${(Math.abs(h) % 9000) + 1000}`;
}
```

Always resolve back through the internal id server-side. **Never** accept a
public ID from the client as a lookup key.

What a recruiter sees before a request is accepted: public ID, role title,
seniority, city (not full address), years of experience, skills, evidence
scores, availability flags, match rationale. What they do not see: full name,
email, phone, LinkedIn, GitHub, employer.

Add the banner, in the reference's words because they are accurate for us:
*"Names and contact details stay hidden until you place a request. Full details
are shared once our team confirms the engagement."*

⚠️ `/talent/members/[id]` and `/talent/shortlist` are an **existing, working
surface**. Changing them changes what today's recruiters can see. Gate on
`requestAccepted` (Phase 3) and default to hidden — but ship Phase 2 for `/hire`
first and treat `/talent` as its own reviewed step, so a regression there is
never entangled with the new portal.

### Phase 3 — Shortlist → Request → Ticket *(SCHEMA — see §5)*

Files:
- `prisma/schema.prisma` `[edit]`
- `src/app/actions/hire-request-actions.ts` `[new]`
- `src/lib/validations/hire-request.ts` `[new]`
- `src/components/hire/shortlist-drawer.tsx` `[new]`
- `src/app/hire/shortlist/page.tsx` `[new]`
- `src/app/hire/requests/page.tsx` `[new]`
- `src/app/admin/hire-requests/page.tsx` `[new]`
- `src/app/admin/layout.tsx` `[edit]` — nav entries.

```prisma
enum TalentEngagementStatus {
  DRAFT        // in the recruiter's shortlist, not sent
  SUBMITTED    // request placed, waiting on the team
  IN_REVIEW    // team working it
  CONTACT_SHARED
  DECLINED
  CLOSED
}

/// One recruiter's ask about one candidate. Carries the note the recruiter
/// wrote and, once accepted, is what unlocks contact details for that pair.
model TalentEngagementRequest {
  id              String   @id @default(cuid())
  recruiterUserId String
  requestId       String?  // the TalentRequest (requirement) it came from
  programMemberId String?  // exactly one candidate ref is set — see §5 note
  enrollmentId    String?
  hackathonParticipantId String?
  note            String?
  status          TalentEngagementStatus @default(DRAFT)
  submittedAt     DateTime?
  decidedAt       DateTime?
  decidedByAdminId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  recruiter     User           @relation(fields: [recruiterUserId], references: [id], onDelete: Cascade)
  request       TalentRequest? @relation(fields: [requestId], references: [id], onDelete: SetNull)
  programMember ProgramMember? @relation(fields: [programMemberId], references: [id], onDelete: Cascade)

  @@index([recruiterUserId, status])
  @@index([status, submittedAt])
}

/// The thread on a request. Recruiter and admin both post here; this is the
/// "ticket" the recruiter tracks.
model TalentEngagementMessage {
  id        String   @id @default(cuid())
  requestId String
  authorUserId String
  authorRole   String   // "recruiter" | "admin"
  body      String
  createdAt DateTime @default(now())

  request TalentEngagementRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@index([requestId, createdAt])
}
```

Contact release is **derived from status**, never a separate boolean a bug could
leave on: contact is visible iff a `CONTACT_SHARED` request exists for that
`(recruiterUserId, candidate)` pair. One rule, one place —
`src/features/hire/contact-access.ts` `[new]`.

### Phase 4 — Verified recruiter access *(SCHEMA)*

The user's requirement: a recruiter cannot simply register; their credentials
must match a list ABTalks maintains.

```prisma
/// Companies/seats ABTalks has verified out of band. A recruiter account can
/// only be created or approved when its email matches a live entry here.
model VerifiedRecruiterSeat {
  id            String    @id @default(cuid())
  email         String    @unique   // lowercased at write time
  company       String
  contactName   String?
  seatLimit     Int       @default(1)
  active        Boolean   @default(true)
  verifiedAt    DateTime  @default(now())
  verifiedByAdminId String?
  notes         String?
  revokedAt     DateTime?

  @@index([company])
  @@index([active])
}
```

Flow: `/talent/register` looks up the seat by lowercased email. No live seat →
the account is created as `STUDENT` with a clear "your company isn't verified
yet, here's how to get verified" message, **never** as an unapproved recruiter.
A live seat → `RecruiterProfile` created with `approved: true` and the company
copied from the seat, so the admin flip is no longer the gate.

Admin CRUD at `/admin/recruiter-seats` `[new]`.

⚠️ **A candidate must never be able to sign in as a recruiter.** Role comes from
the seat lookup at account creation, never from anything the user submits. Audit
`/talent/register` for any client-supplied role field and delete it.

### Phase 5 — Split entry: For candidates / For recruiters *(no schema)*

Files: `src/components/shared/app-header.tsx` `[edit]`,
`src/app/login/login-client.tsx` `[edit]`, `src/app/login/page.tsx` `[edit]`,
`src/app/(marketing)/...` as applicable.

Top-right menu opens two clear doors, as on revature.com. `/login?as=recruiter`
shows the recruiter copy and routes to `/hire` on success; the default shows the
candidate copy. **The parameter changes copy and post-login destination only** —
it must never influence role or permissions, which come from the DB. State that
explicitly in the code comment so nobody later "optimises" it into an auth
input.

### Phase 6 — Widen the candidate pool *(SCHEMA for the match FK)*

Today only `ProgramMember` is searchable. Add, as separate adapters that each
produce the existing `ScoredCandidate` shape:

- **60-day challenge** — `Enrollment` where `status = COMPLETED` (+ `Certificate`).
- **Claude track** — `Enrollment` where `domain = Domain.CLAUDE`.
- **Hackathon** — `HackathonParticipant` with a graded `HackathonSubmission`.

`src/features/hire/sources/*.ts` `[new]` — one adapter per track, each returning
`{ source, sourceId, fullName, skills, evidence }`. `searchCandidates` unions
them, then the existing `scoreCandidate` runs unchanged so ranking stays one
implementation.

`TalentRequestMatch.programMemberId` is currently a required FK, so persisting a
non-program match needs `source` + nullable per-source FKs (same shape as
Phase 3).

**Consent is the hard filter and it does not exist on the other tracks.**
`ProgramMember.recruiterVisibilityConsentAt` gates the cohort. 60-day, Claude and
hackathon participants never agreed to recruiter visibility. Do **not** infer
consent from having completed something. Either add an equivalent opt-in per
track and default it off, or keep those sources behind a flag until the opt-in
ships. This is a DPDP question, not a product preference.

### Phase 7 — Admin surfaces *(no schema beyond Phase 3)*

- `src/app/admin/layout.tsx` `[edit]` — add **Hire demand** (`/admin/hire-demand`,
  currently linked from nowhere) and **Hire requests**.
- `/admin/hire-requests` — queue of `SUBMITTED`, with candidate public ID,
  recruiter, company, note, and actions: share contact / decline / reply.
- `/admin/program/recruiters` `[edit]` — currently lists only `approved: false`.
  Add the approved list and a revoke action.

### Phase 8 — Production-only matching script

`.env.local` points at a database where the other tracks have no rows to match,
so cross-track matching cannot be validated locally. Ship a **read-only**
verification script instead of guessing:

`scripts/verify-hire-pool.ts` `[new]` — counts, per track, how many candidates
are eligible and how many would pass the consent filter, and prints a table. No
writes, no migrations. Run it against production **after** deploy to confirm the
pool is what we expect before enabling the sources.

Add to `package.json`: `"verify:hire-pool": "tsx scripts/verify-hire-pool.ts"`.

---

## 4. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `hire/layout.tsx` | Server (async) | renders `<ThemeToggle />` (Client) — component reference only, no props |
| `ThemeToggle` | Client | already exists, unchanged |
| `scout-chat.tsx` | Client | pills move inside the transcript |
| `match-card.tsx` | Client | takes plain serialisable props only |
| `privacy-notice.tsx` | Server | static copy |
| `shortlist-drawer.tsx` | Client | calls Server Actions |
| `admin/hire-requests/page.tsx` | Server | table + Client action buttons |
| `contact-access.ts` | Server-only | `import "server-only"` |

No functions, icons, dates-as-objects or class instances cross a
Server→Client boundary. Pass ISO strings and let the client format.

---

## 5. DB safety

**Phases 3, 4 and 6 change the schema. Do not run any migration against the
current `DATABASE_URL`.**

`.env.local` `DATABASE_URL` and `DIRECT_URL` both point at the **shared Neon
instance that production uses**. `npx prisma migrate dev` there would alter
production tables. Required sequence:

1. `git commit` a checkpoint; record the hash in the PR.
2. Create a Neon **branch** from production.
3. Point **both** `DATABASE_URL` **and** `DIRECT_URL` at that branch. Setting
   only one silently sends migrations to production.
4. `npx prisma migrate dev --name <phase>` against the branch.
5. `npx prisma generate`, run the app against the branch, verify.
6. Production migration is a separate, reviewed deploy step.

Additional constraint: `npm run build` on this branch is
`prisma generate && next build` — no `migrate deploy` — so building is safe.
**If a future change adds `migrate deploy` to `build`, every Vercel build
migrates production.** Do not add it.

One modelling note for Phase 3/6: three nullable candidate FKs with "exactly one
set" is not expressible as a Prisma constraint. Enforce it in the Zod schema at
the action boundary *and* add a Postgres `CHECK` in the migration SQL, because
the app is not the only thing that will ever write these rows.

---

## 6. Guardrails for Cursor (DO NOT)

- **DO NOT** run `prisma migrate` against `.env.local` as-is. See §5.
- **DO NOT** add `prisma migrate deploy` to the `build` script.
- **DO NOT** let `?as=recruiter`, a form field, or any client input decide a
  role. Role is read from the DB after the seat lookup.
- **DO NOT** treat "completed a challenge" as consent to recruiter visibility.
- **DO NOT** accept a candidate public ID as a lookup key from the client.
- **DO NOT** add `requireRole`/`requireAdmin` to public surfaces — `/login`,
  logout, the Auth.js handler, `/talent/register`.
- **DO NOT** import `@/lib/*` into `middleware.ts` or `auth.config.ts`.
- **DO NOT** change `/talent/members/[id]` in the same commit as the `/hire`
  work — it is a live surface with its own blast radius.
- **DO NOT** create new files beyond those listed here.
- **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>` — put
  `buttonVariants` on the `<Link>`.
- **DO NOT** return full Prisma records; every query uses `select`.
- **DO NOT** widen `select` on candidate queries "for convenience" — every field
  added there is a field a recruiter may end up seeing.

---

## 7. Verification

Per phase, not once at the end.

**Phase 1** — `/hire` shows the logo, "ABTalks", and a working theme toggle;
switching to light and reloading keeps the choice. Pills render under the last
assistant message and still send the right value. No horizontal scroll at 390px.

**Phase 2** — as an approved recruiter, `/hire/[requestId]` shows `AB-####` and
no name, email, phone, LinkedIn, GitHub or employer. Confirm by reading the
response body, not the rendered page: `curl` the route with a session cookie and
grep for a seeded candidate's email — it must not appear.

**Phase 3** — add two candidates to the shortlist, write notes, submit; one
`TalentEngagementRequest` per candidate at `SUBMITTED`; both visible at
`/admin/hire-requests`; replying creates a `TalentEngagementMessage` the
recruiter sees at `/hire/requests`.

**Phase 4** — registering with an email that has no seat produces a `STUDENT`
account and a clear message, and `/hire` still redirects it away. With a live
seat, the recruiter lands on `/hire` without an admin touching anything. Revoke
the seat → existing session loses access on next request.

**Phase 6** — `npm run verify:hire-pool` prints per-track counts; no source is
enabled whose consent opt-in has not shipped.

**Always** — `npx tsc --noEmit` clean, `npm run build` green (67/67 pages at time
of writing), `npx tsx src/features/hire/score-candidate.test.ts` 7/7.

Log one dated line under `## Pending reconcile` in `docs/CHANGELOG.md`.

---

## 8. Deliberately out of scope

- Real-time chat on tickets — email notification plus the thread is enough.
- Recruiter billing/seat metering beyond `seatLimit` as a number.
- Replacing `/talent`. It keeps working; Phase 2 only tightens what it exposes.
- Candidate-side availability UI — that is 062 §5.1, a parallel developer's task,
  and every match reads `availabilityUnknown` until it ships.

---

## 9. Things worth doing that nobody asked for

1. **Access log.** Under DPDP a candidate can ask who viewed their profile. Log
   `(recruiterUserId, candidateRef, viewedAt)` on every candidate view. Cheap
   now, near-impossible to backfill later.
2. **Privacy policy.** Phases 3–4 introduce new categories — recruiter notes
   about a candidate, and contact release. Both need disclosing and a
   `PRIVACY_VERSION` bump. 062 §5.1's `CandidateAvailability` disclosure is
   *still outstanding* and should land with it.
3. **Rate limit on Scout.** `sendScoutMessageAction` calls a paid API with no
   throttle. One loop empties the quota for every recruiter. Per-user cap.
4. **`hireProgress()` is now dead** — the progress banner that used it was
   removed. Delete it with the next change to `src/lib/validations/hire.ts`.
5. **`src/components/hire/spec-summary.tsx` is dead** — imported nowhere.
6. **Groq free tier is 8000 TPM.** Chip taps cost nothing, but a typed message
   is ~1100 tokens, so ~7 typed messages/minute across *all* recruiters. Verified
   by hitting the limit during testing. Upgrade before more than one recruiter
   uses this concurrently.

---

## 10. Commit messages

- `feat(hire): recruiter chrome — logo, wordmark, theme toggle, inline pills`
- `feat(hire): anonymise candidates until a request is accepted`
- `feat(hire): shortlist, engagement requests and ticket threads`
- `feat(auth): verified recruiter seats gate recruiter access`
- `feat(hire): candidate sources for 60-day, Claude and hackathon tracks`
- `feat(admin): hire requests queue and demand board navigation`
