# 165 — Requirement ticks on the results composer, and a collapsible experience list

> **Corrected during implementation.** The first draft of this plan proposed a
> new `search-chips.ts` module deriving chips from `extractPoolBrief`. That was
> wrong: the ticks the request asks for **already exist** — `criteria` in
> `scout-chat.tsx` (Role, Years of Experience, Location, Education
> Qualification, Skills), live-driven from typed text by `detectSpokenBrief`,
> rendered as `.scout-criterion` with a `✓`. They were hero-only. The change is
> therefore to ride them on the results composer too, not to build a second
> vocabulary. The proposed module was written and then deleted.

Date: 2026-09-29 · Author: Sohail

---

## 1. Goal

Two things a recruiter sees. On the Scout search bar, show what the platform has
already understood from what they are typing — as chips, with the bar lifting
smoothly to make room and settling back when the box is emptied. In the
candidate report, stop printing every résumé job description in full: show the
role, and open the detail on request.

---

## 2. Current behavior

### 2a. The search bar shows nothing until you search

The hero composer (`scout-chat.tsx:1924`, `.scout-composer`) is a bare textarea
and a Search button. Chips exist only **after** a search, on screen 2, where
`filterSummary(spec)` (`hire-filter-dialog.tsx:209`) renders `.hire-filter-chip`
pills from the parsed `JobSpec` — role, up to two skills, city, then `+N more`.

So the recruiter types a sentence into an empty box with no signal that anything
in it was recognised, and finds out only after the round trip.

### 2b. There is already a pure parser for this, client-side

`features/hire/pool-brief.ts` is **deliberately pure** — no Prisma, no
`server-only`, and already reachable from the client through
`guest-matches-store`. It exports exactly the chip material:

```ts
extractPoolBrief(raw): { title, mustHaveStack, geo, sources, minEvidenceDays, resultLimit }
ROLE_HINTS   // /\bai engineer\b/ → "AI engineer", full-stack, backend, frontend, data/ML, React dev
STACK_HINTS  // python, java, typescript, react, node, postgres, sql, …
```

`matchTracks(text)` in `track-registry.ts` is pure too, and alias-tolerant
(it is the thing that fixed "cllaude" silently dropping a search).

**This is what the chips must be built from.** It costs no network call, no
model, and — the point — it is the *same vocabulary the server uses*, so a chip
shown while typing cannot contradict the spec the search then runs.

### 2c. Experience prints every description in full

`candidate-inspector.tsx:1253`. Per job it renders the company tile, a subtitle
(`title · employmentType · city`), then a nested role row repeating **the same
title**, the date span, and `job.description` in full. For a résumé-imported
candidate that description is a multi-paragraph block, and a candidate with four
jobs produces a wall of text between "Experience" and "Education".

The title is currently printed twice per job — once in `hire-profile__org-sub`
and again in `hire-profile__role-title`.

### 2d. The design system to follow

- `.hire-filter-chip` — the existing pill: `#eef6f6` background, `#03535f` text,
  100px radius, Inter 14/20/500. **Reuse it; do not invent a second chip.**
- `--h-*` tokens in `hire-scout.css` (`--h-primary`, `--h-border`, `--h-ink`,
  `--h-gray-600`, `--h-peach-wash`). They flip under `html.dark`.
- `--ease: cubic-bezier(0.4, 0, 0.2, 1)`, already defined on `.hire-app`.
- **Not** `var(--primary)` / `var(--border)`: those hold bare HSL triplets for
  Tailwind's `hsl(var(--x))` wrapper, so a plain `var()` is an invalid value and
  the rule silently drops. Plan 158 shipped that bug and the browser caught it.

### 2e. The animation constraint that matters

Screen 1 → screen 2 is a measured morph, not a fade: `hire-stage-flip.ts`,
`heroGhost`, `pinned(StageRect)` and `composerRef` capture the composer's
`getBoundingClientRect()` and animate it from the hero centre to the results
bar. Anything that changes the composer's box has to be compatible with that.

---

## 3. Files to touch

| File | | Note |
|---|---|---|
| `src/components/hire/search-chips.ts` | `[new]` | Pure: text → chips, over `extractPoolBrief` + `matchTracks`. |
| `src/components/hire/scout-chat.tsx` | `[edit]` | Render the chip row under the composer. |
| `src/app/hire/hire-scout.css` | `[edit]` | `.scout-livechips*` and the experience disclosure styles. |
| `src/components/hire/candidate-inspector.tsx` | `[edit]` | Experience becomes a disclosure list. |
| `src/features/hire/search-chips.test.ts` | `[new]` | Chip derivation + the invariants below. |
| `package.json` | `[edit]` | `test:search-chips`. |

No schema, no migration, no server change, no new dependency.

---

## 4. Server vs Client

| Component | Kind | Note |
|---|---|---|
| `search-chips.ts` | **Neutral / pure** | No `"use client"`, no `server-only` — same split as `pool-brief.ts` and `track-registry.ts`. Imported by a client component and by the test. |
| `ScoutChat` | **Client** (existing) | Chips are derived during render from `text`, which it already holds. No new state, no effect, no fetch. |
| `CandidateInspector` | **Client** (existing) | One `useState<Set<string>>` for which jobs are open. |

Nothing crosses the Server→Client boundary that did not before.

---

## 5. Steps

### S1. ~~`search-chips.ts`~~ — NOT BUILT (see the note at the top)

Superseded. What follows in this section described a parallel chip vocabulary;
the implemented change reuses the existing criteria strip instead. Kept for the
reasoning about `pool-brief.ts` being the right source had a new parser been
needed.

### S1-actual. `scout-chat.tsx` — one condition

`{hero && <div className="scout-criteria-slot is-open">` became

```tsx
<div className={cn("scout-criteria-slot", (hero || text.trim().length > 0) && "is-open")}>
```

The hero keeps its existing always-open behaviour. The results composer opens on
the first character and closes when the box is emptied. `.scout-criteria-slot`
already animates `grid-template-rows: 0fr → 1fr` over `var(--dur-3)
var(--ease-spark)`, so the bar rises as the row makes room and settles back —
no transform, no absolute positioning, nothing that fights `hire-stage-flip`.

### S1-old (superseded). `src/components/hire/search-chips.ts`

```ts
export type SearchChip = { key: string; label: string };
/** What the platform has already understood from this text. Pure. */
export function searchChips(raw: string): SearchChip[];
```

Built **only** from the existing pure parsers — do not write a second parser and
do not invent vocabulary:

- `extractPoolBrief(raw).title` → one role chip.
- `.mustHaveStack` → a chip each, capped at 3, then a `+N more` chip using
  `.hire-filter-chip--more` (the same overflow treatment screen 2 uses).
- `matchTracks(raw)` → the track's `label`, never its slug. `delugSlugs` exists
  because slugs reached a real recruiter once.
- `.minEvidenceDays` → "30+ days shipped".
- `.geo` → "India" / "US cohort".

Deduplicate case-insensitively and keep a stable order (role, skills, track,
evidence, geo) so chips do not reshuffle between keystrokes.

**Years of experience is deliberately not chipped.** `PoolBrief` has no such
field — `minEvidenceDays` is challenge days, not career years — so a "2+ years"
chip would promise a filter this stage does not apply. Adding it means extending
`pool-brief.ts`, which is a separate change; noted in §9.

### S2. `scout-chat.tsx` `[edit]`

Derive during render — no state, no effect:

```tsx
const liveChips = useMemo(() => searchChips(text), [text]);
```

Render **after** `.scout-composer__row`, inside the form:

```tsx
<div className="scout-livechips" data-open={liveChips.length > 0} aria-live="polite">
  <div className="scout-livechips__inner">
    {liveChips.map((c) => (
      <span key={c.key} className="hire-filter-chip">{c.label}</span>
    ))}
  </div>
</div>
```

`aria-live="polite"` because chips appear without the recruiter acting; a screen
reader should hear what was recognised, not be ambushed by it.

The bar "moving up" is a **consequence, not a transform**: the chip row grows in
normal flow below a composer that is vertically centred in the hero, so the bar
rises as the row opens and settles back when it closes. No `translateY`, no
absolute positioning, and — the reason for doing it this way — nothing that
fights `hire-stage-flip`'s rect measurement of the composer.

### S3. `hire-scout.css` `[edit]`

```css
.scout-livechips {
  display: grid;
  grid-template-rows: 0fr;           /* 0fr → 1fr animates a height to auto */
  opacity: 0;
  transition: grid-template-rows 260ms var(--ease), opacity 200ms var(--ease),
              margin-top 260ms var(--ease);
  margin-top: 0;
}
.scout-livechips[data-open="true"] { grid-template-rows: 1fr; opacity: 1; margin-top: 12px; }
.scout-livechips__inner { overflow: hidden; display: flex; flex-wrap: wrap; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .scout-livechips { transition: none; } }
```

`grid-template-rows: 0fr → 1fr` rather than `max-height`, because a guessed
`max-height` either clips a second row of chips or makes the easing wrong.

Honour `prefers-reduced-motion` — the request is for a smooth transition, not
for motion nobody can turn off.

### S4. `candidate-inspector.tsx` `[edit]` — experience as a disclosure

Per job, collapsed shows: the company tile, company name, role title, span, and
a chevron. Expanded adds the description.

- `const [openJobs, setOpenJobs] = useState<Set<string>>(new Set());` keyed on
  `job.id`. Default **collapsed** — that is the entire point.
- The header is a real `<button type="button">` with `aria-expanded` and
  `aria-controls`, not a click handler on a div: this has to work from the
  keyboard and be announced as a control.
- A job with **no description** renders with no toggle at all. A disclosure that
  opens onto nothing is worse than a plain row.
- Drop the duplicated title: it currently appears in both
  `hire-profile__org-sub` and `hire-profile__role-title`. Collapsed rows show it
  once.
- Chevron rotates 180° on open, `transition: transform 200ms var(--ease)`, and
  is `aria-hidden` — the button's `aria-expanded` is what conveys state.

### S5. Tests — `src/features/hire/search-chips.test.ts` `[new]`

- `searchChips("")` is empty; whitespace is empty.
- "AI Engineer in Bangalore with 2+ years" yields a role chip reading
  "AI engineer".
- A skill sentence yields skill chips, capped at 3 with `+N more`.
- Chips never repeat the same label twice, case-insensitively.
- Order is stable: the same text always yields the same sequence.
- **No track slug ever reaches a label** — every track chip equals a
  `TRACKS[].label`.
- Source assertions: the chip row is inside the form and uses
  `.hire-filter-chip` (one chip style, not two); the CSS defines
  `.scout-livechips` and a `prefers-reduced-motion` branch; the experience
  disclosure uses `aria-expanded` and a `type="button"`; the inspector no longer
  prints a description outside a disclosure.

---

## 6. Guardrails (DO NOT)

- **DO NOT** write a second text parser. `extractPoolBrief` and `matchTracks`
  are pure, already client-reachable, and are the vocabulary the server uses —
  a parallel one would drift and start showing chips the search then ignores.
- **DO NOT** call the server, the model, or any action on keystroke. Plan 162
  §5 gates that behind a measurement, and this needs none of it.
- **DO NOT** chip years of experience until `PoolBrief` carries it. A chip that
  promises an unapplied filter is worse than no chip.
- **DO NOT** print a track slug in a chip. Use the registry's `label`.
- **DO NOT** add a second chip style. Reuse `.hire-filter-chip` and
  `.hire-filter-chip--more`.
- **DO NOT** use `var(--primary)` / `var(--border)` / `color-mix` over them in
  this stylesheet — bare HSL triplets, the rule silently drops. Use `--h-*`.
- **DO NOT** touch `hire-stage-flip.ts`, `heroGhost`, `pinned`, `StageRect` or
  `composerRef`. The chip row must work with the screen-1 → screen-2 morph, not
  by changing it. If it cannot, stop and re-plan rather than editing the morph.
- **DO NOT** animate with `translateY` on the composer or position the chip row
  absolutely: both fight the rect measurement the morph depends on.
- **DO NOT** default the experience rows to open. The complaint is length.
- **DO NOT** render a disclosure toggle for a job with no description.
- **DO NOT** make the experience header a clickable `<div>`.
- **DO NOT** remove any information from the report — the description moves
  behind a toggle, it is not deleted.
- **DO NOT** modify `src/components/ui/**`.
- **DO NOT** touch `src/features/notification/**`.

---

## 7. DB safety

None. No schema, no migration, no data change, no server behaviour change.

---

## 8. Verification

```
npx tsc --noEmit && npm run lint && npm run build
npm run test:search-chips
npm run test:hire-pagination      # the results list is untouched
```

**Browser, on `/hire`:**

1. Empty box: no chip row, bar in its original position.
2. Type "AI engineer in Bangalore with React" — chips appear, the bar lifts
   smoothly, chips read "AI engineer", "react".
3. Clear the box — chips collapse and the bar returns to exactly where it was.
4. Press Search — the screen-1 → screen-2 morph still runs; the bar still
   travels rather than jumping. **This is the regression to watch.**
5. 375px: chips wrap, no horizontal scroll.
6. `prefers-reduced-motion: reduce`: chips appear and disappear with no
   animation, and nothing is stuck part-open.

**Browser, on a candidate report:**

7. Experience shows one compact row per job, collapsed, no description.
8. Click a row — description opens, chevron rotates, `aria-expanded` flips.
9. Keyboard: tab to the row, Enter/Space toggles it.
10. A job with no description has no toggle and is not focusable as one.
11. The section is dramatically shorter than before for a résumé-imported
    candidate with several jobs.

---

## 9. Follow-ups (not in this plan)

- Chipping years of experience needs a field on `PoolBrief`; that is a change to
  the shared parser and belongs with whoever owns it.
- The chips are read-only here. Making a chip removable would edit the query
  text, which is a different interaction and a different plan.

---

## 10. Ownership

```
TASK:    Live chips on the Scout search bar; collapsible experience in the report
MODULE:  Hire side (files) — Zainab.  UI/UX + design system — Shallika.
FILES:   src/components/hire/**, src/app/hire/hire-scout.css
         → .github/CODEOWNERS: /src/features/hire/, /src/app/hire/ @zainabshujat
```

```
CROSS-MODULE CHANGE REQUIRED

Owner:   Zainab (@zainabshujat) — file ownership
         Shallika — UI/UX, design system, responsive behaviour
Module:  Hire side; design system
Files:   src/components/hire/scout-chat.tsx
         src/components/hire/candidate-inspector.tsx
         src/app/hire/hire-scout.css
Why:     Both surfaces live in her module; the change is visual, so it is
         Shallika's design call as much as an implementation.
Proposed: Reuse the existing .hire-filter-chip pill and the --h-* tokens rather
         than introducing new visual language; no new component library, no new
         colours. Additive: nothing existing is removed, and the experience
         description is moved behind a toggle rather than deleted.
Status:  Directed by Sohail on 2026-09-29. CODEOWNERS still requires
         @zainabshujat's review; Shallika should see the result before it ships.
```
