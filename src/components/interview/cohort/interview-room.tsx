"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGE_RETRY_LINE } from "@/features/interview/language-gate";
import {
  initialSilenceState,
  stepSilence,
  type SilenceState,
  type SilenceThresholds,
} from "@/features/interview/silence";
import { MIN_AUDIO_BYTES } from "@/features/interview/voice-contract";
import {
  MAX_ANSWER_MS,
  MAX_LANGUAGE_RETRIES_PER_QUESTION,
  NO_ANSWER_MS,
  PROCESSING_WATCHDOG_MS,
  SPEECH_OFF_FLOOR_MULTIPLIER,
  SPEECH_OFF_RMS,
  SPEECH_ON_FLOOR_MULTIPLIER,
  SPEECH_ON_RMS,
} from "@/features/interview/constants";
import {
  MOVING_ON_LINE,
  NO_RESPONSE_ANSWER,
  WAITING_LINE,
  type RoomLineKind,
} from "@/features/interview/room-lines";
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
  idle: { label: "Your turn", hint: "" },
  listening: { label: "Interviewer is listening", hint: "" },
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

/**
 * Interviewer lines kept on screen, including the current one.
 *
 * Enough to glance back at what was just asked, few enough that the room never
 * becomes a transcript to scroll.
 */
const HISTORY_TURNS = 3;

/**
 * Decodes the exact spoken line out of the speech response header.
 *
 * The route base64s it because header values are ASCII-only and a question may
 * contain anything. Returns null rather than throwing: a header we cannot read
 * means we fall back to the text we composed locally, which is what happened
 * before this header existed.
 */
function decodeSpokenLine(header: string | null): string | null {
  if (!header) return null;
  try {
    const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

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
  /**
   * Part of the contract with the session, but no longer rendered: the room
   * shows interviewer lines only, so there is no candidate label to print.
   */
  candidateName?: string;
  onFinishedAction: (data: FinishInterviewData) => void;
  onAbandonedAction: () => void;
}) {
  const opening = openingPrompt?.trim() || firstQuestion.text;
  const [turns, setTurns] = useState<Turn[]>([
    { role: "interviewer", text: opening },
  ]);
  // The room renders interviewer lines only (see the transcript block). Kept as
  // a derived list rather than by filtering inline, so "is this the line being
  // spoken" is an index check against what is actually on screen.
  // The current interviewer line, plus a little history behind it.
  //
  // Showing every past turn rebuilt the chat transcript this room exists to
  // avoid; showing none of it left the candidate with no way to glance back at
  // what was just asked. A short tail, faded, is the compromise: the current
  // line reads first and the previous ones recede.
  const interviewerTurns = turns.filter((t) => t.role === "interviewer");
  const visibleTurns = interviewerTurns.slice(-HISTORY_TURNS);
  const [question, setQuestion] = useState<ClientQuestion | null>(firstQuestion);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micUnavailable, setMicUnavailable] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [closing, setClosing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [theme, setTheme] = useState<OrbPalette>("light");
  /**
   * Microphone muted.
   *
   * The mic control is MUTE, not submit. Pressing it must never end a turn:
   * only silence does that. It used to call `stopRecording`, which submitted
   * whatever had been captured — so a candidate muting to cough sent a
   * half-answer, and one labelled "Done" invited exactly that.
   */
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  /**
   * Set when the interview is OVER but could not be completed — scoring
   * refused, or the finish request failed.
   *
   * It needs its own state because the room in that moment is not idle and not
   * recoverable by answering: there is no question left on the floor, so the
   * ordinary error banner sat above a disabled microphone and the candidate was
   * stuck watching "Evaluating your answer" forever. This turns that dead end
   * into an explicit exit.
   */
  const [fatal, setFatal] = useState<string | null>(null);

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
  /**
   * Thresholds in force for the CURRENT recording, raised against the noise
   * floor measured in its opening moments. Recomputed per recording because the
   * candidate may move, change device, or have a fan switch on mid-interview.
   */
  const thresholdsRef = useRef<SilenceThresholds>({
    on: SPEECH_ON_RMS,
    off: SPEECH_OFF_RMS,
  });
  const noiseFloorRef = useRef<number | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /**
   * The line currently BEING spoken, cleared the moment playback ends.
   *
   * It used to hold the last line spoken, forever, as a guard against speaking
   * the same string twice. That guard was too strong: an interviewer legitimately
   * repeats itself (the same question restated, the same nudge on a later
   * question), and every repeat was silently swallowed — the room jumped to
   * "your turn" with nothing audible, which reads as the interview freezing.
   * Scoped to the in-flight call, it still absorbs a double-invoked render
   * without muting a genuine repeat.
   */
  const speakingRef = useRef<string | null>(null);
  /** The opening is spoken exactly once, whatever React does on mount. */
  const openingSpokenRef = useRef(false);
  /**
   * Set before stopping a recorder whose audio must NOT be submitted.
   *
   * The no-answer nudge stops the recorder to take the floor back. Without this
   * flag `onstop` then uploaded that (silent) capture, which set the phase to
   * "processing" underneath the line being spoken and raced the speech to decide
   * what state the room ended in — sometimes opening the microphone while the
   * interviewer was still talking, so it recorded the interviewer and answered
   * itself. Nothing was ever going to be transcribed from silence anyway.
   */
  const discardRecordingRef = useRef(false);
  const answerCapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether anything is currently able to tell us the candidate has started
   * talking — the analyser, or the browser's own recognition.
   *
   * The no-answer nudge interrupts a recording, so it must only fire when we
   * genuinely know nobody has spoken. With neither signal available (no
   * AudioContext, and a browser with no SpeechRecognition) silence and a long
   * answer look identical, and nudging on that guess cuts people off mid-
   * sentence. In that case the room waits for the hard cap or for them to press
   * stop, which is the honest behaviour.
   */
  const analyserActiveRef = useRef(false);
  const recognitionActiveRef = useRef(false);

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
      if (nudgeTimerRef.current !== null) clearTimeout(nudgeTimerRef.current);
      if (answerCapRef.current !== null) clearTimeout(answerCapRef.current);
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
    async (text: string, kind: RoomLineKind = "latest") => {
      // Re-entrancy guard: the same line already has audio in flight (a
      // double-invoked effect, a re-render). Return without touching the phase —
      // the call that is already running owns it, and stamping "idle" here would
      // hand the floor back underneath a line still being spoken.
      if (speakingRef.current === text) return;
      speakingRef.current = text;
      setPhase("speaking");
      // Hide the line until audio actually starts. Otherwise the full prompt
      // sits in the transcript for the whole TTS round-trip.
      setReveal({ text, chars: 0 });

      // What ends up visible. Normally identical to `text`; the speech route
      // reports back the words it actually synthesized, and that wins — the
      // transcript must never show something other than what was said.
      let spoken = text;

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
          // The KIND of line, never its text. Lines the room composes itself —
          // the nudge, the language correction, the move-on — are not in the
          // server's transcript, so asking for "the latest line" while one of
          // them was on screen synthesized the agent's last line instead. That
          // is why a candidate who went quiet heard the greeting again.
          body: JSON.stringify({ interviewId, line: kind }),
          signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
        });

        if (res.ok) {
          const reported = decodeSpokenLine(res.headers.get("X-Interview-Line"));
          if (reported) spoken = reported;

          const url = URL.createObjectURL(await res.blob());
          const audio = new Audio(url);
          audioRef.current = audio;
          await audio.play();
          startReveal(spoken, audio);
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
        setReveal({ text: spoken, chars: spoken.length });
        // If the server spoke different words — a stale question on the client,
        // say — the transcript is corrected to match the audio rather than left
        // showing a line nobody heard.
        if (spoken !== text) {
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "interviewer" || last.text !== text) {
              return prev;
            }
            return [...prev.slice(0, -1), { role: "interviewer", text: spoken }];
          });
        }
        speakingRef.current = null;
        setPhase("idle");
      }
    },
    [interviewId, startReveal, stopReveal],
  );


  // Speak the opening question once the room mounts.
  //
  // Deferred by a tick rather than called in the effect body: `speak` sets
  // state immediately, and doing that synchronously inside an effect triggers a
  // cascading render. The delay is imperceptible and the audio still starts
  // within the user gesture that opened the room, which is what browsers
  // require before they will play anything.
  useEffect(() => {
    // The guard lives INSIDE the timeout, not before it. Checked in the effect
    // body, a strict-mode double-mount marks the opening as spoken, the cleanup
    // cancels the timer that would have spoken it, and the second mount then
    // declines to try — an interview that opens in silence.
    const id = setTimeout(() => {
      if (openingSpokenRef.current) return;
      openingSpokenRef.current = true;
      void speak(opening);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Releases a turn that has been "processing" for too long.
   *
   * A Server Action whose connection drops leaves a promise that neither
   * resolves nor rejects, and the room has no other way to learn that. Without
   * this the interview simply stops: "Evaluating your answer" with a disabled
   * microphone, no error, and nothing that will ever change it.
   */
  useEffect(() => {
    if (phase !== "processing" || closing) return;
    const id = setTimeout(() => {
      if (phaseRef.current !== "processing") return;
      setError(
        "That is taking longer than it should. Tap the microphone and answer again.",
      );
      setPhase("idle");
    }, PROCESSING_WATCHDOG_MS);
    return () => clearTimeout(id);
  }, [phase, closing]);

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
      setMuted(false);
      mutedRef.current = false;
      languageRetriesRef.current = 0;
      setProgress(turn.data.progress);

      if (turn.data.finished) {
        setClosing(true);
        const finished = await finishInterviewAction({ interviewId });
        setClosing(false);
        if (finished.ok) {
          onFinishedAction(finished.data);
          return;
        }
        // The interview is over and there is no question left to answer, so an
        // error banner here is a dead end — the room used to sit on "Completing
        // your interview" with the microphone disabled and no way out. Say what
        // happened and give them the exit.
        setFatal(finished.message);
        setPhase("idle");
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
    discardRecordingRef.current = false;
    try {
      // Explicit constraints rather than `audio: true`. These are the browser
      // defaults on paper, but "default" is per-device and per-browser, and a
      // stream captured without gain control or noise suppression transcribes
      // noticeably worse on the laptop microphones these interviews actually
      // run on. Mono because every speech model downmixes anyway, and a stereo
      // capture only doubles the upload.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      // Opus at 64kbps. The browser default varies and can drop low enough to
      // smear consonants, which is exactly the part a transcriber needs; 64k is
      // transparent for speech and still a small upload.
      const recorder = new MediaRecorder(stream, {
        ...(MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? { mimeType: "audio/webm;codecs=opus" }
          : {}),
        audioBitsPerSecond: 64_000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        clearAnswerCap();
        detachAnalyser();
        stream.getTracks().forEach((t) => t.stop());

        // Deliberately thrown away: the nudge took the floor back and this
        // capture is the silence that triggered it. Submitting it would set the
        // phase underneath the line being spoken and race the speech for who
        // owns the room.
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          return;
        }

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        // Nothing was ever said, or the recorder produced only container
        // headers — which is exactly what a muted track yields. Uploading that
        // earns a 400 ("Audio file might be corrupted or unsupported") and
        // burns a request, so hand the turn back instead. Nothing is spent:
        // no answer was submitted and the question stays on the floor.
        if (!hasSpokenRef.current || blob.size < MIN_AUDIO_BYTES) {
          setError(
            "I didn't catch anything there. Tap the microphone and try again.",
          );
          setPhase("idle");
          return;
        }

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
            await speak(LANGUAGE_RETRY_LINE, "language");
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
      // The backstop for every way the analyser can fail to end a turn: no
      // AudioContext, a microphone producing a flat signal, a threshold the
      // room never reaches. Submits what was captured rather than recording
      // into a void indefinitely.
      answerCapRef.current = setTimeout(() => {
        if (phaseRef.current !== "listening") return;
        stopRecording();
      }, MAX_ANSWER_MS);
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
      // Chrome starts an AudioContext suspended when it was not created inside a
      // gesture. A suspended context's analyser reports a flat zero forever,
      // which reads as "the candidate never spoke" — the turn then never ends on
      // its own and the room waits until the nudge fires, every single time.
      if (ctx.state === "suspended") void ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      analyserSrcRef.current = src;

      // TIME-DOMAIN samples, not frequency bins. `getByteFrequencyData` returns
      // a dB-mapped curve whose scale depends on the analyser's min/max decibel
      // range, so the RMS taken over it is not an amplitude and does not compare
      // to any fixed threshold — on a normal laptop microphone it rarely reached
      // the 0.20 the room was testing against, so speech never registered and no
      // answer ever ended by itself. The waveform is an actual amplitude.
      const samples = new Uint8Array(analyser.fftSize);
      hasSpokenRef.current = false;
      silenceRef.current = initialSilenceState();
      noiseFloorRef.current = null;
      thresholdsRef.current = { on: SPEECH_ON_RMS, off: SPEECH_OFF_RMS };

      const startedAt = performance.now();
      /** How long the opening of a recording is sampled for room tone. */
      const CALIBRATION_MS = 700;

      const tick = () => {
        levelRafRef.current = requestAnimationFrame(tick);
        const node = analyserRef.current;
        if (!node) return;

        node.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          // Bytes are centred on 128; shift to -1..1 before squaring.
          const v = (samples[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / samples.length);
        levelRef.current = rms;

        const now = performance.now();

        // Calibrate against the room the candidate is actually sitting in. The
        // quietest frame of the opening moments is the noise floor; thresholds
        // are raised above it so a fan or an air conditioner cannot register as
        // speech, and left at the constants in a quiet room so a soft speaker is
        // still heard. Nothing is decided during calibration except, if they
        // start talking immediately, that they have started.
        if (now - startedAt < CALIBRATION_MS) {
          noiseFloorRef.current =
            noiseFloorRef.current === null
              ? rms
              : Math.min(noiseFloorRef.current, rms);
          // Through the reducer, not a bare threshold test: a single loud
          // frame is a cough or a knock, and marking that as "they have
          // started" armed the silence clock against a candidate who had not
          // said anything yet. `shouldStop` is ignored here — calibration
          // decides only whether they have begun, never that they have
          // finished.
          const opening = stepSilence(
            silenceRef.current,
            rms,
            now,
            undefined,
            thresholdsRef.current,
          );
          silenceRef.current = opening.state;
          hasSpokenRef.current = opening.state.hasSpoken;
          return;
        }

        if (noiseFloorRef.current !== null) {
          const floor = noiseFloorRef.current;
          thresholdsRef.current = {
            on: Math.max(SPEECH_ON_RMS, floor * SPEECH_ON_FLOOR_MULTIPLIER),
            off: Math.max(SPEECH_OFF_RMS, floor * SPEECH_OFF_FLOOR_MULTIPLIER),
          };
          noiseFloorRef.current = null;
        }

        // The rule itself lives in features/interview/silence.ts as a pure
        // function, so turn-taking can be tested without a microphone. This
        // loop owns the audio; that owns the decision.
        // Muted is not a pause. Advancing the timer here would submit the
        // answer 4.5s after the candidate muted, which is the one thing the
        // mute control must never cause.
        if (mutedRef.current) return;

        const step = stepSilence(
          silenceRef.current,
          rms,
          now,
          undefined,
          thresholdsRef.current,
        );
        silenceRef.current = step.state;
        hasSpokenRef.current = step.state.hasSpoken;
        if (step.shouldStop) onSilence();
      };
      levelRafRef.current = requestAnimationFrame(tick);
      analyserActiveRef.current = true;
    } catch {
      // No analyser is a cosmetic loss, not a functional one: the orb rests and
      // the candidate stops recording by hand, exactly as before.
      analyserActiveRef.current = false;
    }
  }

  function detachAnalyser() {
    analyserActiveRef.current = false;
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
        const preview = (settled + interim).trim();
        // Recognised words are proof of speech, independent of the analyser.
        // With one signal only, a microphone whose level never crossed the
        // threshold looked exactly like silence and the nudge cut the candidate
        // off while they were talking.
        // The recognised words are NOT displayed — the candidate's transcript
        // is deliberately absent from the room. Recognition is kept purely as a
        // second signal that speech has started, alongside the analyser, so a
        // very quiet speaker still ends their own turn.
        if (preview.length > 0) hasSpokenRef.current = true;
      };
      rec.onerror = () => {
        // No-speech, network, aborted: all harmless for a preview.
      };

      rec.start();
      recognitionRef.current = rec;
      recognitionActiveRef.current = true;
    } catch {
      // Unsupported or blocked. The interview is unaffected.
      recognitionActiveRef.current = false;
    }
  }

  function stopLivePreview() {
    try {
      recognitionRef.current?.abort();
    } catch {
      // Already stopped.
    }
    recognitionRef.current = null;
    recognitionActiveRef.current = false;
  }

  function clearAnswerCap() {
    if (answerCapRef.current !== null) {
      clearTimeout(answerCapRef.current);
      answerCapRef.current = null;
    }
  }

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
    if (phase !== "idle" || !question || micUnavailable || closing || fatal) {
      return;
    }
    if (recorderRef.current) return;
    // Never open the microphone while the interviewer's audio is still playing.
    // The phase is set to "idle" in `speak`'s finally block, but a browser-voice
    // fallback or a stalled element can leave sound in the room; recording it
    // would feed the interviewer's own question back through transcription.
    if (speakingRef.current !== null) return;
    const id = setTimeout(() => void startRecording(), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, question, micUnavailable, closing, fatal]);

  /**
   * Mutes or unmutes the microphone, without ending the turn.
   *
   * Disabling the track is what actually stops audio reaching the recorder;
   * the analyser then reads silence, so the silence timer is suspended
   * alongside it (see the analyser loop) or muting would auto-submit after
   * 4.5 seconds — the precise thing this control must never do.
   */
  function toggleMute() {
    // Not recording yet: this press opens the microphone rather than muting it.
    if (phaseRef.current !== "listening") {
      setMuted(false);
      mutedRef.current = false;
      void startRecording();
      return;
    }

    setMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      streamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      // Coming back from mute, the quiet period must not count toward the
      // silence window: they were not pausing, they were muted.
      if (!next) {
        silenceRef.current = { ...silenceRef.current, quietSince: null };
      }
      return next;
    });
  }

  /** Ends the turn and SUBMITS what was captured. */
  function stopRecording() {
    clearNoAnswerNudge();
    clearAnswerCap();
    stopLivePreview();
    detachAnalyser();
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  /**
   * Ends the turn and THROWS AWAY what was captured.
   *
   * Used when the room takes the floor back rather than the candidate handing it
   * over — the no-answer nudge. The recording in that case is the silence that
   * caused the nudge; uploading it produced an "I didn't catch that" error and a
   * phase change fighting the line being spoken.
   */
  function cancelRecording() {
    discardRecordingRef.current = true;
    stopRecording();
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
      // the analyser the moment their level crosses the speech threshold, and
      // by the live preview the moment it recognises a word.
      if (hasSpokenRef.current) return;

      // After the first nudge the room is mid-cycle: it cancelled the recording
      // to speak, so the microphone may be closed and the analyser detached,
      // and the phase may be "idle" rather than "listening". The escalation
      // must not depend on either. Requiring them is why a muted candidate sat
      // at "Take your time" indefinitely: nudge one fired, tore down the audio
      // it was gated on, and nothing could ever fire nudge two.
      const escalating = nudgeCountRef.current >= 1;

      if (!escalating) {
        if (phaseRef.current !== "listening") return;
        // With no signal at all, silence and a long answer are
        // indistinguishable. Interrupting on that guess is worse than waiting.
        if (!analyserActiveRef.current && !recognitionActiveRef.current) return;
      } else if (phaseRef.current === "processing" || phaseRef.current === "speaking") {
        // Something else already took the turn; let it finish.
        return;
      }

      nudgeCountRef.current += 1;

      if (nudgeCountRef.current === 1) {
        // CANCEL, not stop: the capture is the silence that got us here.
        cancelRecording();
        // A short prompt, NOT the question again. It was asked seconds ago and
        // is still on screen — restating it made the interviewer look like it
        // had spoken twice and forgotten the first time.
        setTurns((prev) => [
          ...prev,
          { role: "interviewer", text: WAITING_LINE },
        ]);
        setReveal({ text: WAITING_LINE, chars: WAITING_LINE.length });
        // Reschedule from HERE rather than relying on the microphone being
        // reopened. Muting, a denied permission or a failed reopen must not be
        // able to strand the interview on this line — the escalation to
        // "moving on" is what makes repeated silence bounded.
        void speak(WAITING_LINE, "waiting").finally(() => {
          if (!hasSpokenRef.current) scheduleNoAnswerNudge();
        });
        return;
      }

      cancelRecording();
      setTurns((prev) => [...prev, { role: "interviewer", text: MOVING_ON_LINE }]);
      setReveal({ text: MOVING_ON_LINE, chars: MOVING_ON_LINE.length });
      // Spoken and submitted together: the candidate hears why the interview is
      // moving on while the turn is recorded as unanswered. `send` owns the
      // phase from here, so the speech is not awaited.
      void speak(MOVING_ON_LINE, "moving_on").then(() => {
        void send(NO_RESPONSE_ANSWER);
      });
    }, NO_ANSWER_MS);
  }

  function clearNoAnswerNudge() {
    if (nudgeTimerRef.current !== null) {
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
  }

  async function endInterview() {
    // CANCEL: whatever is in the recorder is a half-answer nobody asked for, and
    // submitting it would start a turn while the interview is being closed.
    cancelRecording();
    setConfirmExit(false);
    setClosing(true);
    audioRef.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();

    // Past halfway the answers already given are enough to assess, so ending
    // early SCORES the attempt instead of discarding it. Throwing away a
    // substantially complete interview served nobody: the evidence existed and
    // the candidate had earned a report. `finalizeInterview` still gates on
    // having enough evidence, so a session too thin to be meaningful cannot
    // produce one — in that case we fall back to abandoning.
    if (progress.total > 0 && progress.ratio >= 0.5) {
      const finished = await finishInterviewAction({ interviewId });
      if (finished.ok) {
        setClosing(false);
        onFinishedAction(finished.data);
        return;
      }
    }

    await abandonInterviewAction({ interviewId });
    setClosing(false);
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
      {fatal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="iv-fatal-title"
        >
          <div className="w-full max-w-md rounded-[16px] border border-[var(--iv-border)] bg-[var(--iv-surface)] p-6">
            <h2
              id="iv-fatal-title"
              className="font-display text-lg font-bold text-[var(--iv-text)]"
            >
              Interview ended
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
              {fatal}
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--iv-text-faint)]">
              This attempt was not scored, so it has not been counted. You can
              start a fresh interview from the dashboard.
            </p>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => {
                  cancelRecording();
                  void abandonInterviewAction({ interviewId }).finally(
                    onAbandonedAction,
                  );
                }}
                className="inline-flex h-10 items-center rounded-[10px] border border-[var(--iv-accent)]/50 bg-[var(--iv-accent)]/15 px-4 text-[14px] font-semibold text-[var(--iv-text)] transition-colors hover:bg-[var(--iv-accent)]/25"
              >
                Back to dashboard
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
          {/* Interviewer lines only.
              *
              * A voice interview is not a chat log. Showing the candidate's own
              * words back to them turns it into ChatGPT with a microphone, and
              * it invites them to read their answer rather than talk. What they
              * said is still captured, transcribed, scored and reported — it is
              * simply not on screen while they are being interviewed.
              *
              * Role labels go with it: with one speaker on screen, "AI
              * Interviewer" above every line is chrome, not information. */}
          {visibleTurns.map((turn, i) => {
            const isLast = i === visibleTurns.length - 1;

            // While this exact line is being spoken, show only the portion the
            // audio has reached. `reveal.text` is the same string sent to the
            // speech endpoint, so matching on it guarantees we never truncate a
            // different turn and never show a paraphrase.
            //
            // If we are already in "speaking" but reveal has not caught up (TTS
            // still fetching), keep the line blank rather than dumping the whole
            // question before the voice starts. This is what stops the next
            // question appearing before the interviewer has asked it.
            const revealing =
              isLast && reveal !== null && reveal.text === turn.text;
            const shown = revealing
              ? turn.text.slice(0, reveal.chars)
              : isLast && phase === "speaking"
                ? ""
                : turn.text;

            return (
              <div
                key={`${interviewerTurns.length - visibleTurns.length + i}`}
                className={cn("iv-enter", !isLast && "iv-turn-past")}
              >
                <p
                  className="whitespace-pre-line text-[17px] leading-[1.65] text-[var(--iv-text)] md:text-[19px]"
                  // The full line is always available to assistive tech even
                  // mid-reveal; a screen reader must not have to wait for an
                  // animation to learn what was asked.
                  aria-label={turn.text}
                >
                  {shown}
                </p>
              </div>
            );
          })}

          {phase === "processing" || closing ? (
            <p className="text-[13px] text-[var(--iv-text-faint)]">
              {closing ? "Completing your interview…" : "Evaluating your answer…"}
            </p>
          ) : null}

          {/* The candidate's turn is signalled by the orb and one quiet line,
              not by their transcript scrolling past them. */}
          {phase === "listening" ? (
            <p className="text-[13px] text-[var(--iv-text-faint)]">
              Interviewer is listening…
            </p>
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

          {/*
            The orb is the room's centre of attention and the microphone is a
            CONTROL, so they no longer occupy the same pixels. The button used to
            sit inside the orb: it covered the part of the animation that
            actually responds to the voice, gave the one interactive element in
            the room no edge of its own, and left "is that a picture or a button?"
            genuinely ambiguous — a bad thing to wonder about mid-answer. The orb
            keeps the centre; the control sits at the right-hand edge where the
            other controls in this room already live.
          */}
          <div className="relative flex items-center justify-center">
            <div className="flex flex-col items-center gap-1.5">
              {/*
                One slot, two states, so nothing below it ever shifts:

                  interviewer speaking -> empty. The orb belongs to the
                    CANDIDATE's turn; showing it while the interviewer talks made
                    it look like the room was listening when it was not. The bars
                    beside the "Interviewer speaking" label carry that state.
                  your turn / listening -> the orb, reacting to their voice.
                  transcribing + evaluating -> three wiggling dots.

                The orb stays MOUNTED and fades, rather than unmounting: tearing
                down and rebuilding a WebGL context on every turn costs a visible
                flash and a context churn for no benefit.
              */}
              <div className="pointer-events-none relative size-[104px] shrink-0 sm:size-[116px]">
                <div
                  className={cn(
                    "absolute inset-0 transition-opacity duration-500",
                    orbVisible ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden={!orbVisible}
                >
                  {/*
                    Sensitivity is set here rather than left at the component
                    default because the level this room feeds it is now a
                    waveform amplitude (~0.05–0.15 while speaking) rather than
                    the old frequency-curve value. Without the higher multiplier
                    the orb would barely move for a normal speaking voice.
                  */}
                  <VoicePoweredOrb
                    mode={orbMode}
                    palette={theme}
                    levelRef={levelRef}
                    voiceSensitivity={7}
                  />
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

            {!micUnavailable ? (
              <div className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1.5">
                <button
                  type="button"
                  disabled={busy || !question || Boolean(fatal)}
                  onClick={toggleMute}
                  aria-label={
                    phase !== "listening"
                      ? "Turn on the microphone"
                      : muted
                        ? "Unmute the microphone"
                        : "Mute the microphone"
                  }
                  className={cn(
                    "flex size-14 items-center justify-center rounded-full border-2 transition-all duration-200",
                    phase === "listening" && !muted
                      ? "border-[#1A7F37]/70 bg-[#1A7F37]/12 text-[#1A7F37] hover:bg-[#1A7F37]/20"
                      : "border-[var(--iv-border)] bg-[var(--iv-surface)] text-[var(--iv-text)] hover:border-[var(--iv-accent)]/60 hover:bg-[var(--iv-accent)]/10",
                    (busy || !question || fatal) &&
                      "cursor-not-allowed opacity-40 hover:bg-transparent",
                  )}
                >
                  {muted ? (
                    <MicOff className="size-5" strokeWidth={1.75} />
                  ) : (
                    <Mic className="size-5" strokeWidth={1.75} />
                  )}
                </button>
                <span className="text-[11px] font-medium text-[var(--iv-text-faint)]">
                  {muted ? "Muted" : "Mic on"}
                </span>
              </div>
            ) : null}
          </div>

        </div>
      </div>
    </div>
  );
}
