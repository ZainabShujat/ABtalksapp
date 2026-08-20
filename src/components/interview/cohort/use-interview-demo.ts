"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import {
  startDemoInterviewAction,
  submitDemoAnswerAction,
} from "@/app/actions/dev-interview-agent-actions";

export type InterviewerState =
  | "idle"
  | "ai_speaking"
  | "listening"
  | "processing"
  | "your_turn";

export type TranscriptEntry = {
  id: string;
  role: "interviewer" | "candidate";
  text: string;
  timestamp: number;
  isFollowUp?: boolean;
  isRedirect?: boolean;
  isScaffold?: boolean;
};

export type InterviewContext = {
  moduleName: string;
  competency: string;
  questionIndex: number;
  totalQuestions: number;
};

export function useInterviewDemo() {
  const [state, setState] = useState<InterviewerState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [context, setContext] = useState<InterviewContext>({
    moduleName: "Connecting...",
    competency: "Live AI Assessment",
    questionIndex: 0,
    totalQuestions: 10,
  });
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isConnected, setIsConnected] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed time ticker
  useEffect(() => {
    if (state !== "idle" && !isComplete) {
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state, isComplete]);

  const startInterview = useCallback(async (blueprint: InterviewBlueprintKey = "DAY_15") => {
    setState("processing");
    setTranscript([]);
    setElapsedSec(0);
    setIsComplete(false);

    try {
      const res = await startDemoInterviewAction({ blueprint });
      if (!res.ok) {
        console.error(res.message);
        setState("idle");
        setIsConnected(false);
        return;
      }

      setSessionId(res.data.sessionId);
      
      setTranscript(res.data.transcript.map((t: any, i: number) => ({
        id: `t-${i}`,
        role: t.role,
        text: t.text,
        timestamp: Date.now()
      })));

      setContext({
        moduleName: res.data.blueprintLabel,
        competency: "Live AI Assessment",
        questionIndex: res.data.question ? res.data.question.order - 1 : 0,
        totalQuestions: res.data.question ? res.data.question.total : 10,
      });

      setState("ai_speaking");
      setTimeout(() => setState("your_turn"), 2500);

    } catch (e) {
      console.error(e);
      setIsConnected(false);
      setState("idle");
    }
  }, []);

  const submitAnswer = useCallback(async (answerText: string) => {
    if (!sessionId) return;

    // Optimistically add candidate answer
    setTranscript(prev => [
      ...prev,
      { id: `c-${Date.now()}`, role: "candidate", text: answerText, timestamp: Date.now() }
    ]);
    setState("processing");

    try {
      const res = await submitDemoAnswerAction({ sessionId, answerText });
      if (!res.ok) {
        console.error(res.message);
        setState("your_turn");
        return;
      }

      // Sync exact transcript from server
      setTranscript(res.data.transcript.map((t: any, i: number) => ({
        id: `t-${i}`,
        role: t.role,
        text: t.text,
        timestamp: Date.now(),
        // Simple heuristic to label followups / redirects
        isFollowUp: t.role === "interviewer" && res.data.debug.action === "probe",
        isRedirect: t.role === "interviewer" && res.data.debug.action === "redirect",
      })));

      setContext(prev => ({
        ...prev,
        questionIndex: res.data.question ? res.data.question.order - 1 : prev.questionIndex,
      }));

      if (res.data.finished) {
        setIsComplete(true);
        setState("idle");
        return;
      }

      setState("ai_speaking");
      setTimeout(() => setState("your_turn"), 2500);

    } catch (e) {
      console.error(e);
      setState("your_turn");
    }
  }, [sessionId]);

  const simulateRedirect = useCallback(() => {
    // Hidden dev feature: instantly injects an off-topic string to test the AI's redirect handling
    submitAnswer("Who is the Prime Minister of India?");
  }, [submitAnswer]);

  return {
    state,
    transcript,
    context,
    elapsedSec,
    isConnected,
    isComplete,
    startInterview,
    submitAnswer,
    simulateRedirect,
  };
}
