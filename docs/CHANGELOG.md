- 2026-08-19 [convention] /program/day restyled to cream/orange design system (behavior unchanged)

- 2026-08-19 [convention] Program /dashboard rebuilt as collapsible module view on cream/orange design system; /program (app) shell is light; Curriculum nav hidden (route kept); heatmap kept for talent

- 2026-08-20 [rule] Campus Ambassador onboarding is off-site (abtalksca.netlify.app); dashboard apply stopped; challenge-enrolled students get banner + derived bell notice
- 2026-08-20 [convention] Reverted PR #153 chatbot-knowledge-base from master (old modernist UI and extra KB ingest that landed with it)
- 2026-08-20 [rule] US AI cohort (name "AI Cohort USA") stays unfrozen until every ENROLLED/COMPLETED member has passed Day 31; India still freezes on endsAt
- 2026-08-18 [rule] ViCoDathon placement certs issuable on production via --all --allow-production on issue-hackathon-award-certificates.ts
- 2026-08-18 [rule] ViCoDathon placement certs (winner/2nd/3rd/top5) as extra HACKATHON rows with metadata.hackathonVariant; same overlay layout
- 2026-08-18 [rule] Admin community synergy grant cap raised from 2000 to 3000

- 2026-08-18 [rule] Admin reset/reject clamps User and StudentProfile synergy at 0 and writes BALANCE_RECONCILIATION for already-spent submission points so the ledger cannot go negative

- 2026-08-18 [schema|rule|convention] Synergy became one User-level wallet for challenge and hackathon students (with a temporary StudentProfile rollback mirror and ledger reconciliation); all Neon mutations must target a production child branch unless that exact production write is explicitly authorized

- 2026-08-18 [schema] Reverted PR #168 AI cohort interview foundation from master (code + unused 20260813000000 migration file; do not apply/drop that schema on production)

- 2026-08-18 [convention] New UI follows docs/design-system.md (plan 071 orange/cream); modernist/pre-modernist retired as templates, existing screens unchanged

- 2026-08-18 [schema|convention] Plan 067 notification bell: Notification + NotificationRead models (read state keyed by opaque string, NOT an FK) and /admin/notifications composer; automated workshop/hackathon/cohort notifications are DERIVED at read time from EVENTS, HACKATHON config and ENROLLING ProgramCohort rows — no rows, no cron, read path stays write-free. NotificationProvider sits above SynergyProvider in the root layout (BottomNavGate needs it) and fetches only when a bell trigger mounts; one NotificationBellButton renders desktop-only in AppHeader and mobile-only as a 6th item in the bottom pill (deliberately outside the `tabs` array so the sliding indicator still measures correctly). Event notifications are suppressed for users they no longer apply to: an existing WorkshopRegistration for that eventId, an existing HackathonParticipant row (which also inverts the hackathon set — "register now" for non-participants, kickoff/deadline for participants only), or an existing ProgramMember row for that cohort. The bell shows only the newest 5 items (FEED_LIMIT in get-notifications.ts) — older ones fall off on their own, so there is deliberately no dismiss/remove control and no dismissed state in the schema

- 2026-08-17 [schema] College catalog table (54,651 institutions) + StudentProfile.collegeId (nullable, no FK) so registration/profile can store a canonical pick while college stays the display string

- 2026-08-13 [rule] Hackathon ViCoDathon 2026 participation certificates (ABT-HK-XXXXX); HACKATHON_CERTIFICATE_TEMPLATE_URL/PATH per-type template
- 2026-08-12 [rule] Program behind-by / at-risk pace uses cohort calendar day, not Day-4 unlock ceiling (calendar+3), so on-time members are not falsely flagged ~4 days behind
- 2026-08-12 [rule|convention] Program day boundaries: PROGRAM_TZ America/Chicago → Asia/Kolkata; admin cohort startsAt/endsAt round-trip via fromZonedTime(PROGRAM_TZ) so Mission Control cohort day matches today's mission
- 2026-08-11 [env|convention] Site help chatbot behind ENABLE_CHATBOT: /api/chat + ChatWidget in root layout, knowledge/ KB, optional GEMINI_API_KEY / ANTHROPIC_API_KEY for generation
- 2026-08-11 [convention] Privacy Policy polish (v2026-08-11): plain-English section leads, DNT, hosting logs/IP, DPDP lawful-basis framing, concrete security measures, material-change notice (email/banner/re-accept); PRIVACY_VERSION bump triggers reconsent banner
- 2026-08-10 [schema|convention] Plan 061: cookie chooser is a small bottom-right banner (no overlay); entity details published (ABTalksOnAI / Suman Shukla / Udyam UDYAM-UP-29-0250625 / Ghaziabad address — no PAN/bank/IFSC); NewsletterSubscription model + pre-checked newsletter opt-in on all signup funnels (excluded from submit gate); Privacy/Terms wording updated to match. Migration 20260810180000_newsletter_subscription applied to Neon on 2026-08-11 (additive only: CREATE TABLE + indexes + FK)
- 2026-08-10 [rule] Consent now recorded at OAuth signup: auth.ts events.createUser writes TERMS+PRIVACY rows under source "oauth_signup" when the adapter first creates a User, closing the gap where Google sign-in created an account before any consent form was reached. /login carries a Terms/Privacy/18+ notice (notice, not checkbox — returning users have already accepted). Wrapped in try/catch; auth.config.ts untouched to stay edge-safe
- 2026-08-10 [rule|convention] Plan 060 legal hardening: entity + Grievance Officer blocks (24h ack / 15d resolve) on /terms /privacy /contact with <<FILL>> placeholders; draft banner removed; DPDP s13/s14 rights; certificate non-accreditation, Synergy Points non-currency, Fees, Indemnity, 30-day notice-before-suit; new /cookies + /contact; blocking cookie consent modal (all|limited|essential) gating abtalks_ref/abtalks_src in middleware, stored in abtalks_consent cookie with no DB row; DSAR email notification + /admin/data-requests; reconsent banner on version bump. Client-safe constants split into src/lib/legal-constants.ts (importing @/lib/legal from a client component pulled node:fs/promises into the browser bundle). Versions bumped to 2026-08-10. Migration 20260808120000_legal_consent_and_rights applied to Neon on 2026-08-11 — LegalConsent and DataRightsRequest now exist, so consent recording, the reconsent banner and /admin/data-requests are live
- 2026-08-08 [schema|convention] Added LegalConsent + DataRightsRequest tables, ProgramMember.recruiterVisibilityConsentAt, public /terms /privacy + funnel consent logging (DPDP-oriented)
- 2026-08-06 [schema] Baselined orphaned HackathonProblem/HackathonSubmission migration and added /hackathon/submission flow on the existing tables to avoid shared-Neon drift
- 2026-08-06 [rule] Hackathon registration stays open until registrationClosesUtc (Fri 7 Aug 2026 6:00 PM IST); registrationOpen remains an emergency kill switch
- 2026-08-07 [rule] Hackathon registrationOpen kill switch set false; unregistered /hackathon/dashboard visitors see closed message instead of register redirect
- 2026-08-09 [convention] /admin/students lists challenge + hackathon via track filter (ALL|CHALLENGE|HACKATHON)
- 2026-08-09 [rule] Adjusted hackathon submission deadline to Sun 9 Aug 8:45 PM IST
- 2026-08-10 [convention] /admin/submissions gains Hackathon sub-tab for HackathonSubmission feed + CSV
- 2026-08-10 — `/` now renders the landing hub for signed-in users too (no more redirect to /dashboard); track cards show "Open dashboard" per-track via `features/landing/get-landing-state.ts`; `/login` bounces signed-in users to `/` instead of `/dashboard`.

## Pending reconcile

_(Cleared 2026-08-24 — the 17 entries that were under this heading were folded into `docs/project-context.md`,
reconciled against `3b040d8`. The un-headed block above (2026-08-06 → 2026-08-20) was logged outside this
heading and was never reconciled; its facts were folded into the same pass, but the lines were left in place
rather than deleted without authorization. Cursor appends new lines below.)_
- 2026-08-26 [convention] Claude Challenge (/claude + /claude/day/[day]) restyled onto hub DashboardShell (Claude-only desktop collapse) and cream/orange AI Cohort language; heatmap/stats/AppHeader removed from Claude UI; no schema change
- 2026-08-25 [convention] Campus Ambassador onboarding banner and derived notification-bell item removed from student surfaces.
- 2026-08-25 [convention] Campus Ambassador onboarding banner unmounted from dashboard hub and challenge track pages.
- 2026-08-25 [convention] AUTH_SECRET + session cookie v2 to stop JWTSessionError; login/register use scoped orange outline CTAs.
- 2026-08-25 [convention] Promo Claude/hackathon overlays unmounted; cookie/terms consent and AI Cohort landing use scoped orange; apply pages stay purple.

- 2026-08-24 [schema|rule|convention] Plan 082 on feat/hire-scout-078 lands PR #200 (/hire Scout) on the 078 architecture: CandidateAvailability dropped for CandidatePreference (repositories/candidate.ts owns the mapping and ensures a CandidateProfile row first); TalentRequestMatch/TalentEngagementRequest keyed on candidateUserId with programMemberId demoted to un-FK'd provenance; searchableUserWhere() in repositories/talent.ts is the single recruiter-discovery gate, ANDed onto every candidate query inside the new src/repositories/hire.ts seam so a caller cannot omit it, and now covering challenge and hackathon candidates (which had none) plus a re-filter of stored TalentRequestMatch rows on read; candidate-declared salary never reaches a recruiter surface; recruiter registration and admin approval also provision UserRoleAssignment(RECRUITER)+Organization+OrganizationMember with VerifiedRecruiterSeat narrowed to a pre-account invite; track registry carries the 078 cohort slug; hire plan docs renumbered 083-094. ENABLE_NEW_* stay off and legacy stays authoritative; the 078 read branch is additionally gated on NEW_HIRE_POOL_READY until Phase 2e/2f complete
- 2026-08-25 [env|convention] Blurred "Pro" preview cards on an empty /hire search, behind HIRE_PRO_PREVIEW (default off, read on the server and passed to the desk as a prop). features/hire/locked-preview.ts fabricates 3 deterministic example profiles from the recruiter's own spec — name/location/education/email/phone/compensation are generated, never anonymised real candidates — and components/hire/locked-field.tsx blurs them with an "Upgrade to Pro to see the full profile" prompt. Refs keep the SAMPLE: prefix so the whitelist still refuses them: a preview can never be shortlisted or become an engagement request. Pro is presentational only (no plan column, no entitlement, no billing) and is a COMMERCIAL gate that must never widen the privacy gate — contact is still released only by an admin-approved TalentEngagementRequest reaching CONTACT_SHARED, and paying cannot skip that
- 2026-08-25 [env|rule] Recruiter login/register closed unless ENABLE_RECRUITER_AUTH=true: /talent/login and /talent/register show a closed page, hire Sign in/Register buttons are hidden, and recruiter-otp authorize plus OTP/register actions refuse new sign-ins; /hire guest browsing stays public
- 2026-08-25 [rule] Program members start at Day 1 (PROGRAM_MEMBER_START_DAY); Days 1–3 are no longer waived at enroll
- 2026-08-25 [rule] Phase 5 pass #2 waits until 2026-08-25T15:57:57Z; extras treat recruiter-visible as all ProgramMembers plus platform_default (not consent-only); ENABLE_NEW_* stay off until that pack is clean
- 2026-08-25 [convention] 078 points count-drift ignores Phase 2f User.synergyPoints plug rows (idempotencyKey reconciliation:phase2:*); those txs have no SynergyEvent by design and must not be deleted
- 2026-08-25 [rule] Dual-write now covers CandidateProfile on registration/profile update and Credential on certificate issuance (legacy still authoritative; ENABLE_NEW_* stay off)
- 2026-08-26 [rule] Phase 5 24h wait elapsed; 885d37a continuous-write is live; accelerated final gate is unscoped pass #2 now (no extra 24h after this deploy); ENABLE_NEW_* stay off; do not start Phase 6 until that pack is clean
- 2026-08-26 [rule] Phase 5 complete: second unscoped pack clean after 24h dual-write; ENABLE_NEW_* still off until Phase 6 switches
- 2026-08-26 [env] ENABLE_NEW_CREDENTIAL=true on production after clean smoke + recon
- 2026-08-26 [convention] Phase 6 CREDENTIAL complete: /verify /achievements /download read via credential repository; ENABLE_NEW_POINTS is next; dual-write and legacy Certificate writes stay
- 2026-08-26 [env] ENABLE_NEW_POINTS=true on production after clean smoke + recon
- 2026-08-26 [convention] Phase 6 POINTS complete: header chip /marketplace /admin SP display read via points repository; ENABLE_NEW_CANDIDATE is next; dual-write and legacy User.synergyPoints writes stay
- 2026-08-26 [env] ENABLE_NEW_CANDIDATE rolled back to false on production: CandidateProfile.referralCode differed from StudentProfile for 6 users (including a post-launch registration); profile display vs registration lookup would split-brain
- 2026-08-27 [env] ENABLE_NEW_CANDIDATE=true on production after referral-owner contract + clean smoke + recon
- 2026-08-27 [convention] Phase 6 CANDIDATE complete: live identity reads require CandidateProfile then return StudentProfile view; referral lookup stays on StudentProfile; ENABLE_NEW_LEARNING is next; dual-write and legacy StudentProfile writes stay
- 2026-08-27 [rule] ENABLE_NEW_CANDIDATE reads CandidateProfile + profile-owned edu_sp_/exp_sp_ + CandidateSkill without StudentProfile overlay; referral lookup follows the flag; dual-write copies the live SP referral code and only submitted identity fields; LEARNING stays off
- 2026-08-27 [convention] Phase 6 CANDIDATE genuine reads complete after referral repair + skills/edu/exp catch-up; ENABLE_NEW_LEARNING stays off; admin list/CSV/campus-ambassador remain StudentProfile until Phase 7
- 2026-08-27 [rule] Phase 6 LEARNING read-switch is in the repo behind ENABLE_NEW_LEARNING=false: student catalog/enrollment/membership/quiz definitions go through repositories/learning.ts; completion/progress stay legacy; StudentProfile.domain is pre-StudentProfile-retirement debt and is unchanged
- 2026-08-27 [convention] Program dashboard continue card previews the next locked day with an unlock date; VIEW STATS shows cleared/31 progress instead of a second cohort-day /31
