import type { Domain } from "@prisma/client";
import { listQuizCatalog } from "@/repositories/learning";
import { listQuizAttemptsForUser } from "@/repositories/progress";

export type QuizHistoryRow = {
  attemptId: string;
  quizId: string;
  weekNumber: number;
  score: number;
  title: string;
};

export async function getQuizAttemptHistory(
  userId: string,
  enrollment: { challengeId: string; domain: Domain },
): Promise<QuizHistoryRow[]> {
  const catalog = await listQuizCatalog(enrollment.domain);
  const quizIds = catalog.map((q) => q.id);
  if (quizIds.length === 0) return [];

  const byId = new Map(catalog.map((q) => [q.id, q]));
  const attempts = await listQuizAttemptsForUser(userId, quizIds);

  return attempts.flatMap((a) => {
    const quiz = byId.get(a.quizId);
    if (!quiz) return [];
    return [
      {
        attemptId: a.id,
        quizId: a.quizId,
        weekNumber: quiz.weekNumber,
        score: a.score,
        title: quiz.title,
      },
    ];
  });
}
