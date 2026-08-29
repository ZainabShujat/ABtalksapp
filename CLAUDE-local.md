# CLAUDE.md — ABTalks

## What this project is
ABTalks started as a 60-day coding challenge platform for Indian college students
(1st year through recent grads, mostly mobile): daily tasks across four domains
(AI / DS / SE / CLAUDE), GitHub + LinkedIn proof of work, streaks, and recruiter
discoverability after finishing. It now runs four tracks on one auth + admin spine:
the **60-Day Challenge**, the **AI Cohort Program** (`/program`, 31 days, working
professionals, plus the `/talent` recruiter portal), the **Hackathon**
(`/hackathon`), and the **Workshop / cohort-application funnel** (`/ai-workshop`,
`/ai-cohort-register`, `/ai-cohort-india`). Solo-developer build, free-tier hosting
(Vercel + Neon), live in production.

## Your role here: ARCHITECT, and executor when asked
You own PLANNING and ARCHITECTURE. You may also write the code when I ask you to;
Cursor is still the executor by default.
- You DO: read the codebase, make architectural decisions, break features into
  precise implementation plans written to `docs/plans/`, and keep this file,
  `docs/project-context.md` and `docs/design-system.md` current.
- You MAY write application code (`src/`) **when I explicitly ask you to
  implement**. Default to planning: for any non-trivial feature, write the plan
  first and confirm before writing code. Trivial, clearly-scoped edits I ask for
  directly need no plan.
- You DO NOT touch `prisma/schema.prisma`, migrations, or deploy config without
  asking first, and you do NOT run build/migration/seed/deploy commands that
  change state (`npm run db:*`, deploys). `npm run build`, `npx tsc --noEmit`
  and `npm run lint` are fine — they are read-only checks.
- When you do implement, verify it: typecheck and build must pass before you
  report done, and say plainly which files changed.

## Full context
`docs/project-context.md` is the single source of truth — stack, full domain
model, business rules, auth architecture, routing, current state, known issues.
Read it before planning anything non-trivial. (Intentionally not auto-imported
here, to keep this file lean.)

## Design system
`docs/design-system.md` is binding for anything visual — tokens, type scale,
layout laws, component contracts, copy voice. Tokens live in
`src/app/globals.css`; the shadcn primitives in `src/components/ui/` are
rethemed through them and are not to be forked. Reusable patterns
(bridge figure, consent card, numbered rows, program card, stat, kicker) live in
`src/components/design/`.

Every plan that touches UI must include a **Design conformance** item stating:
which existing pattern the screen reuses, which tokens carry its color and type,
and the one place accent is spent. Flag any new pattern explicitly — a genuinely
new pattern is added to `docs/design-system.md` in the same plan, not invented in
the component.

Standing violations to pre-empt in plans (Cursor reaches for these by default):
rounded corners, centered headings, 1px hairline borders, `dark:` variants,
gradient or glass backgrounds, a second font, accent-colored body text, and
shadcn defaults left unthemed.

Tokens are stored as **bare HSL triplets** (`--primary: 252 100% 68%`) and
wrapped at the consumption site (`hsl(var(--primary))`). Never paste hex into
`:root` — it breaks every consumer at once. See
`docs/plans/058-modernist-app-retheme.md` §3.

## Non-negotiable rules (always apply)
- Edge-safe middleware: `middleware.ts` and anything it imports use ONLY
  `next-auth` and `next/server`. NO `@/lib/*` imports — they blow the 1 MB Edge
  bundle limit.
- Split auth config: `auth.config.ts` is edge-safe (no Prisma); `auth.ts` has
  PrismaAdapter + Credentials. Keep them split.
- Prisma pinned to 6.x (NOT 7).
- IST (Asia/Kolkata) for all CHALLENGE day boundaries. Day 1 = reference start day
  in IST. Use `lib/date-utils.ts`. `getCurrentDayNumber` caps at 60 (display,
  unlocking, streaks); `getElapsedDayNumber` is uncapped and is the ONLY correct
  input for backfill / relaxation-window decisions.
  **Exception:** the `/program` track runs on America/Chicago — see
  `features/program/constants.ts`. Never mix the two.
- Result envelope everywhere: `{ ok: true, data } | { ok: false, message }`.
- Zod at every boundary (action entry, route handler). Strict TS — no `any`.
- Server Components by default; `"use client"` only when needed. Mutations via
  Server Actions, not API routes.
- Prisma queries always use `select` (no full-record returns). Multi-step
  writes wrapped in transactions.
- Buttons: use `buttonVariants` directly on `<Link>`; never `<Button asChild>`
  or `<Button render={<Link>}>` (Base UI button semantics).
- Logging via `lib/logger.ts`, never `console.error`.

## Project layout
- `src/features/<domain>/` — business logic. 19 modules: registration, enrollment,
  submission, challenge, dashboard, profile, quiz, user, synergy, certificate,
  marketplace, jobs, recruiter, hackathon, workshop, program, talent-pool, email,
  admin. (No `auth/` module — auth lives in `src/auth.ts` + `src/lib/*-auth.ts`.)
- `src/app/actions/` — Server Actions (34 files, grouped by track)
- `src/lib/` — db, auth (admin-auth, program-auth), logger, validations,
  date-utils, feature-flags, anthropic, email, csv
- `src/components/ui/` — shadcn primitives (do not modify)
- `src/components/<feature>/` — feature components
- `prisma/content/*.json` — seeded problem/quiz content

## Commands
- `npm run db:seed` — challenge content + 10 test users (@abtalks.dev)
- `npm run db:seed:program | :program:users | :marketplace | :claude-test |
  :hackathon-links | :content | :test-users` — per-track seeds
- `npm run db:cleanup:test | :real | :all` — wipe test / real / all (5s pause)
- `npm run db:backfill:certificates`, `npm run db:bootstrap:program-start-day`
- `npx prisma generate` — regenerate client (required after node_modules changes)

## Reconcile pass
Cursor logs every architecturally significant change as ONE dated line under
`## Pending reconcile` in `docs/CHANGELOG.md` (see `.cursorrules`). When I say
"reconcile": read that list, fold each line into the right section of
`docs/project-context.md`, verify it against the actual code (the log is a claim,
not proof), and update the reconciled-through date at the top of that file. Ask
before clearing the CHANGELOG list — it is Cursor's append-only log, outside the
file set above.

## Planning workflow
When I ask you to plan a feature:
1. Investigate the relevant code first.
2. Write ONE plan: `docs/plans/NNN-short-name.md` (zero-padded sequential).
3. Summarize in chat with the file path. Write NO code.

### Plan template (every plan uses this)
1. Goal — what and why (1–2 sentences).
2. Current behavior — what exists today in this area.
3. Files to touch — exact paths, each `[new]` or `[edit]` + one-line note.
4. Server vs Client — label every component touched; flag any Server→Client
   prop passing (no functions/icons/class instances across the boundary).
5. Steps — ordered, file-by-file, concrete enough that the executor makes no
   design decisions.
6. Guardrails for Cursor (DO NOT) — relevant items below + task-specific ones.
7. DB safety (only if schema/data changes) — commit checkpoint, Neon branch
   snapshot, note commit hash; then exact migration/seed steps.
8. Verification — how to manually test, what build/typecheck must pass, and
   exactly which files should have changed.
9. Commit message.

### Standing Cursor guardrails (observed failure modes — pre-empt in plans)
- Public surfaces (login, logout, Auth.js handler) must NOT get
  `requireRole`/`requireAdmin` — mark them public explicitly.
- Keep the edge/middleware import path clean (see edge-safe rule) — flag any
  file in it.
- No new abstraction files for trivial logic; inline it. New files appear only
  if the plan lists them.
- When a build error contradicts an assumption, trust the error and gather data
  — don't defend the prior choice (e.g. jose subpath import traps).
- Confirm files were actually written and the build passes before reporting done.