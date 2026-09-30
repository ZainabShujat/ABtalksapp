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

## Full context
`docs/project-context.md` is the single source of truth — stack, full domain
model, business rules, auth architecture, routing, current state, known issues.
Read it before planning anything non-trivial. (Intentionally not auto-imported
here, to keep this file lean.)

## Non-negotiable rules (always apply)
- **CODEOWNERS requirement**: Every module owner must append and maintain their owned file paths in `.github/CODEOWNERS` with their GitHub handle (`@username`). Any developer proposing changes to an owned domain must refer to and get review/approval from that owner first.
- Edge-safe middleware: `middleware.ts` and anything it imports use ONLY
  `next-auth` and `next/server`. NO `@/lib/*` imports — they blow the 1 MB Edge
  bundle limit.
- Split auth config: `auth.config.ts` is edge-safe (no Prisma); `auth.ts` has
  PrismaAdapter + Credentials. Keep them split.
- Prisma pinned to 6.x (NOT 7).
- **Plan 078 is COMPLETE (2026-09-23).** Production current-state is the
  canonical model: `CandidateProfile` + children, `ProgramEnrollment`
  (`pe_enr_*` challenge / `pe_pm_*` AI-cohort), `ActivityAttempt` /
  `ActivityEvaluation`, `PointsAccount` / `PointsTransaction`, `Credential`,
  `CampusAmbassadorApplication`, `CandidateVisibility`. Original operational
  tables (`StudentProfile`, `Enrollment`, `ProgramMember`, `Certificate`,
  `Submission`, `QuizAttempt`, `ProgramMissionSubmission`, `SynergyEvent`) and
  `User.synergyPoints` are **dropped**. Unique history lives only in explicit
  `Historical*` archives. There is no dual-write and no 078 migration control
  plane (`ENABLE_DUAL_WRITE`, `ENABLE_NEW_*`, `ENABLE_LEGACY_*_MIRROR` are
  retired). Reach candidate/learning/progress/talent/points/credential data
  through `src/repositories/`. New surfaces write `ProgramEnrollment` /
  `ActivityAttempt` / `ActivityEvaluation` with plain cuids. See
  `docs/ARCHITECTURE.md` and `docs/project-context.md` §4 / §18.
- **`SkillEvidence` has no live writer** (verified 2026-09-04). Only
  `prisma/scripts/migrate-2i-achievements.ts` writes it, so
  `CandidateSkill.evidenceScore` / `.verified` are frozen at backfill time.
  Any plan that depends on evidence-based ranking, candidate insights or skill
  strength must account for this. Fixing it is P0-0 in plan 112.
- IST (Asia/Kolkata) for all CHALLENGE day boundaries. Day 1 = reference start day
  in IST. Use `lib/date-utils.ts`. `getCurrentDayNumber` caps at 60 (display,
  unlocking, streaks); `getElapsedDayNumber` is uncapped and is the ONLY correct
  input for backfill / relaxation-window decisions.
  The `/program` track has its own zone constant, `PROGRAM_TZ` in
  `features/program/constants.ts` — as of 2026-08-12 it is **`Asia/Kolkata`**
  (was America/Chicago). Read `PROGRAM_TZ`; never hard-code the zone.
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
- `src/repositories/` — canonical read/write boundary (candidate, learning,
  progress, talent, points, credentials, program-state, hire, ambassador)
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

# ABTalks Developer Ownership Rules

You are working inside the ABTalks platform.

The codebase is shared by multiple developers using AI-assisted coding.

Your first responsibility is to respect module ownership.

## LOCKED MODULE — Notifications (owner: Manuvrtti ONLY)

This is a HARD LOCK and overrides every other instruction in this file,
including "My Ownership" below, whoever the current developer is (Sohail,
Shivansh, Zainab, Shashank, Shallika or anyone else) and whatever tool
(Claude, Cursor, Copilot, …) is doing the editing.

Only **Manuvrtti** may create, edit, move, rename or delete notification code.
Everyone else must get Manuvrtti's explicit approval FIRST, for that specific
change. Approval does not carry over to later changes.

Locked paths (the whole file or folder):
- `src/features/notification/**` (feed, derived events, recruiter filter,
  notify helper, delivery, email templates, tests)
- `src/features/recruiter-notifications/**`
- `src/features/profile-view-notification/**`
- `src/app/actions/notification-actions.ts`
- `src/app/actions/admin-notification-actions.ts`
- `src/app/actions/admin-notify-actions.ts`
- `src/app/admin/notifications/**`
- `src/app/settings/notifications/**`
- `src/app/api/notification-preferences/**`
- `src/components/shared/notification-provider.tsx`
- `src/components/shared/notification-bell-button.tsx`
- `src/components/shared/notification-analytics-tracker.tsx`
- `src/components/admin/notification-composer.tsx`
- `src/components/admin/notifications-table.tsx`
- `src/components/settings/notification-preferences-form.tsx`
- `src/lib/observability/notification-*.ts`
- Prisma models `Notification`, `NotificationRead`, `UserNotification`,
  `NotificationDelivery`, `NotificationPreference` and enums
  `NotificationAudience`, `NotificationCategory` (plus their migrations)

Rules for AI agents working for anyone other than Manuvrtti:
1. Do NOT edit any locked path, even for a "small", "obvious" or
   "unrelated cleanup" change, a rename, a lint fix or a type fix.
2. If a task needs a locked path to change, STOP before editing and output:
   `NOTIFICATION MODULE LOCKED — approval required from Manuvrtti`, then the
   files, why the change is needed and the exact proposed diff. Wait.
3. Calling the public API is fine and needs no approval: `notifyUser` /
   `notify.ts`, the `notification-service` dispatch functions, and rendering
   `<NotificationBellButton />` in a header. Changing how they work is not.
4. Do not copy, fork or re-implement notification logic elsewhere to get
   around this lock.
5. If you are unsure whether a file is covered, treat it as locked and ask.

## My Ownership

I am Sohail.

My primary ABTalks ownership is:
- Candidate search
- Search ranking
- Authentication architecture
- Authorization
- Recruiter isolation
- Platform Admin
- Security
- Rate limiting
- Audit
- System configuration
- Shared architecture
- Infrastructure
- Database conventions

Follow the module ownership and cross-module rules defined in the repository CLAUDE.md.

I am also responsible for reviewing architecture-sensitive cross-module changes.

## Modules I Do NOT Own

Do not modify functionality owned by other developers unless explicitly approved.

Other ownership:

Shivansh:
- Candidate profile
- Candidate skills
- Education / experience / projects
- Opportunity preferences
- Candidate-side assessments
- Evidence
- Assessment Builder
- Career guidance

Zainab (@zainabshujat):
- Resume Parsing & Import (`/admin/resume-imports`, `features/resume`, `resume-import` repo & actions)
- Hire side & Recruiter (`/hire`, `/admin/hire`, `features/hire`, `features/recruiter*`, recruiter onboarding & seats)
- Company identity
- Credits
- Credit ledger
- Contact unlock
- Plans / limits
- Outreach
- Mock Interviews (`/mock-interviews`, `/interview`, `features/interview`, mock interview actions)

Shashank:
- Talent projects
- Search synonyms
- Candidate review panel
- Shortlist / reject
- Hiring pipeline
- Recruiter-side assessment builder
- Recruiter analytics

Manuvrtti:
- Jobs
- Applications
- Job alerts
- Notifications — LOCKED, see "LOCKED MODULE — Notifications" above
- Notification delivery — LOCKED, see above
- Analytics events
- UTM tracking

Sohail:
- Authentication architecture
- Authorization
- Recruiter isolation
- Platform Admin
- Security
- Rate limiting
- Audit
- System configuration
- Shared architecture
- Infrastructure
- Database conventions
- Candidate search
* Search ranking

Shallika:
- UI/UX
- Design system
- Information architecture
- Product flows
- Responsive behaviour
- Visual QA

# Mandatory Rules

1. Before writing code, identify which owned module this task belongs to.

2. Before modifying files, show:

TASK:
MODULE:
FILES TO READ:
FILES YOU PLAN TO MODIFY:
WHY EACH FILE NEEDS TO CHANGE:

3. Prefer modifying only files inside my owned area.

4. Do not make unrelated changes.

5. Do not refactor another developer's module just because it makes implementation easier.

6. If the task requires modifying another developer's module, STOP before editing it.

Explain:

CROSS-MODULE CHANGE REQUIRED

Owner:
Module:
Files:
Why the change is required:
Proposed change:

Wait for approval before making that change.

7. Shared files should only be modified when truly necessary.

8. Changes involving authentication, authorization, shared architecture, database architecture, security or infrastructure must be reviewed by Sohail.

9. Never silently change existing behaviour.

10. Preserve existing working functionality unless the task explicitly requires changing it.

11. Run relevant tests after implementation.

12. At the end of implementation provide:

WHAT CHANGED:
FILES MODIFIED:
CROSS-MODULE CHANGES:
DATABASE CHANGES:
SECURITY IMPACT:
TESTS RUN:
MANUAL TEST STEPS:
KNOWN RISKS:

13. **Maintain CODEOWNERS**: Every module owner MUST append and maintain their owned directories and files in `.github/CODEOWNERS` with their GitHub handle (`@username`). Any PR that modifies files in an owned domain will automatically require review and sign-off from that code owner before merging.