# 065 — Landing waitlist track cards

## 1. Goal

Show four coming-soon track cards on the homepage next to the existing four. **Enroll now** requires a signed-in user; if they are signed out, send them to login and back to `/`. Once signed in, a second click shows a toast: “You will be notified once the cohort starts.” Display-only — no waitlist persistence.

## 2. Current behavior

[`src/components/landing/landing-hub.tsx`](src/components/landing/landing-hub.tsx) is a Server Component. It renders three always-on cards plus an optional Claude card via [`TrackCard`](src/components/landing/track-card.tsx) (whole card is a `<Link>`). Auth is already known: `state.user` from [`getLandingState()`](src/features/landing/get-landing-state.ts).

Login already supports `?from=`. Middleware sends a signed-in visitor at `/login?from=/` back to `/`. Root layout already mounts `<Toaster />`, so `toast` from `sonner` works on `/`.

## 3. Decisions (do not re-litigate)

- Signed out → `/login?from=/` → after sign-in they land on `/` and must click **Enroll now** again.
- Signed in → toast only; button label stays **Enroll now**.
- No Prisma, actions, routes, emails, localStorage, or CHANGELOG line.
- Do **not** link these cards to `/program/databricks` or any real track, even if that work exists on the branch.

## 4. Files to touch

- [`docs/plans/065-landing-waitlist-track-cards.md`](docs/plans/065-landing-waitlist-track-cards.md) `[new]` — this plan, saved first.
- [`src/components/landing/track-card.tsx`](src/components/landing/track-card.tsx) `[edit]` — export `accentClasses` and the accent union so waitlist cards share the same colors.
- [`src/components/landing/waitlist-track-card.tsx`](src/components/landing/waitlist-track-card.tsx) `[new]` — Client Component.
- [`src/components/landing/landing-hub.tsx`](src/components/landing/landing-hub.tsx) `[edit]` — add the four cards and keep a 4-column large grid.

## 5. Server vs Client

- `LandingHub` stays a Server Component.
- `TrackCard` stays a Server Component (live tracks unchanged).
- `WaitlistTrackCard` is `"use client"`.
- Cross-boundary props: serializable only — copy fields + `isAuthenticated: boolean`. No functions, icons, or class instances.

## 6. Steps

1. Save this plan as `docs/plans/065-landing-waitlist-track-cards.md`.

2. In `track-card.tsx`, export `accentClasses` and `type TrackAccent = "violet" | "indigo" | "orange" | "amber"`. Do not change live-card markup or behavior.

3. Add `waitlist-track-card.tsx`:
   - Same visual structure as `TrackCard` (pill, title, blurb, chips, CTA span).
   - Props: `accent`, `title`, `blurb`, `pill`, `chips`, `ctaLabel`, `isAuthenticated`.
   - If `!isAuthenticated`: wrap the card in `<Link href="/login?from=/">` (same pattern as `TrackCard`).
   - If `isAuthenticated`: render a `<button type="button">` with the same card classes. `onClick` → `toast.success("You will be notified once the cohort starts.")`.
   - Do not use `<Button asChild>` or `<Button render={<Link>}>`.

4. In `landing-hub.tsx`, add:

```ts
const WAITLIST_TRACKS = [
  {
    accent: "orange" as const,
    title: "Databricks",
    blurb: "Lakehouse, Spark, and production data pipelines. Cohort dates coming soon.",
    pill: "Coming soon",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
  {
    accent: "indigo" as const,
    title: "Google Cloud (GCP)",
    blurb: "BigQuery, Cloud Run, and cloud data engineering. Cohort dates coming soon.",
    pill: "Coming soon",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
  {
    accent: "violet" as const,
    title: "Snowflake",
    blurb: "Cloud data warehouse skills — SQL, pipelines, and analytics. Cohort dates coming soon.",
    pill: "Coming soon",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
  {
    accent: "amber" as const,
    title: "Cyber Security",
    blurb: "Practical security fundamentals — threats, hardening, and defense. Cohort dates coming soon.",
    pill: "Coming soon",
    chips: ["Cohort"],
    ctaLabel: "Enroll now",
  },
];
```

Render them immediately after the live `TrackCard`s in the same `<section aria-label="Choose an ABTalks track">`. Pass `isAuthenticated={Boolean(state.user)}`.

Always use a 4-column large grid (waitlist cards exist whether Claude is on or off):

```ts
className="mx-auto grid max-w-7xl gap-5 px-5 md:grid-cols-3 md:px-8 lg:grid-cols-4"
```

Remove the `claudeEnabled && "lg:grid-cols-4"` conditional. Leave the existing three tracks + Claude card logic unchanged.

## 7. Guardrails for Cursor (DO NOT)

- Do not add Prisma models, migrations, seeds, server actions, API routes, or emails.
- Do not change `middleware.ts`, `auth.ts`, `auth.config.ts`, or `getLandingState`.
- Do not import `@/lib/*` into `middleware.ts`.
- Do not link waitlist cards to `/program`, `/program/databricks`, or any real enrollment flow.
- Do not convert `LandingHub` or `TrackCard` to client components.
- Do not use `<Button asChild>` / `<Button render={<Link>}>`.
- Do not edit `CLAUDE.md` or `docs/project-context.md`.
- Do not append `docs/CHANGELOG.md` (UI-only, no schema/rule/env/convention).
- Do not invent extra UI (modals, “You’re on the list” button state, localStorage).

## 8. Verification

- Signed out: **Enroll now** on any waitlist card goes to `/login?from=/`. After sign-in, you are on `/` and no toast has fired yet.
- Signed in: **Enroll now** shows the toast; CTA still reads **Enroll now**. Refresh and click again still toasts (nothing is stored).
- Live cards (60-Day, Hackathon, 31 Days, Claude) still navigate as today.
- `npx tsc --noEmit` and `npm run build` pass.

Files that should have changed: the four listed in §4 only.

## 9. Commit message

```
Add coming-soon homepage cards with a sign-in-gated Enroll now toast.
```
