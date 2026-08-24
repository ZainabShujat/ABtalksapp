# Plan 068 — Guest Scout; auth only at checkout (or nav popup)

## 1. Goal

A recruiter opening `/hire` talks to Scout, sees matches and fills a cart
without signing in. Register / sign-in appears as a **dialog on the same
page** — from the nav if they want it early, or at checkout if they wait.
Approved recruiters keep today's persisted flow.

## 2. Current behaviour

`middleware` protects the `/hire` prefix and `/talent` prefix.
`hire/layout.tsx` also calls `requireRecruiter()`. Scout persists every turn
as a `TalentRequest` owned by that recruiter. Cart rows are
`RecruiterShortlistItem`. Checkout (`placeBulkEngagementRequestAction`)
already requires an approved recruiter.

## 3. Target flow

```
anyone → /hire (Scout, no login)
  ask questions → ranked list (same inner flow)
  add to cart (local until they have an account)
  optional: nav "Sign in" → dialog (register on top, sign in under)
  checkout / Request intro
    ├─ not signed in     → same dialog, stay on this page
    ├─ signed in, pending → stay blocked (existing rule)
    └─ approved           → place request as today
```

Guest conversation and matches are **not** written to `TalentRequest`.
That keeps the admin demand board clean and avoids a shared guest user.

## 4. Files

**New**

- `src/app/actions/hire-guest-actions.ts` — scout turn + match, no session
- `src/lib/validations/hire.ts` — guest schemas (edit)
- `src/features/hire/to-public-match.ts` — strip name/company/userId
- `src/components/hire/guest-cart.ts` — localStorage cart
- `src/components/hire/hire-auth-provider.tsx` — open/close the dialog
- `src/components/hire/recruiter-auth-dialog.tsx` — register + sign in
- `src/components/hire/hire-chrome.tsx` — header that works signed-out

**Edited**

- `middleware.ts` — exact public: `/hire`, `/talent/shortlist` (plus existing login/register)
- `src/app/hire/layout.tsx` — drop `requireRecruiter`; guest chrome
- `src/app/hire/page.tsx` — no `session!`; guest Scout
- `src/app/hire/[requestId]/page.tsx` — `requireRecruiter()` (layout no longer does)
- `src/app/hire/[requestId]/candidates/page.tsx` — same
- `src/app/hire/requests/page.tsx` — same
- `src/components/hire/scout-chat.tsx` — guest path, matches inline, no `/hire/:id` jump
- `src/components/talent/shortlist-button.tsx` — guest cart when signed out
- `src/components/hire/shortlist-cart.tsx` — checkout opens dialog if needed
- `src/components/hire/request-intro-button.tsx` — same
- `src/app/talent/shortlist/page.tsx` — guest cart from localStorage
- `src/app/talent/layout.tsx` / `talent-shell.tsx` — dialog + Sign in on cart
- `src/components/talent/recruiter-login-form.tsx` — optional `onSuccess`
- `src/app/actions/talent-actions.ts` — `mergeGuestCartAction` after sign-in

## 5. Server vs Client

Guest actions: Server. Return only `MatchCardData` (no name, company, email).
Chrome, dialog, guest cart, ScoutChat: Client.
Nothing but serialisable props crosses the boundary.

## 6. Guardrails (DO NOT)

- DO NOT persist a `TalentRequest` or shortlist row without an approved recruiter.
- DO NOT send `fullName`, `company`, email, or `userId` in guest match payloads.
- DO NOT make `/hire/requests`, `/hire/[id]`, `/talent/members`, or admin public.
- DO NOT weaken `placeEngagementRequestAction` / bulk checkout.
- DO NOT import `@/lib/*` into middleware.
- DO NOT add a schema / guest user row.
- DO NOT redirect the page away for the auth dialog.

## 7. Security

| Surface | Rule |
|---|---|
| `GET /hire` | public |
| `GET /talent/shortlist` | public (local cart or own cart) |
| Guest scout / match actions | Zod + per-IP rate limit; anonymised output |
| Checkout / intro | `requireApprovedRecruiter` unchanged |
| `/hire/[id]`, `/hire/requests` | `requireRecruiter()` |
| Member evidence page | still `requireRecruiter()` |

## 8. Verification

1. Signed out `/hire` shows Scout. First chip works. No Google, no register page.
2. Finish questions → list appears on the same page. Add to cart. Cart badge moves.
3. Checkout → dialog (register + sign in). URL stays `/talent/shortlist` or `/hire`.
4. Nav Sign in → same dialog, no navigation.
5. Sign in as `recruiter@hire.abtalks.dev` → cart merges, checkout places a request.
6. Pending recruiter still cannot checkout.
7. Approved recruiter still gets `/hire/:id` persistence and recent searches.
8. `/hire/requests` signed out → login. `/admin` unchanged.
9. `npx tsc --noEmit` clean.
