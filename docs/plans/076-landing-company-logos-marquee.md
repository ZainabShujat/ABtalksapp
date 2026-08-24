# 076 — Landing company logos marquee

## 1. Goal

Place a new section directly under the Bridge on `/` with heading **USED BY PROFESSIONALS FROM** and a continuous left-moving row of grey company logos.

## 2. Current behavior

`landing-page.tsx` went Bridge → How it works. Testimonials already use a duplicated CSS marquee and `useSafeReducedMotion`. Company SVGs live in `public/landing/company-logo/`.

## 3. Files to touch

- `src/components/landing/site/companies-section.tsx` [new] — heading + logo marquee
- `src/components/landing/site/landing-content.ts` [edit] — `COMPANY_LOGOS` array
- `src/components/landing/site/landing-page.tsx` [edit] — render after Bridge
- `src/components/landing/site/landing.css` [edit] — `.companies` styles; reuse `marquee` keyframes
- `docs/plans/076-landing-company-logos-marquee.md` [new]

## 4. Server vs Client

- `CompaniesSection` — Client (`useSafeReducedMotion`)
- `LandingPage` — Server (unchanged); imports client section

## 5. Steps

1. Add `COMPANY_LOGOS` from assets: Meta, Amazon, JPMorgan Chase, Deloitte, American Express, Infosys, Samsung.
2. Build marquee: duplicate logo row when motion allowed; grey via `filter: brightness(0) opacity(0.4)`.
3. Wire after `<BridgeSection />`. Margin-bottom on `.companies` cancels `.how`'s tighten-above so the strip is not covered.
4. Reduced motion: no duplicate row; CSS animation none.

## 6. Guardrails for Cursor (DO NOT)

- Do not restyle Bridge / How it works / other sections beyond the companies margin cancel.
- Do not invent TransUnion / T-Mobile assets.
- Do not edit `CLAUDE.md` / `project-context.md`.
- Do not touch middleware.

## 7. Verification

1. `/` — section under Bridge, above How it works.
2. Heading: USED BY PROFESSIONALS FROM.
3. Seven grey logos scroll left in a loop.
4. Reduced-motion: static row.
5. `npx tsc --noEmit` passes.

## 8. Commit message

`feat(landing): add company logos marquee under Bridge`
