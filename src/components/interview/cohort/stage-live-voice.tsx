"use client";

import { useState } from "react";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import type { FinishInterviewData } from "@/features/interview/provider";
import { Button } from "@/components/ui/button";
import { Mic, Video, Square, Radio } from "lucide-react";

/**
 * Visual shell for the live voice interview.
 * OpenAI Realtime is NOT connected yet. This is just the UI.
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
  // Placeholder state to simulate UI changes
  const [sessionState, setSessionState] = useState<"connecting" | "listening" | "speaking" | "processing">("listening");

  return (
    <div className="min-h-[70vh] bg-[#050C21] rounded-2xl border border-[rgba(46,57,75,0.69)] overflow-hidden flex flex-col relative text-white">
      
      {/* Header / Top Bar */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-red-500/10 text-red-400 px-3 py-1 rounded-full text-xs font-bold border border-red-500/20">
                <Radio className="size-3 animate-pulse" />
                LIVE
            </div>
            <span className="text-sm font-medium text-white/60">
                Question 1 of 10
            </span>
        </div>
        
        <div className="font-mono text-xl font-bold tracking-wider">
            14:59
        </div>

        <div>
            <Button variant="ghost" size="sm" className="text-white/60 hover:text-white" onClick={onAbandonedAction}>
                Leave early
            </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
        
        {/* Voice Visualization Placeholder (Orb) */}
        <div className="relative w-48 h-48 flex items-center justify-center">
            {/* Pulsing background glow */}
            <div className={`absolute inset-0 rounded-full bg-accent-500/20 blur-3xl transition-opacity duration-1000 ${sessionState === 'listening' ? 'opacity-100' : 'opacity-40'}`} />
            
            {/* The orb itself */}
            <div className={`z-10 w-32 h-32 rounded-full border border-white/10 flex items-center justify-center transition-all duration-500
                ${sessionState === 'listening' ? 'bg-accent-600/30 shadow-[0_0_40px_rgba(115,100,230,0.5)] scale-110' : 
                  sessionState === 'speaking' ? 'bg-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.3)] scale-95' : 
                  'bg-white/5'}
            `}>
                {sessionState === 'listening' && <Mic className="size-8 text-accent-300 animate-pulse" />}
                {sessionState === 'speaking' && <div className="flex gap-1">
                    <div className="w-1 h-4 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1 h-6 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '100ms' }} />
                    <div className="w-1 h-3 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                </div>}
                {sessionState === 'processing' && <div className="size-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />}
            </div>
        </div>

        <div className="mt-8 text-center">
            <h3 className="text-xl font-medium text-white/90">
                {sessionState === 'listening' ? "AI is listening..." : 
                 sessionState === 'speaking' ? "You are speaking" : "Processing..."}
            </h3>
            <p className="mt-2 text-sm text-white/50 max-w-md mx-auto">
                {sessionState === 'listening' ? "Speak naturally. The AI will respond when you finish." : "..."}
            </p>
        </div>

      </div>

      {/* Footer / Controls & PiP */}
      <div className="p-4 border-t border-white/10 bg-black/20 flex items-end justify-between">
          
        {/* Transcript Preview */}
        <div className="flex-1 max-w-2xl mr-8">
            <div className="text-xs font-bold text-accent-400 mb-2 tracking-wider uppercase">Transcript</div>
            <div className="h-24 overflow-hidden mask-image:linear-gradient(to_bottom,transparent,black_20%) flex flex-col justify-end">
                <p className="text-sm text-white/40 mb-1">
                    <span className="font-semibold text-white/60">Interviewer:</span> Welcome to your Day 15 interview. Let's start by discussing your work on the frontend routing.
                </p>
                <p className="text-sm text-white/80">
                    <span className="font-semibold text-emerald-400">You:</span> Yes, I implemented the Next.js app router...
                </p>
            </div>
        </div>

        {/* Camera PiP */}
        <div className="shrink-0 relative group">
            <div className="w-40 aspect-video bg-black rounded-lg border border-white/20 overflow-hidden relative">
                <div className="absolute inset-0 flex items-center justify-center">
                    <Video className="size-6 text-white/20" />
                </div>
            </div>
            <Button 
                variant="destructive" 
                size="icon" 
                className="absolute -top-3 -right-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                onClick={() => {
                    // Simulate finish for now
                    onFinishedAction({
                        blueprint,
                        durationSec: 0,
                        scores: {
                            overallScore: 85,
                            perCompetency: [
                                { competency: "CONCEPTUAL", score: 80, tier: "EXPLAINED" },
                                { competency: "PRACTICAL", score: 90, tier: "DEMONSTRATED" },
                                { competency: "PROBLEM_SOLVING", score: 85, tier: "EXPLAINED" },
                                { competency: "TECHNICAL_DEPTH", score: 85, tier: "EXPLAINED" },
                                { competency: "COMMUNICATION", score: 90, tier: "DEMONSTRATED" }
                            ],
                            summary: "Strong practical implementation details."
                        }
                    })
                }}
            >
                <Square className="size-4 fill-current" />
            </Button>
        </div>

      </div>
    </div>
  );
}
