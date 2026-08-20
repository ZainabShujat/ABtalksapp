"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuizUnlockBannerProps {
  weekNumber: number;
  quizId: string;
  title: string;
  questionCount: number;
}

export function QuizUnlockBanner({
  weekNumber,
  quizId,
  title,
  questionCount,
}: QuizUnlockBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-r from-primary/10 via-primary/5 to-background p-5 shadow-sm">
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
      <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/15 p-2">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold">
              Week {weekNumber} Quiz Unlocked!
            </h3>
            <p className="text-sm text-muted-foreground">
              {`${title}: ${questionCount} questions to test what you've learned`}
            </p>
          </div>
        </div>
        <Link
          href={`/quiz/${quizId}`}
          className={cn(
            buttonVariants({ variant: "default", size: "lg" }),
            "inline-flex shrink-0 items-center justify-center",
          )}
        >
          Take Quiz
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
