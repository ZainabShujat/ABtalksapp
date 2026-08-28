"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submitInterviewAnswerAction } from "@/app/actions/interview-actions";
import type { ClientQuestion } from "@/features/interview/service";

/**
 * Turn-based voice for the cohort interview.
 *
 * The loop, and where each part lives:
 *
 *   speak the question   → /api/interview/tts   (server reads its own transcript)
 *   candidate records    → MediaRecorder        (browser)
 *   transcribe           → /api/interview/stt   (server)
 *   submit the text      → submitInterviewAnswerAction  ← the SAME action the
 *                                                          text runner calls
 *   next line arrives    → speak it, repeat
 *
 * That fourth step is the important one. Voice adds no interview logic
 * whatsoever: the graph, the depth ladder, the budgets and the evidence are
 * reached through the identical Server Action, so a spoken interview and a
 * typed one are scored by the same code and cannot drift apart.
 *
 * Three failure modes are handled as first-class states rather than errors,
 * because each of them is something that will genuinely happen to a candidate
 * mid-assessment: the microphone is denied, transcription fails, or playback is
 * blocked by the browser's autoplay policy. In every case the question stays
 * readable on screen and the typed fallback stays available — losing your
 * microphone must never cost you your one attempt at a milestone.
 */

type Line = {
  role: "interviewer" | "candidate";
  text: string;
};

type Phase = "idle" | "speaking" | "recording" | "transcribing" | "thinking";

export function InterviewVoiceRunner({
  interviewId,
  firstQuestion,
  onFinishedAction,
}: {
  interviewId: string;
  firstQuestion: ClientQuestion;
  onFinishedAction: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([
    { role: "interviewer", text: firstQuestion.text },
  ]);
  const [question, setQuestion] = useState<ClientQuestion | null>(firstQuestion);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [typed, setTyped] = useState("");
  /** Which voice the candidate is hearing. Shown so nothing is misrepresented. */
  const [voiceSource, setVoiceSource] = useState<"server" | "browser" | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, phase]);

  // Release the microphone when the component goes away. Without this the
  // browser keeps showing a recording indicator after the interview ends.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  /**
   * Speaks the interviewer's most recent line.
   *
   * Server synthesis first, because that voice is consistent for every
   * candidate. When it is unavailable — no TTS key configured — the browser's
   * own speech synthesis reads the line instead. That is a real spoken
   * question, not a simulation: the words come from the same server transcript
   * either way, only the voice differs. Falling back beats silence, because an
   * interview the candidate must read is a different assessment from one they
   * listen to.
   *
   * Never fatal: if both paths fail the question is still on screen.
   */
  const speak = useCallback(async () => {
    setPhase("speaking");

    const speakInBrowser = (text: string) =>
      new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          resolve();
          return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });

    try {
      const res = await fetch("/api/interview/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId }),
      });

      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        await audio.play();
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
        });
        URL.revokeObjectURL(url);
        setVoiceSource("server");
      } else {
        // 503 means no server voice is configured. Anything else is a
        // transient failure. Both are answered the same way.
        const lastLine = [...lines].reverse().find((l) => l.role === "interviewer");
        if (lastLine) {
          setVoiceSource("browser");
          await speakInBrowser(lastLine.text);
        }
      }
    } catch {
      const lastLine = [...lines].reverse().find((l) => l.role === "interviewer");
      if (lastLine) {
        setVoiceSource("browser");
        await speakInBrowser(lastLine.text);
      }
    } finally {
      setPhase("idle");
    }
  }, [interviewId, lines]);

  const send = useCallback(
    async (answerText: string) => {
      if (!question || answerText.trim().length === 0) return;

      setLines((prev) => [...prev, { role: "candidate", text: answerText }]);
      setPhase("thinking");
      setError(null);

      const turn = await submitInterviewAnswerAction({
        interviewId,
        questionId: question.id,
        answerText,
      });

      if (!turn.ok) {
        setError(turn.message);
        setPhase("idle");
        return;
      }

      if (turn.data.prompt) {
        setLines((prev) => [
          ...prev,
          { role: "interviewer", text: turn.data.prompt! },
        ]);
      }
      setQuestion(turn.data.question);
      setPhase("idle");

      if (turn.data.finished) {
        onFinishedAction();
        return;
      }

      void speak();
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
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        setPhase("transcribing");
        const form = new FormData();
        form.append("audio", blob, "answer.webm");

        try {
          const res = await fetch("/api/interview/stt", {
            method: "POST",
            body: form,
          });
          const json = (await res.json()) as
            | { ok: true; data: { text: string } }
            | { ok: false; message: string };

          if (!json.ok) {
            // The recording is gone but the turn is not spent — the candidate
            // simply records again, or types.
            setError(json.message);
            setPhase("idle");
            return;
          }
          await send(json.data.text);
        } catch {
          setError("Could not reach the transcription service. You can type instead.");
          setPhase("idle");
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setPhase("recording");
    } catch {
      setMicDenied(true);
      setError("Microphone unavailable. You can type your answers instead.");
      setPhase("idle");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  const busy = phase === "transcribing" || phase === "thinking" || phase === "speaking";

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {lines.map((line, i) => (
          <div key={i} className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {line.role === "interviewer" ? "Interviewer" : "You"}
            </p>
            <p className="text-sm leading-6">{line.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="status">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {!micDenied ? (
          <Button
            type="button"
            variant={phase === "recording" ? "destructive" : "default"}
            disabled={busy || !question}
            onClick={phase === "recording" ? stopRecording : startRecording}
          >
            {phase === "recording" ? (
              <>
                <Square className="size-4" /> Stop and send
              </>
            ) : (
              <>
                <Mic className="size-4" /> Record answer
              </>
            )}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          disabled={busy || !question}
          onClick={() => void speak()}
        >
          <Volume2 className="size-4" /> Replay question
        </Button>

        {voiceSource === "browser" ? (
          <span className="text-xs text-muted-foreground">
            Using your browser&apos;s voice — no speech service is configured.
          </span>
        ) : null}

        {busy ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {phase === "transcribing"
              ? "Transcribing…"
              : phase === "thinking"
                ? "Thinking…"
                : "Speaking…"}
          </span>
        ) : null}
      </div>

      {/*
        Always present, not only when the microphone fails. Some candidates will
        be in a shared room, on a bad connection, or simply more precise in
        writing, and an assessment that only accepts speech measures their
        circumstances alongside their ability.
      */}
      <div className="space-y-2">
        <label
          htmlFor="typed-answer"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Or type your answer
        </label>
        <textarea
          id="typed-answer"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy || !question}
          rows={4}
          className={cn(
            "w-full resize-y border bg-background p-3 text-sm",
            "focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || !question || typed.trim().length === 0}
          onClick={() => {
            const text = typed.trim();
            setTyped("");
            void send(text);
          }}
        >
          Send typed answer
        </Button>
      </div>
    </div>
  );
}
