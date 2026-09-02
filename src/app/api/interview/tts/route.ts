import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveInterviewMemberId } from "@/features/interview/provider";
import {
  isTtsConfigured,
  resolveSpeakableLine,
  safetyIdentifierFor,
  synthesizeLineStream,
} from "@/features/interview/voice";
import { recordSpan, ttsCostUsd } from "@/features/interview/telemetry";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speaks one interviewer line for a cohort interview.
 *
 * Streamed via synthesizeLineStream to eliminate buffering delay.
 */
const bodySchema = z.object({
  interviewId: z.string().min(1).max(64),
  line: z
    .enum([
      "time_up",
      "latest",
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
   * Which authored wording of a repeating line to speak. Bounded and taken
   * modulo the pool server-side, so it selects among our own sentences and
   * cannot introduce one — the no-client-text rule above still holds.
   */
  variant: z.number().int().min(0).max(999).default(0),
});

export async function POST(request: Request) {
  if (!isTtsConfigured("cohort")) {
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

  const resolveStartedMs = Date.now();
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
  const resolveMs = Date.now() - resolveStartedMs;

  const audio = await synthesizeLineStream(
    line.data.text,
    safetyIdentifierFor(memberId),
    // THE GRADED INTERVIEW. Reads the cohort-scoped variables only, which are
    // unset, so this keeps the OpenAI voice it has always used. Streaming the
    // body is a transport change and does not alter which words are spoken or
    // who speaks them.
    "cohort",
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

  logger.info("[cohort/tts] speaking", {
    line: parsed.data.line,
    chars: line.data.text.length,
    vendor: audio.data.vendor,
    model: audio.data.model,
    resolveMs,
    ttfbMs: audio.data.ttfbMs,
  });

  return new NextResponse(audio.data.stream, {
    status: 200,
    headers: {
      "Content-Type": audio.data.contentType,
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
