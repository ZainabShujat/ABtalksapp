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

/**
 * Redirects allowed on one question before the interview simply moves on.
 *
 * The interviewer must never be argued into answering off-topic questions, so
 * this is not a "give up and comply" limit — a redirected candidate keeps the
 * same question on the floor and loses no follow-up budget. The cap exists only
 * so a candidate who keeps testing the bot cannot hold a milestone interview
 * open indefinitely. Set above two so the "asked twice" case still redirects.
 */
export const MAX_REDIRECTS_PER_QUESTION = 3;

/**
 * Escalations allowed on a single question.
 *
 * Separate from the follow-up budget on purpose: a follow-up spends a turn
 * closing a GAP, an escalation spends one finding a CEILING. A question with
 * `maxFollowUps: 0` (recall-level, never worth probing a gap on) can still earn
 * an escalation, because rewarding a strong answer with a harder one is exactly
 * what the spec asks for.
 */
export const MAX_ESCALATIONS_PER_QUESTION = 2;

/**
 * Evidence items a DEEP PROBE answer must cover to count as cleared.
 *
 * Rungs are not authored with their own `minEvidence` — they are follow-on
 * questions, not standalone assessment items, and asking an author to tune a
 * bar for each one invites drift. Two is the same bar most core questions use,
 * clamped to the rung's checklist length.
 */
export const DEEP_PROBE_MIN_EVIDENCE = 2;

/**
 * Consecutive strong answers in one competency before the interview is allowed
 * to spend its second escalation there. Below this, one rung per question — the
 * interview probes for depth without turning every good answer into a
 * three-part interrogation.
 */
export const STRONG_ANSWERS_TO_RAISE_CEILING = 2;

/**
 * Consecutive weak answers in one competency before escalation is suppressed.
 *
 * Two, not one. A single weak answer must never suppress the next escalation —
 * candidates have off moments, and an interview that punishes one stumble stops
 * measuring ability. The streak resets the instant they answer well.
 */
export const WEAK_ANSWERS_TO_SUPPRESS = 2;

/**
 * Extension questions appended for cohort days passed BEYOND the blueprint's
 * scope. Small on purpose: the milestone is the assessment, current progress is
 * context.
 */
export const MAX_EXTENSION_QUESTIONS = 2;

/**
 * Times a question may be repeated on request before a repeat is treated as a
 * non-answer. Repeats are free (no evidence, no budget) and legitimate on a
 * voice interview where audio can genuinely drop.
 */
export const MAX_REPEATS_PER_QUESTION = 2;

/**
 * Clarifications ("what do you mean by X?") allowed per question.
 *
 * Separate from REPEAT, which restates. A clarification is answered, and a
 * candidate who genuinely misunderstands a term deserves one — but an unbounded
 * budget is a way to have the interviewer explain the whole topic, so it is
 * capped like every other non-answer move.
 */
export const MAX_CLARIFICATIONS_PER_QUESTION = 2;

/**
 * Core answers used to read the candidate's level before the interview commits
 * to a posture.
 *
 * Three, because one answer is noise and two is a coin flip: someone can open
 * badly on a topic they happen not to own and be strong everywhere else. Three
 * is also early enough that the remaining questions still benefit from the
 * read.
 */
export const CALIBRATION_ANSWERS = 3;

/* ------------------------------------------------------ voice turn-taking */

/**
 * Continuous quiet, AFTER the candidate has started speaking, that ends their
 * answer and submits it.
 *
 * A voice interview cannot wait forever for someone who has stopped talking,
 * and it must not cut off someone who is still thinking mid-sentence. 4.5s is
 * long enough to survive a normal pause between clauses and short enough that
 * the end of an answer does not feel like a hang.
 */
export const INTERVIEW_SILENCE_MS = 4_500;

/**
 * Speech thresholds, as RMS of the analyser signal.
 *
 * Two values, not one: ON is what counts as "they have started", OFF is what
 * counts as "they have stopped". The gap is hysteresis. With a single threshold
 * a voice sitting near the line flickers many times a second and the silence
 * timer never accumulates, so an answer would never end on its own.
 */
export const SPEECH_ON_RMS = 0.20;
export const SPEECH_OFF_RMS = 0.15;

/**
 * How long the room waits when the candidate has said NOTHING at all before
 * prompting them. Distinct from the silence timer, which ends an answer that
 * has already happened.
 */
export const NO_ANSWER_MS = 10_000;

/**
 * Language corrections allowed per question before the interview stops asking.
 *
 * One. A candidate who answers in another language is asked once, in English,
 * to answer in English. If the second attempt is also not English the question
 * falls through to the ordinary stuck path — repeating the same sentence at
 * someone indefinitely helps nobody and is not an assessment.
 */
export const MAX_LANGUAGE_RETRIES_PER_QUESTION = 1;

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
