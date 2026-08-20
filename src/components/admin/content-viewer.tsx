"use client";

import { useMemo, useState } from "react";
import type { Domain } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Problem = {
  id: string;
  domain: Domain;
  dayNumber: number;
  title: string;
  difficulty: string;
  estimatedMinutes: number;
  problemStatement: string;
  learningObjectives: string[];
  resources: string[];
  linkedinTemplate: string;
  tags: string[];
};

type Quiz = {
  id: string;
  domain: Domain;
  weekNumber: number;
  title: string;
  quizQuestions: Array<{
    id: string;
    questionOrder: number;
    questionText: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: string;
    explanation: string;
  }>;
};

function domainChipClass(domain: Domain) {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  if (domain === "SE") return "border-domains-se/50 bg-domains-se-bg text-domains-se";
  return "border-border bg-muted text-muted-foreground";
}

export function ContentViewer({
  problems,
  quizzes,
}: {
  problems: Problem[];
  quizzes: Quiz[];
}) {
  const [problemDomain, setProblemDomain] = useState<"AI" | "DS" | "SE">("SE");
  const [quizDomain, setQuizDomain] = useState<"AI" | "DS" | "SE">("SE");

  const filteredProblems = useMemo(
    () => problems.filter((p) => p.domain === problemDomain),
    [problems, problemDomain],
  );
  const filteredQuizzes = useMemo(
    () => quizzes.filter((q) => q.domain === quizDomain),
    [quizzes, quizDomain],
  );

  return (
    <Tabs defaultValue="problems">
      <TabsList>
        <TabsTrigger value="problems">Problems</TabsTrigger>
        <TabsTrigger value="quizzes">Quizzes</TabsTrigger>
      </TabsList>

      <TabsContent value="problems" className="space-y-4">
        <div className="flex gap-2">
          {(["SE", "DS", "AI"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setProblemDomain(d)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                problemDomain === d
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-accent",
              )}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredProblems.map((problem) => (
            <Dialog key={problem.id}>
              <DialogTrigger className="w-full rounded-xl border p-4 text-left hover:bg-accent/40">
                <p className="text-xs text-muted-foreground">Day {problem.dayNumber}</p>
                <p className="mt-1 line-clamp-2 font-medium">{problem.title}</p>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <Badge variant="outline" className={domainChipClass(problem.domain)}>
                    {problem.domain}
                  </Badge>
                  <Badge variant="secondary">{problem.difficulty}</Badge>
                  <span className="text-muted-foreground">{problem.estimatedMinutes} min</span>
                </div>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    Day {problem.dayNumber}: {problem.title}
                  </DialogTitle>
                  <DialogDescription>{problem.domain} challenge problem</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm leading-relaxed">{problem.problemStatement}</p>
                  <div>
                    <p className="mb-2 text-sm font-semibold">Learning objectives</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {problem.learningObjectives.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold">Resources</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {problem.resources.map((item) => (
                        <li key={item}>
                          <a href={item} target="_blank" rel="noreferrer" className="text-primary underline">
                            {item}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold">LinkedIn template</p>
                    <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                      {problem.linkedinTemplate}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {problem.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="quizzes" className="space-y-4">
        <div className="flex gap-2">
          {(["SE", "DS", "AI"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setQuizDomain(d)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                quizDomain === d
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-accent",
              )}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {filteredQuizzes.map((quiz) => (
            <details key={quiz.id} className="rounded-xl border p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      Week {quiz.weekNumber}: {quiz.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {quiz.quizQuestions.length} questions
                    </p>
                  </div>
                  <Badge variant="outline" className={domainChipClass(quiz.domain)}>
                    {quiz.domain}
                  </Badge>
                </div>
              </summary>
              <div className="mt-4 space-y-4">
                {quiz.quizQuestions.map((q) => (
                  <div key={q.id} className="rounded-md border bg-muted/20 p-3">
                    <p className="font-medium">
                      Q{q.questionOrder}. {q.questionText}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {(["A", "B", "C", "D"] as const).map((opt) => {
                        const value = q[`option${opt}` as "optionA" | "optionB" | "optionC" | "optionD"];
                        const isCorrect = q.correctAnswer === opt;
                        return (
                          <li
                            key={opt}
                            className={cn(
                              "rounded px-2 py-1",
                              isCorrect && "bg-emerald-100 font-medium text-emerald-800",
                            )}
                          >
                            {opt}. {value}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">{q.explanation}</p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
