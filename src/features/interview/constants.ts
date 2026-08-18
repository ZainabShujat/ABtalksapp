/** Interview fixed parameters. */

/* ------------------------------------------------- AI Cohort interview (V1) */

/**
 * Wall-clock budget for a cohort milestone interview. Advisory in the text
 * runner; the voice phase will enforce it as a hard stop.
 */
export const COHORT_INTERVIEW_DURATION_SEC = 900;

/**
 * An interview shorter than this is not scored — too little evidence to be
 * comparable against candidates who sat the full session. Such attempts are
 * closed INVALID and consume no milestone, so nobody loses their one attempt to
 * a dropped connection.
 */
export const COHORT_INTERVIEW_MIN_DURATION_SEC = 180;

/**
 * An IN_PROGRESS attempt older than this is swept to ABANDONED. Without this a
 * closed tab would leave a row that blocks the member from ever starting again.
 * Abandoned attempts consume nothing, so sweeping is always safe.
 */
export const COHORT_INTERVIEW_STALE_MS = 60 * 60 * 1000;

/**
 * Consecutive stuck answers after which the interview concludes early. Applies
 * to both banks.
 */
export const STUCK_ANSWERS_BEFORE_EARLY_END = 3;

/**
 * Global ceiling on follow-ups per question. Each bank question carries its own
 * `maxFollowUps` (0, 1 or 2); this caps whatever the bank asks for so a bank
 * edit can never make an interview unbounded.
 */
export const MAX_FOLLOW_UPS_PER_QUESTION = 2;

/* ------------------------- general interviewer (not V1 — see docs/plans/066) */

/** Completed challenge days required to unlock a first attempt. */
export const INTERVIEW_MIN_COMPLETED_DAYS = 30;

/**
 * NEW completed challenge days required to unlock each retake. Progress may
 * combine across challenges; a day already consumed by an earlier attempt
 * never counts again.
 */
export const INTERVIEW_RETAKE_NEW_DAYS = 30;

export const INTERVIEW_DURATION_SEC = 900;
export const INTERVIEW_MIN_DURATION_SEC = 180;

/** Questions in a standard general session, before follow-ups. */
export const INTERVIEW_QUESTION_COUNT = 10;

/** Challenge tasks handed to the general planner. Caps prompt size and cost. */
export const MAX_CHALLENGE_TASKS_IN_CONTEXT = 24;

/** An IN_PROGRESS general session older than this is treated as abandoned. */
export const INTERVIEW_STALE_MS = 30 * 60 * 1000;
