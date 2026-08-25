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
export type RoomLineKind = "latest" | "repeat" | "language" | "moving_on";

export const ROOM_LINE_KINDS: readonly RoomLineKind[] = [
  "latest",
  "repeat",
  "language",
  "moving_on",
];

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
export const MOVING_ON_LINE =
  "That's completely fine. If you can't answer this one we'll move on.";

/**
 * What is submitted in place of speech after the second silence.
 *
 * A literal marker, never words the candidate did not say: an assessment must
 * not attribute speech to someone.
 */
export const NO_RESPONSE_ANSWER = "(no response)";
