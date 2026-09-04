/** Flat synergy for one paid submission. Also the per-IST-day ceiling. */
export const SYNERGY_BASE_SUBMISSION = 10;
export const SYNERGY_REFERRAL = 3;

/**
 * A user earns submission synergy at most once per IST calendar day, across
 * every challenge they are enrolled in. See plan 111.
 */
export const SYNERGY_DAILY_SUBMISSION_CAP = SYNERGY_BASE_SUBMISSION;
