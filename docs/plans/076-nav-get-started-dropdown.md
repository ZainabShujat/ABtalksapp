# 076 — Navbar Get Started dropdown

## 1. Goal

On the landing navbar, signed-out “Get Started” opens a dropdown with two items — **Candidates** and **Recruiter** — instead of linking straight to `/program`.

## 2. Current behavior

[`src/components/landing/site/landing-nav.tsx`](src/components/landing/site/landing-nav.tsx) shows “Get Started” twice when `user` is null:

- Desktop: `<Link href="/program" className="btn btn--primary btn--nav nav__cta">`
- Mobile burger (`max-width: 860px`): the same link inside `.nav__links-cta` with `btn--sm`

Signed-in users already get [`LandingUserMenu`](src/components/landing/landing-user-menu.tsx); that slot is unchanged.

Hero “Get Started” / “Post a requirement” stay as they are. This change is navbar-only.

## 3. Destinations

Match the existing landing funnel (plan 075 D4 / hero CTAs):

- **Candidates** → `/program` (public program landing)
- **Recruiter** → `/talent` (auth-gated; middleware sends unsigned visitors to `/login?from=/talent`, then the existing recruiter register/pending flow)

Labels: `Candidates` and `Recruiter`.

## 4. Files to touch

- [`docs/plans/076-nav-get-started-dropdown.md`](docs/plans/076-nav-get-started-dropdown.md) `[new]` — this plan, copied into the repo
- [`src/components/landing/site/landing-content.ts`](src/components/landing/site/landing-content.ts) `[edit]` — add `GET_STARTED_ITEMS`
- [`src/components/landing/site/landing-nav.tsx`](src/components/landing/site/landing-nav.tsx) `[edit]` — replace both Get Started links with one in-file dropdown
- [`src/components/landing/site/landing.css`](src/components/landing/site/landing.css) `[edit]` — dropdown styles (desktop absolute, mobile in-flow)

No new component file. No shadcn `DropdownMenu`: it portals out of `.abtalks-landing`, so landing tokens would not apply, and it would mix the app accent into the landing nav.

## 5. Server vs Client

`LandingNav` is already `"use client"`. The dropdown is local `useState` in that file. No new client boundary. Items are static href/label pairs from `landing-content.ts` (serializable).

## 6. Steps

### Step 1 — Plan file

Write this plan to `docs/plans/076-nav-get-started-dropdown.md`.

### Step 2 — Copy

In `landing-content.ts`, next to `NAV_LINKS`:

```ts
export const GET_STARTED_ITEMS = [
  { href: "/program", label: "Candidates" },
  { href: "/talent", label: "Recruiter" },
] as const;
```

### Step 3 — Dropdown in `landing-nav.tsx`

Add a `ctaOpen` boolean (separate from burger `open`).

In the same file, a small `GetStartedCta` helper:

- Wrapper: `nav__cta-menu` (desktop instance also keeps `nav__cta` so existing `display: none` at ≤860px still hides it)
- Trigger: `<button type="button">` with existing `btn btn--primary` plus `btn--nav` (desktop) or `btn--sm` (mobile). Text remains “Get Started”. Add a CSS caret, not lucide (landing/site does not use lucide).
- `aria-haspopup="menu"`, `aria-expanded={ctaOpen}`, `aria-controls` pointing at the menu id
- When open, a `<ul role="menu">` of two `<Link role="menuitem">`s from `GET_STARTED_ITEMS`
- Clicking an item closes the dropdown **and** the burger
- Extend the existing Escape / outside-click effect so it also closes `ctaOpen`. Keep the current rule: clicks inside `navRef` do not count as outside. Closing the burger also closes the CTA menu.

Replace both Get Started `<Link>`s with `<GetStartedCta />`. Signed-in branch unchanged.

### Step 4 — CSS in `landing.css`

Add after the existing navbar block (~line 253), using `--lp-*` tokens only:

- `.nav__cta-menu { position: relative; }`
- `.nav__cta-dropdown`: absolute, `top: calc(100% + 8px)`, `right: 0`, `min-width: 200px`, white/glass surface matching the stuck nav (`rgba(255,255,255,.92)`, blur, `var(--lp-radius-md)`, light shadow, `z-index` above the bar)
- Item links: 14px / 500, padding, hover `var(--lp-color-primary-light)` / `var(--lp-color-primary)` — not Tailwind `accent`
- Caret: small CSS chevron that rotates when `[aria-expanded="true"]`
- In the existing `@media (max-width: 860px)` block: inside `.nav__links-cta`, menu is `width: 100%` and the dropdown is `position: static` with `margin-top` so it expands in the burger instead of overflowing the viewport. Dropdown links are 44px tap targets / 16px type, matching `.nav__links-cta .btn`

Do not restyle other screens.

## 7. Guardrails for Cursor (DO NOT)

- Do not import `@/components/ui/dropdown-menu` or lucide into the landing nav
- Do not change hero, CTA band, footer, or signed-in `LandingUserMenu`
- Do not add a new file under `src/components/`
- Do not import `@/lib/*` from middleware (untouched)
- Do not restyle existing non-landing screens
- Do not append `docs/CHANGELOG.md` (UI-only, not architectural)
- Do not edit `CLAUDE.md` or `docs/project-context.md`

## 8. Verification

Manual:

- Signed out, desktop: Get Started opens a panel; Candidates → `/program`, Recruiter → `/talent` (or `/login?from=/talent` if logged out)
- Click outside / Escape closes the panel; Sign in still sits next to it in the burger
- Signed out, ≤860px: burger → Get Started expands the two items in-flow; both are full-width 44px targets
- Signed in: profile menu only, no Get Started
- Hero “Get Started” is still a direct `/program` link

Build: `npx tsc --noEmit` and `npm run build` must pass.

Changed files should be exactly: the plan file, `landing-content.ts`, `landing-nav.tsx`, `landing.css`.

## 9. Commit message

```
Add Candidates/Recruiter dropdown to landing Get Started nav
```
