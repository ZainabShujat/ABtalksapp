# 061 — Figma interview landing (`/`)

## 1. Goal

Replace the logged-out homepage (ModernistLanding) with the Figma frame
`interview-landing-page` (file `WsqYYevAiHtqH50SOaoPlh`, node `710:4`). Follow
Figma literally (rounded cards, soft fills, purple accent). Wire `/` to the new
page. Leave logged-in redirects in `src/app/page.tsx` untouched.

## 2. Current behavior

- `src/app/page.tsx` — logged-out → `<ModernistLanding />`; logged-in profile →
  `/dashboard`; profile-less → hackathon redirect or `/register`.
- Modernist page is zero-radius ruled lattice under
  `src/components/landing/modernist/`.
- Unused `landing-hub.tsx` was the old three-track hub.
- `TestimonialsCarousel` + data already exist and must be reused.
- WhatsApp link: `https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi`.

**Locked decisions**

- Ship on `/` (replace Modernist).
- Ignore modernist zero-radius rules for this page only.
- Missing non-community images → empty frames.
- Community collage → Figma photos + scroll-triggered appear.
- Consent card → scroll-linked `rotateY(55deg)`, hinge on left edge.
- How-it-works → 3 slides; slide 1 from Figma; slides 2–3 = number + lorem.

## 3. Files to touch

| Path | | Note |
| --- | --- | --- |
| `src/components/landing/landing-hub.tsx` | `[edit]` | Server composition root |
| `src/components/landing/hub/*` | `[new]` | CSS + client islands |
| `public/landing/community/*` | `[new]` | Figma collage assets |
| `src/app/page.tsx` | `[edit]` | Wire to `LandingHub` |
| `docs/design-system.md` | `[edit]` | Landing exception |
| `docs/plans/061-figma-interview-landing.md` | `[new]` | This plan |

Do not delete `src/components/landing/modernist/*`.

## 4–9

See implementation; commit message:
`Replace modernist homepage with Figma interview landing`
