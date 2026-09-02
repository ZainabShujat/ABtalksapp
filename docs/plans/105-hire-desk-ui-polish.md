# 105 — Hire desk UI polish: checklist, card click target, flat card, shortlist pill

## 1. Goal
Four contained UI fixes on the `/hire` desk (Scout view): hide the requirement
checklist until something is actually captured and then show only the ticked
items, make the whole candidate card open the inspector, remove the peach
gradient wash from the card, and stop the floating Shortlist pill from covering
the composer on desktop. No behaviour, data or copy changes beyond these.

## 2. Current behavior

**Checklist (`.scout-criteria`).** `ScoutChat` renders all nine criteria as a
horizontal strip under the composer at all times — greyed when unmet, green
(`is-on`) when met. So a recruiter who has typed nothing still sees nine grey
labels, and the strip permanently costs the composer a row of height.
`criteria[]` is derived from `spec` plus `detectSpoken(...)`, and `detectSpoken`
already includes the **live, unsent** textarea value (`text`), so ticks light up
as the recruiter types.

**Card click target.** `DeskMatchCard` renders `<article className="desk-card">`
with no click handler; the only way into the inspector is the small
"View more details" ghost button in the CTA row. The card also contains three
other interactive controls — `DeskShortlistButton` ("Save for later"),
`ShortlistButton` ("Add to Shortlist") and `RequestIntroButton`
("Request intro" / "Contact shared") — plus, on the locked-preview variant,
`LockedField` reveal buttons.

**Card gradient.** `.hire-app .desk-card::before` paints two radial gradients
(orange → peach → transparent) over the whole card, with a separate dark-mode
version and a stronger pair for `desk-card--top`. `isolation: isolate` on the
card and `z-index: 1` on its children exist only to keep content above that
layer.

**Shortlist pill (`.hire-podbar`).** Rendered by `HireChrome` as a sibling of
`<main>` whenever the shortlist is non-empty and the desk is on the Scout view.
It is `position: fixed; bottom: 22px; z-index: 90`, centred. On the desk the
composer sits at the bottom of a `100dvh` shell — field bottom edge ≈ 37px above
the viewport bottom (20px region padding + 16px composer padding + 1px border) —
so the ~54px-tall pill lands directly on the search field. The same collision was
already fixed **only** for ≤900px, at `hire-scout.css:4033`
(`.hire-app--desk:has(.hire-podbar) .scout-composer { padding-bottom: 74px; }`),
which reserves space *under* the composer on phones. Desktop was never fixed.

Out of scope, and deliberately untouched: `MatchCard` (the non-desk card used by
`/hire/matches` and `/hire/[requestId]/candidates`), the Requirement dropdown
menu in the Scout toolbar (it keeps listing all nine criteria with on/off state),
and the ≤900px podbar behaviour.

## 3. Files to touch
- `src/components/hire/scout-chat.tsx` `[edit]` — render the checklist only when
  at least one criterion is met, and only the met ones.
- `src/components/hire/desk-match-card.tsx` `[edit]` — whole-card click opens the
  inspector, with a guard for nested interactive elements.
- `src/app/hire/hire-scout.css` `[edit]` — delete the card gradient layers, add
  the clickable-card cursor, add the desktop podbar offset.

No new files. No server code, no schema, no actions.

## 4. Server vs Client
- `src/components/hire/scout-chat.tsx` — **Client** (`"use client"`, already).
- `src/components/hire/desk-match-card.tsx` — **Client** (`"use client"`, already).
- `src/app/hire/hire-scout.css` — plain stylesheet imported by the Server
  Component `src/app/hire/layout.tsx`.

No Server→Client prop passing changes. No new props cross the boundary.

## 5. Steps

### Step 1 — checklist: hidden until met, and only the met items
File: `src/components/hire/scout-chat.tsx`

1a. Just above the `return (` of `ScoutChat` (after `resetDesk`), add one derived
list — no new file, no helper module:

```tsx
// The strip is feedback, not a form. Nine grey labels under an empty composer
// tell the recruiter nothing and cost the field a row of height, so the strip
// only appears once something has actually been captured, and only shows what
// was captured. `criteria` itself stays whole — the Requirement menu still
// lists all nine with their on/off state.
const metCriteria = criteria.filter((c) => c.on);
```

1b. Replace the `<ul className="scout-criteria">…</ul>` block at the end of the
`<form className="scout-composer">` (currently `scout-chat.tsx:1096–1109`) with a
conditional render over `metCriteria`:

```tsx
{metCriteria.length > 0 && (
  <ul
    className="scout-criteria"
    aria-label="Requirements captured"
    ref={criteriaRef}
  >
    {metCriteria.map((c) => (
      <li key={c.key} className="scout-criterion is-on">
        <span className="scout-criterion__box" aria-hidden="true">
          ✓
        </span>
        <span>{c.key}</span>
      </li>
    ))}
  </ul>
)}
```

Notes for the executor:
- Every rendered item is met, so `is-on` is now unconditional — the `cn(...)`
  call on the `<li>` goes away. Keep the class name exactly `"scout-criterion is-on"`.
- Do **not** touch `criteria`, `tickSignature`, or the `useEffect` that scrolls
  the newest tick into view. That effect already returns early when
  `criteriaRef.current` is null, which is the new hidden state.
- Do **not** touch the `hire-req__menu` block that maps over `criteria` — the
  Requirement dropdown keeps showing all nine.
- No CSS change is needed for this step. The composer is `flex: none` at the
  bottom of a flex column, so dropping the strip shortens the composer and the
  field takes the freed space; adding it back pushes the field up. That is the
  "search bar shifts up to make room" behaviour, and it falls out of the layout.

### Step 2 — the whole card opens the inspector
File: `src/components/hire/desk-match-card.tsx`

2a. Inside `DeskMatchCard`, after the existing `const skills = e.skills ?? [];`,
add the handler (plain function in the component — no new file, no `useCallback`):

```tsx
// The card is the click target, not just the "View more details" link.
// Everything interactive inside it — the two shortlist buttons, the intro
// button, the locked-field reveals — must keep its own click, and a click that
// ends a text selection is a read, not a request to open the panel.
function openFromCard(event: React.MouseEvent<HTMLElement>) {
  if (!onOpen) return;
  const target = event.target as HTMLElement;
  if (target.closest("button, a, input, label, select, textarea, [role='button']")) {
    return;
  }
  if ((window.getSelection()?.toString() ?? "").length > 0) return;
  onOpen();
}
```

`MouseEvent` comes from React's namespace — the file has no React import today,
so use `import type { MouseEvent } from "react";` and type the parameter
`MouseEvent<HTMLElement>` rather than adding a default React import.

2b. Apply it to all three `<article>` returns in this file, keeping each
element's existing classes and adding the click affordance only when `onOpen`
exists:

- locked preview (`desk-card desk-card--locked`)
- sample (`desk-card desk-card--sample`)
- real match (the `cn("desk-card", rank === 1 && "desk-card--top", selected && "is-selected")` call)

Each becomes, e.g. for the real match:

```tsx
<article
  className={cn(
    "desk-card",
    rank === 1 && "desk-card--top",
    selected && "is-selected",
    onOpen && "desk-card--clickable",
  )}
  onClick={openFromCard}
>
```

and for the two that currently use a plain string className, switch them to
`cn("desk-card", "desk-card--locked", onOpen && "desk-card--clickable")` /
`cn("desk-card", "desk-card--sample", onOpen && "desk-card--clickable")`. `cn` is
already imported.

2c. Keep the "View more details" button exactly as it is in all three variants —
it is the keyboard-accessible path into the inspector, and it stays the visible
affordance. Do **not** add `role="button"`, `tabIndex` or a keyboard handler to
the `<article>`: it wraps real buttons, and making it a focusable button too
would nest interactive controls and add a duplicate tab stop. Do **not**
convert the article into a `<button>` or wrap it in a `<Link>`.

### Step 3 — flat card (remove the gradient)
File: `src/app/hire/hire-scout.css`

3a. Delete these four rule blocks in full (line numbers as of this plan):
- `.hire-app .desk-card::before { … }` — `1158–1176`
- `html.dark:not(:has(.theme-abtalks-light)) .hire-app .desk-card::before { … }` — `1178–1191`
- `.hire-app .desk-card.desk-card--top::before { … }` — `1208–1221`
- `html.dark:not(:has(.theme-abtalks-light)) .hire-app .desk-card.desk-card--top::before { … }` — `1223–1236`

3b. Delete the two declarations that existed only to stack content above that
layer:
- `isolation: isolate;` from `.hire-app .desk-card` (line `1146`)
- the whole `.hire-app .desk-card > * { position: relative; z-index: 1; }` block
  (`1193–1196`)

3c. Change nothing else on the card. `position: relative`, `overflow: hidden`,
the border, the `background: var(--h-surface)` and the existing box-shadows all
stay. `desk-card--top` keeps its border colour and shadow, which is now the only
thing marking the top match — that is intended. `desk-card--sample` keeps its
dashed border.

3d. Add the clickable cursor, immediately after the
`.hire-app .desk-card.is-selected { … }` block:

```css
/* The card body is a click target for the inspector (see DeskMatchCard).
   The controls inside it keep their own cursors and their own clicks. */
.hire-app .desk-card--clickable {
  cursor: pointer;
}
```

Do **not** add a hover transform or a new hover shadow — `.desk-card:hover`
already changes border colour and shadow.

### Step 4 — the Shortlist pill clears the composer on desktop
File: `src/app/hire/hire-scout.css`

Add a new block immediately after `.hire-podbar__close:hover { … }` (ends line
`1868`), before `.hire-req {`:

```css
/* Desktop: float the pill above the composer, not on top of it.

   The desk is a 100dvh shell, so the composer's field sits ~37px off the bottom
   of the viewport and a pill fixed at bottom:22px lands squarely on the field
   someone is about to type into. Phones already solve this below 900px by
   reserving space under the composer (see the max-width:900px block) — that
   rule stays as it is. Here the pill moves up instead, clearing the field and
   the checklist strip when the strip is on screen. */
@media (min-width: 901px) {
  .hire-podbar {
    bottom: 96px;
  }

  .hire-app--desk:has(.scout-criteria) .hire-podbar {
    bottom: 124px;
  }
}
```

Notes for the executor:
- The two offsets track the composer's two heights, which is why they are tied
  to `:has(.scout-criteria)` — after Step 1 the strip is present only when
  something has been captured. Keep the `:has()` selector rooted on
  `.hire-app--desk` (the pill is a fixed sibling; the strip is a descendant of
  the shell, not of the pill).
- Do **not** edit `.hire-app--desk:has(.hire-podbar) .scout-composer { padding-bottom: 74px; }`
  inside the `@media (max-width: 900px)` block. Mobile is already correct.
- Do **not** change `.hire-podbar`'s `position`, `z-index`, `left`/`transform`,
  colours, or the `@media (max-width: 900px)` override at line `2290`.
- Do **not** move the podbar's JSX in `hire-chrome.tsx`. This is a CSS-only fix.

## 6. Guardrails for Cursor (DO NOT)
- Do **not** touch `middleware.ts`, `auth.config.ts`, `auth.ts`, or anything on
  the edge import path. None of these files are near it.
- Do **not** add `requireRole` / `requireAdmin` anywhere — no auth surface is
  involved here.
- Do **not** create any new file, component, hook, or util. Every change lands in
  the three files listed in §3.
- Do **not** change the Scout conversation engine: `criteria`, `detectSpoken`,
  `REQUIREMENT_ASK`, `EMP_FILTERS`, `pickRequirement`, `chips`, `send`,
  `runSearch` and the Requirement dropdown all stay exactly as they are.
- Do **not** change `MatchCard`, `MatchResults`, `CandidateInspector`,
  `hire-chrome.tsx`, or any shortlist/engagement action. No data or query
  changes, no Prisma, no server actions.
- Do **not** make the `<article>` focusable or convert it to a button/link, and
  do **not** remove the "View more details" button.
- Do **not** delete or restyle `.virtual-candidate` / `VirtualCandidateCard`
  gradients — the sample "requirement drawn as a card" is deliberately not a
  flat card, and §3 only removes `.desk-card::before`.
- Do **not** append to `docs/CHANGELOG.md`. This is cosmetic — the `.cursorrules`
  rule says one line only for schema / business rule / env / convention changes.
- Do **not** run migrations, seeds or cleanup. Nothing here touches the database.

## 7. DB safety
Not applicable — no schema, migration, seed or data change.

## 8. Verification

Run the desk at `/hire` signed in as an approved recruiter (or as a guest for the
card checks), with `npm run dev`.

**Checklist**
1. Fresh `/hire`, nothing typed: no strip under the composer, and the field +
   Search button sit at the bottom of the Scout card with no empty row below.
2. Type `senior backend engineer in Bangalore` **without sending**: the strip
   appears with green ticks for Role / Years of Experience / Location (and
   Skills once a stack word is typed), and nothing grey. The field visibly moves
   up by one row as the strip appears.
3. Clear the field again → the strip disappears only if nothing has been
   captured yet; after a real answer has been sent, the captured items stay.
4. Open the Requirement dropdown: it still lists all nine, ticked and unticked.
5. Narrow to 390px: the strip is still a single horizontal scrolling row when
   present, and the newest tick scrolls into view.

**Card**
6. Run a search that returns at least one candidate. Click the card's blank
   areas — the avatar, the name, the rationale paragraph, a skill pill, the
   score — and the inspector opens each time.
7. Click "Save for later", "Add to Shortlist" and the intro button: each does its
   own thing and the inspector does **not** open. Same for the reveal buttons on
   a locked-preview card.
8. Select the rationale text with a drag and release: the inspector does not open.
9. "View more details" still works, and is still reachable and operable by
   keyboard (Tab to it, Enter).

**Card appearance**
10. The card is a flat `--h-surface` panel — no orange/peach wash top-left, none
    bottom-right, in light **and** dark mode, and on the top-match card. Border
    and shadow still mark the top match, the selected card and hover.

**Shortlist pill**
11. With ≥1 candidate shortlisted, on a desktop window: the dark
    "N in Shortlist · View Shortlist" pill sits fully **above** the search field
    with a visible gap, both when the checklist strip is showing and when it is
    not. The field is fully clickable and typable underneath it.
12. Expand Scout to full screen (the expand icon) with the pill on screen — it
    still clears the composer.
13. At 390px width: unchanged from today — the pill sits in the reserved space
    under the composer, not over it.

**Build**
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `git status` shows exactly three modified files:
  `src/components/hire/scout-chat.tsx`,
  `src/components/hire/desk-match-card.tsx`,
  `src/app/hire/hire-scout.css`.

## 9. Commit message

```
fix(hire): desk checklist, card click target, flat card, pill placement

Checklist under the Scout composer stays hidden until a requirement is
actually captured, then shows only what was captured — nine grey labels
under an empty composer were noise and cost the field a row.

The whole candidate card now opens the inspector, with the buttons inside
it and text selection excluded. Removes the peach gradient wash from the
card; border and shadow already carry top-match, selected and hover.

The floating Shortlist pill sat on the composer on desktop — the same
collision phones fixed below 900px. It now floats above the field.
```
