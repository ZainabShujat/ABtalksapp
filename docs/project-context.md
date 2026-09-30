# ABTalks — Project Context Document

> **Purpose of this file:** Single-source-of-truth context to start fresh chats. Paste this at the beginning of any new conversation so the AI has full project context.

> **Last updated:** 2026-09-23, reconciled against commit `f261b33d` (master — 078 closure). Canonical architecture is live; original legacy operational tables are dropped in production. Pending CHANGELOG lines through the 078 closure were folded here; the CHANGELOG list itself was not cleared.

> **`/hire` is live.** Scout, the recruiter desk and the engagement flow
> shipped with `feat/hire-scout-078` and supersede the `/talent` pool browser,
> which is removed. The pool `/hire` can reach is bounded by
> `HIRE_OPEN_COHORT_IDS` and `HIRE_CHALLENGE_POOL`, both unset by default — so
> a fresh environment reaches published cohorts only.

> **Read this before changing anything data-related.** Plan 078 is **complete**. Production current-state is the canonical model (`CandidateProfile`, `ProgramEnrollment`, `ActivityAttempt` / `ActivityEvaluation`, `PointsAccount` / `PointsTransaction`, `Credential`, `CampusAmbassadorApplication`, `CandidateVisibility`). Original operational tables (`StudentProfile`, `Enrollment`, `ProgramMember`, `Certificate`, `Submission`, `QuizAttempt`, `ProgramMissionSubmission`, `SynergyEvent`) and `User.synergyPoints` are **dropped**. Unique history lives only in explicit `Historical*` archives. There is no dual-write and no 078 migration control plane. See §4 and §18.

---

## 1. What is ABTalks

Originally a 60-day coding challenge platform built around Anil Bajpai's community of recruiters and students. It is now one **Learning + Evidence + Talent platform**: candidates learn on the platform, their activity generates *evidence*, that evidence rolls up into a single candidate profile, and recruiters discover and evaluate candidates from that demonstrated evidence rather than from a self-written résumé.

### The core candidate journey

```
User
  → Candidate profile
      → Courses / Cohorts / Challenges / Hackathons / Assessments / Interviews
          → activities and submissions generate evidence
              → evidence contributes to the unified candidate profile
                  → recruiters search candidates on demonstrated evidence
                      → recruiter shortlists / evaluates / hires
```

A candidate is expected to participate in **several learning programs at once** (e.g. the SE challenge, the Claude track, and the AI Cohort). Multi-enrollment is a first-class requirement, not an edge case — see §5 and the canonical learning spine in §4.

### The learning surfaces that feed it

These are the products that exist today. They share one auth + admin spine and the same canonical learning spine (`ProgramEnrollment` / `ActivityAttempt` / `ActivityEvaluation`):

1. **60-Day Challenge** — daily tasks across SE / DS / AI / CLAUDE, GitHub + LinkedIn proof of work, streaks, leaderboard, certificates.
2. **AI Cohort Program** (`/program`, formerly "B2B AI Mastery") — a 31-day cohort for working professionals with server-verified Daily Missions, GitHub commit tracking, AI-graded projects, an exit voice interview, and a recruiter talent portal (`/talent`).
3. **Hackathon** (`/hackathon`) — solo/team registration with share-link attribution, a participant dashboard, submissions and certificates.
4. **Workshops & AI Cohort applications** (`/ai-workshop`, `/ai-cohort-register`, `/ai-cohort-india`) — top-of-funnel webinar signups and long-form applications.

### What the candidate profile is meant to contain

The unified profile is the durable asset. Its intended contents (the canonical schema already models all of these — see §4):

education · professional experience · projects · skills · external certifications · LinkedIn · GitHub · résumé · achievements · platform-issued credentials · assessments · interview results · hackathon achievements · evidence-derived skill strength.

**Planned additive extensions (do NOT assume these models exist yet):**

- external coding profiles — LeetCode, CodeChef, Codeforces, Kaggle and similar
- opportunity-type preferences — internship / full-time / freelance / contract / part-time

Both are expected to land as **additive** schema later. Neither blocked 078, and neither has been built. `CandidatePreference` today covers `openToWork`, `availableFrom`, preferred roles/locations and remote preference only.

**Vision:** Public, verifiable proof of work produces real skill and real visibility — and that proof, not a claim, is what recruiters search.

**Audience:** Indian college students (1st year through recent graduates), primarily mobile — plus working professionals for the Program track.

---

## 2. Hard constraints

- Solo developer, building with Cursor + Claude (Claude plans, Cursor executes)
- Free or near-free hosting (Vercel free tier, Neon free tier)
- IST (Asia/Kolkata) for all day boundaries. The Program track previously ran on America/Chicago; `PROGRAM_TZ` in `features/program/constants.ts` is now **`Asia/Kolkata`** (changed 2026-08-12). Keep using `PROGRAM_TZ` rather than hard-coding — cohort `startsAt`/`endsAt` round-trip through `fromZonedTime(PROGRAM_TZ)`.
- **Scale (observed in production at 078 closure, 2026-09-23):** ~10,989 `CandidateProfile` rows, ~3,469 `ProgramEnrollment` rows, ~19,558 `ActivityAttempt` / `ActivityEvaluation` rows, ~12,825 `PointsAccount` rows. Historical archives: QuizAttempt 1,213 · ProgramMission 899 · Certificate 3,423 · Submission 17,376 · SynergyEvent 16,460 · StudentProfile 3,049. No hard maximum is asserted — size work against these volumes.
- **One Neon project, several branches** — no longer "one database for dev and prod":
  - `production` branch (`br-soft-bread-amu5tms1`, host `ep-nameless-term-ams9a5e3`) — the live database
  - 078 rollback children exist as snapshots (for example `plan-078-final-destructive-snapshot-20260922T183523Z`, `plan-078-final-drop-rehearsal-20260922T193545Z`). They are not live migration beds.
  - project id `little-fog-11679677`
- **All Neon mutations must target a production child branch** unless that exact production write is explicitly authorized.

---

## 3. Tech stack (as deployed)

- **Framework:** Next.js 16.2.4 (App Router, TypeScript strict, Turbopack), React 19.2.4
- **Database:** PostgreSQL on Neon. `DATABASE_URL` (pooled, `-pooler.` host) is the application connection. `DIRECT_URL` (non-pooler host) is required for anything needing real session semantics — see the connection rules below.
- **ORM:** Prisma 6.19.3 (NOT Prisma 7 — pinned)
- **Auth:** Auth.js v5 (next-auth@beta) with split config (`auth.config.ts` edge-safe, `auth.ts` full Node)
- **Auth providers:** Google OAuth (production), Credentials (dev-only, gated by `ENABLE_DEV_AUTH=true`, plain string compare, no bcrypt)
- **Deployment:** Vercel (`abtalksapp.vercel.app`), plus a Vercel cron for program commit polling
- **Styling:** Tailwind CSS + shadcn/ui on Base UI (`@base-ui/react`), slate base
- **Fonts:** Plus Jakarta Sans (display), Inter (body); `@fontsource/dseg7-classic` for countdown displays
- **Forms:** React Hook Form + Zod 4
- **Motion:** framer-motion; `canvas-confetti` for celebrations
- **Charts:** Recharts (admin analytics)
- **Toasts:** sonner
- **Markdown:** react-markdown (program day briefs, mission content)
- **AI:** Anthropic via `lib/anthropic.ts` (project grading, AI mentor, recommendations, interview evaluation); OpenAI Realtime (WebRTC voice interview only)
- **Email:** Resend (`RESEND_API_KEY`) and Brevo (`@getbrevo/brevo`) — see `lib/email.ts`, `lib/workshop-email.ts`, `lib/hackathon-email.ts`
- **SMS/OTP:** MSG91 widget (`lib/msg91.ts`) for phone verification
- **PDF:** `pdf-lib` + `qrcode` for certificates (template overlay); `@react-pdf/renderer` for the recruiter report at `/r/[token]/pdf` (Node runtime only)
- **Supabase (residual):** `@supabase/supabase-js` still used for exactly two things — the hand-edited `workshop_config` row and the `cohort_applications` / `cohort_applications_india` tables. Everything else moved to Neon.
- **Validation:** Zod everywhere
- **Logging:** Custom `lib/logger.ts` (console wrappers, edge-safe)

**Critical:** Middleware must remain edge-safe — NO `@/lib/*` imports in `middleware.ts`. Uses only `next-auth` and `next/server`.

### Database connection rules (pooled vs direct)

| Operation | Endpoint |
|---|---|
| Ordinary app reads | Pooled `DATABASE_URL` (`-pooler.` host is fine) |
| Prisma migrations | `DIRECT_URL` (non-pooler) |
| Interactive transactions / writes via `writeClient()` | `DIRECT_URL` (non-pooler). `writeClient()` in `lib/db.ts` **always** uses the direct session, stripping `-pooler.` from `DATABASE_URL` as a fallback |

**Observed failure (do not re-litigate):** Neon's transaction-mode pooler drops Prisma **interactive transactions that use `SAVEPOINT`**. Dual-write (retired 2026-09-23) needed that behaviour; any remaining interactive-transaction / migration work that depends on savepoints must still use the **non-pooler** host. `PRODUCTION_NEON_HOST_ID` guards scripts against pointing at the wrong host.

---

## 4. Domain model (Prisma schema)

> **One canonical model.** The 078 redesign is complete and the original operational tables are dropped. Debug against `CandidateProfile`, `ProgramEnrollment`, `ActivityAttempt` / `ActivityEvaluation`, `PointsAccount` / `PointsTransaction`, and `Credential`. Unique history that cannot be reconstructed from live rows lives only in `Historical*` archives. See `docs/ARCHITECTURE.md`.

### Auth tables (Auth.js standard)
- `User` — `email`, `password` (dev only, plaintext), `role` (STUDENT | ADMIN | RECRUITER), `deletedAt` / `anonymizedAt` (soft delete + PII scrub), `disabledAt` / `sessionInvalidatedAt` (operator freeze), first-touch UTM fields. **No `synergyPoints` column** — the wallet is `PointsAccount`.
- `Account`, `Session`, `VerificationToken`

### Core enums
- `Role`: STUDENT, ADMIN, **RECRUITER**
- `UserType` / `CandidatePersona`: STUDENT, PROFESSIONAL — display persona on `CandidateProfile.primaryPersona`. Distinct from `Role`.
- `Domain`: SE, DS, AI, CLAUDE (Claude AI Mastery track — synchronized cohort, see `Challenge.startsAt`). Was ML originally, renamed to DS.
- `EnrollmentStatus`: ACTIVE, COMPLETED, ABANDONED — challenge-facing mapping from `ProgramEnrollment` (`pe_enr_*`)
- `EnrollmentStatusV2`: APPLIED, WAITLISTED, ACTIVE, COMPLETED, DROPPED, REMOVED — stored on `ProgramEnrollment`
- `ProgramMemberStatus`: APPLIED, WAITLISTED, ENROLLED, COMPLETED, DROPPED — compatibility enum mapped to/from `EnrollmentStatusV2` in `repositories/program-state.ts`. There is **no** `ProgramMember` table.
- `SubmissionStatus` / `AttemptLateness`: ON_TIME, LATE (attempts also have `NOT_APPLICABLE`)

### Identity / candidate
- `CandidateProfile` (1:1 with User) — `fullName`, `headline`, `summary`, `primaryPersona`, `phone` + `phoneVerified` / `phoneVerifiedAt` (admin-only visibility), `resumeUrl`, `linkedinUrl`, `githubUsername`, `referralCode` (unique), `isReadyForInterview`. Structured children: `CandidateEducation` (includes `collegeId`), `CandidateExperience`, `CandidateProjectEntry`, `CandidateCertification`, `CandidateSkill`, `CandidateLink`, `CandidatePreference`.
- `CandidateVisibility` — recruiter-discovery enforcement (`searchableByRecruiters` defaults true). Not a candidate preference screen.
- `CampusAmbassadorApplication` — dashboard opt-in / dismiss. Not a platform role.
- `CandidateResume` — uploaded résumé + parse merge.
- `PhoneVerification` (unique userId) — E.164 phone, verified flag; bridges OTP done before `CandidateProfile` exists.
- `Referral` (unique referredId) — referrerId, referredId, rewardGiven.

### Challenge catalog (content; membership is `ProgramEnrollment`)
- `Challenge` — one per Domain, `totalDays = 60`. Optional `startsAt: DateTime?` — when set (CLAUDE), the reference start is `max(startsAt, enrollment.startedAt)`; null = rolling start (SE/DS/AI).
- `DailyTask` — 1–60 per Challenge: `problemStatement`, `learningObjectives`, `resources`, `difficulty`, `estimatedMinutes`, `linkedinTemplate` (`{{github_link}}` placeholder), `solutionApproach` (admin-only), `tags`, `dayContent` (Json?) for rich CLAUDE day pages.
- Challenge membership is `ProgramEnrollment` with id `pe_enr_<legacyEnrollmentId>` (or a plain cuid for post-cutover joins). Days/streaks live as snapshots (`trackCurrentStreak` / `trackLongestStreak`) plus `ActivityAttempt` rows.
- Day submissions are `ActivityAttempt` (`aa_sub_*`); quiz answers are `ActivityAttempt` (`aa_qa_*`). GitHub URL uniqueness is an `ActivityAttempt` payload unique index.
- `Quiz` (unique challengeId+weekNumber), `QuizQuestion` (10 per quiz). Historical quiz JSON lives in `HistoricalQuizAttempt`.

### Synergy / rewards
- **One wallet:** `PointsAccount.balance` (optimistic `version` lock). `PointsTransaction` is the append-only ledger (`idempotencyKey @unique`).
- Every SP movement writes a `PointsTransaction` — awards, redemptions, refunds, and `BALANCE_RECONCILIATION` rows when an admin reset/reject would otherwise push a balance negative.
- `MarketplaceItem` — slug, title, description, `costSP`, imagePath, active, sortOrder
- `Redemption` — userId, itemId, costSP + itemTitle snapshots, `status` (PENDING | SHIPPED | FULFILLED | …), shippingAddress, recipientPhone, trackingNote

### Credentials
- `Credential` — `credentialId` (public, `ABT-XX-XXXXX`, Crockford alphabet, unique), userId, `type` / `sourceType` / `sourceKey` (`@@unique` so double-issue is structurally impossible), `status` (ISSUED | REVOKED), `recipientName` + `metadata` **snapshots at issue time**. Hackathon placement certs are extra `HACKATHON` rows distinguished by `metadata.hackathonVariant`. Historical certificate provenance is `HistoricalCertificate`.

### Recruiter-facing (challenge side)
- `RecruiterReview` (unique userId) — admin-curated anonymized assessment report: `/100` scores (communication / programming / behavior) + feedback, resume sections (`skillGroups`, `education`, `certifications`, `experience`, `projects`, `achievements[]`, `languagesSpoken[]`), `codingChallenges`, strengths / areasForGrowth, `recommendation` (`RecommendationLevel`), admin-only `logistics` + `compensation`, `isPublished` + `shareToken` (unique) for the public `/r/[token]` page.
- `Job` (`JobType`: FULL_TIME | INTERNSHIP | CONTRACT | PART_TIME) and `JobApplication` (unique jobId+userId)

### Hire / recruiter desk tables
- `TalentRequest` — one recruiter brief. Holds the spec Scout assembled (role, stack, experience, budget, location) plus the transcript, so a guest conversation can be adopted onto a row at sign-in rather than lost. `alertWhenAvailable` is set by the demand button when a search returns nothing.
- `TalentEngagementRequest` — **one row per recruiter/candidate pair**, deliberately not one per batch: the team decides each introduction separately and contact release is per pair. `status` (`TalentEngagementStatus`: DRAFT → SUBMITTED → IN_REVIEW → CONTACT_SHARED / DECLINED / CLOSED) is what releases identity — access is *derived* from this status and never stored as a second flag a bug could leave switched on. `source` (`TalentCandidateSource`: PROGRAM | CHALLENGE_60 | CLAUDE | HACKATHON) records which track the candidate came from. `candidatePublicId` denormalises the AB-#### the recruiter saw, so admin and recruiter are demonstrably discussing the same person.
- `TalentEngagementMessage` — the thread on one engagement; `authorRole` is `recruiter` | `admin`.
- `CandidateAvailability` — candidate-side availability, kept apart from `searchableByRecruiters`.
- `VerifiedRecruiterSeat` — allow-list of verified recruiter seats.
- `RecruiterEmailOtp` — email OTP baseline for recruiter sign-in (recruiters have their own door at `/talent/login`, not the candidate Google button).

### Reference data
- `College` — canonical institution catalog (54,651 institutions), queried with a pg_trgm index. `CandidateEducation.collegeId` stores the picked id.

### Notifications
- `Notification` + `NotificationRead` — admin-composed notices (`/admin/notifications`). Read state is keyed by an **opaque string, deliberately not an FK**. Automated workshop / hackathon / cohort notices are **derived at read time** from `EVENTS`, hackathon config and `ENROLLING` `ProgramCohort` rows — no rows, no cron, and the read path stays write-free. The bell shows only the newest 5 items (`FEED_LIMIT`), so there is deliberately no dismiss control and no dismissed state.

### Legal / consent tables
- `LegalConsent` — every terms/privacy acceptance, including `source: "oauth_signup"` rows written by `auth.ts` `events.createUser`
- `DataRightsRequest` — DPDP DSAR intake, surfaced at `/admin/data-requests`
- `NewsletterSubscription` — newsletter opt-in captured on all signup funnels

### Admin tables
- `AdminAction` — adminUserId, targetUserId, `actionType` (string), metadata (Json), reason, createdAt. Written by every admin mutation across all tracks, not just the 5 original student actions.
- `AdminRemark` — admin-only free-text remark history on a student (CRUD writes an `AdminAction` audit row)

### Hackathon tables (all on Neon — the Supabase `hackathon_*` tables are retired)
- `HackathonTeam` — `entryType` (SOLO | TEAM), teamName, `teamCode` (unique). Unique index on `lower(team_name)` where not null.
- `HackathonParticipant` — `userId` **globally unique** (one hackathon registration per person), teamId + `slotIndex` (unique together), isLeader, contact/college fields, `sourceSlug` (share-link attribution)
- `HackathonRemoval` — append-only removal log. The participant row is **hard-deleted** on removal (frees `userId` and the slot); this table preserves who/by whom/original `sourceSlug` so a rejoin keeps attribution. `removedByRole`: LEADER | ADMIN.
- `HackathonEvent` — singleton (id = 1), `problemStatement` for the live kickoff brief
- `HackathonProblem`, `HackathonSubmission` — the submission flow at `/hackathon/submission`. `HackathonSubmission.teamId` is unique: **one submission per team**, which is exactly why hackathons stay a separate bounded subsystem (see below).
- `HackathonLink` — named share links (`?s=<slug>`), inserted by hand / seeded

### Workshop table
- `WorkshopRegistration` — every workshop/webinar signup, **all events in one table** keyed by `eventId` (matches `WorkshopEvent.id` in `components/workshop/events-data.ts`; events stay code-defined because they carry marketing copy + Lucide icons). `userId` is **REQUIRED** — Google sign-in is mandatory, so every row belongs to a real User. Only constraint is `@@unique([eventId, userId])`: the same person is expected to register for each weekly workshop, but not twice for the same one. Row snapshots name/email/phone/role/organization/graduationYear because a workshop-only attendee has a `User` but may have no `CandidateProfile`.

### Program tables (`/program` track)
Enums: `ProgramCohortStatus` (DRAFT | ENROLLING | ACTIVE | COMPLETED | ARCHIVED), `ProgramMemberStatus` (compatibility mapping only), `ProgramLanguage` (PYTHON | SQL | JAVASCRIPT | YAML), `ProgramEntrySection`, `ProgramInterviewStatus`, `ProgramProjectStatus`, `ProgramMissionType` (CODE_SPRINT | SHIP_IT | DATA_ROOM | PROMPT_FORGE | BOSS_BUILD), `ProgramDayState` (LOCKED | AVAILABLE | PASSED | SKIPPED).

- `ProgramCohort` — name, `joinCode` (unique), startsAt / endsAt, capacity, status, `requiresJoinCode` (default true; false = open enrollment), `resultsPublishedAt`. This is the **admin-facing** cohort table; the 078 learning catalog has a separate canonical `Cohort` model, and **that** is what every member-facing read goes through. Its `startsAt`/`endsAt` are non-nullable here, so a rolling cohort carries a placeholder window; the canonical row holds the real nulls. Admin writes mirror onto the canonical row (`mirrorToCanonicalCohort` in `features/program/admin.ts`, plan 157) — before that they hit `ProgramCohort` alone and never reached members.
- AI-cohort membership is `ProgramEnrollment` with id `pe_pm_<legacyProgramMemberId>` (or a plain cuid for post-cutover joins). Status, skip tokens, unlock floor, and score/recommendation snapshots live on that row. Identity (name, job, company) is `CandidateProfile` / children. Recruiter permission is `CandidateVisibility`, not a membership stamp.
- `ProgramModule`, `ProgramDay`, `ProgramConceptQuestion`, `ProgramConceptAttempt` — day/mission catalog and concept checks
- Mission submissions are `ActivityAttempt` (`aa_ms_*`); unique history is `HistoricalProgramMission`
- `ProgramEntryQuestion`, `ProgramEntryAttempt` (entry assessment — retained in schema, bypassed in product)
- `ProgramVideo`, `ProgramExercise`, `ProgramExerciseCompletion`
- `ProgramCommitDay`, `ProgramProject`, `ProgramInterview`, `GeneralInterview` — live children keyed by `programEnrollmentId`
- `RecruiterProfile`, `RecruiterShortlistItem` — shortlist candidate identity is `candidateUserId` (FK to `User`); `memberId` is retained as a scalar id string (`pe_pm_*`)

---

### Canonical platform architecture (078 complete)

Source plans: `docs/plans/078-platform-data-architecture-redesign.md` (the design).
Live summary: `docs/ARCHITECTURE.md`.

**State as of 2026-09-23:** every 078 wave through the final drop is **done**. The
canonical tables serve reads and writes. Original operational tables and
`User.synergyPoints` are dropped in production. Dual-write, migration flags, and
the 078 script/cron control plane are retired. See §18.

Public/historical identifier strings stay stable (`pe_enr_*`, `pe_pm_*`,
`aa_sub_*`, `aa_qa_*`, `aa_ms_*`, `ABT-*` credential ids). New rows may use
plain cuids.

#### Three bounded contexts + one shared identity

**IDENTITY / CANDIDATE** — `User`, `UserRoleAssignment`, `CandidateProfile`,
`CandidateVisibility`, `CandidateEducation`, `CandidateExperience`,
`CandidateProjectEntry`, `CandidateCertification`, `CandidatePreference`,
`SkillCategory`, `Skill`, `CandidateSkill`

**LEARNING** — `ProgramCategory`, `LearningProgram`, `ProgramVersion`, `Cohort`,
`Module`, `Activity`, `ActivityPrerequisite`, the typed activity configs
(`CodingActivityConfig` + `TestCase`, `QuizActivityConfig` + `Question` +
`QuestionOption`, `ProjectActivityConfig`, `ContentActivityConfig`,
`ExternalSubmissionConfig`), `ActivitySkill`, `ProgramSkill`, `ProgramEnrollment`,
`EnrollmentProgress`, `ActivityAttempt`, `ActivityEvaluation`,
`EnrollmentDayActivity`

**RECRUITING** — `Organization`, `OrganizationMember`, `RecruiterProfile`,
`TalentList`, `TalentListItem`, `CandidateNote`, `Job`, `JobApplication`,
`JobSkill`, `AssessmentReport`, `AssessmentScore`, `AssessmentReportShare`

**CROSS-CUTTING** (written by many, read by the profile) — `Credential`,
`CandidateAchievement`, `PointsAccount`, `PointsTransaction`, `SkillEvidence`

> **The invariant that makes this work: learning WRITES evidence, recruiting READS
> evidence.** The two contexts share `User.id` and nothing else. Recruiting must
> never depend on learning subsystem internals, and learning must never read
> recruiting tables.

#### Program → Version → Cohort

| Model | What it is |
|---|---|
| `LearningProgram` | the reusable program definition — e.g. "31 Days of Databricks" |
| `ProgramVersion` | an immutable, published content snapshot — Version 1 |
| `Cohort` | one scheduled run of one `ProgramVersion` — the Aug 2026 cohort |

```
"31 Days of Databricks"  →  Version 1  →  Aug 2026 cohort
                         →  Version 2  →  Sep/Oct cohort
```

Editing content for a future run means publishing a **new version**, never
mutating the old one. That is what prevents a future content edit from changing
historical submissions and results.

`Cohort.startMode` (`ROLLING | FIXED`) plus an optional `startsAt` floor plus
`Cohort.timezone` reproduce all of today's day-math in one expression: rolling
(SE/DS/AI), hybrid (CLAUDE — `max(challenge.startsAt, enrollment.startedAt)`)
and fixed-date (the Program cohort).

#### Unified Activity / Attempt / Evaluation

`ActivityType` currently supports: `CODING`, `QUIZ`, `PROJECT`, `ASSIGNMENT`,
`CONTENT`, `VIDEO`, `INTERVIEW`, `EXTERNAL_SUBMISSION`, `DAILY_CHALLENGE`.

- **`ActivityAttempt`** — what the candidate submitted or did (payload, attempt
  number, timestamps, lateness). Candidate/enrollment-owned: every attempt belongs
  to exactly one enrolled user. **This is the live serving representation** for
  challenge days, quizzes, and program missions.
- **`ActivityEvaluation`** — what was *decided* about that attempt.
  `EvaluatorType`: `AUTO | AI | HUMAN | EXTERNAL | SELF`. Multiple evaluations per
  attempt, so re-grading and admin override keep full history instead of
  destructively overwriting a score.

#### Hackathon: deliberately a separate bounded subsystem

078 decision (§3.4 of the plan): **do not** force hackathon submissions into
`ActivityAttempt`. `ActivityAttempt` is candidate/enrollment-owned; a hackathon
submission is **team**-owned (`HackathonSubmission.teamId` is unique), with slot
mechanics and audited removals. Modelling that as an attempt would require
group-owned attempts, breaking the invariant that keeps the learning side safe to
reason about.

Hackathon outcomes reach the unified profile through **three explicit bridges**,
written by the hackathon subsystem and read by the recruiting side:

| Bridge | Written when | What the recruiter sees |
|---|---|---|
| `CandidateAchievement` | results published / submission accepted | "ViCoDathon 2026 — 2nd place, team Nova" |
| `Credential` (`sourceType: HACKATHON_TEAM`) | certificate issued | a verifiable credential in the candidate's list |
| `SkillEvidence` (`sourceType: HACKATHON`) | results published, per `HackathonProblem.skills` | contributes to `CandidateSkill.evidenceScore` |

`CandidateAchievement` is the **generic** bridge — any future subsystem writes one
row and appears on the unified profile without recruiting learning anything about
that subsystem's internals.

**Target vs today:** the target architecture supports **multiple hackathons per
person** (participation is per event). The live schema still has
`HackathonParticipant.userId` **globally unique** — one hackathon registration per
person, forever. That constraint has **not** been changed.

#### Credentials, certifications and evidence — three different things

| Model | Meaning |
|---|---|
| `CandidateCertification` | an **external** certification the candidate claims (AWS, Coursera, …) |
| `Credential` | a **platform-issued**, verifiable credential. Append-only; `@@unique([type, sourceType, sourceKey])` makes double-issue structurally impossible |
| `SkillEvidence` | evidence rows emitted by learning, hackathons, assessments and future subsystems |
| `CandidateSkill.evidenceScore` / `.verified` | **derived / cached** from `SkillEvidence`, recomputed on evidence insert |
| `CandidateAchievement` | the generic bridge for accomplishments from any subsystem into the unified profile |

**`SkillEvidence` has no live writer** (verified 2026-09-04, still true at 078
closure). Only the historical `migrate-2i-achievements` backfill wrote it, so
`CandidateSkill.evidenceScore` / `.verified` are frozen at backfill time. Fixing
that is P0-0 in plan 112.

#### Points

`PointsTransaction` is the append-only source of truth, with `idempotencyKey
@unique` making duplicate awards structurally impossible. `PointsAccount.balance`
is a cached balance written in the same transaction, with a `version` optimistic
lock. `User.synergyPoints` and `SynergyEvent` are gone; unique old ledger rows
are `HistoricalSynergyEvent`.

#### Interviews

```
Activity(type = INTERVIEW) → ActivityAttempt → ActivityEvaluation
                           → AssessmentReport → AssessmentScore
```

`ProgramInterview` (the exit voice interview) is still the **live** model for the
AI Cohort, now keyed by `programEnrollmentId`. Future interview-agent work should
go through the repository layer (§9) rather than binding tightly to
`ProgramInterview`.

#### Source of truth vs cache

| Fact | Source of truth | Cache |
|---|---|---|
| Points balance | `PointsTransaction` (SUM) | `PointsAccount.balance` |
| Activity completion | `ActivityEvaluation.passed` | `ActivityAttempt.passed`, `EnrollmentProgress.completedActivities` |
| Progress % / score / streak | attempts + evaluations | `EnrollmentProgress.*` (same-transaction write); challenge streaks also snapshot on `ProgramEnrollment.trackCurrentStreak` / `trackLongestStreak` |
| Skill strength | `SkillEvidence` | `CandidateSkill.evidenceScore` / `.verified` |
| Credential contents | — | **N/A — deliberate immutable snapshot** |

`EnrollmentProgress` is never the input to an authorization or unlock decision;
those recompute from attempts.

#### Learning catalog (seeded; still live)

**5 programs · 9 cohorts · 342 activities**, seeded idempotently:

- one `LearningProgram` per challenge `Domain` (SE / DS / AI / CLAUDE) plus
  `ai-cohort-program`
- cohort slugs `legacy-se`, `legacy-ds`, `legacy-ai`, `legacy-claude`
  (`cohortSlugForDomain`) and `legacy-program-<programCohortId>` per existing
  `ProgramCohort` (`cohortSlugForProgramCohort`)
- activities carry deterministic ids derived from their original rows —
  `act_dt_<dailyTaskId>`, `act_pd_<programDayId>` (see `src/repositories/ids.ts`)

#### Historical archives (immutable except compliance PII scrub)

| Object | Status |
|---|---|
| `HistoricalQuizAttempt` | ARCHIVE — raw quiz `answers` JSON |
| `HistoricalProgramMission` | ARCHIVE — mission payload/verdict |
| `HistoricalCertificate` | ARCHIVE — certificate provenance |
| `HistoricalSubmission` | ARCHIVE — submission metadata |
| `HistoricalSynergyEvent` | ARCHIVE — legacy points events |
| `HistoricalStudentProfile` | ARCHIVE — identity snapshot |

Original tables `StudentProfile`, `Enrollment`, `ProgramMember`, `Certificate`,
`Submission`, `QuizAttempt`, `ProgramMissionSubmission`, `SynergyEvent` are
**dropped**. There is no dual-write path.

---

## 5. Business rules

### Challenge day calculation (IST)
- All challenge day boundaries in IST (Asia/Kolkata)
- Day 1 = day of the reference start in IST (`max(challenge.startsAt, enrollment.startedAt)` when synchronized; else `enrollment.startedAt`)
- `getCurrentDayNumber` in `lib/date-utils.ts` **caps at 60** — use for display, unlocking, streaks
- `getElapsedDayNumber` is **uncapped** (61+) — the only correct input for backfill / relaxation-window decisions. Using the capped version here is what broke day-60 submissions; do not use it for UI day labels either.
- CLAUDE enrollments roll from the real join date, floored at the cohort `startsAt`
- `BYPASS_DAY_LOCKS=true` bypasses challenge day-lock gating server-side (dev only)

### Submission validation
- GitHub URL must match `https://github.com/{owner}/{repo}`, be globally unique, and return HTTP 2xx on HEAD (5s timeout)
- LinkedIn URL format-only (`/posts/…` or `/feed/update/…`) — LinkedIn blocks bots
- Both proof URLs are **optional** since Synergy; a submission with neither still counts for the day but earns fewer SP

### Synergy points (SP)
- Per submission: `10` base `+ 5` if GitHub proof `+ 8` if LinkedIn proof (`features/synergy/scoring.ts`)
- Referral: `3` SP
- `PointsAccount.balance` is the denormalized wallet (one wallet for challenge **and** hackathon students). `PointsTransaction` is the source of truth — never move SP without writing a ledger row.
- Admin community synergy grant cap: **3000** (raised from 2000 on 2026-08-18)
- Admin reset / reject clamps `PointsAccount.balance` at 0 and writes a `BALANCE_RECONCILIATION` transaction for already-spent submission points, so the ledger can never go negative

### Streaks
- `currentStreak` = consecutive ON_TIME submissions ending today/yesterday; `longestStreak` = max ever reached
- Late submissions don't count; missing a day resets to 0
- Streaks / `daysCompleted` are **write-time only** (`submitDay`) — dashboard read paths must never write

### Leaderboard (per-domain)
1. daysCompleted DESC → 2. currentStreak DESC → 3. longestStreak DESC → 4. startedAt ASC. Cached 5-min TTL via `unstable_cache`.
- Immutable content (daily tasks, `Challenge.startsAt`) cached via `unstable_cache` tags `daily-tasks:<challengeId>` / `challenge:CLAUDE`, busted on reseed/redeploy.

### Certificates
- Claude Challenge certificate issues when there is a **Day 60 submission AND `daysCompleted >= 50`** — deliberately not gated on `EnrollmentStatus.COMPLETED`
- ID format `ABT-XX-XXXXX` (CC / HK / CH / WS per type), Crockford alphabet (no 0/O/1/I/L)
- Rendered by overlaying `pdf-lib` text + QR onto a template PDF in `public/certificates/` (mtime-busted cache). `CERTIFICATE_TEMPLATE_URL` / `CERTIFICATE_TEMPLATE_PATH` optionally override with a no-store fetch.
- Public verification at `/verify/[certificateId]`, download at `/verify/[certificateId]/download`
- Hackathon: ViCoDathon 2026 participation certificates (`ABT-HK-XXXXX`), with per-type templates via `HACKATHON_CERTIFICATE_TEMPLATE_URL` / `_PATH`. Placement certs (winner / 2nd / 3rd / top5) are extra `HACKATHON` rows keyed by `metadata.hackathonVariant`, issuable on production via `--all --allow-production` on `issue-hackathon-award-certificates.ts`

### Marketplace
- Redeem spends SP inside a transaction: balance check → `Redemption` row → negative `PointsTransaction`. Refund is the mirror image.
- Catalog `costSP` currently 1800 SP across `marketplace.json`

### Quiz availability
- Only the CURRENT week's quiz is shown; `currentWeek = Math.min(Math.floor(daysCompleted / 7), 8)`
- Already-attempted → show score; not seeded → show nothing; past attempts in "Quiz History"

### Referrals
- 6-char uppercase alphanumeric code per `CandidateProfile`; reward at referred user's Day 7
- Persisted via `abtalks_ref` httpOnly cookie (7 days, set in middleware)
- Badges: bronze (1), silver (5), gold (10), platinum (25)

### Hackathon
- Solo or team entry; team joined by `teamCode`; duplicate team names blocked case-insensitively
- Registration requires a Google session; one participant row per user globally
- Share-link attribution: `?s=<slug>` → `abtalks_src` httpOnly cookie, **first touch wins**, 30 days, copied to `HackathonParticipant.sourceSlug`
- Removal hard-deletes the participant and writes a `HackathonRemoval` row (leader or admin); rejoin re-uses the preserved `sourceSlug`
- A logged-in user with a hackathon registration but no `CandidateProfile` is diverted to `/hackathon/dashboard` (not `/register`) from `/`, `/dashboard` and `/login`

### Workshop
- Page public, **form session-gated**: the event is resolved server-side from the IST day key, never from the client; email comes from the session
- `P2002` on `[eventId, userId]` → friendly duplicate message; confirmation email failure is logged and swallowed

### Program (AI Cohort) — differs from the challenge on purpose
- **Timezone: `PROGRAM_TZ`, now `Asia/Kolkata`** (changed from America/Chicago on 2026-08-12). Day unlock uses **the learner's own calendar** — `ProgramEnrollment.startedAt`, wrapped as `ProgramAnchor` in `features/program/progression.ts` (plan 157, 2026-09-28) — with a sequential gate (no unlock-on-pass); admin `unlockFloorDay` is a floor override. The track is ROLLING: people join on any day and Day 1 is their join date, matching snowflake / databricks / powerbi / ds-architect. Calendar-key math stays UTC-based (`addCalendarDaysToKey`) so a timezone reformat doesn't drop day 0. Admin cohort `startsAt`/`endsAt` round-trip via `fromZonedTime(PROGRAM_TZ)` so Mission Control's cohort day matches today's mission. Never hard-code the zone — read `PROGRAM_TZ`.
- **Capacity (plan 157, 2026-09-28):** `Cohort.capacity` **null means unlimited**, and that is the default for a new cohort. The AI cohort holds the **only** capacity gate on the platform — `enrollOrWaitlist` (`features/program/entry.ts`) and `promoteWaitlisted` (`features/program/admin.ts`), both reading the canonical row and skipping the check when it is null. The challenge track and the snowflake / databricks / databricks-ai / powerbi / ds-architect tracks have never had one, and the invariants test fails if one appears. A waitlisted applicant is fully blocked (not queued): `findActiveMembership` admits only ACTIVE/COMPLETED, and `getEntryState` pins them on the waitlist screen with no self-serve retry, so only `promoteWaitlisted` releases them.
- **Freeze rule (plan 157, 2026-09-28):** `isCohortFrozen` gates on cohort **status** alone — `ARCHIVED` or `COMPLETED`. **No track freezes on a date.** `isCohortPastEndsAt` and the `PROGRAM_HOLD_OPEN_COHORT_NAME` name-string hack are deleted; the live cohorts are `startMode = ROLLING` with null `startsAt`/`endsAt`. The AI cohort was the last FIXED track: its open cohort's `endsAt` of 2026-09-02 refused every mission submit while people kept joining. Guarded by `npm run test:rolling-cohort`.
- 31 days total (`PROGRAM_TOTAL_DAYS`), max score 1020 = 372 mission + 93 concept + 155 commit + 400 project
- New ENROLLED members **start at Day 4**; Days 1–3 are waived as PASSED with mission points (`npm run db:bootstrap:program-start-day` backfills existing members)
- 5 server-verified mission types: CODE_SPRINT (hidden outputs), SHIP_IT (GitHub repo checks — file existence only; content/minLines/notebook checks gated off), DATA_ROOM (answers), PROMPT_FORGE (Anthropic eval cases), BOSS_BUILD (project submit). Unlimited runs, 15s spacing, 30/day cap. Pass unlocks the next day (+12 mission pts; `cleanPassCount` when passed on attempt #1).
- Skip tokens (2, after ≥3 fails) are **disabled for members** currently; concept checks and the entry assessment are **bypassed** (`isProgramEntryBypassEnabled()` returns true unconditionally) — apply enrolls or waitlists directly
- Commit tracking: daily Vercel cron polls GitHub per member repo; `commitPoints = 5 × qualifying ProgramCommitDay rows` (cap 150), preserving the existing floor via `Math.max` so seeded days aren't wiped. Commit UI is archived on Mission Control (`PROGRAM_COMMIT_UI_ENABLED = false`); backend retained.
- Behind-by / at-risk pace uses the **learner's own calendar day** (plan 157; was the shared cohort day), not the Day-4 unlock ceiling (calendar+3) — otherwise on-time members were falsely flagged ~4 days behind
- At-risk = behind >2 days, stuck on a mission >2 IST days, or 0 commits in the last 5 days
- Exit voice interview: one 15-min OpenAI Realtime WebRTC session per member, unlocked on Day 31 progress or cohort end; server-minted ephemeral secret at `POST /api/program/interview/session`; transcript stored then Claude-evaluated (comm / tech / problem / overall + summary), scored separately from `totalScore`; max 2 member restarts; admin can reset / re-evaluate
- AI layer: admin-triggered Claude project grading (rubrics.json + GitHub context, admin override → AdminAction); member-triggered AI Mentor review (one per passed mission/day); batch recommendations with 7-day TTL; `projectPoints` recomputed idempotently via `recomputeMemberScore`
- Recruiter portal `/talent`: Google sign-in + company profile, admin approval, pool gated on `cohort.resultsPublishedAt`; ranked profiles with mission portfolio, projects, interview summary, private shortlists. **Member phone / entry details are never exposed.**
- `missionSpec` is server-only; `assetsJson` is the only client-safe day asset

### Recruiter discoverability and candidate visibility (current product decision)

**Recruiter discoverability is a platform default, not a user-facing profile
toggle.** Being searchable is the default state:
`CandidateVisibility.searchableByRecruiters` defaults to `true`.

`CandidateVisibility` is an **internal enforcement / privacy / moderation
structure** (it carries `withdrawnAt`, `consentSource`), not a preference screen.

Three concepts that must not be collapsed into one:

| Concept | Meaning |
|---|---|
| `searchableByRecruiters` | may a recruiter *discover* this candidate at all |
| per-field privacy | which fields a recruiter may *see* — email, phone, résumé, assessment/interview detail stay separately gated. Being searchable does **not** make any of these public. Member phone / entry details are never exposed. |
| `CandidatePreference.openToWork` | is the candidate *actively job hunting* |

`searchableByRecruiters = true` with `openToWork = false` is a normal, expected
state: *"recruiters may discover this candidate, but they are not currently
looking."*

**Live visibility fragment:** `searchableUserWhere()` in `src/repositories/talent.ts`
requires `CandidateVisibility.searchableByRecruiters = true` and `withdrawnAt` null.

**Legal copy is out of step and this is a known, deferred task.** The published
Privacy/Terms copy still describes recruiter discoverability as **opt-in**.
Reconciling that copy (or the product decision) is a pending business/legal item —
it is *not* solved.

### Campus Ambassador
- Onboarding is **off-site** (abtalksca.netlify.app); the in-dashboard apply flow is stopped
- Challenge-enrolled students see a banner plus a derived bell notice

### Legal / consent
- `TERMS_VERSION` `2026-08-10`, `PRIVACY_VERSION` `2026-08-11` (client-safe constants live in `src/lib/legal-constants.ts` — importing `@/lib/legal` from a client component pulls `node:fs/promises` into the browser bundle)
- Consent is recorded at OAuth signup: `auth.ts` `events.createUser` writes TERMS+PRIVACY rows under source `oauth_signup`. `/login` carries a notice, not a checkbox
- Cookie chooser is a small bottom-right banner (all | limited | essential), stored in the `abtalks_consent` cookie with no DB row; it gates `abtalks_ref` / `abtalks_src` in middleware
- Newsletter opt-in is pre-checked on all signup funnels and excluded from the submit gate
- Bumping a version triggers the reconsent banner

### Phone OTP
- MSG91 OTP required in production; **skipped under `next dev`** (`isOtpVerificationRequired()` returns false when `NODE_ENV === "development"`)
- `OTP_DEV_BYPASS=true` + `OTP_DEV_CODE` (default `1234`) for non-dev-mode local/CI runs

### Admin actions
- Original 5 student actions: markDayComplete (`admin-marked://` URL), resetProgress, toggleReadyForInterview, removeFromChallenge (soft → ABANDONED), rejectSubmission
- Plus hackathon, program, recruiter, redemption, job, remark and link admin mutations — **all wrapped in a transaction with an `AdminAction` audit row**, surfaced in the paginated `/admin/actions` feed

---

## 6. Authentication architecture

### Two auth modes
- **Production (Vercel):** Google OAuth only. `ENABLE_DEV_AUTH` not set.
- **Local dev:** Google OAuth (if configured) AND Credentials (email + plaintext password).
- Dev credentials login always navigates **same-origin** (ignores the `AUTH_URL` host in `result.url`) so LAN/phone testing works; local `AUTH_URL` is optional when `trustHost` is on. `allowedDevOrigins` auto-includes LAN IPv4s so Next 16 serves `/_next` on the Network URL.

### Auth.js v5 split config
- `src/auth.config.ts` — minimal, edge-safe (no Prisma, no `@/lib/*`). Used by middleware.
- `src/auth.ts` — PrismaAdapter + real Credentials authorize. Used everywhere else.
- Required because Vercel middleware runs in Edge Runtime with a 1 MB bundle limit.

### Session strategy
- JWT sessions (stateless). `AUTH_SECRET` required, no fallback. `trustHost: true`.
- Cookies: `__Secure-authjs.session-token` (prod) / `authjs.session-token` (local)

### Authorization layers
- **Admin:** email-based via `ADMIN_EMAILS`; `requireAdmin()` in `lib/admin-auth.ts`; `session.user.isAdmin` computed in the JWT/session callback. No DB role for admin.
- **Program / recruiter:** `lib/program-auth.ts` (node-only) — `requireProgramMember` (resolved by membership, not by role) and `requireRecruiter` (DB-checked, `Role.RECRUITER` + admin approval)
- **Middleware:** path-prefix list only (`/dashboard`, `/explore`, `/challenge/`, `/profile`, `/achievements`, `/quiz`, `/register`, `/admin`, `/jobs`, `/mission`, `/program/*` app routes, `/talent`, `/hackathon/register`, `/hackathon/dashboard`) — redirects to `/login?from=…`. It also sets the `abtalks_ref` and `abtalks_src` tracking cookies on every request.

### Stale session warning
- JWT sessions don't verify the user still exists in the DB per request. Deleted users keep a valid cookie until expiry; FK violations are possible. Cleanup-script deletions require clearing cookies / incognito.

---

## 7. Routing structure

### Public
- `/` — the marketing landing site, rebuilt from the final static build as `src/components/landing/site/` (page-scoped `--lp-*` CSS, a shared `ScrollEngine`, contact form → team@abtalks.in). It renders for signed-out visitors only. Signed-in accounts with a `RecruiterProfile` (including pending applicants) redirect to Scout at `/hire`; every other signed-in account redirects to `/dashboard`, whose existing guard handles profileless enrollment flows. `/login` bounces signed-in users to `/`, which then resolves that home destination.
- `/challenges` — public 60-day challenge overview (domain picker, streak grid, FAQ)
- `/login`
- `/students/[id]` — public student profile (basic info only)
- `/claude-signup` — Claude track signup / interest page
- `/verify/[certificateId]` + `/verify/[certificateId]/download` — public certificate verification and PDF download
- `/r/[token]` + `/r/[token]/pdf` — public share link for an admin-curated recruiter assessment report
- `/ai-workshop`, `/ai-workshop/events` — workshop microsite. Page public; the **registration form requires a Google session**. Signups → Neon `WorkshopRegistration`; `workshop_config` (Zoom/WhatsApp links) still read from Supabase.
- `/ai-cohort-register` + `/apply` — AI Cohort (US) onboarding + 5-step application → Supabase `cohort_applications`
- `/ai-cohort-india` + `/apply` — India clone → Supabase `cohort_applications_india`
- `/hackathon` — hackathon landing (`/hackathon/register`, `/hackathon/dashboard`, `/hackathon/submission` are protected)
- `/program` — program landing (`isProgramEnabled()` currently always returns true)
- `/terms`, `/privacy`, `/privacy/requests`, `/cookies`, `/contact` — legal surface (entity + Grievance Officer blocks, DPDP rights, DSAR intake)

### Protected (student)
- `/register` — **profile-only** since 2026-08-20: no domain pick, no enrollment. "Registered" = has a `CandidateProfile`; the first track joined is ordered by `ProgramEnrollment.joinedAt`. Supports STUDENT and PROFESSIONAL persona, plus CLAUDE-forced mode via `?domain=CLAUDE`
- `/dashboard` — the **student hub** (plan 066): `DashboardShell` + `getHubData`, hero greeting, activity heatmap, streak card, Continue Journey, Other Challenges, Roadmaps, Events, FAQ. Master-only production pieces that survive on top of the hub: the **campus ambassador banner**, the **hackathon promo modal**, and the hackathon/program redirect behavior for users without a profile.
  - Hub reads `ProgramEnrollment` / `ActivityAttempt` via `getHubData` → `repositories/learning` and `repositories/progress`.
- `/ai`, `/ds`, `/se`, `/claude` — per-track dashboards (`TRACK_PATH` in the hub)
- `/explore` — track list / cross-track discovery
- `/challenge/today` → `/challenge/[day]` — uses `dailyTask.dayContent` when present, else catalog text fields
- `/profile`, `/quiz/[quizId]`
- `/achievements` — earned certificates
- `/mission` — community / mission page (Discord link)
- `/marketplace` — redeem SP
- `/jobs`, `/jobs/[id]` — jobs board + apply

### Protected (hackathon)
- `/hackathon/register`, `/hackathon/dashboard`

### Protected (program)
- `/program/apply`, `/program/assessment`
- `/program/dashboard` (Mission Control), `/program/day/[day]`, `/program/curriculum`, `/program/videos`, `/program/leaderboard`, `/program/interview`

### Recruiter desk
- `/hire` — Scout. **Public**: the conversation and a search run for guests; auth is a dialog at checkout, not a wall at the door. `/hire/matches` is public too.
- `/hire/requests`, `/hire/[requestId]`, `/hire/evidence` — behind a session.
- `/talent/shortlist` (the cart), `/talent/members/[id]` (evidence profile), `/talent/login`, `/talent/register`, `/talent/pending` — retained.
- `/talent` — **the pool browser was removed.** It listed the same candidates the search already ranks, and `getTalentPool` was the query still selecting `fullName`. The path is now a permanent redirect to `/hire`; middleware stops gating it so the redirect can fire.

### Admin (`/admin`, requires admin email)
- `/admin` — overview, live submissions feed, recent admin actions
- `/admin/students`, `/admin/students/[id]` (tabs + StudentActionPanel + remarks). Lists challenge **and** hackathon students via a track filter (`ALL | CHALLENGE | HACKATHON`)
- `/admin/submissions` (with a Hackathon sub-tab for the `HackathonSubmission` feed + CSV), `/admin/content`, `/admin/analytics`
- `/admin/actions` — paginated audit-log feed
- `/admin/notifications` — notification composer
- `/admin/data-requests` — DSAR queue
- `/admin/campus-ambassadors`, `/admin/referrals`, `/admin/redemptions`
- `/admin/jobs`, `/admin/jobs/[id]`
- `/admin/workshop` — per-event rosters (Registrations / Analytics tabs, `?events=` filter), CSV export
- `/admin/hackathon`, `/admin/hackathon/students`, `/admin/hackathon-links`
- `/admin/ai-cohort` — Supabase cohort applications (US + India)
- `/admin/program`, `/admin/program/members`, `/admin/program/members/[id]`, `/admin/program/content`, `/admin/program/projects`, `/admin/program/interviews`, `/admin/program/recruiters`

### API routes (sparse — most logic via Server Actions)
- `/api/auth/[...nextauth]` — Auth.js handler
- `/api/claude-recent-signups` — public ticker data
- `/api/cron/program-commits` — Vercel cron, Bearer-auth via `CRON_SECRET`
- `/api/program/interview/session` — mints an OpenAI Realtime ephemeral secret
- `/api/chat` — site help chatbot (behind `ENABLE_CHATBOT`)
- `/api/cron/hire-alerts` — Vercel cron; notifies recruiters whose `alertWhenAvailable` brief now has matches

---

## 8. Server Actions (`src/app/actions/`)

**Challenge core:** `auth-actions`, `registration-actions`, `enrollment-actions`, `submission-actions`, `profile-actions`, `quiz-actions`, `referral-actions`, `otp-actions`, `synergy-actions`

**Student features:** `marketplace-actions`, `job-actions`

**Hackathon:** `hackathon-actions`, `hackathon-auth-actions`, `hackathon-team-actions`

**Workshop / cohort funnel:** `workshop-actions`, `cohort-application-actions`, `cohort-application-india-actions`

**Program:** `program-entry-actions`, `program-mission-actions`, `program-ai-actions`, `program-interview-actions`, `talent-actions`

**Recruiter (challenge side):** `recruiter-review-actions`

**Hire desk:** `hire-actions`, `hire-guest-actions`, `hire-request-actions`, `recruiter-auth-actions`, `recruiter-seat-actions`

**Admin:** `admin-actions`, `admin-export-actions`, `admin-remark-actions`, `admin-redemption-actions`, `admin-job-actions`, `admin-recruiter-actions`, `admin-hackathon-actions`, `admin-hackathon-link-actions`, `admin-program-actions`, `admin-program-export-actions`, `campus-ambassador-actions`

All return the discriminated union `{ ok: true, data } | { ok: false, message }`.

---

## 9. Feature modules (`src/features/`)

`registration/` · `enrollment/` · `submission/` · `challenge/` · `dashboard/` · `profile/` · `quiz/` · `user/` · `synergy/` · `certificate/` · `marketplace/` · `jobs/` · `recruiter/` · `hackathon/` · `workshop/` · `program/` · `hire/` · `talent-pool/` · `email/` · `admin/`

Notes:
- `program/` is the largest module (missions, verify-mission, days, progression, commits, mentor, recommendations, projects, interview, leaderboard, entry, admin, bootstrap-start-day, parse-brief, constants)
- `certificate/` owns ID generation, eligibility/issue, PDF render, template source, achievements
- `workshop/` has admin data, analytics, prefill, recent registrations, registration status. `getWorkshopConfig` is **not** here — it stays in `lib/workshop-supabase.ts`.
- `recruiter/` holds the `@react-pdf/renderer` document (`recruiter-pdf.tsx`) — keep it out of client/edge bundles
- `hire/` is the Scout agent and the matching pipeline: `scout-graph` / `scout-tools` / `scout-agent` (LangGraph), `track-registry` + `track-loaders` (which pools exist and how to read them), `dossier` / `challenge-dossier` / `hackathon-dossier`, `score-candidate`, `pool-brief`, `sample-card`. It is **server-only** — a test asserts no client module imports the agent, its tools or the graph.

### Repository layer (`src/repositories/`) — canonical read/write boundary

UI / Server Actions reach candidate, learning, progress, talent, points, and
credential data **only** through this layer.

```
UI / Server Actions  →  repositories  →  canonical tables
```

| File | Concern |
|---|---|
| `candidate.ts` / `candidate-identity.ts` / `candidate-detail.ts` | profile, identity, referral |
| `learning.ts` | `listChallengeEnrollments`, `findActiveMembership`, slug helpers |
| `progress.ts` / `progress-writes.ts` | dashboard progress, submissions, quizzes, mission progress |
| `enrollment-state.ts` | challenge `ProgramEnrollment` (`pe_enr_*`) current-state |
| `program-state.ts` | AI-cohort `ProgramEnrollment` (`pe_pm_*`) membership / score / unlock |
| `talent.ts` | `searchableUserWhere` (the **only** visibility fragment) |
| `hire.ts` | recruiter desk loaders over `ProgramEnrollment` + `CandidateProfile` |
| `points.ts` | `getBalance`, `applyPointsChange` |
| `credentials.ts` / `credentials-write.ts` | public verify + issue |
| `ambassador.ts` | `CampusAmbassadorApplication` |
| `ids.ts` | stable `pe_enr_*` / `pe_pm_*` / `aa_*` id derivation |
| `types.ts` | return-type contract |

Rules:

- **Return types are the contract.** Callers must not depend on dropped models.
- **New application code must not add Prisma delegates for dropped tables.**
  There is no `prisma.studentProfile` / `prisma.programMember` / `prisma.enrollment`.
- `dual-write.ts` and `legacy/` adapters are **deleted**. `drift.ts` compares
  canonical live rows against `Historical*` archives only.

---

## 10. Content management

- Challenge content: `prisma/content/problems.json`, `prisma/content/quizzes.json`, seeded via `npm run db:seed`
- Upserts on (challengeId, dayNumber) / (challengeId, weekNumber); quiz questions clean-replaced each reseed
- Program content seeded separately (`npm run db:seed:program`) — reseed after any mission-spec change
- Marketplace catalog from `marketplace.json` (`npm run db:seed:marketplace`)
- Days/weeks not in JSON render as "Day X placeholder"
- NO admin UI for challenge content editing (program content has a read view at `/admin/program/content`)

---

## 11. Seed scripts

```
npm run db:seed                    # challenge content + 10 test users (@abtalks.dev)
npm run db:seed:content            # content only
npm run db:seed:test-users         # test logins only
npm run db:seed:claude-test        # CLAUDE test users (incl. one deterministic 60/60 completed login)
npm run db:seed:program            # program cohort content / missions
npm run db:seed:program:users      # prog.*@abtalks.dev / "test" + test cohort, members, recruiters
npm run db:seed:marketplace        # marketplace catalog
npm run db:seed:hackathon-links    # named share links
npm run db:bootstrap:program-start-day   # waive Days 1–3 for existing ENROLLED/COMPLETED members
npm run db:backfill:certificates   # issue certs for already-eligible enrollments
```

Base test users (password `test`): Arjun (SE D1), Priya (DS D1), Rohan (AI D1), Sneha (SE D7 + quiz), Vikram (DS D15), Anika (SE D30), Karan (AI D45 broken streak), Meera (SE D60 COMPLETED + ready), Dhruv (SE D20 + 3 referrals), `admin@abtalks.dev` (ADMIN, password `admin`).

`SEED_ALLOW_PRODUCTION` guards seeds against a production database.

---

## 12. Cleanup & remaining scripts

- `npm run db:cleanup:test | :real | :all` — delete test users / real Google users / everything (5s pause; cascades handle related rows)
- `npm run hackathon:preflight | hackathon:migrate | hackathon:verify` — the Supabase → Neon hackathon cutover (`scripts/migrate-hackathon-to-neon.ts`). Already executed; kept for reference.
- `scripts/merge-problems.mjs`, `scripts/seed-swarit-recruiter-profile.ts`
- `npx tsx prisma/scripts/probe-canonical-post-drop.ts` — post-drop production probe
- `npx tsx prisma/scripts/verify-canonical-dropped-schema.ts` — confirms original tables are absent

Plan 078 migration npm scripts (`db:migrate:078:*`, `db:check:078:*`, drift cron)
and the matching `prisma/scripts/*078*` files are **deleted**. Do not reintroduce
them.

---

## 13. Environment variables

### Core
- `DATABASE_URL` — Neon pooled connection
- `DIRECT_URL` — Neon direct connection (migrations; added to fix deploy lock timeouts)
- `AUTH_SECRET` — random hex, no fallback
- `AUTH_URL` / `NEXTAUTH_URL` — site URL (optional locally when `trustHost` is on)
- `NEXT_PUBLIC_APP_URL` — same as AUTH_URL
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- `ADMIN_EMAILS` — comma-separated admin emails

### Feature flags
- `ENABLE_DEV_AUTH` — Credentials provider, localhost only
- `ENABLE_CLAUDE_CHALLENGE` — Claude track visibility
- `ENABLE_DATABRICKS` / `ENABLE_DS_ARCHITECT` / similar product flags — cohort surfaces (`notFound()` when unset)
- `HIRE_OPEN_COHORT_IDS` — cohorts `/hire` may match before results are published; comma-separated ids or `all`. Unset = published cohorts only.
- `HIRE_CHALLENGE_POOL` — whether `/hire` also searches the 60-day challenge track, and from how many verified days (`=10`, or `=true` for the default floor of 10). Unset = off.
- `GROQ_API_KEY`, `GROQ_API_KEY_2`, `GROQ_API_KEY_3` — Scout's model calls; `askGroqJson` falls through to the next key on 429/401. `HIRE_GROQ_MODEL` overrides the model.
- `ENABLE_CHATBOT` — site help chatbot (`/api/chat` + `ChatWidget` in the root layout)
- `BYPASS_DAY_LOCKS` — bypass challenge/program day gating server-side (dev)
- `OTP_DEV_BYPASS`, `OTP_DEV_CODE` — skip MSG91, accept a fixed code (default `1234`)
- `SEED_ALLOW_PRODUCTION` — required to run seeds against prod

`isProgramEnabled()` in `lib/feature-flags.ts` currently **always returns true**.
`ENABLE_PROGRAM` is no longer a runtime gate.

### Plan 078 migration flags — retired

`ENABLE_DUAL_WRITE`, `ENABLE_NEW_*`, and `ENABLE_LEGACY_*_MIRROR` are **gone**
from runtime (`lib/feature-flags.ts` and Vercel). Canonical family paths are
unconditional. Search-QA scripts may still *label* a report field
`newTalentRead: true`; that is not a runtime switch.

`DIRECT_URL` must still be set to the same Neon database on a **non-pooler** host
because `writeClient()` always uses the direct session.

### Operator-shell variables (never set these in Vercel)

- `PRODUCTION_NEON_HOST_ID` — host guard so a script cannot run against the wrong branch

Phase 2 operator vars (`PHASE2_ALLOW_PRODUCTION`, `PHASE2_BATCH_SIZE`,
`CONFIRM_PRODUCTION_DDL=078-phase1`, …) are **retired** with the 078 scripts.

### Integrations
- `ANTHROPIC_API_KEY` (+ optional `PROGRAM_ANTHROPIC_MODEL`, default `claude-sonnet-5`) — server-only Claude JSON grading via `lib/anthropic.ts`
- `OPENAI_API_KEY` — Realtime `client_secrets` minting for the exit voice interview (server-only)
- `GITHUB_API_TOKEN` — GitHub REST for SHIP_IT verification + the commit cron
- `CRON_SECRET` — Bearer auth on `/api/cron/program-commits`
- `RESEND_API_KEY`, `BREVO_API_KEY`, `FROM_EMAIL`, `FROM_NAME` — transactional email
- `MSG91_AUTH_KEY`, `NEXT_PUBLIC_MSG91_WIDGET_ID`, `NEXT_PUBLIC_MSG91_TOKEN_AUTH` — phone OTP
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — `workshop_config` + cohort applications
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; was required for the Supabase hackathon tables (now retired)
- `CERTIFICATE_TEMPLATE_URL` / `CERTIFICATE_TEMPLATE_PATH` — optional overrides for the certificate template
- `HACKATHON_CERTIFICATE_TEMPLATE_URL` / `_PATH` — per-type hackathon certificate templates
- `GEMINI_API_KEY` — optional generation backend for the help chatbot

---

## 14. Conventions

### Code style
- TypeScript strict, no `any`
- Server Components by default; `"use client"` only when needed
- Server Actions for mutations (preferred over API routes)
- Zod validation at every boundary
- Prisma queries always use `select`; multi-step writes in transactions
- Errors via `lib/logger.ts`, never `console.error`
- Result envelope `{ ok: true, data } | { ok: false, message }` everywhere

### Routing
- Auth routes are public (no `requireRole`)
- Everything else uses `requireRole([...])` / `requireAdmin()` / `requireProgramMember()` / `requireRecruiter()`
- Logout is idempotent (fail-closed silent)

### Files
- `src/features/<domain>/` — business logic
- `src/lib/` — shared utilities (db, auth, logger, validations, date-utils, feature-flags)
- `src/app/actions/` — Server Actions
- `src/components/ui/` — shadcn primitives (don't modify)
- `src/components/<feature>/` — feature components

### Changelog discipline
Cursor appends ONE dated line to `docs/CHANGELOG.md` under `## Pending reconcile` after any schema change, new/changed business rule, new env var, or new convention — never for cosmetic changes or bug fixes. Those lines are folded into **this** document during a reconcile pass. Cursor never edits `CLAUDE.md` or `docs/project-context.md`.

---

## 15. Design system

### Typography
- Display: Plus Jakarta Sans (`font-display`) for headings; Body: Inter
- `dseg7-classic` for seven-segment countdown displays

### Current design language
New UI follows **`docs/design-system.md`** (plan 071 — orange / cream). The
modernist and pre-modernist templates are **retired as templates**; existing
screens were not restyled. `/program/dashboard` and `/program/day` were rebuilt on
the cream/orange system (`/program` app shell is light, Curriculum nav hidden but
the route kept). The student hub (`/dashboard`) carries its own Jakarta/Fredoka
tokens.

### Colors (CSS vars in `globals.css`) — legacy screens
- Light: warm off-white background, pure white cards. Dark: deep blue-gray.
- Primary: indigo `239 84% 67%` (#4F46E5)
- Domain colors — AI violet `#8B5CF6`, DS cyan `#0891B2`, SE emerald `#10B981`

### UX patterns
- Cards: `rounded-xl`, soft border, subtle shadow, `hover:shadow-md`
- Buttons: NEVER `<Button asChild>` or `<Button render={<Link>}>` — use `buttonVariants` directly on the `<Link>` (Base UI is strict about button semantics)
- Theme toggle: single sun/moon button, system default; optional click sound (off by default)
- Mobile-first (390px tested)
- Program day pages use a distinct **Figma dark shell** with a `briefMd` section parser — deliberately not the challenge theme

---

## 16. Known issues / decisions parked

### Resolved (don't touch)
- Edge Runtime middleware must avoid `@/lib/*` imports → split `auth.config.ts`
- Auth.js v5 default cookie name change → `auth()` middleware pattern
- Stale Prisma client after `node_modules` delete → `npx prisma generate`
- Postgres enum rename ML → DS via `ALTER TYPE RENAME VALUE`
- FK violation when User deleted but session still valid → clear cookies
- `<Button render={<Link>}>` Base UI nativeButton warning → `buttonVariants`
- Deploy lock timeouts on migrate → added `DIRECT_URL`
- Day 60 not submittable → use uncapped `getElapsedDayNumber` for backfill/relaxation
- Chicago reformat dropping commit day 0 → UTC calendar-key math
- Dead login form over LAN IP → `allowedDevOrigins` includes LAN IPv4s
- Neon pooled endpoint dropping Prisma interactive transactions with `SAVEPOINT` → writes and migrations use the **direct** (non-pooler) host via `writeClient()`
- 078 Phase 2 migrations timing out at ~4.5h → batched `INSERT … ON CONFLICT` + `createMany` + bounded batches, not per-row upserts
- 078 dual-write / flag control plane / original operational tables — **closed 2026-09-23**

### Open issues after 078 closure
- **`SkillEvidence` has no live writer.** `CandidateSkill.evidenceScore` / `.verified` are frozen at backfill time. P0-0 in plan 112.
- **Legal copy still says recruiter discoverability is opt-in**, while the product decision made it a platform default. Deferred business/legal task.
- The repo still carries a leftover migration folder `20260813000000_general_interview` (from the reverted PR #168 AI-cohort interview foundation). Do not apply or drop that schema. Production `_prisma_migrations` already records later 078 migrations including `20260923120000_final_drop_legacy_originals`.

### Cleanup candidates spotted during this reconcile
- `src/lib/hackathon-supabase.ts` has **no importers** — dead since the Neon cutover; the same is true of `SUPABASE_SERVICE_ROLE_KEY`'s only documented purpose
- `PhoneVerification` OTP fields are live; the OTP surface is skipped in dev
- `ProgramEntryQuestion` / `ProgramEntryAttempt` and the skip-token machinery remain in the schema while bypassed in product

### Deferred / not built
- **External candidate-platform abstraction** — LeetCode / CodeChef / Codeforces / Kaggle and similar. No model exists. Expected to be **additive** later.
- **Opportunity-type preferences** — internship / full-time / freelance / contract / part-time. `CandidatePreference` today has `openToWork`, `availableFrom`, preferred roles/locations and remote preference only. Also additive later. `openToWork` stays **independent** of recruiter discoverability.
- Resume **upload** (binary, Vercel Blob) — only the URL field exists
- Admin UI for challenge content CRUD
- Plagiarism detection beyond global URL uniqueness
- Rate limiting on auth/submission endpoints
- Email verification (Google handles OAuth users)
- Heatmap cells clickable to view a past day's problem
- Logo scroll animation (ABTalks → AB collapse)

### Security TODOs
- No rate limiting on auth or submission endpoints
- No email verification for any flow
- No password policy beyond min 8 chars
- No CSRF tokens beyond Next.js defaults
- No content security policy headers
- No automated session invalidation on user deletion

---

## 17. Working with Cursor — guardrails

### Before any DB-touching change
1. `git add -A && git commit -m "checkpoint before X"`
2. Create a Neon branch as a snapshot
3. Note the commit hash

**All Neon mutations must target a production child branch** unless that exact
production write is explicitly authorized. Interactive transactions must use the
**direct (non-pooler)** endpoint via `writeClient()` — see §3.

### Cursor failure modes observed
- Adds `requireRole` to public routes (logout, login) — mark exceptions explicitly
- Confuses Server vs Client boundaries when passing props (Lucide icons, functions)
- Defends wrong choices when build errors contradict its model (jose subpath import)
- Over-engineers (new files for trivial logic)
- Misses transitive imports causing Edge bundle violations
- Sometimes silently fails to apply file changes

### Working pattern
Small scoped prompts → explicit "do NOT" lists → Cursor reports back → you verify → manually test → commit per task. On breakage, gather data (logs, file contents, exact error) before fixing.

---

## 18. Current state

### Live and working
- Auth (Google OAuth + dev credentials), registration (profile-only; STUDENT / PROFESSIONAL / CLAUDE-forced)
- 60-Day Challenge: day pages, submissions with optional proofs, streaks, leaderboard, heatmap, quizzes, profile, referrals, Synergy points
- **Student dashboard hub** at `/dashboard` (`DashboardShell` + `getHubData`) with campus-ambassador banner, hackathon promo modal and hackathon/program redirects
- Certificates: issue, achievements page, public verification + PDF download; hackathon participation and placement certificates (`Credential`)
- Marketplace (SP redemption) and Jobs board
- Hackathon: landing, solo/team registration, dashboard, submissions, share-link attribution, member removal
- Workshops: microsite, session-gated registration on Neon, admin rosters + analytics
- AI Cohort applications (US + India) on Supabase, admin viewer
- Program (`/program`): apply, Mission Control, day pages, missions, commits cron, AI grading/mentor/recommendations, exit voice interview, leaderboard
- Recruiter surfaces: `/hire` Scout desk, `/talent/*` retained routes, `/r/[token]` assessment reports + PDF
- Legal surface: `/terms`, `/privacy`, `/privacy/requests`, `/cookies`, `/contact`, consent logging, cookie chooser, DSAR queue
- Notification bell + `/admin/notifications`
- Admin: 20+ pages spanning students, submissions, content, analytics, actions feed, referrals, redemptions, jobs, workshop, hackathon, ai-cohort, program, notifications, data-requests
- **Canonical data model in production.** Original operational tables dropped 2026-09-23 (`20260923120000_final_drop_legacy_originals`).
- Production deployment on Vercel (`www.abtalks.in`)

### Plan 078 — COMPLETE (2026-09-23)

| Phase | Status |
|---|---|
| **Phase 1** — additive schema | Done |
| **Phase 2** — historical backfill | Done (later waves completed what 2e originally left open) |
| **Phase 3** — repository layer | Done (`src/repositories/`, §9) |
| **Phase 4** — dual-write | Done, then **retired** |
| **Phase 5** — verification | Done |
| **Phase 6** — switch reads | Done (flags then retired; paths are unconditional) |
| **Phase 7** — stop writing legacy | Done (family write-authority waves W1–W8) |
| **Phase 8** — drop legacy schema | Done. Production dropped `StudentProfile`, `Enrollment`, `ProgramMember`, `Certificate`, `Submission`, `QuizAttempt`, `ProgramMissionSubmission`, `SynergyEvent`, and `User.synergyPoints`. Archives retained. |

Closure commit `f261b33d` (tooling retirement) on top of `26e9b1f7` (model-free app). Production host `ep-nameless-term-ams9a5e3` / branch `br-soft-bread-amu5tms1`. Rollback snapshots exist; they are not live migration beds.

### Recruiter product direction

There is **no meaningful recruiter user population** that needed the old
recruiter-account compatibility, which is what made it safe to replace the
recruiter surface outright rather than migrate it.

**The recruiter experience is `/hire`.** What it is:

- **Scout** — a LangGraph agent (`StateGraph` + `ToolNode` + `ChatGroq`,
  `openai/gpt-oss-120b`, `reasoning_effort: medium`) over a track registry. The
  model *proposes*; the engine validates and acts, so a tool call can never widen
  the pool by itself. Eight tools — `list_tracks`, `get_pool_stats`,
  `update_brief`, `set_pool_filters`, `preview_matches`, `reset_brief`,
  `offer_options`, `search_pool` — each returning `{applied, rejected}`.
  Protected attributes are refused at a hard gate before the model is reached.
- **The desk** — a two-view surface (Scout / Shortlist), a candidate inspector,
  an evidence resume, and Save-for-later as a device-local list that is
  deliberately *not* the Shortlist. Nothing on Save-for-later has been shown to
  the team; moving a candidate to the Shortlist is the act that puts them in
  front of anyone.
- **Engagements** — see `TalentEngagementRequest` above. Contact release is per
  recruiter/candidate pair and derived from status.
- **Empty searches** return sample cards built from the recruiter's own spec.
  `SAMPLE:` refs stay off the track whitelist, so a sample can never be
  shortlisted or introduced.

`/hire` loads dossiers through `features/hire/track-loaders.ts` →
`repositories/hire.ts` over `CandidateProfile` + `CandidateVisibility` +
`ProgramEnrollment` (`pe_pm_*` / `pe_enr_*`) + hackathon tables. Pool width is
still bounded by `HIRE_OPEN_COHORT_IDS` and `HIRE_CHALLENGE_POOL`.
`ENABLE_NEW_TALENT` is **not** a runtime flag.

### Not yet built
- Full real Day 1–60 content for SE / DS / AI (placeholders remain where JSON is missing)
- Live `SkillEvidence` writer (P0-0, plan 112)
- External coding-profile models (LeetCode / CodeChef / Codeforces / Kaggle) and opportunity-type preferences — both additive, later

### Next priorities
1. Live `SkillEvidence` writer so `CandidateSkill.evidenceScore` / `.verified` are not frozen at backfill.
2. Reconcile Privacy/Terms copy with platform-default recruiter discoverability.
3. Continue product work on canonical tables (Databricks / interview-agent / hire). Do not reintroduce dual-write or original operational tables.

---

## 19. How to use this document in new chats

Paste this entire document at the start of a new chat with:

> "I'm working on a project called ABTalks. Read this context document carefully before we start. After reading, just say 'Context loaded' and ask me what I want to work on."

---

## 20. Document maintenance

Update this document when:
- A major feature ships
- A core decision changes (tech stack, business rule, scope)
- Schema changes
- New env vars added
- New conventions adopted

Don't update for tiny bug fixes, cosmetic changes, or routine commits.

**Reconcile pass:** read `docs/CHANGELOG.md` → `## Pending reconcile`, fold every line into the right section here, then clear that list and note the reconciled-through date at the top of this file. The doc should reflect architecture and decisions, not every line of code.

Two things to check each pass:
- **Entries can end up outside the heading.** Merges have pushed Cursor's lines above `## Pending reconcile`. Read the whole file, not just the section.
- **Verify claims against the code.** The changelog is a claim, not proof — the 2026-08-24 pass found `PROGRAM_TZ` had moved to `Asia/Kolkata` while both this document and `CLAUDE.md` still asserted America/Chicago.

**After Plan 078 closed:** describe the canonical model as serving reads and writes. Original operational tables are dropped. Unique history is `Historical*` only. Do not reintroduce dual-write, `ENABLE_NEW_*`, or `prisma.studentProfile` / `prisma.programMember` (see §4 and §18).
