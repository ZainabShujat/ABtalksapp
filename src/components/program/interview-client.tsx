"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, PhoneOff, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeInterviewAction } from "@/app/actions/program-interview-actions";

const INTERVIEW_DURATION_SEC = 900;
const INTERVIEW_MIN_DURATION_SEC = 180;

type InterviewTranscriptLine = {
  role: "ai" | "candidate";
  text: string;
  ts: number;
};

const REALTIME_CALLS_URL =
  "https://api.openai.com/v1/realtime/calls?model=gpt-realtime";

type Phase =
  | "notice"
  | "mic_check"
  | "connecting"
  | "live"
  | "submitting"
  | "evaluating";

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseRealtimeEvent(
  raw: string,
  pushLine: (line: InterviewTranscriptLine) => void,
) {
  try {
    const event = JSON.parse(raw) as {
      type?: string;
      transcript?: string;
    };
    if (!event.type) return;

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string" &&
      event.transcript.trim()
    ) {
      pushLine({
        role: "candidate",
        text: event.transcript.trim(),
        ts: Date.now(),
      });
    }

    if (
      event.type === "response.output_audio_transcript.done" &&
      typeof event.transcript === "string" &&
      event.transcript.trim()
    ) {
      pushLine({
        role: "ai",
        text: event.transcript.trim(),
        ts: Date.now(),
      });
    }
  } catch {
    // ignore malformed events
  }
}

export function InterviewClient({
  memberName,
}: {
  memberName: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("notice");
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(INTERVIEW_DURATION_SEC);
  const [elapsedSec, setElapsedSec] = useState(0);

  const transcriptRef = useRef<InterviewTranscriptLine[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  const pushLine = useCallback((line: InterviewTranscriptLine) => {
    transcriptRef.current = [...transcriptRef.current, line];
  }, []);

  const stopMedia = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const finishInterview = useCallback(
    async (reason: "timer" | "manual" | "error") => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopMedia();

      const durationSec = startedAtRef.current
        ? Math.min(
            INTERVIEW_DURATION_SEC + 60,
            Math.round((Date.now() - startedAtRef.current) / 1000),
          )
        : elapsedSec;

      if (durationSec < INTERVIEW_MIN_DURATION_SEC) {
        setPhase("mic_check");
        endedRef.current = false;
        if (reason === "manual") {
          toast.error("Interview must be at least 3 minutes before ending.");
        } else {
          toast.error(
            "Interview too short to save. You can restart if attempts remain.",
          );
        }
        return;
      }

      setPhase("submitting");
      const result = await completeInterviewAction({
        transcript: transcriptRef.current,
        durationSec,
      });

      if (!result.ok) {
        toast.error(result.message);
        setPhase("mic_check");
        endedRef.current = false;
        return;
      }

      setPhase("evaluating");
      if (!result.data.evaluated) {
        toast.message(
          "Transcript saved. Evaluation is pending — your admin can re-run it.",
        );
      } else {
        toast.success("Interview complete!");
      }
      router.refresh();
    },
    [elapsedSec, router, stopMedia],
  );

  useEffect(() => {
    return () => {
      stopMedia();
    };
  }, [stopMedia]);

  useEffect(() => {
    if (phase !== "live") return;

    const tick = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          void finishInterview("timer");
          return 0;
        }
        return s - 1;
      });
      setElapsedSec((e) => e + 1);
    }, 1000);

    return () => clearInterval(tick);
  }, [phase, finishInterview]);

  async function requestMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicGranted(true);

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      toast.error("Microphone access denied. Allow mic permission and retry.");
      setMicGranted(false);
    }
  }

  async function startInterview() {
    if (!micGranted) {
      toast.error("Check your microphone first.");
      return;
    }

    setPhase("connecting");
    endedRef.current = false;
    transcriptRef.current = [];
    startedAtRef.current = Date.now();
    setSecondsLeft(INTERVIEW_DURATION_SEC);
    setElapsedSec(0);

    try {
      const sessionRes = await fetch("/api/program/interview/session", {
        method: "POST",
      });
      const sessionJson = (await sessionRes.json()) as {
        ok: boolean;
        message?: string;
        data?: { clientSecret: string };
      };

      if (!sessionJson.ok || !sessionJson.data?.clientSecret) {
        toast.error(sessionJson.message ?? "Could not start session.");
        setPhase("mic_check");
        return;
      }

      const clientSecret = sessionJson.data.clientSecret;
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0] ?? null;
      };

      const micTrack = streamRef.current?.getAudioTracks()[0];
      if (micTrack) {
        pc.addTrack(micTrack, streamRef.current!);
      }

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              audio: {
                input: {
                  transcription: { model: "gpt-4o-mini-transcribe" },
                },
              },
            },
          }),
        );
      });
      dc.addEventListener("message", (e) => {
        if (typeof e.data === "string") {
          parseRealtimeEvent(e.data, pushLine);
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpRes.ok) {
        throw new Error("WebRTC connection failed.");
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      setPhase("live");
    } catch {
      toast.error("Connection failed. Try again or use a laptop on stable Wi‑Fi.");
      stopMedia();
      if (transcriptRef.current.length > 0 && elapsedSec >= INTERVIEW_MIN_DURATION_SEC) {
        await finishInterview("error");
      } else {
        setPhase("mic_check");
      }
    }
  }

  const canEnd = phase === "live" && elapsedSec >= INTERVIEW_MIN_DURATION_SEC;

  return (
    <div className="space-y-6 rounded-xl border p-6">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        Use a laptop with headphones in a quiet room for the best experience.
        Mobile browsers may have limited microphone support.
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Exit voice interview</h2>
        <p className="text-sm text-muted-foreground">
          Hi {memberName} — this is a one-time, 15-minute AI voice interview.
          Speak naturally; the interviewer will guide you through fundamentals
          and a scenario question.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>One question at a time — wait for the AI to finish speaking.</li>
          <li>Minimum 3 minutes before you can end early.</li>
          <li>Your transcript is saved and evaluated separately from your leaderboard score.</li>
        </ul>
      </div>

      {phase === "notice" && (
        <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            By continuing you acknowledge that this session uses a third-party
            AI voice service (OpenAI). Audio is transcribed for evaluation;
            scores and a short summary may be shared with approved recruiters if
            you opted into talent-portal visibility. The full transcript is kept
            for ABTalks admins and evaluation — not shown to recruiters.
          </p>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 rounded border"
              checked={noticeAccepted}
              onChange={(e) => setNoticeAccepted(e.target.checked)}
            />
            <span>I understand and want to proceed with the voice interview.</span>
          </label>
          <Button
            type="button"
            disabled={!noticeAccepted}
            onClick={() => setPhase("mic_check")}
          >
            Continue to microphone check
          </Button>
        </div>
      )}

      {phase === "mic_check" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {micGranted ? (
              <Mic className="size-5 text-emerald-500" />
            ) : (
              <MicOff className="size-5 text-muted-foreground" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium">Microphone check</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
          </div>
          {!micGranted ? (
            <Button type="button" onClick={() => void requestMic()}>
              Allow microphone
            </Button>
          ) : (
            <Button
              type="button"
              className="gap-2"
              onClick={() => void startInterview()}
            >
              <Sparkles className="size-4" />
              Start interview
            </Button>
          )}
        </div>
      )}

      {phase === "connecting" && (
        <p className="text-sm text-muted-foreground">Connecting to interviewer…</p>
      )}

      {phase === "live" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <span className="text-sm font-medium">Time remaining</span>
            <span className="font-display text-2xl font-bold tabular-nums">
              {formatCountdown(secondsLeft)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {transcriptRef.current.length} transcript lines captured
          </p>
          <Button
            type="button"
            variant="destructive"
            className="gap-2"
            disabled={!canEnd}
            onClick={() => void finishInterview("manual")}
          >
            <PhoneOff className="size-4" />
            End interview
          </Button>
          {!canEnd && (
            <p className="text-xs text-muted-foreground">
              Available after {INTERVIEW_MIN_DURATION_SEC / 60} minutes (
              {formatCountdown(Math.max(0, INTERVIEW_MIN_DURATION_SEC - elapsedSec))}{" "}
              left).
            </p>
          )}
        </div>
      )}

      {(phase === "submitting" || phase === "evaluating") && (
        <p className="text-sm text-muted-foreground">
          {phase === "submitting"
            ? "Saving your transcript…"
            : "Evaluating your interview…"}
        </p>
      )}
    </div>
  );
}
