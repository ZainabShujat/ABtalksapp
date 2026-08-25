"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Moon, Square, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGE_RETRY_LINE } from "@/features/interview/language-gate";
import {
  initialSilenceState,
  stepSilence,
  type SilenceState,
} from "@/features/interview/silence";
import {
  MAX_LANGUAGE_RETRIES_PER_QUESTION,
  NO_ANSWER_MS,
} from "@/features/interview/constants";
import {
  VoicePoweredOrb,
  type OrbMode,
  type OrbPalette,
} from "@/components/ui/voice-powered-orb";
import {
  abandonInterviewAction,
  finishInterviewAction,
  submitInterviewAnswerAction,
} from "@/app/actions/interview-actions";
import type {
  ClientQuestion,
  FinishInterviewData,
} from "@/features/interview/service";

/**
 * The interview room.
 *
 * A presentation layer over the existing interview system — nothing here
 * simulates an interviewer. Every candidate answer goes through
 * `submitInterviewAnswerAction`, which reaches the LangGraph agent, the depth
 * ladder and the evidence store exactly as a typed answer does. What the room
 * adds is the sense of being *in* an interview: whose turn it is, what was
 * said, and one obvious way to answer.
 *
 * Two rules shape the layout:
 *
 *   1. The transcript is the page. Controls sit in their own bar beneath it and
 *      never overlap it, because a candidate mid-thought must be able to
 *      re-read the question.
 *   2. Assessment vocabulary never reaches the screen. The system knows about
 *      ESCALATE, REDIRECT, evidence counts and scores; the candidate sees a
 *      person asking a harder question, or steering them back. Showing the
 *      machinery would turn an interview into a test being marked in public.
 */

type Turn = {
  role: "interviewer" | "candidate";
  text: string;
};

type Phase = "idle" | "listening" | "processing" | "speaking";

const ROOM_THEME_KEY = "abtalks.interviewRoomTheme";

function readStoredRoomTheme(): OrbPalette {
  try {
    const value = localStorage.getItem(ROOM_THEME_KEY);
    if (value === "dark" || value === "light") return value;
  } catch {
    // Private mode / blocked storage — stay on the default.
  }
  return "light";
}

const PHASE_COPY: Record<Phase, { label: string; hint: string }> = {
  idle: { label: "Your turn", hint: "Tap the microphone and answer out loud." },
  listening: { label: "Listening", hint: "Tap again when you have finished." },
  processing: { label: "Evaluating your answer", hint: "One moment." },
  speaking: { label: "Interviewer speaking", hint: "" },
};

/**
 * How long the room waits for server speech before falling back.
 *
 * Generous enough for a long interviewer line (a real gpt-4o-mini-tts call
 * measured ~1.9s for a two-sentence turn), short enough that a silent failure
 * does not read as the interview having frozen.
 */
const TTS_TIMEOUT_MS = 12_000;

// Turn-taking thresholds live in features/interview/constants.ts so the
// analyser, the tests and any future transport all read the same numbers.

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function InterviewRoom({
  interviewId,
  title,
  firstQuestion,
  openingPrompt,
  candidateName,
  onFinishedAction,
  onAbandonedAction,
}: {
  interviewId: string;
  title: string;
  firstQuestion: ClientQuestion;
  /**
   * What the interviewer actually SAYS first: the greeting, the framing, then
   * the question. The server composes it in `beginInterview`; this component
   * used to render `firstQuestion.text` instead, which is the bare bank
   * question — so the opening was generated and then silently discarded, and
   * every interview appeared to start mid-thought.
   */
  openingPrompt?: string;
  candidateName: string;
  onFinishedAction: (data: FinishInterviewData) => void;
  onAbandonedAction: () => void;
}) {
  const opening = openingPrompt?.trim() || firstQuestion.text;
  const [turns, setTurns] = useState<Turn[]>([
    { role: "interviewer", text: opening },
  ]);
  const [question, setQuestion] = useState<ClientQuestion | null>(firstQuestion);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micUnavailable, setMicUnavailable] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [closing, setClosing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [theme, setTheme] = useState<OrbPalette>("light");

  useEffect(() => {
    setTheme(readStoredRoomTheme());
  }, []);

  function toggleRoomTheme() {
    setTheme((current) => {
      const next: OrbPalette = current === "light" ? "dark" : "light";
      try {
        localStorage.setItem(ROOM_THEME_KEY, next);
      } catch {
        // Persistence is a convenience, not a requirement.
      }
      return next;
    });
  }
  /**
   * Progress through the CORE spine, straight from the server.
   *
   * Counted in core questions rather than turns, because follow-ups and deep
   * probes add turns without advancing the assessment — a turn-based bar would
   * tell someone on question three that they were nearly done.
   */
  const [progress, setProgress] = useState({ answered: 0, total: 0, ratio: 0 });

  /**
   * Progressive reveal of the interviewer's line, driven by TTS playback.
   *
   * `reveal.text` is the EXACT string that was sent to the speech endpoint, so
   * the transcript and the audio can never diverge; there is no second,
   * paraphrased copy anywhere. `reveal.chars` is how much of it is currently
   * visible, advanced from `audio.currentTime / audio.duration` on every frame
   * and written to state at ~15fps rather than 60 — the reader cannot perceive
   * the difference, and the transcript is not re-rendered on every frame.
   *
   * OpenAI's speech endpoint returns no word-boundary timings, so the mapping
   * is proportional to elapsed playback rather than word-accurate. It is tied
   * to real playback time, not to a fixed typing speed, so it stays aligned
   * when audio starts late or a long line takes longer to speak.
   */
  const [reveal, setReveal] = useState<{ text: string; chars: number } | null>(
    // Seeded at zero characters for the OPENING line specifically. The opening
    // is pushed into `turns` before any audio exists, so without this the whole
    // greeting flashed up complete and the voice then read it back.
    { text: opening, chars: 0 },
  );
  const revealRafRef = useRef<number | null>(null);

  /**
   * Live words, shown while the candidate is still talking.
   *
   * This is a PREVIEW ONLY. It comes from the browser's own SpeechRecognition,
   * which is fast and free but noticeably less accurate than Whisper. The
   * answer that is actually submitted and assessed is still the one Whisper
   * returns from the recorded audio, so what a candidate is graded on never
   * depends on which browser they happened to open.
   *
   * Kept out of `turns` for that reason: it is never a transcript entry, only
   * on-screen feedback that the room is hearing them.
   */
  const [livePreview, setLivePreview] = useState("");
  /** How many times we have prompted an unanswered question. Resets per turn. */
  /** Language corrections used on the question currently on the floor. */
  const languageRetriesRef = useRef(0);
  const nudgeCountRef = useRef(0);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<{ stop: () => void; abort: () => void } | null>(
    null,
  );

  /**
   * The single audio-analysis chain for the interview.
   *
   * ONE microphone stream exists (`streamRef`, opened by `startRecording` for
   * MediaRecorder). One AnalyserNode is attached to it, and its level feeds
   * BOTH the silence detector and the orb. The orb never opens a microphone of
   * its own: a second `getUserMedia` would mean a second permission prompt and
   * a second capture running beside the one being transcribed.
   *
   * `levelRef` is a ref rather than state on purpose. It updates ~60 times a
   * second; putting that in state would re-render the whole transcript on every
   * animation frame.
   */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const levelRef = useRef(0);
  const levelRafRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceRef = useRef<SilenceState>(initialSilenceState());

  const phaseRef = useRef<Phase>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const spokenRef = useRef<string | null>(null);

  /* ------------------------------------------------------------- timing */

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Keep the newest words in view. `reveal` is in the dependency list so the
  // view follows the interviewer's sentence AS it is spoken; without it the
  // text grew underneath a fixed viewport and the latest line sat behind the
  // control bar.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, phase, reveal]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [turns, phase, reveal?.chars]);

  useEffect(() => {
    return () => {
      if (levelRafRef.current !== null) cancelAnimationFrame(levelRafRef.current);
      if (revealRafRef.current !== null) cancelAnimationFrame(revealRafRef.current);
      analyserSrcRef.current?.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        void audioCtxRef.current.close();
      }
      try {
        recognitionRef.current?.abort();
      } catch {
        // Already gone.
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  /* ----------------------------------------------------- transcript reveal */

  const stopReveal = useCallback(() => {
    if (revealRafRef.current !== null) {
      cancelAnimationFrame(revealRafRef.current);
      revealRafRef.current = null;
    }
  }, []);

  /**
   * Advances the visible portion of the interviewer's line in step with the
   * audio actually playing.
   *
   * Progress comes from `audio.currentTime / audio.duration`, so it tracks real
   * playback: pauses, buffering and a slow start all keep text and speech
   * together, which a fixed typing animation would not. `duration` can be NaN
   * for a moment after `play()`, so until it is known the reveal simply holds
   * at zero rather than guessing.
   */
  const startReveal = useCallback(
    (text: string, audio: HTMLAudioElement) => {
      stopReveal();
      setReveal({ text, chars: 0 });

      let lastWritten = -1;
      const tick = () => {
        revealRafRef.current = requestAnimationFrame(tick);
        const duration = audio.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;

        const ratio = Math.min(audio.currentTime / duration, 1);
        // Slightly ahead of the audio. A reader who is a few characters in
        // front of the voice feels natural; text lagging behind feels broken.
        const chars = Math.round(text.length * Math.min(ratio * 1.06, 1));

        // ~15fps write cadence: enough to look continuous, few enough renders
        // that the transcript is not rebuilt 60 times a second.
        if (chars !== lastWritten && chars - lastWritten >= 2) {
          lastWritten = chars;
          setReveal({ text, chars });
        }
        if (ratio >= 1) stopReveal();
      };
      revealRafRef.current = requestAnimationFrame(tick);
    },
    [stopReveal],
  );

  /* -------------------------------------------------------------- voice */

  /**
   * Speaks the interviewer's most recent line.
   *
   * Server synthesis first; the browser's own voice when no speech service is
   * configured. The words are identical either way — they come from the
   * server's transcript — so the fallback is a real spoken question rather than
   * a stand-in. Silence would change the assessment: an interview you read is
   * not the interview this is meant to be.
   */
  const speak = useCallback(
    async (text: string) => {
      // Guard against speaking the same line twice in a row (React strict-mode
      // double-invoke, or a re-render). It must still release the phase: the
      // caller has already set "processing", and the `finally` below is what
      // normally clears it. Returning bare left the room stuck mid-turn with
      // the question appearing to repeat — which is exactly what it looked
      // like from the outside.
      if (spokenRef.current === text) {
        setPhase("idle");
        return;
      }
      spokenRef.current = text;
      setPhase("speaking");
      // Hide the line until audio actually starts. Otherwise the full prompt
      // sits in the transcript for the whole TTS round-trip.
      setReveal({ text, chars: 0 });

      const viaBrowser = () =>
        new Promise<void>((resolve) => {
          if (typeof window === "undefined" || !window.speechSynthesis) {
            resolve();
            return;
          }
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 0.98;
          // The browser voice exposes real character boundaries, which is more
          // accurate than the proportional estimate used for server audio.
          utterance.onboundary = (ev) => {
            if (typeof ev.charIndex === "number") {
              setReveal({ text, chars: ev.charIndex + (ev.charLength ?? 0) });
            }
          };
          utterance.onend = () => {
            setReveal({ text, chars: text.length });
            resolve();
          };
          utterance.onerror = () => {
            setReveal({ text, chars: text.length });
            resolve();
          };
          window.speechSynthesis.speak(utterance);
        });

      try {
        // Client-side ceiling as well as the server's. The server aborts its
        // upstream call at 30s, but a request that never returns at all would
        // otherwise leave the room in "speaking" forever with no question
        // audible and no way forward. Past this we stop waiting and let the
        // browser voice read the line instead.
        const res = await fetch("/api/interview/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interviewId }),
          signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
        });

        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          const audio = new Audio(url);
          audioRef.current = audio;
          await audio.play();
          startReveal(text, audio);
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
          });
          URL.revokeObjectURL(url);
        } else {
          /* browser voice fallback */
          await viaBrowser();
        }
      } catch {
        /* browser voice fallback */
        await viaBrowser();
      } finally {
        // Whatever happened, the full line ends up visible: a reader must never
        // be left with a half-sentence because audio failed midway.
        stopReveal();
        setReveal({ text, chars: text.length });
        setPhase("idle");
      }
    },
    [interviewId, startReveal, stopReveal],
  );

  /**
   * Hands the floor back automatically when the interviewer stops talking.
   *
   * Previously the candidate had to notice that speech had ended and press a
   * button, which is not how a conversation works: the other person stops, and
   * it is your turn. The microphone control stays, so anyone who wants to stop
   * or restart still can.
   *
   * Guarded on `question` so it never opens the microphone after the closing
   * line, and on `micUnavailable` so a denied permission is not retried on a
   * loop.
   */
  useEffect(() => {
    if (phase !== "idle" || !question || micUnavailable || closing) return;
    if (recorderRef.current) return;
    const id = setTimeout(() => void startRecording(), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, question, micUnavailable, closing]);

  // Speak the opening question once the room mounts.
  //
  // Deferred by a tick rather than called in the effect body: `speak` sets
  // state immediately, and doing that synchronously inside an effect triggers a
  // cascading render. The delay is imperceptible and the audio still starts
  // within the user gesture that opened the room, which is what browsers
  // require before they will play anything.
  useEffect(() => {
    const id = setTimeout(() => void speak(opening), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------- answering */

  const send = useCallback(
    async (answerText: string) => {
      const text = answerText.trim();
      if (!question) return;

      // An empty transcript is the normal result of a long pause, a very quiet
      // answer, or the recorder capturing silence. This used to `return`
      // straight out of a function the caller had already put into the
      // "processing" phase, so the room sat on "Evaluating your answer"
      // forever with no way back. Hand the turn back to the candidate instead —
      // nothing was submitted, so nothing is spent.
      if (text.length === 0) {
        setError(
          "I didn't catch that — nothing came through. Tap the microphone and try again, or type your answer.",
        );
        setPhase("idle");
        return;
      }

      setTurns((prev) => [...prev, { role: "candidate", text }]);
      setPhase("processing");
      setError(null);

      const turn = await submitInterviewAnswerAction({
        interviewId,
        questionId: question.id,
        answerText: text,
      });

      if (!turn.ok) {
        setError(turn.message);
        setPhase("idle");
        return;
      }

      // `prompt` is whatever the interviewer says next — a follow-up, a deeper
      // question, a redirect, or the next question with its acknowledgement.
      // The room does not care which; it is all just the interviewer talking.
      if (turn.data.prompt) {
        setTurns((prev) => [
          ...prev,
          { role: "interviewer", text: turn.data.prompt! },
        ]);
      }
      setQuestion(turn.data.question);
      nudgeCountRef.current = 0;
      languageRetriesRef.current = 0;
      setProgress(turn.data.progress);

      if (turn.data.finished) {
        setClosing(true);
        const finished = await finishInterviewAction({ interviewId });
        setClosing(false);
        if (finished.ok) onFinishedAction(finished.data);
        else setError(finished.message);
        return;
      }

      if (turn.data.prompt) {
        setReveal({ text: turn.data.prompt, chars: 0 });
        void speak(turn.data.prompt);
      } else setPhase("idle");
    },
    [interviewId, question, onFinishedAction, speak],
  );

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        detachAnalyser();
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        setPhase("processing");
        const form = new FormData();
        form.append("audio", blob, "answer.webm");

        try {
          const res = await fetch("/api/interview/stt", {
            method: "POST",
            body: form,
          });

          // Read as text first. The route answers with JSON on every path it
          // controls, so a non-JSON body means the request never got there —
          // a crash, a proxy, or a framework error page. Parsing blind turned
          // all of those into one useless "could not reach" message that hid
          // the status code, which made this undebuggable for anyone but the
          // person who wrote it.
          const raw = await res.text();
          let json:
            | { ok: true; data: { text: string; english?: boolean } }
            | { ok: false; message: string }
            | null = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }

          if (!json) {
            setError(
              `Transcription failed (HTTP ${res.status}). The server did not return a readable response — check the dev server log for /api/interview/stt. You can type your answer instead.`,
            );
            setPhase("idle");
            return;
          }

          if (!json.ok) {
            // The recording is lost but the turn is not spent — the candidate
            // simply answers again, by voice or by typing.
            setError(`${json.message} (HTTP ${res.status})`);
            setPhase("idle");
            return;
          }
          // Not English: ask once, keep the SAME question open, and submit
          // nothing. No evidence is recorded, no follow-up budget is spent and
          // the question index does not move — this is an input-quality retry,
          // not an answer. A second failure falls through to the normal path so
          // the interviewer cannot loop on the same sentence forever.
          if (
            json.data.english === false &&
            languageRetriesRef.current < MAX_LANGUAGE_RETRIES_PER_QUESTION
          ) {
            languageRetriesRef.current += 1;
            setTurns((prev) => [
              ...prev,
              { role: "interviewer", text: LANGUAGE_RETRY_LINE },
            ]);
            setReveal({ text: LANGUAGE_RETRY_LINE, chars: 0 });
            await speak(LANGUAGE_RETRY_LINE);
            return;
          }

          await send(json.data.text);
        } catch (err) {
          setError(
            `Could not reach the transcription service (${err instanceof Error ? err.message : "network error"
            }). You can type your answer instead.`,
          );
          setPhase("idle");
        }
      };

      // A timeslice, so audio is flushed once a second instead of being held
      // as one growing buffer released only at stop. Long answers were the
      // failure case: a single large final chunk is both more memory and more
      // to lose if anything interrupts the recording.
      recorder.start(1000);
      recorderRef.current = recorder;
      // Same stream, one analyser. Auto-stop runs the normal stop path, so the
      // captured audio goes through the existing STT pipeline unchanged.
      attachAnalyser(stream, () => stopRecording());
      startLivePreview();
      scheduleNoAnswerNudge();
      setPhase("listening");
    } catch {
      setMicUnavailable(true);
      setError("Microphone unavailable. You can type your answers instead.");
      setPhase("idle");
    }
  }

  /**
   * Attaches the ONE analyser to the microphone stream MediaRecorder is already
   * using, and runs the loop that feeds both the orb and silence detection.
   *
   * Deliberately no `getUserMedia` here: the stream is passed in. Deliberately
   * no audio constraints either — `startRecording` opens the microphone with
   * the browser's defaults (echo cancellation, noise suppression and gain
   * control ON) because transcription accuracy matters more than a livelier
   * waveform. Visualisation reads whatever speech-to-text is hearing.
   */
  function attachAnalyser(stream: MediaStream, onSilence: () => void) {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;

      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      analyserSrcRef.current = src;

      const bins = new Uint8Array(analyser.frequencyBinCount);
      hasSpokenRef.current = false;
      silenceRef.current = initialSilenceState();

      const tick = () => {
        levelRafRef.current = requestAnimationFrame(tick);
        const node = analyserRef.current;
        if (!node) return;

        node.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 0; i < bins.length; i++) {
          const v = bins[i]! / 255;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / bins.length);
        levelRef.current = rms;

        // The rule itself lives in features/interview/silence.ts as a pure
        // function, so turn-taking can be tested without a microphone. This
        // loop owns the audio; that owns the decision.
        const step = stepSilence(silenceRef.current, rms, performance.now());
        silenceRef.current = step.state;
        hasSpokenRef.current = step.state.hasSpoken;
        if (step.shouldStop) onSilence();
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {
      // No analyser is a cosmetic loss, not a functional one: the orb rests and
      // the candidate stops recording by hand, exactly as before.
    }
  }

  function detachAnalyser() {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    try {
      analyserSrcRef.current?.disconnect();
      analyserRef.current?.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        void audioCtxRef.current.close();
      }
    } catch {
      // Already torn down.
    }
    analyserSrcRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    levelRef.current = 0;
    hasSpokenRef.current = false;
  }

  /**
   * Starts the browser's speech recognition purely for on-screen feedback.
   *
   * `continuous` so it does not stop at the first pause, `interimResults` so
   * words appear while they are still being spoken. Any failure is swallowed:
   * Firefox has no support at all, and a missing preview must never stop an
   * interview whose real transcription happens server-side regardless.
   */
  function startLivePreview() {
    try {
      const w = window as unknown as {
        SpeechRecognition?: new () => never;
        webkitSpeechRecognition?: new () => never;
      };
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (!Ctor) return;

      // The DOM lib does not ship these types; the shape used here is the
      // stable part of the API that both implementations share.
      const rec = new (Ctor as unknown as new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((e: unknown) => void) | null;
        onerror: (() => void) | null;
        start: () => void;
        stop: () => void;
        abort: () => void;
      })();

      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-IN";

      let settled = "";
      rec.onresult = (event: unknown) => {
        const e = event as {
          resultIndex: number;
          results: ArrayLike<
            ArrayLike<{ transcript: string }> & { isFinal: boolean }
          >;
        };
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]!;
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) settled += text;
          else interim += text;
        }
        setLivePreview((settled + interim).trim());
      };
      rec.onerror = () => {
        // No-speech, network, aborted: all harmless for a preview.
      };

      rec.start();
      recognitionRef.current = rec;
    } catch {
      // Unsupported or blocked. The interview is unaffected.
    }
  }

  function stopLivePreview() {
    try {
      recognitionRef.current?.abort();
    } catch {
      // Already stopped.
    }
    recognitionRef.current = null;
    setLivePreview("");
  }

  function stopRecording() {
    clearNoAnswerNudge();
    stopLivePreview();
    detachAnalyser();
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  /**
   * Prompts a candidate who has not said anything since the microphone opened.
   *
   * First time: re-ask. Silence usually means the question was missed, not
   * refused, and repeating costs nothing.
   *
   * Second time: say it is fine and move on. Sitting in silence is worse than
   * an unanswered question, and the transcript records "(no response)" rather
   * than words the candidate never said — an assessment must never attribute
   * speech to someone.
   */
  function scheduleNoAnswerNudge() {
    clearNoAnswerNudge();
    nudgeTimerRef.current = setTimeout(() => {
      // Only fires if they genuinely have not spoken. `hasSpokenRef` is set by
      // the analyser the moment their level crosses the speech threshold.
      if (hasSpokenRef.current || phaseRef.current !== "listening") return;

      nudgeCountRef.current += 1;

      if (nudgeCountRef.current === 1) {
        stopRecording();
        const line = question
          ? `Sorry, you might not have caught that. ${question.text}`
          : "Sorry, you might not have caught that.";
        setTurns((prev) => [...prev, { role: "interviewer", text: line }]);
        setReveal({ text: line, chars: 0 });
        void speak(line);
        return;
      }

      stopRecording();
      const line =
        "That's completely fine. If you can't answer this one we'll move on.";
      setTurns((prev) => [...prev, { role: "interviewer", text: line }]);
      void send("(no response)");
    }, NO_ANSWER_MS);
  }

  function clearNoAnswerNudge() {
    if (nudgeTimerRef.current !== null) {
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
  }

  async function endInterview() {
    stopRecording();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();

    // Past halfway the answers already given are enough to assess, so ending
    // early SCORES the attempt instead of discarding it. Throwing away a
    // substantially complete interview served nobody: the evidence existed and
    // the candidate had earned a report. `finalizeInterview` gates on the
    // 3-minute minimum, so a session too short to be meaningful still cannot
    // produce one — in that case we fall back to abandoning.
    if (progress.total > 0 && progress.ratio >= 0.5) {
      const finished = await finishInterviewAction({ interviewId });
      if (finished.ok) {
        onFinishedAction(finished.data);
        return;
      }
    }

    await abandonInterviewAction({ interviewId });
    onAbandonedAction();
  }

  // Past the halfway mark the warning changes, because the consequence changes:
  // the attempt is spent either way, but a candidate who has answered most of
  // the spine is giving up something substantial and deserves to be told so
  // plainly rather than nudged through a generic confirm.
  const pastHalfway = progress.total > 0 && progress.ratio >= 0.5;

  // The orb has no state machine of its own: it mirrors the phase the room
  // already tracks. "listening" is the only mode that reads the microphone.
  // The orb is the candidate's turn made visible: shown when they may speak or
  // are speaking, hidden while the interviewer talks and while we transcribe.
  // The orb is the candidate's turn made visible. It appears only while the
  // microphone is actually live — not while the interviewer talks, and not in
  // the brief gap before recording starts.
  const orbVisible = phase === "listening";
  const thinking = phase === "processing" || closing;

  const orbMode: OrbMode =
    phase === "speaking"
      ? "speaking"
      : phase === "listening"
        ? "listening"
        : phase === "processing"
          ? "processing"
          : "idle";

  const busy = phase === "processing" || phase === "speaking" || closing;
  const copy = PHASE_COPY[phase];

  /* --------------------------------------------------------------- view */

  return (
    <div
      className={cn(
        "interview-room fixed inset-0 z-10 flex flex-col overflow-hidden px-4 py-6 sm:px-6",
        theme === "dark" ? "interview-room--live" : "interview-room--light",
      )}
    >
      {confirmExit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="iv-exit-title"
        >
          <div className="w-full max-w-md rounded-[16px] border border-[var(--iv-border)] bg-[var(--iv-surface)] p-6">
            <h2
              id="iv-exit-title"
              className="font-display text-lg font-bold text-[var(--iv-text)]"
            >
              End interview?
            </h2>

            {pastHalfway ? (
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
                You&apos;re more than halfway through this assessment, so ending
                now will score what you&apos;ve answered and generate your
                report. Questions you haven&apos;t reached count as unanswered,
                and this milestone will be marked complete.
              </p>
            ) : (
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
                Your progress will not be saved and this attempt will not be
                assessed. You can start a fresh interview from the dashboard.
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setConfirmExit(false)}
                className="inline-flex h-10 items-center rounded-[10px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-4 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25"
              >
                Continue interview
              </button>
              <button
                type="button"
                onClick={() => void endInterview()}
                className="inline-flex h-10 items-center rounded-[10px] border border-[#C9282B]/40 px-4 text-[14px] text-[#C9282B] transition-colors hover:bg-[#C9282B]/10"
              >
                {pastHalfway ? "End & get my report" : "End interview"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------- header */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--iv-border)] pb-4">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-tight text-[var(--iv-text)] md:text-xl">
            {title}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--iv-text-muted)]">
            Technical interview • AI Cohort
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--iv-live)]/40 bg-[var(--iv-live)]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--iv-live)]">
            <span className="iv-dot size-1.5 rounded-full bg-[var(--iv-live)]" />
            Live
          </span>
          <button
            type="button"
            onClick={toggleRoomTheme}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-[var(--iv-border)] text-[var(--iv-text-muted)] transition-colors hover:border-[var(--iv-text-faint)] hover:text-[var(--iv-text)]"
          >
            {theme === "dark" ? (
              <Sun className="size-4" strokeWidth={1.75} />
            ) : (
              <Moon className="size-4" strokeWidth={1.75} />
            )}
          </button>
          <span
            className="font-mono text-[13px] tabular-nums text-[var(--iv-text-faint)]"
            aria-label="Elapsed time"
          >
            {formatClock(elapsed)}
          </span>
          <button
            type="button"
            onClick={() => setConfirmExit(true)}
            className="rounded-[8px] border border-[var(--iv-border)] px-3 py-1.5 text-[13px] text-[var(--iv-text-muted)] transition-colors hover:border-[var(--iv-text-faint)] hover:text-[var(--iv-text)]"
          >
            End interview
          </button>
        </div>
      </header>

      {/* --------------------------------------------------- transcript */}
      <div className="flex-1 overflow-y-auto py-8" ref={containerRef}>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
          {turns.map((turn, i) => {
            const isLatest = i >= turns.length - 2;
            const isLast = i === turns.length - 1;

            // While this exact line is being spoken, show only the portion the
            // audio has reached. `reveal.text` is the same string that was sent
            // to the speech endpoint, so matching on it guarantees we never
            // truncate a different turn, and never show a paraphrase.
            //
            // If we are already in "speaking" but reveal has not caught up
            // (TTS still fetching), keep the line blank rather than dumping
            // the full question before the voice starts.
            const revealing =
              isLast &&
              turn.role === "interviewer" &&
              reveal !== null &&
              reveal.text === turn.text;
            const shown = revealing
              ? turn.text.slice(0, reveal.chars)
              : isLast && turn.role === "interviewer" && phase === "speaking"
                ? ""
                : turn.text;

            return (
              <div key={i} className={cn("iv-enter", !isLatest && "iv-turn-past")}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--iv-text-faint)]">
                  {turn.role === "interviewer" ? "AI Interviewer" : candidateName}
                </p>

                {turn.role === "interviewer" ? (
                  <p
                    className="whitespace-pre-line text-[17px] leading-[1.65] text-[var(--iv-text)] md:text-[19px]"
                    // The full line is always available to assistive tech even
                    // mid-reveal; a screen reader must not have to wait for an
                    // animation to learn what was asked.
                    aria-label={turn.text}
                  >
                    {shown}
                  </p>
                ) : (
                  <div className="rounded-[12px] border border-[var(--iv-border-soft)] bg-[var(--iv-surface-raised)] px-4 py-3">
                    <p className="whitespace-pre-line text-[15px] leading-relaxed text-[var(--iv-text-muted)]">
                      {turn.text}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {phase === "processing" || closing ? (
            <p className="text-[13px] text-[var(--iv-text-faint)]">
              {closing ? "Completing your interview…" : "Evaluating your answer…"}
            </p>
          ) : null}

          {phase === "listening" && livePreview ? (
            <div className="iv-enter">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--iv-text-faint)]">
                {candidateName}
              </p>
              <div className="rounded-[12px] border border-dashed border-[var(--iv-border)] bg-[var(--iv-surface-raised)] px-4 py-3">
                <p className="text-[15px] leading-relaxed text-[var(--iv-text-muted)]">
                  {livePreview}
                </p>
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ----------------------------------------------------- controls */}
      <div className="sticky bottom-0 border-t border-[var(--iv-border)] bg-[var(--iv-page)]/80 pt-2 pb-3 backdrop-blur-md">
        <div className="mx-auto w-full max-w-2xl">
          {error ? (
            <p className="mb-4 text-[13px] text-[#C9282B]" role="status">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col items-center gap-1.5">
            {/*
              One slot, three states, so nothing below it ever shifts:

                interviewer speaking -> empty. The orb belongs to the CANDIDATE's
                  turn; showing it while the interviewer talks made it look like
                  the room was listening when it was not. The bars beside the
                  "Interviewer speaking" label already carry that state.
                your turn / listening -> the orb, reacting to their voice.
                transcribing + evaluating -> three wiggling dots.

              The orb stays MOUNTED and fades, rather than unmounting: tearing
              down and rebuilding a WebGL context on every turn costs a visible
              flash and a context churn for no benefit.
            */}
            {/* The mic sits INSIDE the orb: one object to look at and one place
                to click, rather than a decorative shape with a separate button
                underneath it. The wrapper stays pointer-events-none so only the
                button itself is clickable. */}
            <div className="pointer-events-none relative size-[104px] shrink-0 sm:size-[116px]">
              <div
                className={cn(
                  "absolute inset-0 transition-opacity duration-500",
                  orbVisible ? "opacity-100" : "opacity-0",
                )}
                aria-hidden={!orbVisible}
              >
                <VoicePoweredOrb mode={orbMode} palette={theme} levelRef={levelRef} />
              </div>

              {thinking ? (
                <div className="absolute inset-0 flex items-center justify-center gap-2">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="iv-think-dot size-2.5 rounded-full bg-[var(--iv-accent)]"
                      style={{ animationDelay: `${i * 0.16}s` }}
                    />
                  ))}
                </div>
              ) : null}

              {!micUnavailable ? (
                <div className="pointer-events-auto absolute inset-0 flex items-center justify-center">
                  <button
                    type="button"
                    disabled={busy || !question}
                    onClick={
                      phase === "listening" ? stopRecording : startRecording
                    }
                    aria-label={
                      phase === "listening" ? "Stop recording" : "Record answer"
                    }
                    className={cn(
                      "relative flex size-12 items-center justify-center rounded-full border backdrop-blur transition-all duration-200",
                      phase === "listening"
                        ? "border-[#1A7F37]/60 bg-[var(--iv-surface)]/85 text-[#1A7F37]"
                        : "border-[var(--iv-border)] bg-[var(--iv-surface)]/85 text-[var(--iv-text)] hover:border-[var(--iv-accent)]/60",
                      (busy || !question) && "cursor-not-allowed opacity-40",
                    )}
                  >
                    {phase === "listening" ? (
                      <Square className="size-4 fill-current" />
                    ) : (
                      <Mic className="size-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="text-center">
              <p className="text-[13px] font-semibold text-[var(--iv-text)]">
                {copy.label}
                {phase === "speaking" ? (
                  <span className="ml-2 inline-flex items-end gap-[2px] align-middle">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="iv-bar block w-[2px] origin-bottom rounded-full bg-[var(--iv-accent)]"
                        style={{ height: 12, animationDelay: `${i * 110}ms` }}
                      />
                    ))}
                  </span>
                ) : null}
              </p>
              {copy.hint ? (
                <p className="text-[12px] text-[var(--iv-text-faint)]">
                  {copy.hint}
                </p>
              ) : null}
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
