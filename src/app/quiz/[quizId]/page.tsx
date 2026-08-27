import { redirect } from "next/navigation";
import type { Domain } from "@prisma/client";
import { auth } from "@/auth";
import {
  getQuizWithQuestions,
  type QuizWithQuestionsPayload,
} from "@/features/quiz/get-quiz-with-questions";
import { AppHeader } from "@/components/shared/app-header";
import { QuizForm } from "./quiz-form";
import { ResultsView } from "./results-view";
import { listChallengeEnrollments } from "@/repositories/learning";

type QuestionWithSolution = QuizWithQuestionsPayload["questions"][number] & {
  correctAnswer: string;
  explanation: string;
};

type PageProps = { params: Promise<{ quizId: string }> };

export default async function QuizPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const enrollments = await listChallengeEnrollments(session.user.id);
  if (enrollments.some((e) => e.status === "ABANDONED")) {
    redirect("/dashboard");
  }

  const { quizId } = await params;
  const data = await getQuizWithQuestions(quizId, session.user.id);

  if (!data) {
    redirect("/dashboard");
  }

  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <AppHeader user={headerUser} domain={data.quiz.domain as Domain} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="font-display mb-6 text-2xl font-semibold tracking-tight">
          {data.quiz.title}
        </h1>
        {data.existingAttempt ? (
          <ResultsView
            quiz={data.quiz}
            questions={data.questions as QuestionWithSolution[]}
            existingAttempt={data.existingAttempt}
          />
        ) : (
          <QuizForm quiz={data.quiz} questions={data.questions} />
        )}
      </main>
    </div>
  );
}
