# 075 — Final landing page: port the static build into components

## 1. Goal

Make `abtalks landing page final` (static `index.html` + `styles.css` + `script.js`)
the source of truth for `/`, rebuilt as a React component tree under
`src/components/landing/site/`. The static build's markup, CSS and motion are
ported verbatim; only the app's own concerns (auth-aware nav, real routes, real
copy, Next `Image`/`Link`) are grafted on top.

## 1a. Decisions taken while planning — flip any of these before starting

The source zip is a design deliverable, not an app. Six things could not be
ported literally. Each is called out at its Step, and each is a one-line change
if the call was wrong.

| # | Decision | Where |
|---|---|---|
| D1 | Hero videos are **re-encoded** (22.5 MB → ~4 MB total) before committing. Originals are 11 MB + 10 MB, which would live in git forever and cost every mobile visitor a 10 MB autoplay. | Step 2 |
| D2 | Landing CSS tokens are **renamed `--color-*`/`--radius-*`/`--container` → `--lp-*`**. Unprefixed, they collide with the Tailwind v4 `@theme` tokens in `globals.css` and would silently repaint every shadcn utility rendered inside `/`. | Step 4 |
| D3 | Nav keeps the **auth-aware right slot** (`LandingUserMenu` when signed in, "Get Started" otherwise). The static nav is signed-out only; shipping it as-is would log every visitor out visually. | Step 7 |
| D4 | Every `href="#contact"` CTA is **repointed to a real route** (`/program`, `/talent`, track routes), matching what `landing-hub.tsx` does today. Anchor-only CTAs would break the funnel. | Step 12 |
| D5 | Contact form posts to a **new Server Action that emails `team@abtalks.in`** via `sendEmail`. No Prisma model, no migration. The static form only `console.log`s. | Step 17 |
| D6 | Testimonials render from the existing **`testimonials-data.ts` (10 real people)**, not the 4 placeholder quotes in the zip ("Marcus Chen, Backend Engineer, Tokyo"). Footer likewise drops the zip's leftover template content (Octa Junior STEM Lab, robotics courses, `+91 98765 43210`). | Steps 14, 19 |

## 2. Current behavior

- `src/app/page.tsx` (Server): `getLandingState()` + `isClaudeEnabled()` →
  `<LandingHub state claudeEnabled />`.
- `src/components/landing/landing-hub.tsx` + `hub/**` is a React port of the
  **previous** iteration of this same design (merged in `3fff593`). It shares the
  bridge slabs, roller cube, community reel, FAQ and cohort cards, but predates
  the video hero, the "Keep the three" pipeline, the contact section and the CTA
  band — and it still carries a consent tilt card and poster CTA that the final
  build drops.
- `hub/landing-hub.css` (42 KB) establishes the working convention this plan
  follows: one page-scoped global stylesheet, tokens prefixed (`--hub-*`),
  imported by the composition root.
- `hub/**` and `landing-hub.tsx` are imported **only** by `src/app/page.tsx`.
  Nothing else in the app depends on them.
- Still shared, must survive: `testimonials-carousel.tsx` and
  `testimonials-scroller.tsx` (used by `dashboard-hub/testimonials-section.tsx`),
  `progress-dots.tsx` (used by `claude/` and `talent-hunt/`),
  `landing-user-menu.tsx` (reused by the new nav), `onboarding-client.tsx` +
  `slides/`.
- Root layout renders `AppFooter` with no gate for `/`, so the landing currently
  paints its own footer **and** the app footer.

### Source build inventory

| Source | Lines / size | Notes |
|---|---|---|
| `index.html` | 739 | 13 sections, nav + footer |
| `styles.css` | 1627 | 40 tokens, 9 breakpoints, reduced-motion block at 1575 |
| `script.js` | 935 | one IIFE, 15 `init*` functions, one shared `ScrollEngine` |
| `assets/hero.mp4` | 11 MB | desktop hero background |
| `assets/hero-mobile.mp4` | 10 MB | swapped in under 720px |
| `assets/hero.webm` | 1.5 MB | currently commented out in the HTML |
| `assets/how-01..03.png` | 1.5–1.9 MB | roller cube faces |
| `assets/photo-1..5.png` | ~180 KB | community film reel |

### `script.js` → what each function actually does

| Function | Behaviour to preserve |
|---|---|
| `ScrollEngine` | One `scroll` listener + one rAF for all pinned scenes. Each scene reports `p = (scrollY - start) / (height - viewportH)`, clamped 0→1. Re-measures on resize, orientationchange, `fonts.ready`, `load`. |
| `norm` / `smoothstep` / `envelope` | Shared math. `envelope(p,a,b,c,d)` is the trapezoid that lets a slab travel out, dwell, and return. |
| `onceInView` | IntersectionObserver, `threshold 0.2`, `rootMargin '0px 0px -40px'`, unobserves after firing. |
| `initMobileNav` | Burger toggles `.is-open`; closes on link click, Escape, and outside click. |
| `initGlassHeader` | `.is-stuck` past `scrollY > 24`; scroll-spy marks `.nav__link.is-active` using `offsetTop <= scrollY + 140`. |
| `initHeroVideoSource` | `matchMedia('(max-width: 720px)')` swaps the `src` **attribute** (overrides `<source>` children so exactly one file is ever fetched). Must run before the headline gate. |
| `initHeroAnimation` | Adds `.has-video` only once the video can paint; `.is-playing` on double-rAF; `.is-headline-ready` gated on `video.currentTime >= 4`. Three fallbacks: `timeupdate`, a rAF probe, a 9 s bail timer, plus an `error` handler. Reduced motion → `.no-js-hero`, no video. |
| `initBridgeAnimation` | Three sequenced envelopes (`0.12–0.48`, `0.45–0.77`, `0.74–1.20`) drive `--tx/--ty/--sc/--lift/--label` per slab; three SVG elbow connectors redrawn from cached anchors; four panels cross-faded on gated weights. Damped follower, `SMOOTH 0.16`, `EPSILON 0.0002`. Anchors re-measured on resize and `fonts.ready` only — never per frame. |
| `initHowItWorksRoll` | `turnsAt(p)` sums two smoothsteps (`0.14–0.44`, `0.56–0.86`); `--rot = -turns * 120deg`; per-face opacity `0.08 + 0.92 * pow(max(0,cos(angle)), 0.7)`; dots track `round(clamp(turns,0,2))`. Damped follower, `SMOOTH 0.14`. |
| `initKeepThreeScroll` | `norm(p, 0.06, 0.94)` → `floor(eased * 3)`; toggles `.is-active`/`.is-done` on pipeline items and `.is-current` on the 8 dashboard stages. |
| `initOpenRightNow` | Writes `--order` from `data-order` (sequence 1→3→2→4 while DOM order stays the layout order), then `.is-in` once in view. |
| `initCommunityReel` | Writes `--frame` per tile, `.is-rolling` in view, `.reel-ready` 1700 ms later so hover-scale never inherits the reel's stagger delay. |
| `initReveal` | `.reveal` → `.is-visible`, `threshold 0.12`, `rootMargin '0px 0px -60px'`. |
| `initCounters` | Continuous loop **only while `.stats` is ≥35% visible**: 1200 ms ease-out up (`1-(1-t)³`), 2000 ms hold, 1100 ms smoothstep down, repeat. One writer paints all three so they cannot drift. |
| `initFaq` | Single-open accordion animating explicit `panel.style.height` from `scrollHeight`; re-measures open panels on resize. |
| `initMarquee` | Clones the 4 cards once with `aria-hidden="true"` so the `-50%` CSS translate loops seamlessly. |
| `initForm` | Blur + re-validate-on-input; rules: name ≥2 chars, phone `/^[+]?[\d\s()-]{7,18}$/`, email `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, message ≥10 chars. Focuses first invalid field. |
| reduced motion | `initBridgeAnimation`, `initHowItWorksRoll`, `initKeepThreeScroll`, `initMarquee` and `ScrollEngine.start()` are all skipped entirely; counters paint their final value once. |

### Pinned-scene geometry (from `styles.css`)

`.bridge`/`.how`/`.keep` each render a tall `__track` with a `position: sticky`
`__pin` inside. Track heights are CSS variables, not JS constants:

| Scene | ≥1081px | ≤1080px | ≤720px | reduced motion |
|---|---|---|---|---|
| `--bridge-track` | 340vh | 300vh | 240vh | auto |
| `--how-track` | 320vh | 280vh | 220vh | auto |
| `--keep-track` | 460vh | 400vh | 320vh | auto |

## 3. Files to touch

### New — `src/components/landing/site/`

| Path | | Note |
|---|---|---|
| `landing-page.tsx` | `[new]` | Composition root. Imports `landing.css`, renders all 13 sections in order. |
| `landing.css` | `[new]` | Whole of `styles.css`, scoped under `.abtalks-landing`, tokens renamed `--lp-*`. |
| `landing-content.ts` | `[new]` | Every string in the page: bridge panels, roller steps, pipeline stages, the 8 dashboard stages, cohort cards, FAQ, community bullets, stats, footer columns. |
| `motion/scroll-engine.ts` | `[new]` | `ScrollEngine` singleton + `clamp`/`norm`/`smoothstep`/`envelope`. |
| `motion/use-scroll-scene.ts` | `[new]` | `useScrollScene(ref, onProgress, { pinned })` — registers/unregisters with the engine. |
| `motion/use-damped.ts` | `[new]` | The `SMOOTH`/`EPSILON` follower shared by bridge + roller. |
| `motion/use-in-view.ts` | `[new]` | `onceInView` as a hook. |
| `motion/reveal.tsx` | `[new]` | `<Reveal as="h2">` wrapper for `.reveal` → `.is-visible`. |
| `landing-nav.tsx` | `[new]` | Frosted header, scroll-spy, burger, auth-aware right slot. |
| `hero-section.tsx` | `[new]` | Video source swap + 4 s headline gate + strike/highlight choreography. |
| `stats-strip.tsx` | `[new]` | Visibility-gated counter loop. |
| `bridge-section.tsx` | `[new]` | Pinned slabs, SVG connectors, cross-faded panels. |
| `how-it-works-section.tsx` | `[new]` | Pinned roller cube + dots. |
| `keep-three-section.tsx` | `[new]` | Pinned pipeline; owns the active-stage index. |
| `keep-three-dashboard.tsx` | `[new]` | The 8 dashboard stages; takes `activeStage: number`. |
| `cohorts-section.tsx` | `[new]` | 4 track cards, `--order` float-in. |
| `testimonials-section.tsx` | `[new]` | Marquee; duplicates its own children. |
| `faq-section.tsx` | `[new]` | Single-open height accordion. |
| `community-section.tsx` | `[new]` | Film reel + badge. |
| `contact-section.tsx` | `[new]` | Form + validation + Server Action submit. |
| `cta-band.tsx` | `[new]` | Dotted globe (pure CSS) + CTAs. |
| `site-footer.tsx` | `[new]` | 4-column footer, real ABTalks routes. |

### New — elsewhere

| Path | | Note |
|---|---|---|
| `src/app/actions/contact-actions.ts` | `[new]` | `submitContactMessage` — Zod, `sendEmail`, Result envelope. |
| `public/landing/site/**` | `[new]` | `hero.webm`, `hero.mp4`, `hero-mobile.mp4`, `how-01..03.webp`, `photo-1..5.webp`. Own subfolder — `photo-N` would otherwise collide with `public/landing/community/`. |

### Edited

| Path | | Note |
|---|---|---|
| `src/app/page.tsx` | `[edit]` | Swap `<LandingHub>` → `<LandingPage>`. Props unchanged. |
| `src/app/layout.tsx` | `[edit]` | Add `Outfit` via `next/font/google` → `--font-outfit`, append to `fontVars`. |
| `src/app/globals.css` | `[edit]` | Add `body.landing-page { overflow-x: hidden; }`. Nothing else. |
| `src/components/shared/main-shell.tsx` | `[edit]` | Toggle `landing-page` body class on `/`, mirroring the existing `marketplace-page` block. |
| `src/components/shared/app-footer.tsx` | `[edit]` | `if (pathname === "/") return null;` — the landing has its own footer. |

### Deleted (last step, only after the new page is verified)

`src/components/landing/landing-hub.tsx`, `src/components/landing/hub/**`,
`src/components/landing/track-card.tsx`,
`src/components/landing/waitlist-track-card.tsx`.

**Do not delete** `testimonials-carousel.tsx`, `testimonials-scroller.tsx`,
`progress-dots.tsx`, `landing-user-menu.tsx`, `onboarding-client.tsx`,
`slides/**` — all are imported outside `landing/`.
`testimonials-data.ts` stays; the new testimonials section consumes it.

## 4. Server vs Client

| Component | Boundary | Why |
|---|---|---|
| `src/app/page.tsx` | **Server** | Unchanged — `getLandingState()`, `isClaudeEnabled()`. |
| `landing-page.tsx` | **Server** | Pure composition. Holds the global CSS import. |
| `landing-content.ts` | neither | Plain data, no directive — imported by both sides. |
| `cta-band.tsx`, `site-footer.tsx` | **Server** | No interactivity; the globe is CSS-only. |
| `landing-nav.tsx`, `hero-section.tsx`, `stats-strip.tsx`, `bridge-section.tsx`, `how-it-works-section.tsx`, `keep-three-section.tsx`, `keep-three-dashboard.tsx`, `cohorts-section.tsx`, `testimonials-section.tsx`, `faq-section.tsx`, `community-section.tsx`, `contact-section.tsx` | **Client** | Each owns scroll, observer, rAF or form state. |
| `motion/**` | **Client** | `"use client"` on every file. |

**Server → Client props — all plain serializable data, no functions, no icon
components, no class instances:**

- `landing-page.tsx` → `landing-nav.tsx`: `user: LandingUser | null`
  (`{ name, email, image, isAdmin }`).
- `landing-page.tsx` → `cohorts-section.tsx`: `cards: CohortCard[]`, already
  resolved on the server — `{ key, title, badge, href, ctaLabel, bullets }[]`.
  The `getLandingState` CTA overrides and the `claudeEnabled` filter are applied
  **server-side**, so the client component receives finished cards and makes no
  decisions.
- `keep-three-section.tsx` → `keep-three-dashboard.tsx`: `activeStage: number`
  (client → client, no boundary crossed).
- `contact-section.tsx` imports the Server Action directly — the standard
  `"use server"` boundary, not a prop.

## 5. Steps

### Phase A — assets and tokens

**Step 1 — stage the source.** Copy the zip to a scratch dir outside the repo.
Do not commit `index.html`, `styles.css` or `script.js`; they are the reference,
not build inputs.

**Step 2 — encode and place assets (D1).** Convert the three PNG sets to WebP and
re-encode both videos, then place under `public/landing/site/`:

```
ffmpeg -i hero.mp4 -vf "scale=1920:-2" -c:v libx264 -crf 30 -preset slow -profile:v main -movflags +faststart -an hero.mp4
ffmpeg -i hero-mobile.mp4 -vf "scale=828:-2" -c:v libx264 -crf 32 -preset slow -profile:v main -movflags +faststart -an hero-mobile.mp4
ffmpeg -i hero.mp4 -c:v libvpx-vp9 -crf 40 -b:v 0 -an hero.webm
```

`-an` is deliberate: the hero is `muted` and decorative, so the audio track is
dead weight. Targets: desktop ≤3 MB, mobile ≤1.5 MB, webm ≤1.5 MB. `how-01..03`
and `photo-1..5` → `cwebp -q 82`, expected ~1.7 MB → ~150 KB each.
*If the originals must ship byte-for-byte, skip this step and change the paths in
Step 8 — nothing else in the plan depends on it.*

**Step 3 — fonts.** In `layout.tsx`, add alongside the existing
`next/font/google` imports:

```
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["400","500","600","700"] });
```

Append `outfit.variable` to `fontVars`. Body font maps to the existing
`--font-inter`; no new font files. Do **not** add a `<link>` to
`fonts.googleapis.com` — the app self-hosts through `next/font`.

**Step 4 — port the stylesheet (D2).** Copy `styles.css` → `landing.css` and
apply exactly these transformations, in order:

1. Rename every custom property: `--color-*` → `--lp-color-*`, `--space-*` →
   `--lp-space-*`, `--radius-*` → `--lp-radius-*`, `--shadow-*` → `--lp-shadow-*`,
   `--container` / `--pad` / `--gutter` / `--section-gap` → `--lp-*`,
   `--font-display` / `--font-body` → `--lp-font-display` / `--lp-font-body`,
   `--ease*` / `--dur*` → `--lp-*`. Mechanical
   find-and-replace over the whole file, both declarations and `var()` uses.
   **This is not cosmetic:** `--color-primary`, `--color-border`, `--radius-sm`
   and `--radius-md` are all declared by Tailwind v4's `@theme inline` block in
   `globals.css`, so an unprefixed redefinition would repaint `bg-primary`,
   `border`, `rounded-sm` etc. for anything rendered inside `/`.
2. Move the `:root { … }` block to `.abtalks-landing { … }`.
3. Prefix every other selector with `.abtalks-landing ` (e.g. `.hero__title` →
   `.abtalks-landing .hero__title`). Leave `@keyframes`, `@media` and
   `@supports` at-rules unprefixed.
4. `--lp-font-display` resolves to `var(--font-outfit)`, `--lp-font-body` to
   `var(--font-inter)`.
5. The reset block: keep `*, *::before, *::after { box-sizing: border-box }`
   scoped as `.abtalks-landing *`. **Drop** `html { scroll-behavior: smooth }`
   (handled in JS, Step 7) and **drop** `body { overflow-x: hidden }` (handled by
   the body class, Step 5) — both are global side effects.
6. Retarget the `body` typography rules (`font-family`, `font-size: 17px`,
   `line-height: 28px`, `color`, `background`) onto `.abtalks-landing`.
7. Keep the `@media (prefers-reduced-motion: reduce)` block at line 1575
   verbatim — it is what makes the pinned tracks collapse to `height: auto`.

**Step 5 — body class.** In `main-shell.tsx`, add `const isLanding = pathname === "/"`
and a second `useEffect` toggling `document.body.classList.toggle("landing-page", isLanding)`
with the same cleanup shape as the existing `marketplace-page` effect. In
`globals.css` add:

```
body.landing-page { overflow-x: hidden; }
```

`overflow-x` must sit on `body`, not on a wrapper div — a wrapper would become a
scroll container and kill `position: sticky` on all three pinned scenes.

### Phase B — motion infrastructure

**Step 6 — port the engine.**

- `motion/scroll-engine.ts`: module-level singleton mirroring the IIFE's
  `ScrollEngine`. `add(el, update, pinned)` returns an unsubscribe function
  (the vanilla version never removes scenes; React must). Listeners attach on
  first `add` and detach when the last scene leaves. Export `clamp`, `norm`,
  `smoothstep`, `envelope` unchanged.
- `motion/use-scroll-scene.ts`: `useScrollScene(ref, onProgress, { pinned = true })`
  — registers in `useEffect`, unregisters on cleanup, keeps `onProgress` in a
  ref so re-renders never re-register.
- `motion/use-damped.ts`: the follower loop. `useDamped(smooth, epsilon, paint)`
  returns `setTarget(value)`; cancels its rAF on unmount.
- `motion/use-in-view.ts` and `motion/reveal.tsx`: `onceInView` thresholds
  exactly as tabulated in §2.

Reduced motion comes from `useSafeReducedMotion()` in `@/lib/motion` (SSR-safe:
`false` on the server and first client render, real value after mount). Every
scene hook must early-return when it is `true`, matching the vanilla guards. Do
**not** call `matchMedia` during render — it would desync hydration.

Do not port the `motionQuery` change → `window.location.reload()` handler. In
React the hook re-renders and the guards re-evaluate on their own.

### Phase C — sections, in page order

**Step 7 — `landing-nav.tsx` (D3).** Port the frosted header verbatim: `.is-stuck`
past 24px, scroll-spy over `#bridge`/`#how`/`#cohorts`/`#faq` using
`offsetTop <= scrollY + 140`, burger toggling `.is-open` with close-on-link,
close-on-Escape, close-on-outside-click. Two changes from the static build:

- Anchor clicks call `document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })`
  and `preventDefault()`, replacing the dropped global `scroll-behavior: smooth`.
- The right-hand slot renders `<LandingUserMenu user={user} />` when `user` is
  non-null, otherwise the `.btn--primary.btn--nav` "Get Started" link. The mobile
  panel gains a "Sign in" → `/login` link when signed out.

`LandingUserMenu` renders shadcn primitives inside the landing subtree. Because
the tokens are `--lp-*`-prefixed (Step 4), it keeps the app's own theme. Verify
this visually rather than assuming it.

**Step 8 — `hero-section.tsx`.** Port `initHeroVideoSource` + `initHeroAnimation`
as one effect chain, in that order:

- A `useSyncExternalStore` over `matchMedia('(max-width: 720px)')` picks the
  source; set it via `video.setAttribute("src", …)` + `video.load()`, exactly as
  the original does — a plain `<source>` list would fetch both files.
- Add `<source>` for `hero.webm` first, then the mp4, per the HTML's commented-out
  line — the 1.5 MB webm should win wherever it is supported.
- Choreography state (`hasVideo`, `isPlaying`, `headlineReady`) lives in React
  state and maps to the `.has-video` / `.is-playing` / `.is-headline-ready`
  classes. **All three fallbacks must survive**: `timeupdate`, the rAF probe, and
  the `HEADLINE_AT * 1000 + 5000` bail timer, plus the `error` handler that
  re-fires the reveal after 600 ms. A blocked autoplay must never strand the
  headline invisible.
- Reduced motion → `.no-js-hero`, video paused with `autoplay` removed.
- The `<video>` stays a raw `<video>` element. Do not wrap it in `next/image`
  or any player. Keep `muted playsinline loop preload="auto" tabIndex={-1}
  aria-hidden`.
- Hero CTAs: "Get Started" → `/program`, "Post a requirement" → `/talent`.

**Step 9 — `stats-strip.tsx`.** Port `initCounters` exactly, including the
`threshold: 0.35` IntersectionObserver lifecycle — the loop must stop when the
section leaves the viewport. One `paint(fraction)` writer for all three numbers.
Values (`10k+`, `100+`, `15+`) come from `landing-content.ts` as literals; do not
wire them to DB counts in this pass.

**Step 10 — `bridge-section.tsx`.** The most intricate port. Keep it a single
client component; splitting the slabs from the panels would break the shared
`paint(p)`.

- Slab transforms are written imperatively via `el.style.setProperty("--tx", …)`
  inside `paint`, **not** through React state. Re-rendering 3 slabs + 4 panels +
  3 SVG paths at 60fps would stall.
- `measureLinks()` must reset slabs and panels to their neutral state before
  reading `getBoundingClientRect`, then let `paint` restore the live frame — the
  comment in the source explains why, and the connectors land wrong without it.
- Anchors are cached and refreshed **only** on resize and `fonts.ready`. Never
  measure per frame.
- Keep `pathLength="1"` on the connector paths and drive `strokeDashoffset` —
  that is what makes one dash value mean the same fraction at every breakpoint.
- The `linearGradient` id `bridgeLinkGrad` is global to the document. Keep it,
  and keep it unique — nothing else on the page may reuse it.
- Envelopes, `SMOOTH = 0.16`, `EPSILON = 0.0002`, and the `travel()` breakpoints
  (`≤720 → {54,34}`, `≤1080 → {86,52}`, else `{122,72}`) are ported as constants.
- Section id stays `#bridge` for the nav spy.

**Step 11 — `how-it-works-section.tsx`.** Port `initHowItWorksRoll`: `STEPS`,
`turnsAt`, `--rot = -turns * 120deg`, the per-face opacity curve, dot tracking,
`SMOOTH = 0.14`. Faces use `next/image` with `loading="lazy"` for
`how-01..03.webp`, sized to the CSS `--face-h` box. Section id `#how`.

**Step 12 — `keep-three-section.tsx` + `keep-three-dashboard.tsx` (D4).** The
pipeline owns `activeStage` (`0..2` for the three pipeline items) via
`useScrollScene` + `norm(p, 0.06, 0.94)`. This one **can** use React state — it
changes at most 3 times across 460vh, not per frame. Pass the index down; the
dashboard maps it onto `.is-current`. All 8 dashboard stages and their copy
(names, scores, chips, meter widths) move verbatim into `landing-content.ts` as
typed data. The `readOnly` inputs stay `readOnly` — they are decorative product
chrome, not a form.

**Step 13 — `cohorts-section.tsx` (D4).** Four cards, resolved server-side in
`landing-page.tsx`:

| Card | href | Badge |
|---|---|---|
| 60 Day Coding Challenge | `/challenges` | `challengeCta` override → else "Enrolling now" |
| ABTalks Vicodathon | `/hackathon` | `hackathonCta` override → else "Enrolling now" |
| 31 Days AI Cohort | `/program` | `programCta` override → else "Enrolling now" |
| Claude Challenge | `/claude-signup` | `claudeCta` override → else "Enrolling now" |

When `getLandingState` returns a CTA override the card shows "Open dashboard" and
links to the override `href`. The Claude card is filtered out server-side when
`claudeEnabled` is false. Keep the `data-order` sequence `0,2,1,3` — DOM order is
the layout order, `--order` is the animation order. Section id `#cohorts`.

**Step 14 — `testimonials-section.tsx` (D6).** Keep the marquee markup, the 42 s
`animation`, the pause-on-hover, and the four card tints
(`--pink/--violet/--cream/--peach`) cycling across the list. Source the entries
from `@/components/landing/testimonials-data` (10 real testimonials) rather than
the zip's four placeholders. Avatars: the design's `.avatar` is initials-based —
derive initials from `name`, ignore the `photo` field. Duplicate the rendered
list once in JSX with `aria-hidden="true"` on the copy instead of cloning nodes
in an effect; the CSS `-50%` translate needs exactly a 2× track.

**Step 15 — `faq-section.tsx`.** Single-open accordion. Port the explicit
`height` animation from `scrollHeight` (do not substitute `<details>`; the CSS
targets `.faq__item.is-open`, `.faq__q[aria-expanded]` and `.faq__a`). Re-measure
the open panel on resize. Keep `aria-expanded` on the button. FAQ copy comes
from the zip (it is more current than the four in `landing-hub.tsx`). Section id
`#faq`.

**Step 16 — `community-section.tsx`.** Port `initCommunityReel`: `--frame` per
tile, `.is-rolling` on view, `.reel-ready` after 1700 ms. `photo-1..5.webp` via
`next/image`, `loading="lazy"`. The WhatsApp button uses the existing invite
`https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi` (carried over from
`landing-hub.tsx`), `target="_blank"` + `rel="noopener noreferrer"`. "Explore
Community" → `#cohorts`.

**Step 17 — `contact-section.tsx` + `contact-actions.ts` (D5).**

- `src/app/actions/contact-actions.ts`: `"use server"`, Zod schema mirroring the
  client rules (`name.min(2)`, `phone.regex(/^[+]?[\d\s()-]{7,18}$/)`,
  `email.email()`, `message.min(10)`), then `sendEmail({ to: "team@abtalks.in",
  subject, html, text })`. Returns the standard envelope
  `{ ok: true, data } | { ok: false, message }`. Log failures through
  `lib/logger`, never `console.error`. No Prisma model, no migration.
- `contact-section.tsx`: port the blur/input validation and first-invalid focus
  verbatim, submit through `useTransition` + the action, and reveal
  `#formSuccess` on `ok: true`. On `ok: false` show the returned message in the
  same `.error` slot pattern. Keep `noValidate` on the form.
- Note: `sendEmail` returns `{ ok: false, skipped: true }` when `RESEND_API_KEY`
  is unset. Treat `skipped` as success for the user-facing message — locally
  there is no key and the form must still behave.

**Step 18 — `cta-band.tsx`.** Server Component. The 24 `.globe__lat` spans carry
inline `--r`/`--h` values; keep them as a typed array in `landing-content.ts` and
map over it. "Post a requirement" → `/talent`, "Join the next cohort" →
`#cohorts`.

**Step 19 — `site-footer.tsx` (D6).** Keep the zip's 4-column layout, type scale
and legal strip. Replace the template's leftover content with the real routes
carried over from `landing-hub.tsx`:

- **Company** — About Us `/mission`, Talent `/talent`, Jobs `/jobs`
- **Programs** — 60-Day Challenge `/challenges`, AI Cohort `/program`,
  Hackathon `/hackathon`, Claude Challenge `/claude-signup`
- **Help** — FAQs `#faq`, Terms `/terms`, Privacy `/privacy`, Cookies `/cookies`,
  Contact `/contact`, Sign in `/login`
- Legal strip: `ABTalks © {year}` (computed, not the hard-coded 2026) and
  "Profiles are shared only with candidate consent."

Delete the "Connect with us" column's placeholder phone and
`hello@octajunior.com`; use `team@abtalks.in` or drop the column.

### Phase D — wire up and clean up

**Step 20 — `landing-page.tsx` and `page.tsx`.** Compose in source order: nav,
`<main id="main">` wrapping hero → stats → bridge → how → keep → cohorts →
testimonials → FAQ → community → contact → CTA band, then footer. Keep the
`.skip-link` before the nav. Root element is
`<div className="abtalks-landing">`. `page.tsx` swaps the import and the JSX tag;
its props do not change.

**Step 21 — suppress the duplicate footer.** In `app-footer.tsx`, add
`if (pathname === "/") return null;` next to the existing `/dashboard` guard.

**Step 22 — build, verify (§8), then delete** the four superseded paths listed in
§3. Before deleting, run
`grep -rn "landing-hub\|landing/hub\|track-card\|waitlist-track-card" src/` and
confirm the only hits are the files being removed.

## 6. Guardrails for Cursor (DO NOT)

- **Do not** add `requireRole` / `requireAdmin` to anything here. `/` is a
  **public** route and must render for signed-out visitors.
- **Do not** import anything from this tree into `middleware.ts` or
  `auth.config.ts`. The edge bundle stays `next-auth` + `next/server` only.
- **Do not** leave landing tokens unprefixed. Every custom property this
  stylesheet declares is `--lp-*`. `--color-primary`, `--color-border`,
  `--radius-sm` and `--radius-md` collide with the Tailwind `@theme` block.
- **Do not** put `overflow-x: hidden` on a wrapper `div`. It becomes a scroll
  container and silently kills `position: sticky` on all three pinned scenes.
- **Do not** restore the global `html { scroll-behavior: smooth }`. Anchor
  scrolling is explicit in `landing-nav.tsx`.
- **Do not** drive per-frame slab / roller transforms through React state. Write
  CSS custom properties imperatively inside `paint`, as the source does.
- **Do not** add a second `scroll` listener or a second rAF loop. One
  `ScrollEngine`, shared by all three pinned scenes.
- **Do not** call `matchMedia` or read `window` during render — only inside
  effects or `useSyncExternalStore`. Reduced motion comes from
  `useSafeReducedMotion()`.
- **Do not** remove any of the hero's three headline fallbacks. A blocked
  autoplay must still reveal the headline.
- **Do not** convert the FAQ to `<details>/<summary>`. The CSS targets
  `.faq__item.is-open` and animates an explicit height.
- **Do not** ship the zip's placeholder content: "Marcus Chen / Mia Lawrence /
  Aisha Khan / Priya Deshmukh", "Octa Junior STEM Lab",
  `hello@octajunior.com`, `+91 98765 43210`, or the Robotics/STEM course links.
- **Do not** point production CTAs at `#contact`. Use the routes in Step 13.
- **Do not** create new abstraction files beyond those listed in §3. If a helper
  is used once, inline it.
- **Do not** delete `testimonials-carousel.tsx`, `testimonials-scroller.tsx`,
  `progress-dots.tsx`, `landing-user-menu.tsx`, `onboarding-client.tsx` or
  `slides/**` — all have importers outside `landing/`.
- **Do not** commit `index.html`, `styles.css` or `script.js` from the zip.
- **Do not** touch `middleware.ts`, `prisma/schema.prisma`, enrollment,
  dashboard-hub, program, or notification wiring. This pass is the landing page
  plus the five listed edits.
- **Do not** edit `CLAUDE.md` or `docs/project-context.md`.
- If a build error contradicts something in this plan, trust the error and
  gather data — do not defend the plan.

## 7. DB safety

None. No schema change, no migration, no seed. D5 deliberately keeps the contact
form email-only. If a `ContactMessage` model is wanted later it is a separate
plan with its own Neon branch checkpoint.

## 8. Verification

**Build**

- `npx tsc --noEmit` clean, no `any`.
- `npm run build` clean, no new warnings.

**`/` — desktop**

1. Hero video autoplays; headline reveals at the 4 s mark, after the "Interview"
   strike-through.
2. Throttle the network to Slow 3G and hard-reload: the headline still reveals
   (bail timer). Block the video file: headline still reveals (error path).
3. Bridge: slabs travel out and back in sequence bottom → middle → top;
   connectors draw toward the matching title and retract; exactly one panel is
   legible at a time. **Scroll back up** — everything reverses cleanly.
4. Roller: three faces, dots track the face, motion settles softly rather than
   snapping.
5. Keep-the-three: pipeline advances Define → Discover → Connect and the
   dashboard swaps through its stages.
6. Cohorts float in in the order 1 → 3 → 2 → 4.
7. Stats count up, hold, count down, loop — and **stop** when scrolled away.
8. FAQ opens one at a time; resize with a panel open and it stays correct.
9. Marquee loops seamlessly and pauses on hover.
10. Nav frosts past 24px; scroll-spy tracks the section.

**`/` — responsive.** Check 1440, 1080, 860, 720, 480, 374 and 320px. At ≤720px
the mobile hero file loads (confirm in the Network panel that **only one** video
is fetched). No horizontal scrollbar at any width.

**Reduced motion.** With the OS setting on: pinned tracks collapse to natural
height, all copy is readable and static, no video plays, counters show final
values, marquee is still.

**Auth states.** Signed out → nav shows "Get Started". Signed in → nav shows
`LandingUserMenu`, and any enrolled track's card reads "Open dashboard" and links
to that dashboard. With `ENABLE_CLAUDE_CHALLENGE` unset the Claude card is absent.

**Contact form.** Empty submit focuses the first invalid field; bad phone and bad
email are each caught; a valid submit shows the success line. With
`RESEND_API_KEY` unset it still succeeds (skipped send) and logs a warning.

**No regressions.** `/dashboard`, `/program/dashboard`, a program day page,
`/hackathon`, `/talent`, `/marketplace`, `/claude-signup` and `/login` all render
unchanged — Steps 3, 5 and 21 touch shared files. Confirm specifically that no
shadcn component anywhere has shifted color or radius (the `--lp-*` prefix is
what prevents this) and that the app footer still appears on every route **except**
`/`.

**Files changed.** Exactly the paths in §3 — nothing under `src/features/` except
the new `contact-actions.ts` in `src/app/actions/`, and nothing in `prisma/`.

**Last step.** Append one dated line to `## Pending reconcile` in
`docs/CHANGELOG.md`.

## 9. Commit message

```
Rebuild the landing page from the final static build as components.

Ports index.html/styles.css/script.js into src/components/landing/site/: one
shared ScrollEngine drives the three pinned scenes (bridge, roller, pipeline),
CSS is page-scoped under .abtalks-landing with --lp-* tokens so it cannot
collide with the Tailwind theme, and the hero video, stat counters, FAQ,
marquee and community reel keep their original timings and reduced-motion
fallbacks.

App concerns grafted on: auth-aware nav, server-resolved cohort cards that
honour getLandingState overrides and the Claude flag, real footer routes, and
a contact form wired to a Zod-validated Server Action that emails
team@abtalks.in. Retires the previous hub landing.
```
