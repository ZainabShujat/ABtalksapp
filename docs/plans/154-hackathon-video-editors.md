# 154 — VideoThon (Video Editors hackathon), replacing /hackathon in place

**Branch:** `feat/hackathon-video-editors` (off updated `master @ bb258cbf`).
**Working name:** VideoThon (subject to change — treat every `"VideoThon"` string as swap-friendly, one source of truth).
**Replaces:** the postponed code hackathon at `/hackathon`. Same URL, new event.

## Ownership pre-flight

- **Sohail:** one small additive migration (new `HackathonVideoRegistration` model — see §3). No changes to existing tables. Flagged for post-merge review under Manuvrtti's explicit direction.
- **Shallika:** the landing page brief is "super creative, cinematic" — new visual language that will want her QA pass.
- **Manuvrtti's owned modules:** none touched (this isn't Jobs/Applications/Notifications/UTM).

## 1. Goal

Replace `/hackathon`'s current Coming Soon card with the VideoThon landing, dashboard and submission. Individual entries only. Google Drive / Behance / YouTube / any-link submission. Registration flow **bypasses the standard `/register` candidate-profile funnel** — video-track signups do not need a resume, college or graduation year.

## 2. Confirmed flow (Guest, never seen ABTalks)

1. Lands on `/hackathon` → clicks **Register** in the header or hero.
2. Client-side calls `signIn("google", { callbackUrl: "/hackathon" })`. Standard Google consent.
3. On return, NextAuth PrismaAdapter creates a fresh `User` row — **this is when the platform's "total signups" count increments** (matches every other track). No candidate profile is created; the video track has no use for one.
4. Landing reloads with a session but **no `HackathonVideoRegistration` row**. A dialog opens automatically with the hackathon-specific form. (The dialog is dismissable; if dismissed, the header CTA keeps saying "Complete registration" until the row exists.)
5. Form submit → row created → dialog closes → client navigates to `/hackathon/dashboard`.
6. Dashboard shows the problem statement / theme, mission timer, and the submission surface (single Google Drive-style URL).

## 2b. Confirmed flow (Existing ABTalks user)

Identical from step 4 onward. Steps 2–3 are silent (already-logged-in) or one-click (logged out but existing email). The `User` row is reused; no duplicate. **Existing users are NOT bounced into `/register` or any candidate-profile completion** — the video-track landing checks for `HackathonVideoRegistration`, not for a completed candidate profile. This is a small, isolated deviation from the code hackathon's `registrationRedirect` pattern.

## 3. Files to touch

### Schema (new — Sohail-owned area)

- `prisma/schema.prisma` **[edit]** — add ONE new model, additive only, no changes to existing tables:
  ```prisma
  enum HackathonVideoEmployment {
    LEARNER
    WORKING
  }

  /// One row per user per VideoThon event. Independent from HackathonParticipant
  /// (which is coder-shaped: college, graduationYear). Reads via
  /// src/features/hackathon-video/*, admin export as a follow-up ticket.
  model HackathonVideoRegistration {
    id                 String                   @id @default(cuid())
    eventId            String
    userId             String
    fullName           String
    email              String
    phoneCountryCode   String   // e.g. "+91", "+1"
    phoneNumber        String   // digits only, no formatting
    city               String   // free text; India-focused but not restricted
    employment         HackathonVideoEmployment
    currentCtc         String?  // free text: number in INR/year, or "NA"; required when employment=WORKING
    portfolioUrl       String   // any https:// URL (Drive, Behance, YouTube, personal site)
    sourceSlug         String?  // reuses SRC_COOKIE_NAME attribution
    createdAt          DateTime @default(now())
    updatedAt          DateTime @updatedAt

    user User @relation("HackathonVideoRegistrant", fields: [userId], references: [id], onDelete: Cascade)

    @@unique([eventId, userId])
    @@index([eventId, createdAt(sort: Desc)])
    @@index([userId])
    @@index([sourceSlug])
  }
  ```
  Plus one line on `User`:
  ```prisma
  hackathonVideoRegistrations HackathonVideoRegistration[] @relation("HackathonVideoRegistrant")
  ```

- Migration file (new): `prisma/migrations/2026XXXX_hackathon_video_registration/migration.sql`.

### Config

- `src/features/hackathon-video/config.ts` **[new]** — the `VIDEOTHON` config: `eventId`, name, tagline, kickoff/deadline/registrationClosesUtc, WhatsApp/Discord links, sponsor slot. **Six TODO(organizer) values live here** (see §5).

### Landing / dashboard / submission (in-place at /hackathon)

- `src/app/hackathon/page.tsx` **[edit]** — replaces today's Coming Soon body with the new VideoThon landing (Server Component). Reads session + `getMyVideoRegistration(userId)`. Header CTA logic:
  - Unauth → **Register** button that triggers `signIn("google")`.
  - Auth without registration row → **Complete registration** button that opens the form dialog.
  - Auth with registration row → **Go to dashboard** link.
- `src/app/hackathon/(app)/dashboard/page.tsx` **[edit]** — replaces the Coming Soon dashboard with the VideoThon dashboard (server-rendered). Does NOT call `registrationRedirect`. Bounces to `/hackathon` if no video registration row.
- `src/app/hackathon/(app)/submission/page.tsx` **[edit]** — replaces today's redirect with the actual submission surface for the video track.
- `src/app/hackathon/_styles/hackathon-v2.css` — kept (still used by the shell), extended by a new stylesheet below.

### Video-track components (all new)

- `src/components/hackathon-video/landing/hero.tsx` — the cinematic hero (see §5 for the visual brief).
- `src/components/hackathon-video/landing/reel-timeline.tsx` — the event timeline styled as a film-strip / scrubber.
- `src/components/hackathon-video/landing/rules-slate.tsx` — rules laid out as clapperboard slates.
- `src/components/hackathon-video/landing/prizes-marquee.tsx` — moving-marquee prize rail (subtle, GPU-cheap).
- `src/components/hackathon-video/landing/faq-tape.tsx` — FAQ as accordion; tape/film styling.
- `src/components/hackathon-video/register-dialog-trigger.tsx` — orchestrates Google signIn + form dialog.
- `src/components/hackathon-video/registration-form.tsx` — the hackathon-specific form (client). Fields:
  - `fullName` (prefilled from session, editable)
  - `email` (prefilled from session, read-only)
  - `phoneCountryCode` + `phoneNumber` — international phone input, all country codes accepted (see §6)
  - `city` — free text
  - `employment` — radio: `LEARNER` / `WORKING`
  - `currentCtc` — text input, placeholder `e.g. 800000 or NA`; shown always; required when `employment === WORKING` but accepts the literal string `NA`
  - `portfolioUrl` — required; any `https://` URL (validated shape only, no host lock)
  - Legal consent + newsletter opt-in reused from `LegalConsentFields`.
- `src/components/hackathon-video/registration-success.tsx` — success state inside the dialog.
- `src/components/hackathon-video/dashboard/mission-panel.tsx` — theme / brief display.
- `src/components/hackathon-video/dashboard/submission-panel.tsx` — single-link submission form (Drive / Behance / YouTube / any URL).
- `src/components/hackathon-video/dashboard/countdown.tsx` — mission timer, reuses existing `MissionTimer` behavior with new styling.
- `src/components/hackathon-video/landing.css` + `src/components/hackathon-video/dashboard.css` — scoped styles. Loaded by the page files, not by the shared shell.

### Server actions + repositories

- `src/features/hackathon-video/get-my-registration.ts` **[new]** — `getMyVideoRegistration(userId)`.
- `src/features/hackathon-video/registration-count.ts` **[new]** — helper for admin surfaces.
- `src/app/actions/hackathon-video-registration-actions.ts` **[new]**:
  - `submitVideoRegistrationAction(input)` — auth, Zod parse, dedupe by `(eventId, userId)`, insert row, send welcome email, record legal consent, drop `SRC_COOKIE_NAME`.
- `src/app/actions/hackathon-video-submission-actions.ts` **[new]**:
  - `saveVideoSubmissionAction(input)` — auth, participant lookup, window gate, upsert into `HackathonSubmission` reusing `repoUrl` column for the video URL (avoids a second migration; documented in a code comment).
- `src/lib/validations/hackathon-video.ts` **[new]** — Zod schemas per the fields above.
- `src/lib/hackathon-video-email.ts` **[new]** — `sendVideoWelcomeEmail(name, email)`. Reuses existing Brevo transport.

### Registration counting (§6 answer: Google callback)

No new work needed. The platform's "total signups" numbers read `User` row counts (see `src/features/admin/get-overview-stats.ts` etc.); those increment automatically at the NextAuth callback, before the video-specific form is even opened. That matches the answer you gave (`count on Google callback`).

### Explicitly NOT touched

- `middleware.ts`, `auth.ts`, `auth.config.ts` — no changes.
- Existing `HackathonTeam` / `HackathonParticipant` / `HackathonSubmission` / `HackathonProblem` / `HackathonRemoval` tables and their code paths (code hackathon at ViCodathon 2.0). Rows stay in the DB under `eventId = "vicodathon-2-2026"`. Admin surfaces still read them.
- The code hackathon's components in `src/components/hackathon/**` and `src/components/hackathon-v2/**` — retained so a future ViCodathon 3 can restore them by reverting the three page files.
- `/register`, the candidate profile flow, the `registrationRedirect` gate.

## 4. Server vs Client

- All three `app/hackathon/**` page files — Server Components. They read the session and the video-registration row, hand plain-JSON props to the client bits below.
- `register-dialog-trigger.tsx`, `registration-form.tsx`, `submission-panel.tsx`, `countdown.tsx` — Client Components (need react state, `signIn`, form handling).
- Everything else in `hackathon-video/landing/**` — Server Components (static markup with CSS animations, no state).
- Server → Client prop passing: only strings / numbers / booleans / plain arrays. Config is JSON-serializable.

## 5. Landing visual brief

**One line:** it should look like a Criterion Collection page, not a coding hackathon.

**Direction:** cinematic, dark by default (light-mode variant later), typographically bold, motion where it earns its keep. Video editors judge products visually — the landing signals "we get you" or it doesn't.

**Concrete moves (subject to iteration):**

- **Hero**: full-bleed dark canvas. Big serif or condensed sans title ("VideoThon"). Working tagline: *"48 hours. One brief. Cut something worth watching."* Subtle animated color-grading LUT wash behind the title (CSS gradient shift, no video assets). Register button gets a "record" red dot pulse — subtle, not epileptic.
- **Sprocket rail**: thin film-strip motif down one edge with visible sprocket holes; entirely CSS. Purely decorative, respects `prefers-reduced-motion`.
- **Timeline as timeline**: the event's Kickoff → Midpoint → Deadline → Results is drawn as a **video editing timeline** with a scrubber head — a horizontal track with labeled cuts. The scrubber slowly moves in real time (progresses toward the deadline as a live clock).
- **Rules as clapperboard slates**: four clapperboard-styled cards, each with a scene number, take number, and the rule copy. Hover tilts the slate ~2°.
- **Prizes as a running marquee**: horizontal marquee of prize tier names (subtle, one loop per 20s).
- **FAQ styled as a tape/film reel**: accordion whose caret is a play triangle.
- **Type**: pair a strong display serif (e.g. Fraunces or system serif) with the existing brand sans for body. All existing shadcn tokens honored.
- **Motion budget**: everything CSS. No video files in the hero (they'd tank LCP). Any GIF-adjacent effects clamped by `prefers-reduced-motion`. Bundle target for the landing route: no new heavy client deps.
- **Dark by default** but the shell theme is currently `theme-abtalks-light` — so we'll add a `hk-video theme-hk-video-dark` wrapper scoped to just the landing content, leaving the sidebar/header on the app's light theme. This avoids a global theme flip that would ripple into `/jobs`, `/dashboard`, etc.

Standing memory: [[feedback-effect-intensity]] normally says "light, border-only, start subtle". Overriding for this specific landing per your "super crazy creative" instruction — but I'll still lean **sophisticated cinematic over flashy chaos**. The form and dashboard stay understated and readable.

## 6. Confirmed answers (from you)

| # | Decision | Locked value |
|---|---|---|
| 1 | Form location | Dialog on landing |
| 2 | Phone | International — country-code picker + national number, all countries accepted |
| 3 | City | Free text |
| 4 | CTC | Text input, placeholder `e.g. 800000 or NA` — accepts number or literal `NA`, required when Working |
| 5 | Portfolio link | Required, any `https://` URL (Drive / Behance / YouTube / anything), no host lock |
| 6 | Registration count | On Google callback (User row created) |
| 7 | Working name | `VideoThon` |

## 7. Still TODO(organizer) — needed before launch, safe to scaffold with placeholders

1. Final event name (if not VideoThon)
2. `eventId` slug (I'll ship with `videothon-1` if not specified)
3. Kickoff / deadline / registration-close UTC instants
4. WhatsApp group link (Discord too if kept)
5. Sponsor: yes / who / details
6. Theme(s) / brief(s): announced on WhatsApp, or seeded in DB — I'll ship with "announced on WhatsApp" scaffold (form has no brief-picker)

I will scaffold with placeholders for all six and mark them clearly, so the whole flow ships end-to-end and copy fills in later.

## 8. Guardrails for Cursor (DO NOT)

- **DO NOT** add columns to `HackathonSubmission`, `HackathonTeam`, `HackathonParticipant`. Reuse `HackathonSubmission.repoUrl` for the video URL; document in a code comment.
- **DO NOT** touch `middleware.ts`, `auth.ts`, `auth.config.ts`, or anything under `@/lib/*` reachable by middleware.
- **DO NOT** call `registrationRedirect` from any `app/hackathon/**` file — the video track intentionally skips the candidate-profile gate.
- **DO NOT** delete the code hackathon's components — only the three top-level page files change; components stay for a future revert.
- **DO NOT** `<Button asChild>` or `render={<Link>}` — use `buttonVariants` on `<Link>`.
- **DO NOT** log via `console.error` — use `lib/logger.ts`.
- **DO NOT** call `prisma.studentProfile` or `prisma.programMember` (078 rule).
- **DO NOT** widen the portfolio-URL validator beyond "valid `https://` URL". If future host restrictions are needed, they're a follow-up.
- **DO NOT** introduce a global dark-theme flip — dark styling is scoped to the landing content wrapper.

## 9. DB safety

- Neon branch snapshot before applying the migration.
- Migration is additive: one new table + one new enum + one FK. Zero drops, zero renames, zero backfills. Cannot break existing reads or writes.
- Migration file placed under `prisma/migrations/2026XXXX_hackathon_video_registration/`.
- `npx prisma migrate deploy` applies it in Vercel's `build:deploy` script.
- Rollback plan: `DROP TABLE "HackathonVideoRegistration"; DROP TYPE "HackathonVideoEmployment";` (no other tables depend on it).

## 10. Verification

- `npx tsc --noEmit` clean.
- `npx next build` clean.
- Local smoke:
  1. Log out. `/hackathon` renders the new dark landing with all sections and the disabled/unauth Register CTA.
  2. Click Register → Google consent → returns to `/hackathon` with dialog auto-opened.
  3. Submit form with valid values → dialog shows success → redirect to `/hackathon/dashboard`.
  4. Reload `/hackathon` → CTA now says "Go to dashboard".
  5. `/hackathon/dashboard` → renders the video mission + submission panel.
  6. Paste a Drive / Behance / YouTube URL into submission → saves.
  7. Attempt `submitVideoRegistrationAction` a second time → server rejects with "already registered".
  8. Admin overview KPI for total signups increases by exactly one after step 2 (User row created on Google callback), regardless of whether the form was completed.
- Existing `/hackathon/dashboard` request as an unregistered logged-in user → bounced to `/hackathon` (not `/register`).
- ViCodathon 2.0 admin panel still renders its existing rows unchanged.

## 11. Commit plan

- `feat(hackathon): plan 154 — VideoThon replacing /hackathon` (this file)
- `feat(hackathon): schema — HackathonVideoRegistration model + migration`
- `feat(hackathon): VIDEOTHON config + registration form + Server Action`
- `feat(hackathon): cinematic landing at /hackathon`
- `feat(hackathon): dashboard + submission surface for /hackathon`
- `chore(hackathon): admin export follow-up ticket note` (if not in scope this pass)

Each commit is independent and buildable. Standing memory: no Co-Authored-By, no Generated-with footer.
