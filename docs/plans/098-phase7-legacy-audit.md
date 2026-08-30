# 098 — Phase 7 leftover legacy READ/WRITE audit

## 1. Goal

Inventory every remaining legacy READ and WRITE after Phase 6 is complete, so
Phase 7 can be planned without guessing. This file is an audit, not a start
order. **Do not implement Phase 7 from this document.**

Phase 6 (complete 2026-08-27) switched reads behind flags. Dual-write still
mirrors **into** new tables from legacy mutations. Stopping legacy writes
without new writers freezes anything still reading denormalized legacy
columns.

## 2. Current behavior

Production flags (do not change here):

- `ENABLE_DUAL_WRITE=true`
- `ENABLE_NEW_CREDENTIAL=true`
- `ENABLE_NEW_POINTS=true`
- `ENABLE_NEW_CANDIDATE=true`
- `ENABLE_NEW_LEARNING=true`
- `ENABLE_NEW_PROGRESS=true`
- `ENABLE_NEW_TALENT=true`

Dual-write helpers write **new** rows only. They do not replace legacy writes.

## 3. Highest stale-if-writes-stop risks

These fields are **continuously mutated** on the live product and still **read**
by a surface that is not fully on 078. If legacy writes stop, they freeze.

1. **`Enrollment.currentStreak` / `longestStreak` / `daysCompleted` /
   `lastSubmittedDay`** — written on submit/admin. Progress flag still **reads
   the streak snapshot from Enrollment**. Admin CSV/analytics always use
   `daysCompleted`.
2. **`ProgramMember.missionPoints` / `totalScore` / `skills` / projects /
   interview / commitDays** — written by program missions/commits/projects.
   `dualWriteProgramMember` copies PE status/unlock/skip only. `/hire` and
   `/talent` still score and rank on these columns even with TALENT on.
3. **`User.synergyPoints`** — still the write + redeem guard. `PointsAccount`
   is the display mirror.
4. **`Certificate`** — still the issue source; `Credential` is the display
   mirror. Hire challenge rows still join `enrollment.certificate`.
5. **`Submission` / `QuizAttempt` / `ProgramMissionSubmission`** — still the
   write source. Admin feeds and `/talent` mission portfolio read them
   directly, not through the progress repo.
6. **`ProgramMember.recruiterVisibilityConsentAt`** — student toggle in
   `setRecruiterVisibilityAction` writes only this column. Live discovery is
   `CandidateVisibility`. The toggle cannot turn search off.
7. **`StudentProfile.domain` and ambassador fields** — dashboard/admin still
   SP-native.

## 4. Legacy READS by domain

### Identity

| Table / field | Who still reads | Flag? |
|---|---|---|
| `StudentProfile` existence / domain | register, login, program apply, dashboard, public profile | domain **always** |
| `StudentProfile` ambassador | campus-ambassador actions, admin ambassadors | always |
| `StudentProfile.fullName` joins | admin feeds, referrals, jobs, `/hire/requests` | always |
| Referral uniqueness | `generate-referral-code.ts` checks SP **and** CP | always both |
| Referral resolve | `findUserIdByReferralCode` | `ENABLE_NEW_CANDIDATE` |

### Learning

| Table / field | Who still reads | Flag? |
|---|---|---|
| `Enrollment` overlay (streaks/start) | `listChallengeEnrollments` | LEARNING on still overlays Enrollment |
| `Challenge.id` | `getChallengeByDomain` | still needed as id map |
| `ProgramMember` membership/unlock/JSON | most `/program` UI (`dashboard.ts`, `days.ts`, `missions.ts`, leaderboard, interview, commits, projects) | **always** (not behind TALENT) |
| `ProgramDay` catalog | hire `listCurriculumDays`, talent portfolio, program missions | hire/talent **always** |

### Progress

| Table / field | Who still reads | Flag? |
|---|---|---|
| `Enrollment` streak snapshot | `getChallengeProgressStats` | **always**, even with PROGRESS on |
| `Enrollment.daysCompleted` | admin students/CSV/analytics/dropoff | **always** |
| `Submission` | admin feeds; app heatmap via progress repo | admin always; app `ENABLE_NEW_PROGRESS` |
| `QuizAttempt` | admin student detail; app via progress repo | same split |
| `ProgramMissionSubmission` | `missions.ts`, `commits.ts`, `pool.buildMissionPortfolio` | **always** for program UI + talent portfolio |

### Points / credentials

| Table / field | Who still reads | Flag? |
|---|---|---|
| `User.synergyPoints` | `getBalance` when POINTS off; redeem **guard always** | display flagged |
| `Certificate` | issue paths; hire challenge `certificate` relation | display flagged; hire **always** |

### Talent / hire (ENABLE_NEW_TALENT=true leftovers)

Identity overlay is new tables. **Evidence is still legacy:**

- Program scores/skills/projects/interview/commits → `ProgramMember`
- Challenge streaks + certificate → `Enrollment`
- Curriculum languages/types → `ProgramDay`
- `/talent` mission portfolio → `ProgramMissionSubmission` (not progress repo)
- Hackathon pool membership → `HackathonParticipant`
- Scout stack match is in-memory on skill **names**, not `SkillEvidence`
- `repositories/talent.searchCandidates` is unused by `/hire`

### Admin (always legacy)

Student list/CSV, analytics, dropoff, missing-by-day, overview, submissions
feed, referrals report, campus ambassadors, program admin export.

## 5. Legacy WRITES that still run

Pattern: **mutate legacy → optionally `dualWrite*`**.

| Write | Dual-write covers | What freezes if write stops |
|---|---|---|
| `StudentProfile.create/update` | identity DW (partial fields) | CP unless every path DW’d; ambassador/admin SP-only |
| `Enrollment.create` | `dualWriteChallengeEnrollment` | PE missing |
| `Enrollment.update` denorm (days/streaks/status) | status/dates only, **not** a streak substitute | streaks + admin counters |
| `Submission` CRUD | `dualWriteSubmissionAttempt` | attempts + heatmap if DW also stopped |
| `QuizAttempt.create` | `dualWriteQuizAttempt` | quiz evidence |
| `ProgramMember` scores/skills/consent/unlock | PE status/unlock/skip **only** | **hire/talent scores CRITICAL** |
| `ProgramMissionSubmission` | `dualWriteMissionAttempt` | talent portfolio (legacy-only read) |
| `User.synergyPoints` ± SP mirror | `dualWritePoints` | redeem guard; display OK if account kept |
| `Certificate.create` | `dualWriteCredential` | hire certificate join; achievements OK if Credential written another way |
| `ProgramMember.recruiterVisibilityConsentAt` | **none** on the toggle action | misleading vs live `CandidateVisibility` gate |

## 6. Guardrails for a future Phase 7 plan (DO NOT do now)

- Do not stop legacy writes in this audit.
- Do not drop tables.
- Do not set `ENABLE_DUAL_WRITE` false.
- Do not treat TALENT as a reason to stop `ProgramMember` score writes — the
  desk still reads them.
- A Phase 7 plan must give each denormalized field a new writer **or** move
  its readers first.
- The student visibility toggle must write `CandidateVisibility` (including
  withdraw) before the consent column can be retired.

## 7. DB safety

None. Audit only.

## 8. Verification

Not a code change. Confirm against `src/` if a later plan cites this file —
this is a claim, not a proof, until re-checked at plan time.

## 9. Commit message

N/A until a Phase 7 plan is requested.
