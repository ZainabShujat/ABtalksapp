# 110 — Scout desk micro-interactions (Juicebox-style interaction polish)

## 1. Goal
Make the recruiter Scout desk (`/hire`) feel continuously responsive rather than
batch-processing: acknowledge detected requirements as they are typed, restate
what Scout understood before an expensive search, replace the single static
"thinking" label with staged status text, show skeletons shaped like real match
cards, stagger result entrance, and give every clickable element a real
hover/press/focus state. Presentation only — no change to the conversation
engine, the search trigger rules, layout structure, or any server action.

## 2. Current behavior
The desk is one client component, `src/components/hire/scout-chat.tsx` (1149
lines), styled by a single scoped stylesheet `src/app/hire/hire-scout.css`
(4305 lines). Framer Motion 12 is a dependency and is used elsewhere in the app,
but **nothing under `src/components/hire/` imports it** — the whole desk is
CSS-driven. GSAP is in `package.json` and is used nowhere in `src/`.

Per interaction point:

- **Typing / interpretation.** `detectSpoken()` (`scout-chat.tsx:150`) already
  regex-scans the composer text plus every user turn and drives a nine-item
  `criteria` array. The strip renders only the *met* items (`metCriteria`,
  around `scout-chat.tsx:770`) inside `.scout-criteria-slot`, and
  `.scout-criterion.is-on` sets green + `scale(1.1)` with a 200ms transition.
  Because unmet items are filtered out, a newly detected requirement **mounts
  already green** — the neutral→acknowledged transition never runs, so the item
  pops into existence instead of visibly being acknowledged.
- **Submit.** `send()` / `runSearch()` (`scout-chat.tsx:462`, `:565`) wrapped in
  `useTransition`. A search fires only on explicit `action:search` or the
  agent's own decision — there is deliberately no auto-search effect.
- **Loading.** One state, `pending`, rendering `<ScoutLoader />` (a shard-burst
  sparkle) plus a hard-coded label, "Looking through verified work…"
  (around `scout-chat.tsx:1040`). The same label shows for a one-line agent
  reply and for a full candidate search.
- **Response rendering.** Not streamed. `setMessages` appends the whole
  assistant turn at once; no entrance animation on `.scout-turn`.
- **Results.** `MatchResults` → `DeskMatchCard` in a `.scout-results` grid. All
  cards mount simultaneously with no entrance animation and no skeleton stage;
  the thread hard-cuts from loader to cards.
- **Empty / gap states.** `.scout-empty`, `GapReport`, `SampleCardNotice`,
  `VirtualCandidateCard` — all static.
- **Errors.** `toast.error(...)` via sonner (`RouteThemeToaster` in
  `src/app/layout.tsx:291`), already non-blocking.
- **Upsells.** `UpgradeNotice` (`locked-field.tsx:53`) and `CheckoutFlash` are
  inline, in-flow and dismissible — already non-blocking, just un-animated.
- **Press states.** `grep -c ":active" src/app/hire/hire-scout.css` → **0**.
  Not one element in the desk has a press state. `.scout-chip:hover` only
  changes `border-color`; `.desk-card:hover` changes border + shadow.
- **Motion tokens.** `src/app/globals.css:81-88` defines `--ease-spark`,
  `--ease-spark-soft`, `--ease-spark-out` and `--dur-1..--dur-4`. The hire
  stylesheet mostly uses its own `--ease: cubic-bezier(0.4, 0, 0.2, 1)`, which
  is ease-**in-out** — there is no ease-out/ease-in split for enter vs leave.
- **Reduced motion.** One `@media (prefers-reduced-motion: reduce)` block at
  `hire-scout.css:3622` covering only the pie chart / journey rail, plus one at
  `:981` for the loader. New animations must be added to a reduced-motion guard.

## 3. Files to touch
| File | Mode | Note |
| --- | --- | --- |
| `src/app/hire/hire-scout.css` | `[edit]` | All new keyframes, transitions, hover/press states, skeleton, stagger. Bulk of this plan. |
| `src/components/hire/scout-chat.tsx` | `[edit]` | Criterion enter-phase state, staged loading label, understood-panel render, skeleton render, `--i` stagger index. |
| `src/components/hire/search-tabs.tsx` | `[edit]` | Press state + focus ring on tabs (Tailwind classes). |
| `src/components/hire/match-results.tsx` | `[edit]` | Pass `style={{ "--i": i }}` to each result `<li>` for the stagger. |
| `src/components/hire/desk-match-card.tsx` | `[edit]` | Add `desk-card--in` entrance class hook only. No logic change. |
| `src/components/hire/scout-understood.tsx` | `[new]` | Presentational chip panel restating the parsed spec. No state, no actions. |
| `src/components/hire/desk-card-skeleton.tsx` | `[new]` | Static skeleton shaped like `.desk-card`. No props beyond `count`. |

**No other files.** In particular: do not touch `src/features/hire/*`,
`src/app/actions/hire-actions.ts`, `hire-guest-actions.ts`, `scout-agent.ts`,
`scout-conversation.ts`, `scout-chips.ts`, or the Prisma schema.

## 4. Server vs Client
Every file above is already `"use client"` or will be created as one
(`scout-understood.tsx`, `desk-card-skeleton.tsx`). `src/app/hire/page.tsx`
stays a Server Component and its props to `ScoutChat` are unchanged — no new
Server→Client prop crosses the boundary, and no function, icon component or
class instance is added to any existing prop. The two new components are
rendered *inside* `ScoutChat` (already client), so they need no serialization.

## 5. Steps

### Step 1 — Motion foundation (`hire-scout.css`)
Add to the `.hire-app` token block (after `--ease`, around line 33):

```css
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* entering */
--ease-in: cubic-bezier(0.4, 0, 1, 1);        /* leaving */
--dur-fast: 180ms;   /* hover, chip toggle, press */
--dur-state: 320ms;  /* state / panel transitions */
```

Rule for every addition below: animate **only** `opacity` and `transform`;
`ease-out` for enter, `ease-in` for leave; 150–250ms for feedback, 250–400ms for
state changes. The one pre-existing exception is `.scout-criteria-slot`'s
`grid-template-rows` transition (`:1102`) — leave it, it is the standard
layout-reveal trick and rewriting it is out of scope, but do **not** add new
layout-property transitions anywhere.

At the **end of the file**, extend the reduced-motion guard with every new
animation name introduced by this plan (`scout-tick-in`, `scout-turn-in`,
`scout-card-in`, `scout-understood-in`, `scout-label-swap`, `scout-shimmer`),
setting `animation: none !important; opacity: 1; transform: none;`.

*Why:* every later step depends on these tokens, and adding the guard first
means no step can ship an animation that ignores the user's OS setting.

### Step 2 — Pattern 7: hover / press / focus on every control
`hire-scout.css` only. For each of `.scout-chip`, `.scout-chip--show`,
`.scout-tbtn`, `.scout-send`, `.scout-pill`, `.hire-req__item`,
`.desk-card--clickable`, `.hire-upgrade__cta`, `.hire-upgrade__close`:

- add `transition: background-color var(--dur-fast) var(--ease-out),
  border-color var(--dur-fast) var(--ease-out),
  box-shadow var(--dur-fast) var(--ease-out),
  transform var(--dur-fast) var(--ease-out);`
- strengthen `:hover` — the existing chip hover only moves `border-color`; also
  lift the background to `var(--h-peach)` and add `transform: translateY(-1px)`;
- add `:active { transform: scale(0.97); }` — use `scale(0.985)` for
  `.desk-card`, which is large enough that 0.97 reads as a jump;
- add `:focus-visible { outline: 2px solid var(--h-primary);
  outline-offset: 2px; }`;
- `:disabled` keeps `opacity: .5` and must **not** get hover/press transforms —
  add `:disabled:hover, :disabled:active { transform: none; }`.

Then update `search-tabs.tsx`: add
`active:scale-[0.97] transition-[colors,transform] duration-150 ease-out`
alongside the existing `transition-colors`. Keep the existing focus ring.

*Why:* this is the single largest gap found (zero press states in 4305 lines)
and it is pure CSS with no behavioral risk — land it before anything stateful.

### Step 3 — Pattern 1: real-time interpretation feedback
`scout-chat.tsx` + CSS. Keep `metCriteria` filtering exactly as-is (the strip
stays feedback, not a form — do not re-render all nine items).

In `ScoutChat`, add:

```ts
const seenRef = useRef<Set<string>>(new Set());
const [justOn, setJustOn] = useState<string[]>([]);
```

In an effect keyed on `tickSignature`, diff `metCriteria` keys against
`seenRef.current`, set the new keys into `justOn`, add them to the ref, and
clear `justOn` after 420ms via a `setTimeout` returned as cleanup.

Render each `<li>` with
`className={cn("scout-criterion is-on", justOn.includes(c.key) && "is-fresh")}`.

CSS: `.scout-criterion.is-fresh` runs a **two-phase** `scout-tick-in`
(`420ms var(--ease-out) both`) — frame 0 at `color: var(--h-gray-500);
opacity: 0; transform: translateY(4px) scale(.94)`, 45% at neutral colour but
full opacity/position, 100% at `var(--h-success)` and `scale(1)`. The checkmark
box gets a nested `scale(.6) → scale(1.12) → scale(1)` on the same timeline.
Colour is animatable here because it *is* the acknowledgement; keep the
transform/opacity work on the same element so it stays compositor-friendly.

Leave the existing `scrollIntoView` on `tickSignature` untouched.

*Why:* the detection logic already exists and already runs per keystroke; the
only thing missing is that the acknowledgement is invisible. This makes it
visible without changing what is detected or shown.

### Step 4 — Pattern 3: contextual loading states
`scout-chat.tsx`. Add
`const [phase, setPhase] = useState<"reply" | "search">("reply")`.
Set `setPhase("search")` at the top of `runSearch()` and inside the
`res.data.action === "search"` branches of `send()`; set `setPhase("reply")` at
the top of the non-search path of `send()`.

Add a `useEffect` keyed on `[pending, phase]` that, while
`pending && phase === "search"`, advances a `step` index through:
`["Reading your requirement…", "Matching verified candidates…", "Ranking on evidence…"]`
on `setTimeout`s of 0 / 900ms / 2100ms, clamped at the last entry, and clears on
unmount or when `pending` goes false. When `phase === "reply"`, the single label
is `"Thinking it through…"`.

These labels are **timed, not backend-reported** — the actions expose no
progress events, and adding any is out of scope. Never show a stage that claims
a step the server did not do; the three above are all true of the single
`runMatchAction` call in every ordering.

Replace the hard-coded `<p className="scout-turn__text scout-loader__label">`
text with the current label, and add `key={label}` so React remounts it. CSS:
`.scout-loader__label` gets
`animation: scout-label-swap 260ms var(--ease-out) both` (opacity 0→1,
`translateY(3px)` → 0). Keep `ScoutLoader` itself as-is — it is already calm and
already has a reduced-motion guard at `:981`.

### Step 5 — Pattern 2: show-your-work confirmation
`scout-understood.tsx` `[new]` + `scout-chat.tsx`.

**Scope guard — read this before writing code.** Juicebox gates the search
behind a "Run search / Reset search" confirmation. Adding that gate here would
change *when a search fires*, which this plan explicitly does not do. Build the
**non-gating** version: while a search is in flight, render, above the loader, a
panel restating what Scout parsed — the `specRows(spec)` rows the Requirement
menu already computes, as chips rather than a text echo — with a single "Edit"
button that calls the existing `setDetailsOpen(true)`. Nothing new is gated,
nothing new is submitted.

`ScoutUnderstood` signature:
`{ rows: { label: string; value: string }[]; onEdit: () => void }`.
Pure presentation, no data fetching, no `useEffect`. Render `rows.slice(0, 6)`
as chips plus a `+N more` chip when there are more.

Render it in `scout-chat.tsx` immediately before the `{pending && ...}` loader
block, guarded by `pending && phase === "search" && rows.length > 0`.

CSS `.scout-understood`:
`animation: scout-understood-in 320ms var(--ease-out) both` —
`opacity: 0; transform: translateY(8px)` → `opacity: 1; transform: none`.
Chips inside stagger with `animation-delay: calc(var(--i) * 40ms)`, capped at 6
items so the total never exceeds 240ms.

### Step 6 — Pattern 4: skeletons matching final layout
`desk-card-skeleton.tsx` `[new]`. Props: `{ count?: number }`, default 2. Emits
`count` × `<div className="desk-skel" />`, each with the internal block
structure of `.desk-card` — avatar circle, two title bars, a pill row, a score
block — so the skeleton occupies the same box as the real card.

CSS `.desk-skel`: copy the box metrics of `.hire-app .desk-card`
(`padding: 20px 22px; border: 1px solid var(--h-card-line);
border-radius: 16px; background: var(--h-surface);`). Shimmer via a `::after`
overlay animating `transform: translateX(-100%)` → `translateX(100%)` on a
1400ms `scout-shimmer` (the sweep itself is a transform, which is allowed; do
**not** animate `background-position`). Keep the sweep faint (peach wash at
~0.06 alpha) — calm, not pulsing.

In `scout-chat.tsx`, inside the `searched && resultsPin === i` block, render
`<DeskCardSkeleton count={Math.min(2, matchCount ?? 2)} />` in place of
`<MatchResults>` while `pending && phase === "search"`. When `pending` flips
false, the real list mounts with the Step 7 entrance — a fade-swap, not a cut.

### Step 7 — Pattern 5: staggered list entrance
`match-results.tsx`: on each result `<li>`, add
`style={{ "--i": Math.min(i, 8) } as CSSProperties}`. Cap at 8 so a 40-card list
never takes longer than 8 × 45ms = 360ms to finish arriving.

`desk-match-card.tsx`: add `desk-card--in` to the existing `cn(...)` on all
three `<article className="desk-card ...">` returns. No other change.

CSS:

```css
.desk-card--in {
  animation: scout-card-in 280ms var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 45ms);
}
@keyframes scout-card-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
```

Add the same treatment to `.scout-turn` via `scout-turn-in` (240ms, no stagger)
so assistant/user bubbles fade-slide in rather than snapping.

**Watch the interaction with the existing autoscroll effect** (around
`scout-chat.tsx:400`): it reads `root.scrollHeight` inside a
`requestAnimationFrame`. Because the cards animate `transform` only, their
layout height is correct on frame 1, so the scroll target stays right. Do
**not** switch the entrance to `height`/`margin` — that would break it.

### Step 8 — Pattern 6: entrance for the inline notices
`hire-scout.css` only. Give `.hire-upgrade` and the `CheckoutFlash` container the
same `scout-understood-in` treatment. Both are already in-flow, dismissible and
non-blocking, so **no structural change and no move to a floating toast** —
sonner stays reserved for errors, as today.

## 6. Guardrails for Cursor (DO NOT)
- **DO NOT** change `src/features/hire/*` — not `scout-agent.ts`,
  `scout-conversation.ts`, `scout-chips.ts`, `search-candidates.ts`,
  `match-config.ts`, or any test file. This plan is presentation only.
- **DO NOT** change any Server Action, route handler, Zod schema, or Prisma call.
- **DO NOT** change when a search fires. There is deliberately no auto-search
  effect in `scout-chat.tsx` (see the long comment above `send()`) — do not add
  one, and do not add a confirmation gate in front of `runSearch`.
- **DO NOT** change what `detectSpoken` detects or which criteria the strip
  filters to. Step 3 animates the existing acknowledgement; it does not widen it.
- **DO NOT** add Framer Motion, GSAP, or any new dependency. Framer Motion is
  installed but unused across the whole hire desk — introducing it here would
  add a client bundle to a route that is currently pure CSS. Every animation in
  this plan is CSS.
- **DO NOT** create abstraction files beyond the two listed in §3. No
  `use-stagger.ts`, no `motion-tokens.ts`, no shared `<Skeleton>` wrapper — the
  app already has `src/components/ui/skeleton.tsx` and it is the wrong shape
  here; the desk skeleton must match `.desk-card` metrics specifically.
- **DO NOT** animate `width`, `height`, `top`, `margin`, `padding`,
  `background-position`, or `box-shadow` inside a keyframe. Opacity + transform
  only. (`box-shadow` in a `:hover` *transition* is fine and already used.)
- **DO NOT** use `linear` easing anywhere except the shimmer sweep.
- **DO NOT** touch `src/components/ui/*` (shadcn primitives).
- **DO NOT** use `<Button asChild>` or `<Button render={<Link>}>` if any new
  button is needed — use `buttonVariants` on the element directly.
- **DO NOT** widen the composer's `.scout-criteria-slot` layout transition or
  convert it to `height`; leave it as the existing `grid-template-rows` reveal.
- **DO NOT** ship any new `@keyframes` without adding its name to the
  reduced-motion guard at the end of `hire-scout.css`.
- Confirm the files were actually written and `npm run build` passes before
  reporting done.

## 7. DB safety
Not applicable — no schema, migration, or data change.

## 8. Verification
Manual, at `/hire` (the guest path needs no login; signed-in path via
`/hire/[requestId]`):

1. Type `senior react engineer in bangalore, 5 years` slowly. Each requirement
   tick should fade-slide up from grey to green **individually as you type**,
   not all at once on submit.
2. Hover and press every chip, the send button, "New search", "Requirement", a
   search tab and a candidate card — each must visibly lift on hover and
   compress (~0.97) on press. Tab to each: a visible focus ring.
3. Trigger a search. Expect, in order: the understood-chips panel sliding up,
   the loader label stepping through three stages, two shimmering skeletons the
   same size as real cards, then real cards fading in one after another ~45ms
   apart.
4. Re-run with a query that returns zero matches — sample/virtual cards and
   `GapReport` must still render correctly with the skeleton having cleared.
5. Set OS "reduce motion" and repeat 1–3: content appears instantly, correctly
   positioned, fully opaque, no animation.
6. Check dark mode (`html.dark`) — every new colour must come from an `--h-*`
   token, not a literal.
7. `npm run build` and `npm run lint` clean. No new TS `any`.

Exactly these files should show as changed:
`src/app/hire/hire-scout.css`, `src/components/hire/scout-chat.tsx`,
`src/components/hire/match-results.tsx`,
`src/components/hire/desk-match-card.tsx`,
`src/components/hire/search-tabs.tsx`, plus the two new files
`src/components/hire/scout-understood.tsx` and
`src/components/hire/desk-card-skeleton.tsx`. Nothing under `src/features/`,
`src/app/actions/`, or `prisma/`.

## 9. Commit message
```
hire: micro-interactions on the Scout desk

Tick acknowledgement now animates neutral to green per requirement as the
recruiter types, the loader reports staged status instead of one fixed label,
searches restate the parsed spec as chips while running, results arrive through
card-shaped skeletons with a capped stagger, and every control in the desk gains
a hover, press and focus state (there were none). CSS only — no new dependency,
no change to detection, search triggering, or any server action.
```
