"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CornerDownLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  abandonInterviewAction,
  finishInterviewAction,
  startInterviewAction,
  submitInterviewAnswerAction,
} from "@/app/actions/interview-actions";
import type {
  ClientQuestion,
  FinishInterviewData,
} from "@/features/interview/provider";
import type { InterviewBlueprintKey } from "@/features/interview/cohort/blueprint";

/**
 * Stage 4 — the live interview.
 *
 * Every turn is a real server round-trip: the answer is evaluated for evidence,
 * the state machine decides whether to probe or move on, and the next prompt
 * comes back from the server. The client holds no plan and no state — it knows
 * only the question currently on the floor.
 */

type Line = {
  role: "interviewer" | "candidate";
  text: string;
  followUp?: boolean;
};

export function StageLive({
  blueprint,
  interviewId,
  onInterviewOpenAction,
  onFinishedAction,
  onAbandonedAction,
}: {
  /** Which milestone this attempt is for. Re-gated server-side on start. */
  blueprint: InterviewBlueprintKey;
  interviewId: string | null;
  onInterviewOpenAction: (id: string) => void;
  onFinishedAction: (data: FinishInterviewData) => void;
  onAbandonedAction: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [question, setQuestion] = useState<ClientQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [pending, startTransition] = useTransition();

  const openedRef = useRef(false);
  const idRef = useRef<string | null>(interviewId);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, scoring]);

  const finish = useCallback(async (id: string) => {
    setScoring(true);
    const result = await finishInterviewAction({ interviewId: id });
    if (!result.ok) {
      setError(result.message);
      setScoring(false);
      return;
    }
    onFinishedAction(result.data);
  }, [onFinishedAction]);

  // Open the attempt exactly once, even under React strict-mode double effects.
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;

    void (async () => {
      const started = await startInterviewAction({ blueprint });
      setStarting(false);
      if (!started.ok) {
        setError(started.message);
        return;
      }
      idRef.current = started.data.interviewId;
      onInterviewOpenAction(started.data.interviewId);
      setQuestion(started.data.question);
      setLines([{ role: "interviewer", text: started.data.question.text }]);
    })();
  }, [blueprint, onInterviewOpenAction]);

  function send() {
    const id = idRef.current;
    const text = answer.trim();
    if (!id || !question || text.length === 0 || pending) return;

    setError(null);
    setLines((prev) => [...prev, { role: "candidate", text }]);
    setAnswer("");

    startTransition(async () => {
      const turn = await submitInterviewAnswerAction({
        interviewId: id,
        questionId: question.id,
        answerText: text,
      });

      if (!turn.ok) {
        setError(turn.message);
        return;
      }

      if (turn.data.prompt) {
        setLines((prev) => [
          ...prev,
          {
            role: "interviewer",
            text: turn.data.prompt as string,
            followUp: turn.data.isFollowUp,
          },
        ]);
      }

      if (turn.data.finished) {
        setQuestion(null);
        await finish(id);
        return;
      }

      if (turn.data.question) setQuestion(turn.data.question);
    });
  }

  async function leave() {
    const id = idRef.current;
    if (id) await abandonInterviewAction({ interviewId: id });
    onAbandonedAction();
  }

  if (starting) {
    return (
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Preparing</span>
        <h2 className="mt-3 flex items-center gap-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          <Loader2 className="size-5 animate-spin" strokeWidth={2} aria-hidden />
          Building your questions
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          Selecting challenge days you completed and drafting questions from
          them.
        </p>
      </section>
    );
  }

  if (error && !question) {
    return (
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Interview unavailable</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          We could not continue
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          {error}
        </p>
        <div className="mt-6">
          <Button type="button" variant="outline" onClick={onAbandonedAction}>
            Back to eligibility
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <span className="kicker">
          {question
            ? `Question ${question.order} of ${question.totalQuestions}`
            : "Wrapping up"}
        </span>
        <button
          type="button"
          onClick={() => void leave()}
          className="focus-spark text-[15px] leading-6 text-foreground/70 underline underline-offset-4"
        >
          Leave without finishing
        </button>
      </div>

      <div className="border-2 border-[hsl(var(--divider)/0.4)]">
        <div className="max-h-[46vh] overflow-y-auto px-6 py-6">
          {lines.map((line, i) => (
            <div key={i} className={i > 0 ? "mt-6" : undefined}>
              <span className="kicker">
                {line.role === "interviewer"
                  ? line.followUp
                    ? "Follow-up"
                    : "Interviewer"
                  : "You"}
              </span>
              <p
                className="mt-2 max-w-[70ch] text-[16px] leading-7"
                style={{
                  color:
                    line.role === "candidate"
                      ? "hsl(var(--foreground) / 0.78)"
                      : "hsl(var(--foreground))",
                  fontWeight: line.role === "interviewer" ? 500 : 400,
                }}
              >
                {line.text}
              </p>
            </div>
          ))}

          {(pending || scoring) && (
            <div className="mt-6 flex items-center gap-3 text-[15px] leading-6 text-foreground/70">
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              {scoring ? "Scoring your interview" : "Considering your answer"}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <hr className="rule2" />

        <div className="px-6 py-5">
          <label htmlFor="answer" className="kicker">
            Your answer
          </label>
          <textarea
            id="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={5}
            disabled={!question || pending || scoring}
            placeholder="Answer in your own words. Specifics from what you built count for more than definitions."
            className="focus-spark mt-3 w-full resize-y border-2 border-[hsl(var(--divider)/0.4)] bg-[hsl(var(--background))] px-4 py-3 text-[16px] leading-7 outline-none placeholder:text-foreground/40 disabled:opacity-45"
          />

          {error && question && (
            <p className="mt-3 text-[15px] leading-6 text-destructive">{error}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              onClick={send}
              disabled={!question || answer.trim().length === 0 || pending || scoring}
            >
              Send answer
            </Button>
            <span className="text-[15px] leading-6 text-foreground/60">
              <CornerDownLeft className="mr-1 inline size-4" strokeWidth={2} aria-hidden />
              Ctrl or Cmd + Enter
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
