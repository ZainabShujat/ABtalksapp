#!/usr/bin/env node
/**
 * Module labels — PRs from changed files, issues from the module template checkboxes.
 *
 * Local:
 *   node scripts/pr-module-labels.mjs src/app/profile/page.tsx src/features/hire/credits.ts
 *   node scripts/pr-module-labels.test.mjs
 *
 * GitHub Action:
 *   PR_NUMBER — `module:<id>` plus `primary:<id>` from the diff (most files; tie-break = lines).
 *   ISSUE_NUMBER — same labels from ticked boxes in `.github/ISSUE_TEMPLATE/module.md`.
 *   First ticked box is primary. Issues that were not opened from the template are left alone.
 *
 * First matching PATH_RULES entry wins. Put specific globs above directory catch-alls.
 * Authors may add/remove any non-managed label. `module:*` and `primary:*` are
 * re-synced from the diff (PRs) or checkboxes (issues) — fix a wrong tag here, not on the ticket.
 */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"search"|"profile"|"assessments"|"evidence"|"credits"|"outreach"|"mock-interviews"|"recruiter-onboarding"|"talent"|"pipeline"|"recruiter-assessments"|"recruiter-analytics"|"jobs"|"notifications"|"analytics"|"auth"|"admin"|"security"|"config"|"infra"|"database"|"ui"|"challenge"|"program"|"hackathon"|"workshop"|"marketplace"|"dashboard"|"synergy"|"certificate"|"legal"|"landing"|"docs"|"unmapped"} ModuleId */

/** @type {Record<ModuleId, { color: string, description: string }>} */
export const MODULES = {
  search: { color: "03535F", description: "Candidate search and ranking" },
  profile: { color: "18D39B", description: "Candidate profile, skills, resume, preferences" },
  assessments: { color: "197E23", description: "Candidate-side assessments" },
  evidence: { color: "27CA37", description: "Skill evidence" },
  credits: { color: "AA821D", description: "Credits, ledger, contact unlock, plans" },
  outreach: { color: "076573", description: "Recruiter outreach and hire messages" },
  "mock-interviews": { color: "02434D", description: "Mock interviews" },
  "recruiter-onboarding": { color: "4B4B4B", description: "Recruiter registration, profile, company identity" },
  talent: { color: "0B6E4F", description: "Talent projects and talent pool" },
  pipeline: { color: "2E6B8A", description: "Shortlist, reject, review panel, hiring pipeline" },
  "recruiter-assessments": { color: "1B7F6A", description: "Recruiter assessment builder, assign, results" },
  "recruiter-analytics": { color: "5A7D2E", description: "Recruiter demand / hire analytics" },
  jobs: { color: "197E23", description: "Jobs and applications" },
  notifications: { color: "076573", description: "In-app notifications and delivery" },
  analytics: { color: "626262", description: "Product analytics events and UTM" },
  auth: { color: "02434D", description: "Authentication and recruiter work-email gate" },
  admin: { color: "353535", description: "Platform admin" },
  security: { color: "8B1E3F", description: "Isolation, rate limits, audit" },
  config: { color: "787878", description: "Platform configuration and feature flags" },
  infra: { color: "4B4B4B", description: "CI, tooling, shared infrastructure" },
  database: { color: "0F4C5C", description: "Prisma schema, migrations, repositories/legacy" },
  ui: { color: "A6D2D5", description: "Design system, shared UI primitives" },
  challenge: { color: "03535F", description: "60-day challenge, quiz, enrollment" },
  program: { color: "076573", description: "AI cohort / Databricks / DS Architect / Power BI / Snowflake / Databricks Data & AI / LangChain & LangGraph" },
  hackathon: { color: "1B4F72", description: "Hackathon" },
  workshop: { color: "2E8B6A", description: "Workshop and cohort-application funnels" },
  marketplace: { color: "5C4B2A", description: "Marketplace" },
  dashboard: { color: "3D6B7A", description: "Candidate dashboard hub" },
  synergy: { color: "C4A35A", description: "Synergy points" },
  certificate: { color: "6B5B3A", description: "Certificates" },
  legal: { color: "626262", description: "Legal, privacy, cookies, DSAR" },
  landing: { color: "18D39B", description: "Marketing / landing / explore" },
  docs: { color: "A5A5A5", description: "Docs, plans, changelog, Cursor rules" },
  unmapped: { color: "D92D20", description: "Changed files that matched no module rule" },
};

export const MODULE_LABEL_PREFIX = "module:";
export const PRIMARY_LABEL_PREFIX = "primary:";

/** Module ids offered on the issue template. `unmapped` is PR-only. */
export const ISSUE_TEMPLATE_MODULE_IDS = /** @type {ModuleId[]} */ (
  Object.keys(MODULES).filter((id) => id !== "unmapped")
);

/**
 * First match wins. More specific globs must appear before directory catch-alls.
 * `foo/**` matches `foo` and everything under it.
 *
 * @type {Array<[string, ModuleId]>}
 */
export const PATH_RULES = [
  // --- Hire splits (must stay above src/app/hire/** and src/features/hire/**) ---
  ["src/features/hire/credits*", "credits"],
  ["src/features/hire/unlock-*", "credits"],
  ["src/features/hire/entitlements.ts", "credits"],
  ["src/features/hire/contact-access.ts", "credits"],
  ["src/features/hire/contact-payload.test.ts", "credits"],
  ["src/repositories/credits.ts", "credits"],
  ["src/app/actions/hire-unlock-actions.ts", "credits"],
  ["src/lib/credits-format.ts", "credits"],
  ["src/lib/validations/hire-unlock.ts", "credits"],
  ["src/components/hire/credit-balance-pill.tsx", "credits"],
  ["src/components/hire/unlock-contact-dialog.tsx", "credits"],
  ["src/components/hire/locked-field.tsx", "credits"],
  ["src/components/hire/subscription-gate.tsx", "credits"],
  ["src/components/hire/checkout-flash.tsx", "credits"],
  ["src/components/hire/pending-checkout.ts", "credits"],

  ["src/features/hire/outreach*", "outreach"],
  ["src/app/actions/outreach-actions.ts", "outreach"],
  ["src/lib/validations/hire-outreach.ts", "outreach"],
  ["src/components/hire/outreach-compose-dialog.tsx", "outreach"],
  ["src/components/hire/engagement-thread.tsx", "outreach"],
  ["src/components/outreach/**", "outreach"],
  ["src/app/hire/messages/**", "outreach"],
  ["src/app/messages/**", "outreach"],
  ["src/features/notification/templates/outreach.*", "outreach"],

  ["src/features/hire/shortlist.ts", "pipeline"],
  ["src/features/hire/project-shortlist.ts", "pipeline"],
  ["src/features/hire/navbar-shortlist.test.ts", "pipeline"],
  ["src/features/hire/project-state.test.ts", "pipeline"],
  ["src/features/recruiter/get-recruiter-review.ts", "pipeline"],
  ["src/app/actions/recruiter-review-actions.ts", "pipeline"],
  ["src/components/hire/desk-shortlist*", "pipeline"],
  ["src/components/hire/shortlist-cart.tsx", "pipeline"],
  ["src/app/hire/requests/**", "pipeline"],
  ["src/app/talent/shortlist/**", "pipeline"],
  ["src/app/r/**", "pipeline"],

  ["src/features/recruiter-assessments/**", "recruiter-assessments"],
  ["src/app/hire/assessments/**", "recruiter-assessments"],
  ["src/app/hire/create-test/**", "recruiter-assessments"],
  ["src/app/actions/recruiter-assessment-actions.ts", "recruiter-assessments"],
  ["src/lib/validations/assessment.ts", "recruiter-assessments"],
  ["src/components/hire/assessment/assessment-builder.tsx", "recruiter-assessments"],
  ["src/components/hire/assessment/question-editor.tsx", "recruiter-assessments"],
  ["src/components/hire/assessment/assessment-assign-panel.tsx", "recruiter-assessments"],
  ["src/components/hire/assessment/preset-picker.tsx", "recruiter-assessments"],
  ["src/components/hire/assessment/assessment-types.ts", "recruiter-assessments"],

  ["src/components/hire/assessment/candidate-assessment-screen*", "assessments"],
  ["src/app/assessments/**", "assessments"],
  ["src/app/actions/assessment-attempt-actions.ts", "assessments"],
  ["src/features/assessment-attempts/**", "assessments"],
  ["src/components/assessments/**", "assessments"],

  ["src/repositories/skill-evidence.ts", "evidence"],
  ["src/app/hire/evidence/**", "evidence"],
  ["src/components/hire/evidence-*", "evidence"],
  ["src/components/profile/evidence-section.tsx", "evidence"],
  ["src/features/profile/get-evidence.ts", "evidence"],

  ["src/features/hire/demand-*", "recruiter-analytics"],
  ["src/features/hire/isolation.test.ts", "security"],
  ["src/features/hire/provision-recruiter.ts", "recruiter-onboarding"],
  ["src/features/hire/recruiter-account*", "recruiter-onboarding"],

  ["src/app/hire/jobs/**", "jobs"],
  ["src/components/hire/jobs/**", "jobs"],

  ["src/lib/candidate-vocab.ts", "search"],
  ["src/lib/validations/hire.ts", "search"],
  ["src/lib/validations/hire-request.ts", "search"],
  ["src/lib/validations/virtual-candidate.ts", "search"],
  ["src/app/actions/hire-actions.ts", "search"],
  ["src/app/actions/hire-request-actions.ts", "search"],
  ["src/app/actions/hire-view-actions.ts", "search"],
  ["src/app/actions/hire-guest-actions.ts", "search"],
  ["src/app/actions/virtual-candidate-actions.ts", "search"],
  ["src/repositories/hire.ts", "search"],
  ["src/app/hire/**", "search"],
  ["src/features/hire/**", "search"],
  ["src/components/hire/**", "search"],

  // --- Profile ---
  ["src/app/profile/**", "profile"],
  ["src/features/profile/**", "profile"],
  ["src/components/profile/**", "profile"],
  ["src/features/resume/**", "profile"],
  ["src/features/skill/**", "profile"],
  ["src/app/actions/profile-actions.ts", "profile"],
  ["src/app/actions/candidate-profile-actions.ts", "profile"],
  ["src/app/actions/resume-actions.ts", "profile"],
  ["src/app/api/profile/**", "profile"],
  ["src/app/api/skills/**", "profile"],
  ["src/lib/profile-display.ts", "profile"],
  ["src/lib/skill-catalog.ts", "profile"],
  ["src/lib/validations/candidate-profile.ts", "profile"],
  ["src/lib/validations/profile.ts", "profile"],
  ["src/lib/validations/resume.ts", "profile"],
  ["src/repositories/candidate.ts", "profile"],
  ["src/repositories/candidate-*.ts", "profile"],
  ["src/app/students/**", "profile"],

  // --- Recruiter onboarding / identity ---
  ["src/app/recruiter-onboarding/signin/**", "auth"],
  ["src/app/recruiter-onboarding/signup/**", "auth"],
  ["src/app/recruiter-onboarding/**", "recruiter-onboarding"],
  ["src/components/recruiter-onboarding/**", "recruiter-onboarding"],
  ["src/features/recruiter-workspace/**", "recruiter-onboarding"],
  ["src/features/recruiter/recruiter-pdf.tsx", "recruiter-onboarding"],
  ["src/features/recruiter/pdf-fonts.ts", "recruiter-onboarding"],
  ["src/app/actions/recruiter-seat-actions.ts", "recruiter-onboarding"],
  ["src/lib/validations/recruiter.ts", "recruiter-onboarding"],

  // --- Talent ---
  ["src/app/talent/**", "talent"],
  ["src/features/talent-pool/**", "talent"],
  ["src/components/talent/**", "talent"],
  ["src/app/actions/talent-actions.ts", "talent"],
  ["src/app/actions/talent-project-actions.ts", "talent"],
  ["src/lib/validations/talent.ts", "talent"],
  ["src/repositories/talent.ts", "talent"],

  // --- Jobs ---
  ["src/app/jobs/**", "jobs"],
  ["src/features/jobs/**", "jobs"],
  ["src/features/recruiter-jobs/**", "jobs"],
  ["src/features/candidate-jobs/**", "jobs"],
  ["src/components/jobs/**", "jobs"],
  ["src/app/actions/job-actions.ts", "jobs"],
  ["src/app/actions/recruiter-job-actions.ts", "jobs"],
  ["src/app/actions/admin-job-actions.ts", "jobs"],

  // --- Notifications ---
  ["src/features/notification/**", "notifications"],
  ["src/app/actions/notification-actions.ts", "notifications"],
  ["src/app/actions/admin-notification-actions.ts", "notifications"],
  ["src/app/api/notification-preferences/**", "notifications"],
  ["src/app/settings/**", "notifications"],
  ["src/components/settings/**", "notifications"],
  ["src/app/api/cron/hire-alerts/**", "notifications"],

  // --- Analytics ---
  ["src/lib/analytics/**", "analytics"],
  ["src/components/analytics/**", "analytics"],

  // --- Auth ---
  ["middleware.ts", "auth"],
  ["src/auth.ts", "auth"],
  ["src/auth.config.ts", "auth"],
  ["src/app/login/**", "auth"],
  ["src/app/api/auth/**", "auth"],
  ["src/app/actions/auth-actions.ts", "auth"],
  ["src/app/actions/otp-actions.ts", "auth"],
  ["src/app/actions/recruiter-auth-actions.ts", "auth"],
  ["src/app/actions/hackathon-auth-actions.ts", "auth"],
  ["src/lib/admin-auth.ts", "auth"],
  ["src/lib/admin-auth.test.ts", "auth"],
  ["src/lib/program-auth.ts", "auth"],
  ["src/lib/recruiter-gate.ts", "auth"],
  ["src/features/recruiter-auth/**", "auth"],
  ["src/lib/validations/recruiter-auth.ts", "auth"],
  ["src/lib/validations/otp.ts", "auth"],
  ["src/lib/validations/work-email.ts", "auth"],
  ["src/lib/validations/phone.ts", "auth"],
  ["src/lib/msg91.ts", "auth"],

  // --- Admin / security / config ---
  ["src/app/admin/**", "admin"],
  ["src/features/admin/**", "admin"],
  ["src/components/admin/**", "admin"],
  ["src/app/actions/admin-platform-actions.ts", "config"],
  ["src/app/actions/admin-*.ts", "admin"],
  ["src/lib/admin-action-metadata.ts", "admin"],
  ["src/lib/rate-limit*", "security"],
  ["src/lib/validations/platform-config.ts", "config"],
  ["src/lib/platform-config.ts", "config"],
  ["src/lib/feature-flags.ts", "config"],
  ["prisma/seed-platform-config.ts", "config"],

  // --- Mock interviews ---
  ["src/features/interview/**", "mock-interviews"],
  ["src/app/interview/**", "mock-interviews"],
  ["src/app/mock-interviews/**", "mock-interviews"],
  ["src/components/mock-interview/**", "mock-interviews"],
  ["src/components/interview/**", "mock-interviews"],
  ["src/app/actions/interview-actions.ts", "mock-interviews"],
  ["src/app/actions/mock-interview-actions.ts", "mock-interviews"],
  ["src/app/actions/dev-interview-agent-actions.ts", "mock-interviews"],
  ["src/app/api/interview/**", "mock-interviews"],
  ["src/app/api/mock-interview/**", "mock-interviews"],
  ["src/lib/validations/interview.ts", "mock-interviews"],
  ["src/lib/validations/mock-interview.ts", "mock-interviews"],
  ["src/components/dashboard-hub/mock-interviews.tsx", "mock-interviews"],

  // --- UI ---
  ["src/components/ui/**", "ui"],
  ["src/components/design/**", "ui"],
  ["src/components/shared/**", "ui"],
  ["src/components/theme-provider.tsx", "ui"],
  ["src/components/theme-toggle.tsx", "ui"],
  ["src/app/globals.css", "ui"],
  ["src/styles/**", "ui"],
  ["src/lib/motion.ts", "ui"],
  ["src/fonts/**", "ui"],
  [".cursor/rules/abtalks-design-system.mdc", "ui"],
  [".cursor/sources/ABTalks_UI_Design_System_FINAL_Forest_Green.md", "ui"],

  // --- Database ---
  ["prisma/**", "database"],
  ["src/lib/db.ts", "database"],
  ["src/repositories/dual-write*", "database"],
  ["src/repositories/drift.ts", "database"],
  ["src/repositories/legacy/**", "database"],
  ["src/repositories/ids.ts", "database"],
  ["src/repositories/types.ts", "database"],
  ["src/repositories/index.ts", "database"],
  ["src/app/api/cron/078-drift/**", "database"],

  // --- Challenge / program tracks ---
  ["src/app/challenge/**", "challenge"],
  ["src/app/challenges/**", "challenge"],
  ["src/app/claude/**", "challenge"],
  ["src/app/claude-signup/**", "challenge"],
  ["src/app/quiz/**", "challenge"],
  ["src/app/ai/**", "challenge"],
  ["src/app/ds/**", "challenge"],
  ["src/app/se/**", "challenge"],
  ["src/app/register/**", "challenge"],
  ["src/app/achievements/**", "challenge"],
  ["src/app/mission/**", "challenge"],
  ["src/features/challenge/**", "challenge"],
  ["src/features/claude/**", "challenge"],
  ["src/features/quiz/**", "challenge"],
  ["src/features/submission/**", "challenge"],
  ["src/features/enrollment/**", "challenge"],
  ["src/features/registration/**", "challenge"],
  ["src/features/user/**", "challenge"],
  ["src/components/challenge/**", "challenge"],
  ["src/components/challenges/**", "challenge"],
  ["src/components/claude/**", "challenge"],
  ["src/app/actions/submission-actions.ts", "challenge"],
  ["src/app/actions/enrollment-actions.ts", "challenge"],
  ["src/app/actions/registration-actions.ts", "challenge"],
  ["src/app/actions/quiz-actions.ts", "challenge"],
  ["src/app/actions/referral-actions.ts", "challenge"],
  ["src/app/actions/campus-ambassador-actions.ts", "challenge"],
  ["src/lib/validations/register.ts", "challenge"],
  ["src/lib/validations/submission.ts", "challenge"],
  ["src/lib/date-utils.ts", "challenge"],
  ["src/app/api/claude-recent-signups/**", "challenge"],
  ["src/app/api/colleges/**", "challenge"],
  ["src/features/college/**", "challenge"],

  ["src/app/program/**", "program"],
  ["src/app/ai-cohort-register/**", "program"],
  ["src/app/ai-cohort-india/**", "program"],
  ["src/features/program/**", "program"],
  ["src/features/databricks/**", "program"],
  ["src/features/ds-architect/**", "program"],
  ["src/features/powerbi/**", "program"],
  ["src/features/snowflake/**", "program"],
  ["src/features/databricks-ai/**", "program"],
  ["src/features/langchain/**", "program"],
  ["src/components/program/**", "program"],
  ["src/components/databricks/**", "program"],
  ["src/components/ds-architect/**", "program"],
  ["src/components/powerbi/**", "program"],
  ["src/components/snowflake/**", "program"],
  ["src/components/databricks-ai/**", "program"],
  ["src/components/langchain/**", "program"],
  ["src/components/talent-hunt/**", "program"],
  ["src/app/actions/program-*.ts", "program"],
  ["src/app/actions/databricks-actions.ts", "program"],
  ["src/app/actions/ds-architect-actions.ts", "program"],
  ["src/app/actions/powerbi-actions.ts", "program"],
  ["src/app/actions/snowflake-actions.ts", "program"],
  ["src/app/actions/databricks-ai-actions.ts", "program"],
  ["src/app/actions/langchain-actions.ts", "program"],
  ["src/app/actions/cohort-application-actions.ts", "program"],
  ["src/app/actions/cohort-application-india-actions.ts", "program"],
  ["src/lib/validations/program.ts", "program"],
  ["src/lib/validations/databricks.ts", "program"],
  ["src/lib/validations/ds-architect.ts", "program"],
  ["src/lib/validations/powerbi.ts", "program"],
  ["src/lib/validations/snowflake.ts", "program"],
  ["src/lib/validations/databricks-ai.ts", "program"],
  ["src/lib/validations/langchain.ts", "program"],
  ["src/lib/validations/cohort-application.ts", "program"],
  ["src/lib/validations/cohort-application-india.ts", "program"],
  ["src/repositories/databricks.ts", "program"],
  ["src/repositories/ds-architect.ts", "program"],
  ["src/repositories/powerbi.ts", "program"],
  ["src/repositories/snowflake.ts", "program"],
  ["src/repositories/databricks-ai.ts", "program"],
  ["src/repositories/langchain.ts", "program"],
  ["src/repositories/learning.ts", "program"],
  ["src/repositories/progress.ts", "program"],
  ["src/repositories/progress.test.ts", "program"],
  ["src/repositories/credentials.ts", "program"],
  ["src/repositories/points.ts", "program"],
  ["src/repositories/points-writes.test.ts", "program"],
  ["src/app/api/cron/program-commits/**", "program"],

  ["src/app/hackathon/**", "hackathon"],
  ["src/features/hackathon/**", "hackathon"],
  ["src/components/hackathon/**", "hackathon"],
  ["src/components/hackathon-v2/**", "hackathon"],
  ["src/app/actions/hackathon-*.ts", "hackathon"],
  ["src/lib/hackathon-*.ts", "hackathon"],
  ["src/lib/validations/hackathon.ts", "hackathon"],

  ["src/app/workshop/**", "workshop"],
  ["src/features/workshop/**", "workshop"],
  ["src/components/workshop/**", "workshop"],
  ["src/app/actions/workshop-actions.ts", "workshop"],
  ["src/lib/workshop-*.ts", "workshop"],

  ["src/app/marketplace/**", "marketplace"],
  ["src/features/marketplace/**", "marketplace"],
  ["src/components/marketplace/**", "marketplace"],
  ["src/app/actions/marketplace-actions.ts", "marketplace"],
  ["src/lib/validations/marketplace.ts", "marketplace"],

  ["src/app/dashboard/**", "dashboard"],
  ["src/features/dashboard/**", "dashboard"],
  ["src/components/dashboard/**", "dashboard"],
  ["src/components/dashboard-hub/**", "dashboard"],

  ["src/features/synergy/**", "synergy"],
  ["src/app/actions/synergy-actions.ts", "synergy"],

  ["src/features/certificate/**", "certificate"],
  ["src/components/certificate/**", "certificate"],
  ["src/app/verify/**", "certificate"],
  ["src/lib/validations/certificate.ts", "certificate"],
  ["src/lib/certification-catalog.ts", "certificate"],

  ["src/app/terms/**", "legal"],
  ["src/app/privacy/**", "legal"],
  ["src/app/cookies/**", "legal"],
  ["src/app/contact/**", "legal"],
  ["src/features/legal/**", "legal"],
  ["src/components/legal/**", "legal"],
  ["src/app/actions/legal-actions.ts", "legal"],
  ["src/app/actions/contact-actions.ts", "legal"],
  ["src/lib/legal.ts", "legal"],
  ["src/lib/legal-constants.ts", "legal"],
  ["src/lib/cookies.ts", "legal"],
  ["src/lib/validations/legal.ts", "legal"],

  ["src/app/page.tsx", "landing"],
  ["src/app/explore/**", "landing"],
  ["src/features/landing/**", "landing"],
  ["src/components/landing/**", "landing"],
  ["src/components/explore/**", "landing"],
  ["src/lib/chatbot*", "landing"],
  ["src/lib/chatbot/**", "landing"],
  ["src/components/chatbot/**", "landing"],
  ["src/app/api/chat/**", "landing"],

  // --- Infra / docs / leftover shared ---
  [".github/**", "infra"],
  ["scripts/**", "infra"],
  ["src/lib/observability/**", "infra"],
  ["src/lib/logger.ts", "infra"],
  ["src/lib/env.ts", "infra"],
  ["src/lib/utils.ts", "infra"],
  ["src/lib/csv.ts", "infra"],
  ["src/lib/email.ts", "infra"],
  ["src/lib/anthropic.ts", "infra"],
  ["src/lib/groq.ts", "infra"],
  ["src/features/email/**", "infra"],
  ["src/app/layout.tsx", "infra"],
  ["src/app/global-error.tsx", "infra"],
  ["src/app/not-found.tsx", "infra"],
  ["src/components/not-found/**", "infra"],
  ["src/app/dev/**", "infra"],
  ["src/components/dev/**", "infra"],
  ["src/app/api/cron/**", "infra"],
  ["src/app/api/spike-embedding/**", "infra"],
  ["src/app/api/build-embeddings/**", "infra"],
  ["next.config.*", "infra"],
  ["instrumentation.ts", "infra"],
  ["sentry.*.ts", "infra"],
  ["package.json", "infra"],
  ["package-lock.json", "infra"],
  ["tsconfig*.json", "infra"],
  ["postcss.config.*", "infra"],
  ["eslint.config.*", "infra"],
  ["vercel.json", "infra"],
  [".gitignore", "infra"],
  [".nvmrc", "infra"],
  ["AGENTS.md", "infra"],
  [".cursor/rules/**", "docs"],
  [".cursor/sources/**", "docs"],
  [".cursorrules", "docs"],
  ["CLAUDE.md", "docs"],
  ["ARCHITECTURE.md", "docs"],
  ["docs/**", "docs"],
  ["README.md", "docs"],

  ["src/features/recruiter/get-recruiter-profile.ts", "pipeline"],
  ["src/lib/country-catalog.ts", "profile"],
  ["src/lib/claude-linkedin-prompts.ts", "challenge"],
  ["src/lib/sound-pref.ts", "ui"],
  ["src/app/favicon.ico", "ui"],
  ["src/data/**", "landing"],
  ["src/types/**", "infra"],
  ["types/**", "infra"],
  ["knowledge/**", "landing"],
  ["content/legal/**", "legal"],
  ["content/**", "docs"],
  ["public/certificates/**", "certificate"],
  ["assets/certificates/**", "certificate"],
  ["public/hackathon*/**", "hackathon"],
  ["public/hire/**", "search"],
  ["public/marketplace/**", "marketplace"],
  ["public/workshop/**", "workshop"],
  ["public/recruiter-onboarding/**", "recruiter-onboarding"],
  ["public/databricks-cohort/**", "program"],
  ["public/ds-architect/**", "program"],
  ["public/powerbi-cohort/**", "program"],
  ["public/snowflake-cohort/**", "program"],
  ["public/langchain-cohort/**", "program"],
  ["public/program/**", "program"],
  ["public/landing/**", "landing"],
  ["public/testimonials/**", "landing"],
  ["public/**", "ui"],
  ["assets/**", "ui"],
  ["load-tests/**", "infra"],
  ["agent packages/**", "infra"],
  [".env.example", "infra"],
  [".vscode/**", "infra"],
  [".claude/**", "infra"],
  [".cursor/debug*", "infra"],
  [".metadata_never_index", "infra"],
  ["components.json", "ui"],
  ["instrumentation-client.ts", "infra"],
  ["**/.gitkeep", "infra"],
];

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
    } else if (pattern[i] === "*") {
      out += "[^/]*";
      i += 1;
    } else if (pattern[i] === "?") {
      out += "[^/]";
      i += 1;
    } else {
      const ch = pattern[i];
      out += /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
      i += 1;
    }
  }
  return new RegExp(`${out}$`);
}

/**
 * @param {string} file
 * @param {string} pattern
 */
export function matchPattern(file, pattern) {
  const normalized = file.replace(/\\/g, "/");
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -3);
    if (normalized === base) return true;
  }
  return globToRegExp(pattern).test(normalized);
}

/** @param {string} file */
export function matchModule(file) {
  const normalized = file.replace(/\\/g, "/");
  for (const [pattern, module] of PATH_RULES) {
    if (matchPattern(normalized, pattern)) return module;
  }
  return /** @type {ModuleId} */ ("unmapped");
}

/**
 * @typedef {{ path: string, additions?: number, deletions?: number }} ChangedFile
 *
 * @param {ChangedFile[]} files
 */
export function classifyFiles(files) {
  /** @type {Map<ModuleId, { files: number, lines: number, paths: string[] }>} */
  const counts = new Map();
  /** @type {Array<{ path: string, module: ModuleId }>} */
  const assignments = [];

  for (const file of files) {
    const module = matchModule(file.path);
    const lines = (file.additions ?? 0) + (file.deletions ?? 0);
    const current = counts.get(module) ?? { files: 0, lines: 0, paths: [] };
    current.files += 1;
    current.lines += lines;
    current.paths.push(file.path);
    counts.set(module, current);
    assignments.push({ path: file.path, module });
  }

  const modules = [...counts.entries()]
    .map(([id, stats]) => ({ id, ...stats }))
    .sort((a, b) => {
      if (b.files !== a.files) return b.files - a.files;
      if (b.lines !== a.lines) return b.lines - a.lines;
      return a.id.localeCompare(b.id);
    });

  const primary = modules[0]?.id ?? "unmapped";
  return { primary, modules, assignments };
}

/** @param {ModuleId} id */
export function moduleLabel(id) {
  return `${MODULE_LABEL_PREFIX}${id}`;
}

/** @param {ModuleId} id */
export function primaryLabel(id) {
  return `${PRIMARY_LABEL_PREFIX}${id}`;
}

/**
 * Read ticked module boxes from an issue body (GitHub markdown template).
 * `usedTemplate` is true when the body has at least one known-module checkbox,
 * checked or not — so blank issues are not retagged.
 *
 * @param {string | null | undefined} body
 * @returns {{ usedTemplate: boolean, modules: ModuleId[], primary: ModuleId | null }}
 */
export function parseIssueModules(body) {
  /** @type {ModuleId[]} */
  const checked = [];
  let usedTemplate = false;
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const box = line.match(/^- \[( |x|X)\]\s+`?([a-z0-9-]+)`?/i);
    if (!box) continue;
    const id = box[2];
    if (!(id in MODULES) || id === "unmapped") continue;
    usedTemplate = true;
    if (box[1].toLowerCase() !== "x") continue;
    const moduleId = /** @type {ModuleId} */ (id);
    if (!checked.includes(moduleId)) checked.push(moduleId);
  }
  return { usedTemplate, modules: checked, primary: checked[0] ?? null };
}

function isManagedLabel(name) {
  return name.startsWith(MODULE_LABEL_PREFIX) || name.startsWith(PRIMARY_LABEL_PREFIX);
}

function ghHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "abtalks-pr-module-labels",
  };
}

/**
 * @param {string} url
 * @param {string} token
 * @param {RequestInit} [init]
 */
async function gh(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...ghHeaders(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? "GET"} ${url} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * @param {unknown} error
 */
export function isLabelWritePermissionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(" 403:") && message.includes("Resource not accessible by integration");
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {number} number
 * @param {string} token
 */
export async function listPrFiles(owner, repo, number, token) {
  /** @type {Array<{ filename: string, additions: number, deletions: number }>} */
  const files = [];
  for (let page = 1; ; page += 1) {
    const batch = await gh(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files.map((file) => ({
    path: file.filename,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 */
async function ensureLabels(owner, repo, token) {
  /** @type {Set<string>} */
  const existing = new Set();
  for (let page = 1; ; page += 1) {
    const batch = await gh(
      `https://api.github.com/repos/${owner}/${repo}/labels?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const label of batch) existing.add(label.name);
    if (batch.length < 100) break;
  }

  const wanted = [];
  for (const id of Object.keys(MODULES)) {
    const meta = MODULES[/** @type {ModuleId} */ (id)];
    wanted.push({
      name: moduleLabel(/** @type {ModuleId} */ (id)),
      color: meta.color,
      description: meta.description,
    });
    wanted.push({
      name: primaryLabel(/** @type {ModuleId} */ (id)),
      color: meta.color,
      description: `Primary module: ${meta.description}`,
    });
  }

  for (const label of wanted) {
    if (existing.has(label.name)) continue;
    try {
      await gh(`https://api.github.com/repos/${owner}/${repo}/labels`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("422")) throw error;
    }
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {number} number
 * @param {string} token
 * @param {string[]} desired
 */
async function syncIssueLabels(owner, repo, number, token, desired) {
  const desiredSet = new Set(desired);
  const current = await gh(
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`,
    token,
  );
  const currentNames = Array.isArray(current) ? current.map((label) => label.name) : [];

  for (const name of currentNames) {
    if (isManagedLabel(name) && !desiredSet.has(name)) {
      await gh(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`,
        token,
        { method: "DELETE" },
      );
    }
  }

  const toAdd = desired.filter((name) => !currentNames.includes(name));
  if (toAdd.length > 0) {
    await gh(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: toAdd }),
      },
    );
  }
}

function printClassification(result) {
  const payload = {
    primary: result.primary,
    modules: result.modules.map((row) => ({
      id: row.id,
      files: row.files,
      lines: row.lines,
    })),
    unmapped: result.assignments
      .filter((row) => row.module === "unmapped")
      .map((row) => row.path),
  };
  console.log(JSON.stringify(payload, null, 2));
}

function writeStepSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines = [
    "## PR module labels",
    "",
    `| Label | Files | Changed lines |`,
    `| --- | --- | --- |`,
    ...result.modules.map(
      (row) =>
        `| ${row.id === result.primary ? `**primary:${row.id}**` : `module:${row.id}`} | ${row.files} | ${row.lines} |`,
    ),
  ];
  const unmapped = result.assignments
    .filter((row) => row.module === "unmapped")
    .map((row) => row.path);
  if (unmapped.length > 0) {
    lines.push("", "### Unmapped files", "", ...unmapped.map((file) => `- \`${file}\``));
  }
  appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

async function applyFromGitHub() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const prNumber = Number(process.env.PR_NUMBER);
  if (!token || !repository || !Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and PR_NUMBER are required");
  }
  const [owner, repo] = repository.split("/");
  const files = await listPrFiles(owner, repo, prNumber, token);
  const result = classifyFiles(files);
  printClassification(result);
  writeStepSummary(result);

  const desired = [
    ...result.modules.map((row) => moduleLabel(row.id)),
    primaryLabel(result.primary),
  ];
  try {
    await ensureLabels(owner, repo, token);
    await syncIssueLabels(owner, repo, prNumber, token, desired);
  } catch (error) {
    if (isLabelWritePermissionError(error)) {
      console.log("Skipping label writes: token does not have permission in this context");
      return;
    }
    throw error;
  }
}

async function applyFromIssue() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  if (!token || !repository || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and ISSUE_NUMBER are required");
  }
  const [owner, repo] = repository.split("/");
  const issue = await gh(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    token,
  );
  if (issue?.pull_request) {
    console.log("Skipping pull request on the issues event");
    return;
  }
  const parsed = parseIssueModules(issue?.body);
  if (!parsed.usedTemplate) {
    console.log("Issue body has no module template checkboxes; leaving labels unchanged");
    return;
  }
  const payload = {
    primary: parsed.primary,
    modules: parsed.modules,
  };
  console.log(JSON.stringify(payload, null, 2));
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(
      summaryPath,
      [
        "## Issue module labels",
        "",
        `Primary: ${parsed.primary ? `primary:${parsed.primary}` : "(none)"}`,
        "",
        parsed.modules.length > 0
          ? parsed.modules.map((id) => `- \`module:${id}\``).join("\n")
          : "_No boxes ticked — managed module labels removed._",
        "",
      ].join("\n"),
    );
  }
  const desired = [
    ...parsed.modules.map((id) => moduleLabel(id)),
    ...(parsed.primary ? [primaryLabel(parsed.primary)] : []),
  ];
  try {
    await ensureLabels(owner, repo, token);
    await syncIssueLabels(owner, repo, issueNumber, token, desired);
  } catch (error) {
    if (isLabelWritePermissionError(error)) {
      console.log("Skipping label writes: token does not have permission in this context");
      return;
    }
    throw error;
  }
}

function isDirectRun() {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return path.resolve(fileURLToPath(import.meta.url)) === invoked;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  const prNumber = Number(process.env.PR_NUMBER);
  if (token && repository && Number.isInteger(issueNumber) && issueNumber > 0) {
    await applyFromIssue();
    return;
  }
  if (token && repository && Number.isInteger(prNumber) && prNumber > 0) {
    await applyFromGitHub();
    return;
  }
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (files.length === 0) {
    console.error(
      "Usage: node scripts/pr-module-labels.mjs <file> [file...]\n" +
        "   or: PR_NUMBER=123 GITHUB_TOKEN=… GITHUB_REPOSITORY=org/repo node scripts/pr-module-labels.mjs\n" +
        "   or: ISSUE_NUMBER=45 GITHUB_TOKEN=… GITHUB_REPOSITORY=org/repo node scripts/pr-module-labels.mjs",
    );
    process.exit(1);
  }
  printClassification(classifyFiles(files.map((pathName) => ({ path: pathName }))));
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
