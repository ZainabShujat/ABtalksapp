# 096 — /ai-workshop Figma rebuild: calendar, details modal, registration overlay

**Status: implemented** (not a forward plan — this is the as-built record).
Figma source of truth: file `Aw3uPilErVzYc8C6sNsrpd`, main page node `1:112`,
details modal node `19:23` / `19:5`.

## 1. Goal
Rebuild `/ai-workshop` to the Figma design: a month-grid calendar covering all
four ABTalks tracks, a details overlay on past workshop tiles, and the
registration form moved into a hash-driven modal. Light and dark both
supported, light being the design's native mode.

## 2. What changed from the original design read

The first pass worked from the Figma *screenshot* and only recoloured the
existing sections. Pulling `get_design_context` showed the design is a
different visual system entirely:

- **Palette is blue**, not the app's indigo/violet. `#0077E9` primary,
  `#47A5FF` light, `#05192C` hero navy, `#0F4D88` / `#3592E8` / `#86BDF1` /
  `#D7E9FA` / `#AED3F6` supporting tints. Page ground is white.
- **Hero** is a dark navy card inset on a white page with the poster at
  567×716 on the right and four floating gradient pills over its edges.
- **"What You'll Learn"** is a scatter of 11 rotated capsules, not cards.
- **Community** is heading-left / image-column-right, not a centred card.

So this became a rebuild of four sections, not a token swap.

## 3. Files

### New
| Path | Note |
|---|---|
| `src/components/workshop/WorkshopThemeStyles.tsx` | Blue token block, light default + `.dark` counterpart, `wk-*` utilities. Shared by both workshop routes. |
| `src/components/workshop/WorkshopHero.tsx` | Figma 1:117 — navy card, poster, chips, countdown, gradient pills. |
| `src/components/workshop/EventsCalendar.tsx` | Figma 1:192 — month grid, event bars, owns modal state. |
| `src/components/workshop/WorkshopDetailsModal.tsx` | Figma 19:5 — click-to-load YouTube, takeaways, resources. |
| `src/components/workshop/RegistrationModal.tsx` | Hash-driven overlay wrapping `RegistrationForm`. |
| `public/workshop/posters/linkedin-ai-interview.jpg` | Hero poster, exported from Figma. |
| `public/workshop/community/{1,2,3}.jpg` | Community images, exported from Figma. |

### Edited
`events-data.ts` (track field, weekly-content fields, challenge + cohort
entries, month helpers), `Header.tsx`, `TopicsSection.tsx`,
`CommunityStats.tsx`, `CountdownTimer.tsx`, `ComingSoonCard.tsx`,
`RegistrationForm.tsx`, `app/ai-workshop/page.tsx`,
`app/ai-workshop/events/page.tsx`.

### Deleted
`UpcomingEvents.tsx` (calendar replaces it), `AutoScrollToForm.tsx` (auto-
opening the new modal would be an auto-popup), `ScrollToTop.tsx` and
`CursorGlow.tsx` (no counterpart in the design).

## 4. Server vs Client
`app/ai-workshop/page.tsx` and `Header.tsx` stay **Server**. `WorkshopHero`,
`TopicsSection`, `CommunityStats`, `EventsCalendar`, `WorkshopDetailsModal`,
`RegistrationModal`, `CountdownTimer` are **Client**.

`EventsCalendar` takes **no props** and reads `EVENTS` itself — events carry a
`LucideIcon`, which cannot cross the Server→Client boundary. `WorkshopHero`
does the same for the poster/description. Only primitives are passed down.

## 5. Key implementation decisions

- **Token split.** Accent hues are identical in both themes; only surface /
  text / border tokens flip under `.dark .wk-root`. The hero card and the
  countdown stay navy in both themes, per the design.
- **Weekly content is per-event.** `topics` is `string[]` — TopicsSection owns
  the colours and the 11 scatter positions, so a weekly swap is just new text
  plus a new poster file. `takeaways`, `resources`, `youtubeId`, `duration`,
  `posterSrc` likewise live on the event.
- **Scatter scaling.** The capsule field renders on the design's own 1920×700
  canvas, scaled whole by a `ResizeObserver`-measured factor (see 5b.1), so the
  composition is preserved exactly at any width. Below `lg` that factor would
  put 24px type at ~5px, so the same capsules reflow into a wrapped cluster
  instead.
- **Saturday placeholders are generated per rendered month**, never as a
  module-level array — the cadence has no end date, so a static list would
  grow without bound as the user pages forward.
- **Calendar month is client-resolved.** The page is statically prerendered; a
  build-time date would freeze the grid on whatever month shipped. Same
  `useState(null)` + effect pattern `EventsTimeline` already uses.
- **YouTube is click-to-load** via `youtube-nocookie.com`. The app runs a
  `CookieConsentProvider`; an iframe mounted on render would set tracking
  cookies before consent.
- **Registration is hash-driven** (`#register`). Every existing entry point —
  hero CTA, header button, calendar tiles, cross-page `/ai-workshop#register`
  links from the events page — keeps working untouched, which matters because
  several of them live in Server Components and cannot carry an `onClick`.
  Closing clears the hash so the same link fires `hashchange` again.
- **Past workshop tiles open the modal with or without a recording.** The
  modal renders a "recording coming soon" state, so takeaways and resources
  stay reachable while a replay is still being uploaded.
- **Track → gradient.** The design's four event-bar gradients map one-to-one
  onto the four tracks: workshop blue, challenge green, cohort yellow,
  hackathon red.
- **Animations** come from `get_motion_context` (15 animated nodes, one 2000ms
  timeline). Capsules drop from `y: -900` on the design's damped-spring curve,
  transcribed exactly as a raw easing function rather than approximated with a
  stock spring; delays are the authored 60ms stagger, which is *not* reading
  order. Hero pills pop with the authored `cubic-bezier(0.45, 1.45, 0.8, 1)`
  overshoot at delays 0 / 0.24 / 0.36 / 0.84s.

  **Deliberate deviation:** Figma marks the timeline `loopMode: "boomerang"`
  (`repeat: Infinity, repeatType: "reverse"`). That is the prototype preview
  behaviour — on a real page it would mean 11 capsules and 4 pills flying in
  and out forever. Implemented instead as a once-on-scroll-into-view entrance
  (`whileInView` + `viewport={{ once: true }}`), with a
  `prefers-reduced-motion` opt-out. Say the word if you want the true loop.

## 5b. Bugs found on first visual review (fixed)

1. **Capsules rendered at full 1920px, overflowing into the Community
   section.** `transform: scale(calc(100cqw / 1920))` is invalid CSS —
   dividing a length by a number yields a length, and `scale()` requires a
   unitless number, so the entire transform was dropped. Replaced with a
   `ResizeObserver` that measures the wrapper and sets `--wk-scale` as a real
   number. There is no CSS-only way to do this reliably.
2. **Header logo invisible.** `WorkshopLogo` carried `logo-image-no-invert`,
   which forces `filter: none`. The source PNG is white — correct on the old
   dark page, invisible now that light mode is white. Removed the class so the
   logo follows the normal `.logo-image` inversion in both themes.
3. **Community stats collided** ("11,000+550+300+" overlapping). Fixed 64px
   figures overflowed their grid columns. Now `clamp()`-sized with `min-w-0`.
4. **Community columns broke at the `lg` breakpoint.** `grid-cols-[1fr_395px_373px]`
   left the copy column ~186px at 1024px wide. Changed to design-proportional
   fractions (`1fr / 0.43fr / 0.40fr`) with aspect-ratio images.

5. **Hero was approximated with flexbox, so positions were wrong.** The design
   is an absolutely-positioned composition on a 1920×806 frame, and it depends
   on exact coordinates — including the poster being deliberately **clipped**
   by the card's bottom edge (top 62 + height 716 = 778 against a 749-tall
   card), which a flow layout cannot reproduce. Rebuilt on the real canvas
   using the same scale technique as the capsule field, with every coordinate
   taken from the Figma node data (card 48/28/1844×749, poster 1084/62/567×716,
   chips 86 & 242 at y102, title 134/172, subtitle 88/389, countdown 88/492,
   buttons 137 & 392 at y654, pills at 877/364, 1588/120, 807/618, 1480/620).
   `useCanvasScale` is now shared between the hero and the scatter field.

6. **Community section was approximated too.** Same problem as the hero —
   rebuilt on its real 1920x818 canvas with exact node coordinates (heading
   123/111 w682, subhead 130/276 w681, body 123/405 w693, figures at x
   123/453/747 y596, labels centred at 227/519.5/810.5 y677, images at
   1065/111 395x242, 1065/367 395x394, 1479/111 373x650).

   Two details that were wrong before: the glow band (node 1:312) is a 2519x746
   SVG that overhangs its 1919x146 box by 300px on every side -- that overhang
   IS the Gaussian blur, and squashing it to the box killed the effect. And the
   design's typography needed real fonts: Instrument Sans was already loaded as
   `--font-hub-instrument-sans` and is now set on `.wk-root`; **Gemunu Libre**
   (the stat-figure face) was added to `layout.tsx` as `--font-gemunu`.

7. **Calendar content did not match the design.** Removed the legend (not in
   Figma), removed the Day/Week/Month segmented control entirely (the design
   shows it, but only a month view is wanted -- rendering dead tabs was worse
   than dropping them), stripped the title text off the event bars so they show only the
   thumbnail as designed (node 1:242), and made the row count derived
   (`ceil((lead + days) / 7)`) instead of a fixed 42, so a 5-row month no
   longer renders an empty trailing row.

   The bars need a photo. `avatarSrc` was added to `WorkshopEvent`, populated
   from the four faces in the mock (downloaded, resized 5.6 MB -> 35 KB), and
   falls back to `posterSrc`. **These are placeholder faces from the Figma
   mock — swap them for real host photos.**

8. **Calendar proportions were wrong below 1749px.** (Supersedes the earlier
   note that the calendar should stay fluid -- that was wrong.) The cells were
   a fixed `h-[100px]` while the columns flexed, so the design's 240.7x100
   cell ratio only held at exactly 1749px wide; at any narrower card the cells
   read as too tall. Rebuilt on `useCanvasScale` like the hero and community
   sections, at the design's real geometry: card 1749 wide, 32 padding, grid
   1685 wide at top 148, seven 240.714 columns, 100px rows, weekday header 33
   tall at top 91, nav at top 32 (prev x35, label x98 at 28px, next x295).
   Card height derives from the row count, so no trailing empty row.

   This also removed the horizontal scroll container. Below `lg` the design
   cell cannot survive a phone width -- scaled down it would put the 16px day
   number at ~4px -- so a compact variant renders square cells with 18px bars.

   Known tradeoff: the grid renders empty server-side (`cursor` is null until
   the client resolves the IST month), so bars appear on hydration. That is
   the same deliberate pattern `EventsTimeline` uses to avoid a build-time
   date freezing a statically prerendered page.

9. **Capsules could overlap once the labels changed.** The Figma slots were
   hand-spaced around the LinkedIn workshop's own label widths, so different
   copy no longer guaranteed clearance. Added `topic-layout.ts`: capsule
   widths are estimated from the text (and then *set*, so rendered width
   matches what was solved for), and positions are relaxed apart with
   segment-distance collision on the capsules' core segments -- exact for
   rounded pills, no bounding-box slop. Pure function of constant input, so
   it runs at module load with no hydration mismatch and no browser measuring.
   Verified against the rendered HTML: 13.86px minimum clearance, zero
   overlapping pairs, all capsules inside the canvas.

10. **Section spacing did not match the design.** Three fixes:
   - The design stacks sections edge to edge (hero 78→884, capsules
     884→1584, community 1584→2402, calendar 2402→3383) with breathing room
     inside each canvas, not between sections. Removed `py-14 sm:py-16` from
     the capsule and calendar sections.
   - The "What You'll Learn" heading and subtitle belong INSIDE the 1920x700
     canvas at y47 and y117, not as flow elements above it -- that was adding
     the section's whole header height on top of the canvas.
   - The subtitle is **32px** in the design; it was rendering at 20px.

   The capsule solver now also keeps capsules below y=200 so they clear the
   heading and subtitle (design's own band is 217→628; solved band is
   200→649).

11. **The live workshop was pinned to the wrong event.** `register` +
   `registrationOpen` sat on `linkedin-ai-interview` (dated 2026-08-21, in the
   past), so the hero, topics and registration form all read off it while the
   Supabase-driven chips and countdown showed 5 September -- and new signups
   were being written under `eventId: "linkedin-ai-interview"`.

   Moved the whole live payload to `workshop-2026-09-05`: `register`,
   `registrationOpen`, title + accents, desc, topics, and `time: "7:00 PM IST"`
   to match the poster and `workshop_config`. `linkedin-ai-interview` is back
   to its own LinkedIn title/desc and reads correctly as a past workshop in the
   calendar and replay modal.

   Note the split ownership this exposed: **Supabase `workshop_config` drives
   the hero chips and countdown, while `EVENTS` drives the title, copy, topics
   and poster.** Both must be updated together each week or the page shows one
   workshop's date beside another's content, which is exactly what happened
   here.

   Poster resolved: the source was already in Downloads as
   `Carousel size -  1080x1350.jpg.jpeg`; re-encoded (851 KB -> 147 KB) to
   `public/workshop/posters/create-anything-with-ai.jpg` and wired to
   `posterSrc`. Its 1080x1350 is 4:5, against the hero slot's 567x716
   (~4:5.05), so `object-cover` crops almost nothing.

12. **Community subhead wrapped to three lines instead of two.** Not a
   spacing bug -- a font-weight one. The self-hosted `hubInstrumentSans` ships
   only 400 and 700, but the design uses Medium (500) and SemiBold (600)
   throughout. A missing 600 gets substituted with 700, which is wide enough
   to push the 36px subhead onto a third line inside its 681px box; every
   `fontWeight: 500` was likewise rendering as 400 (12 places across the
   workshop components).

   Added `Instrument_Sans` from `next/font/google` with weights 400/500/600/700
   as `--font-workshop-sans` and pointed `.wk-root` at it, keeping the
   self-hosted family for the rest of the app so no other page's metrics move.
   Verified in the served CSS: all four @font-face weights now ship.

13. **Community section read as white; the design has a blue wash.** The
   `#86BDF1` blurred glow (node 1:312) was being rendered at
   `opacity: var(--wk-ambient)`, and `--wk-ambient` is `0.35` in light mode --
   so the wash showed at about a third of its intended strength and the
   section barely separated from the white one above it.

   `--wk-ambient` was a leftover from the pre-rebuild dark page, where it
   dimmed the hero's aurora/particle layer on a light ground; that layer no
   longer exists, and the community glow was its only remaining consumer. In
   this design the glow IS the light-mode look, not decoration to tone down.
   Removed the token entirely and render the glow at full strength.

14. **Calendar card was too short.** When the Day/Week/Month control was
   removed, the nav row, weekday header and grid were shifted up to close the
   gap it left (nav 95→32, weekday 155→91, grid 212→148). That was wrong: the
   design's card is 755 tall on a five-row month, and 212 + 500 + 43 is
   exactly where that number comes from. Restored the design's own offsets and
   kept the 43px below the grid, so the card is 755 at five rows and 855 at
   six. The generous top padding where the tabs used to be is part of the
   design's proportions, not leftover space.

15. **Calendar card had no side margin below ~1920px.** The section used
   `lg:px-0` with the card capped at `max-width: 1749`, so the design's inset
   only appeared on viewports wider than about 1920 and the card ran edge to
   edge on every laptop. The design puts the card 84 in from the left and 87
   from the right of 1920 -- ~4.4% a side -- so the inset is now
   `lg:px-[4.4%]`, which holds that ratio at every width and still caps at
   1749.

   Worth noting why only this section was affected: the hero, community and
   capsule canvases are the full **1920** frame, so their margins are baked
   into the canvas (the hero card sits at L48 *inside* its frame). The
   calendar's canvas is the **card itself (1749)**, so its margin has to come
   from the section around it.

16. **Recoloured to the `docs/design-system.md` orange/cream palette.**
   Requested explicitly, which lifts that document's "do not restyle existing
   screens" freeze for this page. **Colours only** -- every canvas coordinate,
   font size, spacing value and animation is unchanged.

   - Tokens rewritten in `WorkshopThemeStyles.tsx`: #E05226 primary, #FBF9F7
     cream page, #FFF1E9 peach alt, #111111 / #353535 / #4B4B4B / #8F8F8F text
     ramp, #E0E0E0 borders. Dark mode is a derived warm-neutral counterpart
     (the spec defines none).
   - **Gradient**: `--wk-page-grad` (cream → #FFF5F0 → peach) is painted once
     on `.wk-root` with `background-attachment: fixed`, and the sections that
     used to paint `--wk-bg` now sit transparent over it -- otherwise each
     section repeats the ramp and they band at every seam. `--wk-grad`
     (#E05226 → #C9411C) drives buttons and the hero pills.
   - Hero card is charcoal #111111 instead of navy; it stays dark in both
     themes as the design intends.
   - Community glow SVG refilled #86BDF1 → #E05226 at 0.34 opacity: orange is
     far denser than the pale blue, and at full strength it read as a solid
     band rather than a wash.
   - Off-palette leftovers swept: confetti (indigo ramp), the success tick
     (#4ADE80 -- no green exists in the palette), all seven per-event accents,
     and the details-modal player back-plate.

   **One deliberate deviation.** The spec forbids oranges beyond #E05226 /
   #C9411C / #A93617 and its tints, but the calendar needs four
   *distinguishable* track colours. Rather than invent shades, the three
   workshop-family tracks now use the same orange ramp at descending alpha
   (1.0 / 0.62 / 0.30) and the hackathon takes the palette's charcoal.

   **Out of scope / flagged:** the spec's 1280px container, 96px section
   rhythm and 40px H2 were NOT applied -- they contradict the Figma geometry
   this page is built to, and the ask was colours. Also note Gemunu Libre (the
   stat numerals) was added from the Figma design and is a font family the
   spec would want design approval for.

17. **Header and footer are charcoal bars.** #111111 in BOTH themes, matching
   the hero card, so the cream page is bookended dark. Applied to both
   `/ai-workshop` and `/ai-workshop/events` (which has its own header/footer
   rather than sharing `Header.tsx`).

   They need their own `--wk-bar-*` tokens (`bg`, `bg-blur`, `border`, `text`,
   `muted`) because the page-level text tokens flip with the theme and would
   render dark-on-dark against a permanently dark bar.

   Two things broke on the dark ground and were fixed with it:
   - **The logo vanished.** `/abtalks-logo.png` is white, and globals.css
     applies `filter: invert(1)` in light mode to darken it. On a charcoal bar
     that is dark-on-dark, so `.wk-root .wk-logo .logo-image` forces
     `filter: none` — three-class specificity, to beat the dark-mode rule in
     globals.css without depending on stylesheet order.
   - **ThemeToggle** is a shared ghost `Button` taking its colour from the
     app-wide foreground, likewise dark-on-dark. Scoped via a
     `.wk-bar-toggle` wrapper rather than forking the component.

   Also warmed every CTA shadow: `rgba(0,0,0,0.25)` reads grey and cold on
   cream, so `--wk-cta-shadow` tints it with the deep orange
   (`rgba(169,54,23,0.32)`), and the remaining black shadows moved onto a
   `--wk-ink-a` token that is warm in light and true black in dark.

18. **Registration form was still styled for the deleted dark page.**
   `RegistrationForm.tsx` never got the light/orange pass the other components
   did, so on the now-white modal:
   - the consent block carried `text-white/90` — **the "I agree to the …" and
     newsletter text rendered invisible**, leaving only the two links visible;
   - its links were `[&_a]:text-indigo-300`, off-palette periwinkle;
   - field labels (`text-white/70`) and the "No spam" line (`text-white/35`)
     were invisible for the same reason;
   - the success panel was the old navy `rgba(11,17,32,0.92)` with a green
     `#4ADE80` rule and ring — green appears nowhere in the palette.

   All moved onto tokens; the success panel is charcoal with an orange rule.
   The `text-white` on the orange CTAs is correct and was left alone.

   Two shared components needed scoped overrides rather than edits, since
   `src/components/ui/` and the legal fields are used app-wide:
   - `ui/checkbox` paints itself with the app's indigo primary. Base UI
     exposes `data-slot` / `data-checked`, so `.wk-root [data-slot="checkbox"]`
     recolours it at (0,3,0) specificity.
   - `LegalConsentFields` accepts no `style` prop (a first attempt to pass one
     failed typecheck), so the palette goes through `className` — `cn()` runs
     tailwind-merge, which drops the component's own border/bg/text defaults.

   Note the consent block sits OUTSIDE the `state === "form"` branch, so it
   renders in every state including signed-out — which is why it appeared
   under the "Continue with Google" button.

19. **Form polish + 10-digit phone.**
   - Inputs were filling with `--wk-chip` (#FFECE3), so every field rendered
     peach. The spec puts inputs on white with an #E0E0E0 border — switched to
     `--wk-surface`, focus keeps the white fill and takes an orange ring.
   - Error text moved `text-red-400` -> `text-red-600` for contrast on white.
     Red is a deliberate exception: the palette defines no error colour.
   - **Phone now enforces exactly 10 digits for +91.** Validation was
     `^\d{7,15}$` for every country. Added `PHONE_EXACT_LEN` keyed by dial
     code (only +91 for now), which drives the error message, the input's
     `maxLength`, and a slice in `onChange` so over-long input cannot be typed
     or pasted. Other dial codes keep the 7-15 range rather than inheriting a
     rule that is wrong for them.
   - Changing the dial code trims the existing number to the new cap —
     otherwise a number typed under +1 stays over-long after switching to +91
     and fails validation with no visible cause.

20. **Hero placeholder plates now carry icons.** The Figma pills and chips
   held flat #D9D9D9 rectangles as icon placeholders. Filled with lucide
   glyphs on white tiles with an orange glyph, matching the poster's own icon
   tiles: Clock ("1 Hour Live"), Gift ("100% Free"), PlayCircle ("Live on
   Youtube"), Sparkles ("Beginner Friendly"), CalendarDays + Clock on the
   date/time chips. Applied to the desktop canvas and the mobile flow layout
   both.

   Note `Youtube` does not exist in this lucide version (typecheck caught the
   import); `PlayCircle` is used instead and ships as `lucide-circle-play`.

## 6. Verification performed
- `npx tsc --noEmit` — zero errors in any touched file. (The repo has
  pre-existing errors from a stale Prisma client; `npx prisma generate` fails
  with EPERM while the dev server holds the query-engine DLL.)
- `npx eslint` on `src/components/workshop` + `src/app/ai-workshop` — 5 errors,
  down from a 7-error baseline measured on stashed HEAD. All remaining are the
  pre-existing `react-hooks/set-state-in-effect` pattern already used by
  `EventsTimeline`/`RegistrationForm`.
- Rendered both routes against the running dev server: `/ai-workshop` 200,
  `/ai-workshop/events` 200. Confirmed in the HTML: 42 grid cells, 11 scatter
  capsules (+11 mobile fallback), 4 feature pills (+4 mobile), Day/Week/Month
  tabs, all three community images, the glow band, blue tokens, navy hero,
  poster, `Login/Sign Up`, and 19 initial motion transforms.

**Not verified** (no browser automation in the project): live theme toggling,
modal open/close and focus restore, month navigation, YouTube click-to-load,
and responsive behaviour at real breakpoints. These need a manual pass.

## 7. Outstanding — needs your input
1. **YouTube video ids** for the three past workshops (18 Jul `ai-workshop-live`,
   1 Aug `uiux-ai-workshop`, 21 Aug `linkedin-ai-interview`), plus `duration`
   and any slide/resource links. Until set, the modal shows "recording coming
   soon".
2. **Posters** for the two older workshops — only the current one was in Figma.
3. **60-Day Challenge route** — the 1 Jun tile currently links to `/`.
4. **Event time discrepancy**: `linkedin-ai-interview` is `6:00 PM IST` in
   `events-data.ts`, but the Figma poster and modal both say 7:00 PM. Left as
   `6:00 PM` — this is registration-facing data and is yours to correct.
5. **Palette reach.** `/ai-workshop` is now blue while the rest of the app is
   indigo/violet (`--primary #6366f1`). Confirm that divergence is intended.
