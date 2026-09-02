import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { resolvePlatformUserId } from "@/features/interview/platform/provider";
import { resolvePlatformSpeakableLine } from "@/features/interview/platform/voice";
import {
  isTtsConfigured,
  safetyIdentifierFor,
  synthesizeLineStream,
} from "@/features/interview/voice";
import { recordSpan, ttsCostUsd } from "@/features/interview/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speaks one interviewer line for a mock interview attempt.
 *
 * A SEPARATE ROUTE FROM `/api/interview/tts` RATHER THAN A BRANCH INSIDE IT.
 * That route reads `prisma.generalInterview` and gates on cohort enrollment;
 * this one reads `MockInterview` and gates on being signed in. Threading a
 * discriminator through the cohort route would put a live, once-per-lifetime
 * graded credential behind every change made to serve practice. The synthesis
 * itself — `synthesizeLine` — is shared, because that part is transport.
 *
 * Note the request shape: an attempt id, a line KIND, and NO TEXT. Every line is
 * composed server-side from the attempt's own transcript, from the question the
 * server has on the floor, or from an authored constant. Accepting text would
 * turn a paid speech API into an open text-to-speech service for anyone with an
 * ABTalks account — and unlike the cohort path, that is every registered user.
 */
const bodySchema = z.object({
  /**
   * The MockInterview attempt id. Named `interviewId` on the wire, not
   * `attemptId`, because `InterviewRoom` is shared with the cohort and posts one
   * body shape for both. The room must not know which interview it is
   * conducting — that is the whole point of the injection seam.
   */
  interviewId: z.string().min(1).max(64),
  line: z
    .enum([
      "latest",
      "time_up",
      "waiting",
      "retry",
      "repeat",
      "language",
      "noisy_room",
      "moving_on",
      "thinking",
    ])
    .default("latest"),
  /**
   * Which authored wording of a repeating line to speak. Bounded here and taken
   * modulo the pool server-side, so it selects among our own sentences and
   * cannot introduce one.
   */
  variant: z.number().int().min(0).max(999).default(0),
});

export async function POST(request: Request) {
  if (!isTtsConfigured("platform")) {
    return NextResponse.json(
      { ok: false, message: "Voice is not configured." },
      { status: 503 },
    );
  }

  // Identity from the session only, and resolved before anything else is read.
  const userId = await resolvePlatformUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, message: "Please sign in to continue." },
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

  const resolveStartedMs = Date.now();
  const line = await resolvePlatformSpeakableLine(
    parsed.data.interviewId,
    userId,
    parsed.data.line,
    parsed.data.variant,
  );
  if (!line.ok) {
    return NextResponse.json(
      { ok: false, message: line.message },
      { status: line.status },
    );
  }
  const resolveMs = Date.now() - resolveStartedMs;

  const audio = await synthesizeLineStream(
    line.data.text,
    safetyIdentifierFor(userId),
    // The practice interview, so the Deepgram override applies here.
    "platform",
  );

  if (!audio.ok) {
    return NextResponse.json(
      { ok: false, message: audio.message },
      { status: audio.status },
    );
  }

  recordSpan({
    attemptId: parsed.data.interviewId,
    name: "tts_resolve",
    ms: resolveMs,
  });
  recordSpan({
    attemptId: parsed.data.interviewId,
    name: "tts_ttfb",
    ms: audio.data.ttfbMs,
    provider: audio.data.vendor,
    model: audio.data.model,
    characters: line.data.text.length,
    costUsd: ttsCostUsd(audio.data.model, line.data.text.length),
  });

  logger.info("[mock-interview/tts] speaking", {
    line: parsed.data.line,
    chars: line.data.text.length,
    vendor: audio.data.vendor,
    model: audio.data.model,
    resolveMs,
    ttfbMs: audio.data.ttfbMs,
  });

  // STREAMED, not buffered. `Content-Length` is deliberately absent: it cannot
  // be known before the last byte, and requiring it is exactly what forced the
  // whole file to be assembled before anything could be sent. The header the
  // room actually needs — the words being spoken — is available immediately,
  // so nothing is lost by streaming the body.
  return new NextResponse(audio.data.stream, {
    status: 200,
    headers: {
      "Content-Type": audio.data.contentType,
      // The exact words in the audio, so the room can show the line it is
      // actually hearing rather than the one it guessed. Base64 because header
      // values are ASCII-only and a question may contain anything.
      "X-Interview-Line": Buffer.from(line.data.text, "utf8").toString("base64"),
      "Access-Control-Expose-Headers": "X-Interview-Line",
      // Interview audio is per-attempt and per-user. It must never be cached by
      // a CDN or a shared proxy.
      "Cache-Control": "no-store, private",
      // Stops any intermediary from buffering the body to add a length header,
      // which would silently undo the whole point of this route.
      "X-Accel-Buffering": "no",
    },
  });
}
