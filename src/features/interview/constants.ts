/** General AB Talks AI Interview — fixed parameters. */

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

/** Questions in a standard session, before follow-ups. */
export const INTERVIEW_QUESTION_COUNT = 10;

/** Follow-ups allowed per question before the interview must move on. */
export const MAX_FOLLOW_UPS_PER_QUESTION = 1;

/** Consecutive stuck answers after which the interview concludes early. */
export const STUCK_ANSWERS_BEFORE_EARLY_END = 3;

/** Challenge tasks handed to the planner. Caps prompt size and cost. */
export const MAX_CHALLENGE_TASKS_IN_CONTEXT = 24;

/** An IN_PROGRESS session older than this is treated as abandoned. */
export const INTERVIEW_STALE_MS = 30 * 60 * 1000;
