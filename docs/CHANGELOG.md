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
