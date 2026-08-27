"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuizWithQuestionsPayload } from "@/features/quiz/get-quiz-with-questions";

type QuestionWithSolution = QuizWithQuestionsPayload["questions"][number] & {
  correctAnswer: string;
  explanation: string;
};

type Props = {
  quiz: QuizWithQuestionsPayload["quiz"];
  questions: QuestionWithSolution[];
  userAnswers: Record<string, string>;
  score: number;
  answersDetailAvailable?: boolean;
};

function feedbackMessage(score: number, max: number): string {
  if (max === 10) {
    if (score >= 9) return "Excellent! 🎉";
    if (score >= 7) return "Great job!";
    if (score >= 4) return "Good effort. Review the explanations below.";
    return "Keep learning. Review the explanations below.";
  }
  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 90) return "Excellent! 🎉";
  if (pct >= 70) return "Great job!";
  if (pct >= 40) return "Good effort. Review the explanations below.";
  return "Keep learning. Review the explanations below.";
}

export function QuizResultsDisplay({
  quiz,
  questions,
  userAnswers,
  score,
  answersDetailAvailable = true,
}: Props) {
  const max = questions.length;
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Your score</p>
        <p className="mt-2 text-4xl font-bold tabular-nums">
          {score} / {max}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{pct}%</p>
        <p className="mt-4 text-base font-medium">{feedbackMessage(score, max)}</p>
        {!answersDetailAvailable && (
          <p className="mt-3 text-sm text-muted-foreground">
            Your score is saved. Per-question answer highlights are unavailable
            for this older attempt.
          </p>
        )}
      </div>

      <div className="space-y-6">
        {questions.map((q, idx) => {
          const user = userAnswers[q.id] ?? "";
          const correct = q.correctAnswer;
          const userGotIt = user === correct;
          const opts: { key: "A" | "B" | "C" | "D"; label: string }[] = [
            { key: "A", label: q.optionA },
            { key: "B", label: q.optionB },
            { key: "C", label: q.optionC },
            { key: "D", label: q.optionD },
          ];
          return (
            <div
              key={q.id}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <p className="text-sm font-medium text-muted-foreground">
                Question {idx + 1}
              </p>
              <p className="mt-1 text-base font-medium">{q.questionText}</p>
              <ul className="mt-3 space-y-2">
                {opts.map((o) => {
                  const isUserPick = user === o.key;
                  const isCorrectOption = correct === o.key;
                  const greenUser = isUserPick && userGotIt;
                  const redUser = isUserPick && !userGotIt;
                  const greenOutline =
                    !isUserPick && isCorrectOption && !userGotIt;
                  return (
                    <li
                      key={o.key}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        greenUser && "border-green-600 bg-green-600/15",
                        redUser && "border-destructive bg-destructive/10",
                        greenOutline &&
                          "border-2 border-green-600 bg-transparent",
                        !greenUser &&
                          !redUser &&
                          !greenOutline &&
                          "border-border bg-muted/30",
                      )}
                    >
                      <span className="font-mono font-semibold">{o.key}.</span>{" "}
                      {o.label}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {q.explanation}
              </div>
            </div>
          );
        })}
      </div>

      <Link
        href="/dashboard"
        className={cn(buttonVariants({ variant: "secondary" }), "inline-flex")}
      >
        Back to dashboard
      </Link>
    </div>
  );
}
