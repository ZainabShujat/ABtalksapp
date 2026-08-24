# Plan 067 — Recruiter applications in admin, and a real recruiter account menu

## 1. Goal

A recruiter who registers must show up immediately in admin, where a human
can approve or reject them. After they are in, the hire header must be an
account menu (name, cart, requests, sign out) — not a lone logout arrow.

## 2. Current behaviour

Registration already writes the right rows: `User` (role `RECRUITER`) +
`RecruiterProfile` with `approved: false` (or `true` if a live seat exists).
That row is the application.

The only inbox for those rows is `/admin/program/recruiters`, buried under
the Program sub-nav. The admin sidebar has **Hire Requests** (intro tickets)
and **Recruiter Seats** (the pre-verify list) but not applications. Overview
does not mention them. So a new registration looks like it went nowhere.

The hire header's last control is a `LogOut` icon that signs out immediately.
Cart and Requests exist as separate links; the recruiter's name is never shown.

## 3. Files to touch

- `[new] src/app/admin/recruiters/page.tsx` — first-class applications inbox
- `[new] src/features/hire/recruiter-account.ts` — server snapshot for the menu
- `[new] src/components/hire/recruiter-account-menu.tsx` — client dropdown
- `[edit] src/features/talent-pool/recruiter-registration.ts` — shared pending list
- `[edit] src/app/admin/layout.tsx` — sidebar item + pending count
- `[edit] src/components/admin/admin-sidebar.tsx` — `recruiters` icon
- `[edit] src/components/admin/admin-mobile-nav.tsx` — same icon
- `[edit] src/features/admin/get-overview-stats.ts` — pending applications
- `[edit] src/app/admin/page.tsx` — overview card
- `[edit] src/app/admin/recruiter-seats/page.tsx` — banner if applications wait
- `[edit] src/app/actions/admin-recruiter-actions.ts` — seat on approve; `/hire` email
- `[edit] src/app/admin/program/recruiters/page.tsx` — reuse the shared list
- `[edit] src/app/hire/layout.tsx` — replace logout arrow with the menu
- `[edit] src/app/talent/layout.tsx` — pass the snapshot when approved
- `[edit] src/components/talent/talent-shell.tsx` — same menu on cart/profile

## 4. Server vs Client

- New admin page: Server. Panel stays the existing client `AdminRecruitersPanel`.
- `recruiter-account.ts`: server-only. Plain serialisable snapshot only.
- `recruiter-account-menu.tsx`: Client. Receives the snapshot as props. No
  functions / icons / class instances across the boundary.

## 5. Steps

1. Extract `listPendingRecruiterApplications()` (the query already on
   `/admin/program/recruiters`).
2. Add `/admin/recruiters`: pending list (approve/reject) + a short approved
   list so the page is not empty after an approve.
3. Sidebar item **Recruiters**, next to Recruiter Seats, with the pending
   count in the label when > 0. Same icon on mobile nav.
4. Overview card listing the waiting applications, linking to `/admin/recruiters`.
5. Recruiter Seats page: one-line banner if any applications are waiting.
6. On approve: upsert a `VerifiedRecruiterSeat` (do not overwrite an existing
   seat), point the email at `/hire` not the removed `/talent` pool, revalidate
   `/admin/recruiters`, `/admin/recruiter-seats`, `/admin`.
7. `getRecruiterAccountSnapshot(userId)`: name, company, email, up to 5 cart
   rows (public `AB-####` only), up to 5 requests, plus counts.
8. Account menu: avatar + name trigger. Body = identity, cart rows, request
   rows, View all links, Sign out. Keep existing Cart / Requests header links.
9. Wire the menu into hire layout and talent shell (approved only).

## 6. Guardrails for Cursor (DO NOT)

- DO NOT change OTP, seat-gate at register, or `requireRecruiter`.
- DO NOT show candidate `fullName` in the account menu. Public id only, same
  rule as the rest of hire.
- DO NOT import Prisma or `@/lib/*` into middleware / `auth.config.ts`.
- DO NOT delete `/admin/program/recruiters` — Program tab stays working.
- DO NOT use `<Button asChild>` or `<Button render={<Link>}>`.
- DO NOT add a new table or migration.
- DO NOT log OTP codes or emails beyond the existing logger.

## 7. DB safety

No schema change. Approve upserts a seat row (additive). Reject is unchanged
(deletes the unapproved profile, does not touch seats).

## 8. Verification

1. Pending row `bhaiyashanky07@gmail.com` appears on `/admin/recruiters` and
   on the admin overview card.
2. `/admin/program/recruiters` still lists the same pending rows.
3. Approve creates/keeps a seat, recruiter can sign in to `/hire`.
4. Hire header: name menu opens, shows cart rows and requests, Sign out works.
5. Candidate login / Google flow unchanged.
6. `npx tsc --noEmit` clean.

## 9. Commit message

`feat(hire): surface recruiter applications in admin and add an account menu`
