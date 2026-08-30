/**
 * Server-side feature flags (read from process.env).
 * For client components, pass boolean props from a Server Component parent.
 */
export function isClaudeEnabled(): boolean {
  return process.env.ENABLE_CLAUDE_CHALLENGE === "true";
}

export function isDayLockBypassEnabled(): boolean {
  return process.env.BYPASS_DAY_LOCKS === "true";
}

export function isProgramEnabled(): boolean {
  return process.env.ENABLE_PROGRAM === "true";
}

/**
 * Entry assessment quiz is removed from the program cohort product surface.
 * Apply enrolls/waitlists directly. Kept as a always-on flag for call sites.
 */
export function isProgramEntryBypassEnabled(): boolean {
  return true;
}

/**
 * Local/dev bypass for phone OTP verification.
 * When `OTP_DEV_BYPASS=true`, the MSG91 widget is skipped: no SMS is sent and the
 * fixed dev code (see `otpDevCode`) verifies. For developers/CI only — never enable
 * in production.
 */
export function isOtpDevBypassEnabled(): boolean {
  return process.env.OTP_DEV_BYPASS === "true";
}

/** Fixed OTP accepted in dev-bypass mode. Defaults to "1234" (4 digits). */
export function otpDevCode(): string {
  return process.env.OTP_DEV_CODE ?? "1234";
}

/**
 * Whether phone OTP verification is required.
 * Under `next dev` (`NODE_ENV=development`) OTP is skipped so local registration
 * and profile testing need no code. Production / production-mode builds keep
 * MSG91 enforcement intact.
 */
export function isOtpVerificationRequired(): boolean {
  return process.env.NODE_ENV !== "development";
}

/**
 * Local preview of the hackathon submission window before kickoff.
 * `HACKATHON_PREVIEW=true` in .env.local unlocks /hackathon/submission early for the
 * developer only. It does NOT bypass the submission deadline, and it must never be
 * set in the Vercel project env.
 */
export function isHackathonPreviewEnabled(): boolean {
  return process.env.HACKATHON_PREVIEW === "true";
}

export function isChatbotEnabled(): boolean {
  return process.env.ENABLE_CHATBOT === "true";
}

/**
 * Recruiter email OTP sign-in and registration.
 *
 * Off unless `ENABLE_RECRUITER_AUTH=true`. The hire desk stays public; this
 * only closes /talent/login, /talent/register, the hire auth dialog, and the
 * recruiter-otp authorize path.
 */
export function isRecruiterAuthEnabled(): boolean {
  return process.env.ENABLE_RECRUITER_AUTH === "true";
}

/** Plan 078 Phase 6 switches. Phase 3 keeps all of these false (legacy reads). */
export function isNewCandidateRepoEnabled(): boolean {
  return process.env.ENABLE_NEW_CANDIDATE === "true";
}
export function isNewLearningRepoEnabled(): boolean {
  return process.env.ENABLE_NEW_LEARNING === "true";
}
export function isNewProgressRepoEnabled(): boolean {
  return process.env.ENABLE_NEW_PROGRESS === "true";
}
export function isNewTalentRepoEnabled(): boolean {
  return process.env.ENABLE_NEW_TALENT === "true";
}
export function isNewPointsRepoEnabled(): boolean {
  return process.env.ENABLE_NEW_POINTS === "true";
}
export function isNewCredentialRepoEnabled(): boolean {
  return process.env.ENABLE_NEW_CREDENTIAL === "true";
}

/** Plan 078 Phase 4. Off = skip new-table writes; legacy stays authoritative. */
export function isDualWriteEnabled(): boolean {
  return process.env.ENABLE_DUAL_WRITE === "true";
}

/**
 * Cohorts whose consenting members `/hire` may match, before their results are
 * published.
 *
 * `/talent` shows a finished, ranked cohort and rightly waits for
 * `resultsPublishedAt`. `/hire` ranks on evidence-so-far, which exists from the
 * first passed mission — but a running cohort must not become visible by
 * accident, so it is opt-in and set deliberately per cohort.
 *
 * Comma-separated cohort ids, or the literal `all` for every running cohort.
 * Unset (the default) means `/hire` behaves exactly as it does today: published
 * cohorts only.
 */
export function hireOpenCohortIds(): string[] | "all" | null {
  const raw = process.env.HIRE_OPEN_COHORT_IDS?.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "all") return "all";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/**
 * Whether `/hire` may also search the Claude challenge track, and from how many
 * verified days.
 *
 * The AI Cohort is one running cohort of a few dozen people. The challenge is
 * 2,708 enrolments, 682 of whom have submitted at least one day of work against
 * the platform's own checks. Keeping it out of the pool did not protect anyone
 * — nothing about a challenge participant is shown that a program member's card
 * does not also show, and neither carries a name — it just meant the product
 * ranked 1.5% of the evidence it holds.
 *
 * The floor is the interesting half. Below roughly ten submitted days there is
 * no track record to rank, and a recruiter's first screen filling with people
 * who tried the challenge for a weekend is worse for the business than a short
 * list. Ten is the default; the value tunes it.
 *
 * `HIRE_CHALLENGE_POOL=10` (or any integer), `=true` for the default floor.
 * Unset — the default — means `/hire` behaves exactly as it does today.
 */
export function hireChallengePool(): { enabled: boolean; minDays: number } {
  const raw = process.env.HIRE_CHALLENGE_POOL?.trim();
  if (!raw || raw.toLowerCase() === "false") {
    return { enabled: false, minDays: 10 };
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return { enabled: true, minDays: parsed };
  }
  return { enabled: raw.toLowerCase() === "true", minDays: 10 };
}

/**
 * Blurred, fabricated "Pro" preview cards on an empty `/hire` search.
 *
 * Presentational only. There is no plan column, no entitlement and no billing —
 * every locked field is locked for everybody, and the values behind the blur are
 * generated, not real candidates (see features/hire/locked-preview.ts).
 *
 * Off by default: with the searchable pool still small, a desk that fills with
 * example profiles on every empty search is a claim about inventory, and that
 * claim should be switched on deliberately rather than by shipping.
 *
 * Read on the server and passed to the client as a prop — the desk is a client
 * component and cannot read process.env.
 */
export function isHireProPreviewEnabled(): boolean {
  return process.env.HIRE_PRO_PREVIEW === "true";
}

/**
 * Virtual candidates: an empty search offers to source the requirement rather
 * than reporting nothing.
 *
 * Off by default, and deliberately so on two counts.
 *
 * The mechanical one: the feature needs the VirtualCandidate tables, and
 * `docs/project-context.md` records that `prisma migrate deploy` cannot be used
 * on this production database — a leftover `20260813000000_general_interview`
 * folder makes it fail, so migrations are applied with `prisma db execute` plus
 * `prisma migrate resolve --applied`. That is a deliberate act by a person, not
 * something a deploy does on its way past, so the code has to be able to ship
 * before the tables exist. With this off it does: nothing queries them.
 *
 * The product one: offering to source someone is a promise. It should be turned
 * on when the team is ready to answer, not when the code happens to land.
 *
 * Read on the server and passed to the client as a prop — the desk is a client
 * component and cannot read process.env.
 */
export function isVirtualCandidatesEnabled(): boolean {
  return process.env.HIRE_VIRTUAL_CANDIDATES === "true";
}
