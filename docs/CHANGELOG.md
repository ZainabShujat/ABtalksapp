## Pending reconcile

<!-- Reconciled through 2026-08-05 (commit 519cc34) into docs/project-context.md. -->

- 2026-08-12 [convention] App fonts self-hosted via next/font/local + src/fonts (no next/font/google fetch at build)
- 2026-08-12 [convention] Open-right-now program cards each mount GhostCursor tinted to that card’s brand color (`three` postprocessing)
- 2026-08-13 [rule] Hackathon ViCoDathon 2026 participation certificates (ABT-HK-XXXXX); HACKATHON_CERTIFICATE_TEMPLATE_URL/PATH per-type template
- 2026-08-12 [rule] Program behind-by / at-risk pace uses cohort calendar day, not Day-4 unlock ceiling (calendar+3), so on-time members are not falsely flagged ~4 days behind
- 2026-08-12 [rule|convention] Program day boundaries: PROGRAM_TZ America/Chicago → Asia/Kolkata; admin cohort startsAt/endsAt round-trip via fromZonedTime(PROGRAM_TZ) so Mission Control cohort day matches today's mission
- 2026-08-11 [convention] `/` logged-out landing is Figma rounded hub (`LandingHub`), not ModernistLanding
- 2026-08-11 [env|convention] Site help chatbot behind ENABLE_CHATBOT: /api/chat + ChatWidget in root layout, knowledge/ KB, optional GEMINI_API_KEY / ANTHROPIC_API_KEY for generation
- 2026-08-11 [convention] Privacy Policy polish (v2026-08-11): plain-English section leads, DNT, hosting logs/IP, DPDP lawful-basis framing, concrete security measures, material-change notice (email/banner/re-accept); PRIVACY_VERSION bump triggers reconsent banner
- 2026-08-10 [convention] Modernist app retheme — HSL token palette, --radius 0, Archivo, light-only foundation (plan 058)
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
