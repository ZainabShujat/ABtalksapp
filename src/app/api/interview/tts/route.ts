import { NextResponse } from "next/server";
import { z } from "zod";
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
 * Speaks the interviewer's most recent line.
 *
 * Note the request shape: an interview id, and NO text. The line is read from
 * the interview's own server-held transcript, so this endpoint can only ever
 * voice something the interviewer has already said to this member. Accepting
 * text would turn a paid speech API into an open text-to-speech service for
 * anyone with an account.
 */
const bodySchema = z.object({
  interviewId: z.string().min(1).max(64),
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

  const line = await resolveSpeakableLine(parsed.data.interviewId, memberId);
  if (!line.ok) {
    return NextResponse.json(
      { ok: false, message: line.message },
      { status: line.status },
    );
  }

  const audio = await synthesizeLine(
    line.data.text,
    safetyIdentifierFor(memberId),
  );
  if (!audio.ok) {
    return NextResponse.json(
      { ok: false, message: audio.message },
      { status: audio.status },
    );
  }

  return new NextResponse(audio.data.audio, {
    status: 200,
    headers: {
      "Content-Type": audio.data.contentType,
      "Content-Length": String(audio.data.audio.byteLength),
      // Interview audio is per-attempt and per-member. It must never be
      // cached by a CDN or a shared proxy.
      "Cache-Control": "no-store, private",
    },
  });
}
