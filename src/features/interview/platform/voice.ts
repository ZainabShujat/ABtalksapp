import "server-only";
import { prisma } from "@/lib/db";
import { LANGUAGE_RETRY_LINE } from "@/features/interview/language-gate";
import { repeatLine, roomLineFor } from "@/features/interview/room-lines";
import type { RoomLineKind } from "@/features/interview/room-lines";
import { getCurrentQuestion } from "@/features/interview/state";
import type { InterviewPlan, InterviewState } from "@/features/interview/types";

/**
 * Which line the interviewer speaks next, for an interview-platform attempt.
 *
 * THE ONLY PART OF THE VOICE STACK THAT IS NOT ALREADY SHARED. `voice.ts` owns
 * transcription and synthesis, and both are transport — they take audio or text
 * and know nothing about whose interview it is, so the platform reuses them
 * unchanged. What could not be reused is `resolveSpeakableLine`, because it
 * reads `prisma.generalInterview`: a cohort table this attempt does not live in.
 * This is that function against `MockInterview`, and nothing else.
 *
 * WHY THE ROUTE TAKES A KIND RATHER THAN TEXT. Every branch below reads from the
 * database or from an authored constant, so the endpoint can only ever voice
 * something this interview would have said to this user. If a client could post
 * arbitrary text to be synthesised, the endpoint would be a free
 * text-to-speech service attached to a paid API key, reachable by anyone with an
 * account — and mock interviews are open to every registered user, so that
 * exposure is far wider here than it is on the cohort path.
 *
 * The non-`latest` kinds exist because several of the interviewer's lines are
 * composed by the ROOM in reaction to the microphone — the nudge, the retry, the
 * move-on — and never enter the persisted transcript. Asking for "the latest
 * line" while one of those is on screen would synthesise the agent's previous
 * line instead, which on the cohort path is exactly the bug that made a silent
 * candidate hear the interview restart from the greeting.
 */

export type VoiceLineResult =
  | { ok: true; data: { text: string } }
  | { ok: false; message: string; status: number };

/** Hard ceiling on a synthesised line, matching the cohort path. */
const MAX_SPOKEN_CHARS = 4000;

export async function resolvePlatformSpeakableLine(
  attemptId: string,
  userId: string,
  kind: RoomLineKind = "latest",
  /**
   * Which authored wording of a repeating room line to speak. A number, never
   * text — the room sends back the same value it displayed, so the candidate
   * hears the sentence they are reading. Bounded by the schema and taken modulo
   * the pool inside `roomLineFor`, so it selects among our own sentences and
   * cannot introduce one.
   */
  variant = 0,
): Promise<VoiceLineResult> {
  // Authored constants. No database read needed, and deliberately checked
  // before the query so a room line still speaks if the attempt has closed
  // underneath the candidate.
  if (kind === "language") {
    return { ok: true, data: { text: LANGUAGE_RETRY_LINE } };
  }
  if (
    kind === "time_up" ||
    kind === "moving_on" ||
    kind === "retry" ||
    kind === "waiting" ||
    kind === "noisy_room"
  ) {
    return { ok: true, data: { text: roomLineFor(kind, variant) } };
  }

  // `plan` is a large JSON blob and ONLY the "repeat" branch reads it. Selecting
  // it unconditionally would pull that payload out of the database on every
  // spoken line, to be discarded — one avoidable transfer per turn, on the leg
  // the candidate is actively waiting through.
  const needsPlan = kind === "repeat";
  const row = await prisma.mockInterview.findFirst({
    // Ownership is in the WHERE clause: another user's attempt id is
    // indistinguishable from one that does not exist.
    where: { id: attemptId, userId, status: "IN_PROGRESS" },
    select: { plan: needsPlan, state: true },
  });

  if (!row?.state) {
    return { ok: false, status: 404, message: "No interview in progress." };
  }

  const state = row.state as unknown as InterviewState;

  if (kind === "repeat") {
    // The question the SERVER has on the floor, not one the client named. A
    // stale client therefore hears the current question restated rather than an
    // old one, which is the correct outcome either way.
    const plan = row.plan as unknown as InterviewPlan;
    const question = getCurrentQuestion(plan, state);
    if (!question) {
      return { ok: false, status: 404, message: "No question is open." };
    }
    const text = repeatLine(question.spokenText ?? question.text);
    return { ok: true, data: { text: text.slice(0, MAX_SPOKEN_CHARS) } };
  }

  // "latest": the agent's most recent line, from the persisted transcript.
  const line = [...(state.transcript ?? [])]
    .reverse()
    .find((l) => l.role === "interviewer");

  if (!line || line.text.trim().length === 0) {
    return { ok: false, status: 404, message: "Nothing to speak yet." };
  }

  return { ok: true, data: { text: line.text.slice(0, MAX_SPOKEN_CHARS) } };
}
