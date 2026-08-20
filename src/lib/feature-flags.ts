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
  return true;
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
 * Voice mode for the AI Cohort milestone interview.
 *
 * Off by default and read on the server, so the text runner stays the shipping
 * experience until voice is verified. It gates the UI only — the
 * `/api/interview/stt` and `/api/interview/tts` routes enforce their own auth
 * and their own configuration check, because a feature flag is a product
 * decision and must never be the thing standing between an anonymous request
 * and a paid transcription endpoint.
 */
export function isInterviewVoiceEnabled(): boolean {
  return process.env.ENABLE_INTERVIEW_VOICE === "true";
}
