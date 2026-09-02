import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { LANGUAGE_RETRY_LINE } from "@/features/interview/language-gate";
import {
  MOVING_ON_LINE,
  TIME_UP_LINE,
  RETRY_LINE,
  WAITING_LINE,
  roomLineFor,
  repeatLine,
  type RoomLineKind,
} from "@/features/interview/room-lines";
import { getCurrentQuestion } from "@/features/interview/state";
import type {
  InterviewPlan,
  InterviewState,
} from "@/features/interview/types";

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
const DEEPGRAM_TRANSCRIBE_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak";

/**
 * Deepgram's voice, when Deepgram is serving speech.
 *
 * `thalia` is the Aura-2 voice closest to the register the interview is trying
 * to hold: even, unhurried, and without the presenter lilt most synthetic
 * voices reach for. Overridable without a deploy, like the OpenAI voice.
 */
const DEEPGRAM_TTS_MODEL =
  process.env.INTERVIEW_DEEPGRAM_TTS_MODEL ?? "aura-2-thalia-en";

/**
 * WHICH INTERVIEW IS ASKING.
 *
 * This parameter exists because the two interviews share every line of speech
 * transport and must NOT share the decision about who provides it. The mock
 * platform is a practice conversation where a faster, more natural vendor is a
 * straightforward win. The cohort interview is a once-per-lifetime graded
 * credential, and changing the voice a candidate is assessed by — or the
 * transcriber their evidence is extracted from — is a product decision about
 * that credential, not a side effect of improving practice.
 *
 * Before this existed, `INTERVIEW_TTS_PROVIDER=deepgram` silently switched the
 * graded interview to a different voice, because `ttsVendor()` read one global
 * and both routes called it. That is exactly the implicit coupling this makes
 * impossible: every entry point now states which interview it is serving, and
 * the compiler requires it.
 */
export type VoiceSurface = "cohort" | "platform";

/**
 * The configured vendor override for one surface, or "" for none.
 *
 * SEPARATE ENVIRONMENT VARIABLES PER SURFACE, deliberately, rather than one
 * variable plus a code branch. A single variable cannot express "Deepgram for
 * practice, unchanged for the graded interview", which is the actual operating
 * requirement — and an operator reading the environment can see which interview
 * each setting governs without reading this file.
 *
 * The cohort variables are UNSET by default, and unset means the behaviour that
 * predates all of this: OpenAI when its key is present, Groq otherwise. So the
 * graded interview keeps its voice unless someone deliberately changes it.
 */
function preferredVendor(kind: "stt" | "tts", surface: VoiceSurface): string {
  const raw =
    surface === "platform"
      ? kind === "stt"
        ? process.env.INTERVIEW_STT_PROVIDER
        : process.env.INTERVIEW_TTS_PROVIDER
      : kind === "stt"
        ? process.env.COHORT_INTERVIEW_STT_PROVIDER
        : process.env.COHORT_INTERVIEW_TTS_PROVIDER;
  return raw?.trim().toLowerCase() ?? "";
}

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
type SpeechVendor = { name: "openai" | "groq" | "deepgram"; apiKey: string };

function sttVendor(surface: VoiceSurface): SpeechVendor | null {
  if (preferredVendor("stt", surface) === "deepgram" && process.env.DEEPGRAM_API_KEY) {
    return { name: "deepgram", apiKey: process.env.DEEPGRAM_API_KEY };
  }
  if (preferredVendor("stt", surface) === "groq" && process.env.GROQ_API_KEY) {
    return { name: "groq", apiKey: process.env.GROQ_API_KEY };
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: "openai", apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.GROQ_API_KEY) {
    return { name: "groq", apiKey: process.env.GROQ_API_KEY };
  }
  return null;
}

function ttsVendor(surface: VoiceSurface): SpeechVendor | null {
  if (preferredVendor("tts", surface) === "deepgram" && process.env.DEEPGRAM_API_KEY) {
    return { name: "deepgram", apiKey: process.env.DEEPGRAM_API_KEY };
  }
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

/**
 * Wall-clock ceiling on either upstream call.
 *
 * Two minutes, not thirty seconds. A candidate may answer for two or three
 * minutes, and transcribing that much audio takes materially longer than
 * transcribing the five-second microphone check the old value was sized for.
 * A timeout here surfaces as a 500 and loses a real answer.
 */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Transcription gets its own, much longer budget.
 *
 * Synthesis time depends on one short interviewer line, so 30s is generous.
 * Transcription time scales with how long the CANDIDATE talked: a three-minute
 * answer is a multi-megabyte upload followed by a proportionally longer
 * transcription. Sharing the 30s ceiling meant that the better someone
 * answered, the more likely their answer was thrown away — which is the exact
 * opposite of what an assessment should do.
 */
const TRANSCRIBE_TIMEOUT_MS = 180_000;

/**
 * Spelling bias for the transcriber.
 *
 * Both OpenAI and Groq accept a `prompt` that seeds the decoder's context. It
 * does NOT tell the model what was said — it tells it how these words are
 * spelled when it hears them, which is the difference between an evidence
 * checklist matching "RAG" and matching "rag". Kept to names and terms that
 * actually appear in this cohort's curriculum; padding it with generic English
 * would dilute the bias rather than strengthen it.
 */
const TRANSCRIPTION_VOCABULARY_HINT =
  "A technical interview about AI engineering. Likely terms: LLM, RAG, " +
  "retrieval-augmented generation, embeddings, vector database, Pinecone, " +
  "Chroma, FAISS, LangChain, LlamaIndex, Ollama, Hugging Face, OpenAI, " +
  "Anthropic, Claude, GPT-4o, Gemini, fine-tuning, LoRA, quantization, " +
  "prompt engineering, few-shot, chain of thought, tokens, temperature, " +
  "context window, hallucination, agent, tool calling, MCP, API key, " +
  "Streamlit, FastAPI, Next.js, Python, Postgres, Prisma, Docker, Vercel.";

export {
  ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  audioFilenameFor,
  rejectAudioUpload,
  safetyIdentifierFor,
} from "@/features/interview/voice-contract";

/** Speech-to-text is available. The interview can hear the candidate. */
export function isSttConfigured(surface: VoiceSurface): boolean {
  return sttVendor(surface) !== null;
}

/** Server-side speech synthesis is available. */
export function isTtsConfigured(surface: VoiceSurface): boolean {
  return ttsVendor(surface) !== null;
}

/** Kept for callers that only ask "is voice usable at all". */
export function isVoiceConfigured(surface: VoiceSurface): boolean {
  return isSttConfigured(surface);
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
  surface: VoiceSurface,
): Promise<VoiceResult<{ text: string; language: string | null }>> {
  const vendor = sttVendor(surface);
  if (!vendor) {
    return { ok: false, status: 503, message: "Voice is not configured." };
  }

  if (vendor.name === "deepgram") {
    return transcribeViaDeepgram(audio, vendor.apiKey);
  }

  // whisper-1 on OpenAI, not gpt-4o-transcribe. Two reasons, both learned the
  // hard way:
  //
  //   1. FORMAT. The browser sends `audio/webm;codecs=opus`, which the whisper
  //      endpoints accept and the gpt-4o transcribe models reject as "Audio
  //      file might be corrupted or unsupported" — surfacing as a 502 and a
  //      mic check that could never pass. The same audio transcribed fine on
  //      Groq's whisper the whole time, which is what isolated it to the model.
  //   2. LANGUAGE. Only whisper supports `verbose_json`, which carries the
  //      detected language the English-only gate prefers. On a gpt-4o model the
  //      gate silently degrades to its script heuristic.
  const model =
    process.env.INTERVIEW_STT_MODEL ??
    (vendor.name === "groq" ? "whisper-large-v3" : "whisper-1");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);

  // `verbose_json` is what carries the DETECTED LANGUAGE, which the English-only
  // gate prefers over any test run on the transcript text. Only the Whisper
  // family supports it: OpenAI's gpt-4o-* transcribe models accept `json` and
  // `text` only, and sending verbose_json to them is a 400. When it is not
  // available the gate falls back to its script check.
  const supportsVerbose = /whisper/i.test(model);
  if (supportsVerbose) form.append("response_format", "verbose_json");
  // Removed the hardcoded language hint. When 'language' is set to 'en', Whisper
  // forces non-English audio into English words, causing severe hallucinations.
  // Omitting this allows it to auto-detect the spoken language (e.g. Hindi) and
  // correctly transcribe or translate it.

  // Greedy decoding. Transcription is not a place for sampling: the default
  // temperature lets the model "improve" an indistinct phrase into a fluent one,
  // which is how a hesitant answer comes back as words the candidate never said.
  form.append("temperature", "0");

  // A vocabulary hint, not a language hint — this is the one lever that reliably
  // improves accuracy on this audio. These answers are Indian-accented English
  // full of tool and model names that a general transcriber mangles into
  // ordinary words ("Ollama" → "a llama", "LangChain" → "language"), and a
  // mangled tool name is exactly the token the evidence checklist is looking
  // for. The prompt biases spelling only; it never adds content.
  form.append("prompt", TRANSCRIPTION_VOCABULARY_HINT);

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
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
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

    const data = (await res.json()) as {
      text?: unknown;
      language?: unknown;
    };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    const language =
      typeof data.language === "string" && data.language.trim().length > 0
        ? data.language.trim()
        : null;

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

    return { ok: true, data: { text, language } };
  } catch (error) {
    logger.error("[interview/stt] request errored", { error: String(error) });
    return {
      ok: false,
      status: 500,
      message: "Could not transcribe that recording.",
    };
  }
}

/**
 * Transcription via Deepgram Nova-3.
 *
 * A SEPARATE FUNCTION RATHER THAN A BRANCH inside the multipart path, because
 * the request shape is genuinely different: Deepgram takes the raw audio as the
 * body with a content type, not a `FormData` file part, and everything the
 * OpenAI path expresses as form fields is a query parameter here. Threading a
 * discriminator through the existing builder would leave a function where half
 * the fields apply to half the vendors.
 *
 * WHY NOVA-3 IS PREFERRED. Measured on this project's own audio against
 * `whisper-1`: same transcript on the technical vocabulary that matters, at a
 * fraction of the round trip, because Whisper is batch-only and Nova-3 is not.
 * The candidate is waiting through this leg, and it was the second largest
 * component of the gap after buffered speech synthesis.
 *
 * `keyterm` replaces the OpenAI `prompt` vocabulary hint and is stronger: it
 * biases the decoder toward exact spellings rather than seeding its context.
 * That is the difference between an evidence checklist matching "RAG" and
 * matching "rag", or between "Ollama" and "a llama".
 */
async function transcribeViaDeepgram(
  audio: Blob,
  apiKey: string,
): Promise<VoiceResult<{ text: string; language: string | null }>> {
  const model = process.env.INTERVIEW_DEEPGRAM_STT_MODEL ?? "nova-3";

  const params = new URLSearchParams({
    model,
    smart_format: "true",
    punctuate: "true",
    // Detected language feeds the SAME English gate the Whisper path feeds.
    // Deepgram reports an ISO-639-1 code, which `checkLanguage` already accepts
    // alongside Whisper's language names — so the gate needs no vendor
    // awareness and keeps behaving identically.
    detect_language: "true",
  });
  for (const term of DEEPGRAM_KEYTERMS) params.append("keyterm", term);

  try {
    const res = await fetch(`${DEEPGRAM_TRANSCRIBE_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audio.type || "audio/webm",
      },
      body: audio,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("[interview/stt] transcription failed", {
        vendor: "deepgram",
        status: res.status,
        body: body.slice(0, 400),
      });
      return {
        ok: false,
        status: 502,
        message: "Could not transcribe that recording.",
      };
    }

    const data = (await res.json()) as {
      results?: {
        channels?: {
          alternatives?: { transcript?: string }[];
          detected_language?: string;
        }[];
      };
      metadata?: { duration?: number };
    };

    const channel = data.results?.channels?.[0];
    const text = (channel?.alternatives?.[0]?.transcript ?? "").trim();
    const language = channel?.detected_language?.trim() || null;

    // Same contract as the Whisper path: an empty transcript is a real outcome
    // (silence, a muted mic, a click) and is reported rather than submitted, so
    // an empty answer never spends one of the candidate's turns.
    if (text.length === 0) {
      return {
        ok: false,
        status: 422,
        message: "No speech was detected. Try recording again.",
      };
    }

    return { ok: true, data: { text, language } };
  } catch (error) {
    logger.error("[interview/stt] request errored", {
      vendor: "deepgram",
      error: String(error),
    });
    return {
      ok: false,
      status: 500,
      message: "Could not transcribe that recording.",
    };
  }
}

/**
 * Exact spellings to bias the decoder toward.
 *
 * Derived from `TRANSCRIPTION_VOCABULARY_HINT` above, but as discrete terms
 * because that is the shape Deepgram's `keyterm` takes. Kept to names that
 * actually appear in this curriculum: padding the list with ordinary English
 * dilutes the bias rather than strengthening it.
 */
const DEEPGRAM_KEYTERMS = [
  "LLM",
  "RAG",
  "retrieval-augmented generation",
  "embeddings",
  "vector database",
  "Pinecone",
  "Chroma",
  "FAISS",
  "LangChain",
  "LlamaIndex",
  "Ollama",
  "Hugging Face",
  "Anthropic",
  "Claude",
  "GPT-4o",
  "Gemini",
  "fine-tuning",
  "LoRA",
  "quantization",
  "chunking",
  "few-shot",
  "chain of thought",
  "context window",
  "hallucination",
  "tool calling",
  "MCP",
  "Streamlit",
  "FastAPI",
  "Next.js",
  "Postgres",
  "Prisma",
  "Docker",
  "Vercel",
];

/* ------------------------------------------------------------------ TTS */

/**
 * The line to speak, composed from the SERVER's own view of the interview.
 *
 * This is why the TTS route takes an interview id and a KIND rather than text.
 * If a client could post arbitrary text to be synthesized, the endpoint would be
 * a free text-to-speech service attached to a paid API key, reachable by any
 * signed-in member. Every branch below reads from the database or from a fixed
 * constant, so the only thing anyone can make it say is something this interview
 * would have said to them.
 *
 * `latest` is the agent's most recent line. The other three are the lines the
 * ROOM composes in reaction to the microphone (see `room-lines.ts`) and which
 * therefore never enter the persisted transcript — asking for `latest` while one
 * of those is on screen is exactly the bug that made a silent candidate hear the
 * interview restart from the greeting.
 */
export async function resolveSpeakableLine(
  interviewId: string,
  memberId: string,
  kind: RoomLineKind = "latest",
  /**
   * Which authored wording of a repeating room line to speak. A number, never
   * text — see `roomLineFor`. The room sends the same value it displayed, so
   * the candidate hears the sentence they are reading.
   */
  variant = 0,
): Promise<VoiceResult<{ text: string }>> {
  if (kind === "language") {
    return { ok: true, data: { text: LANGUAGE_RETRY_LINE } };
  }
  if (kind === "time_up") {
    return { ok: true, data: { text: roomLineFor("time_up", variant) } };
  }
  if (kind === "moving_on") {
    return { ok: true, data: { text: roomLineFor("moving_on", variant) } };
  }
  // A short prompt, not a restatement: the question was asked seconds ago and
  // is still on screen. Composed here like the others, so the client still
  // cannot choose what the interviewer says.
  if (kind === "retry") {
    return { ok: true, data: { text: roomLineFor("retry", variant) } };
  }
  if (kind === "waiting") {
    return { ok: true, data: { text: roomLineFor("waiting", variant) } };
  }
  if (kind === "thinking") {
    return { ok: true, data: { text: roomLineFor("thinking", variant) } };
  }

  const row = await prisma.generalInterview.findFirst({
    where: { id: interviewId, memberId, status: "IN_PROGRESS" },
    select: { plan: true, state: true },
  });

  if (!row?.state) {
    return { ok: false, status: 404, message: "No interview in progress." };
  }

  const state = row.state as unknown as InterviewState;

  if (kind === "repeat") {
    // The question the SERVER has on the floor — not one the client named. A
    // stale client therefore hears the current question restated rather than an
    // old one, which is the correct outcome either way.
    const plan = row.plan as unknown as InterviewPlan;
    const question = getCurrentQuestion(plan, state);
    if (!question) {
      return { ok: false, status: 404, message: "No question is open." };
    }
    const text = repeatLine(question.spokenText ?? question.text);
    return { ok: true, data: { text: text.slice(0, 4000) } };
  }

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
/**
 * The delivery instruction sent with every synthesized line.
 *
 * Content is fixed upstream; this only asks for the register. Supported by
 * `gpt-4o-mini-tts`, ignored by the older `tts-1` models and by Deepgram, so it
 * is safe to send on any path.
 */
const SPEECH_INSTRUCTIONS =
  "You are a technical interviewer talking with a candidate. Calm, warm and professional — a senior engineer who is genuinely curious, not a presenter or a narrator. Conversational pace, slightly unhurried, with brief natural pauses at commas and between sentences. Never sound enthusiastic, never sound flat, and do not emphasise words for effect.";

/** Builds the upstream synthesis request for whichever vendor is serving. */
function speechRequest(
  vendor: SpeechVendor,
  text: string,
  safetyIdentifier: string,
): { url: string; init: RequestInit; model: string } {
  if (vendor.name === "deepgram") {
    // `encoding=mp3` so the browser can play the bytes as they arrive, exactly
    // as it does for the OpenAI path. Deepgram streams the response by default,
    // which is the entire reason this vendor is preferred here.
    const url = `${DEEPGRAM_SPEAK_URL}?model=${encodeURIComponent(DEEPGRAM_TTS_MODEL)}&encoding=mp3`;
    return {
      url,
      model: DEEPGRAM_TTS_MODEL,
      init: {
        method: "POST",
        headers: {
          Authorization: `Token ${vendor.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    };
  }

  const model =
    process.env.INTERVIEW_TTS_MODEL ??
    (vendor.name === "groq" ? "canopylabs/orpheus-v1-english" : "gpt-4o-mini-tts");

  return {
    url: vendor.name === "groq" ? GROQ_SPEECH_URL : OPENAI_SPEECH_URL,
    model,
    init: {
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
        instructions: SPEECH_INSTRUCTIONS,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  };
}

/**
 * Synthesizes one line and returns the audio AS A STREAM.
 *
 * THE POINT OF THIS FUNCTION. `synthesizeLine` below does
 * `await res.arrayBuffer()`, and its caller then sets `Content-Length` and
 * returns the whole body, and the browser then does `await res.blob()` before
 * it will play anything. Three full buffers in a row, on the leg the candidate
 * experiences as silence: time-to-first-audio was the ENTIRE synthesis plus the
 * entire download, measured at 3.0-3.8s against OpenAI and unchanged by how
 * short the line was.
 *
 * Returning `res.body` untouched lets the bytes travel from the vendor to the
 * speaker without ever being assembled, so the interviewer starts talking at
 * first-byte instead of at last-byte. Nothing else about the request changes.
 *
 * `synthesizeLine` is deliberately KEPT rather than reimplemented on top of
 * this: the cohort route uses it, it is a graded once-per-lifetime interview,
 * and it should not inherit a transport change as a side effect of a mock
 * interview improvement.
 */
export async function synthesizeLineStream(
  text: string,
  safetyIdentifier: string,
  surface: VoiceSurface,
): Promise<
  VoiceResult<{
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    vendor: string;
    model: string;
    /** Request sent to first byte available. The number worth optimising. */
    ttfbMs: number;
  }>
> {
  const vendor = ttsVendor(surface);
  if (!vendor) {
    return {
      ok: false,
      status: 503,
      message: "Server speech synthesis is not configured.",
    };
  }

  const { url, init, model } = speechRequest(vendor, text, safetyIdentifier);
  const startedMs = Date.now();

  try {
    const res = await fetch(url, init);
    const ttfbMs = Date.now() - startedMs;

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      logger.error("[interview/tts] synthesis failed", {
        vendor: vendor.name,
        model,
        status: res.status,
        // The actual upstream reason, never collapsed into the candidate-facing
        // message. A 429 and a bad model name need different fixes.
        body: body.slice(0, 400),
      });
      return { ok: false, status: 502, message: "Could not play that question." };
    }

    return {
      ok: true,
      data: {
        stream: res.body,
        contentType: "audio/mpeg",
        vendor: vendor.name,
        model,
        ttfbMs,
      },
    };
  } catch (error) {
    logger.error("[interview/tts] request errored", {
      vendor: vendor.name,
      model,
      error: String(error),
    });
    return { ok: false, status: 500, message: "Could not play that question." };
  }
}

export async function synthesizeLine(
  text: string,
  safetyIdentifier: string,
  surface: VoiceSurface,
): Promise<VoiceResult<{ audio: ArrayBuffer; contentType: string }>> {
  const vendor = ttsVendor(surface);
  if (!vendor) {
    return {
      ok: false,
      status: 503,
      message: "Server speech synthesis is not configured.",
    };
  }

  // Shares the request builder with the streaming path, so the two can never
  // disagree about which vendor, model, voice or register a line is spoken in.
  // The ONLY difference between them is whether the body is assembled here.
  const { url, init, model } = speechRequest(vendor, text, safetyIdentifier);

  try {
    const res = await fetch(url, init);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("[interview/tts] synthesis failed", {
        vendor: vendor.name,
        model,
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
    logger.error("[interview/tts] request errored", {
      vendor: vendor.name,
      model,
      error: String(error),
    });
    return { ok: false, status: 500, message: "Could not play that question." };
  }
}
