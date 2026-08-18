# 067 — Notification bell (header + bottom nav): admin-pushed and automated event updates

## 1. Goal

Add a notification bell to the app's navigation that shows platform updates from
two sources: announcements an admin pushes from `/admin/notifications`, and
automated event notifications derived from the tracks that already have dates
(workshops, hackathon, program cohort enrolment). Per-user read state drives an
unread badge. The bell appears in the **top header on desktop** and in the
**mobile bottom pill** — one shared state, one panel, never both at once.

---

## 2. Current behavior

- **Top header:** `src/components/shared/app-header.tsx` is a Client Component
  rendered by ~12 Server pages (dashboard, challenge day, explore, jobs,
  profile, quiz, achievements, marketplace, mission, students, admin layout).
  Every call site passes only `user` (plus optional enrollment props on
  `/dashboard`). Right cluster today: challenge switcher → Jobs link → Admin
  pill → `SynergyChip` → `ThemeToggle` → avatar dropdown → `MobileSidebar`.
  **Every item except the hamburger is `hidden md:*`** — on mobile the header
  holds only the logo and the menu button.
- **Mobile bottom nav:** `src/components/shared/bottom-nav.tsx` — a `md:hidden`
  floating pill with 5 tabs (Home / Jobs / Rewards / Explore / Profile) from a
  `tabs` array marked `as const`. A single always-mounted `motion.span`
  indicator slides between tabs; its position is **measured** from
  `tabRefs.current[activeIndex]`, where `activeIndex = tabs.findIndex(...)`.
  The whole nav returns `null` on `/`, `/ai-workshop*`, `/hackathon*`, and
  `/(login|register|claude-signup|students|r|program|talent|verify)`.
  Mounted by `BottomNavGate` in `src/app/layout.tsx`.
- **Root layout nesting** (`src/app/layout.tsx`) — note the asymmetry:
  `CookieConsentProvider` > `SynergyProvider` > `MotionProvider` > `MainShell`,
  with `AppFooter`, `BottomNavGate`, `Toaster`, `CookieConsentModal` as
  **siblings of `SynergyProvider`, outside it**. Anything both `MainShell` and
  `BottomNavGate` need must sit above `SynergyProvider`.
- **Precedent for nav-local data:** `SynergyChip` renders from
  `SynergyProvider`, a client provider that calls a Server Action on mount and
  caches the value in `sessionStorage` with a 60s TTL. **No** notification data
  is passed down from any page.
- **Admin panel:** `src/app/admin/layout.tsx` holds a hardcoded `navItems`
  array; `AdminSidebar` maps `icon` string names to Lucide components via
  `iconMap` (icons are never passed as props across the boundary).
- **Event date sources that already exist:**
  - Workshops — `src/components/workshop/events-data.ts` (`EVENTS`, code-defined,
    each with `id`, `date` ISO, `title`, `register`, `registrationOpen`).
  - Hackathon — `src/components/hackathon/hackathon-config.ts` (`HACKATHON`
    with `registrationOpen`, `registrationClosesUtc`, `kickoffUtc`,
    `deadlineUtc`, labels).
  - Program cohort — `ProgramCohort` rows (`status`, `startsAt`, `endsAt`).
- **No** notification / announcement model, table, action, or component exists
  anywhere in the repo today.

---

## 3. Key architectural decisions (read before implementing)

### 3a. Automated notifications are derived, not stored

**Admin notifications are DB rows. Automated event notifications are derived at
read time from the sources above — they are NOT stored, and there is NO cron.**

Why:
- A read path that materialises rows would violate the standing rule that read
  paths never write (the same rule that governs streaks/`daysCompleted`).
- Workshop events are already code-defined and edited by hand; adding an entry
  to `EVENTS` should produce its notification with zero extra steps and zero
  chance of a stale duplicate row.
- No cron, no backfill, no drift, no free-tier cost.

Both kinds are unified into one `AppNotification` shape with a **stable string
key**, and one read-state table keyed by that string (deliberately not a foreign
key) covers both. Everything downstream — badge, panel, mark-read — treats the
two identically.

```ts
// src/features/notification/types.ts
export type AppNotification = {
  /** Stable, unique, never reused. "admin:<id>" | "workshop:<eventId>" | "hackathon:kickoff" | "cohort:<id>:enrolling" */
  key: string;
  title: string;
  body: string | null;
  href: string | null;
  category: "GENERAL" | "WORKSHOP" | "HACKATHON" | "COHORT" | "CHALLENGE";
  publishedAt: string;   // ISO — sort key, serialised for the client boundary
  isRead: boolean;
};
```

### 3b. Two trigger sites, one provider

The bell has two mount points at different breakpoints. They must **not** each
own a fetch and a panel, or the app double-fetches and can open two panels.

- `NotificationProvider` (root layout, client) owns: the feed, the unread count,
  the session cache, the open/closed state, and **renders the single panel**.
- `NotificationBellButton` is a dumb trigger rendered twice — in `AppHeader`
  (`hidden md:inline-flex`) and in `BottomNav` (mobile only, since the whole
  pill is `md:hidden`). Exactly one is ever visible.

**The provider does not fetch on mount.** It exposes `ensureLoaded()`, which the
trigger calls on its own mount. Without this, the provider sits in the root
layout and would fire a Server Action on the public landing page for every
anonymous visitor. Fetching only happens where a bell actually renders.

**Accepted gap:** `BottomNav` returns `null` on `/students/[id]`, so that one
public route has no bell below `md`. It is a public profile page; not worth a
third mount point.

---

## 4. Files to touch

### Schema
| Path | | Note |
|---|---|---|
| `prisma/schema.prisma` | `[edit]` | Add `NotificationAudience` + `NotificationCategory` enums, `Notification` + `NotificationRead` models, and the `notificationReads` back-relation on `User`. |
| `prisma/migrations/<timestamp>_add_notifications/migration.sql` | `[new]` | Generated by `prisma migrate dev` — do not hand-write unless drift blocks it (§8). |

### Feature module — `src/features/notification/` (new, 20th module)
| Path | | Note |
|---|---|---|
| `src/features/notification/types.ts` | `[new]` | `AppNotification` + `NotificationFeed` types only. |
| `src/features/notification/derive-event-notifications.ts` | `[new]` | Builder for the automated notifications from `EVENTS`, `HACKATHON`, and the enrolling cohorts passed in. No DB access. |
| `src/features/notification/get-notifications.ts` | `[new]` | `server-only`. Merges admin rows + derived items, applies audience filter, joins read state, sorts, caps at 20. |
| `src/features/notification/admin-data.ts` | `[new]` | `server-only`. Lists admin notification rows for `/admin/notifications`. |

### Server Actions
| Path | | Note |
|---|---|---|
| `src/app/actions/notification-actions.ts` | `[new]` | `getMyNotificationsAction`, `markNotificationsReadAction`. |
| `src/app/actions/admin-notification-actions.ts` | `[new]` | `createNotificationAction`, `deactivateNotificationAction`, `deleteNotificationAction` — each in a transaction with an `AdminAction` audit row. |

### Components
| Path | | Note |
|---|---|---|
| `src/components/shared/notification-provider.tsx` | `[new]` | `"use client"`. Context + session cache + `ensureLoaded()` + renders the one portal panel. |
| `src/components/shared/notification-bell-button.tsx` | `[new]` | `"use client"`. Trigger + unread badge. Takes a `className` only. |
| `src/app/layout.tsx` | `[edit]` | Wrap `NotificationProvider` **above** `SynergyProvider` so it also covers `BottomNavGate`. |
| `src/components/shared/app-header.tsx` | `[edit]` | Render the trigger `hidden md:inline-flex`, between the Admin pill and `SynergyChip`. |
| `src/components/shared/bottom-nav.tsx` | `[edit]` | Render the trigger as a **sibling after** the `tabs.map(...)`, never inside the `tabs` array. |
| `src/components/admin/notification-composer.tsx` | `[new]` | `"use client"`. Create form. |
| `src/components/admin/notifications-table.tsx` | `[new]` | `"use client"`. Existing announcements + deactivate/delete. |

### Admin page
| Path | | Note |
|---|---|---|
| `src/app/admin/notifications/page.tsx` | `[new]` | Server Component; `requireAdmin()`, renders the two client components. |
| `src/app/admin/layout.tsx` | `[edit]` | One `navItems` entry: `{ href: "/admin/notifications", label: "Notifications", icon: "notifications" as const }`, placed directly after `Activity`. |
| `src/components/admin/admin-sidebar.tsx` | `[edit]` | Add `"notifications"` to the `IconName` union and `notifications: Bell` to `iconMap`. |
| `src/components/admin/admin-mobile-nav.tsx` | `[edit]` | **Duplicates** the `IconName` union and `iconMap` — needs the same two additions, or the shared `navItems` array fails to typecheck and the icon is `undefined` at runtime. |

**Nothing else.** No middleware change, no new env var, no new npm package, no
change to any of the ~12 pages that render `AppHeader`.

---

## 5. Server vs Client

| Component | Boundary | Notes |
|---|---|---|
| `app/layout.tsx` | **Server** | Renders `<NotificationProvider>` with children only — no props cross the boundary. |
| `notification-provider.tsx` | **Client** (new) | Calls `getMyNotificationsAction()` itself. Receives no server data. |
| `notification-bell-button.tsx` | **Client** (new) | Props: `className?: string` only. |
| `app-header.tsx` / `bottom-nav.tsx` | **Client** (already) | Render the trigger with no data props. |
| `features/notification/*` | **Server only** | `get-notifications.ts` and `admin-data.ts` start with `import "server-only";`. |
| `admin/notifications/page.tsx` | **Server** | Passes only plain-serialisable rows into the two client components. Dates → `.toISOString()` before crossing. |
| `notification-composer.tsx` / `notifications-table.tsx` | **Client** | Call the admin actions directly. |

**Boundary hazard to pre-empt:** `events-data.ts` exports `Icon: LucideIcon` on
every event. `derive-event-notifications.ts` reads `id`, `date`, `title`,
`time`, `location`, `register`, `registrationOpen` and **must never** copy
`Icon` (or spread a whole event object) into an `AppNotification`. Category
strings drive icon choice on the client, exactly like `AdminSidebar`'s
`iconMap`.

---

## 6. Steps

### Step 1 — `prisma/schema.prisma`

Add near the other feature models (after `WorkshopRegistration` is a good spot):

```prisma
enum NotificationAudience {
  ALL
  CHALLENGE
  PROGRAM
  HACKATHON
}

enum NotificationCategory {
  GENERAL
  WORKSHOP
  HACKATHON
  COHORT
  CHALLENGE
}

/// Admin-authored broadcast announcements. Automated event notifications
/// (workshops, hackathon milestones, cohort enrolment) are NOT stored here —
/// they are derived at read time in features/notification. See docs/plans/067.
model Notification {
  id               String               @id @default(cuid())
  title            String
  body             String?
  /// Internal path ("/hackathon") or absolute URL. Optional.
  href             String?
  category         NotificationCategory @default(GENERAL)
  audience         NotificationAudience @default(ALL)
  publishedAt      DateTime             @default(now())
  /// After this instant the item stops appearing. Null = no expiry.
  expiresAt        DateTime?
  isActive         Boolean              @default(true)
  createdByAdminId String?
  createdAt        DateTime             @default(now())

  @@index([isActive, publishedAt(sort: Desc)])
}

/// Per-user read state for BOTH admin and derived notifications.
/// `notificationKey` is deliberately NOT a foreign key: derived event
/// notifications have no row to point at. Keys are stable and never reused.
model NotificationRead {
  id              String   @id @default(cuid())
  userId          String
  notificationKey String
  readAt          DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, notificationKey])
  @@index([userId])
}
```

On the `User` model add the back-relation line:

```prisma
  notificationReads NotificationRead[]
```

### Step 2 — `src/features/notification/types.ts`

Export `AppNotification` from §3a verbatim, plus:

```ts
export type NotificationFeed = {
  signedIn: boolean;
  items: AppNotification[];
  unreadCount: number;
};
```

### Step 3 — `src/features/notification/derive-event-notifications.ts`

One exported function; it does no DB access (the caller supplies cohorts):

```ts
type DerivedInput = {
  now: Date;
  enrollingCohorts: { id: string; name: string; startsAt: Date }[];
  programEnabled: boolean;
};
export function deriveEventNotifications(input: DerivedInput): Omit<AppNotification, "isRead">[]
```

**Suppression rule:** an event notification is never shown to someone it no
longer applies to — already registered for that workshop, already a hackathon
participant, already in that cohort. The hackathon case inverts: "register now"
is for non-participants, while kickoff/deadline reminders are only for
participants, who are the only ones with something to act on.

Rules — an item is produced **only** while `now` is inside its window:

1. **Workshops** — for each `EVENTS` entry with `register && registrationOpen`:
   - window: from 7 days before the event's IST date 00:00 until the end of the
     event's IST day. Reuse `istTodayKey()` and the `yyyy-MM-dd` string
     comparison already used in `events-data.ts`; do not introduce another date
     library.
   - `key: "workshop:" + ev.id`, `category: "WORKSHOP"`,
     `title: "Live workshop: " + ev.title`, `body: ev.time + " · " + ev.location`,
     `href: "/ai-workshop"`, `publishedAt` = the window-open instant.
2. **Hackathon** — from `HACKATHON`, three independent items, all
   `category: "HACKATHON"`:
   - `key: "hackathon:registration"` — only while `HACKATHON.registrationOpen`
     is true **and** `now < registrationClosesUtc`. Title "Hackathon
     registration is open", body `registrationClosesLabel`, href `/hackathon`.
   - `key: "hackathon:kickoff"` — from 3 days before `kickoffUtc` until
     `kickoffUtc`. Body `kickoffLabel`, href `/hackathon`.
   - `key: "hackathon:deadline"` — from 12h before `deadlineUtc` until
     `deadlineUtc`. Body `deadlineLabel`, href `/hackathon/dashboard`.
3. **Cohort** — only when `programEnabled`; for each passed cohort with
   `startsAt > now`: `key: "cohort:" + id + ":enrolling"`,
   `category: "COHORT"`, title `"AI Cohort enrolling: " + name`, href
   `/program`, window = until `startsAt`.

### Step 4 — `src/features/notification/get-notifications.ts`

```ts
import "server-only";
export async function getNotificationsForUser(userId: string): Promise<NotificationFeed>
```

1. `const now = new Date();`
2. One `Promise.all`:
   - active admin rows:
     `prisma.notification.findMany({ where: { isActive: true, publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true, title: true, body: true, href: true, category: true, audience: true, publishedAt: true }, orderBy: { publishedAt: "desc" }, take: 20 })`
   - enrolling cohorts (only if `isProgramEnabled()`):
     `prisma.programCohort.findMany({ where: { status: "ENROLLING" }, select: { id: true, name: true, startsAt: true } })`
   - read keys:
     `prisma.notificationRead.findMany({ where: { userId }, select: { notificationKey: true } })`
   - audience membership — three cheap existence checks, each
     `select: { id: true }, take: 1`: any `Enrollment` (CHALLENGE), any
     `ProgramMember` (PROGRAM), any `HackathonParticipant` (HACKATHON).
3. Filter admin rows by audience: keep `ALL`, plus those whose audience matches
   a membership the user has.
4. Map admin rows to `key: "admin:" + id`, merge with
   `deriveEventNotifications(...)`.
5. Set `isRead` from the read-key `Set`, sort by `publishedAt` desc,
   `slice(0, 20)`.
6. `unreadCount` = items where `!isRead`. Return `{ signedIn: true, items, unreadCount }`.

Serialise `publishedAt` with `.toISOString()` here so the action returns a plain
object.

### Step 5 — `src/app/actions/notification-actions.ts`

`"use server"`.

- `getMyNotificationsAction()` — `const session = await auth();` If no
  `session?.user?.id`, return
  `{ ok: true, data: { signedIn: false, items: [], unreadCount: 0 } }`
  (**not** an error — `/students/[id]` is a public route that renders
  `AppHeader`). Otherwise delegate to `getNotificationsForUser`.
- `markNotificationsReadAction(keys: string[])` — Zod:
  `z.array(z.string().min(1).max(200)).max(50)`. Requires a session. Writes
  `prisma.notificationRead.createMany({ data: keys.map(k => ({ userId, notificationKey: k })), skipDuplicates: true })`.
  Returns `{ ok: true, data: null }`. No `revalidatePath` — the provider owns
  its client state.

Errors through `lib/logger.ts`, never `console.error`.

### Step 6 — `src/components/shared/notification-provider.tsx`

`"use client"`. Mirrors `SynergyProvider`'s caching approach.

Context value:

```ts
type Ctx = {
  feed: NotificationFeed | null;
  open: boolean;
  ensureLoaded: () => void;   // called by the trigger on mount
  openPanel: () => void;
  closePanel: () => void;
};
```

- `sessionStorage` key `abtalks_notifications`, 60s TTL, shape
  `{ feed: NotificationFeed; t: number }`. All access wrapped in `try/catch`
  (same as `SynergyProvider`). Read cache for instant paint; refetch when
  absent or stale.
- `ensureLoaded()` is idempotent — guard with a ref so concurrent triggers and
  re-renders cause at most one in-flight request. **Never fetch in a bare
  `useEffect` on provider mount.**
- `useNotifications()` hook returns a safe no-op default when the context is
  missing, exactly like `useSynergy()`.
- **Renders the single panel** when `open` and `feed?.signedIn`:
  - `createPortal` into `document.body` (same approach as `MobileSidebar`,
    which avoids nav stacking-context issues).
  - click-away overlay + `Escape` to close (copy the `keydown` effect from
    `MobileSidebar`).
  - mobile: `fixed inset-x-3 bottom-24 max-h-[60vh] overflow-y-auto` — it must
    sit **above** the bottom pill, not under the header.
  - `md+`: `fixed right-4 top-16 w-96 max-h-[70vh] overflow-y-auto`.
  - Rows: category icon from a local `iconMap` keyed by the `category` string
    (never an icon passed as a prop), title, body, relative time, unread
    left-border accent. A row with `href` is a `<Link>` that closes the panel;
    without one it is a plain `<div>`.
  - Empty state: "You're all caught up."
- On `openPanel()`: optimistically set every visible item `isRead: true` and
  `unreadCount: 0`, write the updated feed to the session cache, then fire
  `markNotificationsReadAction(unreadKeys)`. Ignore the result; never block the
  UI on it.

### Step 7 — `src/app/layout.tsx`

`BottomNavGate` is **outside** `SynergyProvider`, so the notification provider
must sit higher — directly inside `CookieConsentProvider`, wrapping
`SynergyProvider`, `AppFooter`, `BottomNavGate`, `Toaster` and
`CookieConsentModal`:

```tsx
<CookieConsentProvider>
  <NotificationProvider>
    <SynergyProvider>
      <MotionProvider>
        <MainShell>{children}</MainShell>
      </MotionProvider>
    </SynergyProvider>
    <AppFooter />
    <BottomNavGate />
    <Toaster />
    <CookieConsentModal />
  </NotificationProvider>
</CookieConsentProvider>
```

Do not reorder or re-nest anything else.

### Step 8 — `src/components/shared/notification-bell-button.tsx`

`"use client"`. Props: `{ className?: string }`.

- `useEffect(() => { ensureLoaded(); }, [ensureLoaded])` on mount.
- Renders `null` when `feed?.signedIn === false`. While `feed === null`, render
  the bell with no badge (no layout shift).
- A plain `<button>` (never `<Button asChild>`), `aria-label="Notifications"`,
  `aria-expanded={open}`, `onClick={openPanel}`. `Bell` icon from
  `lucide-react`.
- Unread badge: absolutely-positioned pill, `unreadCount > 9 ? "9+" : count`,
  hidden at zero. **No glow or heavy shadow** — plain
  `bg-primary text-primary-foreground`, border-level treatment consistent with
  the rest of the nav.
- All positioning/sizing comes from the caller's `className`, so the same
  component fits both navs.

### Step 9 — `src/components/shared/app-header.tsx`

Render the trigger once, between the Admin pill block and the `SynergyChip`
block:

```tsx
<NotificationBellButton className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card transition-colors hover:bg-muted md:inline-flex" />
```

`hidden … md:inline-flex` is deliberate — mobile is served by the bottom pill.
Do not change any other element, do not add props to `AppHeader`, and do not
touch any page that renders it.

### Step 10 — `src/components/shared/bottom-nav.tsx`

The pill goes from 5 tabs to 5 tabs + 1 trigger. **The bell is not a tab.**

- **Do NOT add the bell to the `tabs` array.** That array is `as const`, drives
  `tabRefs`, and `activeIndex = tabs.findIndex(...)` positions the sliding
  indicator. A bell has no route, so it would sit at `activeIndex === -1` and
  break indicator measurement.
- Render it as a sibling **after** `{tabs.map(...)}`, inside the same `<nav>`:

```tsx
<NotificationBellButton className="focus-spark relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground" />
```

  This matches the tab anchors' classes so the six children distribute evenly
  via `flex-1`, but it is excluded from `tabRefs` and from the indicator.
- Add a `<span className="text-[10px] font-medium leading-none">Alerts</span>`
  label inside the button (pass it as children if you extend the component's
  props; otherwise keep the label inside `NotificationBellButton` behind an
  optional `label?: string` prop — **an optional prop is acceptable here; a new
  wrapper file is not**).
- Verify at 390px: the pill is `w-full max-w-md` with `px-2`, leaving ~350px for
  six children (~58px each) — icon + 10px label fits. Check the labels do not
  wrap.
- Change nothing about the `measure()` callback, the `tabs` array, the route
  null-return list, or the indicator.

### Step 11 — Admin surface

- `src/app/actions/admin-notification-actions.ts`, `"use server"`, each action
  `await requireAdmin()` first, Zod-validated, each mutation wrapped in
  `prisma.$transaction` together with an `AdminAction` row
  (`actionType: "createNotification" | "deactivateNotification" | "deleteNotification"`,
  `metadata` = the notification id/title). Follow the shape of
  `admin-hackathon-link-actions.ts`. `revalidatePath("/admin/notifications")`
  after each. **Check whether `AdminAction.targetUserId` is nullable before
  assuming** — if it is required, pass the admin's own id.
  - `createNotificationAction`: `title` 1–120, `body` ≤ 500 optional, `href`
    optional (`z.string().trim().max(300)`, must start with `/` or `https://`),
    `category`, `audience`, `expiresAt` optional ISO. Sets `createdByAdminId`
    from the session.
  - `deactivateNotificationAction(id)`: sets `isActive: false`.
  - `deleteNotificationAction(id)`: hard delete. Read rows keyed `admin:<id>`
    are intentionally left behind — harmless, and ids are never reused.
- `src/features/notification/admin-data.ts`: `getAdminNotifications()` —
  `findMany` with `select`, newest first, `take: 100`.
- `src/app/admin/notifications/page.tsx`: `requireAdmin()`, fetch, render
  `<NotificationComposer />` above `<NotificationsTable rows={...} />`. Convert
  every `Date` to an ISO string before passing.
- Composer / table components: match the visual language of
  `hackathon-link-add.tsx` / `hackathon-link-view.tsx`. `sonner` toast on
  success and on `{ ok: false }`.
- Sidebar: add the nav item and the `Bell` icon mapping as listed in §4.

---

## 7. Guardrails for Cursor (DO NOT)

- **DO NOT** add the bell to the `tabs` array in `bottom-nav.tsx`, and do not
  touch `measure()`, `tabRefs`, `activeIndex`, or the `motion.span` indicator.
  The trigger is a sibling of the mapped tabs. (See Step 10.)
- **DO NOT** render the bell at all breakpoints in both navs — the header
  trigger is `hidden md:inline-flex`, the bottom pill is already `md:hidden`.
  Exactly one is visible at any width.
- **DO NOT** give `NotificationProvider` a fetch-on-mount effect. It sits in the
  root layout and would hit a Server Action for every anonymous landing-page
  visitor. Loading starts from the trigger's `ensureLoaded()`.
- **DO NOT** nest `NotificationProvider` inside `SynergyProvider` or
  `MainShell` — `BottomNavGate` is outside both and needs the context.
- **DO NOT** import anything from `src/features/notification/`,
  `notification-actions.ts`, or `@/lib/*` into `middleware.ts` or
  `auth.config.ts`. This feature has zero middleware footprint.
- **DO NOT** add `requireAdmin` / `requireRole` to `getMyNotificationsAction` —
  it is called from `AppHeader`, which renders on the **public**
  `/students/[id]` route. It must return an empty signed-out feed, not throw.
- **DO NOT** copy `Icon` (or spread a whole `WorkshopEvent`) into an
  `AppNotification`. Lucide components cannot cross the Server→Client boundary.
  Icons are chosen client-side from the `category` string.
- **DO NOT** create rows for automated notifications, add a cron, add an API
  route, or write anything during a read.
- **DO NOT** make `NotificationRead.notificationKey` a foreign key or add a
  relation to `Notification`.
- **DO NOT** add a `NotificationRead` row for a key not currently visible to
  that user.
- **DO NOT** add props to `AppHeader` or edit any of the ~12 pages that render
  it. The provider fetches its own data.
- **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>` — use
  `buttonVariants` on the `<Link>` (Base UI button semantics).
- **DO NOT** return full Prisma records — every query uses `select`.
- **DO NOT** use `console.error`; use `lib/logger.ts`.
- **DO NOT** add web push, browser Notification API, email fan-out, service
  workers, or realtime/polling sockets. Out of scope.
- **DO NOT** add a new npm dependency. `lucide-react`, `sonner`, `zod`,
  `framer-motion` and `createPortal` are all already in use.
- **DO NOT** add heavy glow/shadow effects on the badge or panel — border-level
  treatment only.
- **DO NOT** create extra abstraction files beyond those listed in §4.

---

## 8. DB safety (schema changes)

Before touching `prisma/schema.prisma`:

1. `git add -A && git commit -m "checkpoint before notifications schema"` —
   record the commit hash.
2. Create a Neon branch as a snapshot.

Then:

3. `npx prisma migrate dev --name add_notifications` — this repo uses real
   migrations (`prisma/migrations/` + `prisma migrate deploy` in
   `build:deploy`), so a migration file **must** be produced. Do not use
   `prisma db push` on master.
4. **If `migrate dev` reports drift, STOP and report it — do NOT run
   `prisma migrate reset` (it drops the shared dev/prod Neon database).** The
   recovery path is `prisma migrate diff` → hand-written migration SQL →
   `prisma migrate resolve --applied <name>`.
5. `npx prisma generate`.
6. No seed script and no backfill: both tables start empty by design.

---

## 9. Verification

**Build:** `npm run build` passes (includes `prisma generate` + typecheck).
`npx tsc --noEmit` clean, `npm run lint` clean.

**Manual:**
1. Signed out on the landing page `/` — open DevTools Network and confirm
   **no** notification Server Action fires (provider is lazy).
2. Signed out at `/students/<id>` — header renders, no bell, no console error.
3. Signed in at `/dashboard`, desktop — bell in the header between Admin and
   Synergy. At 390px — bell is **gone from the header** and present as the
   6th item in the bottom pill, labelled "Alerts". Labels do not wrap; the
   sliding indicator still animates correctly between the five real tabs.
4. `/admin/notifications` — create an announcement (title, body, href
   `/hackathon`, audience `ALL`). It appears in the table and an `AdminAction`
   row shows in `/admin/actions`.
5. Reload `/dashboard` — badge shows `1`; open the panel; the item is there with
   its link; badge clears; reload and it stays cleared. A second user still sees
   it unread.
6. Mobile panel position: opens **above** the bottom pill and does not sit under
   the sticky header; overlay click and `Escape` both close it.
7. Automated items: with `linkedin-ai-interview` (2026-08-21,
   `registrationOpen: true`) inside its 7-day window, the workshop notification
   appears with no admin action. Temporarily flip `HACKATHON.registrationOpen`
   to `true` locally to confirm the hackathon item, then **revert**.
8. Set an announcement's `expiresAt` in the past → gone from the bell, still in
   the admin table. Deactivate one → gone from the bell.
9. Navigate `/dashboard` → `/jobs` → `/profile` within 60s: only one
   `getMyNotificationsAction` call total (sessionStorage TTL working).
10. With `ENABLE_PROGRAM` unset, no cohort notification is produced.

**Files changed — exactly this set, nothing else:**
```
prisma/schema.prisma
prisma/migrations/<timestamp>_add_notifications/migration.sql
src/features/notification/types.ts
src/features/notification/derive-event-notifications.ts
src/features/notification/get-notifications.ts
src/features/notification/admin-data.ts
src/app/actions/notification-actions.ts
src/app/actions/admin-notification-actions.ts
src/components/shared/notification-provider.tsx
src/components/shared/notification-bell-button.tsx
src/components/shared/app-header.tsx
src/components/shared/bottom-nav.tsx
src/app/layout.tsx
src/components/admin/notification-composer.tsx
src/components/admin/notifications-table.tsx
src/app/admin/notifications/page.tsx
src/app/admin/layout.tsx
src/components/admin/admin-sidebar.tsx
src/components/admin/admin-mobile-nav.tsx
docs/CHANGELOG.md            (one dated line under "## Pending reconcile")
```

---

## 10. Commit message

```
feat(notifications): bell in header and bottom nav with admin + derived updates

Adds Notification + NotificationRead models, a /admin/notifications composer,
and a NotificationProvider serving one bell trigger in AppHeader (desktop) and
one in the mobile bottom pill. Workshop, hackathon and cohort notifications are
derived at read time from existing date sources — no rows, no cron.
```
