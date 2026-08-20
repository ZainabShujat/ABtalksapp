"use client";

import { useState } from "react";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import type { FinishInterviewData } from "@/features/interview/provider";
import { Button } from "@/components/ui/button";
import { Mic, Video, Square, Radio, Terminal, FileCode2 } from "lucide-react";

/**
 * Visual shell for the live voice interview.
 * Redesigned to mimic a technical IDE / HackerRank layout, 
 * strictly utilizing the application's existing design language.
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
    <div className="h-[75vh] min-h-[600px] bg-[#030712] rounded-xl border border-white/10 shadow-2xl overflow-hidden flex flex-col relative text-white font-sans">
      
      {/* IDE Header Menu Bar */}
      <div className="flex-none h-12 border-b border-white/10 bg-[#030712] flex items-center justify-between px-4 select-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-white/50 text-sm font-medium">
            <Terminal className="size-4 text-accent-400" />
            <span>AI_Interview_Session.sh</span>
          </div>
          <div className="h-4 w-px bg-white/10"></div>
          <div className="flex items-center gap-2 bg-red-500/10 text-red-400 px-2.5 py-0.5 rounded text-xs font-bold border border-red-500/20 tracking-wider">
            <Radio className="size-3 animate-pulse" />
            LIVE
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="font-mono text-sm font-bold text-white/80 tracking-widest bg-white/5 px-3 py-1 rounded">
            14:59
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-white/60 hover:text-white hover:bg-white/10" onClick={onAbandonedAction}>
            Abort Session
          </Button>
        </div>
      </div>

      {/* Main IDE Split Body */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Pane: Terminal / Transcript Stream */}
        <div className="w-[35%] min-w-[320px] max-w-[480px] border-r border-white/10 bg-[#060a16] flex flex-col relative z-10">
          <div className="flex-none h-10 border-b border-white/10 bg-white/5 flex items-center px-4">
            <div className="text-xs font-semibold text-white/50 tracking-widest uppercase flex items-center gap-2">
              <Terminal className="size-3.5" /> Output Log
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm scrollbar-admin-purple">
            <div className="flex flex-col gap-1">
              <span className="text-accent-400 font-bold">system@ai:~$</span>
              <span className="text-white/70">Initializing interview protocol...</span>
              <span className="text-emerald-400">Connection established.</span>
            </div>
            
            <div className="flex flex-col gap-1 mt-4">
              <span className="text-accent-400 font-bold">Interviewer:</span>
              <span className="text-white/90">Welcome to your Day 15 interview. Let's start by discussing your work on the frontend routing. Can you explain why you chose the App Router?</span>
            </div>
            
            <div className="flex flex-col gap-1 mt-4">
              <span className="text-emerald-400 font-bold">Candidate:</span>
              <span className="text-white/90">Yes, I used the Next.js app router because it provides built-in support for nested layouts and React Server Components.</span>
            </div>
            
            {/* Blinking cursor effect at the end of transcript */}
            <div className="mt-2 flex items-center h-4">
              <div className="w-2 h-4 bg-white/40 animate-pulse"></div>
            </div>
          </div>
        </div>

        {/* Right Pane: AI Visualizer & Workspace */}
        <div className="flex-1 bg-[#030712] relative flex flex-col overflow-hidden">
          
          {/* Editor Tabs (Visual Only) */}
          <div className="flex-none h-10 border-b border-white/10 bg-white/[0.02] flex items-end px-2">
            <div className="h-9 px-4 border-t border-x border-white/10 bg-[#030712] rounded-t-md flex items-center gap-2 text-sm text-white/80 border-b-0 relative top-[1px]">
              <FileCode2 className="size-4 text-emerald-400" />
              <span>Workspace.tsx</span>
            </div>
          </div>

          {/* Main Visualizer Area */}
          <div className="flex-1 flex flex-col items-center justify-center relative">
            
            {/* Ambient Background Glow matching the active state */}
            <div className={`absolute inset-0 transition-opacity duration-1000 flex items-center justify-center pointer-events-none ${sessionState === 'listening' ? 'opacity-100' : 'opacity-40'}`}>
               <div className="w-[400px] h-[400px] bg-accent-500/10 blur-[100px] rounded-full mix-blend-screen" />
            </div>

            {/* AI Voice Orb */}
            <div className="relative w-64 h-64 flex items-center justify-center group">
              <div className={`absolute inset-0 rounded-full border border-white/10 transition-all duration-700 ease-in-out
                  ${sessionState === 'listening' ? 'bg-accent-900/40 shadow-[0_0_60px_rgba(124,58,237,0.15)] scale-110' : 
                    sessionState === 'speaking' ? 'bg-emerald-950/40 shadow-[0_0_50px_rgba(16,185,129,0.15)] scale-95' : 
                    'bg-white/5'}
              `}>
                <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/5 to-transparent mix-blend-overlay"></div>
              </div>
              
              <div className="relative z-10 flex items-center justify-center">
                {sessionState === 'listening' && (
                  <div className="flex flex-col items-center gap-4">
                    <Mic className="size-10 text-accent-400 animate-pulse drop-shadow-[0_0_15px_rgba(124,58,237,0.5)]" />
                  </div>
                )}
                {sessionState === 'speaking' && (
                  <div className="flex gap-2 items-center h-12">
                    <div className="w-1.5 h-6 bg-emerald-400 rounded-full animate-bounce shadow-[0_0_10px_rgba(16,185,129,0.8)]" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-12 bg-emerald-400 rounded-full animate-bounce shadow-[0_0_10px_rgba(16,185,129,0.8)]" style={{ animationDelay: '100ms' }} />
                    <div className="w-1.5 h-8 bg-emerald-400 rounded-full animate-bounce shadow-[0_0_10px_rgba(16,185,129,0.8)]" style={{ animationDelay: '200ms' }} />
                    <div className="w-1.5 h-5 bg-emerald-400 rounded-full animate-bounce shadow-[0_0_10px_rgba(16,185,129,0.8)]" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
                {sessionState === 'processing' && (
                  <div className="size-10 border-4 border-white/10 border-t-accent-400 rounded-full animate-spin" />
                )}
              </div>
            </div>

            <div className="mt-12 text-center relative z-10">
              <h3 className="text-xl font-medium text-white tracking-wide">
                {sessionState === 'listening' ? "AI is listening..." : 
                 sessionState === 'speaking' ? "You are speaking" : "Processing..."}
              </h3>
              <p className="mt-3 text-sm text-white/40 max-w-sm mx-auto font-mono">
                {sessionState === 'listening' ? "Speak naturally. Auto-detecting voice activity." : "..."}
              </p>
            </div>
          </div>

          {/* Bottom Dock (Camera & Controls) */}
          <div className="absolute bottom-6 right-6 flex items-end gap-4 z-20">
            {/* Camera PiP */}
            <div className="relative group">
              <div className="w-48 aspect-video bg-black rounded-lg border border-white/15 overflow-hidden relative shadow-2xl">
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
      </div>
    </div>
  );
}
