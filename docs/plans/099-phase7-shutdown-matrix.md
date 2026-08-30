# 099 — Phase 7 shutdown matrix (planning only)

## 1. Goal

Build the dependency graph for every remaining legacy table/field after Phase
6, and pick the safest first **write-family** cutover. Do not stop any legacy
writes, do not disable `ENABLE_DUAL_WRITE`, and do not drop tables.

Source inventory: `docs/plans/098-phase7-legacy-audit.md` (re-checked against
`src/` on 2026-08-27). This plan is the matrix + order. Implementation of each
slice is a later numbered plan.

## 2. Current behavior

All `ENABLE_NEW_*` flags are ON. Dual-write stays ON. Pattern is still
**mutate legacy → `dualWrite*` into 078**. New tables are read-mirrors, not
writers, except where noted.

Phase 6 TALENT overlay covers identity + visibility for `/hire` and `/talent`.
Evidence (scores, skills fallback, projects, interview, commits, mission
portfolio, challenge streaks, certificates) is still legacy.

## 3. Files to touch

This planning pass:

- `docs/plans/099-phase7-shutdown-matrix.md` [new] — this file
- `docs/CHANGELOG.md` [edit] — one convention line under Pending reconcile

Do not change `src/`, flags, or Neon in this pass.

Later slice (not this plan): `100-phase7-points-sot-invert.md` will own the
Points read/guard invert listed as W1 precursor.

## 4. Server vs Client

N/A. Planning only.

## 5. Domain classification (do not copy into CandidateProfile)

`StudentProfile.domain` is the student's **challenge-track picker**
(SE / DS / AI / CLAUDE). It is used to:

- choose which Enrollment the dashboard / public-profile heatmap shows
- badge admin student lists
- persist “which track I signed up for” at registration

It is **not** job family, persona, or location. `CandidateProfile.primaryPersona`
is STUDENT vs PROFESSIONAL. Track membership in 078 is `Enrollment.domain` /
`ProgramEnrollment` → cohort → `LearningProgram`.

Do **not** copy `domain` onto `CandidateProfile`. Multi-track users would get
one frozen value. Replacement when SP.domain is retired: resolve the displayed
track from enrollments (active matching `StudentProfile.domain` today; then
active; then latest). Keep `Enrollment.domain` as the track source of truth.

## 6. Shutdown matrix

Parity = “new table already holds the same live value while dual-write runs.”
A yes does not mean legacy writes can stop.

Rollback for every family: keep dual-write ON; redeploy the previous writer.
Never rely on turning `ENABLE_DUAL_WRITE` off as rollback.

### 6.1 Points

| Col | `User.synergyPoints` | `StudentProfile.synergyPoints` | `SynergyEvent` |
|---|---|---|---|
| Live READ | Redeem **guard** (`redeem-item.ts` `updateMany` `gte`); `getBalance` only if POINTS off (prod ON); `dualWritePoints` copies this into `PointsAccount.balance`; admin debit reads it (`admin-actions.ts`) | Admin debit mirror (`admin-actions.ts`); not used for display | Admin reset sums SUBMISSION events (`admin-actions.ts`); grant lookup `findUnique`; drift counts |
| Live WRITE | Award submit/referral; redeem debit; admin grant/debit/reset/refund; registration touch (`increment: 0`) | Same award/redeem/admin paths (rollback mirror) | Award, redeem, admin grant/refund/reset |
| New SoT | `PointsAccount.balance` (+ `lifetimeEarned` / `lifetimeSpent`) | none — drop with User wallet | `PointsTransaction` |
| Parity | Yes for display (`getBalance` → account). Guard is still User | Mirror of User | Dual-written with each award; reset path still aggregates events |
| Before write stop | 1. Atomic debit/credit on `PointsAccount.balance` (redeem + admin). 2. Invert `dualWritePoints`: account += `event.amount`, do not copy User. 3. Admin reset debit from account + `PointsTransaction`, not `SynergyEvent._sum`. 4. Prove no live reader of User/SP synergy except the compatibility mirror | Same as User | Keep writing events until W1 observe window; then stop event creates once reset/grant use `PointsTransaction` |
| Recon | `check-078-phase5` `pointsAccountVsUserSynergy` = 0; `pointsLedgerVsAccount` = 0; drift `points` | same (SP vs User already clamped ≥ 0) | Count `SynergyEvent` vs `PointsTransaction` per user after invert |
| Rollback | Redeploy User-first writer; User still written during invert | same | Re-enable event creates |
| Order | **W1** (first write-family) | W1 same slice | W1b (after User/SP stop, same family) |

Display already uses `getMySynergy` → `getBalance` → `PointsAccount`. Marketplace
page does not read `User.synergyPoints`. The dual-write test currently **asserts**
the legacy `gte` guard — that assertion must flip in the invert slice, not here.

### 6.2 Candidate / StudentProfile

| Col | Existence gate | Identity scalars (name, phone, links, userType, edu/exp, skills[], resume, interview-ready) | `domain` | Referral code | Ambassador flags | Admin list/CSV `fullName` joins |
|---|---|---|---|---|---|---|
| Live READ | register, login, program apply, claude-signup, `complete-registration`, `get-profile` (null profile if no SP), landing | Flag ON: `getCandidateProfile` reads CP. Flag-off fallback: SP. Dual-write still sourced from SP | **Always** dashboard, public profile heatmap picker, admin badges | Uniqueness: SP **and** CP. Resolve: CP when CANDIDATE on | `campus-ambassador-actions`, admin `/admin/campus-ambassadors` | `get-students.ts`, export, referrals, `/hire/requests`, jobs |
| Live WRITE | `complete-registration` create; workshop/OTP may create | Profile update, registration, OTP phone, workshop, program apply copies into PM | Registration / enroll track pick | `generateUniqueReferralCode` writes both via DW | apply/dismiss ambassador | admin remark (identity via SP) |
| New SoT | `CandidateProfile` row existence | `CandidateProfile` + `CandidateEducation` / `Experience` / `Skill` | **Enrollment.domain** (not CP) | `CandidateProfile.referralCode` | none yet — needs a CP child or stay SP until a dedicated table | `CandidateProfile.fullName` |
| Parity | Interval recon `missingCandidateProfile` | Identity DW yes (partial submitted fields). Skills: CP children can be empty while SP/PM JSON still has names | No — not in CP by design | Yes when DW runs | No | Admin still SP |
| Before write stop | Gates must `getCandidateProfile` / `candidateProfile.findUnique` | Admin search/CSV/joins on CP; `updateStudentFields` must write CP first then mirror SP; backfill empty `CandidateSkill` from SP **or** PM JSON (24 searchable members) | Replace SP.domain readers with enrollment resolver (section 5) | Uniqueness on CP only | New field or keep SP as the ambassador home (call that out; do not invent a CP column in this plan) | `get-students` + export + referrals join CP |
| Recon | `interval.missingCandidateProfile` = 0 | CP vs SP identity diff = 0; searchable members with PM.skills and zero `CandidateSkill` = 0 | Every SP.domain has a matching Enrollment.domain or documented exception | SP.referralCode = CP.referralCode | ambassador flags only on chosen home | Admin row count vs CP join |
| Rollback | Keep creating SP | Keep SP writes | Keep SP.domain | Keep dual unique check | Keep SP | Keep SP joins |
| Order | W4 after gates move | W4 | **Not W4** — retire after enrollment resolver; independent of identity SoT | W4 | W5 (SP-only leftover) or keep | W4 |

### 6.3 Enrollment / progress snapshot

| Col | `daysCompleted` / `lastSubmittedDay` | `currentStreak` / `longestStreak` | `status` / dates |
|---|---|---|---|
| Live READ | Student: derived from attempts when PROGRESS on (`getChallengeProgressStats`, `overlayChallengeProgressFields`). Admin students/CSV/analytics/dropoff: **always Enrollment**. Hire challenge dossiers: Enrollment streaks as commit-days evidence | **Always Enrollment**, even with PROGRESS on (explicit). Dual-write test asserts snapshot | Learning overlay; admin filters; certificate eligibility uses progress repo + Enrollment lookup |
| Live WRITE | `submit-day.ts` recompute; admin reset/reject | same | enroll/complete/admin |
| New SoT | `ActivityAttempt` + eval (days). Admin must switch before Enrollment denorm stop | **Compatibility cache required.** `EnrollmentProgress` exists but student progress deliberately does not read it. Options: (a) keep writing a snapshot onto `ProgramEnrollment` or a dedicated streak cache, with the **same submit-time formula** as today; (b) keep Enrollment as the cache until product agrees to live-recompute. Do **not** switch users to live-recomputed streaks | `ProgramEnrollment.status` (DW already copies status/dates, not streaks) |
| Parity | Student days: yes (attempts). Admin days: no (still Enrollment) | Snapshot yes only because Enrollment is still written | PE status yes |
| Before write stop | Admin + hire challenge read attempts or the new cache; document formula parity | Implement snapshot writer on the chosen 078 field **using the current submit-day formula**; point `getChallengeProgressStats` at it; keep Enrollment as mirror until observe | Confirm every status reader on PE |
| Recon | Admin `daysCompleted` vs attempt-derived = 0 | New cache vs `Enrollment.currentStreak`/`longestStreak` = 0 for all active enrollments | PE vs Enrollment status |
| Rollback | Keep Enrollment denorm writes | Keep Enrollment streak writes; do not delete the cache formula | Keep Enrollment.status writes |
| Order | W7 after W6 evidence readers (admin can stay on Enrollment one slice longer if student cache exists) | W7 **same family**, never live-recompute as a silent switch | W7 |

### 6.4 ProgramMember

| Col | `missionPoints` / `totalScore` / concept/commit/project points | `skills[]` JSON | `projects` / `ProgramProject` | Interview (`ProgramInterview` + member fields) | `highestUnlockedDay` / `skipTokensUsed` | `recruiterVisibilityConsentAt` |
|---|---|---|---|---|---|---|
| Live READ | `/program` dashboard, leaderboard, day unlock, missions, interview prompt; `/hire` + `/talent` scoring (`hire.ts` `listProgramCandidates`, `dossier.ts`, `pool.ts`); admin members | Hire/talent: CP skills if non-empty, **else PM JSON** (24 searchable members). Program apply copies profile skills onto PM | Hire dossier + program projects UI | Hire if `showInterviewResults`; program interview UI; admin export | Program day unlock (`missions.ts`, `dashboard.ts`, `progression.ts`); admin members | Student toggle **write only**. Live gate is `CandidateVisibility` via `searchableUserWhere()` |
| Live WRITE | `missions.ts`, `commits.ts`, `projects.ts`, interview scoring, admin | Apply snapshot (`entry.ts`); not DW’d to `CandidateSkill` | program projects | `interview.ts` | missions skip/unlock, bootstrap, admin | `setRecruiterVisibilityAction` (consent only — **cannot turn search off**); apply path sets timestamp; `dualWriteProgramMember` → `ensureProgramMemberDiscoverable` can turn search **on**, never off |
| New SoT | Derive from `ActivityAttempt`/`ActivityEvaluation` **or** a PE score cache written on the same events. DW today copies PE status/unlock/skip **only** | `CandidateSkill` | keep `ProgramProject` until a 078 project table exists, or attach to attempts | 078 interview artifact TBD; until then `ProgramInterview` stays | `ProgramEnrollment.unlockFloorDay` / `skipTokensUsed` (already DW’d) | `CandidateVisibility.searchableByRecruiters` + `withdrawnAt` |
| Parity | Scores: **no** new writer. Unlock/skip: yes on PE | Identity skills: yes when CP children exist; 24-member hole | No | No | Unlock/skip yes; program UI still reads PM | Discovery reads CV. Toggle writes consent ≠ CV |
| Before write stop | Dual-write scores into a PE cache **or** switch hire/talent/program UI to attempts; **zero** PM fallback on hire/talent; program leaderboard must match | Backfill 24; remove `idn?.skills.length ? idn.skills : r.skills` in `hire.ts` / `pool.ts`; stop apply from being the only skills home | Move hire dossier projects to the new home | Move hire interview evidence | Point program unlock at PE; then PM columns are mirrors | Toggle must upsert CV (on = searchable + withdrawnAt null; off = withdraw). Consent timestamp may remain a copy |
| Recon | Hire ranking vs PM.totalScore; leaderboard vs attempt sums | searchable ∩ PM.skills≠[] ∩ CandidateSkill count=0 → 0 | dossier project ids | interview scores vs PM | PE.unlockFloorDay vs PM.highestUnlockedDay | Toggle off ⇒ `withdrawnAt` set; on ⇒ searchable true and withdrawnAt null. V4b / visibilityLeak = 0 |
| Rollback | Keep PM score writes | Keep JSON fallback until backfill+code proven | Keep PM/projects | Keep ProgramInterview | Keep PM unlock writes | Keep writing consent; re-teach toggle to write CV first |
| Order | **W8 last** among talent evidence | W8 same family (backfill is a **pre-req**, can run while writes continue) | W8 | W8 | W8 after program UI reads PE | **W2** (small, isolated) |

### 6.5 Submission / QuizAttempt / ProgramMissionSubmission

| Col | `Submission` | `QuizAttempt` | `ProgramMissionSubmission` |
|---|---|---|---|
| Live READ | Student heatmap/dashboard: progress repo (attempts when PROGRESS on). Admin: `get-submissions-feed`, `get-student-detail`, analytics, dropoff, missing-by-day, overview. Hire flag ON: attempts. URL uniqueness `validate-github-url` | Admin student detail; app via progress repo; hire flag ON: attempts | **Always** `missions.ts`, `commits.ts`, `mentor.ts`, `interview.ts`, `pool.buildMissionPortfolio` (`/talent` evidence), program admin |
| Live WRITE | `submit-day.ts` then `dualWriteSubmissionAttempt` | `submit-quiz.ts` then DW | missions then `dualWriteMissionAttempt` |
| New SoT | `ActivityAttempt` + `ActivityEvaluation` | same | same |
| Parity | Student yes. Admin/talent portfolio **no** | Student yes. Admin no | Program UI + talent portfolio **no** |
| Before write stop | Admin feeds + GitHub uniqueness + hire challenge (already attempts when flag on) → progress repo. Talent portfolio → attempts | Admin detail → progress repo | Program missions/commits/mentor/interview + `pool.buildMissionPortfolio` → progress repo |
| Recon | Attempt count vs Submission per enrollment; admin feed ids | same for quizzes | Mission attempt vs ProgramMissionSubmission per member/day |
| Rollback | Keep legacy creates | same | same |
| Order | **W6** after those readers move; before W7 (denorm) and W8 (scores derived from same attempts) |

### 6.6 Credential

| Col | `Certificate` row + `certificateId` | Issue / duplicate / revoke |
|---|---|---|
| Live READ | `/verify` + PDF download: `getPublicCertificate` → `getByPublicId` (Credential when flag ON). Achievements list: `listForUser`. Hire challenge: **`enrollment.certificate` relation always**. `generateCertificateId` uniqueness: **Certificate table** | `ensureClaudeCertificate` / hackathon issue: `findUnique` on Certificate then `Certificate.create` then `dualWriteCredential` |
| Live WRITE | `issue-certificate.ts`, `issue-hackathon-certificate.ts` | same; revocation is Certificate status then DW |
| New SoT | `Credential.credentialId` (same public id string) | `Credential` as mint; uniqueness on `credentialId` **and** challenge enrollment uniqueness must be preserved (today `Certificate.enrollmentId`) |
| Parity | Display yes. Hire join no. Id allocator still Certificate | Writes are Certificate-first |
| Before write stop | `generateCertificateId` must check Credential (and Certificate during overlap). Hire challenge reads Credential. Mint `Credential` first with same `ABT-…` id, duplicate `findFirst` on Credential, lazy Claude + hackathon paths unchanged at the feature API (`ensureClaudeCertificate`). Map enrollment uniqueness onto Credential metadata or a unique source key | Revoke updates Credential status; dual-write may still copy Certificate until W3 stop |
| Recon | `credentialsMissing` = 0; every Certificate.certificateId has Credential.credentialId; verify URL + PDF for a known id; hire challenge cert presence vs Credential | Duplicate issue returns `alreadyIssued`; revoked row not shown as valid |
| Rollback | Keep Certificate.create; DW still fills Credential | same |
| Order | **W3** after hire join + id allocator move |

Preserve: public id format, `/verify`, PDF download, lazy Claude issue, hackathon issue, duplicate prevention, revocation semantics.

### 6.7 Recruiter visibility

| Col | `ProgramMember.recruiterVisibilityConsentAt` | `CandidateVisibility` |
|---|---|---|
| Live READ | Not the live `/hire` gate. Comment on the toggle still claims `memberEligibilityWhere` — stale | `searchableUserWhere()` |
| Live WRITE | Toggle + apply | DW `ensureProgramMemberDiscoverable` (on only); challenge DW does not flip a closed historical row |
| New SoT | compatibility copy only | `searchableByRecruiters` + `withdrawnAt` |
| Parity | Consent timestamp ≠ CV. Off-toggle does not withdraw | Discovery yes |
| Before write stop | `setRecruiterVisibilityAction` writes CV (off = withdraw). Then consent is optional mirror | already SoT for reads |
| Recon | After off: member absent from guest `/hire` search. visibilityLeak = 0 | same |
| Rollback | Restore toggle→consent if CV write bugs; live search would still be CV | Keep CV rows |
| Order | **W2** (after toggle writes CV; stop consent write only when no reader remains — comments/tests) |

### 6.8 Admin / operator leftover reads

Classification of remaining **direct** Prisma legacy reads under `src/app`,
`src/features`, `src/repositories` (not exhaustive line list; families):

**Must migrate before that family's writes stop**

- `features/marketplace/redeem-item.ts` — User synergy guard (W1)
- `app/actions/admin-actions.ts` / `admin-redemption-actions.ts` — User/SP synergy + SynergyEvent reset (W1)
- `repositories/dual-write.ts` `dualWritePoints` copy-from-User (W1 invert)
- `app/actions/talent-actions.ts` visibility toggle (W2)
- `features/certificate/issue-*.ts`, `generate-certificate-id.ts` (W3)
- `repositories/hire.ts` challenge `enrollment.certificate` (W3)
- Registration/login/apply/claude-signup SP existence (W4)
- `get-profile.ts` / `get-public-profile.ts` / `get-dashboard-data.ts` SP.domain (enrollment resolver; not CP)
- `features/admin/get-students.ts` + `admin-export-actions.ts` SP joins + Enrollment denorm (W4 identity / W7 counters)
- `repositories/progress.ts` Enrollment streak snapshot (W7)
- `repositories/hire.ts` + `features/talent-pool/pool.ts` + `features/hire/dossier.ts` PM evidence (W8)
- `features/program/missions.ts` `commits.ts` `dashboard.ts` `leaderboard.ts` `interview.ts` `days.ts` PM + ProgramMissionSubmission (W6/W8)
- `pool.buildMissionPortfolio` (W6)

**Admin / analytics-only** (may lag one slice after student-facing, still before drop)

- `get-analytics-data.ts`, `get-overview-stats.ts`, `get-dropoff-by-day.ts`, `get-missing-by-day.ts`, `get-submissions-feed.ts`, `get-student-detail.ts` submissions/quizzes
- `app/admin/program/*` member scores, interviews, content (`ProgramDay.missionPoints` is catalog, not member denorm)
- campus ambassadors page (W5)
- `get-referrals-report.ts` SP.fullName
- `get-registration-dates.ts` SP
- `app/api/claude-recent-signups/route.ts` Enrollment
- program admin export actions

**Historical / dual-write / flag-off fallback — temporarily acceptable**

- `repositories/legacy/*` adapters
- `credentials.ts` / `points.ts` / `candidate.ts` flag-off branches (prod flags ON)
- `dual-write.ts` reading legacy to copy
- `repositories/drift.ts` SynergyEvent counts
- `prisma/scripts/check-078-*.ts`, compare/rehearse scripts

**Dead / unused for live product**

- `repositories/talent.searchCandidates` — unused by `/hire`
- RecruiterProfile / OrganizationMember / TalentList writes — recruiter auth closed; not a Phase 7 write-family (0 production rows)

**Keep until catalog/learning cutover (out of W1–W8)**

- `ProgramDay` as curriculum catalog (`listCurriculumDays`, talent portfolio types)
- `Challenge` id map (`getChallengeByDomain`)
- `HackathonParticipant` as hackathon pool membership

## 7. Recommended write-family order

Do **not** use the old Phase 6 flag order (Credential → Points → Candidate →
Learning → Progress → Talent). That was a **read** sequence. Writes stop in
dependency order: isolated wallets first, then identity, then evidence, then
denorm caches that evidence still feeds.

Pattern for every family: **move reads/guards → verify parity → stop that
one legacy write family → observe → reconcile → next.** Never stop two
unrelated families in one deploy.

| Step | Family | Why this position |
|---|---|---|
| **W1** | Points (`User.synergyPoints` + SP mirror; then SynergyEvent) | Display already on `PointsAccount`. Remaining live decision is the redeem/admin guard. Isolated from hire/program evidence. Existing recon is green-path (`pointsAccountVsUserSynergy`, `pointsLedgerVsAccount`). |
| **W2** | Visibility consent column | Tiny write surface. Reads already CV. Toggle is currently wrong vs the gate. Does not depend on W1. Could theoretically go first; **after W1** so the first stop is the wallet (highest stale-if-stop money risk), then this correctness fix. If W1 slips, W2 may still ship as a **read/write invert** without stopping consent yet. |
| **W3** | Certificate mint | Display already Credential. Issue still Certificate-first. Hire join + id uniqueness are the blockers. Independent of Points. |
| **W4** | StudentProfile identity (+ referral uniqueness) | CP already SoT for student identity reads. Admin/gates/CSV still SP. Domain **excluded** (enrollment resolver). |
| **W5** | Ambassador SP-only (or keep SP as home) | No 078 table. Do not block W4. |
| **W6** | Submission / QuizAttempt / ProgramMissionSubmission | After admin + program UI + talent portfolio read attempts. Unlocks derived scores. |
| **W7** | Enrollment denorm (days + **snapshot streaks** + status if still legacy) | After W6 so days can be derived; streaks only after an explicit snapshot cache with the current formula. |
| **W8** | ProgramMember scores / skills JSON / projects / interview (unlock/skip if program UI not yet on PE) | Last. Hire/talent/program still authoritative on these. Pre-req: 24-member `CandidateSkill` backfill + **zero** PM skills fallback. |

`ProgramDay` catalog and `HackathonParticipant` membership are later than W8.

## 8. First Phase 7 write-family cutover (do not execute here)

**Family: Points.**

This plan does **not** stop User/SP synergy writes.

Precursor (next implementation plan, still dual-write ON):

1. Redeem: `PointsAccount` `updateMany` `balance: { gte: cost }` + decrement in
   the same transaction; then mirror User/SP/SynergyEvent as compatibility
   copies (or write those from the new balance).
2. Admin grant / debit / refund / reset: same account-first rule; reset must
   not use `SynergyEvent.aggregate` as the amount source once the ledger is
   `PointsTransaction`.
3. Change `dualWritePoints` so `PointsAccount.balance` is
   `previousAccount.balance + amount` (create from 0 + amount), **not**
   `user.synergyPoints`.
4. Keep `getBalance` on the account.
5. Observe: marketplace redeem, admin grant/debit/refund, submit award,
   referral award. Recon `pointsAccountVsUserSynergy` = 0 and
   `pointsLedgerVsAccount` = 0 for at least one production observe window.
6. **Only then** a later plan may stop User/SP synergy writes. SynergyEvent
   stop is W1b after reset/grant no longer read events.

Rollback: revert the invert deploy; User is still written.

## 9. Guardrails for Cursor (DO NOT)

- Do not set `ENABLE_DUAL_WRITE` false.
- Do not stop any legacy writes in this pass or in the W1 precursor until a
  later plan explicitly says so.
- Do not drop legacy tables.
- Do not copy `StudentProfile.domain` onto `CandidateProfile`.
- Do not switch streak display to live-recomputed values.
- Do not stop `ProgramMember` score/skills writes while hire/talent/program
  still read them.
- Do not stop Certificate mint while hire still joins `enrollment.certificate`
  or `generateCertificateId` uniqueness is Certificate-only.
- Do not treat `EnrollmentProgress` as the streak SoT — progress repo
  currently forbids reading it.
- Do not remove the PM.skills fallback until the 24 searchable members have
  `CandidateSkill` rows and hire/talent are CP-only.
- Do not stop several write families in one deploy.
- Keep middleware edge-safe; no `@/lib/*` in `middleware.ts`.
- Do not edit `CLAUDE.md` or `docs/project-context.md`.

## 10. DB safety

No schema or data mutation in this pass. The 24-member skills backfill is a
**future** Neon child-branch job, not this plan.

## 11. Verification

- This file exists and the matrix covers the eight requested areas.
- Live code still dual-writes; flags unchanged.
- `npx tsc --noEmit` not required (docs only).

## 12. Commit message

```
docs: Phase 7 shutdown matrix and Points-first write-family order

Planning only; dual-write and legacy writes stay. Next slice inverts
PointsAccount to the live balance guard without stopping User synergy writes.
```
