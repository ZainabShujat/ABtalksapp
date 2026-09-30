# 163 — Admin-run workshops, end to end

## 1. Goal

Let an admin run the entire workshop surface from the admin console — add,
publish, update and archive workshops, attach a poster, show or hide the
calendar, and put the public page into a dedicated "coming soon" state — with no
code change and no deploy. ("Archive", not "remove": hard deletion is only ever
allowed for a workshop with an empty roster — see §9.)
The ten existing workshops are preserved as historical records with their
rosters intact, but the public experience starts fresh.

## 2. Current behavior

Running a workshop today requires a developer.

| Piece | Where it lives | Admin can change it? |
|---|---|---|
| The 10 workshops/events | `src/components/workshop/events-data.ts` — a hardcoded `EVENTS: WorkshopEvent[]`, 630 lines | **No** — code + deploy |
| Registrations (366 rows) | Neon/Prisma `WorkshopRegistration`, keyed by free-form `eventId` string | Read-only view |
| Zoom link, WhatsApp link, webinar date/time, countdown target | **Supabase** `workshop_config`, "a single hand-edited row" | Only by editing Supabase directly |
| `/admin/workshop` | Registrations + Analytics tabs | No event CRUD at all |
| Public `/workshop` | Hero, topics, stats, calendar, registration modal | — |
| Public `/workshop/events` | Timeline; renders `ComingSoonCard` when it runs out | — |

Four facts shape everything below:

1. **`WorkshopEvent.Icon` is a `LucideIcon`** — a React component reference. It
   cannot be stored in a database, and this repo forbids passing icons across
   the Server→Client boundary. The DB stores an icon *name*; a client-side map
   turns it back into a component.
2. **`eventId` is the roster join key and it is free-form text.** 366 rows point
   at three ids (`linkedin-ai-interview` 250, `workshop-2026-09-05` 95,
   `workshop-2026-09-12` 21). `events-data.ts` already warns that reusing an id
   "would silently merge two workshops' rosters". The port must preserve ids
   exactly.
3. **The workshop track spans two databases.** Registrations in Neon, config in
   Supabase. That split is why no admin screen can own the config today.
4. **All ten events are already in the past** — dated 2026-06-01 through
   2026-09-26, against a current date of 2026-09-29. Archiving them hides
   nothing that was still upcoming, which is what makes the fresh-start
   decision below low-risk.

## 3. Point of view

- **The real bug is not "no admin UI", it is that the schedule is source code.**
  Every other symptom follows. Fix the source of truth and the admin screen
  becomes ordinary CRUD.
- **Kill the Supabase dependency as part of this.** A second database holding
  five fields, hand-edited, outside the audit log, is the worst thing in this
  feature. `PlatformConfig` and `src/lib/platform-config.ts` already exist, are
  typed and audited, and have an admin panel at `/admin/settings`. Moving five
  values there deletes an external dependency and makes them console-editable
  for free. Do it once; do not build on Supabase and migrate later.
- **"Remove the landing page" should be a state, not a deletion.** Deleting
  loses SEO, backlinks and the archive. A `mode` of `LIVE` / `COMING_SOON` gives
  the same outcome, is reversible in one click, and cannot leave a dead route.
- **Historical data is not the public schedule.** The ten legacy events are kept
  for their rosters and for the record, and are invisible to the public. The new
  schedule starts empty and shows TBA until an admin publishes something.
- **Do not let an admin type the event id.** It is the roster key. Derive it
  from the date (`workshop-YYYY-MM-DD`, the convention already documented in the
  file), make it immutable after creation, and never render it as an input. A
  typo here silently splits or merges rosters and is not recoverable from the UI.
- **Posters need their own public blob store.** The existing store (`resume2_*`)
  is private by design because résumés carry personal data. Posters must be
  readable logged-out. Add a separate public store; do not relax the résumé
  store's privacy to reuse it.

## 4. Decisions locked

- **Phased**: three mergeable phases, one plan.
- **Poster**: upload to a **public** Vercel Blob store; the event row stores the URL.
- **Coming soon**: the **whole `/workshop` page** becomes a dedicated screen.
- **Existing events**: all 10 are ported into the DB with **ids and registration
  relationships preserved**. They are **historical/archived records only and are
  excluded from the new public workshop experience.** `events-data.ts` is
  retired as a data source.

## 5. Data model

```prisma
model WorkshopEvent {
  /// The roster key. Derived from the date as `workshop-YYYY-MM-DD` and NEVER
  /// editable afterwards: WorkshopRegistration.eventId points here by string,
  /// and changing it detaches the roster. The legacy ids
  /// (`linkedin-ai-interview`, `ai-workshop-live`, `uiux-ai-workshop`, …) are
  /// carried over verbatim and do not follow the convention.
  id               String   @id
  date             DateTime
  timeLabel        String
  title            String
  description      String
  host             String
  location         String
  tag              String
  accent           String
  /// A lucide icon NAME, not a component — a component cannot be stored, nor
  /// crossed over the Server→Client boundary.
  iconName         String
  track            WorkshopTrack
  /// Today a `/public` path (`posterSrc`); from phase 3 a Blob URL. Both are
  /// just URLs to an `<img>`, so one column serves both and the port does not
  /// need to distinguish them.
  posterUrl        String?
  registrationOpen Boolean  @default(true)
  register         Boolean  @default(false)
  externalHref     String?
  ctaLabel         String?
  // Replay + modal content. All optional; a workshop gets them after it runs.
  youtubeId        String?
  duration         String?
  titleAccents     String[] @default([])
  takeaways        String[] @default([])
  topics           String[] @default([])
  /// `{label, href, kind}[]`.
  resources        Json?
  /// Session length in minutes; absent falls back to DEFAULT_DURATION_MIN.
  durationMinutes  Int?
  /// Null until an admin publishes. Nothing unpublished is ever public.
  publishedAt      DateTime?
  /// Set on all ten legacy events by the port. Archived rows keep their
  /// registrations and stay visible in the admin console, and are excluded
  /// from every public surface.
  archivedAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([date(sort: Desc)])
  @@index([publishedAt, archivedAt, date])
}
```

`resources` (past-workshop links) is a small `{label, href, kind}[]` — a `Json`
column is proportionate; do not build a second table.

**Field coverage — checked against the real type, which is wider than an early
draft of this plan assumed.** `WorkshopEvent` in `events-data.ts` has 24 fields
and nearly all are consumed outside that file: `duration` (28 uses), `href`
(10), `youtubeId` (8), `placeholder` (8), `register` (5), `topics` (4), and
`posterSrc` / `takeaways` / `resources` / `ctaLabel` / `titleAccents` (1–2
each). The model above now covers every one. Porting against a narrower model
would have silently dropped replays, takeaways, topics and posters from all ten
historical workshops.

Renames to apply in the seed mapping, deliberately and explicitly:
`time`→`timeLabel`, `desc`→`description`, `posterSrc`→`posterUrl`,
`href`→`externalHref`.

**`placeholder` is NOT a column.** It marks synthetic "Workshop — TBA" entries
generated at runtime by `placeholderSaturdays()`, and is never true for a real
event. Persisting it would invite someone to create a placeholder row. It stays
a runtime-only flag on the generated objects.

**`WorkshopTrack` is a genuinely new enum — checked.** There is no `*Track` enum
in the schema today; `track` is currently the TS union
`"workshop" | "hackathon" | "cohort" | "challenge"` in `events-data.ts`. Two
existing enums carry those same four values and **neither may be reused**:

- **`NotificationCategory`** (`schema.prisma:1731`) has exactly
  `WORKSHOP | HACKATHON | COHORT | CHALLENGE`. It is a **hard-locked Prisma enum**
  owned by Manuvrtti — CLAUDE.md names it explicitly in the notification lock.
  Reusing it would breach the lock and couple the workshop schedule to the
  notification domain. **Do not touch it.**
- **`CertificateType`** (`schema.prisma:638`) is close but is about certificates
  and spells the fourth value `CLAUDE_CHALLENGE`.

So: declare a new `WorkshopTrack`, and do not "helpfully" consolidate it with
either of the above.

**TBA already exists — do not build it.** `placeholderSaturdays(year, month)`
generates synthetic "Workshop — TBA" tiles for every Saturday from
`SATURDAY_SERIES_START` (2026-09-01) with no real event that day, and
`eventsForMonth` merges them into the calendar. Once the ten legacy events are
archived, the calendar fills with TBA on its own. Keep this generator; it is the
mechanism that satisfies "empty means TBA". Note `openWorkshops` deliberately
**excludes** placeholders, so TBA never appears as a registerable card — only as
a calendar tile. Preserve that distinction exactly.

**Lifecycle.** Public eligibility is a single rule, and every public read uses it:

```
eligible = publishedAt != null
       AND archivedAt == null
       AND registrationOpen
       AND date is upcoming
```

Legacy registrations keep working against their original `eventId` strings
regardless — the roster lookup is by id and does not consult this rule.

**Archived means invisible on every public surface, and the consequence was
weighed.** Measured before 1b: the upcoming surfaces are *already* empty today
(all ten events are past, so `upcomingEvents`, `sidebarEvents` and
`getRegistrableEvent` already return nothing). So this decision governs the
archive alone. Going dark takes with it **2 published YouTube replays**
(`ai-workshop-live`, `linkedin-ai-interview`), **5 events carrying takeaways /
topics / resources**, and every calendar tile from June–September. Confirmed and
accepted: the public experience starts genuinely fresh. The content is not lost
— every row and roster stays in the database and in the admin console, and a
future phase could re-publish any of it.

**No foreign key** from `WorkshopRegistration.eventId` to `WorkshopEvent.id` in
phase 1. Adding one is a constraint against 366 existing rows and would fail on
any mismatch. Verify the match first; consider the FK later as its own step.

New `PLATFORM_CONFIG_KEYS` entries, reusing the existing registry:
`workshop.mode` (`LIVE` | `COMING_SOON`), `workshop.calendar_visible`,
`workshop.zoom_link`, `workshop.whatsapp_link`, `workshop.coming_soon_message`.

## 6. Files to touch

### Phase 1 — database becomes the source of truth
- `prisma/schema.prisma` `[edit]` — `WorkshopEvent` + `WorkshopTrack` enum
- `prisma/migrations/<ts>_workshop_events_table/migration.sql` `[new]` — additive only
- `prisma/scripts/seed-workshop-events.ts` `[new]` — one-time port of the 10 events, ids preserved, **`archivedAt` set on every one**
- `src/repositories/workshop.ts` `[new]` — the read/write boundary
- `src/components/workshop/events-data.ts` `[edit]` — keep the type, the `monthAbbr` / `dayNum` helpers and the icon-name→component map; **delete the `EVENTS` array**
- **14 importers of `events-data.ts`, 7 of them Client Components** `[edit]` — see the scope correction below
- `src/features/notification/derive-event-notifications.ts` `[edit]` — **LOCKED path, narrow seam only**, see §8a
- `.github/CODEOWNERS` `[edit]` — add the workshop paths (rule 13; there is no workshop entry today)

#### Scope correction: it is not "three read sites"

An early draft of this plan said three pages read the data. It is **14 files**,
and the shape of the work is a props refactor, not a swap:

| Kind | Files |
|---|---|
| **Client** (read `EVENTS` at module scope — a DB cannot serve them; each needs data threaded from a server parent) | `EventsCalendar`, `EventsTimeline`, `WorkshopHero`, `UpcomingWorkshops`, `WorkshopDetailsModal`, `HackathonPromoModal`, `dashboard-hub/events-section` |
| **Server** | `app/workshop/page.tsx`, `app/workshop/events/page.tsx`, `app/admin/workshop/page.tsx`, `actions/workshop-actions.ts`, `features/dashboard/hub-search-index.ts`, `features/admin/evidence-provenance.ts`, `lib/chatbot/live-facts.ts` |
| **Locked** | `features/notification/derive-event-notifications.ts` |

Seven exported helpers close over the module array and must each take the events
as a parameter instead: `upcomingEvents`, `pastEvents`, `placeholderSaturdays`,
`eventsForMonth`, `openWorkshops`, `sidebarEvents`, `getRegistrableEvent`.
They stay pure functions in `events-data.ts`; only their data source moves.

### Phase 2 — admin CRUD
- `src/app/actions/admin-workshop-actions.ts` `[new]` — create / update / publish / archive
- `src/components/admin/workshop-event-form.tsx` `[new]` (client)
- `src/components/admin/workshop-events-table.tsx` `[new]` (client)
- `src/app/admin/workshop/page.tsx` `[edit]` — a third **Events** tab

### Phase 3 — coming-soon, calendar toggle, posters
- `src/lib/platform-config.ts` `[edit]` — register the new keys
- `src/components/admin/platform-config-panel.tsx` `[edit]` — expose them
- `src/features/workshop/storage.ts` `[new]` — public Blob put/delete
- `src/app/actions/admin-workshop-actions.ts` `[edit]` — poster upload
- `src/components/workshop/WorkshopComingSoon.tsx` `[new]` — the full-page state
- `src/app/workshop/page.tsx` `[edit]` — branch on mode
- `src/components/workshop/EventsCalendar.tsx` `[edit]` — respect the toggle

## 7. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `/workshop`, `/workshop/events`, `/admin/workshop` pages | Server | Read via `src/repositories/workshop.ts` |
| `WorkshopComingSoon` | Server | Static content; no interactivity needed |
| `workshop-event-form`, `workshop-events-table` | Client | Forms and dialogs |
| `EventsCalendar`, `EventsTimeline` | Client (already) | Receive plain serialisable rows |

**Boundary flag:** the DB carries `iconName: string`. The Server→Client props
carry that string, never a `LucideIcon`. The name→component map lives in the
client component. No functions, icons or class instances cross the boundary.

## 8. Steps

### Phase 1

**Phase 1 ships as 1a then 1b, approved separately.**

- **1a — the data operation.** Steps 1–4: schema, migration, seed, 24-field
  round-trip, registration integrity. `EVENTS` stays intact, no consumer or
  importer is touched, the notification module is not touched, and public
  behaviour is unchanged. If the port is wrong, it is found here — before
  fourteen consumers depend on it.
- **1b — the source-of-truth swap.** Steps 5–6 plus §8a: repository,
  parameterised helpers, server parents, client props, the notification seam,
  and only then deleting `EVENTS`. **Do not begin 1b until 1a's verification
  passes and is approved.** 1b is not approved on a green build alone — it needs
  the before/after behavioural comparison, equivalent except for the deliberate
  visibility/TBA change.

**Scope fence.** Phase 1 is items 1–6 below plus §8a and nothing else. It must
not touch admin CRUD, poster upload, Blob infrastructure, the `PlatformConfig`
migration, the coming-soon design, or the calendar toggle. Those are phases 2
and 3. A Phase 1 diff containing `admin-workshop-actions.ts`,
`features/workshop/storage.ts` or `WorkshopComingSoon.tsx` has drifted.

**Stop-and-report rule.** If the port finds an icon name that does not resolve,
a `resources` shape that does not match, or any field that will not round-trip,
**stop and report it. Do not silently fix, coerce or correct the source data.**
A mismatch is a finding, not a chore.

1. Model + additive migration. Nothing existing is altered or dropped.
2. Seed script ports all 10 events, **ids verbatim**, and sets `archivedAt` on
   each. Idempotent (`upsert` by id) so it can be re-run. It prints every id.

   **Derive the rows from the live array; do not retype them.** The script
   `import { EVENTS } from "@/components/workshop/events-data"` and maps over it.
   Hand-copying ten objects is where date, `resources`, `externalHref`,
   `ctaLabel` and `registrationOpen` bugs get in, and they are invisible until a
   past workshop renders wrong months later.

   One field needs real care: **`Icon` is a component, and we are storing a
   name.** Derive it as `event.Icon.displayName ?? event.Icon.name` — lucide
   sets `displayName` — and **assert every one resolved to a non-empty string
   that exists in the icon map** before writing. A silently empty `iconName`
   renders a blank card.

3. **Compare before retiring the array.** With the seed applied and `EVENTS`
   still present, run a check that every event in the array has a `WorkshopEvent`
   row whose `id`, `date`, `title`, `timeLabel`, `host`, `location`, `tag`,
   `accent`, `track`, `iconName`, `externalHref`, `ctaLabel`, `registrationOpen`
   and `resources` match. Only delete the `EVENTS` array once that passes —
   after deletion the comparison is impossible.
4. **Gate before phase 2:** assert every distinct `WorkshopRegistration.eventId`
   matches a `WorkshopEvent.id`. If even one does not, stop — a roster is about
   to detach.
5. Parameterise the seven helpers and rewire all 14 importers (§6 scope
   correction), applying the eligibility rule from §5. Client components receive
   plain serialisable rows from a server parent; none of them reads the data
   itself. With every legacy event archived, the public upcoming surfaces are
   legitimately empty, and `placeholderSaturdays` fills the calendar with TBA.
6. Rewrite `getRegistrableEvent` to the §5 rule. Keep its existing
   "soonest single open event" behaviour — that is what stops two open workshops
   filing both rosters under the earlier one.

### Phase 1a — the notification seam (LOCKED path, approved)

`src/features/notification/derive-event-notifications.ts` imports `EVENTS`
(line 3) and iterates it (line 85). `EVENTS` cannot be retired without it.
**Manuvrtti has approved this specific change.** The approval is narrow and does
not carry to anything else.

**Allowed:** replace the workshop data dependency — `EVENTS` → the workshop
repository read — and make the function async if that requires it.

**Not allowed**, and any of these means stop and report: changing notification
business logic, categories, recipients, templates, timing or schema; touching
`NotificationCategory`; refactoring unrelated notification code; widening the
notification system's scope. Preserve the existing output exactly.

**Proof obligation.** Before and after the swap, run
`derive-event-notifications` over the *same* workshop data and diff the result.
The notification decisions and content must be **byte-identical**. Capture both
runs in the Phase 1 report. A change in output is a failure, not something to
rationalise — the seam is a data-source swap and nothing else.

### Phase 2
7. Actions: `requireAdmin` + Zod + `{ ok, data } | { ok, message }`, each
   writing an `AdminAction` audit row via `writeAudit`.
8. The id is **derived from the date and shown read-only**. Never an input.
9. **Archive, never delete**, for any event with registrations. Deletion only
   when the roster is empty, and the UI must say which case it is in.
10. Mirror existing admin form patterns; `AccountOpsDialog`'s reason-plus-confirm
   is the house style for consequential admin writes.

### Phase 3
11. Register the config keys; expose them in the admin settings panel.
12. Poster upload validates **magic bytes server-side**, not just the extension —
    `src/features/resume/ingest.ts` does exactly this for PDFs and is the pattern
    to copy. Cap the size. Store the returned URL on the event.
13. Retire `getWorkshopConfig()` and the Supabase import once the keys move.
    Leave the cohort-application readers in `workshop-supabase.ts` alone.

## 9. Guardrails (DO NOT)

- **Never let an event id be typed, edited or regenerated after creation.** It is
  the roster key for 366 rows.
- **Do not delete an event that has registrations.** Archive it.
- **Do not surface archived or unpublished events on any public route** — not in
  the calendar, the timeline, the countdown, or `getRegistrableEvent`.
- **Do not fall back to a past or archived workshop when nothing is published.**
  Empty means TBA, never "show the most recent one".
- **Do not store a `LucideIcon`, or pass one from a Server to a Client
  Component.** Store the name; map it on the client.
- **Do not put posters in the résumé Blob store**, and do not make that store
  public. Résumés carry personal data.
- **Do not reuse or modify `NotificationCategory`** for `track`, however well its
  values match. It is a hard-locked enum in Manuvrtti's notification module.
  Declare `WorkshopTrack` — see §5.
- **Do not hard-delete an event to "clean up" the port.** All ten legacy rows
  stay, archived.
- Do not add the `WorkshopRegistration.eventId` → `WorkshopEvent.id` FK in phase 1.
- Do not drop `events-data.ts` wholesale — the type, helpers and icon map stay;
  only the `EVENTS` array goes.
- Do not touch the cohort-application functions in `workshop-supabase.ts`.
- Public surfaces (`/workshop`, `/workshop/events`) stay **public** — no
  `requireAdmin` / `requireRole` on them.
- Server Components by default; mutations via Server Actions, not route handlers.
  Zod at every boundary, `select` on every query, transactions for multi-step
  writes, `lib/logger.ts` never `console`.
- `buttonVariants` on `<Link>`, never `<Button asChild>`.

## 10. DB safety

> **Recorded exception — phase 1a, 2026-09-29.** The Neon branch snapshot this
> section requires was **not taken**: the executor had no Neon API access. 1a ran
> without it. The exposure was limited — the migration is additive (one new
> table, `WorkshopRegistration` untouched, no FK) and the seed is upsert-only
> with no deletes and no writes to any existing table — and the post-run
> verification confirmed 366/366 registrations intact. Recording this as an
> exception rather than implying the checkpoint happened. **Take the snapshot
> before any future phase that mutates existing rows.**


Phase 1 changes data. Before the seed: commit checkpoint, record the hash, take a
**Neon branch snapshot**. The migration is additive (one new table; nothing on
`WorkshopRegistration` is altered), so the risk is the seed, not the schema. The
seed is `upsert`-by-id and idempotent. **Never** `migrate dev` or `migrate reset`
against a database with real rows — `migrate deploy` only.

## 11. Verification

**Phase 1.** `npx prisma migrate deploy`, `npx prisma generate`, then a script asserting:
- 10 `WorkshopEvent` rows exist, ids matching the original array exactly;
- **all 10 have `archivedAt` set**;
- every distinct `WorkshopRegistration.eventId` matches a `WorkshopEvent.id`;
- `WorkshopRegistration.count()` is still **366**.

Plus the two obligations this phase's scope added:
- **Field round-trip** — every one of the 24 fields survives the port for all
  ten events (§8 step 3), run while `EVENTS` still exists.
- **Notification equivalence** — `derive-event-notifications` produces
  byte-identical output before and after the seam swap (§8a). Both runs go in
  the report.

Then, on the public site: **none of the ten legacy events appears** on `/workshop`
or `/workshop/events`, and with nothing published the page shows the TBA /
coming-soon state rather than a stale countdown or a past workshop. The calendar
shows generated "Workshop — TBA" Saturday tiles, and **no TBA tile appears as a
registerable card** (`openWorkshops` excludes placeholders). In
`/admin/workshop`, all ten are still listed with their registration counts.
Build gates: `npm run build`, `npx tsc --noEmit`, `npx eslint` on touched files
— both `tsc` and the build need `NODE_OPTIONS=--max-old-space-size=8192` here.

**Phase 2.** Create a workshop in the console → confirm the derived id and that
it is **not** public while unpublished → publish it → confirm it becomes the
first publicly visible workshop and the TBA state is replaced. Confirm an
`AdminAction` row was written. Attempt to delete one with registrations and
confirm refusal. Confirm a non-admin gets nothing: `/admin/workshop` redirects
and the actions refuse.

**Phase 3.** Flip `workshop.mode` to `COMING_SOON` → `/workshop` becomes the
coming-soon screen with no countdown and no signup; flip back → full
restoration. Toggle the calendar off and on. Upload a poster and confirm it
renders **while logged out** (the public-store check), then try a non-image and
an oversized file and confirm both are refused server-side.

## 12. Ownership

TASK: admin-managed workshops end to end
MODULE: **Workshop is not assigned to anyone** in CLAUDE.md's ownership table. It
straddles Platform Admin, System configuration, Database conventions and Audit
(Sohail) and the public landing's UI/UX (Shallika).
CROSS-MODULE: `/workshop` and `src/components/workshop/*` are visual surfaces —
**get Shallika's sign-off before phase 3**, where the coming-soon design lands.
Phases 1 and 2 are data and admin console. Nothing here touches notifications,
jobs, hire, resume or recruiter paths.

## 13. Commit messages

- `Move the workshop schedule into the database`
- `Let an admin create and archive workshops from the console`
- `Add a coming-soon state, calendar toggle and posters to the workshop page`

## 14. Amendment — finishing the feature (2026-09-29)

To be folded into `docs/plans/163-admin-workshop-management.md` on approval
(plan mode may only write this scratch file). Same branch,
`feat/admin-workshop-management`. **Commits `fe73cc5e` (1a) and `a39c272e` (1b)
stay — nothing here reverts or redoes them.**

## Context

Phases 1a and 1b are done and verified: the schedule lives in `WorkshopEvent`,
all ten legacy events are ported and archived with their 366 registrations
intact, and every consumer reads through `src/repositories/workshop.ts`.

Manual verification then found `/workshop` still showing a workshop. Phase 1
was never meant to deliver admin CRUD or the Coming Soon screen — those are
phases 2 and 3 — so the outstanding items below are mostly *not yet built*
rather than broken. One thing genuinely is broken, and it is not what it looked
like.

## The leak — corrected diagnosis

**No archived row is escaping.** `listPublicEvents()` filters
`publishedAt != null AND archivedAt == null` and correctly returns `[]`;
`getRegistrableEvent` correctly returns `undefined`.

The phantom workshop comes from **fallbacks that fire when there is no event**:

| Source | What it renders |
|---|---|
| `WorkshopHero.tsx:147` `DEFAULT_TITLE` | "Create Anything with AI: From Prompt to Published Content" |
| `WorkshopHero.tsx:144` `DEFAULT_DESC` | a full workshop description |
| `TopicsSection.tsx:169` `DEFAULT_TOPICS` | ten topic capsules |
| **Supabase** `workshop_config` → `config.webinarDate` / `webinarTargetUtc` | a stale date chip, and a countdown that `Math.max(0, …)` freezes at **00:00:00:00** |

So the page advertises a workshop that exists nowhere, with a dead countdown and
a Register button whose action always refuses (`CLOSED_MESSAGE`). It is worse
than a stale row: none of this content is in the database, so no admin can fix
it. This is what phase 1c exists to kill.

`/workshop/events` is already correct — with `[]` it renders `ComingSoonCard`.

## Decisions locked

- **Coming Soon is automatic, with an admin override.** No published upcoming
  event ⇒ Coming Soon, always, with no admin action. `workshop.mode` can force
  it on early. Derived-by-default makes the leak structurally impossible; a
  manual-only toggle is exactly how this bug happened.
- **The hardcoded fallbacks are removed.** Hero and topics render only when
  there is a real published event to describe. No copy is left that can
  describe a workshop nobody scheduled.

## The admin control surface

**Requirement.** The admin controls the public workshop experience end-to-end
without a deployment: creating / editing / publishing / archiving workshops,
managing the poster (upload, replace, **remove**), editing the calendar and its
visibility, and switching `/workshop` between LIVE and a dedicated
COMING_SOON state.

These are **four independent controls**, and keeping them independent is what
stops this becoming a tangle of implicit rules:

```
Workshop
├── lifecycle : DRAFT / PUBLISHED / ARCHIVED   (publishedAt, archivedAt)
├── poster    : present / absent               (posterUrl)
├── calendar  : visible / hidden               (workshop.calendar_visible)
└── page mode : LIVE / COMING_SOON             (workshop.mode + derived)
```

**Poster removal ≠ workshop removal ≠ Coming Soon.** Removing a poster nulls
`posterUrl` and deletes the blob; the workshop row, its lifecycle and its
roster are untouched. A published workshop with no poster still renders LIVE —
the hero simply draws without a poster image.

The one deliberate coupling, and the only one:

| Published upcoming event? | `workshop.mode` | Public page |
|---|---|---|
| yes | `LIVE` (or unset) | full experience |
| yes | `COMING_SOON` | Coming Soon — admin override wins |
| **no** | anything | **Coming Soon** — derived, cannot be overridden into LIVE |

Nothing else feeds the mode. Poster absence never does.

**One definition of "an active public workshop", and it is the existing
eligibility rule** — `publishedAt != null AND archivedAt == null AND
registrationOpen AND date is upcoming`. Do not grow a second notion of "active"
anywhere. A consequence worth stating out loud: an event that is published and
upcoming but has `registrationOpen = false` is **not** eligible, so the page
shows Coming Soon. That is intended — `registrationOpen: false` is the
documented kill switch for a session, and a page offering a signup that the
server will refuse is the bug this whole phase exists to remove.

In the admin UI the two must be visibly distinct actions, not one control with
two meanings:
- **Remove poster** — the poster disappears; the workshop stays LIVE.
- **Show Coming Soon** — the entire hero/workshop presentation disappears.

> **Ambiguity resolved.** The requirement's poster bullet reads "if there is no
> poster / the admin chooses to hide the hero … show Coming Soon instead",
> which can be read as *no poster ⇒ Coming Soon* — the exact coupling the same
> requirement then forbids. Taken as: the **admin's choice** hides the hero
> (that is the mode switch); a missing poster does not. Flagging it rather than
> picking silently.

When COMING_SOON is active the page must surface **no** legacy or archived
workshop, **no** stale countdown, **no** registration CTA and **no** old hero
poster. The calendar stays at the bottom when enabled, showing the existing TBA
placeholders.

## Phase 1c — kill the leak (do this first, ships alone)

Smallest change that makes the public page honest. No new config, no admin work.

- `src/components/workshop/WorkshopHero.tsx` `[edit]` — delete `DEFAULT_TITLE`,
  `DEFAULT_DESC`, `DEFAULT_TITLE_ACCENTS`; the component now requires a real
  event.
- `src/components/workshop/TopicsSection.tsx` `[edit]` — delete `DEFAULT_TOPICS`.
- `src/components/workshop/WorkshopComingSoon.tsx` `[new]` — the dedicated
  screen. Server Component, no interactivity.
- `src/app/workshop/page.tsx` `[edit]` — branch: with no registrable event,
  render header → `WorkshopComingSoon` → **calendar** → footer, and **not** the
  hero, topics, stats, registration modal or `#register` CTA.

The countdown and date chip disappear with the hero, which removes the Supabase
dependency from the empty state without touching `workshop_config` yet — that
retirement stays in phase 3.

**Design note:** the Coming Soon screen is a public visual surface. `ComingSoonCard`
(`src/components/workshop/ComingSoonCard.tsx`) is the existing in-house
treatment — dashed border, orbiting radial glow, floating ✨, bouncing dots —
and the new screen should read as its full-page sibling rather than a new
visual language. **Get Shallika's sign-off on this screen** (UI/UX ownership).

## Phase 2 — admin event management

`/admin/workshop` has Registrations and Analytics. Add **Events**.

- `src/app/actions/admin-workshop-actions.ts` `[new]` — create / update /
  publish / **unpublish** / archive / **unarchive**. `requireAdmin` + Zod +
  `{ ok, data } | { ok, message }`, each writing an `AdminAction` row via
  `writeAudit`. Unpublish and unarchive exist so every lifecycle move is
  reversible from the console; an admin who publishes early must not need a
  developer.
- `src/components/admin/workshop-event-form.tsx` `[new]` (client)
- `src/components/admin/workshop-events-table.tsx` `[new]` (client) — lists all
  events including the ten archived ones, with registration counts.
- `src/app/admin/workshop/page.tsx` `[edit]` — third tab.
- `src/repositories/workshop.ts` `[edit]` — the write functions.

Also **delete**, which the main plan's goal allows but no action provided:
permitted **only when that event's `WorkshopRegistration` count is zero**.
Count and delete in one transaction so a signup landing mid-request cannot slip
through, and refuse otherwise. The UI must make the two cases visibly
different — **Delete** on an empty roster, **Archive** on a registered one,
never one button that quietly does whichever applies.

**Id collision.** On create, derive `workshop-YYYY-MM-DD` and **refuse if that
id already exists** with a clear validation error. Never `upsert` a
newly-created workshop over an existing row — that is how two workshops end up
sharing one roster, the failure `events-data.ts` warned about. The legacy ids
are arbitrary (`linkedin-ai-interview`, `ai-workshop-live`, …) so a derived id
can collide with one only by coincidence, but the check is cheap and the
failure is unrecoverable.

**Date → id must not shift.** Derive the id from the admin's chosen calendar
date as they typed it, not from a UTC conversion of a local `Date`. Picking
2026-10-10 must always give `workshop-2026-10-10`, never `-09` or `-11`. The
stored `date` column follows the port's convention, `new Date(`${iso}T00:00:00Z`)`
— the same one `prisma/scripts/seed-workshop-events.ts` uses and the round-trip
check proved.

Rules (unchanged from the main plan): the id is **derived from the date and
read-only**, never an input; mirror `AccountOpsDialog`'s reason-plus-confirm for
consequential writes.

An admin must be able to create and publish a workshop with no deploy — that is
this phase's acceptance test.

## Phase 3 — configuration, calendar toggle, posters

- `src/lib/platform-config.ts` `[edit]` — register `workshop.mode`,
  `workshop.calendar_visible`, `workshop.zoom_link`, `workshop.whatsapp_link`,
  `workshop.coming_soon_message`.

  **Blocker found:** the registry has `getStringConfig` / `resolveStringConfig`
  but **only `writeIntConfig`** — there is no string writer, so string keys are
  read-only today. `writeStringConfig` must be added, mirroring `writeIntConfig`
  including its audit write. This is a shared config module; it is in my
  ownership (System configuration) but call it out in review.
- `src/components/admin/platform-config-panel.tsx` `[edit]` — expose the keys.
- `src/features/workshop/storage.ts` `[new]` — **public** Blob put/delete,
  modelled on `src/features/resume/storage.ts` but `access: "public"` and a
  **different store**. Validate magic bytes server-side as
  `src/features/resume/ingest.ts` does for PDFs; cap the size.
- `src/app/actions/admin-workshop-actions.ts` `[edit]` — three poster actions,
  deliberately separate from the lifecycle ones:
  - **upload** — store the blob, write `posterUrl`;
  - **replace** — store the new blob, write `posterUrl`, then delete the old
    one *after* the write succeeds, so a failed upload never leaves the
    workshop with neither (the rule `features/resume/service.ts` already
    follows);
  - **remove** — null `posterUrl` and delete the blob. **The workshop row, its
    lifecycle and its roster are untouched**, and the page stays LIVE.
- `src/components/workshop/EventsCalendar.tsx` `[edit]` — respect
  `workshop.calendar_visible`.
- `src/app/workshop/page.tsx` `[edit]` — `workshop.mode` forces Coming Soon on
  top of the automatic rule from 1c.
- Retire `getWorkshopConfig()` and the Supabase import once the keys move. Leave
  the cohort-application readers in `workshop-supabase.ts` alone.

## Guardrails (in addition to the main plan's §9)

- **Do not revert or redo 1a/1b.** Touch the migration, the seed, the snapshot
  or `src/repositories/workshop.ts`'s read path only if a concrete defect is
  found, and report it rather than quietly reworking it.
- **Do not make `/workshop` or `/workshop/events` admin-only or remove them.**
  They stay public — logged-out cold traffic is the point.
- **Do not reintroduce default workshop copy** anywhere. No event means no hero.
- **Do not couple the four controls.** Specifically: removing a poster must not
  archive, unpublish or delete the workshop, and must not put the page into
  COMING_SOON. Archiving must not clear the poster. The only input to the mode
  is `workshop.mode` plus "is there a published upcoming event" — never
  `posterUrl`, never a count of anything else. If the implementation finds
  itself writing `if (!posterUrl) return <ComingSoon/>`, it has gone wrong.
- **Keep `placeholderSaturdays`.** The generated "Workshop — TBA" Saturday tiles
  are the intended calendar behaviour and must survive; `openWorkshops` must go
  on excluding placeholders so TBA never becomes a registerable card.
- **The calendar stays at the bottom of the public page**, in both the normal
  and the Coming Soon state.
- Do not touch notifications beyond the seam already approved and shipped in 1b.
- Do not widen `evidence-provenance`'s optional `workshopEvents` into a required
  field — 19 existing test call sites depend on it being optional.

## Deployment sequence (matters)

1. **1a's migration + seed must run against production before 1b's code ships**,
   or `/workshop` reads an empty table. The seed is self-contained
   (`prisma/content/workshop-events.json`) and idempotent, so it can run first.
2. 1c can ship any time after 1b.
3. Phase 3 retires the Supabase config — do not delete the `workshop_config` row
   until the `PlatformConfig` keys are written and read in production.

## Verification

**1c.** With zero published events, `/workshop` shows the Coming Soon screen and
the calendar, and **no** hero, countdown, topics, stats or Register CTA. Grep the
built page for "Create Anything with AI" — it must be absent. `/workshop/events`
still shows `ComingSoonCard`. Then publish one event (via a temporary DB write
or phase 2) and confirm the full page returns and the countdown targets that
event.

**2.** Create a workshop in the console → confirm the derived id, that it is
**not** public while unpublished, then publish → it becomes the first publicly
visible workshop and replaces Coming Soon. An `AdminAction` row is written.
Deleting one with registrations is refused. A non-admin gets nothing.
`npx tsx prisma/scripts/verify-workshop-events-port.ts` still passes — the ten
archived rows and 366 registrations are untouched by any of this.

**3.** Flip `workshop.mode` to `COMING_SOON` with a published event present and
confirm the override wins; flip back. Toggle the calendar off and on. Upload a
poster and confirm it renders **while logged out**; a non-image and an oversized
file are refused server-side.

**3b — the four controls are independent.** This is the check that catches the
tangle, and each row must be verified on its own:

| Do this | Expect |
|---|---|
| Publish an event with **no** poster | page is **LIVE**, hero renders without a poster image — *not* Coming Soon |
| **Remove** the poster from a published event | still LIVE; the workshop row, `publishedAt` and its roster unchanged |
| Replace a poster | new image renders, old blob gone, `posterUrl` never null in between |
| Archive an event that has a poster | `posterUrl` still set on the row; it is simply no longer public |
| `mode = COMING_SOON` **with** a published event | Coming Soon, and no hero, countdown, CTA or poster anywhere in the markup |
| Hide the calendar while LIVE | calendar gone, hero and CTA untouched |
| No published event, `mode = LIVE` | still Coming Soon — the derived rule cannot be overridden into LIVE |

Then re-run `npx tsx prisma/scripts/verify-workshop-events-port.ts`: the ten
archived rows and all 366 registrations must be untouched by any of it.

Every phase: `npx tsc --noEmit`, `npx eslint` on touched files, `npm run build`
— all three need `NODE_OPTIONS=--max-old-space-size=8192` on this machine. Lint
baseline is 1 pre-existing error in `EventsCalendar.tsx` (`setState` in an
effect, present on master); do not let it grow.

## 15. Phase 2 — admin workshop management

Same branch, `feat/admin-workshop-management`. Folds into
`docs/plans/163-admin-workshop-management.md` §14 on approval.
**Nothing here redoes 1a (`fe73cc5e`), 1b (`a39c272e`) or 1c (`3a9e9aa2`).**

## Context

The schedule is in the database and the public page is honest: with nothing
published, `/workshop` shows Coming Soon and the calendar. But an admin still
cannot create a workshop — `/admin/workshop` has only Registrations and
Analytics. This phase closes that: create → draft → publish → edit → unpublish
→ archive, all from the console, no deploy.

**Verified before starting:** the Coming Soon screen's "Past sessions" link
opens `/workshop/events`, and none of the ten archived workshop titles appear
there. The only "LinkedIn"/"Hackathon" matches in that page are the footer's
social icon and the sidebar nav item. No change needed; the link stays.

## Scope fence

Phase 2 is the Events tab and the lifecycle. **Not** in scope: poster upload,
`PlatformConfig` keys, the calendar visibility toggle, retiring Supabase. Those
are Phase 3. A Phase 2 diff containing `features/workshop/storage.ts` or
`platform-config.ts` has drifted.

## The four controls, and which one this phase builds

```
Workshop
├── lifecycle : DRAFT / PUBLISHED / ARCHIVED   <- Phase 2
├── poster    : present / absent               <- Phase 3
├── calendar  : visible / hidden               <- Phase 3
└── page mode : LIVE / COMING_SOON             <- Phase 3 (override); derived rule already live
```

Keep them independent. Publishing must not touch a poster; archiving must not
clear one.

## Files to touch

- `src/repositories/workshop.ts` `[edit]` — write functions beside the existing
  reads: `createEvent`, `updateEvent`, `setLifecycle`, `deleteEventIfEmpty`,
  `countRegistrations`.
- `src/app/actions/admin-workshop-actions.ts` `[new]` — the Server Actions.
- `src/components/admin/workshop-event-form.tsx` `[new]` (client) — create/edit.
- `src/components/admin/workshop-events-table.tsx` `[new]` (client) — the list,
  with lifecycle buttons per row.
- `src/app/admin/workshop/page.tsx` `[edit]` — a third `TABS` entry, `events`,
  rendering an `EventsTab` beside the existing `RegistrationsTab` /
  `AnalyticsTab`. The tab already lives in the URL; follow that pattern.
- `src/lib/validations/workshop.ts` `[new]` — the Zod schema, shared by the
  action and the form so both agree on the rules.

## Server vs Client

| Component | Kind |
|---|---|
| `/admin/workshop` page, `EventsTab` | Server — reads via `listAllEvents()` |
| `workshop-events-table`, `workshop-event-form` | Client — forms, dialogs, pending state |

The table receives plain rows. `iconName` travels as a string and is rendered
with `WorkshopIcon`; never pass a component (the 1b lesson).

## Steps

### 1. Repository writes

`createEvent` takes the already-validated fields plus the derived id, and
**fails on a duplicate id** — let the unique constraint raise rather than
checking first, then translate it, so two admins racing cannot both pass a
pre-check. `deleteEventIfEmpty` counts registrations and deletes **in one
transaction**, returning a discriminated result so the caller can tell "deleted"
from "refused, N registrations" without a second read.

### 2. Validation — `src/lib/validations/workshop.ts`

Mirrors the columns: `title`, `description`, `host`, `location`, `tag`,
`accent` (hex), `iconName` (must be one of `knownIconNames()`), `track`,
`timeLabel`, `date` (`YYYY-MM-DD`), plus optional `externalHref` (URL),
`ctaLabel`, `youtubeId`, `duration`, `durationMinutes`, `titleAccents`,
`takeaways`, `topics`, `resources`.

**The id is derived from the creation date once, then immutable forever.**
`workshop-${date}` from the `YYYY-MM-DD` string **as typed** — no `Date`
round-trip, which is what shifts a date across a timezone boundary. The stored
`date` column uses `new Date(\`${iso}T00:00:00Z\`)`, the port's convention.

After creation the id is not "derived from the date" at all — it is the roster
key. **Editing the workshop's date updates only the `date` column and never
regenerates the id**, so a session moved from the 10th to the 17th keeps its
registrations. Saying it any other way invites someone to "keep them in sync".

**`registrationOpen` is an editable boolean on the form**, independent of
lifecycle. Publishing an event with it false is allowed — the eligibility rule
then correctly keeps it out of the public experience — but the admin UI must
say so plainly ("Published · registration closed — not publicly visible"),
because otherwise publishing looks like it silently failed.

`iconName` validated against `knownIconNames()` so an unknown name cannot be
saved — the guard that makes the blank-card failure impossible rather than
merely unlikely.

### 3. Actions — `src/app/actions/admin-workshop-actions.ts`

`requireAdmin` first, Zod second, `{ ok, data } | { ok, message }` out, one
`writeAudit` row per mutation inside the same transaction as the write.

**Deletion's audit row must outlive the event.** `AdminAction` stores
`entityType` / `entityId` as plain strings with no foreign key, so the row
survives — but the *contents* must not depend on reading the event back. Copy
the id, the title and the reason into the audit row's `previousState` before
the delete, in the same transaction. An audit trail that loses the name of what
was deleted is not an audit trail.

| Action | Notes |
|---|---|
| `createWorkshopAction` | derived id; a collision returns "A workshop already exists on that date" rather than overwriting |
| `updateWorkshopAction` | id immutable; changing the date does **not** re-derive it |
| `publishWorkshopAction` / `unpublishWorkshopAction` | sets/clears `publishedAt` |
| `archiveWorkshopAction` / `unarchiveWorkshopAction` | sets/clears `archivedAt` |
| `deleteWorkshopAction` | only at zero registrations; refuses otherwise with the count |

Each calls `revalidatePath("/admin/workshop")` and `revalidatePath("/workshop")`
— the public page is a Server Component reading the same table, so a publish
must be visible without a deploy, which is the whole point of the phase.

### 4. UI

**Table** lists every event, newest first, with title, date, track, lifecycle
badge (Draft / Published / Archived) and registration count. The ten legacy
events appear here, archived, with their counts — that is the "preserved and
admin-visible" requirement.

**Delete vs Archive must look different.** A row with registrations shows
**Archive** only, and says why Delete is unavailable ("250 registrations —
archive instead"). A row with none shows **Delete**. Never one button that
silently picks. Both go through `AccountOpsDialog`'s reason-plus-confirm shape,
the house style for consequential admin writes.

**Form** is one component for create and edit; on edit the id is shown
read-only with a note that it is the roster key. Date changes do not move it.

## Guardrails (DO NOT)

- **Never let the id be typed, edited, or re-derived after creation.** It is the
  roster key for 366 rows.
- **Never upsert on create.** A collision is an error, not a merge.
- **Do not hard-delete an event with registrations**, and do not offer the
  button.
- Do not derive the id via a `Date` object — string in, string out.
- Do not touch poster, config or calendar-visibility code; Phase 3.
- Do not alter the public eligibility rule or `placeholderSaturdays`.
- Do not modify the 1a migration, the seed, `prisma/content/workshop-events.json`
  or the read path in `src/repositories/workshop.ts` unless a concrete defect is
  found — report it instead.
- Do not touch notifications beyond the seam already shipped in 1b.
- Server Actions not route handlers; `select` on every query; `lib/logger.ts`
  never `console`; `buttonVariants` on `<Link>`.

## Verification

**The lifecycle, end to end:**

The test event must be **future-dated, `registrationOpen = true`, not
archived** — otherwise publishing correctly leaves the page on Coming Soon and
the test looks like a failure when the rule is working.

```
create → derived id shown, saved as DRAFT
       → /workshop still Coming Soon          (not public while unpublished)
publish → /workshop shows the full experience  (hero, topics, countdown, CTA)
edit    → change the title; public page follows, id unchanged
unpublish → /workshop back to Coming Soon
archive → stays listed in admin, absent from public
```

**The delete/archive rules:**

| Case | Expect |
|---|---|
| `linkedin-ai-interview` (250 registrations) | Delete unavailable; Archive offered with the count |
| a fresh event, no registrations | Delete works |
| the ten legacy events | still listed in admin, archived, counts intact |
| after all of it | `verify-workshop-events-port.ts` all-pass, **366** registrations |

**Authorisation:** a non-admin gets redirected from `/admin/workshop`, and every
action refuses. **Audit:** each mutation leaves an `AdminAction` row naming the
actor, the event and the reason.

**Id rules:** creating a second workshop on a date that already has one is
refused with a clear message, not an overwrite. A date near midnight still
derives the id for the day the admin picked.

Build gates each step: `npx tsc --noEmit`, `npx eslint` on touched files,
`npm run build` — all with `NODE_OPTIONS=--max-old-space-size=8192`. Lint
baseline is the 1 pre-existing `EventsCalendar.tsx` error; do not let it grow.

**Browser verification runs the lifecycle twice — as admin, and as a logged-out
visitor.** The point of the feature is that a public visitor sees
database-driven state, and only the logged-out pass proves that:

| Admin does | Logged-out `/workshop` shows |
|---|---|
| create (draft) | Coming Soon |
| publish | the real workshop |
| edit the title | the new title |
| unpublish | Coming Soon |
| archive | Coming Soon, and it stays listed in admin |

**Do not raise the PR at the end of Phase 2.** That browser pass comes first.

## 16. Phase 3a — the hero's date, time and countdown come from the event

### The bug, found in the Phase 2 browser pass

A workshop published for **2026-09-30** renders correctly in the upcoming card
and the calendar, but the hero's date badge still reads **12 September 2026**.

`src/app/workshop/page.tsx` passes the hero three values from the **Supabase**
`workshop_config` row, not from the event:

```tsx
webinarDate={config.webinarDate}         // "September 12, 2026"
webinarTime={config.webinarTime}
webinarTargetUtc={config.webinarTargetUtc}   // drives CountdownTimer
```

So the page has two sources of truth for "when is the workshop", and they
disagree. The hero is the largest thing on the page, so the wrong one is the
one visitors read. It is the same class of defect as phase 1c's hardcoded
title — content about a workshop that does not come from the workshop.

### The fix

**The event is the single source of truth for workshop identity, date, time,
title, description, topics, registration state and countdown.** All three hero
values derive from the eligible published event, and no new date logic is
needed — `events-data.ts` already has the pieces:

| Hero prop | Derived from |
|---|---|
| `webinarDate` | `fullDate(event.date)` — "30 Sep 2026" |
| `webinarTime` | `event.time` (the event's `timeLabel`) |
| `webinarTargetUtc` | `new Date(eventStartMs(event)).toISOString()` |

`eventStartMs` already parses `date` + `time` against a fixed `+05:30`, because
IST observes no daylight saving. It is what `openWorkshops` and `eventStatus`
already use, so the hero, the sidebar and the registration gate finally agree
on one instant instead of three.

Files: `src/app/workshop/page.tsx` `[edit]`. The hero component itself does not
change — it already takes these as props.

### Supabase retirement — ordering

After 3a, `getWorkshopConfig()` still supplies `whatsappLink` (the registration
modal) and `zoomLink`. **Do not delete the `workshop_config` row or the reader
until those two have `PlatformConfig` replacements written and verified in
production.** Retiring the config is the last step of phase 3, not the first —
a missing WhatsApp link is a broken registration flow.

### Verification

Publish an event dated well in the future with a distinctive time, then check
`/workshop` **logged out**:
- the hero date badge matches the event's date, not the Supabase one;
- the countdown counts to that event's start instant, and is not frozen at
  00:00:00:00;
- the upcoming card, the calendar tile and the hero all name the same date.

Then change the event's date in the admin console and confirm all three move
together. The regression this guards against is exactly one of them not moving.

## 17. Phase 3b / 3c — posters, config, calendar, Supabase retirement

Same branch, `feat/admin-workshop-management`. Folds into
`docs/plans/163-admin-workshop-management.md` on approval.

**Complete and not to be redone:** 1a `fe73cc5e`, 1b `a39c272e`, 1c `3a9e9aa2`,
2 `b2e020d4`, 3a `d160beab`.

## Context

The feature works end to end except for the parts Phase 2 deliberately stopped
before. The admin Events form has no poster control, there is no calendar
toggle, no admin-settable workshop config, and `/workshop` still reads
`whatsappLink` from Supabase. 3b adds all of that; 3c retires Supabase, but only
once the replacements are proven.

## The independence that shapes everything

```
                    WORKSHOP EVENT
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
     Content          Schedule          Poster
   title/topics     date + time        posterUrl
                         ↓
                     Countdown
```

- A poster does not start the timer.
- A poster does not decide Coming Soon.
- Calendar visibility does not affect the timer.
- The timer does not come from Supabase.

**The event's date and time IS the timer.** 3a already made that true; 3b must
not undo it. There is no "start timer" control and no countdown field — the
target is `eventStartMs(event)`, which parses `date` + `timeLabel` against a
fixed `+05:30`. Change either in the admin and the public countdown follows.

## Phase 3b

### 1. Public blob store

`src/features/workshop/storage.ts` `[new]`, modelled on
`src/features/resume/storage.ts` but **`access: "public"` and a different
store**. Follow that file's env convention exactly — names read through
`process.env[NAME]` and the token passed explicitly on every call, because the
SDK's default `BLOB_*` lookup finds nothing here:

```
workshop_READ_WRITE_TOKEN
workshop_STORE_ID
```

**Prerequisite, and it is infrastructure, not code:** that store has to be
provisioned and the variables set. Mirror `isStorageConfigured()` so an unset
token logs a warning and refuses the upload cleanly rather than throwing — an
admin sees "poster storage is not configured", not a 500.

Pathname `workshops/<eventId>/<sha256>.<ext>` — content-addressed and derived
entirely from server values, so nothing a caller sends can steer it.

### 2. Validation — images only, by content

`src/features/workshop/poster.ts` `[new]`. Size first, then bytes, the order
`resume/ingest.ts` uses so a huge file is rejected without inspection. Magic
bytes, not the extension or the browser's `Content-Type`:

| Format | Leading bytes |
|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| WebP | `52 49 46 46` … `57 45 42 50` at offset 8 |

Cap at **4 MB**. Anything else is refused server-side.

### 3. Poster actions — separate from lifecycle

In `src/app/actions/admin-workshop-actions.ts` `[edit]`, taking `FormData`
(binary cannot go through a JSON action):

- `uploadWorkshopPosterAction` — store, then write `posterUrl`.
- `replaceWorkshopPosterAction` — **store the new blob, write `posterUrl`, then
  delete the old one.** In that order, so a failed upload never leaves the
  workshop with neither; the rule `features/resume/service.ts` already follows.
- `removeWorkshopPosterAction` — null `posterUrl`, delete the blob. **Touches
  nothing else**: not `publishedAt`, not `archivedAt`, not the roster.

Each `requireAdmin`, writes an `AdminAction`, and revalidates.

**Create-then-upload.** There is no event id before the workshop exists, so on
create the form holds the chosen file and uploads it immediately after
`createWorkshopAction` returns the id — one button, two calls. If the second
fails the workshop still exists without a poster, which the admin fixes by
editing. Deliberately no temp-key staging: a temp bucket needs a sweeper, and
the recoverable failure is cheaper than the machinery.

### 4. Form — a Poster section

`src/components/admin/workshop-event-form.tsx` `[edit]`, grouped as asked:
Workshop details → Registration → Content → **Poster**. The section shows the
current poster preview when present, Upload or Replace, and Remove; and says
plainly that a poster is optional and that removing one leaves the workshop
live. Never required.

### 5. Config

`src/lib/platform-config.ts` `[edit]` — five keys in the existing registry:

| Key | Kind | Default |
|---|---|---|
| `workshop.mode` | string | `LIVE` |
| `workshop.calendar_visible` | int (0/1) | `1` |
| `workshop.zoom_link` | string | `""` |
| `workshop.whatsapp_link` | string | the current Supabase fallback |
| `workshop.coming_soon_message` | string | `""` |

`calendar_visible` is an **int 0/1** rather than a string, because the registry
has no boolean kind and inventing one is a bigger change than reading `=== 1`.

**`writeStringConfig` must be added** — the registry has `getStringConfig` and
`resolveStringConfig` but only `writeIntConfig`, so string keys are read-only
today. Mirror `writeIntConfig` exactly: validate against the spec, upsert and
`writeAudit` in one transaction, same `PLATFORM_CONFIG_UPDATE` action type. Do
not build a second config mechanism.

Expose them through the existing `src/app/actions/admin-config-actions.ts`
`[edit]` and `src/components/admin/platform-config-panel.tsx` `[edit]` on
`/admin/settings` — no new settings page.

### 6. Mode and the calendar

`src/app/workshop/page.tsx` `[edit]`:

```
eligible published upcoming event?
        no  -> Coming Soon, whatever mode says
        yes -> mode === "COMING_SOON" ? Coming Soon : full experience
```

The derived rule cannot be overridden into LIVE — that is what makes the phase
1c leak structurally impossible. `workshop.calendar_visible` gates the calendar
section **independently**, in both states. `WorkshopComingSoon` takes the
`coming_soon_message` it already accepts.

## Phase 3c — Supabase retirement, last

**Local success is not the gate.** 3c is not complete because the code works on
a dev machine: the `PlatformConfig` replacements must be verified **in the
production environment** first, because that is where the rows and the env
actually differ. Until then 3c stays unmerged.

Only once 3b's replacements are verified **in production**:

1. `whatsappLink` reads `workshop.whatsapp_link`; verify the registration modal
   and the logged-out registration flow still work.
2. `zoomLink` likewise, if anything public still needs it.
3. Confirm no workshop page code reads `workshop_config` for scheduling — 3a
   already removed the date, time and countdown.
4. Retire `getWorkshopConfig()` and its import from `src/app/workshop/page.tsx`.
5. **Leave the cohort-application functions in `workshop-supabase.ts` alone.**
6. **Do not delete the `workshop_config` row** until production confirms the
   replacements work. Code first, data last.

## Guardrails (DO NOT)

- Do not let poster presence decide Coming Soon, or calendar visibility affect
  the timer, or either affect lifecycle.
- Do not let archiving delete a poster, or removing a poster unpublish anything.
- Do not reintroduce `webinarDate` / `webinarTime` / `webinarTargetUtc`, or any
  Supabase value, into the schedule or countdown.
- Do not add a countdown-start field or a "start timer" control.
- Do not put posters in the résumé store, and do not make that store public.
- Do not change the event id, derive it from a `Date`, or bring back `EVENTS`.
- Do not modify `WorkshopRegistration`, add a foreign key, or touch
  `NotificationCategory` or notification logic beyond the 1b seam.
- Keep `/workshop` and `/workshop/events` public.
- Do not redo 1a/1b/1c/2/3a.

## Verification

Run the numbered list in full; these are the ones that catch coupling:

| # | Check |
|---|---|
| 1 | future event, **no poster** → publishes, hero renders, **not** Coming Soon |
| 2 | upload → poster visible **logged out** |
| 3 | replace → new poster live, old blob gone |
| 4 | remove → **still LIVE**, hero intact, poster gone |
| 5–6 | change date, then time → hero, calendar and countdown all follow |
| 7–8 | calendar OFF → section gone, hero intact; ON → back, TBA tiles work and are not registerable |
| 9 | `mode = COMING_SOON` with a published event → Coming Soon: no hero, countdown, CTA or poster |
| 10 | `mode = LIVE` with no eligible event → **still Coming Soon** |
| 11 | `registrationOpen = false` → not eligible → Coming Soon |
| 12 | countdown target is the event's instant; no Supabase value participates |
| 13 | WhatsApp / registration still works after the config move |
| **14** | **two published upcoming events** — see below |

**14. Multiple published events.** This feature has had several
"two sources of truth" bugs, so the selection logic gets its own test rather
than being assumed. Publish two future events on different dates:

- the hero uses the **same** event `getRegistrableEvent` / `openWorkshops`
  select — not "the first row", not "the newest";
- the countdown matches **that** event;
- the calendar shows **both**;
- the registration CTA points at the selected one.

Then close registration on the **earlier** one:

- it stops being eligible;
- the hero and countdown move to the **next eligible** event — the page must
  **not** fall to Coming Soon while a later event is still open;
- the calendar still shows both.

Then archive the earlier one: the next eligible event becomes the hero event.

Then `npx tsx prisma/scripts/verify-workshop-events-port.ts` — 10/10 events,
**10/10 archived**, 366/366 registrations — plus `tsc --noEmit`, `npm run build`
and eslint on touched files, all with `NODE_OPTIONS=--max-old-space-size=8192`.

> **Re-archive `workshop-2026-09-26` before the final verification.** It is
> currently a **draft** — its `archivedAt` was cleared during the Phase 2
> browser pass — so the script reports 9/10. The documented end state is
> **10/10 archived**, and a 9/10 run must not be accepted as success. It has no
> registrations and drafts are not public, so the fix is a one-field restore,
> not a data repair.

**No PR.** Report files changed, commit hash, poster storage behaviour, the
timer's source and timezone, config changes, remaining Supabase dependencies,
every verification result, and anything still needing a browser.
