/**
 * Interviewer lines the ROOM says, rather than the agent.
 *
 * Three of the interviewer's lines never come from a graph turn: the nudge when
 * a candidate has not spoken, the correction when an answer was not in English,
 * and the sentence that moves on after a second silence. They are reactions to
 * the microphone, not to an answer, so nothing about them is persisted by
 * `submitAnswer` and they never reach the interview transcript.
 *
 * That is precisely what broke speech. `/api/interview/tts` synthesizes the last
 * interviewer line held on the SERVER — which for these three is not the line
 * just shown, but whatever the agent last said, usually the opening greeting. So
 * a candidate who went quiet heard the interview start over.
 *
 * This module is the fix: one pure definition of each line, imported by the room
 * (to display it) and by the speech route (to synthesize it). The route still
 * refuses client-supplied text — it takes a KIND and composes the line itself
 * from the interview's own state — so the endpoint remains something that can
 * only say what this interview would have said.
 *
 * Pure on purpose: no `server-only`, no Prisma, no network. It is imported from
 * a client component.
 */

/** Which room-composed line the speech route should synthesize. */
export type RoomLineKind =
  | "latest"
  | "time_up"
  | "waiting"
  | "retry"
  | "repeat"
  | "language"
  | "noisy_room"
  | "moving_on"
  | "thinking";

export const ROOM_LINE_KINDS: readonly RoomLineKind[] = [
  "latest",
  "time_up",
  "waiting",
  "retry",
  "repeat",
  "language",
  "noisy_room",
  "moving_on",
  "thinking",
];

/**
 * Said when the candidate has not spoken since the microphone opened.
 *
 * It deliberately does NOT restate the question. The interviewer asked it a few
 * seconds earlier and it is still on screen; repeating it verbatim reads as the
 * interviewer talking twice in a row and having forgotten it just spoke. A
 * human waits a beat and says something small instead.
 *
 * The full restatement below is still used when the candidate ASKS for it — the
 * agent's own REPEAT action — where it is what was actually requested.
 */
export const WAITING_LINES = [
  "I couldn't hear you, can you speak again?",
  "Sorry, I'm not picking you up. Could you say that again?",
  "I didn't get any of that. Go ahead whenever you're ready.",
  "Nothing came through on my end. Can you try that again?",
] as const;

/** First variant. Kept so callers with no variant to hand still compile. */
export const WAITING_LINE = WAITING_LINES[0];

export const NOISY_ROOM_LINES = [
  "There is too much background noise, can you sit in a quieter room?",
  "I'm getting a lot of background noise. Is there somewhere quieter you can sit?",
  "There's quite a bit of noise coming through. Could you move somewhere quieter?",
] as const;

export const NOISY_ROOM_LINE = NOISY_ROOM_LINES[0];

/**
 * Said once when the candidate has not spoken at all since the microphone
 * opened. Silence usually means the question was missed rather than refused, so
 * the question is restated in full rather than merely referred to.
 */
export const REPEAT_PREFIX = "Sorry, you might not have caught that.";

export function repeatLine(questionText: string): string {
  const question = questionText.trim();
  return question.length > 0 ? `${REPEAT_PREFIX}\n\n${question}` : REPEAT_PREFIX;
}

/**
 * Said after a second silence on the same question. Sitting in silence is worse
 * than an unanswered question, and a candidate who cannot answer deserves to be
 * let off it rather than waited at.
 */
/**
 * Said when the answer was captured but could not be transcribed.
 *
 * A transcription failure is OUR problem, not the candidate's, so the line
 * neither blames them nor explains the machinery. What matters is that the
 * question stays open: moving on would score an unanswered question against
 * someone who did answer it.
 */
export const RETRY_LINES = [
  "Sorry, I didn't catch that clearly. Could you say it once more?",
  "That came through garbled on my side. Would you mind repeating it?",
  "I lost part of that. Could you run it by me once more?",
] as const;

export const RETRY_LINE = RETRY_LINES[0];

export const MOVING_ON_LINES = [
  "That's completely fine. If you can't answer this one we'll move on.",
  "No problem at all. Let's leave that one and keep going.",
  "That's alright. We'll skip this one and move on.",
] as const;

export const MOVING_ON_LINE = MOVING_ON_LINES[0];

/**
 * What is submitted in place of speech after the second silence.
 *
 * A literal marker, never words the candidate did not say: an assessment must
 * not attribute speech to someone.
 */
/**
 * Said when the session clock runs out.
 *
 * Framed as the interview being over, not as the candidate being cut off: they
 * kept to the time they were given, and everything they said still counts.
 */
export const TIME_UP_LINES = [
  "That's us out of time. Thanks for talking me through your work.",
  "We're at time. Thanks for walking me through all of that.",
  "That's the clock. Thanks for taking me through your work today.",
] as const;

export const TIME_UP_LINE = TIME_UP_LINES[0];

/**
 * Said while the interviewer is working out what to say next.
 *
 * WHY THIS EXISTS. Even with streamed speech and a fast transcriber there is a
 * real gap between the candidate finishing and the interviewer starting: an
 * upload, a transcription, an assessment call, and a synthesis request, none of
 * which can be removed entirely. Held in silence that gap reads as a freeze,
 * and the candidate's own instinct is to start talking again into it, which
 * makes the next turn worse.
 *
 * A person fills that space, so this does too. These are deliberately the
 * shortest lines in the file and deliberately say NOTHING about the answer:
 * anything evaluative here would be a verdict delivered before the evaluator
 * has run, and a candidate would reasonably read it as one.
 *
 * Spoken only when the gap is actually long enough to need covering — see
 * `THINKING_LINE_AFTER_MS`. A fast turn is not padded with chatter.
 */
export const THINKING_LINES = [
  "Mm.",
  "Right.",
  "Okay.",
  "Let me think about that.",
  "Give me a second.",
] as const;

export const THINKING_LINE = THINKING_LINES[0];

/**
 * How long the interviewer stays silent before saying anything at all.
 *
 * Under this, silence reads as a person taking a beat, which is what it should
 * read as. Over it, silence reads as a broken page.
 */
export const THINKING_LINE_AFTER_MS = 1_500;

/**
 * Resolves one room line to its wording.
 *
 * `variant` exists because these lines repeat WITHIN a single interview — the
 * nudge fires on every silence — and hearing the identical sentence four times
 * in fifteen minutes is the clearest possible signal that nobody is listening.
 *
 * It is a NUMBER, not text, and it is taken modulo the pool, so a client can
 * pick which authored line is spoken but can never introduce one. That keeps
 * the property the TTS route depends on: the endpoint can only voice something
 * this interview would have said. See `voice.ts:resolveSpeakableLine`.
 */
export function roomLineFor(
  kind:
    | "waiting"
    | "retry"
    | "moving_on"
    | "time_up"
    | "noisy_room"
    | "thinking",
  variant: number,
): string {
  const pool =
    kind === "waiting"
      ? WAITING_LINES
      : kind === "retry"
        ? RETRY_LINES
        : kind === "moving_on"
          ? MOVING_ON_LINES
          : kind === "time_up"
            ? TIME_UP_LINES
            : kind === "thinking"
              ? THINKING_LINES
              : NOISY_ROOM_LINES;
  const index = Number.isFinite(variant)
    ? ((Math.trunc(variant) % pool.length) + pool.length) % pool.length
    : 0;
  return pool[index]!;
}

export const NO_RESPONSE_ANSWER = "(no response)";
