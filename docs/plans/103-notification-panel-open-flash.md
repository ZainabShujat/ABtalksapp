# 103 — Fix notification panel flashing at the viewport left edge on open

## 1. Goal
Stop the notification dropdown from painting one frame flush against the left
edge of the viewport before snapping under the bell. The panel should appear in
its final anchored position on the very first painted frame.

## 2. Current behavior
`src/components/shared/notification-provider.tsx` renders `NotificationPanel`
conditionally (`{open && feed?.signedIn ? <NotificationPanel … /> : null}`,
line 176), so the panel **remounts on every open**. On mount:

1. `isDesktop` is seeded `false` (line 229) and the real breakpoint is only read
   inside `useEffect` (lines 231–237), which runs *after* the browser paints.
2. On that first frame `anchored` is therefore `undefined` (lines 243–253), so
   no inline `top` / `left` / `right` is applied.
3. The class list still applies the desktop classes at ≥768px:
   `md:inset-x-auto md:left-auto md:w-96` (line 272). `inset-x-auto` resolves
   **both** `left` and `right` to `auto`. A `position: fixed` box with
   `left:auto; right:auto` falls back to its static position — and the panel is
   portaled into `document.body`, so that static position is the **left edge of
   the viewport**. That is the frame in the user's first screenshot.
4. The effect then flips `isDesktop` to `true`, `anchored.right` lands, and the
   panel jumps to its correct place (second screenshot).

Because the panel also carries `animate-in fade-in-0 zoom-in-95 duration-150`
(line 268), the wrong-position frame is visible for the whole entrance
animation rather than a single frame — which is why it reads as a visible slide
rather than a flicker.

This fires on **every** open (fresh mount each time), not only after publishing
a notification; it is simply most noticeable right after an admin publish
because that is when the bell gets opened.

## 3. Files to touch
- `src/components/shared/notification-provider.tsx` `[edit]` — seed `isDesktop`
  from `matchMedia` at first render, and give the desktop layout a concrete
  right-edge fallback so `right` is never `auto`.

No other file changes. No new files.

## 4. Server vs Client
- `notification-provider.tsx` — **Client** (`"use client"` already, line 1).
  `NotificationPanel` is a client-only function component inside it.
- No Server→Client prop passing is added or changed. No new props cross the
  boundary.
- Hydration note: `NotificationPanel` never renders on the server or during
  hydration — the provider gates it behind `open`, which only becomes `true`
  from a click in `openPanel`. Reading `window.matchMedia` in a lazy `useState`
  initializer is therefore safe here and cannot produce a hydration mismatch.
  The `typeof window !== "undefined"` guard stays anyway.

## 5. Steps

### Step 1 — seed the breakpoint before first paint
In `NotificationPanel` (around line 229), replace the plain initial value with
a lazy initializer:

```tsx
// Read the breakpoint during the first render, not in an effect: the panel
// remounts on every open, and an effect-only read paints one frame with no
// anchor (which lands the fixed panel at the body's left edge).
const [isDesktop, setIsDesktop] = useState(
  () =>
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 768px)").matches,
);
```

Leave the existing `useEffect` (lines 231–237) exactly as it is — it still
subscribes to `change` and keeps the value correct across resizes. The
`update()` call inside it becomes a redundant no-op on mount; that is fine,
do not restructure it.

### Step 2 — never let `right` compute to `auto` on desktop
In the panel's `className` (line 272), drop `md:inset-x-auto` and give the
desktop case an explicit right inset matching `PANEL_RIGHT_INSET` (40px =
`right-10`):

```tsx
// Desktop: width + a safe right inset — `anchored` overrides `right` inline
// once the bell has been measured.
"md:left-auto md:right-10 md:w-96",
```

Rationale: `md:left-auto` still overrides the mobile `inset-x-3` left value,
`md:right-10` overrides its right value, and the inline `anchored` style (which
sets `left: "auto"` and a numeric `right`) continues to win over both because
inline styles beat classes. With this in place, even a hypothetical
unmeasured frame paints at the top-right — never at the left edge.

Do **not** remove the mobile classes `inset-x-3 top-16 max-h-[70vh]`; the
sub-768px full-width sheet must behave exactly as it does today.

## 6. Guardrails for Cursor (DO NOT)
- DO NOT convert this to a popover/dropdown library, or restructure
  `NotificationProvider`, the portal, the backdrop button, or the anchor-ref
  plumbing. This is a two-line positioning fix.
- DO NOT add `useLayoutEffect` — the lazy `useState` initializer already runs
  before paint and carries no SSR caveat.
- DO NOT create any new file, hook, or util for this. No new abstraction files.
- DO NOT touch `src/components/shared/notification-bell-button.tsx`, the three
  headers that render the bell (`app-header.tsx`,
  `dashboard-hub/dashboard-header.tsx`, `workshop/Header.tsx`), or
  `src/app/layout.tsx`.
- DO NOT change `VIEWPORT_GUTTER`, `PANEL_RIGHT_INSET`, or `PANEL_LEFT_SHIFT`
  values, the `anchored` math, or the entrance animation classes.
- DO NOT touch the feed fetching, the sessionStorage cache, `openPanel`'s
  optimistic read-marking, or `markNotificationsReadAction`.
- DO NOT add a scroll listener / repositioning-on-scroll behaviour — out of
  scope for this fix (see Notes).
- No `any`; strict TS stays clean.

## 7. DB safety
Not applicable — no schema, migration, or data change.

## 8. Verification
Manual, on `localhost:3000/dashboard` while signed in:
1. Desktop viewport (≥768px): click the bell. The panel must appear **directly
   under the bell on the right**, with no frame at the left edge. Repeat 5–6
   times, and once with a hard reload first (fresh mount, empty
   sessionStorage) — the jump must never appear. Confirm again right after
   publishing a notification from `/admin/notifications`, which is the case
   originally reported.
2. Publish a second notification and reopen — still no jump, list shows both.
3. Mobile viewport (<768px, e.g. 390px): panel is still the full-width sheet
   under the header (`inset-x-3 top-16`), unchanged.
4. Resize from mobile to desktop width **with the panel open**: it re-anchors
   under the bell (the `change` listener + `resize` → `measureAnchor` path
   still works).
5. Backdrop click, the X button, and Escape all still close it; the unread
   badge still clears on open.
6. `npx tsc --noEmit` clean and `npm run build` passes.

Exactly one file should show in `git diff`:
`src/components/shared/notification-provider.tsx`.

## 9. Commit message
```
fix(notifications): stop panel flashing at viewport left on open

Seed the panel's isDesktop state from matchMedia during the first render
instead of in an effect, and give the desktop layout an explicit right
inset. The panel remounts on every open, so the effect-only breakpoint read
painted one frame with no anchor and md:inset-x-auto resolving left/right to
auto — which parks a fixed, body-portaled box at the viewport's left edge
for the length of the entrance animation.
```

## Notes (not in scope)
`measureAnchor` is wired to `resize` but not to `scroll`, so an open panel does
not follow the bell when the page scrolls. Separate issue; leave it alone here.
