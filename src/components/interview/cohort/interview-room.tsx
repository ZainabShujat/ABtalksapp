"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Mic, MicOff, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGE_RETRY_LINE } from "@/features/interview/language-gate";
import {
  initialTurnContext,
  openTurn,
  stepTurn,
  type TurnContext,
  type TurnEffect,
  type TurnState,
} from "@/features/interview/turn-state";
import { MIN_AUDIO_BYTES } from "@/features/interview/voice-contract";
import {
  COHORT_INTERVIEW_DURATION_SEC,
  MAX_ANSWER_MS,
  MAX_LANGUAGE_RETRIES_PER_QUESTION,
  PROCESSING_WATCHDOG_MS,
  SPEECH_OFF_RMS,
  SPEECH_ON_RMS,
} from "@/features/interview/constants";
import {
  RETRY_LINE,
  NO_RESPONSE_ANSWER,
  TIME_UP_LINE,
  roomLineFor,
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

/**
 * The room theme as an external store.
 *
 * It lives in `localStorage`, which does not exist during SSR, so the server
 * render and the first client render must both say "light" and the stored
 * preference can only be applied once hydrated. `useSyncExternalStore` states
 * that contract directly: `getServerSnapshot` covers the render that has to
 * match the server, `getSnapshot` takes over afterwards.
 *
 * This used to be `useState` plus a mount effect that called `setTheme`, which
 * expresses the same intent by scheduling a second render pass on every mount.
 * Behaviour is unchanged — light first, stored preference immediately after
 * hydration, toggle writes through to storage.
 */
const roomThemeListeners = new Set<() => void>();
let roomThemeCache: OrbPalette | null = null;

function subscribeRoomTheme(onStoreChange: () => void): () => void {
  roomThemeListeners.add(onStoreChange);
  return () => {
    roomThemeListeners.delete(onStoreChange);
  };
}

/**
 * Cached: `getSnapshot` runs on every render and must return the same value
 * until something notifies, or React re-renders in a loop.
 */
function getRoomThemeSnapshot(): OrbPalette {
  if (roomThemeCache === null) roomThemeCache = readStoredRoomTheme();
  return roomThemeCache;
}

function getRoomThemeServerSnapshot(): OrbPalette {
  return "light";
}

function writeRoomTheme(next: OrbPalette): void {
  roomThemeCache = next;
  try {
    localStorage.setItem(ROOM_THEME_KEY, next);
  } catch {
    // Persistence is a convenience, not a requirement.
  }
  for (const listener of roomThemeListeners) listener();
}

const PHASE_COPY: Record<Phase, { label: string; hint: string }> = {
  idle: { label: "Your turn", hint: "" },
  listening: { label: "Interviewer is listening", hint: "" },
  processing: { label: "Evaluating your answer", hint: "" },
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
 * How long a recognised word keeps counting as "still speaking".
 *
 * Long enough to bridge the gap between words and short enough that it lapses
 * during a real pause, so the silence window can still close a turn.
 */
const WORD_RECENCY_MS = 1_500;

/**
 * A build marker, shown in the dev readout.
 *
 * Diagnosing the audio pipeline repeatedly stalled on "is the browser actually
 * running this code?" — a stale bundle presents as live RMS with frozen
 * thresholds, which looks like a microphone fault rather than a caching one.
 * Bump this whenever the audio path changes; if the screen does not show it,
 * the fix under discussion is not the code being run.
 */
const AUDIO_BUILD = "vad-7-per-recorder-chunks";

/**
 * Whether to show the audio diagnostics strip.
 *
 * Opt-in via `?debug=audio` rather than on by default in development: the strip
 * earned its keep while the capture pipeline was being fixed, but it sits in the
 * middle of the interview and reads as broken chrome to anyone who is not
 * debugging it. Append the flag to the interview URL to bring it back.
 */
function audioDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "audio";
  } catch {
    return false;
  }
}

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

/**
 * How long the room waits when the candidate has said NOTHING at all before
 * prompting them.
 *
 * Different from `SILENCE_MS`, which ends an answer that has already happened.
 * This is the awkward case: the microphone is live and nobody is talking. A
 * human interviewer would not sit in silence indefinitely; they would re-ask,
 * and then offer a way out.
 */
const NO_ANSWER_MS = 10_000;

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
  const theme = useSyncExternalStore(
    subscribeRoomTheme,
    getRoomThemeSnapshot,
    getRoomThemeServerSnapshot,
  );
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

  function toggleRoomTheme() {
    writeRoomTheme(theme === "light" ? "dark" : "light");
  }
  /**
   * Progress through the CORE spine, straight from the server.
   *
   * Counted in core questions rather than turns, because follow-ups and deep
   * probes add turns without advancing the assessment — a turn-based bar would
   * tell someone on question three that they were nearly done.
   */
  /** What became of the last recording. Development diagnostics only. */
  const [sttDebug, setSttDebug] = useState<string | null>(null);

  /** Ungated RMS, for diagnostics. `levelRef` is gated for the orb. */
  const rawLevelRef = useRef(0);

  const [progress, setProgress] = useState({ answered: 0, total: 0, ratio: 0 });

  /**
   * Live audio diagnostics, development only.
   *
   * Threshold problems are indistinguishable from a dead audio path by looking
   * at the room: both present as "it cannot hear me". This shows the numbers —
   * whether the analyser is producing any signal at all, what it is being
   * compared against, and whether the context is actually running. Sampled at
   * 5Hz so it costs nothing.
   */
  const [audioDebug, setAudioDebug] = useState<{
    rms: number;
    on: number;
    off: number;
    spoke: boolean;
    ctx: string;
    word: boolean;
  } | null>(null);

  useEffect(() => {
    if (!audioDebugEnabled()) return;
    const id = setInterval(() => {
      setAudioDebug({
        rms: rawLevelRef.current,
        word:
          lastWordAtRef.current !== null &&
          performance.now() - lastWordAtRef.current < WORD_RECENCY_MS,
        on: SPEECH_ON_RMS,
        off: SPEECH_OFF_RMS,
        spoke: hasSpokenRef.current,
        ctx: audioCtxRef.current?.state ?? "none",
      });
    }, 200);
    return () => clearInterval(id);
  }, []);

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
  /**
   * The turn state machine. The ref is the source of truth (the audio loop
   * reads and writes it every frame); the React state exists only so the UI can
   * label what is happening.
   */
  const turnCtxRef = useRef<TurnContext>(initialTurnContext());
  const turnStateRef = useRef<TurnState>("idle");
  const [turnState, setTurnState] = useState<TurnState>("idle");
  const hasSpokenRef = useRef(false);
  const lastWordAtRef = useRef<number | null>(null);
  /**
   * Thresholds in force for the CURRENT recording, raised against the noise
   * floor measured in its opening moments. Recomputed per recording because the
   * candidate may move, change device, or have a fan switch on mid-interview.
   */

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
  /**
   * How many room-composed lines have been spoken this interview.
   *
   * Drives which authored wording of a repeating line is used, so the nudge does
   * not say the identical sentence on every silence. A ref, not state: it must
   * advance exactly once per occurrence and must never trigger a re-render.
   */
  const roomLineCountRef = useRef(0);
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
    async (text: string, kind: RoomLineKind = "latest", variant = 0) => {
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
          body: JSON.stringify({ interviewId, line: kind, variant }),
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

      const actionStartedMs = Date.now();
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
        // Not awaited, and deliberately the LAST thing done: every state
        // update above is synchronous, so speech begins the moment the
        // decision is in rather than after a render.
        void speak(turn.data.prompt);
      } else setPhase("idle");

      if (process.env.NODE_ENV !== "production") {
        // The candidate-visible half of the gap: how long the decision leg took
        // from the room's side. Pair it with the server's `turn latency` line
        // to separate model time from network time.
        console.info("[turn] decision leg", {
          actionMs: Date.now() - actionStartedMs,
          action: turn.data.action,
          spoke: Boolean(turn.data.prompt),
        });
      }
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
      // PER-RECORDER, not shared. `chunksRef` was one array reused by every
      // turn, and `MediaRecorder.stop()` is asynchronous: the next turn's
      // `startRecording` cleared it and began pushing new chunks BEFORE the
      // previous `onstop` had built its blob. The blob was then spliced from
      // two different streams, which is not a decodable WebM file — the
      // provider rejected it and the route reported 502. `chunksRef` is kept
      // pointing at the live array only so the no-response path can size it.
      const chunks: Blob[] = [];
      chunksRef.current = chunks;

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
        if (e.data.size > 0) chunks.push(e.data);
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
          if (process.env.NODE_ENV !== "production") {
            console.warn("[turn] recording DISCARDED", {
              chunks: chunks.length,
              hasSpoken: hasSpokenRef.current,
              // Reachable only from ending/abandoning the interview now.
              reason: "interview ended or abandoned",
            });
          }
          setSttDebug(`discarded ${chunks.length} chunk(s)`);
          chunks.length = 0;
          return;
        }

        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });

        // Nothing was ever said, or the recorder produced only container
        // headers — which is exactly what a muted track yields. Uploading that
        // earns a 400 ("Audio file might be corrupted or unsupported") and
        // burns a request, so hand the turn back instead. Nothing is spent:
        // no answer was submitted and the question stays on the floor.
        if (process.env.NODE_ENV !== "production") {
          console.info("[turn] recorder stopped", {
            chunks: chunks.length,
            blobBytes: blob.size,
            mimeType: recorder.mimeType,
            hasSpoken: hasSpokenRef.current,
            discarded: false,
          });
        }
        setSttDebug(
          `captured ${(blob.size / 1024).toFixed(1)}KB in ${chunks.length} chunk(s)`,
        );
        // RECORDING IS NOT SILENCE DETECTION.
        //
        // This used to read `!hasSpokenRef.current || blob.size < MIN_AUDIO_BYTES`,
        // which let a VAD output decide whether a recording was uploaded at all.
        // When the thresholds did not fire on a given microphone — a quiet voice,
        // a high room floor — a complete recording containing the candidate's
        // entire answer was thrown away without ever reaching transcription, and
        // the room reported that it could not hear them.
        //
        // The only question now is whether there is audio to send. Voice
        // detection decides WHEN to stop, never WHETHER the speech was captured.
        // The one deliberate exception is the explicit "(no response)" path,
        // which cancels its recording outright rather than relying on a gate.
        if (blob.size < MIN_AUDIO_BYTES) {
          setSttDebug(
            `SKIPPED upload: ${(blob.size / 1024).toFixed(1)}KB — below the ${MIN_AUDIO_BYTES}B floor (container headers only)`,
          );
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

          if (process.env.NODE_ENV !== "production") {
            console.info("[turn] STT responded", {
              status: res.status,
              ok: json?.ok ?? false,
              chars: json?.ok ? json.data.text.length : 0,
              words: json?.ok
                ? json.data.text.split(/\s+/).filter(Boolean).length
                : 0,
              english: json?.ok ? json.data.english !== false : null,
              transcript: json?.ok ? json.data.text : (json?.message ?? "unparseable"),
            });
          }
          setSttDebug(
            `HTTP ${res.status} · ${json ? (json.ok ? `"${json.data.text.slice(0, 40)}"` : `err: ${json.message}`) : "unparseable body"}`,
          );

          if (!json) {
            setTurns((prev) => [
              ...prev,
              { role: "interviewer", text: RETRY_LINE },
            ]);
            setReveal({ text: RETRY_LINE, chars: RETRY_LINE.length });
            void speak(RETRY_LINE, "retry");
            return;
          }

          if (!json.ok) {
            // The candidate DID answer; transcription is what failed. Moving on
            // would record an unanswered question against someone who spoke, so
            // the interviewer asks for it again and the question stays open. No
            // evidence, no budget, no question advance.
            setTurns((prev) => [
              ...prev,
              { role: "interviewer", text: RETRY_LINE },
            ]);
            setReveal({ text: RETRY_LINE, chars: RETRY_LINE.length });
            void speak(RETRY_LINE, "retry");
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
            `Your answer couldn't be sent (${
              err instanceof Error ? err.message : "network error"
            }). Nothing was lost from the interview — the question is still open.`,
          );
          // The connection dropped mid-upload, most likely on a long answer.
          // The audio for THIS turn is gone, but the interview is not: the
          // question stays on the floor, no evidence is recorded and no budget
          // is spent, so the candidate simply answers again. Saying so out loud
          // matters — silence here reads as the interview having frozen.
          setTurns((prev) => [
            ...prev,
            { role: "interviewer", text: RETRY_LINE },
          ]);
          setReveal({ text: RETRY_LINE, chars: RETRY_LINE.length });
          void speak(RETRY_LINE, "retry");
        }
      };

      // A timeslice, so audio is flushed once a second instead of being held
      // as one growing buffer released only at stop. Long answers were the
      // failure case: a single large final chunk is both more memory and more
      // to lose if anything interrupts the recording.
      // NO TIMESLICE. `start(1000)` emits a chunk every second, and ONLY the
      // first carries the EBML header that makes the bytes a WebM file. Any
      // path that lost or replaced that first chunk produced a headless
      // container: the upload still said `answer.webm`, the server still saw
      // `audio/webm;codecs=opus`, and the provider rejected it with "Invalid
      // file format" — observed as head bytes `41e38100` (a mid-stream cluster)
      // where `1a45dfa3` was required.
      //
      // With no argument the recorder emits ONE blob at stop, headers included,
      // so the file is valid by construction rather than by careful assembly.
      // Nothing here needed the periodic chunks: the answer is only ever
      // uploaded when the turn ends.
      recorder.start();
      recorderRef.current = recorder;
      // Same stream, one analyser. Auto-stop runs the normal stop path, so the
      // captured audio goes through the existing STT pipeline unchanged.

      attachAnalyser(stream, handleTurnEffect);
      startLivePreview();
      // A FAILSAFE, not a duration limit.
      //
      // It exists for the ways the analyser can fail to end a turn at all: no
      // AudioContext, a microphone producing a flat signal, a threshold the
      // room never reaches. It must never truncate someone who is simply
      // giving a long answer — at 120s it cut a two-minute answer off
      // mid-sentence, which is the opposite of the problem it was added for.
      //
      // So it fires only when the state machine is NOT running the turn. If the
      // candidate is mid-answer the machine owns the turn and the cap re-arms
      // instead of stopping, which means a long answer can only ever be ended
      // by silence.
      const armAnswerCap = () => {
        answerCapRef.current = setTimeout(() => {
          if (phaseRef.current !== "listening") return;
          const turn = turnCtxRef.current;
          const machineRunning =
            turn.state === "CANDIDATE_SPEAKING" || turn.state === "CANDIDATE_PAUSED";
          if (machineRunning) {
            // A healthy turn re-arms forever: only silence ends an answer, so a
            // three-minute one is never truncated.
            armAnswerCap();
            return;
          }
          // Detection never fired at all — the thresholds did not suit this
          // microphone. STOP, which now UPLOADS whatever was captured rather
          // than discarding it. A candidate whose voice the VAD could not see
          // still gets their answer transcribed; they just wait longer for it.
          stopRecording();
        }, MAX_ANSWER_MS);
      };
      armAnswerCap();
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
  function attachAnalyser(
    stream: MediaStream,
    onEffect: (effect: TurnEffect) => void,
  ) {
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
      lastWordAtRef.current = null;
      turnCtxRef.current = openTurn(performance.now());
      turnStateRef.current = "WAITING_FOR_SPEECH";
      setTurnState("WAITING_FOR_SPEECH");


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
        // The orb reads this, and it must only move when the candidate is
        // actually audible. Publishing raw RMS made it twitch at room tone,
        // which reads as "it can hear me" when it cannot. Below the speech
        // threshold the orb is told silence.
        rawLevelRef.current = rms;
        levelRef.current = rms >= SPEECH_OFF_RMS ? rms : 0;

        const now = performance.now();

        // One input: the microphone level, against FIXED thresholds. No noise
        // calibration, no floor tracking, no speech-recognition second opinion
        // — each of those was a way for the turn to get stuck, and none of them
        // can any longer stop a recording being uploaded.
        const step = stepTurn(turnCtxRef.current, {
          rms,
          now,
          muted: mutedRef.current,
        });
        turnCtxRef.current = step.context;
        hasSpokenRef.current = step.context.hasSpoken;
        if (step.context.state !== turnStateRef.current) {
          if (process.env.NODE_ENV !== "production") {
            console.info(
              `[turn] ${turnStateRef.current} -> ${step.context.state}`,
              {
                hasSpoken: step.context.hasSpoken,
                rms: Number(rms.toFixed(4)),
                on: SPEECH_ON_RMS,
                off: SPEECH_OFF_RMS,
                nudges: step.context.nudges,
                atMs: Math.round(now),
              },
            );
          }
          turnStateRef.current = step.context.state;
          setTurnState(step.context.state);
        }
        if (step.effect !== "none" && process.env.NODE_ENV !== "production") {
          console.info(`[turn] effect=${step.effect}`, {
            reason:
              step.effect === "finalize"
                ? "silence window elapsed after speech"
                : step.effect === "moveOn"
                  ? "no speech after the second prompt"
                  : step.effect === "nudge"
                    ? "no speech since the mic opened"
                    : "microphone muted",
            hasSpoken: step.context.hasSpoken,
          });
        }
        if (step.effect !== "none") onEffect(step.effect);
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
    lastWordAtRef.current = null;
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
      // Initialize the timer so the 5-second rule applies immediately.
      lastWordAtRef.current = performance.now();
      
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
        if (preview.length > 0) {
          hasSpokenRef.current = true;
          lastWordAtRef.current = performance.now();
        }
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
      // No clock surgery here. `stepTurn` re-bases its own anchors by exactly
      // the muted interval on the first unmuted frame, so muted time counts
      // toward neither the silence window nor the no-answer wait — and the
      // captured audio is never touched either way.
      return next;
    });
  }

  /** Ends the turn and SUBMITS what was captured. */
  function stopRecording() {
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
   * over: ending or abandoning the interview. It is deliberately NOT used by
   * any turn-taking path any more — the nudge used to call it, which is exactly
   * how a candidate who started speaking mid-nudge lost their answer.
   */
  function cancelRecording() {
    discardRecordingRef.current = true;
    stopRecording();
  }

  // NOTE ON THE ONE REMAINING DISCARD PATH.
  //
  // `cancelRecording` is now reachable ONLY from ending or abandoning the
  // interview, where there is no next turn for an answer to belong to. Every
  // turn-taking path — nudge, move-on, noisy room, silence — goes through
  // `stopRecording`, so no decision the interviewer makes mid-interview can
  // throw away captured speech. That is the invariant the old nudge broke.

  /**
   * Acts on what the audio loop decided this frame.
   *
   * Every branch is reached from ONE place, synchronously, after the state has
   * already moved. That is the whole point of the refactor: there is no second
   * owner of the turn that could disagree about whether the candidate has
   * spoken, and no path here can discard a recording that contains an answer.
   */
  function handleTurnEffect(effect: TurnEffect) {
    if (effect === "finalize") {
      // The machine only emits this from CANDIDATE_PAUSED, which is only
      // reachable once `hasSpoken` is true. Submitting here can therefore never
      // be a non-answer, and the state is already ANSWER_FINALIZING so a second
      // frame cannot emit it again.
      stopRecording();
      return;
    }

    if (effect === "mutedWarning") {
      setError(
        "Your microphone has been muted for a few seconds. Resume when you're ready, or end this response.",
      );
      return;
    }

    if (effect === "nudge") {
      // The recording KEEPS RUNNING. Nothing is cancelled and nothing is
      // discarded — this is a prompt over the top of an open microphone, which
      // is what makes "the nudge ate my answer" structurally impossible.
      // Varied per occurrence: this fires on EVERY silence, and the same
      // sentence four times in one interview is the loudest possible tell that
      // nothing is listening. The transcript length is the counter, and the
      // same value goes to the server so the spoken line matches the shown one.
      const waitingVariant = roomLineCountRef.current++;
      const waitingText = roomLineFor("waiting", waitingVariant);
      setTurns((prev) => [...prev, { role: "interviewer", text: waitingText }]);
      setReveal({ text: waitingText, chars: waitingText.length });
      void speak(waitingText, "waiting", waitingVariant);
      return;
    }

    if (effect === "moveOn") {
      // Reached only from WAITING_FOR_SPEECH, so `hasSpoken` is false by
      // construction and "(no response)" is the truth rather than a guess.
      const movingOnVariant = roomLineCountRef.current++;
      const movingOnText = roomLineFor("moving_on", movingOnVariant);
      setTurns((prev) => [...prev, { role: "interviewer", text: movingOnText }]);
      setReveal({ text: movingOnText, chars: movingOnText.length });
      // "moveOn" means VOICE DETECTION never saw speech — which is not the same
      // as nothing having been said. It was discarding thirteen seconds of
      // captured audio on the strength of that guess, which is exactly the
      // failure mode this pipeline is supposed to have stopped having.
      //
      // So the RECORDING decides, not the detector. If real audio was captured
      // it is uploaded through the ordinary path and treated as the answer it
      // probably is. Only a genuinely empty capture submits the marker.
      const captured = chunksRef.current.reduce((n, c) => n + c.size, 0);
      if (captured >= MIN_AUDIO_BYTES) {
        stopRecording();
        return;
      }

      cancelRecording();
      void speak(movingOnText, "moving_on", movingOnVariant).then(() => {
        void send(NO_RESPONSE_ANSWER);
      });
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

  // Past the halfway mark the warning changes, because the CONSEQUENCE changes,
  // and the two outcomes are opposites rather than degrees of the same thing:
  //
  //   past halfway   `finishInterviewAction` scores what was answered and the
  //                  milestone is marked COMPLETED. They get a report, and
  //                  unreached questions count as unanswered.
  //   before halfway `abandonInterviewAction` writes ABANDONED, which is not
  //                  COMPLETED, so the milestone is NOT consumed. No score, no
  //                  report, and the attempt can be retaken.
  //
  // Someone leaving early is usually leaving by accident — a wrong tab, a
  // misread button — so the early warning names all three consequences
  // explicitly instead of the single vague sentence it used to show. It also
  // says how far they actually are: "not halfway" means nothing without the
  // number behind it.
  const pastHalfway = progress.total > 0 && progress.ratio >= 0.5;

  // The orb has no state machine of its own: it mirrors the phase the room
  // already tracks. "listening" is the only mode that reads the microphone.
  // The orb is the candidate's turn made visible: shown when they may speak or
  // are speaking, hidden while the interviewer talks and while we transcribe.
  // The orb is the candidate's turn made visible. It appears only while the
  // microphone is actually live — not while the interviewer talks, and not in
  // the brief gap before recording starts.
  // Visibility follows the TURN STATE, not `phase`.
  //
  // The two disagree after a nudge. The nudge speaks over a still-open
  // microphone: `speak()` leaves `phase` at "idle" when it finishes, while the
  // recorder is running and the turn machine is still WAITING_FOR_SPEECH. Keyed
  // on `phase`, the orb vanished even though it was the candidate's turn — and
  // it reappeared only if something else happened to set "listening", which is
  // why it looked intermittent. The turn machine is the one thing that actually
  // knows whose floor it is.
  const orbVisible =
    turnState === "WAITING_FOR_SPEECH" ||
    turnState === "CANDIDATE_SPEAKING" ||
    turnState === "CANDIDATE_PAUSED" ||
    phase === "listening";
  const thinking = phase === "processing" || closing;

  const orbMode: OrbMode =
    phase === "speaking"
      ? "speaking"
      : phase === "processing" || closing
        ? "processing"
        // Same reasoning as `orbVisible`: while the turn machine says the
        // candidate has the floor, the orb listens — even if `phase` briefly
        // says "idle" after the interviewer spoke over an open microphone.
        : orbVisible
          ? "listening"
          : "idle";

  // True while the first line is still being fetched/synthesised: nothing has
  // been revealed yet and no turn has completed.
  const waitingToBegin =
    turns.length <= 1 &&
    (reveal === null || reveal.chars === 0) &&
    phase !== "listening" &&
    !fatal;

  const busy = phase === "processing" || phase === "speaking" || closing;
  // Counts DOWN. A candidate needs to know how long is left, not how long they
  // have been going — the same number read the other way round is the one that
  // lets them decide whether to keep elaborating.
  const remainingSec = Math.max(0, COHORT_INTERVIEW_DURATION_SEC - elapsed);

  useEffect(() => {
    if (remainingSec > 0 || closing || fatal) return;
    // Time is up. SCORE what was answered rather than discarding it: the
    // candidate sat the interview, and everything they said is evidence. The
    // server still refuses a session with too little in it, so this cannot
    // manufacture a report out of nothing.
    // Deferred a tick: setting state synchronously in an effect body cascades
    // renders, and the whole close-out is async anyway.
    const id = setTimeout(() => {
      setClosing(true);
      cancelRecording();
      void speak(TIME_UP_LINE, "time_up").finally(async () => {
        const finished = await finishInterviewAction({ interviewId });
        setClosing(false);
        if (finished.ok) onFinishedAction(finished.data);
        else setFatal(finished.message);
      });
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec === 0]);

  const copy = PHASE_COPY[phase];
  // The machine's own view, so the status the candidate reads comes from the
  // same place the turn decisions do rather than from a parallel phase flag.
  const statusLabel =
    turnState === "CANDIDATE_SPEAKING" || turnState === "CANDIDATE_PAUSED"
      ? "Listening"
      : turnState === "ANSWER_FINALIZING"
        ? "One moment"
        : copy.label;

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
              <>
                <p className="mt-3 text-[14px] leading-relaxed text-[var(--iv-text)]">
                  You&apos;re not halfway through yet
                  {progress.total > 0
                    ? ` — you've answered ${progress.answered} of ${progress.total} questions`
                    : ""}
                  .
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
                  <li>This attempt will not be counted.</li>
                  <li>You will not get a report from it.</li>
                  <li>Nothing you have said so far will be assessed.</li>
                </ul>
                <p className="mt-3 text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
                  Your milestone stays open, so you can start a fresh interview
                  from the dashboard whenever you&apos;re ready.
                </p>
              </>
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
                {/* The label carries the consequence too: a candidate who
                    skims the dialog still sees what the button costs. */}
                {pastHalfway ? "End & get my report" : "End without a report"}
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
            className={cn(
              "font-mono text-[13px] tabular-nums",
              remainingSec <= 120
                ? "text-[#C9282B]"
                : "text-[var(--iv-text-faint)]",
            )}
            aria-label="Time remaining"
          >
            {formatClock(remainingSec)}
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
          {/* The opening gap.
              *
              * Between mounting and the first audio there are several seconds
              * of fetching and synthesising speech, during which every turn
              * renders blank (the reveal has nothing yet). That looked like a
              * frozen page on a screen the candidate has never seen before.
              * This fills it, and disappears the moment the first word lands. */}
          {waitingToBegin ? (
            <div className="iv-enter flex flex-col gap-3">
              <span className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-[var(--iv-text-faint)] uppercase">
                <span className="iv-dot inline-block size-1.5 rounded-full bg-[var(--iv-accent)]" />
                Preparing
              </span>
              <p className="text-[17px] leading-[1.65] text-[var(--iv-text-muted)] md:text-[19px]">
                Hang tight — I&apos;m reading through the work you submitted and
                putting your questions together.
              </p>
            </div>
          ) : null}

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
                {/* A turn marker. Without it, consecutive interviewer lines
                    run together as one wall of text and the candidate cannot
                    tell what was said when — three separate things the
                    interviewer said minutes apart looked like one paragraph. */}
                <span
                  className="mb-2 flex items-center gap-2 text-[11px] font-medium tracking-wide text-[var(--iv-text-faint)] uppercase"
                  aria-hidden
                >
                  <span
                    className={cn(
                      "inline-block size-1.5 rounded-full",
                      isLast
                        ? "bg-[var(--iv-accent)]"
                        : "bg-[var(--iv-text-faint)]",
                    )}
                  />
                  Interviewer
                </span>
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
                  {statusLabel}
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

            {audioDebug ? (
              <div className="pointer-events-none absolute inset-x-0 -top-6 text-center font-mono text-[10px] text-[var(--iv-text-faint)]">
                rms {audioDebug.rms.toFixed(4)} · on {audioDebug.on.toFixed(3)} ·
                off {audioDebug.off.toFixed(3)} ·{" "}
                {audioDebug.spoke ? "SPOKE" : "waiting"} ·{" "}
                {audioDebug.word ? "WORD" : "no-word"} · {turnState} · ctx{" "}
                {audioDebug.ctx} · build {AUDIO_BUILD}
                {sttDebug ? <> · {sttDebug}</> : null}
              </div>
            ) : null}

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
