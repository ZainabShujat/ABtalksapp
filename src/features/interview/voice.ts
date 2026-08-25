import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { InterviewState } from "@/features/interview/types";

/**
 * Speech in and speech out. Transport only.
 *
 * The interview brain is deliberately untouched by this file. A spoken answer
 * becomes text here and then travels the exact path a typed answer travels —
 * same Server Action, same graph, same policy, same evidence. That is the whole
 * design: voice must not become a second interview implementation that drifts
 * from the first.
 *
 * Why turn-based rather than the Realtime API that the legacy exit interview
 * uses: Realtime hands the conversation to the model. It would decide what to
 * ask, when to follow up and when to stop — bypassing the question bank, the
 * depth ladder and `policy.ts`, which are the things that make this interview
 * comparable between candidates. Realtime is the right tool for a chat; it is
 * the wrong tool for an assessment.
 */

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech";

/**
 * The interviewer's voice.
 *
 * `ash` over the `alloy` default: alloy reads evenly but flat, which lands as
 * a narrator reading questions aloud. `ash` is steadier and warmer at the same
 * pace — closer to a senior engineer asking, which is the register the whole
 * interview is trying to hold. Overridable per environment without a deploy.
 */
const SPEECH_VOICE = process.env.INTERVIEW_TTS_VOICE ?? "ash";

/**
 * Which vendor serves speech.
 *
 * OpenAI when its key is present; otherwise Groq, which hosts Whisper for
 * transcription. Two vendors rather than one because this project has a working
 * Groq key and no OpenAI key, and an interview that cannot hear the candidate
 * is not a voice interview.
 */
type SpeechVendor = { name: "openai" | "groq"; apiKey: string };

function sttVendor(): SpeechVendor | null {
  if (process.env.OPENAI_API_KEY) {
    return { name: "openai", apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.GROQ_API_KEY) {
    return { name: "groq", apiKey: process.env.GROQ_API_KEY };
  }
  return null;
}

function ttsVendor(): SpeechVendor | null {
  if (process.env.OPENAI_API_KEY) {
    return { name: "openai", apiKey: process.env.OPENAI_API_KEY };
  }
  // Groq hosts a TTS model, but it requires an org admin to accept the model
  // terms in the Groq console. Until that happens this returns null and the
  // route reports "not configured", which the client answers with the
  // browser's own speech synthesis rather than silence.
  if (process.env.GROQ_API_KEY && process.env.INTERVIEW_TTS_MODEL) {
    return { name: "groq", apiKey: process.env.GROQ_API_KEY };
  }
  return null;
}

/** Wall-clock ceiling on either upstream call. */
const REQUEST_TIMEOUT_MS = 30_000;

export {
  ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  audioFilenameFor,
  rejectAudioUpload,
  safetyIdentifierFor,
} from "@/features/interview/voice-contract";

/** Speech-to-text is available. The interview can hear the candidate. */
export function isSttConfigured(): boolean {
  return sttVendor() !== null;
}

/** Server-side speech synthesis is available. */
export function isTtsConfigured(): boolean {
  return ttsVendor() !== null;
}

/** Kept for callers that only ask "is voice usable at all". */
export function isVoiceConfigured(): boolean {
  return isSttConfigured();
}

export type VoiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status: number };

/* ------------------------------------------------------------------ STT */

/**
 * Transcribes one recorded answer.
 *
 * Returns text and nothing else. In particular it does NOT decide whether the
 * answer was good, on topic, or complete — that is the graph's job, reached
 * through the same Server Action a typed answer uses.
 */
export async function transcribeAnswer(
  audio: Blob,
  filename: string,
  safetyIdentifier: string,
): Promise<VoiceResult<{ text: string }>> {
  const vendor = sttVendor();
  if (!vendor) {
    return { ok: false, status: 503, message: "Voice is not configured." };
  }

  const model =
    process.env.INTERVIEW_STT_MODEL ??
    (vendor.name === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  // A hint, not a restriction: candidates are Indian professionals speaking
  // English, and naming the language cuts spurious language detection on short
  // or noisy clips.
  form.append("language", "en");

  try {
    const res = await fetch(
      vendor.name === "groq" ? GROQ_TRANSCRIBE_URL : OPENAI_TRANSCRIBE_URL,
      {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vendor.apiKey}`,
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("[interview/stt] transcription failed", {
        vendor: vendor.name,
        status: res.status,
        body: body.slice(0, 400),
      });
      return {
        ok: false,
        status: 502,
        message: "Could not transcribe that recording.",
      };
    }

    const data = (await res.json()) as { text?: unknown };
    const text = typeof data.text === "string" ? data.text.trim() : "";

    // An empty transcript is a real outcome — silence, a muted mic, a click.
    // It is reported as such rather than sent onward, because submitting an
    // empty answer would spend one of the candidate's turns on nothing.
    if (text.length === 0) {
      return {
        ok: false,
        status: 422,
        message: "No speech was detected. Try recording again.",
      };
    }

    return { ok: true, data: { text } };
  } catch (error) {
    logger.error("[interview/stt] request errored", { error: String(error) });
    return {
      ok: false,
      status: 500,
      message: "Could not transcribe that recording.",
    };
  }
}

/* ------------------------------------------------------------------ TTS */

/**
 * The line the interviewer most recently said, read from the SERVER's own
 * transcript.
 *
 * This is why the TTS route takes an interview id and not text. If a client
 * could post arbitrary text to be synthesized, the endpoint would be a free
 * text-to-speech service attached to a paid API key, reachable by any signed-in
 * member. Reading the line from the database means the only thing anyone can
 * ever make it say is something it already said to them.
 */
export async function resolveSpeakableLine(
  interviewId: string,
  memberId: string,
): Promise<VoiceResult<{ text: string }>> {
  const row = await prisma.generalInterview.findFirst({
    where: { id: interviewId, memberId, status: "IN_PROGRESS" },
    select: { state: true },
  });

  if (!row?.state) {
    return { ok: false, status: 404, message: "No interview in progress." };
  }

  const state = row.state as unknown as InterviewState;
  const line = [...(state.transcript ?? [])]
    .reverse()
    .find((l) => l.role === "interviewer");

  if (!line || line.text.trim().length === 0) {
    return { ok: false, status: 404, message: "Nothing to speak yet." };
  }

  return { ok: true, data: { text: line.text.slice(0, 4000) } };
}

/**
 * Synthesizes one interviewer line.
 *
 * Returns the raw audio bytes for the route to stream. Failure is reported
 * rather than thrown: an interview whose audio fails must fall back to reading
 * the question on screen, not stop.
 */
export async function synthesizeLine(
  text: string,
  safetyIdentifier: string,
): Promise<VoiceResult<{ audio: ArrayBuffer; contentType: string }>> {
  const vendor = ttsVendor();
  if (!vendor) {
    return {
      ok: false,
      status: 503,
      message: "Server speech synthesis is not configured.",
    };
  }

  const model =
    process.env.INTERVIEW_TTS_MODEL ??
    (vendor.name === "groq" ? "canopylabs/orpheus-v1-english" : "gpt-4o-mini-tts");

  try {
    const res = await fetch(
      vendor.name === "groq" ? GROQ_SPEECH_URL : OPENAI_SPEECH_URL,
      {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vendor.apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        model,
        voice: SPEECH_VOICE,
        input: text,
        response_format: "mp3",
        // Delivery instruction, not content. The words are fixed upstream; this
        // only asks for the register. Supported by gpt-4o-mini-tts and ignored
        // by the older tts-1 models, so it is safe to send either way.
        instructions:
          "You are a technical interviewer talking with a candidate. Calm, warm and professional — a senior engineer who is genuinely curious, not a presenter or a narrator. Conversational pace, slightly unhurried, with brief natural pauses at commas and between sentences. Never sound enthusiastic, never sound flat, and do not emphasise words for effect.",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("[interview/tts] synthesis failed", {
        vendor: vendor.name,
        status: res.status,
        body: body.slice(0, 400),
      });
      return { ok: false, status: 502, message: "Could not play that question." };
    }

    return {
      ok: true,
      data: { audio: await res.arrayBuffer(), contentType: "audio/mpeg" },
    };
  } catch (error) {
    logger.error("[interview/tts] request errored", { error: String(error) });
    return { ok: false, status: 500, message: "Could not play that question." };
  }
}
