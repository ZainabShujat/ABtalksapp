# 076 — Hackathon dashboard: Coming Soon + Vicodathon winners

## 1. Goal
On `/hackathon/dashboard`, while no hackathon is live, show a **New Hackathon Coming Soon** card and **Vicodathon Winners** (one card per place). Keep all current live-dashboard UI in the file but **hide it** behind a flag so it can be restored later.

## 2. Current behavior
`src/app/hackathon/dashboard/page.tsx` requires auth, then either unregistered → “Registration is closed”, or registered → live dashboard panels.

## 3. Decisions (locked)
- Place labels: **1st Place … 5th Place**.
- Display: name, Solo / Team Leader / Member, college, graduation year when known. **Never** phone, email, or team code.
- Page-local `SHOW_LIVE_DASHBOARD = false`. When `true`, restore today’s live UI.
- Both registered and unregistered authenticated users see the post-event view.

## 4. Files to touch
- `[new] docs/plans/076-hackathon-coming-soon-winners.md`
- `[new] src/components/hackathon/dashboard/vicodathon-winners.ts`
- `[new] src/components/hackathon/dashboard/coming-soon-card.tsx`
- `[new] src/components/hackathon/dashboard/winner-card.tsx`
- `[edit] src/app/hackathon/dashboard/page.tsx`

## 5. Server vs Client
All Server Components. No `"use client"`.

## 6. Steps
1. Static winners data (no phones/emails/codes).
2. ComingSoonCard + WinnerCard matching dark dashboard chrome.
3. Gate live JSX behind `SHOW_LIVE_DASHBOARD`; when false, auth then post-event view without requiring registration.

## 7. Guardrails (DO NOT)
- Do not delete live dashboard JSX/files.
- Do not put phone, email, or team code in data or UI.
- Do not change middleware, Prisma, or `/hackathon` landing.

## 8. Verification
- `/hackathon/dashboard` → Coming Soon + five winner cards.
- `SHOW_LIVE_DASHBOARD = true` restores live UI.
- `npx tsc --noEmit` and `npm run build` pass.

## 9. Commit message
`show Vicodathon winners and coming-soon on hackathon dashboard`
