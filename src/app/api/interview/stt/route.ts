import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { resolveInterviewMemberId } from "@/features/interview/provider";
import { checkLanguage } from "@/features/interview/language-gate";
import {
  isSttConfigured,
  transcribeAnswer,
} from "@/features/interview/voice";
import {
  audioFilenameFor,
  rejectAudioUpload,
  safetyIdentifierFor,
} from "@/features/interview/voice-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max execution on Vercel

/**
 * Speech → text for one interview answer.
 *
 * A route handler rather than a Server Action because Server Actions are a poor
 * fit for binary uploads. The security posture is the same as the actions':
 * the member is resolved from the session and never from the payload.
 *
 * What this endpoint deliberately does NOT do is submit the answer. It returns
 * text to the client, which then calls `submitInterviewAnswerAction` exactly as
 * the text runner does — so a spoken answer and a typed one traverse identical
 * validation, identical state guards and identical scoring.
 */
export async function POST(request: Request) {
  if (!isSttConfigured()) {
    return NextResponse.json(
      { ok: false, message: "Voice is not configured." },
      { status: 503 },
    );
  }

  // Auth BEFORE reading the body: an unauthenticated request must not be able
  // to make the server buffer eight megabytes.
  const memberId = await resolveInterviewMemberId();
  if (!memberId) {
    return NextResponse.json(
      { ok: false, message: "Enrollment required." },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Malformed upload." },
      { status: 400 },
    );
  }

  const file = form.get("audio");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { ok: false, message: "No audio was uploaded." },
      { status: 400 },
    );
  }

  const rejection = rejectAudioUpload(file.size, file.type);
  if (rejection === "EMPTY" || rejection === "TOO_LARGE") {
    return NextResponse.json(
      { ok: false, message: "That recording could not be accepted." },
      { status: 413 },
    );
  }
  if (rejection === "UNSUPPORTED_TYPE") {
    return NextResponse.json(
      { ok: false, message: "Unsupported audio format." },
      { status: 415 },
    );
  }

  // What the provider will actually see. Logged because "Invalid file format"
  // is reported against the FILENAME and the BYTES, neither of which is visible
  // from the browser error.
  const filename = audioFilenameFor(file.type);
  const head = Buffer.from(await file.slice(0, 8).arrayBuffer()).toString("hex");
  // A WebM that does not begin with EBML magic is headless: the provider will
  // reject it as "Invalid file format" after we have paid for the round trip,
  // and the candidate sees an opaque 502. Catch it here and say what it is.
  if (filename.endsWith(".webm") && !head.startsWith("1a45dfa3")) {
    logger.error("[interview/stt] headless container", {
      filename,
      bytes: file.size,
      head8: head,
    });
    return NextResponse.json(
      {
        ok: false,
        message:
          "That recording was incomplete. Please record your answer again.",
      },
      { status: 422 },
    );
  }

  logger.info("[interview/stt] upload", {
    reportedType: file.type || "(none)",
    filename,
    bytes: file.size,
    // 1a45dfa3 is the EBML magic every valid WebM starts with. Anything else
    // means the container is not what the filename claims.
    head8: head,
    looksWebm: head.startsWith("1a45dfa3"),
  });

  const sttStartedMs = Date.now();
  const result = await transcribeAnswer(
    file,
    filename,
    safetyIdentifierFor(memberId),
  );
  const sttMs = Date.now() - sttStartedMs;

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.message },
      { status: result.status },
    );
  }

  logger.info("[interview/stt] transcribed", {
    memberId,
    bytes: file.size,
    chars: result.data.text.length,
    // The first of the three sequential legs in a turn. Logged so the slow one
    // can be identified from a real interview rather than guessed at.
    sttMs,
  });

  // The English-only gate sits HERE: after transcription, before the text is
  // ever handed to the agent. Everything downstream — evidence, routing,
  // scoring, the report — stays unaware that language checking exists.
  const language = checkLanguage(result.data.text, result.data.language);
  if (!language.ok) {
    logger.info("[interview/stt] non-English answer", {
      memberId,
      reason: language.reason,
      nonLatinRatio: Number(language.nonLatinRatio.toFixed(2)),
      detected: result.data.language ?? "unknown",
    });
  }

  return NextResponse.json({
    ok: true,
    data: { text: result.data.text, english: language.ok },
  });
}
