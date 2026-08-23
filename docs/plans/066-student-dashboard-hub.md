# 066 — Student Dashboard hub (`/dashboard`) + per-track pages

## 1. Goal

Turn `/dashboard` into the **post-sign-in home for every signed-in user** — a
monochrome, sidebar-shelled hub that shows who you are, your activity heatmap,
your streak, and routes you onward (tracks, roadmaps, events, workshops,
marketplace, jobs). Everything that is *per-challenge work* (Today's Task, quiz,
stat cards, recent activity, pre-start countdown, ended screen) moves verbatim to
new per-track pages at `/claude`, `/ai`, `/se`, `/ds`.

The hub is a **navigation surface only** — it performs no challenge mutations and
mounts no banners or modals.

---

## 2. Current behavior

### `/dashboard` today (`src/app/dashboard/page.tsx`, 724 lines)
One page carrying three separate responsibilities:

1. **Gatekeeping.** `hasUser: false` → force sign-out; **no `StudentProfile` or no
   enrollment → `hackathonRedirectForProfilelessUser()` else `redirect("/register")`**
   (lines 147–155). This is why workshop-only / hackathon-only users never see a
   dashboard.
2. **Alternate full screens.** `EnrollmentEndedScreen` for `ABANDONED`
   (lines 197–255) and `PreStartDashboard` for a pre-start CLAUDE cohort
   (lines 260–308) — each re-renders its own `AppHeader` + banner stack.
3. **The dashboard body** (lines 330–723): 60-cell heatmap card, Today's Task
   card, four stat cards (day / streak / days completed / referrals), quiz
   available + attempted + history cards, recent activity list, `ClaudeFAQ`.

Mounted around it: `ConsentRefreshBanner`, `QuizUnlockBanner`,
`ClaudeEnrollmentBanner`, `CampusAmbassadorBanner`, `PhoneVerifyNudge`,
`ClaudeChallengeModal`, `HackathonPromoModal`, `ClaudeDay0SharePrompt`,
`PastMissedChallengeToast`, `DashboardWalkthrough`. Leaderboard is commented out.

### Chrome
- `AppHeader` (`src/components/shared/app-header.tsx`) — client; logo left, then
  challenge switcher / Jobs / Admin pill / SynergyChip / ThemeToggle / avatar
  dropdown / `MobileSidebar`.
- `AppFooter` (`src/components/shared/app-footer.tsx`) — client, rendered in
  `src/app/layout.tsx:57`, **outside** `MainShell`. Already returns `null` on
  `/ai-workshop` and a minimal strip on program/talent/hackathon/cohort routes.
- `BottomNav` (`src/components/shared/bottom-nav.tsx`) — client, fixed mobile tab
  bar (Home / Jobs / Rewards / Explore / Profile). Its early-return list excludes
  `/`, workshop, hackathon, login, register, program, talent, verify, etc.
- `MainShell` (`src/components/shared/main-shell.tsx`) — adds `pb-16 md:pb-0`
  everywhere except hackathon, to clear the bottom nav.

### Heatmap (the important one)
`getHeatmapData()` (`src/features/dashboard/get-heatmap-data.ts`) returns exactly
**60 cells keyed by challenge `dayNumber`, for ONE enrollment**, with five
statuses (`on_time` / `late` / `future` / `missed` / `rejected`). The cell date is
*derived from the day number* via `getIstDateKeyForChallengeDay`, not from
`submittedAt`. `Submission` is `@@unique([enrollmentId, dayNumber])`, so a single
enrollment can never produce two rows for one day.

**It therefore cannot express "how many submissions happened on a calendar date".**
Counts >1 per date are only reachable by (a) summing across a user's enrollments,
and (b) backfilled days — the 5-day relaxation window lets someone submit days
12, 13 and 14 on the same calendar date, and `submittedAt` records the real
moment. A new, calendar-based data function is required. `getHeatmapData` stays
untouched — the track page still uses it.

### Enrollment / routing facts the plan depends on
- `getUserActiveEnrollments(userId)` — `ACTIVE` only, returns
  `{ id, domain, challengeTitle, daysCompleted, currentStreak }`.
- `resolveDashboardEnrollment(userId, enrollmentId?, profileDomain)` — cached,
  picks the `?challenge=` enrollment if it belongs to the user and is ACTIVE,
  else the oldest ACTIVE, else profile-domain, else any.
- **Multi-domain enrollment does not exist.** `register/page.tsx:41-49` redirects
  to `/dashboard` if a profile + enrollment already exist. Only CLAUDE has an
  add-on path (`createClaudeEnrollment`). The Roadmaps section in this plan is
  **display + link only** — it must not attempt a second core enrollment. That
  rule is a separate plan.
- `resolveProgramMemberForUser()` — `src/lib/program-auth.ts:58`.
- `isUserRegistered()` — `src/features/hackathon/registration-status.ts:4`.
- `EVENTS` — `src/components/workshop/events-data.ts`, each entry carries
  `Icon: LucideIcon`. **The file's own doc comment says import it only from
  Client Components** — a component reference cannot cross Server→Client.
- Testimonial copy lives in a module-level `TESTIMONIALS` array inside
  `src/components/landing/testimonials-carousel.tsx` (currently not exported).
- `IST` is exported from `src/lib/date-utils.ts:178`.
- Post-sign-in destination is already `/dashboard` (`login/page.tsx:41`,
  `redirectTo = from ?? "/dashboard"`), handed to `<LoginClient>`. **No
  middleware change is needed for the redirect itself** — only the `/dashboard`
  profile gate has to stop diverting.

---

## 3. Decisions already made (do not re-litigate)

| Question | Decision |
|---|---|
| Multi-domain enrollment (AI + DS + SE at once) | **Out of scope.** Roadmap cards render Join/Continue state and link to existing flows only. Separate plan. |
| Route | New page **is** `/dashboard`. Every signed-in user lands here. |
| Per-track detail pages | New: `/claude`, `/ai`, `/se`, `/ds` — **one shared component, four thin routes.** |
| Day / submission pages | **Unchanged.** `/challenge/today` and `/challenge/[day]?challenge=<id>` stay exactly as they are. Do not touch the submission flow. |
| Heatmap activity source | `Submission` rows across **all** of the user's enrollments, bucketed by IST calendar date of `submittedAt`. Program / quiz / hackathon activity excluded. |
| Heatmap colour | Green (GitHub scale) — the single accent on an otherwise monochrome page. |
| Page theme | **Forced light, black & white.** No `dark:` variants, no semantic theme tokens in new hub components. |
| Streak widget | **Day** streaks from existing `Enrollment.currentStreak` / `longestStreak`. No new week-streak concept. Mockup layout, day labels. |
| Header centre links | **In-page anchors** — `#events`, `#faq`, `#testimonials`. |
| Header right | **Admin button only**, and only when `session.user.isAdmin`. Nothing for non-admins. No avatar, no theme toggle, no synergy chip. |
| Sign out | **Sidebar footer** — avatar + name + email + Sign out. |
| Banners / modals / walkthrough on the hub | **None.** Not mounted. Components are left in the repo for a later plan; delete nothing. |
| Today's Task / quiz / stats / recent activity | Move to the track page **with identical functionality**. |
| No-profile / no-enrollment users | See the full hub with empty-state cards. No `/register` bounce from `/dashboard`. |
| Mobile bottom nav on `/dashboard` | Hidden. Hamburger sidebar only. Unchanged on every other route. |
| Content for events / testimonials / FAQ | Reuse existing sources; FAQ copy in a new constants file. No DB, no admin UI. |

### Two things flagged, decided, and worth stating out loud
1. **`ConsentRefreshBanner` leaves the hub.** It moves to the track page with the
   rest of the body. A user who only ever visits `/dashboard` will not be
   prompted to re-consent. This is accepted for now — re-mounting the compliance
   banners on the hub is explicitly deferred to a later plan.
2. **`/ai` as a `startsWith` prefix would protect `/ai-workshop`,
   `/ai-cohort-register` and `/ai-talent-hunt`; `/claude` would protect
   `/claude-signup`.** All four are public today. The middleware change **must**
   use exact matching. See Step 9 — this is the single highest-risk edit in the plan.

---

## 4. Files to touch

### New — hub data
| Path | | Note |
|---|---|---|
| `src/features/dashboard/get-activity-heatmap.ts` | `[new]` | Calendar-date submission counts across all enrollments + relative intensity levels + derived streak stats. |
| `src/features/dashboard/get-hub-data.ts` | `[new]` | One aggregator for the hub: profile-or-null, enrollments, program membership, hackathon flag, heatmap. |

### New — hub components (`src/components/dashboard-hub/`)
| Path | | Server/Client | Note |
|---|---|---|---|
| `dashboard-shell.tsx` | `[new]` | **Client** | Grid: fixed sidebar + scrollable main. Owns mobile hamburger open state. |
| `dashboard-sidebar.tsx` | `[new]` | **Client** | Six nav links + user footer + sign-out. `usePathname` for active state. |
| `dashboard-header.tsx` | `[new]` | **Client** | Logo / anchor links / Admin pill / hamburger button. |
| `hero-greeting.tsx` | `[new]` | Server | "Good Morning, {firstName}" + subline. |
| `streak-card.tsx` | `[new]` | Server | Ring + 7-day tick strip + stats list. |
| `activity-heatmap.tsx` | `[new]` | **Client** | Week-column grid + hover tooltip + legend. |
| `continue-journey.tsx` | `[new]` | Server | Active enrollments → progress + "Continue" link to the track page. Empty state when none. |
| `other-challenges.tsx` | `[new]` | Server | AI Cohort + Claude cards, only when not already in them. |
| `roadmaps.tsx` | `[new]` | Server | AI / DS / SE cards, Continue vs Join. **Display + link only.** |
| `events-section.tsx` | `[new]` | **Client** | Upcoming + past events from `EVENTS` (carries Lucide icons → must be client). |
| `testimonials-section.tsx` | `[new]` | Server | Cards + existing `TestimonialsScroller`. |
| `faq-section.tsx` | `[new]` | Server | Wraps existing `FaqAccordion`. |
| `dashboard-footer.tsx` | `[new]` | Server | Page-local monochrome footer (global `AppFooter` is suppressed here). |
| `faq-content.ts` | `[new]` | — | `DASHBOARD_FAQ: { q, a }[]` constants. |
| `nav-items.ts` | `[new]` | — | The six sidebar entries (label + href + icon name). |

### New — track pages
| Path | | Note |
|---|---|---|
| `src/components/challenge/track-page.tsx` | `[new]` | **Server.** The entire current dashboard body + the two alternate screens, parameterised by `domain`. |
| `src/app/claude/page.tsx` | `[new]` | ~6 lines: `<TrackPage domain="CLAUDE" searchParams={…} />`. |
| `src/app/ai/page.tsx` | `[new]` | Same, `domain="AI"`. |
| `src/app/se/page.tsx` | `[new]` | Same, `domain="SE"`. |
| `src/app/ds/page.tsx` | `[new]` | Same, `domain="DS"`. |

> Four **static** folders — **not** a root-level `[domain]` dynamic segment. A
> catch-all at the root would swallow unknown paths and break `not-found.tsx`.

### Edits
| Path | | Note |
|---|---|---|
| `src/app/dashboard/page.tsx` | `[edit]` | Rewritten as the hub. Body + alternate screens move out. |
| `middleware.ts` | `[edit]` | New `exactProtectedPaths` array — **exact match only** for `/ai`, `/ds`, `/se`, `/claude`. |
| `src/components/shared/app-footer.tsx` | `[edit]` | `return null` when `pathname === "/dashboard"`. |
| `src/components/shared/bottom-nav.tsx` | `[edit]` | `return null` when `pathname === "/dashboard"` (exact, not prefix). |
| `src/components/shared/main-shell.tsx` | `[edit]` | Skip `pb-16` when `pathname === "/dashboard"`. |
| `src/components/landing/testimonials-carousel.tsx` | `[edit]` | Export the `Testimonial` type and the `TESTIMONIALS` array. **No other change.** |
| `src/app/login/page.tsx` | `[edit]` | Profile-less signed-in user with a `?from=/dashboard` no longer diverts to `/register`. |

### Explicitly NOT touched
`src/app/challenge/**`, `src/features/dashboard/get-heatmap-data.ts`,
`src/features/dashboard/get-dashboard-data.ts`,
`src/features/enrollment/**`, `src/app/register/**`, `src/app/page.tsx`,
`prisma/schema.prisma`, `src/components/shared/app-header.tsx`, and every
banner / modal / walkthrough component.

---

## 5. Server vs Client

| Component | Boundary | Props crossing Server→Client |
|---|---|---|
| `DashboardShell` | Client | `children` (server-rendered nodes) + plain `user` object + `isAdmin: boolean`. |
| `DashboardSidebar` | Client | Plain strings only. Icons resolved **inside** the client component from a string key in `nav-items.ts` — never pass a Lucide component across the boundary. |
| `DashboardHeader` | Client | `isAdmin: boolean`, `onMenuClick` supplied by `DashboardShell` (client→client, fine). |
| `ActivityHeatmap` | Client | `cells: { date: string; count: number; level: 0\|1\|2\|3\|4 }[]` — plain JSON. **Serialize dates to `yyyy-MM-dd` strings server-side; never pass `Date`.** |
| `EventsSection` | Client | Nothing — imports `EVENTS` itself. Keeping it client-side is what makes the Lucide `Icon` field legal. |
| `TestimonialsSection` | Server | Renders server cards as `children` of the existing client `TestimonialsScroller` (the established pattern). |
| `FaqSection` | Server | Passes `{ q, a }[]` to the client `FaqAccordion`. |
| `StreakCard`, `HeroGreeting`, `ContinueJourney`, `OtherChallenges`, `Roadmaps`, `DashboardFooter` | Server | — |
| `TrackPage` | Server | Same boundaries the current dashboard already has. |

Sign-out uses the existing pattern: `<form action={signOutAction}>` with a submit
button. `signOutAction` is a Server Action — safe to reference from a client
component.

---

## 6. Steps

### Step 1 — `src/features/dashboard/get-activity-heatmap.ts` `[new]`

```ts
export type ActivityCell = {
  date: string;        // IST yyyy-MM-dd
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type ActivityHeatmap = {
  cells: ActivityCell[];     // oldest → newest, exactly HEATMAP_DAYS entries
  maxCount: number;
  totalActiveDays: number;   // distinct IST dates with count > 0
  weekTicks: boolean[];      // 7 entries, Mon→Sun of the current IST week
};

export const HEATMAP_WEEKS = 12;              // tune here, nowhere else
export const HEATMAP_DAYS = HEATMAP_WEEKS * 7;
```

`getActivityHeatmap(userId: string): Promise<ActivityHeatmap>`

1. One query — no `include`, tight `select`:
   ```ts
   prisma.submission.findMany({
     where: { enrollment: { userId } },
     select: { submittedAt: true },
   })
   ```
2. Bucket into `Map<string, number>` keyed by
   `formatInTimeZone(submittedAt, IST, "yyyy-MM-dd")`.
3. Build the window: today's IST key, walk back so the grid starts on the
   **Monday** of the week containing `today - (HEATMAP_DAYS - 1)`. Use
   `addCalendarDaysToKey` — never reformat a UTC-midnight key through another
   zone (see the doc comment on that helper).
4. **Relative intensity — this is the behaviour the feature is named for.**
   `maxCount = Math.max(0, ...counts within the window)`.
   - `count === 0` → `level 0`
   - else `level = Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)))`

   So one day at 5 submissions is `level 4`; the next day at 6 becomes the new
   max and the 5-day drops to `level 4` still — but a 3-day that was `level 3`
   at max 5 becomes `level 2` at max 6. Recomputed from scratch on every render;
   nothing is persisted.
5. `totalActiveDays` = distinct keys with `count > 0` **across all history**, not
   just the window.
6. `weekTicks` = for Mon→Sun of the current IST week, `count > 0`.
7. Read-only. **Never write streaks or `daysCompleted` from this path.**

### Step 2 — `src/features/dashboard/get-hub-data.ts` `[new]`

`getHubData(userId)` returns, in one `Promise.all`:
- `profile: { fullName, referralCode } | null` — **null is a valid state**
- `enrollments: UserEnrollmentSummary[]` via `getUserActiveEnrollments`
- `allEnrollmentDomains: Domain[]` (any status — used for Roadmap "Join" vs "Continue")
- `hasProgramMembership: boolean` — skip the query entirely when
  `isProgramEnabled()` is false
- `isHackathonRegistered: boolean` via `isUserRegistered`
- `heatmap: ActivityHeatmap`
- `streak: { current: number; longest: number }` — `Math.max` of
  `currentStreak` / `longestStreak` across the user's enrollments; `0` when none

Result envelope not required (this is a read helper, not an action), but every
Prisma call uses `select`.

### Step 3 — `src/components/challenge/track-page.tsx` `[new]`

Move, do not rewrite. `TrackPage({ domain, searchParams })`:
1. `auth()` → `redirect("/login")` if no session.
2. Resolve the enrollment for `domain`:
   `prisma.enrollment.findFirst({ where: { userId, domain }, select: sessionEnrollmentSelect })`.
   No enrollment for this domain → `redirect("/dashboard")`.
3. Everything else is **lifted verbatim** from the current
   `src/app/dashboard/page.tsx` lines 147–723, with the enrollment already
   resolved: `AppHeader`, all banners and modals, `EnrollmentEndedScreen`,
   `PreStartDashboard`, the 60-cell `SubmissionHeatmap`, Today's Task, the four
   stat cards, quiz cards + history, recent activity, `ClaudeFAQ`.
4. `challengeHref()` still appends `?challenge=<enrollmentId>` — day pages are
   unchanged and still resolve by that param.
5. Keep the existing theme tokens here. **The track page is not monochrome** —
   only the hub is.

### Step 4 — the four track routes `[new]`

Each is a thin wrapper, e.g. `src/app/ai/page.tsx`:

```tsx
import { TrackPage } from "@/components/challenge/track-page";

export default async function AiTrackPage({ searchParams }: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  return <TrackPage domain="AI" searchParams={searchParams} />;
}
```

Same for `/se`, `/ds`, `/claude`.

### Step 5 — `nav-items.ts` + `faq-content.ts` `[new]`

`nav-items.ts` — exactly six, in this order, icon as a **string key**:
```
Dashboard    → /dashboard          → "grid"
Workshops    → /ai-workshop/events → "presentation"
Marketplace  → /marketplace        → "store"
Jobs         → /jobs               → "briefcase"
Achievements → /achievements       → "award"
Profile      → /profile            → "user"
```
`faq-content.ts` — `DASHBOARD_FAQ: { q: string; a: string }[]`, 6–8 entries
covering: how the challenge works, daily submission proof, streaks, Synergy
points, certificates, joining another track, contact.

### Step 6 — `DashboardShell` + `DashboardSidebar` + `DashboardHeader` `[new]`

**Layout.** `min-h-svh` flex row.
- Sidebar: `hidden md:flex`, fixed width (`w-64`), `sticky top-0 h-svh`,
  **`overflow-y-auto`** — it scrolls inside the static viewport, the page does not
  move it.
- Main: `flex-1 min-w-0 overflow-x-hidden`, contains the header, all sections,
  and `DashboardFooter` at the end of its scroll.
- Mobile (`< md`): sidebar becomes an off-canvas drawer over a backdrop, opened
  by a hamburger in the header. Close on backdrop click, on `Escape`, and on
  route change. `aria-expanded` on the trigger, `role="dialog"` +
  `aria-modal="true"` on the drawer.

**Header** — `sticky top-0 z-40`, inside the main column:
- Left: ABTalks logo (`/abtalks-logo.png`) linking to `/dashboard`.
- Centre (`hidden md:flex`): `Events` → `#events`, `FAQs` → `#faq`,
  `Testimonials` → `#testimonials`. Plain `<a href="#…">`; add
  `scroll-behavior: smooth` via a `scroll-smooth` class on the scroll container
  and `scroll-mt-20` on each target section so the sticky header doesn't cover
  the heading.
- Right: `Admin` pill → `/admin`, rendered **only** when `isAdmin`. Plus the
  hamburger button on `< md`. **No avatar, no theme toggle, no synergy chip.**

**Sidebar footer:** avatar (initials fallback), name, email, then
`<form action={signOutAction}>` with a `Sign out` button.

**Monochrome discipline (applies to every file in `src/components/dashboard-hub/`):**
- Allowed: `bg-white`, `bg-neutral-50/100/900`, `text-neutral-400/500/900`,
  `border-neutral-200/300`, `text-black`.
- Forbidden: any `dark:` variant, and the semantic tokens `bg-background`,
  `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`,
  `bg-primary`, `text-primary`.
- Only exception: the heatmap green scale (Step 7).

That combination is what keeps the page light regardless of the `dark` class
`ThemeProvider` puts on `<html>` — no provider change, no new context.

### Step 7 — `ActivityHeatmap` `[new]`

- Grid: `HEATMAP_WEEKS` columns × 7 rows, `grid-flow-col`, `rounded-[2px]` cells.
- Row labels Mon / Wed / Fri; month labels above the first column of each new month.
- Colour ramp (the only colour on the page):
  `level 0 → bg-neutral-100`, `1 → bg-emerald-200`, `2 → bg-emerald-400`,
  `3 → bg-emerald-600`, `4 → bg-emerald-800`.
- Legend `Less ▢▢▢▢▢ More` bottom-right.
- Hover / focus tooltip: `"{count} submission(s) on {d MMM yyyy}"`,
  `"No submissions on …"` at level 0. Each cell is a `<button type="button">`
  with an `aria-label` so it is keyboard reachable; **cells are not links** —
  clicking a past day is a parked idea (project-context §16).
- Mobile: wrap in `overflow-x-auto` and start scrolled to the right (most recent).
  Never let the page body scroll horizontally.

### Step 8 — the hub sections `[new]`

Order down the main column, each a top-level `<section>` with an `id` where anchored:

1. **Hero row** — `grid lg:grid-cols-[1fr_320px] gap-6`.
   Left: `HeroGreeting` (time-of-day greeting from IST + first name, or
   "Welcome" when `profile` is null).
   Right: `StreakCard` — **occupies the hero row and sits inside the first
   viewport**, per spec. Stacks below the greeting on `< lg`.
   `StreakCard`: ring showing `streak.current` with the label `DAY STREAK`; the
   Mon→Sun tick strip from `heatmap.weekTicks`; then a stats list —
   `Current streak` (days) · `Longest streak` (days) ·
   `Total active days` (`heatmap.totalActiveDays`) ·
   `Next milestone` (next of `7, 14, 30, 60, 100` above `streak.current`).
2. **`ActivityHeatmap`** — heading `Last {HEATMAP_WEEKS} weeks activity`.
3. **`ContinueJourney`** — one card per ACTIVE enrollment: domain name, `Day X of
   60`, a progress bar from `daysCompleted / 60`, and `Continue →` to
   `/ai` | `/se` | `/ds` | `/claude`. **No enrollments → empty state** card:
   "You haven't started a challenge yet" + `Browse challenges` → `/challenges`.
4. **`OtherChallenges`** — rendered only when there is something to show:
   `31 Days AI Cohort` → `/program` (hidden when `hasProgramMembership` or
   `isProgramEnabled()` is false); `Claude Challenge` → `/claude-signup`
   (hidden when already CLAUDE-enrolled or `isClaudeEnabled()` is false).
   Whole section omitted when both are hidden.
5. **`Roadmaps`** — three cards, `Artificial Intelligence` / `Data Science` /
   `Software Engineering`. Enrolled in that domain → `Continue` → the track page.
   Not enrolled → `Join` → `/challenges`. **Do not call any enrollment action and
   do not link to `/register` when the user already has an enrollment** — that
   round-trips straight back to `/dashboard` (`register/page.tsx:47-49`).
6. **`EventsSection`** `id="events"` — read `EVENTS`, split on `date` against
   today's IST key. `Upcoming events` first (ascending), then `Past events`
   (descending). Card CTA: `href` when the event defines one, else
   `/ai-workshop/events`.
7. **`TestimonialsSection`** `id="testimonials"` — heading
   "What students say", server-rendered cards inside `TestimonialsScroller`.
8. **`FaqSection`** `id="faq"` — `DASHBOARD_FAQ` into `FaqAccordion`.
9. **`DashboardFooter`** — logo, the four legal links (`/terms`, `/privacy`,
   `/cookies`, `/contact`), social icons, `team@abtalks.in`, copyright.

### Step 9 — `middleware.ts` `[edit]` ⚠ highest-risk edit in this plan

`protectedPaths` is matched with `pathname.startsWith(p)`. Adding `/ai` there
would protect `/ai-workshop`, `/ai-cohort-register`, `/ai-cohort-india` and
`/ai-talent-hunt`; adding `/claude` would protect `/claude-signup`. **All five
are public marketing pages — that would break the top of the funnel.**

Add a **separate exact-match array**, leave `protectedPaths` alone:

```ts
// Exact match only — `/ai` must not capture `/ai-workshop`,
// `/ai-cohort-*` or `/ai-talent-hunt`, and `/claude` must not
// capture `/claude-signup`. All of those are public.
const exactProtectedPaths = ["/ai", "/ds", "/se", "/claude"];

const isProtected =
  protectedPaths.some((p) => pathname.startsWith(p)) ||
  exactProtectedPaths.includes(pathname);
```

`/dashboard` is already in `protectedPaths` — do not touch that line.
Edge-safety unchanged: no new imports, `next-auth` + `next/server` only.

### Step 10 — chrome suppression `[edit] ×3`

- `app-footer.tsx`: after the existing `isWorkshop` guard, add
  `if (pathname === "/dashboard") return null;`
- `bottom-nav.tsx`: add `pathname === "/dashboard"` to the early-return
  condition. **Exact equality, not `startsWith`** — `isTabActive` deliberately
  maps `/challenge/*` onto the Home tab and that must keep working.
- `main-shell.tsx`: compute `const isDashboard = pathname === "/dashboard";` and
  change the padding to `!isHackathon && !isDashboard && "pb-16 md:pb-0"`.

### Step 11 — `src/app/dashboard/page.tsx` `[edit]` — rewrite

```
const session = await auth();
if (!session?.user?.id) redirect("/login");

const data = await getHubData(session.user.id);
if (!data.hasUser) redirect("/api/auth/signout?callbackUrl=/login");

// NO redirect to /register. NO hackathonRedirectForProfilelessUser.
// A null profile renders empty states.

return (
  <DashboardShell user={…} isAdmin={session.user.isAdmin ?? false}>
    …sections…
  </DashboardShell>
);
```

Remove every banner, modal, nudge, toast and the walkthrough from this file.
**Delete none of those component files** — they are wanted for a later plan.

### Step 12 — `src/app/login/page.tsx` `[edit]`

At lines 66–74, a signed-in user with a valid `from` but no profile/enrollment is
sent to `/register`. Since `/dashboard` now renders for profile-less users, add
`/dashboard` alongside the existing `/program` / `/talent` / `/hackathon`
pass-through so it redirects straight to `redirectTo`. Change nothing else —
`redirectTo = from ?? "/dashboard"` and the `if (!from) redirect("/")` bounce
both stay as they are.

### Step 13 — `testimonials-carousel.tsx` `[edit]`

Add `export` to the `Testimonial` type and the `TESTIMONIALS` array. Nothing
else in that file changes — the landing page must render identically.

---

## 7. DB safety

**Not applicable.** No schema change, no migration, no seed, no data backfill.
Every new query is a read against existing tables. Do not run any `db:*` script.

---

## 8. Guardrails for Cursor (DO NOT)

1. **DO NOT** use `startsWith` for `/ai`, `/ds`, `/se`, `/claude` in
   `middleware.ts`. Exact match only. Re-read Step 9 before editing that file.
2. **DO NOT** import anything from `@/lib/*` into `middleware.ts` — Edge bundle
   limit. This edit needs no new imports at all.
3. **DO NOT** create a root-level `[domain]` dynamic route. Four static folders.
4. **DO NOT** touch `src/app/challenge/**`, `get-heatmap-data.ts`,
   `get-dashboard-data.ts`, or anything in `src/features/enrollment/`.
   The submission flow must be byte-identical after this change.
5. **DO NOT** delete any banner / modal / nudge / walkthrough component. Only
   stop mounting them on `/dashboard`.
6. **DO NOT** add a second-enrollment action, mutate `StudentProfile.domain`, or
   link an already-enrolled user to `/register`. Roadmap cards are links.
7. **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>`. Use
   `buttonVariants` directly on the `<Link>`.
8. **DO NOT** use `dark:` variants or semantic theme tokens anywhere under
   `src/components/dashboard-hub/`. Literal neutrals only; green only in the heatmap.
9. **DO NOT** pass a Lucide component, a function, or a `Date` from a Server
   Component into a Client Component. Icons resolve from string keys inside the
   client; dates cross as `yyyy-MM-dd` strings.
10. **DO NOT** import `components/workshop/events-data.ts` from a Server
    Component — it carries `Icon: LucideIcon`. `events-section.tsx` is `"use client"`.
11. **DO NOT** write to the DB from any hub read path — no streak, no
    `daysCompleted`, no `lastSubmittedDay`. Streaks are write-time only
    (`submitDay`).
12. **DO NOT** run a Prisma query without `select`.
13. **DO NOT** use `console.*`. Use `lib/logger.ts`.
14. **DO NOT** add `requireRole` / `requireAdmin` to the new track pages — they
    gate on session + enrollment ownership, exactly as `/dashboard` does today.
15. **DO NOT** create abstraction files beyond the ones listed in §4.
16. **DO NOT** let the page body scroll horizontally. The heatmap scrolls inside
    its own `overflow-x-auto` container.
17. **DO NOT** report done without a clean `npm run build`.

---

## 9. Verification

### Build / typecheck
```bash
npm run build
```
Must pass with no new TypeScript errors and no Edge-bundle warning on `middleware.ts`.

### Public routes must still be public — sign out and confirm 200, not a login redirect
`/ai-workshop` · `/ai-workshop/events` · `/ai-cohort-register` ·
`/ai-cohort-india` · `/ai-talent-hunt` · `/claude-signup` · `/challenges` · `/`

If any of these bounce to `/login`, Step 9 was done wrong — fix the middleware,
do not adjust the pages.

### New routes must be protected — signed out, each redirects to `/login?from=…`
`/dashboard` · `/ai` · `/ds` · `/se` · `/claude`

### Hub behaviour (sign in as `arjun@abtalks.dev` / `test`)
- Sign-in lands on `/dashboard` showing the new hub.
- Sidebar is fixed and scrolls independently; the main column scrolls to the footer.
- Header centre links scroll to Events / Testimonials / FAQ without the sticky
  header covering the heading.
- Admin pill absent. Sign in as `admin@abtalks.dev` / `admin` → pill present,
  links to `/admin`.
- No banners, no modals, no walkthrough, no toast anywhere on the hub.
- Page renders identically with the OS in dark mode (forced light).
- At 390 px: sidebar collapses to a hamburger, drawer opens/closes via backdrop
  and `Escape`, and **no bottom tab bar is visible**. On `/jobs` the bottom tab
  bar is still there.

### Heatmap — the relative-shading rule
Use `vikram@abtalks.dev` (Day 15) or backfill within the relaxation window to get
a date with more than one submission.
1. Note the shade of a date with 2 submissions when the window max is 2 → darkest.
2. Produce a date with 3 submissions.
3. Reload: the 3-day is now darkest and the 2-day has visibly stepped **down** a
   level. That step-down is the acceptance criterion.
4. `Total active days` equals the count of distinct dates with any submission.
5. Empty account (no submissions): all cells level 0, no crash, `maxCount` 0.

### Empty-state user
Sign in with a Google account that has **no `StudentProfile`**: `/dashboard`
renders the full hub, "Continue your journey" shows the start prompt, all three
roadmap cards read `Join`, streak reads 0, heatmap is empty, and **there is no
redirect to `/register`**.

### Track pages — functionality must be unchanged
- `/ai` shows Today's Task, stat cards, 60-cell heatmap, quiz cards, recent
  activity — pixel-equivalent to the old `/dashboard`.
- "Start Today's Challenge" → `/challenge/today?challenge=<id>`; submitting still
  works end to end.
- A domain with no enrollment redirects to `/dashboard`.
- `ABANDONED` enrollment → `EnrollmentEndedScreen`. Pre-start CLAUDE cohort →
  `PreStartDashboard`.

### Files changed
Exactly the 7 edits and 21 new files listed in §4 — nothing else. Confirm with
`git status` before committing.

---

## 10. Commit message

```
feat(dashboard): student dashboard hub with sidebar shell and calendar heatmap

Replace /dashboard with a monochrome hub: fixed sidebar (Dashboard, Workshops,
Marketplace, Jobs, Achievements, Profile), anchor-nav header with an admin-only
Admin button, hero + day-streak card, and a GitHub-style activity heatmap whose
green intensity is relative to the highest submission count in the window.

Below the fold: continue-your-journey, other challenges, roadmaps, upcoming and
past events, testimonials, FAQ, footer.

Per-challenge work (Today's Task, quiz, stat cards, recent activity, pre-start
countdown, ended screen) moves verbatim to new track pages at /ai, /ds, /se and
/claude. Day and submission pages under /challenge are unchanged.

The hub renders for users without a StudentProfile — no /register bounce — and
mounts no banners or modals; those return in a follow-up.

Middleware protects the four track routes by exact match so /ai-workshop,
/ai-cohort-*, /ai-talent-hunt and /claude-signup stay public.
```

---

## 11. Follow-up plans this one deliberately defers

1. **Multi-domain enrollment** — allowing a real second/third core enrollment.
   Touches `register`, `StudentProfile.domain` semantics,
   `resolveDashboardEnrollment`, leaderboard, certificates.
2. **Re-mounting compliance surfaces on the hub** — `ConsentRefreshBanner` and
   `PhoneVerifyNudge` in particular. Until then they are reachable only from the
   track pages.
3. **Clickable heatmap cells** → past day view (already parked in
   project-context §16).
