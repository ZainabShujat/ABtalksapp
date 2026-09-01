# 103 — Dashboard sidebar "Workshops" → `/workshop`

## 1. Goal
The dashboard sidebar's **Workshops** item currently navigates to `/workshop/events`
(the events listing). It should land on the workshop landing page `/workshop`
instead. One-line href change.

## 2. Current behavior
- `NAV_ITEMS` in `src/components/dashboard-hub/nav-items.ts:49` declares
  `{ label: "Workshops", href: "/workshop/events", icon: "presentation" }`.
- `DashboardSidebar` (`src/components/dashboard-hub/dashboard-sidebar.tsx:78-103`)
  is the only consumer of `NAV_ITEMS`. It renders each item as a `<Link href>` and
  computes active state as:
  `pathname === href || pathname.startsWith(`${href}/`)` (with `/dashboard` special-cased
  to exact match).
- Both routes exist: `src/app/workshop/page.tsx` (landing, Figma rebuild from plan 097)
  and `src/app/workshop/events/page.tsx` (events listing).

### Side effect of the change (desirable, no extra work)
With `href = "/workshop"`, the prefix rule makes the nav item highlight on **both**
`/workshop` and `/workshop/events`. Today it highlights only on the events page.
That is the correct behavior for a section-level nav item — do not add logic to
narrow it back to an exact match.

## 3. Files to touch
- `src/components/dashboard-hub/nav-items.ts` `[edit]` — change the Workshops
  `href` from `/workshop/events` to `/workshop`. Nothing else in this file changes.

That is the complete file list. No other file is edited.

## 4. Server vs Client
- `nav-items.ts` — plain module of constants, no `"use client"`, no component. Not a
  boundary. The exported `NAV_ITEMS` array is serializable data (strings only); the
  `icon` field is an icon **key**, and `dashboard-sidebar.tsx` maps that key to a
  component via its own `ICON_MAP`. Keep it that way — do not put icon components
  into `NAV_ITEMS`.
- `dashboard-sidebar.tsx` — Client Component (`usePathname`). Untouched.

## 5. Steps
1. Open `src/components/dashboard-hub/nav-items.ts`.
2. On line 49, replace `href: "/workshop/events"` with `href: "/workshop"`. Leave
   `label`, `icon`, and array ordering exactly as they are.
3. Done. Do not touch any other line or file.

## 6. Guardrails for Cursor (DO NOT)
- DO NOT touch `src/components/dashboard-hub/events-section.tsx`. Its links
  (`/workshop/events#<id>` for registerable events, `/workshop/events` otherwise,
  lines ~75) point at specific events and are intentionally left on the events page.
- DO NOT change the active-state expression in `dashboard-sidebar.tsx`. The widened
  highlight is intended (see §2).
- DO NOT rename, reorder, or restyle any other `NAV_ITEMS` entry, and do not touch
  the `HUB_*` / `SIDEBAR_*` style constants in the same file.
- DO NOT edit `src/components/not-found/not-found-view.tsx`, the chatbot menu
  (`src/data/chatbot-menu.ts`), `src/data/kb-embeddings.json`, or the workshop
  components — out of scope.
- DO NOT create a new constants/helper file for this. Inline, single-line edit.
- No schema, migration, or seed work. No new abstraction.

## 7. DB safety
Not applicable — no schema or data change.

## 8. Verification
- `npm run build` (or `npx tsc --noEmit`) passes — a string literal change, so a
  clean typecheck is sufficient.
- Manual: sign in, go to `/dashboard`, click **Workshops** in the left sidebar →
  URL is `/workshop`, the Figma landing page renders (not the events listing).
- Manual: on `/workshop` the sidebar item shows the active orange state; navigate to
  `/workshop/events` directly and confirm it still shows active.
- Manual: check the mobile sidebar (hamburger) — same link, and the drawer still
  closes on tap via `onNavigate`.
- `git status` must show exactly one modified file:
  `src/components/dashboard-hub/nav-items.ts`, with a one-line diff.

## 9. Commit message
```
fix(dashboard): point sidebar Workshops nav at /workshop landing page

The sidebar item linked straight to /workshop/events, skipping the workshop
landing page. Point it at /workshop; the existing prefix-based active check
now highlights the item on both routes.
```
