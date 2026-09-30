/** Student-facing URL prefix for the AI Cohort product. */
export const PROGRAM_AI_COHORT_BASE = "/program/ai-cohort";

/** Program length and score caps for the AI Cohort curriculum. */
export const PROGRAM_TOTAL_DAYS = 31;

/** New ENROLLED members unlock here; days 1..(n-1) are waived as PASSED. */
export const PROGRAM_MEMBER_START_DAY = 1;

/** Program day boundaries and unlock calendar (IST). */
export const PROGRAM_TZ = "Asia/Kolkata";

export const PROGRAM_MAX_MISSION_POINTS = 372;
export const PROGRAM_MAX_CONCEPT_POINTS = 93;
export const PROGRAM_MAX_COMMIT_POINTS = 155;
export const PROGRAM_MAX_PROJECT_POINTS = 400;
export const PROGRAM_MAX_TOTAL_POINTS =
  PROGRAM_MAX_MISSION_POINTS +
  PROGRAM_MAX_CONCEPT_POINTS +
  PROGRAM_MAX_COMMIT_POINTS +
  PROGRAM_MAX_PROJECT_POINTS;

export const COMMIT_POINTS_PER_DAY = 5;

/** When false, Mission Control hides commit pts / commit heatmap UI (backend kept). */
export const PROGRAM_COMMIT_UI_ENABLED = false;

// PROGRAM_HOLD_OPEN_COHORT_NAME is retired (plan 157). It held one cohort open
// past its endsAt by matching its literal name; the track is now rolling, so no
// cohort freezes on a date and no name needs special-casing.
