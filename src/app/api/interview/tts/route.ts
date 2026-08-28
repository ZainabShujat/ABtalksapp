import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { resolveInterviewMemberId } from "@/features/interview/provider";
import {
  isTtsConfigured,
  resolveSpeakableLine,
  safetyIdentifierFor,
  synthesizeLine,
} from "@/features/interview/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speaks one interviewer line.
 *
 * Note the request shape: an interview id, an optional line KIND, and NO text.
 * Every line is composed server-side — from the interview's own transcript, from
 * the question the server has on the floor, or from a fixed constant — so this
 * endpoint can only ever voice something this interview would have said to this
 * member. Accepting text would turn a paid speech API into an open
 * text-to-speech service for anyone with an account.
 *
 * The kind exists because three of the interviewer's lines are composed by the
 * ROOM in reaction to the microphone and never enter the persisted transcript.
 * Without it, asking to speak while one of those was on screen synthesized the
 * agent's last line instead — which is why a candidate who fell silent heard the
 * interview restart from the greeting.
 */
const bodySchema = z.object({
  interviewId: z.string().min(1).max(64),
  line: z.enum(["time_up", "latest", "waiting", "retry", "repeat", "language", "moving_on"]).default("latest"),
  /**
   * Which authored wording of a repeating line to speak. Bounded and taken
   * modulo the pool server-side, so it selects among our own sentences and
   * cannot introduce one — the no-client-text rule above still holds.
   */
  variant: z.number().int().min(0).max(999).default(0),
});

export async function POST(request: Request) {
  if (!isTtsConfigured()) {
    return NextResponse.json(
      { ok: false, message: "Voice is not configured." },
      { status: 503 },
    );
  }

  const memberId = await resolveInterviewMemberId();
  if (!memberId) {
    return NextResponse.json(
      { ok: false, message: "Enrollment required." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid request." },
      { status: 400 },
    );
  }

  const ttsStartedMs = Date.now();
  const line = await resolveSpeakableLine(
    parsed.data.interviewId,
    memberId,
    parsed.data.line,
    parsed.data.variant,
  );
  if (!line.ok) {
    return NextResponse.json(
      { ok: false, message: line.message },
      { status: line.status },
    );
  }

  const resolveMs = Date.now() - ttsStartedMs;
  const synthStartedMs = Date.now();
  const audio = await synthesizeLine(
    line.data.text,
    safetyIdentifierFor(memberId),
  );
  const synthMs = Date.now() - synthStartedMs;
  if (!audio.ok) {
    return NextResponse.json(
      { ok: false, message: audio.message },
      { status: audio.status },
    );
  }

  // The last of the three legs. `resolveMs` separates the database read from
  // the synthesis call, so a slow turn can be attributed to one or the other
  // instead of being reported as a single opaque number.
  logger.info("[interview/tts] spoken", {
    line: parsed.data.line,
    chars: line.data.text.length,
    bytes: audio.data.audio.byteLength,
    resolveMs,
    synthMs,
  });

  return new NextResponse(audio.data.audio, {
    status: 200,
    headers: {
      "Content-Type": audio.data.contentType,
      "Content-Length": String(audio.data.audio.byteLength),
      // The exact words in the audio, so the room can show the line it is
      // actually hearing rather than the one it guessed. Base64 because header
      // values are ASCII-only and a question may contain anything.
      "X-Interview-Line": Buffer.from(line.data.text, "utf8").toString("base64"),
      "Access-Control-Expose-Headers": "X-Interview-Line",
      // Interview audio is per-attempt and per-member. It must never be
      // cached by a CDN or a shared proxy.
      "Cache-Control": "no-store, private",
    },
  });
}
