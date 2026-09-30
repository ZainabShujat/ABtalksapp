# 166 — Platform assessments + candidate Assessments redesign

Status: implemented on `ab-dev` (2026-09-29), migration NOT yet applied.
Owners: candidate side + builder — Shivansh · schema / admin / authz — Sohail
(review) · recruiter-assessments + builder file — Zainab (review) ·
notification event type — Manuvrtti (approval pending, see §6).

## 1. Goal
Platform admins can build an assessment (same builder as recruiters) and send
it with a deadline to all candidates, 60-Day Challenge domains or specific
workshops' registrants. Candidates see a redesigned, white `/assessments`
page with two tabs: **Platform** (ABTalks) and **Recruiter**.

## 2. Decisions (from the product owner, 2026-09-29)
- Creators: global platform ADMIN only (no moderator role exists).
- Audience: All candidates (= users with a `CandidateProfile`), challenge
  domains AI/DS/SE/CLAUDE (`ProgramEnrollment` ACTIVE|COMPLETED in
  `legacy-<domain>` cohorts), and picked workshop events
  (`WorkshopRegistration.eventId`). Snapshot at send — later joiners don't
  get it. Deleted/disabled users are excluded.
- Deadline required. At the deadline STARTED attempts auto-submit with saved
  answers (`endReason = DEADLINE`); never-started ones read as **Missed**.
- Candidates never see scores (same as recruiter, plan 129 D-1).
- Notification: in-app only, no email — blocked on §6.

## 3. Data model (migration `20260929120000_platform_assessments`)
`RecruiterAssessment`: `organizationId` nullable; `source AssessmentSource
@default(RECRUITER)`; `deadlineAt`; `audienceAll`, `audienceDomains Domain[]`,
`audienceWorkshopEventIds String[]`; index `(source, updatedAt desc)`;
CHECK constraint: PLATFORM ⇔ organizationId IS NULL.
`AssessmentEndReason` + `DEADLINE`. Additive; existing rows become  RECRUITER.

Recruiter isolation: every recruiter read already filters on
`organizationId`, which a platform row never has. The platform store pins
`source: "PLATFORM"` on every query.

## 4. Files
- `[edit]` prisma/schema.prisma, `[new]` migration above
- `[edit]` src/lib/validations/assessment.ts — DEADLINE, audience + send schemas
- `[edit]` src/features/assessment-attempts/{service,prisma-store,*.test}.ts —
  `attemptDeadline` = min(timer, closesAt); start refused after close;
  `missed`; list + admin sweeps close expired attempts
- `[edit]` src/app/actions/assessment-attempt-actions.ts — skip the recruiter
  `assessment.completed` notification for PLATFORM
- `[new]` src/features/platform-assessments/{service,prisma-store}.ts
- `[new]` src/app/actions/admin-assessment-actions.ts (requireAdmin)
- `[edit]` src/app/admin/assessments/page.tsx — Create button, Platform/Recruiter tabs
- `[new]` src/app/admin/assessments/new/page.tsx, `[assessmentId]/page.tsx`
  (draft → builder; sent → results + links to the existing attempt review)
- `[new]` src/components/admin/platform-audience-picker.tsx,
  platform-assessment-delete-button.tsx
- `[edit]` src/components/hire/assessment/assessment-builder.tsx — optional
  `platform` prop; recruiter path unchanged
- `[edit]` src/features/recruiter-assessments/{service,prisma-store}.ts —
  DEADLINE copy, export `questionCreateNested`, nullable-org typing
- `[edit]` src/features/admin/{get-assessments-console,get-admin-attempt-detail}.ts
- `[edit]` src/app/assessments/page.tsx (redesign), `[assignmentId]/page.tsx`
  (missed state + deadline line), src/components/assessments/assessment-attempt.tsx

Server vs client: all pages are Server Components; the builder, audience
picker and delete button are Client. Only plain data crosses (audience
options: strings/numbers).

## 5. DB safety
1. Commit checkpoint; note the hash.
2. Neon: create a branch snapshot of production.
3. `npx prisma migrate deploy` (then `npx prisma generate` if node_modules changed).
Rollback: the migration is additive; restoring the Neon branch reverts it.

## 6. Pending — NOTIFICATION MODULE LOCKED (Manuvrtti)
`src/features/notification/event-types.ts` needs a `"low"` priority event so
`dispatch()` skips email:
```ts
"assessment.platform_assigned": {
  key: "assessment.platform_assigned",
  label: "New assessment from ABTalks",
  priority: "low",
  suppressionExempt: true,
  emailExempt: false,
  defaultEmailEnabled: false,
},
```
After approval: add a notify step that sends in batches from the admin
results page (dispatch is one DB transaction per person; thousands can't go
out in one request) and an `AssessmentAssignment.notifiedAt` column to resume.

## 7. Verification
- `npm run test:assessment-attempts` (P1–P5 cover the deadline) ·
  `test:recruiter-assessments` · `test:admin-attempt-detail` · isolation test.
- Manual: see the implementation summary in the PR.
