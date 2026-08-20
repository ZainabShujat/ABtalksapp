"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import type { FinishInterviewData } from "@/features/interview/provider";
import type { ClientQuestion } from "@/features/interview/service";
import { Button } from "@/components/ui/button";
import { Mic, Loader2, Square, Terminal } from "lucide-react";
import { 
  startInterviewAction, 
  submitInterviewAnswerAction,
  finishInterviewAction
} from "@/app/actions/interview-actions";
import { cn } from "@/lib/utils";

/**
 * Visual shell for the live voice interview.
 * Ultra-minimalist UI with an Audio Check phase.
 */
export function StageLiveVoice({
  blueprint,
  interviewId,
  onInterviewOpenAction,
  onFinishedAction,
  onAbandonedAction,
}: {
  blueprint: InterviewBlueprintKey;
  interviewId: string | null;
  onInterviewOpenAction: (id: string) => void;
  onFinishedAction: (data: FinishInterviewData) => void;
  onAbandonedAction: () => void;
}) {
  const [displayText, setDisplayText] = useState<string>("Initializing interview protocol...");
  const [question, setQuestion] = useState<ClientQuestion | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  
  // sessionState: 'connecting' | 'mic-check' | 'listening' | 'speaking' | 'processing'
  const [sessionState, setSessionState] = useState<"connecting" | "mic-check" | "listening" | "speaking" | "processing">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [isFinishing, setIsFinishing] = useState(false);

  // Audio test state
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const internalIdRef = useRef<string | null>(interviewId);

  // Cleanup
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
    };
  }, []);

  // Initialization
  useEffect(() => {
    if (internalIdRef.current) return;
    let isMounted = true;
    
    async function init() {
      setSessionState("connecting");
      try {
        const started = await startInterviewAction({ blueprint });
        if (!isMounted) return;
        
        if (!started.ok) {
           setError(started.message);
           setDisplayText("Connection failed.");
           setSessionState("listening"); // reset state so it doesn't spin
           return;
        }
        
        internalIdRef.current = started.data.interviewId;
        setQuestion(started.data.question);
        if (started.data.prompt) {
          setInitialPrompt(started.data.prompt);
        }
        
        // Enter Audio Check phase
        setSessionState("mic-check");
        setDisplayText("Hi there. Before we begin, let's do a quick audio check. Please tap the microphone and say a few words to make sure I can hear you.");
        
        onInterviewOpenAction(started.data.interviewId);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to connect to the interview server.");
        setSessionState("listening");
      }
    }
    
    void init();
    return () => { isMounted = false; };
  }, [blueprint, onInterviewOpenAction]);

  const speak = useCallback(async (id: string) => {
    setSessionState("speaking");
    try {
      const res = await fetch("/api/interview/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId: id }),
      });
      if (!res.ok) throw new Error(String(res.status));

      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
      URL.revokeObjectURL(url);
    } catch {
      // Failed to play
    } finally {
      setSessionState("listening");
    }
  }, []);

  // Finish Mic check and start actual interview
  const finishMicCheck = useCallback(() => {
    setSessionState("processing");
    setDisplayText(initialPrompt || question?.text || "");
    if (internalIdRef.current) {
      void speak(internalIdRef.current);
    } else {
      setSessionState("listening");
    }
  }, [initialPrompt, question, speak]);

  const send = useCallback(
    async (answerText: string) => {
      // If we are in mic-check, just pass it and move to actual interview
      if (sessionState === "mic-check") {
        finishMicCheck();
        return;
      }

      const id = internalIdRef.current;
      if (!id || !question || answerText.trim().length === 0 || pending) return;

      setSessionState("processing");
      setError(null);

      startTransition(async () => {
        const turn = await submitInterviewAnswerAction({
          interviewId: id,
          questionId: question.id,
          answerText,
        });

        if (!turn.ok) {
          setError(turn.message);
          setSessionState("listening");
          return;
        }

        if (turn.data.prompt) {
          setDisplayText(turn.data.prompt);
        } else if (turn.data.question) {
          setDisplayText(turn.data.question.text);
        }
        
        if (turn.data.question) {
           setQuestion(turn.data.question);
        }

        if (turn.data.finished) {
          setIsFinishing(true);
          const finished = await finishInterviewAction({ interviewId: id });
          setIsFinishing(false);
          
          if (finished.ok) {
            onFinishedAction(finished.data);
          } else {
            setError(finished.message);
          }
          return;
        }

        void speak(id);
      });
    },
    [question, pending, speak, onFinishedAction, sessionState, finishMicCheck],
  );

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Audio visualizer logic for mic check
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

      analyser.smoothingTimeConstant = 0.8;
      analyser.fftSize = 1024;

      microphone.connect(analyser);
      analyser.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      scriptProcessor.onaudioprocess = function() {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) {
          values += (array[i]);
        }
        const average = values / length;
        setAudioLevel(average); // value between 0 and ~100
      }

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        
        if (audioContext.state !== "closed") {
            audioContext.close();
        }
        setAudioLevel(0);
        
        if (sessionState === "mic-check") {
           finishMicCheck();
           return;
        }

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        setSessionState("processing");
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
            setError(json.message);
            setSessionState("listening");
            return;
          }
          await send(json.data.text);
        } catch {
          setError("Transcription service unreachable. You can type instead.");
          setSessionState("listening");
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setSessionState("listening"); // UI-wise it's listening to you
    } catch {
      setMicDenied(true);
      setError("Microphone unavailable. You can type your answers instead.");
      setSessionState("listening");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  const isListening = sessionState === "listening" && recorderRef.current != null;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[600px] w-full max-w-4xl mx-auto font-sans text-white bg-[#030712] rounded-xl overflow-hidden border border-[#1e293b] shadow-2xl relative">
      
      {/* Top Header */}
      <div className="pt-8 pb-4 shrink-0 px-6 md:px-12 flex justify-between items-center relative z-10">
        <h2 className="text-[11px] font-bold tracking-[0.2em] text-[#968BEC] uppercase">
          AI INTERVIEWER
        </h2>
        
        <Button 
          variant="outline" 
          size="sm" 
          className="border-[rgba(46,57,75,0.69)] bg-transparent text-[#9CA3AF] hover:text-white hover:bg-white/5 h-8 text-xs px-3" 
          onClick={onAbandonedAction}
        >
          End Session
        </Button>
      </div>

      {/* Main Conversation Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 relative z-10">
        <div className="max-w-3xl w-full text-center">
          <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium tracking-tight text-[#e2e8f0] leading-relaxed transition-opacity duration-500">
            {displayText}
          </h1>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-auto max-w-lg mb-8 text-sm font-medium text-[#FACC15] bg-[#C9282B]/20 border border-[#C9282B]/50 px-4 py-2 rounded-[8px] text-center backdrop-blur-sm relative z-10">
          {error}
        </div>
      )}

      {/* Controls Area */}
      <div className="shrink-0 pb-12 flex flex-col items-center gap-8 border-t border-[rgba(255,255,255,0.05)] pt-12 bg-gradient-to-t from-black/20 to-transparent relative z-10">
        
        {/* Your Turn Status */}
        <div className="text-center h-12">
          {sessionState === "speaking" || sessionState === "processing" || sessionState === "connecting" ? (
             <p className="text-sm font-semibold text-[#968BEC] animate-pulse">
                {sessionState === 'connecting' ? 'CONNECTING...' : sessionState === 'speaking' ? 'INTERVIEWER SPEAKING' : 'THINKING...'}
             </p>
          ) : (
             <>
                <p className="text-sm font-semibold text-white mb-1">Your turn</p>
                <p className="text-xs text-[#9CA3AF]">
                  {sessionState === "mic-check" ? "Tap the microphone to test your audio." : "Tap the microphone and answer out loud."}
                </p>
             </>
          )}
        </div>

        {/* Microphone Button */}
        <div className="relative flex justify-center items-center">
          {/* Audio Visualizer Ring */}
          {isListening && audioLevel > 0 && (
            <div 
              className="absolute rounded-full bg-[#968BEC]/20 transition-transform duration-75 ease-out"
              style={{ 
                  width: '120px', 
                  height: '120px',
                  transform: `scale(${1 + (audioLevel / 40)})` 
              }}
            />
          )}
          
          <button
            onClick={isListening ? stopRecording : startRecording}
            disabled={sessionState === "processing" || sessionState === "connecting" || sessionState === "speaking"}
            className={cn(
              "relative z-10 flex size-20 items-center justify-center rounded-full border transition-all duration-300",
              isListening
                ? "bg-[#C9282B] border-[#C9282B] text-white"
                : "bg-[#1e293b]/50 border-[#475569]/50 text-[#9CA3AF] hover:bg-[#1e293b] hover:border-[#64748b] hover:text-white",
              (sessionState === "processing" || sessionState === "connecting" || sessionState === "speaking") && "opacity-50 cursor-not-allowed"
            )}
          >
            {sessionState === "processing" || sessionState === "connecting" ? (
              <Loader2 className="size-8 animate-spin" />
            ) : isListening ? (
              <Square className="size-8 fill-current" />
            ) : (
              <Mic className="size-8" />
            )}
          </button>
        </div>

        <p className="text-xs text-[#5B6270]">
          {micDenied ? "Microphone access denied." : "Using your browser's voice — no speech service is configured."}
        </p>

        {/* Typing Fallback */}
        <div className="w-full max-w-xl px-6 mt-4">
          <p className="text-xs text-[#9CA3AF] mb-2 text-center">Prefer typing?</p>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              const text = typed.trim();
              setTyped("");
              void send(text);
            }}
            className="flex items-center gap-2"
          >
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6270]">
                  <Terminal className="size-4" />
              </div>
              <input 
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={sessionState === "processing" || sessionState === "connecting" || sessionState === "speaking"}
                placeholder="Type your answer..."
                className="w-full bg-[#0f172a] border border-[#1e293b] rounded-[8px] pl-10 pr-4 py-3 text-sm text-white placeholder:text-[#475569] focus:outline-none focus:border-[#968BEC]/50 transition-colors"
              />
            </div>
            <Button 
              type="submit"
              disabled={!typed.trim() || sessionState === "processing" || sessionState === "connecting" || sessionState === "speaking"}
              className="h-[46px] px-6 bg-transparent border border-[#1e293b] rounded-[8px] text-[#9CA3AF] hover:text-white hover:bg-[#1e293b]"
            >
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
